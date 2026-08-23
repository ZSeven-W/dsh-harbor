// DSH plugin hub: the loopback-only HTTP surface the settings panel reads.
// Scanning decisions live in ../scan; this module owns transport, lifecycle,
// caching, and the boundary between a live host profile and all-profile data.

import { scan, CAPABILITIES, checkUpstream } from '../scan/index.mjs';
import { collectRuntimeSurface, attributeSurface } from '../scan/runtime.mjs';
import { fingerprintSource, readClientBuildId } from './freshness.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-harbor';
export const inject = ['webServer'];

const ROUTE_BASE = '/_dsh/dsh-harbor';
const ROUTE_PATHS = [
  ROUTE_BASE + '/ping',
  ROUTE_BASE + '/report',
  ROUTE_BASE + '/capabilities',
  ROUTE_BASE + '/updates',
];
// Static scanning walks every plugin source tree. Runtime registries are not
// cached: tools/providers/routes can change as fibers load or dispose.
const REPORT_CACHE_TTL_MS = 60_000;
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function headerValue(req, name) {
  const headers = req?.headers;
  if (headers === null || typeof headers !== 'object') return undefined;
  const direct = headers[name];
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct)) return direct[0];
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return typeof value === 'string' ? value : (Array.isArray(value) ? value[0] : undefined);
}

function isIpv4Loopback(address) {
  const parts = address.split('.');
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isLoopbackRemoteAddress(address) {
  if (!address) return false;
  const normalized = String(address).toLowerCase().split('%', 1)[0];
  if (normalized === '::1' || isIpv4Loopback(normalized)) return true;
  if (!normalized.startsWith('::ffff:')) return false;
  const mapped = normalized.slice('::ffff:'.length);
  if (isIpv4Loopback(mapped)) return true;
  const hex = /^([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(mapped);
  return hex !== null && (Number.parseInt(hex[1], 16) >>> 8) === 127;
}

function requestAuthority(req) {
  const host = headerValue(req, 'host');
  if (typeof host !== 'string') return undefined;
  try {
    const parsed = new URL('http://' + host);
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== ''
      || parsed.username !== '' || parsed.password !== '') return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true;
  return isIpv4Loopback(hostname);
}

function isLoopbackRequest(req) {
  if (!isLoopbackRemoteAddress(req?.socket?.remoteAddress)) return false;
  const authority = requestAuthority(req);
  return authority !== undefined && isLoopbackHostname(authority.hostname);
}

function expectedOrigin(req) {
  const authority = requestAuthority(req);
  if (authority === undefined) return null;
  const scheme = req?.socket?.encrypted === true ? 'https:' : 'http:';
  return new URL(`${scheme}//${authority.host}`).origin;
}

/**
 * Stateful/networked GETs need browser CSRF protection in addition to the
 * loopback peer/Host fence. Cross-origin pages can send requests to localhost;
 * Fetch Metadata identifies those requests, while Origin/Referer cover older
 * clients. Headerless non-browser callers remain usable.
 */
function isSameOriginBrowserRequest(req) {
  const expected = expectedOrigin(req);
  if (expected === null) return false;

  const fetchSite = headerValue(req, 'sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;

  const origin = headerValue(req, 'origin');
  if (origin) {
    try { if (new URL(origin).origin !== expected) return false; }
    catch { return false; }
  }

  const referer = headerValue(req, 'referer');
  if (!origin && referer) {
    try { if (new URL(referer).origin !== expected) return false; }
    catch { return false; }
  }
  return true;
}

function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    ...headers,
  });
  res.end(body);
}

function errorMessage(error) {
  return typeof error?.message === 'string' ? error.message : String(error);
}

/** Resolve the profile directory set as the root Cordis context base URL. */
export function profileFromContext(ctx) {
  let baseUrl;
  try { baseUrl = ctx?.baseUrl; } catch { return null; }
  if (typeof baseUrl !== 'string') return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'file:') return null;
    const pathname = url.pathname.replace(/\/+$/u, '');
    const raw = pathname.slice(pathname.lastIndexOf('/') + 1);
    const profile = decodeURIComponent(raw);
    if (!profile || profile === '.' || profile === '..' || /[/\\]/u.test(profile)) return null;
    return profile;
  } catch {
    return null;
  }
}

/**
 * Mount the hub with overridable pure dependencies for fake-host tests. The
 * public Cordis apply() below always uses production dependencies.
 */
export async function mountHub(ctx, dependencies = {}) {
  const scanFn = dependencies.scan ?? scan;
  const checkUpstreamFn = dependencies.checkUpstream ?? checkUpstream;
  const collectRuntimeFn = dependencies.collectRuntimeSurface ?? collectRuntimeSurface;
  const attributeFn = dependencies.attributeSurface ?? attributeSurface;
  const fingerprintFn = dependencies.fingerprintSource ?? fingerprintSource;
  const readClientBuildIdFn = dependencies.readClientBuildId ?? readClientBuildId;
  const now = dependencies.now ?? Date.now;
  const rootDir = dependencies.rootDir ?? ROOT_DIR;
  const activeProfile = typeof dependencies.profile === 'string'
    ? dependencies.profile
    : profileFromContext(ctx);

  const bootFingerprint = await fingerprintFn(rootDir);
  const warn = (message) => { try { ctx?.logger?.warn?.(message); } catch { /* best effort */ } };

  let webServer;
  try { webServer = ctx?.webServer; } catch { /* absent */ }
  if (!webServer && typeof ctx?.get === 'function') {
    try { webServer = ctx.get('webServer'); } catch { /* absent */ }
  }
  if (!webServer || typeof webServer.register !== 'function') {
    warn('dsh-harbor: webServer unavailable — hub routes not mounted');
    return () => {};
  }

  const disposers = [];
  const routeState = { mounted: [], failed: [] };
  let scanCache = null; // { at: number, base: object }
  let lastReport = null;

  const currentFreshness = async () => ({
    hubStale: (await fingerprintFn(rootDir)) !== bootFingerprint,
    clientBuildId: await readClientBuildIdFn(rootDir),
  });

  const once = (dispose) => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      try { dispose(); } catch { /* already removed by host */ }
    };
  };

  const guard = (handler, { sameOrigin = false } = {}) => async (req, res) => {
    if (!isLoopbackRequest(req)) {
      return sendJson(res, 403, { ok: false, error: 'loopback only' });
    }
    if (req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: 'GET only' }, { allow: 'GET' });
    }
    if (sameOrigin && !isSameOriginBrowserRequest(req)) {
      return sendJson(res, 403, { ok: false, error: 'same-origin browser request required' });
    }
    try {
      return await handler(req, res);
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: errorMessage(error) });
    }
  };

  const register = (route) => {
    try {
      const dispose = webServer.register(route);
      routeState.mounted.push(route.path);
      if (typeof dispose === 'function') disposers.push(once(dispose));
      return true;
    } catch (error) {
      const message = errorMessage(error);
      routeState.failed.push({ path: route.path, error: message });
      warn('dsh-harbor: route ' + route.path + ' not mounted: ' + message);
      return false;
    }
  };

  register({
    kind: 'exact', path: ROUTE_BASE + '/ping',
    handler: guard((req, res) => {
      const missing = ROUTE_PATHS.filter((path) => !routeState.mounted.includes(path));
      const complete = missing.length === 0 && routeState.failed.length === 0;
      return sendJson(res, complete ? 200 : 503, {
        ok: complete,
        service: 'dsh-harbor',
        routes: {
          expected: ROUTE_PATHS.length,
          mounted: [...routeState.mounted],
          failed: [...routeState.failed],
        },
      });
    }),
  });

  register({
    kind: 'exact', path: ROUTE_BASE + '/report',
    handler: guard(async (req, res) => {
      const url = new URL(req?.url ?? '/', 'http://localhost');
      const force = url.searchParams.get('refresh') === '1';
      try {
        let base;
        if (!force && scanCache && now() - scanCache.at < REPORT_CACHE_TTL_MS) {
          base = scanCache.base;
        } else {
          base = await scanFn();
          scanCache = { at: now(), base };
        }

        // Runtime is deliberately collected for every request, even when the
        // expensive static scan is cached. Fiber lifecycle changes must show
        // up immediately rather than looking alive for another minute.
        const runtime = await collectRuntimeFn(ctx);
        const attribution = attributeFn(runtime, base.plugins, { profile: activeProfile });
        const report = { ...base, runtime, attribution };
        lastReport = report;
        return sendJson(res, 200, { ok: true, report, freshness: await currentFreshness() });
      } catch (error) {
        let freshness = null;
        try { freshness = await currentFreshness(); } catch { /* keep error response JSON */ }
        return sendJson(res, 500, {
          ok: false,
          error: errorMessage(error),
          // A client can keep showing the last valid report while surfacing
          // the error; on first load this is explicitly null, never omitted.
          report: lastReport,
          freshness,
        });
      }
    }, { sameOrigin: true }),
  });

  register({
    kind: 'exact', path: ROUTE_BASE + '/capabilities',
    handler: guard((req, res) => sendJson(res, 200, { ok: true, capabilities: CAPABILITIES })),
  });

  register({
    kind: 'exact', path: ROUTE_BASE + '/updates',
    handler: guard(async (req, res) => {
      // Network only on an explicit panel action. versions.mjs owns its 6h
      // on-disk cache; this route deliberately adds no second cache.
      const base = await scanFn({ snapshot: false });
      const updates = await checkUpstreamFn(base.plugins);
      return sendJson(res, 200, { ok: true, updates });
    }, { sameOrigin: true }),
  });

  if (routeState.failed.length === 0 && routeState.mounted.length === ROUTE_PATHS.length) {
    try { ctx?.logger?.info?.('dsh-harbor hub mounted (ping, report, capabilities, updates)'); } catch {}
  } else {
    warn(`dsh-harbor: hub partially mounted (${routeState.mounted.length}/${ROUTE_PATHS.length} routes)`);
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    scanCache = null;
    lastReport = null;
    for (const dispose of [...disposers].reverse()) dispose();
  };
}

export async function apply(ctx) {
  return mountHub(ctx);
}

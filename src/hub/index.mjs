// DSH plugin hub: the loopback-only HTTP surface the settings panel reads.
// Deliberately thin — every scanning decision lives in ../scan. Zero
// @deepseek-ai/* imports keeps harbor inside the host's single module realm,
// the very failure mode it is built to detect.
//
// Governance data (installed plugins, their capabilities, what changed) is
// sensitive, so every route is loopback-only and refuses anything else with
// 403 — the same pattern dsh-crew and dsh-noema use for their hub APIs.

import { scan, CAPABILITIES, checkUpstream } from '../scan/index.mjs';
import { collectRuntimeSurface, attributeSurface } from '../scan/runtime.mjs';
import { fingerprintSource, readClientBuildId } from './freshness.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-harbor';
// webServer is a hard requirement so apply() runs with the service ready;
// profiles without a web server simply never start this fiber (headless stays
// inert instead of mounting routes nobody can reach).
export const inject = ['webServer'];

const ROUTE_BASE = '/_dsh/dsh-harbor';
// Re-scanning walks every plugin source tree; serve cached results within one
// minute so panel re-renders stay cheap, with ?refresh=1 as the escape hatch.
const REPORT_CACHE_TTL_MS = 60_000;

// The repository root is derived from this module's own URL, never from
// process.cwd(): DSH runs hubs with its own working directory, while the
// plugin sources live where the plugin is installed (file: links point
// straight at a working tree, so freshness reflects that tree).
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------- loopback guards and JSON helper (pattern from dsh-noema) ----------

function isIpv4Loopback(address) {
  const parts = address.split('.');
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function isLoopbackRemoteAddress(address) {
  if (!address) return false;
  const normalized = String(address).toLowerCase().split('%', 1)[0];
  if (normalized === '::1' || isIpv4Loopback(normalized)) return true;
  if (!normalized.startsWith('::ffff:')) return false;
  const mapped = normalized.slice('::ffff:'.length);
  if (isIpv4Loopback(mapped)) return true;
  // IPv4-mapped hex form, e.g. ::ffff:7f00:1.
  const hex = /^([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(mapped);
  return hex !== null && (Number.parseInt(hex[1], 16) >>> 8) === 127;
}

function requestAuthority(req) {
  const host = req?.headers?.host;
  if (typeof host !== 'string') return undefined;
  try {
    const parsed = new URL('http://' + host);
    // Only a bare authority qualifies: paths or credentials mean the header
    // is not an ordinary Host value.
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

/** Reject remote peers and DNS-rebinding Host headers before serving data. */
function isLoopbackRequest(req) {
  if (!isLoopbackRemoteAddress(req?.socket?.remoteAddress)) return false;
  const authority = requestAuthority(req);
  return authority !== undefined && isLoopbackHostname(authority.hostname);
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

// ---------- plugin entry ----------

export async function apply(ctx) {
  // Captured once, before anything else: which scanning source this instance
  // actually loaded into memory at boot. The panel bundle is re-read from
  // disk on every page load, so after an upgrade the two can drift apart —
  // this fingerprint is what /report compares the current disk against.
  const bootFingerprint = await fingerprintSource(ROOT_DIR);

  const warn = (message) => { try { ctx?.logger?.warn?.(message); } catch { /* logging is best-effort */ } };

  // Resolve the web server defensively: a direct property on injected
  // contexts, ctx.get() everywhere else, and a no-op dispose when the host
  // has no webServer at all — a missing optional service must not kill
  // loading.
  let webServer = ctx?.webServer;
  if (!webServer && typeof ctx?.get === 'function') {
    try { webServer = ctx.get('webServer'); } catch { /* absent */ }
  }
  if (!webServer || typeof webServer.register !== 'function') {
    warn('dsh-harbor: webServer unavailable — hub routes not mounted');
    return () => {};
  }

  const disposers = [];
  let reportCache = null; // { at: number, report: object }

  // Computed on every /report request, deliberately OUTSIDE the 60s report
  // cache: the freshness fields are exactly the "code moved on disk" signal,
  // and caching them would delay the restart/reload banners by up to a
  // minute. Hashing a dozen small source files is cheap.
  const currentFreshness = async () => ({
    hubStale: (await fingerprintSource(ROOT_DIR)) !== bootFingerprint,
    clientBuildId: await readClientBuildId(ROOT_DIR),
  });

  // Call a disposer at most once; the host may dispose a route before our
  // own dispose() runs, and double disposal must stay a no-op.
  const once = (dispose) => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      try { dispose(); } catch { /* already removed by the host */ }
    };
  };

  // Every handler: loopback gate, GET method, then JSON errors for anything
  // that slips through — a throwing scan must yield a 500, never a broken
  // socket or a failed request pipeline.
  const guard = (handler) => async (req, res) => {
    if (!isLoopbackRequest(req)) return sendJson(res, 403, { ok: false, error: 'loopback only' });
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET only' }, { allow: 'GET' });
    try {
      return await handler(req, res);
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
    }
  };

  // Duplicate (kind, path) throws on the host (two harbor copies in one
  // profile) — contain each registration so one collision never kills apply.
  const register = (route) => {
    try {
      const dispose = webServer.register(route);
      if (typeof dispose === 'function') disposers.push(once(dispose));
    } catch (err) {
      warn('dsh-harbor: route ' + route.path + ' not mounted: ' + (err?.message ?? err));
    }
  };

  register({ kind: 'exact', path: ROUTE_BASE + '/ping', handler: guard((req, res) => sendJson(res, 200, { ok: true, service: 'dsh-harbor' })) });

  register({
    kind: 'exact', path: ROUTE_BASE + '/report',
    handler: guard(async (req, res) => {
      const url = new URL(req?.url ?? '/', 'http://localhost');
      const force = url.searchParams.get('refresh') === '1';
      if (!force && reportCache && Date.now() - reportCache.at < REPORT_CACHE_TTL_MS) {
        return sendJson(res, 200, { ok: true, report: reportCache.report, freshness: await currentFreshness() });
      }
      // Static scan first, then attach the two runtime layers: what the host
      // actually registered, and which plugin claims each observed name.
      const base = await scan();
      const runtime = await collectRuntimeSurface(ctx);
      const attribution = attributeSurface(runtime, base.plugins);
      const report = { ...base, runtime, attribution };
      reportCache = { at: Date.now(), report };
      return sendJson(res, 200, { ok: true, report, freshness: await currentFreshness() });
    }),
  });

  register({
    kind: 'exact', path: ROUTE_BASE + '/capabilities',
    handler: guard((req, res) => {
      // The fixed capability table drives the panel's labels and descriptions,
      // so reports stay comparable and diffable between scans.
      return sendJson(res, 200, { ok: true, capabilities: CAPABILITIES });
    }),
  });

  register({
    kind: 'exact', path: ROUTE_BASE + '/updates',
    handler: guard(async (req, res) => {
      // Network only on explicit request: the default posture stays offline.
      // Caching is versions.mjs's own on-disk cache (6h TTL); this layer adds none.
      const base = await scan({ snapshot: false });
      const updates = await checkUpstream(base.plugins);
      return sendJson(res, 200, { ok: true, updates });
    }),
  });

  try { ctx?.logger?.info?.('dsh-harbor hub mounted (ping, report, capabilities, updates)'); } catch {}

  return () => {
    reportCache = null;
    for (const d of [...disposers].reverse()) {
      try { d(); } catch { /* already disposed by the host */ }
    }
  };
}

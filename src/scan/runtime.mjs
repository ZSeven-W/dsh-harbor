// Runtime surface collection. Static inspection says what a plugin claims;
// this module asks the live host what is registered in this profile now.
// Everything is duck-typed so harbor does not import a second copy of any
// @deepseek-ai/* package into the host realm.

/**
 * Registry access varies across DSH releases. `keyed` means keys in that
 * property are documented registry identities. Generic `registry` / `store`
 * properties deliberately set it to false: their string values often contain
 * config such as credentials or endpoints and must never become report labels.
 */
const KIND_CONFIG = {
  tool: {
    props: [
      { key: 'tools', trusted: true },
      { key: 'items', trusted: false },
      { key: 'registry', trusted: false },
      { key: 'store', trusted: false },
      { key: 'map', trusted: false },
    ],
    calls: [
      { key: 'schemas', trusted: true },
      { key: 'getTools', trusted: true },
      { key: 'listTools', trusted: true },
      { key: 'list', trusted: false },
      { key: 'getAll', trusted: false },
      { key: 'toJSON', trusted: false },
    ],
    fields: ['name', 'id'],
  },
  provider: {
    props: [
      // Current DSH LlmService stores provider routes in this Map. It is a TS
      // `private`, not a JS #private field, and therefore remains observable.
      { key: 'adapters', trusted: true },
      { key: 'providers', trusted: true },
      { key: 'items', trusted: false },
      { key: 'registry', trusted: false },
      { key: 'store', trusted: false },
      { key: 'map', trusted: false },
    ],
    calls: [
      { key: 'getProviders', trusted: true },
      { key: 'listProviders', trusted: true },
      { key: 'list', trusted: false },
      { key: 'getAll', trusted: false },
      { key: 'toJSON', trusted: false },
    ],
    fields: ['id', 'name'],
  },
  route: {
    // Exact and prefix tables are complementary, so this kind unions every
    // property instead of stopping at the first non-empty one.
    props: [
      { key: 'exact', trusted: true },
      { key: 'prefixes', trusted: true },
      { key: 'routes', trusted: true },
      { key: 'items', trusted: false },
      { key: 'registry', trusted: false },
      { key: 'store', trusted: false },
      { key: 'map', trusted: false },
    ],
    mergeProps: true,
    calls: [
      { key: 'getRoutes', trusted: true },
      { key: 'listRoutes', trusted: true },
      { key: 'list', trusted: false },
      { key: 'getAll', trusted: false },
      { key: 'toJSON', trusted: false },
    ],
    fields: ['path', 'name', 'id'],
  },
};

const SECRET_FIELD = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|oauth[_-]?token|client[_-]?secret|token|secret|password|credential)(?:$|[_-])/i;
const SECRET_VALUE = /^(?:gh[pousr]_|github_pat_|glpat-|xox[baprs]-|sk-(?:proj-|live-|test-)?|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{12,})/i;
const JWT_VALUE = /^eyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}$/;
const PRIVATE_KEY_VALUE = /^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

function secretLikeString(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return SECRET_VALUE.test(text) || JWT_VALUE.test(text) || PRIVATE_KEY_VALUE.test(text)
    || /^bearer\s+\S+/i.test(text);
}

function validName(value, kind) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > 512 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  if (secretLikeString(name)) return null;
  if (kind === 'route') return /^\/[^\s?#]*$/.test(name) ? name : null;
  // A trusted host may legally use short, uppercase, Unicode, or prototype-
  // looking identities. Only values that cannot be registry identities are
  // filtered here; no author-invented charset policy is imposed.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(name)) return null;
  return name;
}

function isRegistryShape(value) {
  return value instanceof Map || value instanceof Set || Array.isArray(value)
    || (value !== null && typeof value === 'object');
}

function ownDataDescriptors(value) {
  if (value === null || typeof value !== 'object') return null;
  try { return Object.getOwnPropertyDescriptors(value); }
  catch { return null; }
}

/** Extract an explicit identity field from a registry entry. */
function explicitName(item, fields, kind) {
  const descriptors = ownDataDescriptors(item);
  if (descriptors === null) return null;
  for (const field of fields) {
    const descriptor = descriptors[field];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) continue;
    const name = validName(descriptor.value, kind);
    if (name) return name;
  }
  return null;
}

/**
 * Generic stores are config-shaped often enough that an `id`/`name` field is
 * not evidence by itself. Accept only full records recognizable as one of the
 * three registry kinds, and reject the whole record if any reachable data
 * value looks secret-bearing. Accessors and excessive nesting fail closed.
 */
function recordContainsSecret(root) {
  const seen = new Set();
  const state = { nodes: 0 };

  const visit = (value, key = '', depth = 0) => {
    state.nodes += 1;
    if (state.nodes > 512 || depth > 8) return true;
    if (typeof value === 'string') {
      return secretLikeString(value) || (SECRET_FIELD.test(key) && value.trim() !== '');
    }
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
    if (typeof value === 'function' || seen.has(value)) return false;
    seen.add(value);

    if (value instanceof Map) {
      let entries;
      try { entries = [...Map.prototype.entries.call(value)]; } catch { return true; }
      if (entries.length > 256) return true;
      return entries.some(([entryKey, entryValue]) =>
        visit(entryKey, '', depth + 1)
        || visit(entryValue, typeof entryKey === 'string' ? entryKey : '', depth + 1));
    }
    if (value instanceof Set) {
      let entries;
      try { entries = [...Set.prototype.values.call(value)]; } catch { return true; }
      if (entries.length > 256) return true;
      return entries.some((entry) => visit(entry, '', depth + 1));
    }

    const descriptors = ownDataDescriptors(value);
    if (descriptors === null || Reflect.ownKeys(descriptors).length > 256) return true;
    for (const property of Reflect.ownKeys(descriptors)) {
      if (property === 'length') continue;
      const descriptor = descriptors[property];
      // Invoking a getter just to build a read-only report is unsafe; an
      // uninspectable generic record is not sufficient runtime evidence.
      if (!Object.hasOwn(descriptor, 'value')) return true;
      if (visit(descriptor.value, typeof property === 'string' ? property : '', depth + 1)) return true;
    }
    return false;
  };

  return visit(root);
}

function genericRecordName(item, fields, kind) {
  const descriptors = ownDataDescriptors(item);
  if (descriptors === null || recordContainsSecret(item)) return null;
  const name = explicitName(item, fields, kind);
  if (name === null) return null;

  const data = (key) => {
    const descriptor = descriptors[key];
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  };
  if (kind === 'tool') {
    return typeof data('description') === 'string'
      && (typeof data('execute') === 'function' || isRegistryShape(data('parameters')))
      ? name : null;
  }
  if (kind === 'provider') {
    const adapter = data('adapter');
    return (adapter !== null && (typeof adapter === 'object' || typeof adapter === 'function'))
      || typeof data('stream') === 'function'
      ? name : null;
  }
  const routeKind = data('kind');
  return typeof data('handler') === 'function'
    && (routeKind === undefined || routeKind === 'exact' || routeKind === 'prefix')
    ? name : null;
}

function safeKeyedEntries(value) {
  if (value instanceof Map) {
    try { return [...Map.prototype.entries.call(value)]; } catch { return []; }
  }
  const descriptors = ownDataDescriptors(value);
  if (descriptors === null) return [];
  const entries = [];
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if (descriptor.enumerable && Object.hasOwn(descriptor, 'value')) entries.push([key, descriptor.value]);
  }
  return entries;
}

/**
 * Normalize a registry without ever treating values of keyed objects as
 * names. Arrays/Sets may legitimately be lists of names; Maps/plain objects
 * carry identity in an explicit field or, for trusted tables only, the key.
 */
function collectNames(value, fields, kind, { trusted = false } = {}) {
  const names = new Set();
  if (Array.isArray(value) || value instanceof Set) {
    let entries;
    try {
      entries = Array.isArray(value)
        ? safeKeyedEntries(value).map((entry) => entry[1])
        : [...Set.prototype.values.call(value)];
    } catch { return []; }
    for (const item of entries) {
      const name = typeof item === 'string'
        ? (trusted ? validName(item, kind) : null)
        : (trusted ? explicitName(item, fields, kind) : genericRecordName(item, fields, kind));
      if (name) names.add(name);
    }
    return [...names].sort();
  }

  const asRecord = trusted
    ? explicitName(value, fields, kind)
    : genericRecordName(value, fields, kind);
  if (asRecord) return [asRecord];

  for (const [key, item] of safeKeyedEntries(value)) {
    // Never emit a string value from a keyed container. Generic config-store
    // values can be credentials or endpoints rather than registry identities.
    const name = trusted
      ? (explicitName(item, fields, kind) ?? validName(String(key), kind))
      : genericRecordName(item, fields, kind);
    if (name) names.add(name);
  }
  return [...names].sort();
}

/**
 * Probe one service. `used=true` also covers a known accessor that returned an
 * empty registry: zero registrations is evidence, not an opaque host.
 */
async function probeRegistry(service, kind) {
  if (service == null) return { names: [], used: false, source: null };
  const config = KIND_CONFIG[kind];
  let sawTrustedProperty = null;
  const merged = new Set();

  for (const descriptor of config.props) {
    let value;
    try { value = service[descriptor.key]; } catch { continue; }
    if (typeof value === 'function' || !isRegistryShape(value)) continue;
    if (descriptor.trusted) sawTrustedProperty ??= descriptor.key;
    const names = collectNames(value, config.fields, kind, {
      trusted: descriptor.trusted,
    });
    if (config.mergeProps) {
      for (const name of names) merged.add(name);
    } else if (names.length) {
      return { names, used: true, source: `property:${descriptor.key}` };
    }
  }
  if (merged.size) return { names: [...merged].sort(), used: true, source: 'properties' };

  for (const descriptor of config.calls) {
    let value;
    try {
      const fn = service[descriptor.key];
      if (typeof fn !== 'function') continue;
      value = fn.call(service);
      if (value && typeof value.then === 'function') value = await value;
    } catch { continue; }
    if (value == null || value === service || !isRegistryShape(value)) continue;
    return {
      names: collectNames(value, config.fields, kind, { trusted: descriptor.trusted }),
      used: true,
      source: `method:${descriptor.key}`,
    };
  }

  // A present, empty known property is a successfully enumerated empty table.
  if (sawTrustedProperty !== null) {
    return { names: [], used: true, source: `property:${sawTrustedProperty}` };
  }

  // Last-resort service-object scan accepts explicit id/name/path fields only.
  // It never trusts keys or bare strings, so service plumbing cannot leak.
  const names = collectNames(service, config.fields, kind, { trusted: false });
  if (names.length) return { names, used: true, source: 'service-fields' };
  return { names: [], used: false, source: null };
}

/** Resolve through ctx.get() first so optional Cordis services need no inject. */
async function resolveService(ctx, name) {
  if (typeof ctx?.get === 'function') {
    try {
      let service = ctx.get(name);
      if (service && typeof service.then === 'function') service = await service;
      return service ?? undefined;
    } catch { return undefined; }
  }
  // Plain duck-typed stand-ins do not have ctx.get().
  try {
    const direct = ctx?.[name];
    if (direct != null) return direct;
  } catch { /* exotic stand-in */ }
  return undefined;
}

function coverageEntry(probe) {
  return { enumerated: probe.used, source: probe.source };
}

/**
 * Read the live tool, provider and route registries. Cordis exposes listener
 * names internally, but not the dispatch mode used at each call site; an
 * event listener therefore cannot honestly be called a runtime waterfall.
 * That limitation is represented in both notes and coverage.
 */
export async function collectRuntimeSurface(ctx) {
  const result = {
    available: false,
    tools: [],
    providers: [],
    routes: [],
    waterfalls: [],
    collectedAt: new Date().toISOString(),
    coverage: {
      tools: { enumerated: false, source: null },
      providers: { enumerated: false, source: null },
      routes: { enumerated: false, source: null },
      waterfalls: { enumerated: false, source: null },
    },
    notes: [],
  };

  const waterfallNote = '宿主未提供可枚举且带 dispatch mode 的 waterfall 注册表，本项运行时证据缺失';

  if (ctx === null || typeof ctx !== 'object') {
    result.notes.push('未提供宿主上下文（ctx），无法采集运行时证据');
    result.notes.push(waterfallNote);
    return result;
  }

  const toolsSvc = await resolveService(ctx, 'tools');
  const llmSvc = await resolveService(ctx, 'llm');
  const webSvc = await resolveService(ctx, 'webServer');
  result.available = toolsSvc != null || llmSvc != null || webSvc != null;

  if (!result.available) {
    result.notes.push('该 ctx 未暴露任何宿主服务（tools / llm / webServer 均不可用），运行时证据不可采集');
    result.notes.push(waterfallNote);
    return result;
  }

  const collect = async (service, kind, missingNote, opaqueNote) => {
    let probe;
    try { probe = await probeRegistry(service, kind); }
    catch { probe = { names: [], used: false, source: null }; }
    return {
      ...probe,
      note: probe.used ? null : (service == null ? missingNote : opaqueNote),
    };
  };

  const tools = await collect(
    toolsSvc, 'tool',
    '该 DSH 版本未暴露工具注册表，本项证据缺失',
    '工具服务存在，但未暴露可枚举的注册表，本项证据缺失',
  );
  result.tools = tools.names;
  result.coverage.tools = coverageEntry(tools);
  if (tools.note) result.notes.push(tools.note);

  const providers = await collect(
    llmSvc, 'provider',
    '该 DSH 版本未暴露 LLM provider 注册表，本项证据缺失',
    'LLM 服务存在，但未暴露可枚举的 provider 列表，本项证据缺失',
  );
  result.providers = providers.names;
  result.coverage.providers = coverageEntry(providers);
  if (providers.note) result.notes.push(providers.note);

  const routes = await collect(
    webSvc, 'route',
    '该 DSH 版本未暴露路由注册表，本项证据缺失',
    'webServer 存在，但未暴露可枚举的路由表，本项证据缺失',
  );
  result.routes = routes.names;
  result.coverage.routes = coverageEntry(routes);
  if (routes.note) result.notes.push(routes.note);

  result.notes.push(waterfallNote);
  return result;
}

function reportInstalledInProfile(report, profile, scoped) {
  if (!scoped) return true;
  // An explicitly requested but unresolved host profile must fail closed. It
  // is safer to leave a runtime name unattributed than assign it to a plugin
  // that exists only in some other profile.
  if (profile === null) return false;
  return Array.isArray(report?.installs)
    && report.installs.some((install) => install?.profile === profile);
}

function claimMatches(kind, key, claims, field) {
  const list = claims?.[field];
  if (!Array.isArray(list)) return false;
  if (kind !== 'route') return list.includes(key);
  return list.some((base) => typeof base === 'string'
    && (key === base || key.startsWith(base.endsWith('/') ? base : `${base}/`)));
}

/**
 * Align runtime observations with static claims from the active host profile.
 * Passing `profile` is explicit so tests and non-host callers never depend on
 * process.cwd() or ambient environment state. Omit it for a deliberate
 * all-profile comparison (the pre-profile-filter behavior); pass null when a
 * host profile was requested but could not be resolved, which fails closed.
 *
 * @param {{tools?: string[], providers?: string[], routes?: string[]}} runtimeSurface
 * @param {Array<object>|{plugins?: Array<object>}} reports
 * @param {{profile?: string|null}} [options]
 */
export function attributeSurface(runtimeSurface, reports, options = {}) {
  const matched = [];
  const unattributed = [];
  const runtime = runtimeSurface ?? {};
  const plugins = Array.isArray(reports) ? reports : (reports?.plugins ?? []);
  const scoped = Object.prototype.hasOwnProperty.call(options, 'profile');
  const profile = typeof options.profile === 'string' && options.profile.trim()
    ? options.profile.trim()
    : null;

  const claimers = plugins
    .filter((p) => p !== null && typeof p === 'object' && reportInstalledInProfile(p, profile, scoped))
    .map((p) => ({ plugin: p.name ?? p.dir ?? '(unknown)', claims: p.claims ?? {} }));

  const kinds = [
    { kind: 'tool', keys: runtime.tools ?? [], field: 'toolNames' },
    { kind: 'provider', keys: runtime.providers ?? [], field: 'providerIds' },
    { kind: 'route', keys: runtime.routes ?? [], field: 'routeBases' },
  ];
  const seen = new Set();

  for (const { kind, keys, field } of kinds) {
    for (const key of new Set(Array.isArray(keys) ? keys : [])) {
      if (typeof key !== 'string') continue;
      let claimed = false;
      for (const { plugin, claims } of claimers) {
        if (!claimMatches(kind, key, claims, field)) continue;
        const id = `${kind}\u0000${key}\u0000${plugin}`;
        if (!seen.has(id)) {
          seen.add(id);
          matched.push({ kind, key, plugin });
        }
        claimed = true;
      }
      if (!claimed) unattributed.push({ kind, key });
    }
  }

  return {
    scope: {
      profile,
      filtered: scoped,
      pluginsConsidered: claimers.length,
    },
    matched,
    unattributed,
  };
}

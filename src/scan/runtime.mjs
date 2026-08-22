// Runtime surface collection. The scanner proves what plugins *claim*
// statically (source patterns, package.json); this module asks the live host
// what is actually registered right now — the only evidence tier a comment
// cannot fake. Nothing here imports @deepseek-ai/* on purpose: harbor is
// loaded into the profile realm, where a second copy of official packages is
// exactly the failure mode it exists to detect. Every probe is duck-typed and
// every failure degrades to an empty list plus a note, because a service that
// is absent or reshaped in some DSH version must never abort plugin loading.

/**
 * Registry access is version-dependent, so each kind gets a list of property
 * names and method names to try, in order. The first probe that yields names
 * wins — later probes would only add duplicates or noise.
 */
const KIND_CONFIG = {
  tool: {
    props: ['tools', 'registry', 'store', 'items', 'map'],
    // `schemas` first: it is the shipped host's public enumeration — one
    // model-facing schema per visible tool, name included.
    calls: ['schemas', 'list', 'getAll', 'getTools', 'listTools', 'toJSON'],
    // Identity fields in preference order: a tool is a record with a name.
    fields: ['name', 'id'],
  },
  provider: {
    props: ['providers', 'registry', 'store', 'items', 'map'],
    calls: ['list', 'getAll', 'getProviders', 'listProviders', 'toJSON'],
    // Providers are usually keyed by id; name is a fallback for ad-hoc adapters.
    fields: ['id', 'name'],
  },
  route: {
    // The shipped WebServer keeps its live tables in enumerable `exact` /
    // `prefixes` Maps of { kind, path, handler } records — probe those first.
    // The two tables are complementary (exact-match and prefix routes live
    // apart), so the route kind merges every prop instead of first-wins.
    props: ['exact', 'prefixes', 'routes', 'registry', 'store', 'items', 'map'],
    mergeProps: true,
    calls: ['list', 'getAll', 'getRoutes', 'listRoutes', 'toJSON'],
    // Routes are registered as { kind, path, handler } records.
    fields: ['path', 'name', 'id'],
  },
};

/** Extract an identity string from one registry entry, or null. */
function pickName(item, fields, keyFallback, allowBareString = true) {
  if (item == null) return null;
  // A bare string is a name in an array-of-names registry, but internal
  // plumbing when the scanned object is a service — callers opt out via
  // allowBareString (probeRegistry step 3 does).
  if (typeof item === 'string') return allowBareString ? (item.trim() || null) : null;
  if (typeof item !== 'object') return null;
  for (const field of fields) {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  // Keyed registries ({ 'tool-name': definition }) carry the identity in the
  // key; only trust it when the caller allows (see probeRegistry step 3).
  if (typeof keyFallback === 'string' && keyFallback && !keyFallback.startsWith('_')) {
    return keyFallback;
  }
  return null;
}

/** Normalize a registry-shaped value into [key, item] pairs. */
function asEntries(value) {
  if (value instanceof Map) return [...value.entries()];
  if (value instanceof Set) return [...value].map((v) => [null, v]);
  if (Array.isArray(value)) return value.map((v) => [null, v]);
  if (value !== null && typeof value === 'object') return Object.entries(value);
  return [];
}

/** Walk one registry value, collecting names via the given identity fields. */
function collectNames(value, fields, keyFallback, allowBareString = true) {
  const names = new Set();
  for (const [key, item] of asEntries(value)) {
    const name = pickName(item, fields, keyFallback ? key : null, allowBareString);
    if (name) names.add(name);
  }
  return [...names].sort();
}

/**
 * Probe a single host service for registered names.
 * @returns {{names: string[], used: boolean}} used=false means "we could not
 *   enumerate this registry at all", which callers turn into a note.
 */
async function probeRegistry(service, kind) {
  if (service == null) return { names: [], used: false };
  const config = KIND_CONFIG[kind];

  // 1. Dedicated registry properties — a Map/array/plain object on the service.
  //    Most kinds stop at the first non-empty prop (props alias each other);
  //    a kind with mergeProps unions them instead, for hosts whose registries
  //    are split across several complementary tables.
  if (config.mergeProps) {
    const merged = new Set();
    for (const key of config.props) {
      let value;
      try { value = service[key]; } catch { continue; }
      if (typeof value === 'function') continue;
      for (const name of collectNames(value, config.fields, true)) merged.add(name);
    }
    if (merged.size) return { names: [...merged].sort(), used: true };
  } else {
    for (const key of config.props) {
      let value;
      try { value = service[key]; } catch { continue; }
      if (typeof value === 'function') continue;
      const names = collectNames(value, config.fields, true);
      if (names.length) return { names, used: true };
    }
  }

  // 2. Callable accessors (sync or async), whatever the version ships.
  for (const key of config.calls) {
    let value;
    try {
      const fn = service[key];
      if (typeof fn !== 'function') continue;
      value = fn.call(service);
      if (value && typeof value.then === 'function') value = await value;
    } catch { continue; }
    if (value == null || value === service) continue;
    const names = collectNames(value, config.fields, true);
    if (names.length) return { names, used: true };
  }

  // 3. The service object itself is the registry. Key fallback and bare
  //    strings are off here so host internals (method names, string plumbing)
  //    cannot leak in as fake names — entries must carry their own identity
  //    fields.
  const names = collectNames(service, config.fields, false, false);
  if (names.length) return { names, used: true };

  return { names: [], used: false };
}

/** Resolve a service from a context: direct property first, then ctx.get(). */
async function resolveService(ctx, name) {
  try {
    const direct = ctx?.[name];
    if (direct != null) return direct;
  } catch { /* property access failed on an exotic context */ }
  if (typeof ctx?.get === 'function') {
    try {
      let service = ctx.get(name);
      if (service && typeof service.then === 'function') service = await service;
      return service ?? undefined;
    } catch { /* service absent on this host */ }
  }
  return undefined;
}

/**
 * Read what the live host has actually registered: tool names, LLM provider
 * ids, and web routes. Every part is optional — a host that exposes none of
 * the registries still gets a well-formed (if empty) result, never a throw.
 * @param {object} ctx the plugin context (or any duck-typed stand-in)
 * @returns {Promise<{available: boolean, tools: string[], providers: string[],
 *   routes: string[], collectedAt: string, notes: string[]}>}
 */
export async function collectRuntimeSurface(ctx) {
  const result = {
    available: false,
    tools: [],
    providers: [],
    routes: [],
    collectedAt: new Date().toISOString(),
    notes: [],
  };

  if (ctx === null || typeof ctx !== 'object') {
    result.notes.push('未提供宿主上下文（ctx），无法采集运行时证据');
    return result;
  }

  const toolsSvc = await resolveService(ctx, 'tools');
  const llmSvc = await resolveService(ctx, 'llm');
  const webSvc = await resolveService(ctx, 'webServer');

  // "available" means the host exposed at least one service worth probing;
  // with none, every registry is evidence-missing and the panel should say so.
  result.available = toolsSvc != null || llmSvc != null || webSvc != null;
  if (!result.available) {
    result.notes.push('该 ctx 未暴露任何宿主服务（tools / llm / webServer 均不可用），运行时证据不可采集');
    return result;
  }

  const collect = async (service, kind, missingNote, opaqueNote) => {
    let probe;
    try {
      probe = await probeRegistry(service, kind);
    } catch {
      probe = { names: [], used: false };
    }
    return {
      names: probe.names,
      note: probe.used ? null : (service == null ? missingNote : opaqueNote),
    };
  };

  const tools = await collect(
    toolsSvc, 'tool',
    '该 DSH 版本未暴露工具注册表，本项证据缺失',
    '工具服务存在，但未暴露可枚举的注册表，本项证据缺失',
  );
  result.tools = tools.names;
  if (tools.note) result.notes.push(tools.note);

  const providers = await collect(
    llmSvc, 'provider',
    '该 DSH 版本未暴露 LLM provider 注册表，本项证据缺失',
    'LLM 服务存在，但未暴露可枚举的 provider 列表，本项证据缺失',
  );
  result.providers = providers.names;
  if (providers.note) result.notes.push(providers.note);

  const routes = await collect(
    webSvc, 'route',
    '该 DSH 版本未暴露路由注册表，本项证据缺失',
    'webServer 存在，但未暴露可枚举的路由表，本项证据缺失',
  );
  result.routes = routes.names;
  if (routes.note) result.notes.push(routes.note);

  return result;
}

/**
 * Align runtime observations with static scan claims: for every tool/provider
 * the host has registered, find which plugin's report claims it. Anything no
 * plugin claims is unattributed — typically an official plugin or a runtime
 * registration the scanner cannot see from source.
 * @param {{tools?: string[], providers?: string[]}} runtimeSurface output of collectRuntimeSurface
 * @param {Array<{name?: string, claims?: {toolNames?: string[], providerIds?: string[]}}>} reports
 *   the plugin reports a scan produced (scan().plugins)
 * @returns {{matched: Array<{kind: 'tool'|'provider', key: string, plugin: string}>,
 *   unattributed: Array<{kind: 'tool'|'provider', key: string}>}}
 */
export function attributeSurface(runtimeSurface, reports) {
  const matched = [];
  const unattributed = [];
  const runtime = runtimeSurface ?? {};
  const plugins = Array.isArray(reports) ? reports : (reports?.plugins ?? []);

  const claimers = plugins
    .filter((p) => p !== null && typeof p === 'object')
    .map((p) => ({ plugin: p.name ?? p.dir ?? '(unknown)', claims: p.claims ?? {} }));

  const kinds = [
    { kind: 'tool', keys: runtime.tools ?? [], field: 'toolNames' },
    { kind: 'provider', keys: runtime.providers ?? [], field: 'providerIds' },
  ];

  // Several report rows can share one plugin name (the same package installed
  // as different versions or link targets). Without dedup each such row pushes
  // an identical matched entry, so the list says the same thing three times.
  // Dedupe on kind+key+plugin; a kind+key claimed by two *different* plugins
  // keeps one entry per owner — a double claim is a conflict the report's own
  // matrix covers, and it is informative here.
  const seen = new Set();

  for (const { kind, keys, field } of kinds) {
    for (const key of keys) {
      let claimed = false;
      for (const { plugin, claims } of claimers) {
        const list = claims[field];
        if (Array.isArray(list) && list.includes(key)) {
          const id = `${kind}\u0000${key}\u0000${plugin}`;
          if (!seen.has(id)) {
            seen.add(id);
            matched.push({ kind, key, plugin });
          }
          claimed = true;
        }
      }
      if (!claimed) unattributed.push({ kind, key });
    }
  }

  return { matched, unattributed };
}

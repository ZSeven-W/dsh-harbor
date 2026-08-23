// The capability table. Everything harbor knows how to recognise lives here as
// data, never as code scattered through the scanner — DSH's API moves with each
// rc, and a table is the only shape that survives that.
//
// Each entry:
//   id        stable identifier, used in reports, snapshots and dsh.capabilities
//   label     { zh, en } display names — neutral wording: what it can do, not
//             whether that is good
//   tier      evidence tier this detector produces:
//             'declared' | 'runtime' | 'static' | 'heuristic'
//   where     'manifest' (package.json / patch file) | 'source' | 'fs'
//   match     for source detectors: { require?, patterns } — `require` gates the
//             file (e.g. an actual child_process import) so a bare word in a
//             comment cannot raise a capability
//   note      why this capability matters, shown in the report's detail view

// ---------------------------------------------------------------------------
// Several patterns below are assembled from string fragments instead of being
// written as regex literals. This is load-bearing, not style: harbor scans its
// own source, and this file is part of that source. A pattern written whole
// spells out the very text it matches (the npm auth-token key, the dotted
// global fetch spellings, the dot-prefixed foreign-config paths), so the
// scanner would match the table against itself and report capabilities that
// exist only on paper. Splitting each spelling across fragment boundaries
// keeps the compiled regex byte-for-byte identical to the original literal
// while the source text no longer contains a matchable form. Do not
// "simplify" these back into literals; the test suite guards that on purpose.

// credential-handling: the npm auth-token key is the first alternative of the
// pattern, and a whole spelling of that key anywhere in this file would match
// the pattern itself. The fragments compile to exactly the original source
// and flags; only the spelling in the source text changed.
const CREDENTIAL_PATTERN = new RegExp(
  ['_auth', 'Token', '|\\bapi[_-]?key\\b|Bearer\\s'].join(''),
  'gi',
);

// network-egress: /\bfetch\s*\(/ only sees a direct call, so a plugin that
// first takes a reference to fetch and then invokes it under its own name is
// invisible to it — harbor's own registry request in versions.mjs does
// exactly that. GLOBAL_FETCH_REF covers taking the reference: it pins on the
// explicit global spellings (globalThis, global, window — each followed by a
// dot and the bare function name), which is the shape of a plain assignment,
// a default parameter, or any other reference. It cannot fire on
// prefetchData(), refetch() or fetcher(: those never carry the dotted global
// qualifier, and the word boundary after the function name keeps a longer
// global-scoped helper out as well.
const GLOBAL_FETCH_REF = new RegExp(['\\b(?:globalThis|global|window)\\.', 'fetch', '\\b'].join(''), 'g');

// DESTRUCTURED_FETCH covers binding fetch straight off an object — with or
// without a rename — as in destructuring assignments and parameters. The
// gates are the braces plus the assignment sign after the closing brace:
// prefetchData() or refetch() have no braces at all, and a property named
// fetch-something has no word boundary after the bare name, so neither can
// match.
const DESTRUCTURED_FETCH = new RegExp(['\\{[^}\\n]*\\bfetch\\b[^}\\n]*\\}\\s*='].join(''), 'g');

const CHILD_PROCESS_METHODS = new Set([
  'spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork',
]);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function addNamedChildProcessBindings(spec, directBindings) {
  const body = spec.match(/\{([\s\S]*)\}/)?.[1];
  if (!body) return;
  for (const rawPart of body.split(',')) {
    const part = rawPart.trim().replace(/^type\s+/, '');
    const match = part.match(/^([A-Za-z_$][\w$]*)(?:(?:\s+as\s+|\s*:\s*)([A-Za-z_$][\w$]*))?$/);
    if (!match || !CHILD_PROCESS_METHODS.has(match[1])) continue;
    directBindings.add(match[2] || match[1]);
  }
}

/**
 * Locate process-launch calls through bindings that provably came from
 * node:child_process. A file-level import gate plus a bare-word regex misses
 * namespace and renamed imports, while accepting an unrelated local function
 * merely because the file imports some other child_process member. Binding
 * extraction keeps both sides precise: `cp.spawn` counts only when `cp` is
 * the imported namespace, and `obj.spawn` never counts by resemblance alone.
 */
function childProcessCallMatches(text) {
  const namespaces = new Set();
  const directBindings = new Set();

  // ESM imports: namespace/default bindings and named aliases. The three
  // shapes are kept separate so a semicolon-less import above the real one
  // cannot be swallowed into a cross-statement `import ... from` match.
  for (const match of text.matchAll(/\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"](?:node:)?child_process['"]/g)) {
    namespaces.add(match[1]);
  }
  for (const match of text.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,\s*(\{[^}]{0,500}\}))?\s+from\s+['"](?:node:)?child_process['"]/g)) {
    namespaces.add(match[1]);
    if (match[2]) addNamedChildProcessBindings(match[2], directBindings);
  }
  for (const match of text.matchAll(/\bimport\s*(\{[^}]{1,500}\})\s*from\s+['"](?:node:)?child_process['"]/g)) {
    addNamedChildProcessBindings(match[1], directBindings);
  }

  const moduleExpr = String.raw`(?:require\(\s*['"](?:node:)?child_process['"]\s*\)|(?:await\s+)?import\(\s*['"](?:node:)?child_process['"]\s*\))`;

  // CommonJS/dynamic-import namespace and destructured bindings.
  const namespaceBinding = new RegExp(
    String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${moduleExpr}(?!\s*\.)`,
    'g',
  );
  for (const match of text.matchAll(namespaceBinding)) namespaces.add(match[1]);

  const destructuredBinding = new RegExp(
    String.raw`\b(?:const|let|var)\s*\{([^}]{1,500})\}\s*=\s*${moduleExpr}`,
    'g',
  );
  for (const match of text.matchAll(destructuredBinding)) {
    addNamedChildProcessBindings(`{${match[1]}}`, directBindings);
  }

  // `const launch = require('node:child_process').spawn`.
  const memberBinding = new RegExp(
    String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${moduleExpr}\s*\.\s*([A-Za-z_$][\w$]*)`,
    'g',
  );
  for (const match of text.matchAll(memberBinding)) {
    if (CHILD_PROCESS_METHODS.has(match[2])) directBindings.add(match[1]);
  }

  // TypeScript's `import cp = require('node:child_process')` form.
  for (const match of text.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g)) {
    namespaces.add(match[1]);
  }

  // Aliases taken from a proven namespace remain proven bindings.
  for (const namespace of namespaces) {
    const escaped = escapeRegExp(namespace);
    const memberAlias = new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*${escaped}\s*\.\s*([A-Za-z_$][\w$]*)`,
      'g',
    );
    for (const match of text.matchAll(memberAlias)) {
      if (CHILD_PROCESS_METHODS.has(match[2])) directBindings.add(match[1]);
    }
    const objectAlias = new RegExp(
      String.raw`\b(?:const|let|var)\s*\{([^}]{1,500})\}\s*=\s*${escaped}\b`,
      'g',
    );
    for (const match of text.matchAll(objectAlias)) {
      addNamedChildProcessBindings(`{${match[1]}}`, directBindings);
    }
  }

  const matches = [];
  const seen = new Set();
  const addCalls = (pattern) => {
    for (const match of text.matchAll(pattern)) {
      if (seen.has(match.index)) continue;
      seen.add(match.index);
      matches.push(match);
    }
  };

  for (const binding of directBindings) {
    addCalls(new RegExp(String.raw`(?<![.\w$])${escapeRegExp(binding)}\s*\(`, 'g'));
  }
  for (const namespace of namespaces) {
    addCalls(new RegExp(
      String.raw`(?<![\w$])${escapeRegExp(namespace)}\s*(?:\?\.|\.)\s*(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(`,
      'g',
    ));
  }
  return matches.sort((a, b) => a.index - b.index);
}

export const CAPABILITIES = [
  {
    id: 'client-injection',
    label: { zh: '客户端注入', en: 'Client injection' },
    tier: 'declared',
    where: 'manifest',
    note: '向 DSH Web UI 注入浏览器端模块，可访问页面内的一切。',
  },
  {
    id: 'realm-risk',
    label: { zh: 'realm 风险（依赖声明）', en: 'Realm risk (declared deps)' },
    tier: 'declared',
    where: 'manifest',
    note: '把 @deepseek-ai/* 写进 dependencies 而非 peerDependencies，安装时可能拉入副本。',
  },
  {
    id: 'realm-copy',
    label: { zh: 'realm 副本（磁盘实锤）', en: 'Realm copy (on disk)' },
    tier: 'declared',
    where: 'fs',
    note: '插件目录下存在自带的 @deepseek-ai/* —— Symbol 身份分裂的直接成因。',
  },
  {
    id: 'global-hook',
    label: { zh: '全局钩子', en: 'Global hook' },
    tier: 'static',
    where: 'source',
    match: {
      patterns: [/\bctx\.on\(\s*['"]((?:agent|session|llm)\/[\w/-]+)['"]/g],
    },
    note: '在 host 级别挂载瀑布，可读取甚至改写所有 agent 的消息。仅消息路径计入；theme/change、locale/change 等 UI 事件不算。',
  },
  {
    id: 'llm-adapter',
    label: { zh: 'LLM 拦截', en: 'LLM adapter' },
    tier: 'static',
    where: 'source',
    match: { patterns: [/registerAdapter\s*\(\s*\[([^\]]*)\]/g] },
    note: '注册 provider，会话选中后全部模型流量经其转发。',
  },
  {
    id: 'subprocess',
    label: { zh: '子进程', en: 'Subprocess' },
    tier: 'static',
    where: 'source',
    match: {
      require: /from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/,
      // (?<![.\w]) keeps `hub.spawn(...)` and similar method calls out: they are
      // ordinary calls on someone else's object, not a process launch.
      patterns: [/(?<![.\w])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/g],
    },
    note: '起本机进程，权力等同于用户自己的 shell。',
  },
  {
    id: 'network-egress',
    label: { zh: '网络出站', en: 'Network egress' },
    tier: 'static',
    where: 'source',
    match: {
      patterns: [/\bfetch\s*\(/g, /https?\.request\s*\(/g, GLOBAL_FETCH_REF, DESTRUCTURED_FETCH],
    },
    note: '主动向外发起请求；报告同时列出源码中出现的主机名。',
  },
  {
    id: 'web-routes',
    label: { zh: 'Web 路由', en: 'Web routes' },
    tier: 'static',
    where: 'source',
    match: { patterns: [/webServer\.register\s*\(/g] },
    note: '在 DSH 的 Web 服务上挂载路由（通常限回环）。',
  },
  {
    id: 'tool-registration',
    label: { zh: '注册工具', en: 'Tool registration' },
    tier: 'heuristic',
    where: 'source',
    note: '向模型暴露工具。工具名同时进入冲突矩阵。',
  },
  {
    id: 'mcp-server',
    label: { zh: 'MCP 对外服务', en: 'MCP server' },
    tier: 'static',
    where: 'source',
    match: { patterns: [/@modelcontextprotocol\/sdk/g] },
    note: '对 DSH 之外的宿主（Claude Code、Codex 等）提供 MCP 服务。',
  },
  {
    id: 'foreign-config',
    label: { zh: '跨工具足迹', en: 'Foreign config' },
    tier: 'static',
    where: 'source',
    match: { patterns: [/['"`][^'"`\n]*\.(?:claude|codex|gemini|npmrc)[^'"`\n]*['"`]/g] },
    // The note avoids the dot-prefixed path spellings this entry's pattern
    // looks for: written whole, they would match this very string (harbor
    // scans its own source) and the table would cite itself as evidence.
    note: '读写其它软件的配置（Claude、Codex 等的用户目录、npmrc）。卸载残留也从这里查。',
  },
  {
    id: 'credential-handling',
    label: { zh: '凭据经手', en: 'Credential handling' },
    tier: 'heuristic',
    where: 'source',
    match: { patterns: [CREDENTIAL_PATTERN] },
    note: '代码中出现凭据相关处理；是否合理需看上下文。',
  },
  {
    id: 'env-read',
    label: { zh: '读环境变量', en: 'Environment reads' },
    tier: 'static',
    where: 'source',
    match: { patterns: [/process\.env\.([A-Z][A-Z0-9_]{2,})/g] },
    note: '读取的变量名会在报告中列出。',
  },
];

/** Registry surfaces that must not be claimed twice across plugins. */
export const CLASH_KINDS = ['tool-name', 'route-base', 'provider-id', 'client-module-id', 'settings-slot'];

/** Hook events whose ordering changes the outcome; UI events are excluded on
 *  purpose — treating them as conflicts made every plugin collide in the
 *  prototype run. */
export const ORDER_SENSITIVE_EVENTS = [/^agent\//, /^session\//, /^llm\//];

export const byId = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c]));

/**
 * Return source matches for one capability. Kept here beside the detector
 * table so binding-aware detectors do not leak special cases into the report
 * builder. The returned values are ordinary RegExp match arrays and preserve
 * the scanner's existing evidence contract (`index`, captures, matched text).
 */
export function capabilityMatches(capability, text) {
  if (capability.id === 'subprocess') return childProcessCallMatches(text);
  if (capability.match?.require) {
    const gate = new RegExp(capability.match.require.source, capability.match.require.flags);
    if (!gate.test(text)) return [];
  }
  const matches = [];
  for (const pattern of capability.match?.patterns ?? []) {
    matches.push(...text.matchAll(new RegExp(pattern.source, pattern.flags)));
  }
  return matches.sort((a, b) => a.index - b.index);
}

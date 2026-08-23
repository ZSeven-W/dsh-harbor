// Browser half of dsh-harbor: the settings page. A read-only mirror —
// capability inventory with evidence, cross-plugin conflicts, and the diff
// since the last scan. Talks only to the plugin's own loopback routes.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

export const inject = ['slots', 'locale'];

// Injected by scripts/build-client.mjs as a factory-scope var in
// lib/client.js: the build id of THIS running bundle. Absent when the panel
// runs outside that pipeline (e.g. an unpackaged dev load), in which case the
// staleness banner simply stays silent.
declare const CLIENT_BUILD_ID: string | undefined;

const API = '/_dsh/dsh-harbor';

// Limit the number of claim items displayed to avoid card bloat.
// Lists like tool names, routes, etc. are truncated to MAX_CLAIM_ITEMS with a "+N" indicator.
const MAX_CLAIM_ITEMS = 8;

const COPY = {
  zh: {
    label: 'DSH Harbor',
    title: 'DSH Harbor',
    intro: '已安装第三方插件的能力清单：源码检出项附 file:line，manifest、文件系统与运行时事实明确标注来源；跨插件冲突与扫描变化一并列出。只读镜像——陈述事实，不下结论。',
    rescan: '重新扫描',
    scanning: '扫描中…',
    loading: '加载中…',
    conflicts: '冲突',
    clash: '撞车',
    orderSensitive: '顺序敏感',
    versions: '版本',
    versionsAgree: '可比较的 registry 安装未发现版本分歧；link/file 本地安装不参与此结论。',
    localBaseline: (newest: string) => `本机已安装最高版本 ${newest}`,
    local: '本地',
    localFile: '本地 file',
    checkUpdates: '检查上游更新',
    checkingUpdates: '检查中…',
    checkUpdatesHint: '这是本页唯一会离开你这台机器的动作；registry 结果最多缓存 6 小时',
    upToDate: '已是最新',
    aheadOfRegistry: '本机比上游新',
    localInstall: '本地安装，无上游可比',
    lookupFailed: '查询失败',
    checkedAt: (t: string, hosts: string) => `请求完成于 ${t}${hosts ? ` · ${hosts}` : ''}`,
    cached: '缓存',
    noUpdateResults: '没有可检查的安装项。',
    changes: '变化',
    firstRun: '首次扫描，已建立基线。',
    noChanges: '自上次扫描以来无变化。',
    since: (t: string) => `自上次扫描（${t}）:`,
    plugins: '插件',
    noPlugins: '未检测到第三方插件。',
    noMatches: '没有符合筛选条件的插件。',
    filterAll: '全部插件',
    filterDrift: '声明不一致',
    filterNotDeclared: '未声明',
    filterMatch: '声明一致',
    installs: '安装位置',
    claims: '工具 · 路由 · Provider · 客户端模块',
    tools: '工具', routes: '路由', providers: 'Provider', clientModules: '客户端模块', hooks: '消息钩子',
    runtime: '运行时证据',
    runtimeAvailable: '宿主注册表可探测',
    runtimeUnavailable: '宿主注册表不可探测',
    runtimeUnknown: '宿主注册表状态未知',
    runtimeLegacy: '当前 Hub 未返回运行时证据；其余静态报告仍可正常查看。',
    runtimeCollectedAt: (t: string) => `采集于 ${t}`,
    runtimeEmpty: '未枚举到条目',
    attribution: '运行时归属',
    attributed: '已归属',
    unattributed: '未归属',
    attributionMissing: '当前 Hub 未返回归属结果。',
    runtimeNotes: '备注',
    runtimeKinds: { tool: '工具', provider: 'Provider', route: '路由' },
    caps: '能力',
    noCaps: '未检出能力。',
    bundled: '结论基于产物推断',
    coverageSkipped: (n: number, detail: string) => `扫描覆盖缺口：跳过 ${n} 个文件${detail ? `（${detail}）` : ''}`,
    coverageReasons: { nonRegular: '非普通文件', oversize: '超限', unreadable: '不可读' },
    recNotDeclared: '未声明 dsh.capabilities',
    recMatch: '声明与检出一致',
    recUnused: (list: string) => `（声明宽于实际：${list}）`,
    recDrift: '声明与检出不一致',
    recUndeclared: (list: string) => `检出未声明：${list}`,
    recUnknown: (list: string) => `未知 id：${list}`,
    evidenceOmitted: (n: number) => `…另有 ${n} 处`,
    noEvidence: '该项无 file:line 证据（来自声明或目录检查）。',
    scannedAt: (t: string, dir: string) => `扫描于 ${t} · ${dir}`,
    tier: { declared: '声明', runtime: '运行时', static: '源码', heuristic: '启发式' },
    kind: {
      'tool-name': '工具名',
      'route-base': '路由前缀',
      'provider-id': 'Provider ID',
      'client-module-id': '客户端模块 ID',
      'order-sensitive': '顺序敏感',
    },
    kindNotes: {
      'tool-name': '多个插件注册同名工具，后装载者覆盖先装载者，模型只会看到其中一个。',
      'route-base': '多个插件声明同一路由前缀，后注册者抢占该路径，先注册者静默失效。',
      'provider-id': '多个插件注册同一 provider id，会话选中后流量只会经过其中一个适配器。',
      'client-module-id': '多个插件注入同一客户端模块 id，页面加载时后者覆盖前者。',
      'order-sensitive': '多个插件挂载同一消息路径事件，加载顺序决定谁先改写消息，行为随安装顺序变化。',
    },
    changeTypes: {
      added: '新增', removed: '移除', version: '版本变更',
      'profile-move': '制品变更',
      'capability-added': '新增能力', 'capability-removed': '移除能力',
      'claims-changed': 'claims 变更',
    },
    staleHub: '本 DSH 实例还在跑旧版插件，缺少该接口 —— 重启 DSH 后再试',
    emptyResponse: (path: string, status: number) => `${path} → HTTP ${status}，响应为空`,
    badJson: (path: string, body: string) => `${path} → 非 JSON 响应: ${body}`,
    httpError: (path: string, status: number, detail: string) => `${path} → HTTP ${status}${detail ? `：${detail}` : ''}`,
    operationFailed: (path: string, detail: string) => `${path} 请求失败${detail ? `：${detail}` : ''}`,
    missingReport: '/report 返回成功，但缺少 report 数据',
    missingUpdates: '/updates 返回成功，但缺少 updates 数据',
    bannerHubStale: 'harbor 的扫描代码已更新，但运行中的 DSH 仍在使用启动时载入的旧版本。请重启 DSH，否则本页显示的结论可能不完整。',
    bannerPanelStale: '本页面用的是旧版界面代码，请刷新页面。',
  },
  en: {
    label: 'DSH Harbor',
    title: 'DSH Harbor',
    intro: 'An inventory of installed third-party plugins: source findings carry file:line evidence, while manifest, filesystem, and runtime facts label their origin; conflicts and scan changes are included. Read-only: facts, never verdicts.',
    rescan: 'Rescan',
    scanning: 'Scanning…',
    loading: 'Loading…',
    conflicts: 'Conflicts',
    clash: 'clash',
    orderSensitive: 'order-sensitive',
    versions: 'Versions',
    versionsAgree: 'No drift found among comparable registry installs; local link/file installs are not part of this conclusion.',
    localBaseline: (newest: string) => `Highest installed version ${newest}`,
    local: 'local',
    localFile: 'local file',
    checkUpdates: 'Check for updates',
    checkingUpdates: 'Checking…',
    checkUpdatesHint: 'The only action on this page that leaves your machine; registry results are cached for up to 6 hours',
    upToDate: 'up to date',
    aheadOfRegistry: 'ahead of registry',
    localInstall: 'local install, no upstream',
    lookupFailed: 'lookup failed',
    checkedAt: (t: string, hosts: string) => `Request completed ${t}${hosts ? ` · ${hosts}` : ''}`,
    cached: 'cached',
    noUpdateResults: 'No comparable installs to check.',
    changes: 'Changes',
    firstRun: 'First scan — baseline established.',
    noChanges: 'Nothing changed since the last scan.',
    since: (t: string) => `Since last scan (${t}):`,
    plugins: 'Plugins',
    noPlugins: 'No third-party plugins detected.',
    noMatches: 'No plugins match the filter.',
    filterAll: 'All plugins',
    filterDrift: 'Drifting declarations',
    filterNotDeclared: 'Not declared',
    filterMatch: 'In sync',
    installs: 'Installed at',
    claims: 'Tools · routes · providers · client modules',
    tools: 'Tools', routes: 'Routes', providers: 'Providers', clientModules: 'Client modules', hooks: 'Message hooks',
    runtime: 'Runtime evidence',
    runtimeAvailable: 'host registries discoverable',
    runtimeUnavailable: 'host registries not discoverable',
    runtimeUnknown: 'host registry status unknown',
    runtimeLegacy: 'This hub did not return runtime evidence; the rest of the static report remains available.',
    runtimeCollectedAt: (t: string) => `Collected ${t}`,
    runtimeEmpty: 'No entries enumerated',
    attribution: 'Runtime attribution',
    attributed: 'Attributed',
    unattributed: 'Unattributed',
    attributionMissing: 'This hub did not return attribution results.',
    runtimeNotes: 'Notes',
    runtimeKinds: { tool: 'Tool', provider: 'Provider', route: 'Route' },
    caps: 'Capabilities',
    noCaps: 'No capabilities detected.',
    bundled: 'Conclusions inferred from build output',
    coverageSkipped: (n: number, detail: string) => `Coverage gap: skipped ${n} file${n === 1 ? '' : 's'}${detail ? ` (${detail})` : ''}`,
    coverageReasons: { nonRegular: 'non-regular', oversize: 'oversize', unreadable: 'unreadable' },
    recNotDeclared: 'no dsh.capabilities declared',
    recMatch: 'declaration matches detection',
    recUnused: (list: string) => ` (declared but unused: ${list})`,
    recDrift: 'declaration drifts from detection',
    recUndeclared: (list: string) => `Detected but undeclared: ${list}`,
    recUnknown: (list: string) => `Unknown ids: ${list}`,
    evidenceOmitted: (n: number) => `…${n} more`,
    noEvidence: 'No file:line evidence for this item (manifest / filesystem finding).',
    scannedAt: (t: string, dir: string) => `Scanned ${t} · ${dir}`,
    tier: { declared: 'declared', runtime: 'runtime', static: 'static', heuristic: 'heuristic' },
    kind: {
      'tool-name': 'tool name',
      'route-base': 'route prefix',
      'provider-id': 'provider id',
      'client-module-id': 'client module id',
      'order-sensitive': 'order-sensitive',
    },
    kindNotes: {
      'tool-name': 'Several plugins register the same tool name; the later loader wins and the model only ever sees one of them.',
      'route-base': 'Several plugins declare the same route prefix; the later registration takes the path and the earlier one silently stops working.',
      'provider-id': 'Several plugins register the same provider id; once selected in a session, traffic goes through only one adapter.',
      'client-module-id': 'Several plugins inject the same client module id; on page load the later one overwrites the earlier one.',
      'order-sensitive': 'Several plugins hook the same message-path event; load order decides who rewrites messages first, so behaviour depends on install order.',
    },
    changeTypes: {
      added: 'added', removed: 'removed', version: 'version',
      'profile-move': 'artifact changed',
      'capability-added': 'capability added', 'capability-removed': 'capability removed',
      'claims-changed': 'claims changed',
    },
    staleHub: 'This DSH instance is still running an older build of the plugin and lacks this route — restart DSH and retry',
    emptyResponse: (path: string, status: number) => `${path} → HTTP ${status}, empty response`,
    badJson: (path: string, body: string) => `${path} → non-JSON response: ${body}`,
    httpError: (path: string, status: number, detail: string) => `${path} → HTTP ${status}${detail ? `: ${detail}` : ''}`,
    operationFailed: (path: string, detail: string) => `${path} request failed${detail ? `: ${detail}` : ''}`,
    missingReport: '/report succeeded without report data',
    missingUpdates: '/updates succeeded without updates data',
    bannerHubStale: "harbor's scanner has been updated, but the running DSH still uses the copy it loaded at boot. Restart DSH — until then this page may be quietly incomplete.",
    bannerPanelStale: 'This page is running an older build of the panel. Reload the page.',
  },
};

const S = {
  // Margins are tuned against the page container's 8px flex gap: the gap alone
  // sits below each heading, the margin only adds separation above it.
  section: { margin: '8px 0 -2px', fontSize: 13, fontWeight: 600 as const, opacity: 0.9 },
  // Small muted group label, matching the host's Agent-preset page (内置 / 自定义).
  group: { margin: '4px 0 -3px', fontSize: 12, opacity: 0.55 },
  // Card with a title + description header above its fields.
  block: { border: '1px solid rgba(128,128,128,0.22)', borderRadius: 10, padding: '11px 14px 13px', display: 'flex', flexDirection: 'column' as const, gap: 10 },
  blockGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 14px', alignItems: 'end' as const },
  btn: { padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12.5 },
  input: { padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', fontSize: 12.5 },
  chip: (on: boolean) => ({ fontSize: 11.5, padding: '1px 8px', borderRadius: 99, border: '1px solid', borderColor: on ? 'rgba(63,185,80,0.5)' : 'rgba(128,128,128,0.35)', color: on ? '#3fb950' : 'inherit', opacity: on ? 1 : 0.55 }),
  mono: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, fontVariantNumeric: 'tabular-nums' as const },
};

// Badge depth encodes evidence tier: the stronger the tier, the more solid the
// badge. Neutral blue-gray — depth is confidence, not danger.
const TIER_STYLE: Record<string, any> = {
  declared: { background: 'rgba(74,158,255,0.20)', borderColor: 'rgba(74,158,255,0.60)' },
  runtime: { background: 'rgba(74,158,255,0.14)', borderColor: 'rgba(74,158,255,0.45)' },
  static: { background: 'rgba(74,158,255,0.09)', borderColor: 'rgba(74,158,255,0.32)' },
  heuristic: { background: 'rgba(128,128,128,0.08)', borderColor: 'rgba(128,128,128,0.28)' },
};

// The two accent colours this page is allowed: clash conflicts and drifting
// declarations. Everything else stays neutral.
const CLASH = '#f85149';
const DRIFT = '#d29922';

// Upstream-check results render grouped by status; "behind" (an update exists)
// is the most useful thing to see, so it sorts to the front.
const UPDATE_STATUS_ORDER = ['behind', 'current', 'ahead', 'local', 'unknown'];

function CustomSelect({ value, options, onChange, minWidth }: {
  value: string; options: Array<{ value: string; label?: string }>;
  onChange: (v: string) => void; minWidth?: number;
}) {
  const [open, setOpen] = useState<{ left: number; top: number; bottom: number; width: number; up: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const t = setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (<>
    <button type="button"
      style={{ ...S.input, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', minWidth: minWidth ?? 92, width: '100%', boxSizing: 'border-box' as const, justifyContent: 'space-between' }}
      onClick={(e: any) => {
        const r = e.currentTarget.getBoundingClientRect();
        const up = window.innerHeight - r.bottom < 240;
        setOpen({ left: r.left, top: r.bottom + 4, bottom: window.innerHeight - r.top + 4, width: Math.max(r.width, 130), up });
      }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current?.label ?? value}</span>
      <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
    </button>
    {open && createPortal(
      <div
        style={{
          position: 'fixed', left: open.left, ...(open.up ? { bottom: open.bottom } : { top: open.top }),
          minWidth: open.width, zIndex: 9999, background: 'Canvas', color: 'CanvasText',
          border: '1px solid rgba(128,128,128,0.3)', borderRadius: 8,
          boxShadow: '0 8px 28px rgba(0,0,0,0.22)', padding: 4, maxHeight: 240, overflowY: 'auto',
        }}
        onMouseDown={(e: any) => e.stopPropagation()}>
        {options.map((o) => (
          <div key={o.value}
            onClick={() => { onChange(o.value); setOpen(null); }}
            style={{
              padding: '5px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 12.5, whiteSpace: 'nowrap',
              background: o.value === value ? 'rgba(128,128,128,0.16)' : 'transparent',
              display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center',
            }}
            onMouseEnter={(e: any) => { e.currentTarget.style.background = 'rgba(128,128,128,0.24)'; }}
            onMouseLeave={(e: any) => { e.currentTarget.style.background = o.value === value ? 'rgba(128,128,128,0.16)' : 'transparent'; }}>
            <span>{o.label ?? o.value}</span>{o.value === value && <span style={{ opacity: 0.6, fontSize: 11 }}>✓</span>}
          </div>
        ))}
      </div>, document.body)}
  </>);
}

function fmtTime(iso?: string | null): string {
  if (!iso) return '?';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * Change details are rendered server-side in zh (e.g. "新增能力：客户端注入").
 * In the en UI, swap the capability labels via the fetched table and strip the
 * zh prefixes — the change-type label already carries the meaning.
 */
function localizeDetail(detail: string, type: string, zh: boolean, caps: any[] | null) {
  if (zh || !detail) return detail;
  let d = detail;
  for (const c of caps ?? []) {
    const zhLabel = c?.label?.zh;
    if (zhLabel) d = d.split(zhLabel).join(c.label.en);
  }
  return d
    .replace(/新增能力：/g, '').replace(/移除能力：/g, '').replace(/claims 变更：/g, '')
    .replace(/：制品变更（版本 ([^)]+)）/g, ': artifact changed (v$1)')
    .replace(/版本 /g, 'v').replace(/工具 /g, 'tool ').replace(/路由 /g, 'route ')
    .replace(/、/g, ', ').replace(/，/g, ', ');
}

const RUNTIME_NOTE_EN: Record<string, string> = {
  '未提供宿主上下文（ctx），无法采集运行时证据': 'No host context (ctx) was provided, so runtime evidence cannot be collected.',
  '该 ctx 未暴露任何宿主服务（tools / llm / webServer 均不可用），运行时证据不可采集': 'This ctx exposes no host services (tools / llm / webServer), so runtime evidence cannot be collected.',
  '该 DSH 版本未暴露工具注册表，本项证据缺失': 'This DSH version does not expose the tool registry; evidence is unavailable for this item.',
  '工具服务存在，但未暴露可枚举的注册表，本项证据缺失': 'The tool service exists but exposes no enumerable registry; evidence is unavailable for this item.',
  '该 DSH 版本未暴露 LLM provider 注册表，本项证据缺失': 'This DSH version does not expose the LLM provider registry; evidence is unavailable for this item.',
  'LLM 服务存在，但未暴露可枚举的 provider 列表，本项证据缺失': 'The LLM service exists but exposes no enumerable provider list; evidence is unavailable for this item.',
  '该 DSH 版本未暴露路由注册表，本项证据缺失': 'This DSH version does not expose the route registry; evidence is unavailable for this item.',
  'webServer 存在，但未暴露可枚举的路由表，本项证据缺失': 'webServer exists but exposes no enumerable route table; evidence is unavailable for this item.',
  '宿主未提供可枚举且带 dispatch mode 的 waterfall 注册表，本项运行时证据缺失': 'The host exposes no enumerable waterfall registry with dispatch modes; runtime evidence is unavailable for this item.',
};

function localizeRuntimeNote(note: string, zh: boolean): string {
  return zh ? note : (RUNTIME_NOTE_EN[note] ?? note);
}

function HarborPanel({ ctx }: { ctx: any }) {
  const locale = useSyncExternalStore(
    (notify: () => void) => ctx.on('locale/change', notify),
    () => ctx.locale.getLocale().active,
    () => ctx.locale.getLocale().active,
  );
  const zh = locale === 'zh';
  const copy = COPY[zh ? 'zh' : 'en'];

  const [report, setReport] = useState<any>(null);
  // Freshness comes back with the report but drives its own banners; absent
  // when the running hub predates the field — old hubs must render fine.
  const [freshness, setFreshness] = useState<any>(null);
  const [caps, setCaps] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  // Upstream-check state is kept apart from `notice` so a failed request here
  // cannot blank the scan's own error message.
  const [updates, setUpdates] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [updateError, setUpdateError] = useState('');
  // Sequence numbers make superseded async requests inert. In particular, a
  // registry check that finishes after Rescan must not repopulate old results
  // under the new report.
  const reportRequestId = useRef(0);
  const updatesRequestId = useRef(0);
  // One open evidence pane at a time, keyed by "pluginIdentity\u0000capId".
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  /**
   * The panel is served from disk on every load, but the hub's routes are
   * registered at instance boot — after an upgrade the new UI can call a route
   * the running instance does not have yet, which answers 404/405 with an empty
   * body. Report that as "restart DSH" instead of a JSON parse error.
   */
  const readJson = useCallback(async (res: Response, path: string) => {
    const text = await res.text();
    if (text === '') {
      throw new Error(res.status === 404 || res.status === 405
        ? `${copy.staleHub}（${path} → HTTP ${res.status}）`
        : copy.emptyResponse(path, res.status));
    }
    let value: any;
    try { value = JSON.parse(text); } catch { throw new Error(copy.badJson(path, text.slice(0, 160))); }
    if (!res.ok) {
      const detail = typeof value?.error === 'string' ? value.error : '';
      throw new Error(copy.httpError(path, res.status, detail));
    }
    return value;
  }, [copy]);
  /** Every request carries the active locale: the panel is the authority on it
   * (DSH's setting may be unset), and the hub localizes its own strings from it. */
  const withLang = useCallback((path: string) => `${API}${path}${path.includes('?') ? '&' : '?'}lang=${locale === 'zh' ? 'zh' : 'en'}`, [locale]);
  const get = useCallback(async (path: string) => readJson(await fetch(withLang(path), { cache: 'no-store' }), path), [readJson, withLang]);

  const refresh = useCallback(async (force: boolean) => {
    const requestId = ++reportRequestId.current;
    // A new report invalidates any in-flight update comparison because its
    // result was computed from the previous install inventory.
    ++updatesRequestId.current;
    setBusy(true);
    setChecking(false);
    setNotice('');
    // A requested scan replaces the visible report. Keeping the previous
    // report under a failed refresh makes stale facts look like a successful
    // new scan, so clear it (and its derived update results) up front.
    setReport(null);
    setFreshness(null);
    setExpanded(null);
    setUpdates(null);
    setUpdateError('');
    // The report is the page; the capabilities table only decorates it. Fetch
    // them independently so a hub that lacks one route cannot blank the other.
    try {
      const r = await get(force ? '/report?refresh=1' : '/report');
      if (!r?.ok) throw new Error(copy.operationFailed('/report', String(r?.error ?? 'ok=false')));
      if (r.report == null) throw new Error(copy.missingReport);
      if (requestId !== reportRequestId.current) return;
      setReport(r.report);
      setFreshness(r.freshness ?? null);
    } catch (e: any) {
      if (requestId === reportRequestId.current) setNotice(String(e?.message ?? e));
    }
    try {
      const c = await get('/capabilities');
      if (requestId === reportRequestId.current && c.ok) setCaps(c.capabilities ?? []);
    } catch { /* labels fall back to raw ids */ }
    if (requestId === reportRequestId.current) setBusy(false);
  }, [copy, get]);

  /** The one networked action on this page. Runs only on an explicit click —
   * never from useEffect — and reuses get/withLang so it carries the locale.
   * If the running instance predates this route, readJson reports "restart DSH". */
  const checkUpdates = useCallback(async () => {
    const requestId = ++updatesRequestId.current;
    setChecking(true);
    setUpdateError('');
    setUpdates(null);
    try {
      const r = await get('/updates');
      if (!r?.ok) throw new Error(copy.operationFailed('/updates', String(r?.error ?? 'ok=false')));
      if (r.updates == null) throw new Error(copy.missingUpdates);
      if (requestId === updatesRequestId.current) setUpdates(r.updates);
    } catch (e: any) {
      if (requestId === updatesRequestId.current) setUpdateError(String(e?.message ?? e));
    }
    if (requestId === updatesRequestId.current) setChecking(false);
  }, [copy, get]);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  /** Capability labels, notes and tiers come from the hub's /capabilities
   * table; fall back to the raw id when the instance predates that route. */
  const capById = (id: string) => caps?.find((c: any) => c.id === id);
  const capLabel = (id: string) => capById(id)?.label?.[zh ? 'zh' : 'en'] ?? id;
  const capNote = (id: string) => capById(id)?.note ?? '';

  const recChip = (p: any) => {
    const rec = p.reconciliation ?? { status: 'not-declared' };
    if (rec.status === 'not-declared') {
      return <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 99, border: '1px solid rgba(128,128,128,0.35)', opacity: 0.75, whiteSpace: 'nowrap' as const }}>{copy.recNotDeclared}</span>;
    }
    if (rec.status === 'match') {
      const unused = (rec.unused ?? []).map(capLabel).join(', ');
      return <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 99, border: '1px solid rgba(128,128,128,0.35)', opacity: 0.75, whiteSpace: 'nowrap' as const }} title={unused ? copy.recUnused(unused) : undefined}>✓ {copy.recMatch}{unused ? copy.recUnused(unused) : ''}</span>;
    }
    return <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 99, border: '1px solid rgba(210,153,34,0.65)', color: DRIFT, whiteSpace: 'nowrap' as const }}>⚠ {copy.recDrift}</span>;
  };

  const evidenceBlock = (p: any, id: string) => {
    const finding = p.capabilities?.[id];
    return (
      <div style={{ border: '1px solid rgba(128,128,128,0.22)', borderRadius: 8, padding: '8px 12px', background: 'rgba(128,128,128,0.05)', display: 'flex', flexDirection: 'column' as const, gap: 3 }}>
        <div style={{ fontSize: 11.5, display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' as const }}>
          <span style={{ fontWeight: 600 }}>{capLabel(id)}</span>
          <span style={{ opacity: 0.55 }}>{copy.tier[finding?.tier] ?? finding?.tier}</span>
          {capNote(id) !== '' && <span style={{ opacity: 0.65 }}>{capNote(id)}</span>}
        </div>
        {(finding?.details ?? []).length > 0 && (
          <div style={{ fontSize: 11.5, opacity: 0.75 }}>{finding.details.join('；')}</div>
        )}
        {(finding?.evidence ?? []).length === 0 ? (
          <div style={{ fontSize: 11.5, opacity: 0.5 }}>{copy.noEvidence}</div>
        ) : (
          (finding?.evidence ?? []).map((ev: any, i: number) => (
            <div key={i} style={{ ...S.mono, fontSize: 11.5, display: 'flex', gap: 10, alignItems: 'baseline', lineHeight: 1.5 }}>
              <span style={{ opacity: 0.55, whiteSpace: 'nowrap' as const, flexShrink: 0 }}>{ev.file}:{ev.line}</span>
              <span style={{ whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const, opacity: 0.9 }}>{ev.excerpt}</span>
            </div>
          ))
        )}
        {!!finding?.omitted && <div style={{ fontSize: 11, opacity: 0.5 }}>{copy.evidenceOmitted(finding.omitted)}</div>}
      </div>
    );
  };

  const pluginCard = (p: any) => {
    const rec = p.reconciliation ?? { status: 'not-declared' };
    const capIds = Object.keys(p.capabilities ?? {});
    // One realpath can now yield several provenance identities. Directory-only
    // keys would make React reuse the wrong card and couple their evidence
    // expanders, so the scan identity is authoritative when available.
    const pluginKey = String(p.identity ?? p.dir ?? p.name ?? '(unknown)');
    const claimRows: Array<[string, string[]]> = [
      [copy.tools, stringList(p.claims?.toolNames)],
      [copy.routes, stringList(p.claims?.routeBases)],
      [copy.providers, stringList(p.claims?.providerIds)],
      [copy.clientModules, stringList(p.claims?.clientModuleIds)],
      [copy.hooks, stringList(p.hooks)],
    ];
    const skippedCount = Number.isFinite(p.coverage?.skippedFiles) ? Number(p.coverage.skippedFiles) : 0;
    const skippedDetail = p.coverage?.skipped && typeof p.coverage.skipped === 'object'
      ? Object.entries(copy.coverageReasons)
        .map(([key, label]) => [label, Number(p.coverage.skipped[key] ?? 0)] as const)
        .filter(([, count]) => count > 0)
        .map(([label, count]) => `${label} ${count}`)
        .join(' · ')
      : '';
    return (
      <div key={pluginKey} style={S.block}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' as const }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</span>
          <span style={{ ...S.mono, fontSize: 11.5, opacity: 0.65 }}>@{p.version}</span>
          <span style={{ flex: 1 }} />
          {recChip(p)}
        </div>
        {rec.status === 'drift' && (
          <div style={{ fontSize: 11.5, color: DRIFT, opacity: 0.95, marginTop: -6 }}>
            {rec.undeclared?.length ? copy.recUndeclared(rec.undeclared.map(capLabel).join(', ')) : ''}
            {rec.undeclared?.length && rec.unknown?.length ? ' · ' : ''}
            {rec.unknown?.length ? copy.recUnknown(rec.unknown.join(', ')) : ''}
          </div>
        )}
        {!!p.description && <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: -6 }}>{p.description}</div>}
        {p.coverage?.sourceAvailable === false && (
          <div style={{ fontSize: 11.5, opacity: 0.7, marginTop: -6 }}>ⓘ {copy.bundled}</div>
        )}
        {skippedCount > 0 && (
          <div style={{ fontSize: 11.5, color: DRIFT, opacity: 0.95, marginTop: -6 }}>
            ⚠ {copy.coverageSkipped(skippedCount, skippedDetail)}
          </div>
        )}

        <div style={S.group}>{copy.installs}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, marginTop: -4 }}>
          {(p.installs ?? []).map((it: any, i: number) => (
            <span key={i} title={it.spec} style={{ ...S.mono, fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {it.profile}#{it.position}
              {it.linked && <span style={{ fontSize: 9, border: '1px solid rgba(128,128,128,0.4)', borderRadius: 3, padding: '0 3px', opacity: 0.65 }}>{it.spec?.startsWith('file:') ? 'file' : 'link'}</span>}
            </span>
          ))}
        </div>

        {claimRows.some(([, v]) => v.length) && (<>
          <div style={S.group}>{copy.claims}</div>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 3, marginTop: -4 }}>
            {claimRows.filter(([, v]) => v.length).map(([label, values]) => (
              <div key={label} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, opacity: 0.55, whiteSpace: 'nowrap' as const }}>{label}</span>
                {values.slice(0, MAX_CLAIM_ITEMS).map((v) => <span key={v} style={{ ...S.mono, fontSize: 11.5 }}>{v}</span>)}
                {values.length > MAX_CLAIM_ITEMS && <span title={values.slice(MAX_CLAIM_ITEMS).join(', ')} style={{ fontSize: 11, opacity: 0.55 }}>+{values.length - MAX_CLAIM_ITEMS}</span>}
              </div>
            ))}
          </div>
        </>)}

        <div style={S.group}>{copy.caps}</div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6, marginTop: -4 }}>
          {capIds.length === 0 ? (
            <div style={{ fontSize: 11.5, opacity: 0.5 }}>{copy.noCaps}</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
              {capIds.map((id) => {
                const key = `${pluginKey}\u0000${id}`;
                const open = expanded === key;
                const tier = p.capabilities[id]?.tier;
                return (
                  <button key={id} type="button" title={capNote(id)}
                    onClick={() => setExpanded(open ? null : key)}
                    style={{
                      fontSize: 11.5, padding: '1px 8px', borderRadius: 99, border: '1px solid',
                      background: 'transparent', color: 'inherit', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      ...(TIER_STYLE[tier] ?? TIER_STYLE.heuristic),
                      ...(open ? { borderColor: 'rgba(74,158,255,0.9)' } : {}),
                    }}>
                    {capLabel(id)}
                    <span style={{ fontSize: 9.5, opacity: 0.6 }}>{copy.tier[tier] ?? tier}</span>
                  </button>
                );
              })}
            </div>
          )}
          {expanded && expanded.startsWith(`${pluginKey}\u0000`) && evidenceBlock(p, expanded.slice(pluginKey.length + 1))}
        </div>
      </div>
    );
  };

  /** Per-row status text for the upstream check, coloured only for "behind". */
  const updateStatus = (r: any) => {
    if (r.status === 'behind') return <span style={{ color: DRIFT }}>→ <span style={S.mono}>{r.latest}</span></span>;
    if (r.status === 'current') return <span style={{ opacity: 0.6 }}>{copy.upToDate}</span>;
    if (r.status === 'ahead') return <span style={{ opacity: 0.6 }}>{copy.aheadOfRegistry}</span>;
    if (r.status === 'local') return <span style={{ opacity: 0.6 }}>{copy.localInstall}</span>;
    return (<>
      <span style={{ opacity: 0.6 }}>{copy.lookupFailed}</span>
      {!!r.error && <span style={{ fontSize: 11, opacity: 0.55 }}>{r.error}</span>}
    </>);
  };

  const matches = (p: any) => {
    if (filter === 'all') return true;
    const s = p.reconciliation?.status;
    if (filter === 'drift') return s === 'drift';
    if (filter === 'not-declared') return s === 'not-declared';
    return s === 'match';
  };
  const plugins = report?.plugins ?? [];
  const shown = plugins.filter(matches);
  const versionDrift = report?.versionDrift ?? [];
  const profilesByIdentity = new Map<string, string[]>((report?.plugins ?? []).map((p: any) => [
    String(p.identity ?? ''),
    (Array.isArray(p.installs) ? p.installs : [])
      .map((i: any) => i?.profile)
      .filter((profile: unknown): profile is string => typeof profile === 'string'),
  ]));
  const updateResults = updates?.results ?? [];
  const sortedUpdateResults = [...updateResults].sort((a: any, b: any) => {
    const ai = UPDATE_STATUS_ORDER.indexOf(a.status);
    const bi = UPDATE_STATUS_ORDER.indexOf(b.status);
    return (ai < 0 ? UPDATE_STATUS_ORDER.length : ai) - (bi < 0 ? UPDATE_STATUS_ORDER.length : bi);
  });
  // Runtime fields were added after the first hub shape. Treat absence as
  // "not supplied by this hub", not `available: false`, so an old instance
  // keeps rendering without manufacturing a negative observation.
  const runtime = report?.runtime && typeof report.runtime === 'object' ? report.runtime : null;
  const attribution = report?.attribution && typeof report.attribution === 'object' ? report.attribution : null;
  const runtimeRows: Array<[string, string[]]> = runtime ? [
    [copy.tools, stringList(runtime.tools)],
    [copy.providers, stringList(runtime.providers)],
    [copy.routes, stringList(runtime.routes)],
  ] : [];
  const attributed = attribution && Array.isArray(attribution.matched) ? attribution.matched : [];
  const unattributed = attribution && Array.isArray(attribution.unattributed) ? attribution.unattributed : [];
  const runtimeKind = (kind: unknown) => {
    if (kind === 'tool' || kind === 'provider' || kind === 'route') return copy.runtimeKinds[kind];
    return typeof kind === 'string' ? kind : '?';
  };
  const runtimeValues = (values: string[]) => (<>
    {values.length === 0 ? (
      <span style={{ fontSize: 11.5, opacity: 0.5 }}>{copy.runtimeEmpty}</span>
    ) : (<>
      {values.slice(0, MAX_CLAIM_ITEMS).map((value) => (
        <span key={value} style={{ ...S.mono, fontSize: 11.5 }}>{value}</span>
      ))}
      {values.length > MAX_CLAIM_ITEMS && (
        <span title={values.slice(MAX_CLAIM_ITEMS).join(', ')} style={{ fontSize: 11, opacity: 0.55 }}>
          +{values.length - MAX_CLAIM_ITEMS}
        </span>
      )}
    </>)}
  </>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: 1.55 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 600, marginBottom: -2 }}>{copy.title}</div>
          <div style={{ opacity: 0.75 }}>{copy.intro}</div>
        </div>
        <button style={{ ...S.btn, flexShrink: 0 }} disabled={busy} onClick={() => void refresh(true)}>
          {busy ? copy.scanning : copy.rescan}
        </button>
      </div>

      {freshness && (freshness.hubStale === true
        || (typeof CLIENT_BUILD_ID === 'string' && typeof freshness.clientBuildId === 'string' && CLIENT_BUILD_ID !== freshness.clientBuildId)) && (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
          {freshness.hubStale === true && (
            <div style={{ border: '1px solid rgba(210,153,34,0.65)', color: DRIFT, borderRadius: 8, padding: '7px 12px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span>⚠</span><span>{copy.bannerHubStale}</span>
            </div>
          )}
          {typeof CLIENT_BUILD_ID === 'string' && typeof freshness.clientBuildId === 'string' && CLIENT_BUILD_ID !== freshness.clientBuildId && (
            <div style={{ border: '1px solid rgba(210,153,34,0.65)', color: DRIFT, borderRadius: 8, padding: '7px 12px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span>⚠</span><span>{copy.bannerPanelStale}</span>
            </div>
          )}
        </div>
      )}

      {report === null && busy && <div style={{ opacity: 0.55 }}>{copy.loading}</div>}
      {notice !== '' && (
        <div role="alert" style={{
          border: '1px solid rgba(248,81,73,0.55)', color: CLASH, background: 'rgba(248,81,73,0.06)',
          borderRadius: 8, padding: '7px 12px', fontSize: 12, whiteSpace: 'pre-wrap' as const,
        }}>⚠ {notice}</div>
      )}

      {report && (report.conflicts ?? []).length > 0 && (<>
        <div style={S.section}>{copy.conflicts}</div>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          {(report.conflicts ?? []).map((c: any) => {
            const clash = c.severity === 'clash';
            return (
              <div key={`${c.kind}\u0000${c.key}`} style={{ ...S.block, gap: 6, ...(clash ? { borderColor: 'rgba(248,81,73,0.55)', background: 'rgba(248,81,73,0.06)' } : {}) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: clash ? CLASH : undefined }}>
                    {clash ? '⚠' : 'ⓘ'} {copy.kind[c.kind] ?? c.kind}
                  </span>
                  <span style={{ ...S.mono, fontSize: 12.5, opacity: 0.9 }}>&quot;{c.key}&quot;</span>
                  <span style={{ fontSize: 10.5, opacity: 0.55, border: '1px solid rgba(128,128,128,0.3)', borderRadius: 99, padding: '0 6px' }}>
                    {clash ? copy.clash : copy.orderSensitive}
                  </span>
                </div>
                <div style={{ fontSize: 12 }}>
                  {(c.owners ?? []).map((o: any) => `${o.name}（${(o.profiles ?? []).join(', ')}）`).join(' vs ')}
                </div>
                <div style={{ fontSize: 11.5, opacity: 0.75 }}>{copy.kindNotes[c.kind] ?? c.note ?? ''}</div>
              </div>
            );
          })}
        </div>
      </>)}

      {report && (<>
        <div style={S.section}>{copy.runtime}</div>
        {runtime === null ? (
          <div style={{ fontSize: 12.5, opacity: 0.65 }}>{copy.runtimeLegacy}</div>
        ) : (
          <div style={{ ...S.block, gap: 7 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' as const }}>
              <span style={{
                fontSize: 11, padding: '1px 8px', borderRadius: 99, border: '1px solid rgba(128,128,128,0.35)',
                opacity: runtime.available === true ? 0.9 : 0.7,
              }}>
                {runtime.available === true
                  ? copy.runtimeAvailable
                  : runtime.available === false ? copy.runtimeUnavailable : copy.runtimeUnknown}
              </span>
              {runtime.collectedAt && (
                <span style={{ fontSize: 11, opacity: 0.55 }}>{copy.runtimeCollectedAt(fmtTime(runtime.collectedAt))}</span>
              )}
            </div>

            {runtimeRows.map(([label, values]) => (
              <div key={label} style={{ display: 'flex', gap: 7, flexWrap: 'wrap' as const, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, opacity: 0.55, minWidth: 62 }}>{label}</span>
                {runtimeValues(values)}
              </div>
            ))}

            <div style={S.group}>{copy.attribution}</div>
            {attribution === null ? (
              <div style={{ fontSize: 11.5, opacity: 0.55, marginTop: -4 }}>{copy.attributionMissing}</div>
            ) : attributed.length === 0 && unattributed.length === 0 ? (
              <div style={{ fontSize: 11.5, opacity: 0.5, marginTop: -4 }}>{copy.runtimeEmpty}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 3, marginTop: -4 }}>
                {attributed.length > 0 && (
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' as const, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 11, opacity: 0.55, minWidth: 62 }}>{copy.attributed}</span>
                    {attributed.map((item: any, i: number) => (
                      <span key={`${item?.kind}\u0000${item?.key}\u0000${item?.plugin}\u0000${i}`} style={{ ...S.mono, fontSize: 11.5 }}>
                        {runtimeKind(item?.kind)}:{String(item?.key ?? '?')} → {String(item?.plugin ?? '?')}
                      </span>
                    ))}
                  </div>
                )}
                {unattributed.length > 0 && (
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' as const, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 11, opacity: 0.55, minWidth: 62 }}>{copy.unattributed}</span>
                    {unattributed.map((item: any, i: number) => (
                      <span key={`${item?.kind}\u0000${item?.key}\u0000${i}`} style={{ ...S.mono, fontSize: 11.5 }}>
                        {runtimeKind(item?.kind)}:{String(item?.key ?? '?')}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {stringList(runtime.notes).length > 0 && (<>
              <div style={S.group}>{copy.runtimeNotes}</div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 2, marginTop: -4 }}>
                {stringList(runtime.notes).map((note, i) => (
                  <div key={i} style={{ fontSize: 11.5, opacity: 0.65 }}>• {localizeRuntimeNote(note, zh)}</div>
                ))}
              </div>
            </>)}
          </div>
        )}
      </>)}

      {report && (<>
        <div style={S.section}>{copy.versions}</div>
        {versionDrift.length === 0 ? (
          <div style={{ fontSize: 12.5, opacity: 0.55 }}>{copy.versionsAgree}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
            {versionDrift.map((d: any) => (
              <div key={d.name} style={{ ...S.block, gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' as const }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</span>
                  <span style={{ fontSize: 11.5, opacity: 0.65 }}>{copy.localBaseline(d.highestInstalled ?? d.newest ?? '?')}</span>
                </div>
                {(d.rows ?? []).map((row: any) => (
                  <div key={row.version} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
                    <span style={{ ...S.mono, fontSize: 11.5, color: row.behind ? DRIFT : undefined }}>{row.version}</span>
                    <span style={{ fontSize: 11, opacity: 0.6 }}>{(row.profiles ?? []).join(', ')}</span>
                    {row.kind === 'link' && <span style={{ fontSize: 9, border: '1px solid rgba(128,128,128,0.4)', borderRadius: 3, padding: '0 3px', opacity: 0.65 }}>{copy.local}</span>}
                    {row.kind === 'file' && <span style={{ fontSize: 9, border: '1px solid rgba(128,128,128,0.4)', borderRadius: 3, padding: '0 3px', opacity: 0.65 }}>{copy.localFile}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
          <button style={S.btn} disabled={checking} onClick={() => void checkUpdates()}>
            {checking ? copy.checkingUpdates : copy.checkUpdates}
          </button>
          <span style={{ fontSize: 11, opacity: 0.55 }}>{copy.checkUpdatesHint}</span>
        </div>
        {updateError !== '' && (
          <div role="alert" style={{
            border: '1px solid rgba(248,81,73,0.55)', color: CLASH, background: 'rgba(248,81,73,0.06)',
            borderRadius: 8, padding: '7px 12px', fontSize: 12, whiteSpace: 'pre-wrap' as const,
          }}>⚠ {updateError}</div>
        )}
        {updates && sortedUpdateResults.length > 0 && (
          <div style={{ ...S.block, gap: 6 }}>
            {sortedUpdateResults.map((r: any, i: number) => {
              const profiles = profilesByIdentity.get(r.identity);
              return (
                <div key={r.identity ?? r.name ?? i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' as const, fontSize: 12.5 }}>
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                  <span style={{ ...S.mono, fontSize: 11.5, opacity: 0.75 }}>{r.installed}</span>
                  {profiles?.length ? <span style={{ fontSize: 11, opacity: 0.6 }}>[{profiles.join(', ')}]</span> : null}
                  {updateStatus(r)}
                  {r.cached === true && (
                    <span style={{ fontSize: 9.5, opacity: 0.6, border: '1px solid rgba(128,128,128,0.35)', borderRadius: 99, padding: '0 5px' }}>{copy.cached}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {updates && sortedUpdateResults.length === 0 && (
          <div style={{ fontSize: 12.5, opacity: 0.55 }}>{copy.noUpdateResults}</div>
        )}
        {updates && (
          <div style={{ fontSize: 11, opacity: 0.55 }}>
            {copy.checkedAt(fmtTime(updates.checkedAt), stringList(updates.registryHosts).join(', '))}
          </div>
        )}
      </>)}

      {report && (<>
        <div style={S.section}>{copy.changes}</div>
        {report.snapshot?.firstRun ? (
          <div style={{ fontSize: 12.5, opacity: 0.75 }}>{copy.firstRun}</div>
        ) : (report.snapshot?.changes ?? []).length === 0 ? (
          <div style={{ fontSize: 12.5, opacity: 0.55 }}>{copy.noChanges}</div>
        ) : (
          <div style={{ ...S.block, gap: 6 }}>
            <div style={{ fontSize: 11, opacity: 0.55 }}>{copy.since(report.snapshot?.previousScanAt ?? '?')}</div>
            {(report.snapshot?.changes ?? []).map((c: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' as const, fontSize: 12.5 }}>
                <span style={{ fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap' as const }}>{copy.changeTypes[c.type] ?? c.type}</span>
                <span style={{ fontWeight: 500 }}>{c.plugin}</span>
                <span style={{ opacity: 0.75 }}>{localizeDetail(c.detail ?? '', c.type, zh, caps)}</span>
              </div>
            ))}
          </div>
        )}
        {report.snapshot?.warning && <div style={{ fontSize: 11.5, opacity: 0.6 }}>{report.snapshot.warning}</div>}
      </>)}

      {report && (<>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ ...S.section, flexShrink: 0, whiteSpace: 'nowrap' as const }}>{copy.plugins}</div>
          <span style={{ flex: 1 }} />
          <div style={{ width: 150, flexShrink: 0 }}>
            <CustomSelect value={filter} onChange={setFilter} minWidth={150}
              options={[
                { value: 'all', label: copy.filterAll },
                { value: 'drift', label: copy.filterDrift },
                { value: 'not-declared', label: copy.filterNotDeclared },
                { value: 'match', label: copy.filterMatch },
              ]} />
          </div>
        </div>
        {shown.length === 0 ? (
          <div style={{ opacity: 0.55 }}>{plugins.length === 0 ? copy.noPlugins : copy.noMatches}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
            {shown.map(pluginCard)}
          </div>
        )}
      </>)}

      {report && (
        <div style={{ fontSize: 11, opacity: 0.5, marginTop: -2 }}>
          {copy.scannedAt(fmtTime(report.scannedAt), report.profilesDir ?? '')}
        </div>
      )}
    </div>
  );
}

export function apply(ctx: any): void {
  ctx.slots.inject('settings.section', () => {
    const dispose = ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-harbor',
        order: 66,
        label: () => COPY[ctx.locale.getLocale().active === 'zh' ? 'zh' : 'en'].label,
      },
      () => <HarborPanel ctx={ctx} />,
    );
    return dispose;
  });
}

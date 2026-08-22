// Snapshot and diff. Governance is mostly about change: who upgraded, who
// gained a capability, who disappeared. `link:` installs especially — a local
// working tree changes behind the user's back.

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { byId } from './detectors.mjs';

export const stateDir = () => join(homedir(), '.config', 'dsh-harbor');

const SNAPSHOT_FILE = 'snapshot.json';

// name alone does not identify a plugin: the same package can be installed
// twice (an npm copy and a link: working tree) with different surfaces. The
// record key is discovery's provenance identity, which stays stable when the
// first-encountered realpath of a merged row changes with directory order —
// keying on the path made untouched plugins look new. keyOf survives only to
// read snapshots written before identity existed.
const keyOf = (name, dir) => `${name}\u0000${dir}`;
const identityOf = (rec) => rec.identity ?? keyOf(rec.name, rec.dir);

// Capability ids are stable but not friendly; zh labels live with the
// detectors so the table stays the single source of truth.
const capLabel = (id) => byId[id]?.label?.zh ?? id;

/** @returns {{added: string[], removed: string[]}} ids present on only one side */
function setDiff(prev, cur) {
  const prevSet = new Set(prev);
  return { added: cur.filter((x) => !prevSet.has(x)), removed: prev.filter((x) => !cur.includes(x)) };
}

const CLAIM_KINDS = [
  ['toolNames', '工具'],
  ['routeBases', '路由'],
  ['providerIds', 'provider'],
];

function claimsDetail(prev, cur) {
  const parts = [];
  for (const [field, label] of CLAIM_KINDS) {
    const { added, removed } = setDiff(prev[field] ?? [], cur[field] ?? []);
    for (const x of added) parts.push(`${label} +${x}`);
    for (const x of removed) parts.push(`${label} −${x}`);
  }
  return parts.join('，');
}

const zhList = (ids) => ids.map(capLabel).join('、');

// One record per plugin. Capabilities and claims are stored sorted so a later
// re-scan of an untouched plugin produces byte-identical records.
function recordOf(report) {
  const claims = report.claims ?? {};
  return {
    name: report.name,
    dir: report.dir,
    identity: report.identity ?? keyOf(report.name, report.dir),
    // Stored so a change line can say which install it means: two rows of the
    // same package differ only by where they are installed.
    profiles: (report.installs ?? []).map((i) => i.profile).sort(),
    version: report.version,
    capabilities: Object.keys(report.capabilities ?? {}).sort(),
    toolNames: [...(claims.toolNames ?? [])].sort(),
    routeBases: [...(claims.routeBases ?? [])].sort(),
    providerIds: [...(claims.providerIds ?? [])].sort(),
  };
}

function readSnapshot(dir) {
  const path = join(dir, SNAPSHOT_FILE);
  if (!existsSync(path)) return { scannedAt: null, byKey: new Map(), warning: null };
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // A corrupt snapshot must not kill the scan; fall back to a first run but
    // say so — otherwise the "firstRun" claim would silently lie.
    return { scannedAt: null, byKey: new Map(), warning: `${path} 无法解析，按首次扫描处理` };
  }
  const byKey = new Map();
  for (const rec of Array.isArray(data?.plugins) ? data.plugins : []) {
    byKey.set(identityOf(rec), rec);
  }
  return { scannedAt: data?.scannedAt ?? null, byKey, warning: null };
}

/**
 * Diff the given reports against the stored snapshot and write the new one.
 * @param {Array<{name: string, dir: string, version: string, capabilities: Record<string, unknown>, claims?: Record<string, string[]>}>} reports
 * @param {{write?: boolean, dir?: string}} [options]
 * @returns {{firstRun: boolean, changes: Array<{type: string, plugin: string, dir: string, detail: string}>, previousScanAt: string|null, warning?: string}}
 */
export function diffAndStore(reports, { write = true, dir = stateDir() } = {}) {
  const current = new Map(reports.map((r) => [r.identity ?? keyOf(r.name, r.dir), recordOf(r)]));
  const { scannedAt: previousScanAt, byKey: previous, warning: readWarning } = readSnapshot(dir);
  // Snapshots written before identity existed are keyed by name/dir. Re-key
  // them onto the matching current record so an upgrade does not report every
  // untouched plugin as newly added.
  for (const [oldKey, rec] of [...previous]) {
    if (rec.identity || current.has(oldKey)) continue;
    const match = [...current.values()].find((c) => c.name === rec.name && c.dir === rec.dir);
    if (match) { previous.delete(oldKey); previous.set(match.identity, rec); }
  }
  const firstRun = !previousScanAt;

  const changes = [];
  const keys = [...new Set([...previous.keys(), ...current.keys()])].sort();
  for (const key of keys) {
    const prev = previous.get(key);
    const cur = current.get(key);
    // A plugin removed and re-added in one scan still gets one plugin/dir
    // pair from whichever side has a record.
    const plugin = cur?.name ?? prev.name;
    const pluginDir = cur?.dir ?? prev.dir;

    if (!prev) {
      changes.push({ type: 'added', plugin, dir: pluginDir, profiles: cur.profiles ?? [], detail: `版本 ${cur.version}` });
      continue;
    }
    if (!cur) {
      changes.push({ type: 'removed', plugin, dir: pluginDir, profiles: prev.profiles ?? [], detail: `版本 ${prev.version}` });
      continue;
    }

    if (prev.version !== cur.version) {
      changes.push({ type: 'version', plugin, dir: pluginDir, profiles: cur.profiles ?? [], detail: `${prev.version} → ${cur.version}` });
    }
    const caps = setDiff(prev.capabilities ?? [], cur.capabilities ?? []);
    if (caps.added.length) {
      changes.push({ type: 'capability-added', plugin, dir: pluginDir, profiles: cur.profiles ?? [], detail: `新增能力：${zhList(caps.added)}` });
    }
    if (caps.removed.length) {
      changes.push({ type: 'capability-removed', plugin, dir: pluginDir, profiles: cur.profiles ?? [], detail: `移除能力：${zhList(caps.removed)}` });
    }
    const claimsChanged = CLAIM_KINDS.some(([field]) => {
      const a = prev[field] ?? [];
      const b = cur[field] ?? [];
      return a.length !== b.length || a.some((x, i) => x !== b[i]);
    });
    if (claimsChanged) {
      changes.push({ type: 'claims-changed', plugin, dir: pluginDir, profiles: cur.profiles ?? [], detail: `claims 变更：${claimsDetail(prev, cur)}` });
    }
  }

  const result = { firstRun, changes, previousScanAt };
  if (readWarning) result.warning = readWarning;

  if (write !== false) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, SNAPSHOT_FILE), JSON.stringify({
        scannedAt: new Date().toISOString(),
        plugins: [...current.values()],
      }, null, 2) + '\n');
    } catch (err) {
      // A read-only config dir (rootless container, nix store) must not abort
      // the scan — report it and keep the diff results.
      result.warning = [result.warning, `快照写入失败：${err?.message ?? err}`].filter(Boolean).join('；');
    }
  }

  return result;
}

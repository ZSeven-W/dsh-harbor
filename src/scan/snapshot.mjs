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
  const installs = report.installs ?? [];
  const firstSpec = installs[0]?.spec ?? '';
  return {
    name: report.name,
    dir: report.dir,
    identity: report.identity ?? keyOf(report.name, report.dir),
    // Stored so a change line can say which install it means: two rows of the
    // same package differ only by where they are installed.
    profiles: installs.map((i) => i.profile).sort(),
    // These fields make identity-schema migrations and future provenance
    // changes pairable without pretending the concrete instance id is eternal.
    installKind: firstSpec.startsWith('link:') ? 'link' : firstSpec.startsWith('file:') ? 'file' : 'registry',
    specs: [...new Set(installs.map((i) => i.spec).filter(Boolean))].sort(),
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

function profileSlots(records) {
  const slots = new Map();
  for (const [identity, record] of records) {
    for (const profile of new Set(record.profiles ?? [])) {
      slots.set(`${record.name}\0${profile}`, { identity, profile, record });
    }
  }
  return slots;
}

const profileSetKey = (record) => [...new Set(record.profiles ?? [])].sort().join('\0');

/**
 * Diff the version/artifact assigned to every concrete profile slot. Artifact
 * identity alone cannot do this: if v1 and v2 exchange profiles A and B, both
 * identities still exist and an identity-only diff sees no change at all.
 */
function profileMembershipChanges(previous, current) {
  const prevSlots = profileSlots(previous);
  const curSlots = profileSlots(current);
  const grouped = new Map();

  const add = (key, change, profile) => {
    if (!grouped.has(key)) grouped.set(key, { ...change, profiles: [] });
    grouped.get(key).profiles.push(profile);
  };

  const slots = [...new Set([...prevSlots.keys(), ...curSlots.keys()])].sort();
  for (const slot of slots) {
    const prev = prevSlots.get(slot);
    const cur = curSlots.get(slot);
    if (!prev) {
      add(`added\0${cur.identity}`, {
        type: 'added', plugin: cur.record.name, dir: cur.record.dir,
        detail: `版本 ${cur.record.version}`,
      }, cur.profile);
      continue;
    }
    if (!cur) {
      add(`removed\0${prev.identity}`, {
        type: 'removed', plugin: prev.record.name, dir: prev.record.dir,
        detail: `版本 ${prev.record.version}`,
      }, prev.profile);
      continue;
    }
    if (prev.record.version !== cur.record.version) {
      add(`version\0${prev.identity}\0${cur.identity}`, {
        type: 'version', plugin: cur.record.name, dir: cur.record.dir,
        detail: `${prev.record.version} → ${cur.record.version}`,
      }, cur.profile);
      continue;
    }
    // A one-to-one identity/schema migration keeps the complete profile set
    // together and is not a membership move. Splits, merges, and exchanges do
    // change the set and must remain visible even when the version is equal.
    const wholeRowMigration = profileSetKey(prev.record) === profileSetKey(cur.record)
      && !current.has(prev.identity)
      && !previous.has(cur.identity);
    if (prev.identity !== cur.identity && !wholeRowMigration) {
      add(`profile-move\0${prev.identity}\0${cur.identity}`, {
        type: 'profile-move', plugin: cur.record.name, dir: cur.record.dir,
        detail: `制品变更（版本 ${cur.record.version}）`,
      }, cur.profile);
    }
  }

  return [...grouped.values()].map((change) => {
    change.profiles.sort();
    if (change.type === 'profile-move') {
      change.detail = `${change.profiles.join('、')}：${change.detail}`;
    }
    return change;
  });
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
  // Capture profile assignments before identity-schema migration mutates the
  // map keys below. Those concrete assignments are the authority for version
  // and install/remove changes.
  const membershipChanges = profileMembershipChanges(previous, current);
  // A concrete registry identity changes when its resolved artifact changes.
  // Pair unmatched records by their stable installation slot (plugin name +
  // exact profile set), with dir as a legacy fallback. This covers both old
  // name/spec identities and new content identities, and turns an ordinary
  // exact-version upgrade into one `version` change instead of remove + add.
  // Ambiguous matches stay unmatched: guessing would be worse than verbosity.
  const profileKey = profileSetKey;
  const kindCompatible = (a, b) => !a.installKind || !b.installKind || a.installKind === b.installKind;
  const claimedCurrent = new Set([...current.keys()].filter((key) => previous.has(key)));
  for (const [oldKey, prev] of [...previous]) {
    if (current.has(oldKey)) continue;
    const prevProfiles = profileKey(prev);
    const candidates = [...current.entries()].filter(([curKey, cur]) => {
      if (claimedCurrent.has(curKey) || cur.name !== prev.name || !kindCompatible(prev, cur)) return false;
      const sameProfiles = prevProfiles && prevProfiles === profileKey(cur);
      return sameProfiles || (!!prev.dir && prev.dir === cur.dir);
    });
    if (candidates.length !== 1) continue;
    const [curKey] = candidates[0];
    previous.delete(oldKey);
    previous.set(curKey, prev);
    claimedCurrent.add(curKey);
  }
  const firstRun = !previousScanAt;

  const changes = [...membershipChanges];
  const keys = [...new Set([...previous.keys(), ...current.keys()])].sort();
  for (const key of keys) {
    const prev = previous.get(key);
    const cur = current.get(key);
    // A plugin removed and re-added in one scan still gets one plugin/dir
    // pair from whichever side has a record.
    const plugin = cur?.name ?? prev.name;
    const pluginDir = cur?.dir ?? prev.dir;

    if (!prev) {
      // Profile-bearing records were already handled slot-by-slot above. This
      // fallback preserves snapshots created from reports without installs.
      if (!(cur.profiles ?? []).length) {
        changes.push({ type: 'added', plugin, dir: pluginDir, profiles: [], detail: `版本 ${cur.version}` });
      }
      continue;
    }
    if (!cur) {
      if (!(prev.profiles ?? []).length) {
        changes.push({ type: 'removed', plugin, dir: pluginDir, profiles: [], detail: `版本 ${prev.version}` });
      }
      continue;
    }

    // Version changes for profile-bearing records were emitted from the
    // profile map, which correctly catches identities exchanging profiles.
    if (prev.version !== cur.version && !(prev.profiles ?? []).length && !(cur.profiles ?? []).length) {
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

// Cross-plugin conflicts.
//
// Two distinct things, deliberately not merged:
//   clash            two plugins claim the same registry key — always shown
//   order-sensitive  several plugins hook the same message-path waterfall, so
//                     load order decides the outcome — informational, and only
//                     for message paths (UI events made everything collide)

import { CLASH_KINDS, ORDER_SENSITIVE_EVENTS } from './detectors.mjs';

export { CLASH_KINDS, ORDER_SENSITIVE_EVENTS };

export function isOrderSensitive(event) {
  return ORDER_SENSITIVE_EVENTS.some((re) => re.test(event));
}

// Which report field backs each clash kind. settings-slot is deliberately
// absent: it stays in CLASH_KINDS for consumers, but no extractor fills a
// settingsSlots field yet, so there is nothing to compare.
const CLAIM_FIELDS = {
  'tool-name': 'toolNames',
  'route-base': 'routeBases',
  'provider-id': 'providerIds',
  'client-module-id': 'clientModuleIds',
};

// One consequence sentence per kind. Wording states what breaks, never that a
// plugin is "bad" — a conflict is a property of the set, not of one plugin.
const NOTES = {
  'tool-name': '多个插件注册同名工具，后装载者覆盖先装载者，模型只会看到其中一个。',
  'route-base': '多个插件声明同一路由前缀，后注册者抢占该路径，先注册者静默失效。',
  'provider-id': '多个插件注册同一 provider id，会话选中后流量只会经过其中一个适配器。',
  'client-module-id': '多个插件注入同一客户端模块 id，页面加载时后者覆盖前者。',
  'order-sensitive': '多个插件挂载同一消息路径事件，加载顺序决定谁先改写消息，行为随安装顺序变化。',
};

// Fixed ranks, not alphabetical order: clashes are actionable and come first,
// and kind order follows the claim table so diffs stay stable across runs.
const SEVERITY_RANK = { clash: 0, info: 1 };
const KIND_RANK = {
  'tool-name': 0,
  'route-base': 1,
  'provider-id': 2,
  'client-module-id': 3,
  'order-sensitive': 4,
};

/**
 * Collect one claim kind across all reports, keyed by profile.
 *
 * The profile is the unit of coexistence: a key only counts as shared when two
 * distinct package names claim it inside the same profile. Two installs of the
 * same package (same name, e.g. an npm copy plus a `link:` tree) collapse to
 * one owner — a plugin cannot collide with itself, and its extra installs must
 * not inflate an owner list someone else triggered.
 */
function sharedKeys(reports, { kind, keysOf, severity, note }) {
  const byKey = new Map(); // key -> profile -> name -> dir

  for (const report of reports) {
    const profiles = [...new Set((report.installs ?? []).map((i) => i.profile))];
    if (!profiles.length) continue; // installed nowhere means it coexists with nobody
    for (const key of keysOf(report)) {
      if (!byKey.has(key)) byKey.set(key, new Map());
      const perProfile = byKey.get(key);
      for (const profile of profiles) {
        if (!perProfile.has(profile)) perProfile.set(profile, new Map());
        // First dir wins for a duplicated name; dir is context, not identity.
        if (!perProfile.get(profile).has(report.name)) {
          perProfile.get(profile).set(report.name, report.dir);
        }
      }
    }
  }

  const out = [];
  for (const [key, perProfile] of byKey) {
    const owners = new Map(); // name -> { name, dir, profiles: Set }
    for (const [profile, perName] of perProfile) {
      if (perName.size < 2) continue; // a lone name owns the key here — no fight
      for (const [name, dir] of perName) {
        if (!owners.has(name)) owners.set(name, { name, dir, profiles: new Set() });
        // Only profiles where the key is actually shared survive; being
        // installed elsewhere is coexistence, not part of this conflict.
        owners.get(name).profiles.add(profile);
      }
    }
    if (!owners.size) continue;
    out.push({
      kind,
      key,
      owners: [...owners.values()]
        .map((o) => ({ name: o.name, dir: o.dir, profiles: [...o.profiles].sort() }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      severity,
      note,
    });
  }
  return out;
}

/**
 * @param {Array<{
 *   name: string, dir: string,
 *   installs: Array<{profile: string, position: number, linked: boolean}>,
 *   claims: {toolNames: string[], routeBases: string[], providerIds: string[], clientModuleIds: string[]},
 *   hooks: string[],
 * }>} reports inspectPlugin results
 * @returns {Array<{
 *   kind: 'tool-name'|'route-base'|'provider-id'|'client-module-id'|'order-sensitive',
 *   key: string,
 *   owners: Array<{name: string, dir: string, profiles: string[]}>,
 *   severity: 'clash'|'info',
 *   note: string,
 * }>}
 */
export function findConflicts(reports) {
  const clashes = Object.entries(CLAIM_FIELDS).flatMap(([kind, field]) =>
    sharedKeys(reports, {
      kind,
      keysOf: (r) => r.claims?.[field] ?? [],
      severity: 'clash',
      note: NOTES[kind],
    })
  );
  const orderSensitive = sharedKeys(reports, {
    kind: 'order-sensitive',
    // isOrderSensitive guards even though the extractor already filters:
    // every plugin touches theme/locale events, so one slip would collide all.
    keysOf: (r) => (r.hooks ?? []).filter(isOrderSensitive),
    severity: 'info',
    note: NOTES['order-sensitive'],
  });
  return [...clashes, ...orderSensitive].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

#!/usr/bin/env node
// harbor CLI — dependency-free, runs without DSH installed (CI included).
//
//   harbor scan [--json] [--evidence] [--no-snapshot] [--check-updates]
//   harbor manifest [dir]     draft a dsh.capabilities block for your own plugin
//
// Output is deliberately plain: capabilities, evidence, conflicts, changes.
// No scores, no severity colours for capabilities — a subprocess is a fact,
// not a verdict.

import { scan, inspectPlugin, draftManifest, reconcile, byId, checkUpstream } from './scan/index.mjs';
import { readJson } from './scan/discover.mjs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('-')) ?? 'scan';
const flag = (name) => args.includes(`--${name}`);

const label = (capId) => byId[capId]?.label.zh ?? capId;
const TIER_MARK = { declared: '声明', runtime: '运行时', static: '源码', heuristic: '启发式' };

function renderPlugin(report, { evidence }) {
  const where = report.installs
    .map((i) => `${i.profile}#${i.position}${i.linked ? ` ${i.spec.startsWith('file:') ? 'file' : 'link'}` : ''}`)
    .join(', ');
  console.log(`\n■ ${report.name}@${report.version}  [${where}]`);
  if (report.description) console.log(`  ${report.description.slice(0, 100)}`);

  if (!report.coverage.sourceAvailable) {
    console.log(`  ⓘ 该插件未提供源码（${report.coverage.bundledFiles}/${report.coverage.sourceFiles} 为构建产物），以下结论基于产物推断`);
  }

  const caps = Object.entries(report.capabilities);
  if (!caps.length) {
    console.log('  能力: (未检出)');
  } else {
    console.log('  能力:');
    for (const [id, finding] of caps) {
      const details = finding.details?.length ? ` — ${finding.details.join('；')}` : '';
      console.log(`    · ${label(id)} [${TIER_MARK[finding.tier] ?? finding.tier}]${details}`);
      if (evidence) {
        for (const e of finding.evidence) {
          console.log(`        ${e.file}:${e.line}  ${e.excerpt}`);
        }
        if (finding.omitted) console.log(`        …另有 ${finding.omitted} 处`);
      }
    }
  }

  if (report.hooks.length) console.log(`  消息路径钩子: ${report.hooks.join(', ')}`);
  const { toolNames, routeBases, providerIds } = report.claims;
  if (toolNames.length) console.log(`  工具: ${toolNames.slice(0, 8).join(', ')}${toolNames.length > 8 ? ` +${toolNames.length - 8}` : ''}`);
  if (routeBases.length) console.log(`  路由: ${routeBases.join(', ')}`);
  if (providerIds.length) console.log(`  provider: ${providerIds.join(', ')}`);

  const rec = report.reconciliation;
  if (rec.status === 'not-declared') {
    console.log('  声明对账: 未声明 dsh.capabilities');
  } else if (rec.status === 'match') {
    console.log(`  声明对账: ✓ 一致${rec.unused.length ? `（声明宽于实际: ${rec.unused.map(label).join(', ')}）` : ''}`);
  } else {
    const parts = [];
    if (rec.undeclared.length) parts.push(`检出未声明: ${rec.undeclared.map(label).join(', ')}`);
    if (rec.unknown.length) parts.push(`未知 id: ${rec.unknown.join(', ')}`);
    console.log(`  声明对账: ⚠ ${parts.join(' | ')}`);
  }
}

if (command === 'scan') {
  const report = await scan({ snapshot: !flag('no-snapshot') });

  if (flag('json')) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  console.log(`dsh-harbor — ${report.plugins.length} 份第三方插件安装，扫描目录 ${report.profilesDir}`);
  for (const plugin of report.plugins) renderPlugin(plugin, { evidence: flag('evidence') });

  // Upstream is opt-in and network-bearing; the default posture stays offline.
  const upstream = flag('check-updates') ? await checkUpstream(report.plugins) : null;

  console.log('\n──────────');
  if (report.conflicts.length) {
    console.log('冲突与顺序敏感:');
    for (const c of report.conflicts) {
      const mark = c.severity === 'clash' ? '⚠ 撞车' : 'ⓘ 顺序敏感';
      console.log(`  ${mark}  ${c.kind} "${c.key}"`);
      console.log(`         ${c.owners.map((o) => `${o.name}[${o.profiles.join(',')}]`).join('  vs  ')}`);
      console.log(`         ${c.note}`);
    }
  } else {
    console.log('冲突: 无');
  }

  if (report.versionDrift.length) {
    console.log('\n版本不一致:');
    for (const f of report.versionDrift) {
      console.log(`  ${f.name}  已发布最新 ${f.newest}`);
      for (const row of f.rows) {
        // ASCII only, no colour escapes: this output must stay safe to redirect.
        const mark = row.behind ? '↓ ' : '';
        const local = row.kind === 'link' ? '  (本地 link)' : row.kind === 'file' ? '  (本地 file)' : '';
        console.log(`    ${mark}${row.version}  ${row.profiles.join(' ')}${local}`);
      }
    }
  } else {
    console.log('\n版本: 各 profile 一致');
  }

  if (upstream) {
    // Upstream rows carry an identity, not a profile list; resolve it back to
    // the scan rows so a name@version line also says WHERE it is behind, not
    // just that it is. Profiles render only when the identity is found.
    const profilesByIdentity = new Map(report.plugins.map((p) => [p.identity, (p.installs ?? []).map((i) => i.profile)]));
    const priority = { behind: 0, current: 1, ahead: 1, local: 1, unknown: 1 };
    const results = [...upstream.results].sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
    console.log('\n上游检查:');
    for (const r of results) {
      const profiles = profilesByIdentity.get(r.identity);
      const where = profiles?.length ? ` [${profiles.join(', ')}]` : '';
      if (r.status === 'behind') console.log(`  ⬆ ${r.name}@${r.installed}${where} → ${r.latest}（上游更新）`);
      else if (r.status === 'current') console.log(`  ✓ ${r.name}@${r.installed}${where} 已是最新`);
      else if (r.status === 'ahead') console.log(`  ▲ ${r.name}@${r.installed}${where} 比上游新（上游 ${r.latest}）`);
      else if (r.status === 'local') console.log(`  · ${r.name}@${r.installed}${where}（本地安装，无上游可比）`);
      else console.log(`  ? ${r.name}@${r.installed}${where}（查询失败: ${r.error ?? '未知'}）`);
    }
    const hosts = upstream.registryHosts.length ? upstream.registryHosts.join(', ') : '（无，全部为本地安装）';
    console.log(`  （本次联系了 registry: ${hosts}）`);
  }

  const snap = report.snapshot;
  if (snap.warning) console.log(`\n快照: ${snap.warning}`);
  if (snap.firstRun) {
    console.log('\n变化: 首次扫描，已建立基线');
  } else if (snap.changes.length) {
    console.log(`\n自上次扫描（${snap.previousScanAt ?? '未知时间'}）:`);
    for (const c of snap.changes) {
      const where = c.profiles?.length ? ` [${c.profiles.join(',')}]` : '';
      console.log(`  ${c.plugin}${where}  ${c.detail}`);
    }
  } else {
    console.log('\n变化: 无');
  }

  if (!flag('evidence')) console.log('\n（加 --evidence 查看每条能力的 file:line 出处，--json 输出完整报告）');
} else if (command === 'manifest') {
  const dir = resolve(args.find((a) => !a.startsWith('-') && a !== 'manifest') ?? process.cwd());
  const pkg = readJson(join(dir, 'package.json'));
  if (!pkg) {
    console.error(`找不到 package.json: ${dir}`);
    process.exit(1);
  }

  const report = inspectPlugin({ name: pkg.name ?? '(unnamed)', dir, installs: [] });
  const draft = draftManifest(report);
  const rec = reconcile(report);

  console.log(`${pkg.name ?? dir} — 检出 ${draft.capabilities.length} 项能力\n`);
  console.log(draft.json);
  console.log('\n逐条核对:');
  for (const note of draft.notes) console.log(`  ${note}`);

  if (rec.status === 'drift') {
    console.log('\n与现有声明的差异:');
    if (rec.undeclared.length) console.log(`  检出未声明: ${rec.undeclared.map(label).join(', ')}`);
    if (rec.unknown.length) console.log(`  未知 id: ${rec.unknown.join(', ')}`);
  } else if (rec.status === 'match') {
    console.log('\n现有声明与检出一致。');
  }
  console.log('\n粘贴前请自行核对：检测是模式匹配，可能多报（如注释、示例代码）或漏报（如动态调用）。');
} else {
  console.error(`未知命令: ${command}\n用法: harbor [scan|manifest] [--json] [--evidence] [--no-snapshot] [--check-updates]`);
  process.exit(2);
}

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

const PACKAGE = readJson(new URL('../package.json', import.meta.url)) ?? {};
const MAX_TERMINAL_FIELD = 500;

/**
 * Terminal boundary for every value that did not originate in this file.
 *
 * Plugin manifests, profile names, cached snapshots and registry errors are
 * all attacker-controlled strings. Keep ordinary Unicode and tabs, but turn
 * embedded line breaks into spaces and remove C0/C1/DEL control bytes so OSC,
 * CSI, title changes, hidden text and forged lines cannot reach the terminal.
 * JSON output deliberately bypasses this function: JSON.stringify escapes the
 * bytes and machine readers must receive the original data.
 */
function terminalSafe(value, maxLength = MAX_TERMINAL_FIELD) {
  let text = String(value ?? '');
  text = text.replace(/\r\n|[\r\n\u2028\u2029]/g, ' ');
  text = text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}…`;
  return text;
}

const terminalList = (values, separator = ', ', maxLength = MAX_TERMINAL_FIELD) =>
  terminalSafe((values ?? []).map((value) => terminalSafe(value, maxLength)).join(separator), maxLength);

const VERSION = terminalSafe(PACKAGE.version ?? 'unknown', 80);
const USAGE = `dsh-harbor ${VERSION}

用法:
  harbor [scan] [--json] [--evidence] [--no-snapshot] [--check-updates]
  harbor manifest [dir]
  harbor --help | --version

命令:
  scan             扫描已安装插件（默认命令）
  manifest [dir]   为插件起草待合并的 dsh.capabilities 字段

选项:
  --json           输出完整 JSON 报告
  --evidence       显示每条能力的 file:line 出处
  --no-snapshot    不读取或写入扫描快照
  --check-updates  显式联网检查上游版本
  -h, --help       显示帮助，不执行扫描
  -v, --version    显示版本，不执行扫描`;

function parseArgs(args) {
  // Help/version are side-effect-free global actions. Resolve them before
  // command validation so `harbor scan --help` cannot accidentally scan.
  if (args.includes('--help') || args.includes('-h')) return { action: 'help' };
  if (args.includes('--version') || args.includes('-v')) return { action: 'version' };

  const positionals = args.filter((arg) => !arg.startsWith('-'));
  const commandToken = positionals[0];
  const command = commandToken ?? 'scan';
  if (command !== 'scan' && command !== 'manifest') {
    return { error: `未知命令: ${terminalSafe(command)}`, exitCode: 2 };
  }

  const allowedOptions = command === 'scan'
    ? new Set(['--json', '--evidence', '--no-snapshot', '--check-updates'])
    : new Set();
  const unknownOption = args.find((arg) => arg.startsWith('-') && !allowedOptions.has(arg));
  if (unknownOption) return { error: `未知选项: ${terminalSafe(unknownOption)}`, exitCode: 2 };

  if (command === 'scan' && positionals.length > 1) {
    return { error: `scan 不接受位置参数: ${terminalList(positionals.slice(1), ' ')}`, exitCode: 2 };
  }
  if (command === 'manifest' && positionals.length > 2) {
    return { error: `manifest 只接受一个目录: ${terminalList(positionals.slice(1), ' ')}`, exitCode: 2 };
  }

  return {
    action: command,
    dir: command === 'manifest' ? positionals[1] : undefined,
    flags: new Set(args.filter((arg) => arg.startsWith('--')).map((arg) => arg.slice(2))),
  };
}

// Await the stream callback for machine-readable output. Calling
// process.exit() immediately after console.log() used to cut reports at the
// pipe buffer boundary (commonly 65,536 bytes).
function writeStdout(text) {
  return new Promise((resolveWrite, rejectWrite) => {
    process.stdout.write(text, (error) => error ? rejectWrite(error) : resolveWrite());
  });
}

const label = (capId) => terminalSafe(byId[capId]?.label.zh ?? capId, 160);
const TIER_MARK = { declared: '声明', runtime: '运行时', static: '源码', heuristic: '启发式' };

function renderPlugin(report, { evidence }) {
  const where = report.installs
    .map((i) => {
      const sourceKind = String(i.spec ?? '').startsWith('file:') ? 'file' : 'link';
      return `${terminalSafe(i.profile, 120)}#${terminalSafe(i.position, 30)}${i.linked ? ` ${sourceKind}` : ''}`;
    })
    .join(', ');
  console.log(`\n■ ${terminalSafe(report.name, 180)}@${terminalSafe(report.version, 120)}  [${terminalSafe(where)}]`);
  if (report.description) console.log(`  ${terminalSafe(report.description, 100)}`);

  if (!report.coverage.sourceAvailable) {
    console.log(`  ⓘ 该插件未提供源码（${terminalSafe(report.coverage.bundledFiles, 30)}/${terminalSafe(report.coverage.sourceFiles, 30)} 为构建产物），以下结论基于产物推断`);
  }

  const caps = Object.entries(report.capabilities);
  if (!caps.length) {
    console.log('  能力: (未检出)');
  } else {
    console.log('  能力:');
    for (const [id, finding] of caps) {
      const details = finding.details?.length ? ` — ${terminalList(finding.details, '；', 300)}` : '';
      console.log(`    · ${label(id)} [${terminalSafe(TIER_MARK[finding.tier] ?? finding.tier, 80)}]${details}`);
      if (evidence) {
        for (const e of finding.evidence) {
          console.log(`        ${terminalSafe(e.file, 240)}:${terminalSafe(e.line, 30)}  ${terminalSafe(e.excerpt, 240)}`);
        }
        if (finding.omitted) console.log(`        …另有 ${terminalSafe(finding.omitted, 30)} 处`);
      }
    }
  }

  if (report.hooks.length) console.log(`  消息路径钩子: ${terminalList(report.hooks)}`);
  const { toolNames, routeBases, providerIds } = report.claims;
  if (toolNames.length) console.log(`  工具: ${terminalList(toolNames.slice(0, 8))}${toolNames.length > 8 ? ` +${terminalSafe(toolNames.length - 8, 30)}` : ''}`);
  if (routeBases.length) console.log(`  路由: ${terminalList(routeBases)}`);
  if (providerIds.length) console.log(`  provider: ${terminalList(providerIds)}`);

  const rec = report.reconciliation;
  if (rec.status === 'not-declared') {
    console.log('  声明对账: 未声明 dsh.capabilities');
  } else if (rec.status === 'match') {
    console.log(`  声明对账: ✓ 一致${rec.unused.length ? `（声明宽于实际: ${terminalList(rec.unused.map(label))}）` : ''}`);
  } else {
    const parts = [];
    if (rec.undeclared.length) parts.push(`检出未声明: ${terminalList(rec.undeclared.map(label))}`);
    if (rec.invalidDeclaration) parts.push(`声明格式错误: ${terminalSafe(rec.invalidDeclaration.message)}`);
    const unknown = rec.unknown.filter((id) => id !== rec.invalidDeclaration?.sentinel);
    if (unknown.length) parts.push(`未知 id: ${terminalList(unknown)}`);
    console.log(`  声明对账: ⚠ ${terminalSafe(parts.join(' | '))}`);
  }
}

async function main(args = process.argv.slice(2)) {
  const invocation = parseArgs(args);
  if (invocation.action === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (invocation.action === 'version') {
    console.log(VERSION);
    return 0;
  }
  if (invocation.error) {
    console.error(`${invocation.error}\n\n${USAGE}`);
    return invocation.exitCode;
  }

  const flag = (name) => invocation.flags.has(name);
  if (invocation.action === 'scan') {
    const report = await scan({ snapshot: !flag('no-snapshot') });

    // Upstream is opt-in and network-bearing; the default posture stays
    // offline. JSON callers receive the result at the top level just like the
    // human renderer does instead of silently losing their requested check.
    const upstream = flag('check-updates') ? await checkUpstream(report.plugins) : null;
    if (flag('json')) {
      const jsonReport = upstream ? { ...report, upstream } : report;
      await writeStdout(`${JSON.stringify(jsonReport, null, 2)}\n`);
      return 0;
    }

    console.log(`dsh-harbor — ${terminalSafe(report.plugins.length, 30)} 份第三方插件安装，扫描目录 ${terminalSafe(report.profilesDir)}`);
    for (const plugin of report.plugins) renderPlugin(plugin, { evidence: flag('evidence') });

    console.log('\n──────────');
    if (report.conflicts.length) {
      console.log('冲突与顺序敏感:');
      for (const c of report.conflicts) {
        const mark = c.severity === 'clash' ? '⚠ 撞车' : 'ⓘ 顺序敏感';
        console.log(`  ${mark}  ${terminalSafe(c.kind, 100)} "${terminalSafe(c.key, 240)}"`);
        const owners = c.owners.map((o) => `${terminalSafe(o.name, 180)}[${terminalList(o.profiles, ',', 240)}]`);
        console.log(`         ${terminalList(owners, '  vs  ')}`);
        console.log(`         ${terminalSafe(c.note)}`);
      }
    } else {
      console.log('冲突: 无');
    }

    if (report.versionDrift.length) {
      console.log('\n版本不一致:');
      for (const f of report.versionDrift) {
        const highestInstalled = f.highestInstalled ?? f.newest;
        console.log(`  ${terminalSafe(f.name, 180)}  本机已安装最高 ${terminalSafe(highestInstalled, 120)}`);
        for (const row of f.rows) {
          // ASCII only, no colour escapes: this output must stay safe to redirect.
          const mark = row.behind ? '↓ ' : '';
          const local = row.kind === 'link' ? '  (本地 link)' : row.kind === 'file' ? '  (本地 file)' : '';
          console.log(`    ${mark}${terminalSafe(row.version, 120)}  ${terminalList(row.profiles, ' ', 300)}${local}`);
        }
      }
    } else {
      console.log('\n版本: 可比较的 registry 安装未发现版本分歧（link/file 不参与）');
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
        const where = profiles?.length ? ` [${terminalList(profiles, ', ', 300)}]` : '';
        const name = terminalSafe(r.name, 180);
        const installed = terminalSafe(r.installed, 120);
        const latest = terminalSafe(r.latest, 120);
        if (r.status === 'behind') console.log(`  ⬆ ${name}@${installed}${where} → ${latest}（上游更新）`);
        else if (r.status === 'current') console.log(`  ✓ ${name}@${installed}${where} 已是最新`);
        else if (r.status === 'ahead') console.log(`  ▲ ${name}@${installed}${where} 比上游新（上游 ${latest}）`);
        else if (r.status === 'local') console.log(`  · ${name}@${installed}${where}（本地安装，无上游可比）`);
        else console.log(`  ? ${name}@${installed}${where}（查询失败: ${terminalSafe(r.error ?? '未知')}）`);
      }
      const registrySummary = upstream.registryHosts.length
        ? `本次联系了 registry: ${terminalList(upstream.registryHosts)}`
        : '本次未联系 registry（本地安装或缓存命中）';
      console.log(`  （${registrySummary}）`);
    }

    const snap = report.snapshot;
    if (snap.warning) console.log(`\n快照: ${terminalSafe(snap.warning)}`);
    if (snap.firstRun) {
      console.log('\n变化: 首次扫描，已建立基线');
    } else if (snap.changes.length) {
      console.log(`\n自上次扫描（${terminalSafe(snap.previousScanAt ?? '未知时间', 120)}）:`);
      for (const c of snap.changes) {
        const where = c.profiles?.length ? ` [${terminalList(c.profiles, ',', 300)}]` : '';
        console.log(`  ${terminalSafe(c.plugin, 180)}${where}  ${terminalSafe(c.detail)}`);
      }
    } else {
      console.log('\n变化: 无');
    }

    if (!flag('evidence')) console.log('\n（加 --evidence 查看每条能力的 file:line 出处，--json 输出完整报告）');
    return 0;
  }

  const dir = resolve(invocation.dir ?? process.cwd());
  const pkg = readJson(join(dir, 'package.json'));
  if (!pkg) {
    console.error(`找不到 package.json: ${terminalSafe(dir)}`);
    return 1;
  }

  const report = inspectPlugin({ name: pkg.name ?? '(unnamed)', dir, installs: [] });
  const draft = draftManifest(report);
  const rec = reconcile(report);

  console.log(`${terminalSafe(pkg.name ?? dir, 240)} — 检出 ${terminalSafe(draft.capabilities.length, 30)} 项能力\n`);
  console.log('把以下对象的字段合并到 package.json 的 "dsh" 对象中（若不存在则新建）；不要覆盖已有的 bundle/client 等配置：');
  console.log(draft.json);
  console.log('\n逐条核对:');
  if (!draft.notes.length) console.log('  （未检出能力）');
  for (const note of draft.notes) console.log(`  ${terminalSafe(note)}`);

  if (rec.status === 'drift') {
    console.log('\n与现有声明的差异:');
    if (rec.undeclared.length) console.log(`  检出未声明: ${terminalList(rec.undeclared.map(label))}`);
    if (rec.invalidDeclaration) console.log(`  声明格式错误: ${terminalSafe(rec.invalidDeclaration.message)}`);
    const unknown = rec.unknown.filter((id) => id !== rec.invalidDeclaration?.sentinel);
    if (unknown.length) console.log(`  未知 id: ${terminalList(unknown)}`);
  } else if (rec.status === 'match') {
    console.log('\n现有声明与检出一致。');
  }
  console.log('\n合并前请自行核对：检测是模式匹配，可能多报（如注释、示例代码）或漏报（如动态调用）。');
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  // Do not let Node's default stack printer reintroduce attacker-controlled
  // paths/messages after every normal human-readable field was sanitised.
  console.error(`harbor: ${terminalSafe(error?.message ?? error)}`);
  process.exitCode = 1;
}

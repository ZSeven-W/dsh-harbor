#!/usr/bin/env node
// harbor CLI — dependency-free, runs without DSH installed (CI included).
//
//   harbor scan [--json] [--evidence] [--no-snapshot] [--check-updates]
//   harbor manifest [dir]     draft a dsh.capabilities block for your own plugin
//   harbor preflight [--dsh <version|tag>] [--json] [--list]
//                    [--plugin <dir>]... [--pack <npm spec>]...
//                             would the installed plugins (or the given ones) still load on that DSH?
//   harbor host-diff --from <version> --to <version> [--json]
//                             what did DSH remove/add between two versions (packages, client modules, exports)?
//
// Output is deliberately plain: capabilities, evidence, conflicts, changes.
// No scores, no severity colours for capabilities — a subprocess is a fact,
// not a verdict.

import { scan, inspectPlugin, draftManifest, reconcile, byId, checkUpstream } from './scan/index.mjs';
import { readJson } from './scan/discover.mjs';
import { preflight, listHostVersions, listCachedHosts } from './preflight/index.mjs';
import { hostDiff, renderHostDiffMarkdown } from './preflight/host-diff.mjs';
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
  harbor preflight [--dsh <版本|dist-tag>] [--json] [--list]
  harbor preflight --dsh <目标> --plugin <目录> [--plugin ...] | --pack <npm 包> [--pack ...]
  harbor host-diff --from <版本> --to <版本> [--json]
  harbor --help | --version

命令:
  scan             扫描已安装插件（默认命令）
  manifest [dir]   为插件起草待合并的 dsh.capabilities 字段
  preflight        升级预检：把目标版本的 DSH 装进隔离目录，逐个插件做 import 探针、
                   client inject 核对、peer 范围核对，回答"升级后 profile 还能不能起来"

选项:
  --json           输出完整 JSON 报告
  --evidence       显示每条能力的 file:line 出处
  --no-snapshot    不读取或写入扫描快照
  --check-updates  显式联网检查上游版本
  --dsh <目标>     preflight 的目标 DSH 版本或 dist-tag（默认 latest；dist-tag 需联网解析）
  --list           preflight 只列出上游 dist-tags、最近版本和本机已缓存的宿主树
  host-diff        两个 DSH 版本之间的契约差异：删掉/新增的包、web 客户端模块、内置预设、每个包的导出
  --plugin <目录>   预检指定目录里的插件（可重复），不再扫描 profile；给 CI 用
  --pack <npm 包>   从 registry 拉取该包（name 或 name@version）做预检（可重复）
  -h, --help       显示帮助，不执行扫描
  -v, --version    显示版本，不执行扫描`;

function parseArgs(args) {
  // Help/version are side-effect-free global actions. Resolve them before
  // command validation so `harbor scan --help` cannot accidentally scan.
  if (args.includes('--help') || args.includes('-h')) return { action: 'help' };
  if (args.includes('--version') || args.includes('-v')) return { action: 'version' };

  // `--dsh <value>` takes the next token; fold it into `--dsh=<value>` so the
  // positional/option split below stays trivial.
  const folded = [];
  const VALUE_OPTIONS = new Set(['--dsh', '--plugin', '--pack', '--from', '--to']);
  for (let i = 0; i < args.length; i++) {
    if (VALUE_OPTIONS.has(args[i]) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      folded.push(`${args[i]}=${args[i + 1]}`);
      i++;
    } else {
      folded.push(args[i]);
    }
  }
  args = folded;

  const positionals = args.filter((arg) => !arg.startsWith('-'));
  const commandToken = positionals[0];
  const command = commandToken ?? 'scan';
  if (command !== 'scan' && command !== 'manifest' && command !== 'preflight' && command !== 'host-diff') {
    return { error: `未知命令: ${terminalSafe(command)}`, exitCode: 2 };
  }

  const allowedOptions = command === 'scan'
    ? new Set(['--json', '--evidence', '--no-snapshot', '--check-updates'])
    : command === 'preflight'
      ? new Set(['--json', '--list'])
      : command === 'host-diff'
        ? new Set(['--json'])
        : new Set();
  if (command === 'preflight' && args.includes('--dsh')) return { error: '--dsh 需要一个版本或 dist-tag', exitCode: 2 };
  if (command === 'preflight' && args.includes('--plugin')) return { error: '--plugin 需要一个目录', exitCode: 2 };
  if (command === 'preflight' && args.includes('--pack')) return { error: '--pack 需要一个 npm 包名', exitCode: 2 };
  const unknownOption = args.find((arg) => arg.startsWith('-') && !allowedOptions.has(arg)
    && !(command === 'preflight' && /^--(dsh|plugin|pack)=/.test(arg))
    && !(command === 'host-diff' && /^--(from|to)=/.test(arg)));
  if (unknownOption) return { error: `未知选项: ${terminalSafe(unknownOption)}`, exitCode: 2 };
  if (command === 'host-diff') {
    const from = args.find((a) => a.startsWith('--from='))?.slice(7);
    const to = args.find((a) => a.startsWith('--to='))?.slice(5);
    if (!from || !to) return { error: 'host-diff 需要 --from <版本> 和 --to <版本>', exitCode: 2 };
    if (positionals.length > 1) return { error: `host-diff 不接受位置参数: ${terminalList(positionals.slice(1), ' ')}`, exitCode: 2 };
    return { action: 'host-diff', from, to, flags: new Set(args.filter((arg) => arg === '--json').map((arg) => arg.slice(2))) };
  }
  const pluginDirs = args.filter((arg) => arg.startsWith('--plugin=')).map((arg) => arg.slice('--plugin='.length));
  const packs = args.filter((arg) => arg.startsWith('--pack=')).map((arg) => arg.slice('--pack='.length));
  if (pluginDirs.some((d) => d === '') || packs.some((p) => p === '')) return { error: '--plugin/--pack 的值不能为空', exitCode: 2 };
  const dshOption = args.find((arg) => arg.startsWith('--dsh='));
  const target = dshOption === undefined ? undefined : dshOption.slice('--dsh='.length);
  if (target === '') return { error: '--dsh 需要一个版本或 dist-tag', exitCode: 2 };

  if (command === 'scan' && positionals.length > 1) {
    return { error: `scan 不接受位置参数: ${terminalList(positionals.slice(1), ' ')}`, exitCode: 2 };
  }
  if (command === 'manifest' && positionals.length > 2) {
    return { error: `manifest 只接受一个目录: ${terminalList(positionals.slice(1), ' ')}`, exitCode: 2 };
  }
  if (command === 'preflight' && positionals.length > 1) {
    return { error: `preflight 不接受位置参数: ${terminalList(positionals.slice(1), ' ')}`, exitCode: 2 };
  }

  return {
    action: command,
    dir: command === 'manifest' ? positionals[1] : undefined,
    target,
    pluginDirs,
    packs,
    flags: new Set(args.filter((arg) => arg.startsWith('--') && !/^--(dsh|plugin|pack)=/.test(arg)).map((arg) => arg.slice(2))),
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

  if (invocation.action === 'preflight') return runPreflight(invocation, flag);
  if (invocation.action === 'host-diff') {
    const progress = (line) => console.error(`  · ${terminalSafe(line, 300)}`);
    const diff = await hostDiff(invocation.from, invocation.to, { onLog: progress });
    if (flag('json')) { await writeStdout(`${JSON.stringify(diff, null, 2)}\n`); return diff.summary.breaking ? 3 : 0; }
    // Markdown carries registry-controlled names; keep the terminal boundary.
    for (const line of renderHostDiffMarkdown(diff).split('\n')) console.log(terminalSafe(line, 400));
    return diff.summary.breaking ? 3 : 0;
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

const VERDICT_MARK = {
  'blocks-boot': '✖ 拖崩启动',
  ok: '✓ 可加载',
  unknown: '? 未探测',
  unresolvable: '? 无法解析',
};

async function runPreflight(invocation, flag) {
  if (flag('list')) {
    const listing = await listHostVersions();
    const cached = listCachedHosts();
    if (flag('json')) {
      await writeStdout(`${JSON.stringify({ listing, cached }, null, 2)}\n`);
      return 0;
    }
    console.log(`@deepseek-ai/dsh 上游（${terminalSafe(listing.registry ?? 'registry')}）`);
    for (const [tag, version] of Object.entries(listing.tags)) console.log(`  ${terminalSafe(tag, 40).padEnd(8)} → ${terminalSafe(version, 60)}`);
    console.log(`  最近版本: ${terminalList(listing.versions, ', ')}`);
    console.log(cached.length ? '本机已缓存的宿主树:' : '本机已缓存的宿主树: 无');
    for (const c of cached) console.log(`  ${terminalSafe(c.version, 60)}  ${terminalSafe(c.prefix)}`);
    return 0;
  }

  const target = invocation.target ?? 'latest';
  // Progress always goes to stderr, JSON or not: stdout stays a clean report
  // for machine callers, and the hub streams stderr into the panel log.
  const progress = (line) => console.error(`  · ${terminalSafe(line, 300)}`);
  const explicit = invocation.pluginDirs.length > 0 || invocation.packs.length > 0;
  const report = await preflight(target, {
    onLog: progress,
    ...(explicit ? {
      plugins: invocation.pluginDirs.map((d) => resolve(d)),
      packs: invocation.packs,
    } : {}),
  });
  if (flag('json')) {
    await writeStdout(`${JSON.stringify(report, null, 2)}\n`);
    return report.summary.allProfilesBoot ? 0 : 3;
  }

  const t = report.target;
  console.log(`\ndsh-harbor 升级预检 — 目标 DSH ${terminalSafe(t.version, 60)}${t.requested !== t.version ? `（${terminalSafe(t.requested, 40)}）` : ''}，当前 ${terminalSafe(report.current.version ?? '未知', 60)}`);
  console.log(`宿主树: ${terminalSafe(report.host.prefix)}${report.host.cached ? '（缓存）' : '（本次安装）'}，${terminalSafe(report.host.packages, 20)} 个官方包，${terminalSafe(report.host.clientModules, 20)} 个 web 客户端模块`);
  const order = { 'blocks-boot': 0, unresolvable: 1, unknown: 2, ok: 3 };
  const rows = [...report.plugins].sort((a, b) => (order[a.verdict] ?? 9) - (order[b.verdict] ?? 9) || a.name.localeCompare(b.name));
  for (const p of rows) {
    const advisory = p.advisories.length ? `  ⚠ ${terminalSafe(p.advisories.length, 20)} 条声明过期` : '';
    console.log(`\n${terminalSafe(VERDICT_MARK[p.verdict] ?? p.verdict, 40)}  ${terminalSafe(p.name, 180)}@${terminalSafe(p.version ?? '?', 60)}  [${terminalList(p.profiles, ', ', 200)}]${advisory}`);
    if (p.import.status === 'fail' && p.verdict === 'unresolvable') console.log(`    无法探测（插件自身依赖或获取失败，不是宿主问题）${terminalSafe(p.import.code, 60)}: ${terminalSafe(p.import.message, 400)}`);
    else if (p.import.status === 'fail') console.log(`    import 失败 ${terminalSafe(p.import.code, 60)}: ${terminalSafe(p.import.message, 400)}`);
    else if (p.import.status === 'ok') console.log(`    import 通过，链接到 ${terminalSafe(p.import.resolved.length, 20)} 个宿主包`);
    else console.log(`    import 跳过: ${terminalSafe(p.import.reason ?? '', 200)}`);
    const dead = p.advisories.filter((a) => a.kind === 'dead-inject');
    if (dead.length) console.log(`    client ${terminalList(dead.map((a) => `${a.field}:${a.id}`), ', ', 300)} 在目标宿主中不存在（0.1.5 起加载器静默跳过）`);
    const ranges = p.advisories.filter((a) => a.kind === 'peer-range');
    if (ranges.length) console.log(`    peer 范围不含目标版本: ${terminalList(ranges.map((a) => `${a.name} ${a.range}`), ', ', 400)}`);
    const missing = p.advisories.filter((a) => a.kind === 'peer-missing');
    if (missing.length) console.log(`    peer 目标宿主未提供: ${terminalList(missing.map((a) => a.name), ', ', 400)}`);
  }
  const ap = report.settings.agentPresets;
  if (ap.status === 'invalid') {
    console.log(`\n⚠ 用户设置 agent-presets.default = "${terminalSafe(ap.wanted, 60)}" 不在目标版本的预设里（可用: ${terminalList(ap.available, ', ')}）；升级后新建会话会报 agent-preset/not-found`);
  }
  const c = report.summary.counts;
  if (report.subjects === 'profiles') {
    console.log('\nprofile 结论:');
    for (const [profile, state] of Object.entries(report.summary.profiles)) {
      console.log(state.boots
        ? `  ✓ ${terminalSafe(profile, 120)} 升级后可以启动`
        : `  ✖ ${terminalSafe(profile, 120)} 升级后起不来（${terminalList(state.blockedBy, ', ', 300)}）`);
    }
  }
  console.log(`\n合计: 拖崩 ${terminalSafe(c['blocks-boot'], 20)} · 可加载 ${terminalSafe(c.ok, 20)} · 无法解析 ${terminalSafe(c.unresolvable ?? 0, 20)} · 未探测 ${terminalSafe(c.unknown, 20)} · 带过期声明 ${terminalSafe(c.withAdvisories, 20)}`);
  return report.summary.allProfilesBoot ? 0 : 3;
}

try {
  process.exitCode = await main();
} catch (error) {
  // Do not let Node's default stack printer reintroduce attacker-controlled
  // paths/messages after every normal human-readable field was sanitised.
  console.error(`harbor: ${terminalSafe(error?.message ?? error)}`);
  process.exitCode = 1;
}

#!/usr/bin/env node
// Probe one shard of the registry against one DSH version.
//   node scripts/board/run.mjs --dsh 0.1.5-rc.2 --shard 0 --shards 8 [--full]
// Incremental by default: a package whose (name, version, dsh) triple already
// has a result in board/results/<dsh>/ is skipped. Writes one JSON per shard.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preflight } from '../../src/preflight/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : [])).filter((x) => x.length));
const dsh = String(args.dsh ?? 'latest');
const shard = Number(args.shard ?? 0);
const shards = Number(args.shards ?? 1);
const full = args.full === true;
const batch = Number(args.batch ?? 25);

const root = new URL('../../board/', import.meta.url).pathname;
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const resultsDir = join(root, 'results', dsh);
mkdirSync(resultsDir, { recursive: true });
const outFile = join(resultsDir, `shard-${shard}.json`);
let previous = {};
try { previous = JSON.parse(readFileSync(outFile, 'utf8')).results ?? {}; } catch { /* first run */ }

const mine = registry.plugins.filter((_, i) => i % shards === shard);
const todo = full ? mine : mine.filter((p) => previous[p.name]?.version !== p.version);
process.stderr.write(`shard ${shard}/${shards}: ${mine.length} plugins, ${todo.length} to probe against ${dsh}\n`);

const results = { ...previous };
const packRoot = join(tmpdir(), `dsh-harbor-board-${shard}`);
let hostVersion = null;
for (let i = 0; i < todo.length; i += batch) {
  const specs = todo.slice(i, i + batch).map((p) => `${p.name}@${p.version}`);
  rmSync(packRoot, { recursive: true, force: true });
  const report = await preflight(dsh, { packs: specs, packRoot, onLog: (l) => process.stderr.write(`  · ${l}\n`) });
  hostVersion = report.target.version;
  for (const row of report.plugins) {
    const spec = row.spec;
    const name = spec.replace(/@[^@/]+$/, '');
    results[name] = {
      version: row.version ?? spec.slice(name.length + 1),
      dsh: report.target.version,
      verdict: row.verdict,
      import: row.import.status === 'fail' ? { code: row.import.code, message: String(row.import.message ?? '').slice(0, 400) } : { status: row.import.status, resolved: row.import.resolved?.length ?? 0 },
      advisories: row.advisories,
      probedAt: report.finishedAt,
    };
  }
  writeFileSync(outFile, `${JSON.stringify({ dsh: hostVersion ?? dsh, shard, shards, results }, null, 2)}\n`);
}
rmSync(packRoot, { recursive: true, force: true });
if (!existsSync(outFile)) writeFileSync(outFile, `${JSON.stringify({ dsh, shard, shards, results }, null, 2)}\n`);
const counts = {};
for (const r of Object.values(results)) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
process.stderr.write(`shard ${shard} done: ${JSON.stringify(counts)}\n`);

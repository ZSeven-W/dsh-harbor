#!/usr/bin/env node
// Release watcher: compare @deepseek-ai/dsh dist-tags with the committed
// state file. Prints a JSON line describing the change and exits 0 when
// something moved, 1 when nothing did (so a workflow can gate later steps on
// the exit code without parsing). `--write` updates the state file.
//
//   node scripts/watch-dsh.mjs            # report only
//   node scripts/watch-dsh.mjs --write    # report and persist
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { listHostVersions } from '../src/preflight/host.mjs';

const STATE = new URL('../board/state/dsh-versions.json', import.meta.url);
const write = process.argv.includes('--write');

let previous = { tags: {}, versions: [] };
try { previous = JSON.parse(readFileSync(STATE, 'utf8')); } catch { /* first run */ }

const listing = await listHostVersions({ limit: 40 });
const tagMoves = Object.entries(listing.tags)
  .filter(([tag, version]) => previous.tags?.[tag] !== version)
  .map(([tag, version]) => ({ tag, from: previous.tags?.[tag] ?? null, to: version }));
const newVersions = listing.versions.filter((v) => !(previous.versions ?? []).includes(v));

const change = { changed: tagMoves.length > 0 || newVersions.length > 0, tagMoves, newVersions, checkedAt: listing.checkedAt };
process.stdout.write(`${JSON.stringify(change)}\n`);

if (write) {
  mkdirSync(dirname(STATE.pathname), { recursive: true });
  writeFileSync(STATE, `${JSON.stringify({ tags: listing.tags, versions: listing.versions, checkedAt: listing.checkedAt }, null, 2)}\n`);
}
process.exitCode = change.changed ? 0 : 1;

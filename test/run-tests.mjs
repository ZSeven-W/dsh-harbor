// Cross-platform test discovery for every supported Node release.
// Node 20 does not expand a quoted `test/*.test.mjs` glob, while Windows cmd
// never expands shell globs. Build the explicit file list in JavaScript.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
  .map((entry) => join(dir, entry.name))
  .sort();

if (files.length === 0) throw new Error('no *.test.mjs files discovered');

const result = spawnSync(process.execPath, ['--test', ...files], {
  env: process.env,
  stdio: 'inherit',
  shell: false,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

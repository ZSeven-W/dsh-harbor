// Contract diff between two host trees: package/client-module/preset/export
// deltas, the breaking flag, the export collector child, and the Markdown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostDiff, collectExports, renderHostDiffMarkdown } from '../src/preflight/host-diff.mjs';
import { readHostInventory } from '../src/preflight/host.mjs';

function tree(root, version, pkgs) {
  const prefix = join(root, version);
  const dir = join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai');
  for (const [name, { exports = [], client = false }] of Object.entries(pkgs)) {
    const d = join(dir, name.replace('@deepseek-ai/', ''));
    mkdirSync(join(d, 'lib'), { recursive: true });
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name, version, type: 'module', main: 'lib/index.js', ...(client ? { dsh: { client: { platform: 'web' } } } : {}) }));
    writeFileSync(join(d, 'lib', 'index.js'), exports.map((e) => `export const ${e} = 1;`).join('\n') + '\n');
  }
  writeFileSync(join(prefix, '.harbor-host-complete.json'), JSON.stringify({ version }));
  return { version, prefix, treeDir: dir, cached: true, installedAt: null };
}

test('host-diff: removals across packages, client modules and exports set the breaking flag', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-hostdiff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const hosts = {
    '1.0.0': tree(root, '1.0.0', {
      '@deepseek-ai/dsh-settings': { exports: ['SettingsProvider', 'settingsNamespace'] },
      '@deepseek-ai/dsh-client-runtime': { exports: ['apply'], client: true },
      '@deepseek-ai/dsh-tools': { exports: ['defineTool'] },
    }),
    '2.0.0': tree(root, '2.0.0', {
      '@deepseek-ai/dsh-settings': { exports: ['SettingsProvider', 'redactSecrets'] },
      '@deepseek-ai/dsh-client-ui-renderer': { exports: ['apply'], client: true },
      '@deepseek-ai/dsh-tools': { exports: ['defineTool'] },
    }),
  };
  const d = await hostDiff('1.0.0', '2.0.0', { ensureHostImpl: async (v) => hosts[v] });
  assert.deepEqual(d.packages, { added: ['@deepseek-ai/dsh-client-ui-renderer'], removed: ['@deepseek-ai/dsh-client-runtime'] });
  assert.deepEqual(d.clientModules, { added: ['@deepseek-ai/dsh-client-ui-renderer'], removed: ['@deepseek-ai/dsh-client-runtime'] });
  assert.deepEqual(d.exports, [{ name: '@deepseek-ai/dsh-settings', added: ['redactSecrets'], removed: ['settingsNamespace'] }]);
  assert.equal(d.summary.breaking, true);
  assert.equal(d.summary.exportsRemovedIn, 1);
  const md = renderHostDiffMarkdown(d);
  assert.match(md, /## DSH 1\.0\.0 → 2\.0\.0/);
  assert.match(md, /Packages removed[\s\S]*dsh-client-runtime/);
  assert.match(md, /Exports removed[\s\S]*dsh-settings`: `settingsNamespace`/);
  assert.match(md, /Contains removals/);

  const same = await hostDiff('2.0.0', '2.0.0', { ensureHostImpl: async (v) => hosts[v] });
  assert.equal(same.summary.breaking, false);
  assert.match(renderHostDiffMarkdown(same), /No removals detected/);
});

test('host-diff: collectExports tolerates a package whose entry throws', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harbor-hostdiff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const host = tree(root, '3.0.0', { '@deepseek-ai/dsh-ok': { exports: ['a', 'b'] } });
  const bad = join(host.treeDir, 'dsh-bad');
  mkdirSync(join(bad, 'lib'), { recursive: true });
  writeFileSync(join(bad, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-bad', version: '3.0.0', type: 'module', main: 'lib/index.js' }));
  writeFileSync(join(bad, 'lib', 'index.js'), "throw new Error('nope');\n");
  const out = await collectExports(readHostInventory(host.treeDir));
  assert.deepEqual(out['@deepseek-ai/dsh-ok'], { exports: ['a', 'b'] });
  assert.match(out['@deepseek-ai/dsh-bad'].error, /nope/);
});

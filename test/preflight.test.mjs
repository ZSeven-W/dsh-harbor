// Upgrade preflight: semver range semantics (npm prerelease rule), the four
// checks against a fixture host tree, the real import probe in a child
// process, host listing/installation with fakes, and the orchestrator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { satisfies, compareVersions, parseVersion } from '../src/preflight/semver.mjs';
import {
  ensureHost, hostPresetIds, hostTreeDir, listCachedHosts, listHostVersions,
  readHostInventory, readSettingsSection, resolveHostVersion,
} from '../src/preflight/host.mjs';
import { checkInject, checkPeers, checkPresetSetting, probeImport, serverEntry } from '../src/preflight/checks.mjs';
import { preflight } from '../src/preflight/index.mjs';

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'harbor-preflight-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writePkg(dir, manifest, files = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
}

/** A fake DSH host tree in the POSIX global-prefix layout. */
function fakeHost(root, version = '9.9.9', { withSettingsNamespace = false } = {}) {
  const prefix = join(root, 'hosts', version);
  const tree = join(prefix, 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai');
  writePkg(join(tree, 'dsh-settings'), { name: '@deepseek-ai/dsh-settings', version, type: 'module', main: 'lib/index.js' }, {
    'lib/index.js': withSettingsNamespace
      ? 'export function settingsNamespace(v) { return v; }\nexport class SettingsProvider {}\n'
      : 'export class SettingsProvider {}\n',
  });
  writePkg(join(tree, 'dsh-tools'), { name: '@deepseek-ai/dsh-tools', version, type: 'module', main: 'lib/index.js' }, {
    'lib/index.js': 'export function defineTool(t) { return t; }\n',
  });
  writePkg(join(tree, 'dsh-client-ui-renderer'), { name: '@deepseek-ai/dsh-client-ui-renderer', version, dsh: { client: { platform: 'web' } } });
  writePkg(join(tree, 'dsh-client-locale'), { name: '@deepseek-ai/dsh-client-locale', version, dsh: { client: { platform: 'web' } } });
  mkdirSync(join(tree, 'dsh-agent-presets', 'presets', 'ptc'), { recursive: true });
  mkdirSync(join(tree, 'dsh-agent-presets', 'presets', 'standard'), { recursive: true });
  writeFileSync(join(tree, 'dsh-agent-presets', 'presets', 'ptc', 'preset.yml'), 'name: ptc\n');
  writeFileSync(join(tree, 'dsh-agent-presets', 'presets', 'standard', 'preset.yml'), 'name: standard\n');
  writePkg(join(tree, 'dsh-agent-presets'), { name: '@deepseek-ai/dsh-agent-presets', version });
  writeFileSync(join(prefix, '.harbor-host-complete.json'), JSON.stringify({ version, installedAt: '2026-09-11T00:00:00.000Z' }));
  return { prefix, tree };
}

test('semver: npm prerelease rule and common range shapes', () => {
  assert.equal(satisfies('0.1.5-rc.1', '^0.1.0-rc.6'), 'unsatisfied');
  assert.equal(satisfies('0.1.5-rc.2', '^0.1.5-rc.1'), 'satisfied');
  assert.equal(satisfies('0.1.5', '^0.1.5-rc.1'), 'satisfied');
  assert.equal(satisfies('0.2.0', '^0.1.5-rc.1'), 'unsatisfied');
  assert.equal(satisfies('4.0.2', '^4.0.1'), 'satisfied');
  assert.equal(satisfies('5.0.0', '^4.0.1'), 'unsatisfied');
  assert.equal(satisfies('1.2.3', '~1.2.0'), 'satisfied');
  assert.equal(satisfies('1.3.0', '~1.2.0'), 'unsatisfied');
  assert.equal(satisfies('18.3.1', '^18.0.0 || ^19.0.0'), 'satisfied');
  assert.equal(satisfies('1.0.0', '1.x'), 'satisfied');
  assert.equal(satisfies('1.0.0', '*'), 'satisfied');
  assert.equal(satisfies('0.1.0-rc.6', '0.1.0-rc.6'), 'satisfied');
  assert.equal(satisfies('0.1.5-rc.1', '>=0.1.0-rc.6'), 'unsatisfied');
  assert.equal(satisfies('0.1.5-rc.1', '>=0.1.5-rc.1'), 'satisfied');
  assert.equal(satisfies('1.0.0', '1.0.0 - 2.0.0'), 'unparseable');
  assert.equal(satisfies('garbage', '^1.0.0'), 'unparseable');
  assert.equal(compareVersions('0.1.5-rc.2', '0.1.5-rc.1'), 1);
  assert.equal(compareVersions('0.1.5', '0.1.5-rc.9'), 1);
  assert.equal(compareVersions('0.1.5-alpha.2', '0.1.5-rc.1'), -1);
  assert.equal(parseVersion('v1.2.3').patch, 3);
});

test('host: inventory, presets, cached listing, settings section', (t) => {
  const root = sandbox(t);
  const { prefix, tree } = fakeHost(root);
  assert.equal(hostTreeDir(prefix), tree);
  const inventory = readHostInventory(tree);
  assert.equal(inventory.packages.get('@deepseek-ai/dsh-settings').version, '9.9.9');
  assert.deepEqual([...inventory.clientIds].sort(), ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-renderer']);
  assert.deepEqual(hostPresetIds(tree), ['ptc', 'standard']);
  assert.deepEqual(listCachedHosts(join(root, 'hosts')).map((h) => h.version), ['9.9.9']);

  const settings = join(root, 'settings.yaml');
  writeFileSync(settings, 'ui-theme:\n  preference: light\nagent-presets:\n  default: code\n  # comment\n  other: "x"\nlocale:\n  preference: zh\n');
  assert.deepEqual(readSettingsSection(settings, 'agent-presets'), { default: 'code', other: 'x' });
  assert.equal(readSettingsSection(settings, 'missing'), null);
  assert.equal(readSettingsSection(join(root, 'nope.yaml'), 'agent-presets'), null);
});

test('host: resolveHostVersion accepts versions and dist-tags only', () => {
  const listing = { tags: { latest: '0.1.5-rc.1', next: '0.1.5-rc.2' }, versions: [] };
  assert.equal(resolveHostVersion('next', listing), '0.1.5-rc.2');
  assert.equal(resolveHostVersion('0.1.4', listing), '0.1.4');
  assert.throws(() => resolveHostVersion('nightly', listing), /unknown DSH version or dist-tag/);
  assert.throws(() => resolveHostVersion('', listing), /unknown DSH version/);
});

test('host: listHostVersions reads abbreviated metadata through the fake fetch', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, accept: init.headers.accept });
    return {
      ok: true,
      json: async () => ({ 'dist-tags': { latest: '0.1.5-rc.1', next: '0.1.5-rc.2' }, versions: { '0.1.1-rc.2': {}, '0.1.5-rc.2': {}, '0.1.5-rc.1': {}, 'bogus': {} } }),
    };
  };
  const listing = await listHostVersions({ fetchImpl, limit: 2 });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/@deepseek-ai/dsh'));
  assert.equal(calls[0].accept, 'application/vnd.npm.install-v1+json');
  assert.deepEqual(listing.tags, { latest: '0.1.5-rc.1', next: '0.1.5-rc.2' });
  assert.deepEqual(listing.versions, ['0.1.5-rc.2', '0.1.5-rc.1']);
});

test('host: ensureHost reuses a completed prefix and otherwise runs npm once', async (t) => {
  const root = sandbox(t);
  const hosts = join(root, 'hosts');
  fakeHost(root, '9.9.9');
  const spawned = [];
  const spawnImpl = (cmd, args, opts) => {
    spawned.push({ cmd, args, cwd: opts.cwd });
    // Emulate npm creating the tree, then exiting 0.
    const listeners = {};
    const child = {
      stdout: { on(ev, fn) { if (ev === 'data') setTimeout(() => fn('added 240 packages\n'), 0); } },
      stderr: { on() {} },
      on(ev, fn) { listeners[ev] = fn; },
      kill() {},
    };
    setTimeout(() => {
      const prefix = args[args.indexOf('--prefix') + 1];
      const version = args.find((a) => a.startsWith('@deepseek-ai/dsh@')).split('@').pop();
      fakeHost(root, version);
      rmSync(join(prefix, '.harbor-host-complete.json'), { force: true });
      listeners.close?.(0);
    }, 5);
    return child;
  };
  const logs = [];
  const cached = await ensureHost('9.9.9', { root: hosts, spawnImpl, onLog: (l) => logs.push(l) });
  assert.equal(cached.cached, true);
  assert.equal(spawned.length, 0);

  const fresh = await ensureHost('9.9.10', { root: hosts, spawnImpl, onLog: (l) => logs.push(l) });
  assert.equal(fresh.cached, false);
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0].args.includes('@deepseek-ai/dsh@9.9.10'));
  assert.ok(spawned[0].args.includes('--prefix'));
  assert.ok(logs.some((l) => l.includes('added 240 packages')));
  assert.deepEqual(listCachedHosts(hosts).map((h) => h.version), ['9.9.10', '9.9.9']);
  await assert.rejects(ensureHost('not-a-version', { root: hosts, spawnImpl }), /invalid host version/);
});

test('checks: inject, peers, preset setting', (t) => {
  const root = sandbox(t);
  const { tree } = fakeHost(root);
  const inventory = readHostInventory(tree);
  const manifest = {
    dsh: { client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-tools'], external: ['@other/thing/client'] } },
    peerDependencies: { '@deepseek-ai/dsh-settings': '^0.1.0-rc.6', '@deepseek-ai/dsh-tools': '^9.9.0', '@deepseek-ai/dsh-gone': '^1.0.0', react: '^18' },
    dependencies: { '@deepseek-ai/dsh-settings': '9.9.9' },
  };
  const inject = checkInject(manifest, inventory);
  assert.equal(inject.platform, 'web');
  assert.deepEqual(inject.ids.map((i) => [i.id, i.status]), [
    ['@deepseek-ai/dsh-client-runtime', 'missing'],
    ['@deepseek-ai/dsh-client-locale', 'present'],
    ['@deepseek-ai/dsh-tools', 'not-a-client-module'],
    ['@other/thing/client', 'third-party'],
  ]);
  assert.deepEqual(checkInject({}, inventory), { declared: false, platform: null, ids: [] });

  const peers = checkPeers(manifest, inventory);
  assert.deepEqual(peers.map((p) => [p.field, p.name, p.status]), [
    ['peerDependencies', '@deepseek-ai/dsh-settings', 'unsatisfied'],
    ['peerDependencies', '@deepseek-ai/dsh-tools', 'satisfied'],
    ['peerDependencies', '@deepseek-ai/dsh-gone', 'missing-in-host'],
    ['dependencies', '@deepseek-ai/dsh-settings', 'satisfied'],
  ]);

  const presets = hostPresetIds(tree);
  assert.equal(checkPresetSetting({ default: 'code' }, presets).status, 'invalid');
  assert.equal(checkPresetSetting({ default: 'ptc' }, presets).status, 'ok');
  assert.equal(checkPresetSetting({}, presets).status, 'unset');
  assert.equal(checkPresetSetting(null, presets).status, 'unset');
  assert.equal(checkPresetSetting({ default: 'code' }, []).status, 'unknown');
});

test('checks: serverEntry follows exports["."] then main', (t) => {
  const root = sandbox(t);
  assert.equal(serverEntry(root, { main: 'lib/index.js' }), join(root, 'lib/index.js'));
  assert.equal(serverEntry(root, { exports: { '.': { default: './lib/a.js' } }, main: 'lib/b.js' }), join(root, 'lib/a.js'));
  assert.equal(serverEntry(root, { exports: './lib/c.js' }), join(root, 'lib/c.js'));
  assert.equal(serverEntry(root, {}), null);
});

test('probe: the import binds @deepseek-ai/* to the target tree and reports link-time failures', async (t) => {
  const root = sandbox(t);
  const oldHost = fakeHost(root, '1.0.0', { withSettingsNamespace: true });
  const newHost = fakeHost(root, '2.0.0');

  // A plugin that still imports the export the new host removed. It has its
  // own dependency which must keep resolving from the plugin's real location.
  const plugin = join(root, 'plugins', 'stale');
  writePkg(join(plugin, 'node_modules', 'left-pad'), { name: 'left-pad', version: '1.0.0', type: 'module', main: 'index.js' }, { 'index.js': 'export default (s) => s;\n' });
  writePkg(plugin, { name: '@acme/stale', version: '0.0.1', type: 'module', main: 'lib/index.js' }, {
    'lib/index.js': "import { settingsNamespace } from '@deepseek-ai/dsh-settings';\nimport pad from 'left-pad';\nexport const name = 'stale';\nexport const ns = settingsNamespace(pad('x'));\n",
  });
  const manifest = { name: '@acme/stale', main: 'lib/index.js' };

  const onOld = await probeImport(plugin, manifest, oldHost.tree);
  assert.equal(onOld.status, 'ok', JSON.stringify(onOld));
  assert.deepEqual(onOld.exports, ['name', 'ns']);
  assert.deepEqual(onOld.resolved, ['@deepseek-ai/dsh-settings']);

  const onNew = await probeImport(plugin, manifest, newHost.tree);
  assert.equal(onNew.status, 'fail');
  assert.equal(onNew.code, 'SyntaxError');
  assert.match(onNew.message, /does not provide an export named 'settingsNamespace'/);

  const missingEntry = await probeImport(plugin, { name: 'x', main: 'lib/nope.js' }, newHost.tree);
  assert.equal(missingEntry.status, 'fail');
  assert.equal(missingEntry.code, 'ENTRY_MISSING');
  assert.equal((await probeImport(plugin, {}, newHost.tree)).status, 'skipped');

  const crashing = join(root, 'plugins', 'crash');
  writePkg(crashing, { name: '@acme/crash', version: '0.0.1', type: 'module', main: 'index.js' }, { 'index.js': "throw new Error('boom at import');\n" });
  const boom = await probeImport(crashing, { main: 'index.js' }, newHost.tree);
  assert.equal(boom.status, 'fail');
  assert.equal(boom.code, 'Error');
  assert.match(boom.message, /boom at import/);
});

test('preflight: orchestrates checks per install and summarises per profile', async (t) => {
  const root = sandbox(t);
  const { prefix, tree } = fakeHost(root, '2.0.0');
  const settings = join(root, 'settings.yaml');
  writeFileSync(settings, 'agent-presets:\n  default: code\n');
  const plugins = [
    { name: '@acme/stale', dir: join(root, 'p', 'stale'), identity: 'stale@registry:1', resolvedVersion: '0.0.1', installs: [{ profile: 'web' }, { profile: 'lab' }] },
    { name: '@acme/fine', dir: join(root, 'p', 'fine'), identity: 'fine@registry:1', resolvedVersion: '0.0.2', installs: [{ profile: 'lab' }] },
  ];
  writePkg(plugins[0].dir, { name: '@acme/stale', version: '0.0.1', main: 'lib/index.js', dsh: { client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-runtime'] } }, peerDependencies: { '@deepseek-ai/dsh-tools': '^0.1.0-rc.6' } });
  writePkg(plugins[1].dir, { name: '@acme/fine', version: '0.0.2', main: 'lib/index.js', dsh: { client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-locale'] } }, peerDependencies: { '@deepseek-ai/dsh-tools': '^2.0.0' } });

  const logs = [];
  const report = await preflight('next', {
    root: join(root, 'profiles'),
    listing: { tags: { next: '2.0.0' }, versions: ['2.0.0'] },
    ensureHostImpl: async (version) => ({ version, prefix, treeDir: tree, cached: true, installedAt: null }),
    probeImpl: async (dir) => (dir.endsWith('stale')
      ? { status: 'fail', code: 'SyntaxError', message: 'no export', entry: dir, resolved: [] }
      : { status: 'ok', entry: dir, exports: ['apply'], resolved: ['@deepseek-ai/dsh-tools'] }),
    discover: () => plugins,
    settingsPath: settings,
    onLog: (l) => logs.push(l),
  });

  assert.equal(report.target.version, '2.0.0');
  assert.equal(report.target.requested, 'next');
  assert.equal(report.host.packages, 5);
  assert.equal(report.host.clientModules, 2);
  const [stale, fine] = report.plugins;
  assert.equal(stale.verdict, 'blocks-boot');
  assert.deepEqual(stale.advisories.map((a) => a.kind), ['dead-inject', 'peer-range']);
  assert.equal(fine.verdict, 'ok');
  assert.deepEqual(fine.advisories, []);
  assert.deepEqual(report.summary.profiles, {
    web: { boots: false, blockedBy: ['@acme/stale@0.0.1'] },
    lab: { boots: false, blockedBy: ['@acme/stale@0.0.1'] },
  });
  assert.equal(report.summary.allProfilesBoot, false);
  assert.deepEqual(report.summary.counts, { 'blocks-boot': 1, ok: 1, unknown: 0, withAdvisories: 1 });
  assert.equal(report.settings.agentPresets.status, 'invalid');
  assert.equal(report.summary.settingsIssues, 1);
  assert.ok(logs.some((l) => l.includes('probing @acme/stale')));
});

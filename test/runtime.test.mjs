// Covers live registry enumeration, redaction, coverage honesty, and
// profile-scoped attribution in src/scan/runtime.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRuntimeSurface, attributeSurface } from '../src/scan/runtime.mjs';

test('collectRuntimeSurface enumerates current DSH tool/provider/route shapes', async () => {
  const ctx = {
    tools: { schemas: () => [{ name: 'alpha_tool' }, { name: 'beta_tool' }] },
    llm: { adapters: new Map([['deepseek', { adapter: {} }], ['local-route', { adapter: {} }]]) },
    webServer: {
      exact: new Map([['/_dsh/alpha/ping', { kind: 'exact', path: '/_dsh/alpha/ping' }]]),
      prefixes: new Map([['/_dsh/beta', { kind: 'prefix', path: '/_dsh/beta' }]]),
    },
  };

  const runtime = await collectRuntimeSurface(ctx);
  assert.equal(runtime.available, true);
  assert.deepEqual(runtime.tools, ['alpha_tool', 'beta_tool']);
  assert.deepEqual(runtime.providers, ['deepseek', 'local-route']);
  assert.deepEqual(runtime.routes, ['/_dsh/alpha/ping', '/_dsh/beta']);
  assert.deepEqual(runtime.waterfalls, []);
  assert.deepEqual(runtime.coverage.tools, { enumerated: true, source: 'method:schemas' });
  assert.deepEqual(runtime.coverage.providers, { enumerated: true, source: 'property:adapters' });
  assert.deepEqual(runtime.coverage.routes, { enumerated: true, source: 'properties' });
  assert.deepEqual(runtime.coverage.waterfalls, { enumerated: false, source: null });
  assert.ok(runtime.notes.some((note) => note.includes('waterfall')));
});

test('generic stores never expose URL, apiKey, token, or bare string values as names', async () => {
  const secret = 'sk-live-do-not-leak-123456';
  const endpoint = 'https://private.gateway.invalid/v1';
  const ctx = {
    tools: {
      store: {
        apiKey: secret,
        baseUrl: endpoint,
        token: 'Bearer also-secret',
        real: { name: 'safe_tool', description: 'safe', parameters: {} },
      },
    },
    llm: {
      store: {
        apiKey: secret,
        url: endpoint,
        real: { id: 'safe-provider', adapter: {} },
      },
    },
    webServer: { exact: new Map(), prefixes: new Map() },
  };

  const runtime = await collectRuntimeSurface(ctx);
  assert.deepEqual(runtime.tools, ['safe_tool']);
  assert.deepEqual(runtime.providers, ['safe-provider']);
  const serialized = JSON.stringify(runtime);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(endpoint), false);
  assert.equal(serialized.includes('apiKey'), false);
  assert.equal(serialized.includes('baseUrl'), false);
});

test('generic registries reject nested oauth records and secret-looking identities', async () => {
  const leaked = 'ghp_1234567890abcdefghijklmnop';
  const runtime = await collectRuntimeSurface({
    tools: {
      registry: {
        oauth: {
          name: 'looks_safe', description: 'oauth wrapper', parameters: {},
          oauth: { id: leaked, accessToken: 'opaque-value' },
        },
        direct: { name: leaked, description: 'credential-shaped id', parameters: {} },
      },
    },
    llm: {
      store: {
        oauth: { id: 'looks-safe', adapter: {}, credentials: { token: 'opaque-value' } },
      },
    },
  });
  assert.deepEqual(runtime.tools, []);
  assert.deepEqual(runtime.providers, []);
  assert.equal(JSON.stringify(runtime).includes(leaked), false);
});

test('trusted registries preserve short, uppercase, Unicode, and prototype-looking names', async () => {
  const secret = 'ghp_1234567890abcdefghijklmnop';
  const names = ['x', 'X', '__proto__', '工具'];
  const runtime = await collectRuntimeSurface({
    tools: { schemas: () => [...names, 'https://bad.invalid', secret, '\u0000bad'].map((name) => ({ name })) },
    llm: { adapters: new Map([...names, 'https://bad.invalid', secret].map((name) => [name, {}])) },
  });
  assert.deepEqual(runtime.tools, [...names].sort());
  assert.deepEqual(runtime.providers, [...names].sort());
});

test('a config-only generic store is opaque, not an enumerated empty registry', async () => {
  const runtime = await collectRuntimeSurface({
    tools: { store: { apiKey: 'sk-redacted', baseUrl: 'https://private.invalid' } },
  });
  assert.deepEqual(runtime.tools, []);
  assert.deepEqual(runtime.coverage.tools, { enumerated: false, source: null });
  assert.ok(runtime.notes.some((note) => note.includes('工具服务存在，但未暴露')));
});

test('a known empty accessor is enumerated evidence, not an opaque registry', async () => {
  const runtime = await collectRuntimeSurface({ tools: { schemas: () => [] } });
  assert.deepEqual(runtime.tools, []);
  assert.deepEqual(runtime.coverage.tools, { enumerated: true, source: 'method:schemas' });
  assert.equal(runtime.notes.some((note) => note.includes('工具服务存在，但未暴露')), false);
  assert.equal(runtime.coverage.providers.enumerated, false);
  assert.equal(runtime.coverage.routes.enumerated, false);
});

test('missing host services and waterfalls are explicitly marked as uncovered', async () => {
  const runtime = await collectRuntimeSurface({ get: () => undefined });
  assert.equal(runtime.available, false);
  assert.equal(runtime.coverage.tools.enumerated, false);
  assert.equal(runtime.coverage.waterfalls.enumerated, false);
  assert.ok(runtime.notes.some((note) => note.includes('运行时证据不可采集')));
  assert.ok(runtime.notes.some((note) => note.includes('dispatch mode')));
});

test('ctx.get avoids undeclared optional-service property access', async () => {
  const ctx = new Proxy({
    get(name) {
      if (name === 'tools') return { schemas: () => [{ name: 'from_get' }] };
      return undefined;
    },
  }, {
    get(target, key, receiver) {
      if (key === 'tools' || key === 'llm' || key === 'webServer') throw new Error('not injected');
      return Reflect.get(target, key, receiver);
    },
  });
  const runtime = await collectRuntimeSurface(ctx);
  assert.deepEqual(runtime.tools, ['from_get']);
});

const reports = [
  {
    name: 'plugin-a',
    installs: [{ profile: 'alpha' }],
    claims: {
      toolNames: ['shared_tool'],
      providerIds: ['provider-a'],
      routeBases: ['/_dsh/plugin-a'],
    },
  },
  {
    name: 'plugin-b',
    installs: [{ profile: 'beta' }],
    claims: {
      toolNames: ['shared_tool'],
      providerIds: ['provider-a'],
      routeBases: ['/_dsh/plugin-a'],
    },
  },
];

test('attributeSurface filters ownership to the explicitly selected profile', () => {
  const attribution = attributeSurface({
    tools: ['shared_tool', 'host_tool'],
    providers: ['provider-a'],
    routes: ['/_dsh/plugin-a/report', '/official/health'],
  }, reports, { profile: 'alpha' });

  assert.deepEqual(attribution.scope, { profile: 'alpha', filtered: true, pluginsConsidered: 1 });
  assert.deepEqual(attribution.matched, [
    { kind: 'tool', key: 'shared_tool', plugin: 'plugin-a' },
    { kind: 'provider', key: 'provider-a', plugin: 'plugin-a' },
    { kind: 'route', key: '/_dsh/plugin-a/report', plugin: 'plugin-a' },
  ]);
  assert.deepEqual(attribution.unattributed, [
    { kind: 'tool', key: 'host_tool' },
    { kind: 'route', key: '/official/health' },
  ]);
});

test('attributeSurface without a profile deliberately compares all installs', () => {
  const attribution = attributeSurface({ tools: ['shared_tool'] }, reports);
  assert.deepEqual(attribution.scope, { profile: null, filtered: false, pluginsConsidered: 2 });
  assert.deepEqual(attribution.matched, [
    { kind: 'tool', key: 'shared_tool', plugin: 'plugin-a' },
    { kind: 'tool', key: 'shared_tool', plugin: 'plugin-b' },
  ]);
  assert.deepEqual(attribution.unattributed, []);
});

test('an explicitly unresolved host profile fails closed instead of cross-attributing', () => {
  const attribution = attributeSurface({ tools: ['shared_tool'] }, reports, { profile: null });
  assert.deepEqual(attribution.scope, { profile: null, filtered: true, pluginsConsidered: 0 });
  assert.deepEqual(attribution.matched, []);
  assert.deepEqual(attribution.unattributed, [{ kind: 'tool', key: 'shared_tool' }]);
});

test('route attribution respects a path-segment boundary', () => {
  const attribution = attributeSurface({
    routes: ['/_dsh/plugin-a', '/_dsh/plugin-a/report', '/_dsh/plugin-ab/report'],
  }, reports, { profile: 'alpha' });
  assert.deepEqual(attribution.matched.map((row) => row.key), [
    '/_dsh/plugin-a',
    '/_dsh/plugin-a/report',
  ]);
  assert.deepEqual(attribution.unattributed, [
    { kind: 'route', key: '/_dsh/plugin-ab/report' },
  ]);
});

// Fake-host coverage for the four Hub routes, request guards, partial mount
// health, structured failures, cache freshness, and disposal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountHub, profileFromContext } from '../src/hub/index.mjs';

const BASE = '/_dsh/dsh-harbor';

function baseReport() {
  return {
    scannedAt: '2026-08-23T00:00:00.000Z',
    profilesDir: '/tmp/dsh/profiles',
    plugins: [{
      name: 'owned-plugin',
      installs: [{ profile: 'alpha', spec: '1.0.0', linked: false, position: 0 }],
      claims: {
        toolNames: ['owned_tool'],
        providerIds: ['owned-provider'],
        routeBases: ['/_dsh/owned'],
      },
    }],
    conflicts: [],
    versionDrift: [],
    snapshot: { firstRun: false, changes: [], previousScanAt: null },
  };
}

function fakeHost({ failPath = null } = {}) {
  const routes = new Map();
  const disposed = [];
  const logs = { info: [], warn: [] };
  const webServer = {
    routes,
    register(route) {
      if (route.path === failPath) throw new Error('collision for test');
      routes.set(route.path, route);
      return () => {
        disposed.push(route.path);
        routes.delete(route.path);
      };
    },
  };
  const ctx = {
    baseUrl: 'file:///tmp/dsh/profiles/alpha/',
    tools: { schemas: () => [{ name: 'owned_tool' }] },
    llm: { adapters: new Map([['owned-provider', {}]]) },
    webServer,
    logger: {
      info: (message) => logs.info.push(message),
      warn: (message) => logs.warn.push(message),
    },
  };
  return { ctx, routes, disposed, logs };
}

function dependencies(overrides = {}) {
  return {
    scan: async () => baseReport(),
    checkUpstream: async () => ({ checkedAt: '2026-08-23T00:00:00.000Z', results: [] }),
    fingerprintSource: async () => 'same-fingerprint',
    readClientBuildId: async () => '0123456789abcdef',
    now: () => 1000,
    ...overrides,
  };
}

function request(path, {
  method = 'GET',
  remoteAddress = '127.0.0.1',
  headers = { host: '127.0.0.1:3099', 'sec-fetch-site': 'same-origin' },
  encrypted = false,
} = {}) {
  return { method, url: path, headers, socket: { remoteAddress, encrypted } };
}

async function invoke(routes, path, options = {}) {
  const route = routes.get(path.split('?', 1)[0]);
  assert.ok(route, `route ${path} is mounted`);
  let status = null;
  let responseHeaders = null;
  let body = '';
  const res = {
    writeHead(code, headers) { status = code; responseHeaders = headers; },
    end(value = '') { body += value; },
  };
  await route.handler(request(path, options), res);
  return { status, headers: responseHeaders, body, json: JSON.parse(body) };
}

test('mountHub exposes four healthy routes and scopes report attribution to the host profile', async () => {
  const host = fakeHost();
  const scanOptions = [];
  const dispose = await mountHub(host.ctx, dependencies({
    scan: async (options) => { scanOptions.push(options ?? null); return baseReport(); },
  }));

  assert.deepEqual([...host.routes.keys()], [
    BASE + '/ping', BASE + '/report', BASE + '/capabilities', BASE + '/updates',
  ]);
  assert.equal(host.logs.info.length, 1);
  assert.equal(host.logs.warn.length, 0);

  const ping = await invoke(host.routes, BASE + '/ping');
  assert.equal(ping.status, 200);
  assert.equal(ping.json.ok, true);
  assert.equal(ping.json.routes.expected, 4);
  assert.equal(ping.json.routes.mounted.length, 4);

  const report = await invoke(host.routes, BASE + '/report');
  assert.equal(report.status, 200);
  assert.equal(report.json.ok, true);
  assert.deepEqual(report.json.report.attribution.scope, {
    profile: 'alpha', filtered: true, pluginsConsidered: 1,
  });
  assert.ok(report.json.report.attribution.matched.some((row) =>
    row.kind === 'tool' && row.key === 'owned_tool' && row.plugin === 'owned-plugin'));

  const caps = await invoke(host.routes, BASE + '/capabilities', {
    headers: { host: '127.0.0.1:3099' },
  });
  assert.equal(caps.status, 200);
  assert.ok(caps.json.capabilities.length > 0);

  const updates = await invoke(host.routes, BASE + '/updates');
  assert.equal(updates.status, 200);
  assert.deepEqual(scanOptions, [null, { snapshot: false }]);
  dispose();
});

test('loopback, method, Fetch Metadata, Origin, and Referer guards fail closed', async () => {
  const host = fakeHost();
  await mountHub(host.ctx, dependencies());

  const remote = await invoke(host.routes, BASE + '/ping', { remoteAddress: '192.168.1.7' });
  assert.equal(remote.status, 403);
  assert.equal(remote.json.error, 'loopback only');

  const rebound = await invoke(host.routes, BASE + '/ping', {
    headers: { host: 'attacker.example:3099' },
  });
  assert.equal(rebound.status, 403);

  const wrongMethod = await invoke(host.routes, BASE + '/ping', { method: 'POST' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, 'GET');

  for (const path of [BASE + '/report', BASE + '/updates']) {
    const crossSite = await invoke(host.routes, path, {
      headers: { host: '127.0.0.1:3099', 'sec-fetch-site': 'cross-site' },
    });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.json.error, 'same-origin browser request required');

    const badOrigin = await invoke(host.routes, path, {
      headers: { host: '127.0.0.1:3099', origin: 'https://attacker.example' },
    });
    assert.equal(badOrigin.status, 403);

    const badReferer = await invoke(host.routes, path, {
      headers: { host: '127.0.0.1:3099', referer: 'https://attacker.example/page' },
    });
    assert.equal(badReferer.status, 403);
  }

  const panel = await invoke(host.routes, BASE + '/report', {
    headers: {
      host: '127.0.0.1:3099',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3099',
    },
  });
  assert.equal(panel.status, 200);

  // Headerless Fetch Metadata is valid for a non-browser loopback caller.
  const cli = await invoke(host.routes, BASE + '/report', {
    headers: { host: '127.0.0.1:3099' },
  });
  assert.equal(cli.status, 200);
});

test('partial registration makes ping unhealthy and never emits the green mount log', async () => {
  const host = fakeHost({ failPath: BASE + '/capabilities' });
  const dispose = await mountHub(host.ctx, dependencies());

  const ping = await invoke(host.routes, BASE + '/ping');
  assert.equal(ping.status, 503);
  assert.equal(ping.json.ok, false);
  assert.deepEqual(ping.json.routes.failed, [{
    path: BASE + '/capabilities', error: 'collision for test',
  }]);
  assert.equal(host.logs.info.length, 0);
  assert.ok(host.logs.warn.some((line) => line.includes('partially mounted (3/4 routes)')));
  dispose();
});

test('report failures remain structured and retain the last valid report', async () => {
  const host = fakeHost();
  let fail = true;
  await mountHub(host.ctx, dependencies({
    scan: async () => {
      if (fail) throw new Error('scan exploded');
      return baseReport();
    },
  }));

  const first = await invoke(host.routes, BASE + '/report');
  assert.equal(first.status, 500);
  assert.deepEqual(first.json, {
    ok: false,
    error: 'scan exploded',
    report: null,
    freshness: { hubStale: false, clientBuildId: '0123456789abcdef' },
  });

  fail = false;
  const success = await invoke(host.routes, BASE + '/report?refresh=1');
  assert.equal(success.status, 200);
  fail = true;
  const refreshFailure = await invoke(host.routes, BASE + '/report?refresh=1');
  assert.equal(refreshFailure.status, 500);
  assert.equal(refreshFailure.json.error, 'scan exploded');
  assert.equal(refreshFailure.json.report.scannedAt, baseReport().scannedAt);
  assert.deepEqual(refreshFailure.json.report.runtime.tools, ['owned_tool']);
});

test('static scan is cached while runtime registry evidence refreshes every request', async () => {
  const host = fakeHost();
  let names = ['owned_tool'];
  host.ctx.tools.schemas = () => names.map((name) => ({ name }));
  let scans = 0;
  await mountHub(host.ctx, dependencies({
    scan: async () => { scans += 1; return baseReport(); },
  }));

  const first = await invoke(host.routes, BASE + '/report');
  names = ['owned_tool', 'late_tool'];
  const second = await invoke(host.routes, BASE + '/report');
  assert.equal(scans, 1);
  assert.deepEqual(first.json.report.runtime.tools, ['owned_tool']);
  assert.deepEqual(second.json.report.runtime.tools, ['late_tool', 'owned_tool']);
  assert.ok(second.json.report.attribution.unattributed.some((row) => row.key === 'late_tool'));
});

test('dispose unregisters mounted routes in reverse order and is idempotent', async () => {
  const host = fakeHost();
  const dispose = await mountHub(host.ctx, dependencies());
  dispose();
  dispose();
  assert.deepEqual(host.disposed, [
    BASE + '/updates', BASE + '/capabilities', BASE + '/report', BASE + '/ping',
  ]);
  assert.equal(host.routes.size, 0);
});

test('profileFromContext accepts only a file base URL and missing webServer degrades cleanly', async () => {
  assert.equal(profileFromContext({ baseUrl: 'file:///tmp/dsh/profiles/alpha/' }), 'alpha');
  assert.equal(profileFromContext({ baseUrl: 'http://127.0.0.1:3099/' }), null);
  assert.equal(profileFromContext({}), null);

  const warnings = [];
  const dispose = await mountHub({ logger: { warn: (line) => warnings.push(line) } }, dependencies());
  assert.equal(typeof dispose, 'function');
  dispose();
  assert.ok(warnings.some((line) => line.includes('webServer unavailable')));
});

// Fake-host coverage for the two preflight routes and the job runner: method
// and origin fences, idle/running/done snapshots, busy conflicts, body
// validation, and the child-process contract (JSON on stdout, log on stderr).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mountHub } from '../src/hub/index.mjs';
import { createPreflightJobs, validTarget } from '../src/hub/preflight-job.mjs';

const BASE = '/_dsh/dsh-harbor';

function fakeHost() {
  const routes = new Map();
  const webServer = { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } };
  const ctx = { baseUrl: 'file:///tmp/dsh/profiles/web/', webServer, logger: { info() {}, warn() {} } };
  return { ctx, routes };
}

function baseDeps(overrides = {}) {
  return {
    scan: async () => ({ plugins: [], conflicts: [], versionDrift: [], snapshot: { changes: [] } }),
    checkUpstream: async () => ({ results: [] }),
    fingerprintSource: async () => 'fp',
    readClientBuildId: async () => 'id',
    listHostVersions: async () => ({ registry: 'registry.npmjs.org', tags: { latest: '0.1.5-rc.1', next: '0.1.5-rc.2' }, versions: ['0.1.5-rc.2', '0.1.5-rc.1'] }),
    listCachedHosts: () => [{ version: '0.1.5-rc.2', prefix: '/cache/0.1.5-rc.2' }],
    currentHostVersion: () => '0.1.5-rc.1',
    ...overrides,
  };
}

async function invoke(routes, path, { method = 'GET', body, headers = {}, remoteAddress = '127.0.0.1' } = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = path;
  req.headers = { host: '127.0.0.1:3099', 'sec-fetch-site': 'same-origin', ...headers };
  Object.defineProperty(req, 'socket', { value: { remoteAddress } });
  let status;
  let text = '';
  const res = { writeHead(s) { status = s; }, end(chunk) { if (chunk !== undefined) text += String(chunk); } };
  await routes.get(path).handler(req, res);
  return { status, json: text ? JSON.parse(text) : null };
}

function fakeJobs() {
  let state = { id: null, status: 'idle', target: null, log: [], report: null, error: null };
  return {
    started: [],
    snapshot: () => ({ ...state }),
    start(target) {
      if (state.status === 'running') throw Object.assign(new Error('a preflight is already running'), { code: 'BUSY' });
      this.started.push(target);
      state = { id: 'pf-1', status: 'running', target, log: ['resolving'], report: null, error: null };
      return { ...state };
    },
    finish(report) { state = { ...state, status: 'done', report }; },
  };
}

test('preflight routes: versions is same-origin GET, job route accepts GET and POST', async () => {
  const host = fakeHost();
  const jobs = fakeJobs();
  await mountHub(host.ctx, baseDeps({ preflightJobs: jobs }));

  const versions = await invoke(host.routes, BASE + '/preflight/versions');
  assert.equal(versions.status, 200);
  assert.deepEqual(versions.json.listing.tags, { latest: '0.1.5-rc.1', next: '0.1.5-rc.2' });
  assert.equal(versions.json.current, '0.1.5-rc.1');
  assert.equal(versions.json.cached[0].version, '0.1.5-rc.2');

  const crossOrigin = await invoke(host.routes, BASE + '/preflight/versions', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossOrigin.status, 403);
  const remote = await invoke(host.routes, BASE + '/preflight', { remoteAddress: '10.0.0.8' });
  assert.equal(remote.status, 403);
  const put = await invoke(host.routes, BASE + '/preflight', { method: 'PUT' });
  assert.equal(put.status, 405);

  const idle = await invoke(host.routes, BASE + '/preflight');
  assert.equal(idle.status, 200);
  assert.equal(idle.json.job.status, 'idle');

  const bad = await invoke(host.routes, BASE + '/preflight', { method: 'POST', body: { target: '../etc' } });
  assert.equal(bad.status, 400);
  const badJson = await invoke(host.routes, BASE + '/preflight', { method: 'POST', body: undefined, headers: {} });
  assert.equal(badJson.status, 400);

  const started = await invoke(host.routes, BASE + '/preflight', { method: 'POST', body: { target: 'next' } });
  assert.equal(started.status, 202);
  assert.equal(started.json.job.status, 'running');
  assert.deepEqual(jobs.started, ['next']);

  const busy = await invoke(host.routes, BASE + '/preflight', { method: 'POST', body: { target: '0.1.5-rc.2' } });
  assert.equal(busy.status, 409);
  assert.equal(busy.json.job.status, 'running');

  jobs.finish({ summary: { allProfilesBoot: true } });
  const done = await invoke(host.routes, BASE + '/preflight');
  assert.equal(done.json.job.status, 'done');
  assert.equal(done.json.job.report.summary.allProfilesBoot, true);
});

test('validTarget accepts versions and tags, rejects shell-ish input', () => {
  assert.equal(validTarget('0.1.5-rc.2'), true);
  assert.equal(validTarget('next'), true);
  assert.equal(validTarget('latest'), true);
  assert.equal(validTarget(''), false);
  assert.equal(validTarget('a b'), false);
  assert.equal(validTarget('../x'), false);
  assert.equal(validTarget('-flag'), false);
  assert.equal(validTarget(42), false);
});

function fakeChild({ stdout = '', stderr = '', code = 0, delay = 5, spawnError = null } = {}) {
  return () => {
    const listeners = {};
    const child = {
      stdout: { on(ev, fn) { if (ev === 'data' && stdout) setTimeout(() => fn(stdout), 1); } },
      stderr: { on(ev, fn) { if (ev === 'data' && stderr) setTimeout(() => fn(stderr), 1); } },
      on(ev, fn) { listeners[ev] = fn; },
      kill() { listeners.close?.(null); },
    };
    setTimeout(() => (spawnError ? listeners.error?.(spawnError) : listeners.close?.(code)), delay);
    return child;
  };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

test('job runner: spawns the CLI with --json, parses the report, keeps stderr as log', async () => {
  const calls = [];
  const jobs = createPreflightJobs({
    nodeBin: '/fake/node',
    spawnImpl: (bin, args, opts) => { calls.push({ bin, args, stdio: opts.stdio }); return fakeChild({ stdout: '{"summary":{"allProfilesBoot":false}}\n', stderr: '  · resolving dist-tag "next"\n  · probing x\n' })(); },
    now: () => 1000,
  });
  assert.equal(jobs.snapshot().status, 'idle');
  const started = jobs.start('next');
  assert.equal(started.status, 'running');
  assert.equal(started.id, 'pf-1');
  assert.equal(calls[0].bin, '/fake/node');
  assert.ok(calls[0].args[0].endsWith('cli.mjs'));
  assert.deepEqual(calls[0].args.slice(1), ['preflight', '--dsh', 'next', '--json']);
  assert.throws(() => jobs.start('latest'), /already running/);
  await settle();
  const done = jobs.snapshot();
  assert.equal(done.status, 'done');
  assert.deepEqual(done.report, { summary: { allProfilesBoot: false } });
  assert.deepEqual(done.log, ['resolving dist-tag "next"', 'probing x']);
  assert.equal(done.finishedAt, '1970-01-01T00:00:01.000Z');
  // A finished job can be replaced by a new one.
  assert.equal(jobs.start('0.1.5-rc.2').id, 'pf-2');
});

test('job runner: non-JSON output, spawn errors and bad targets fail cleanly', async () => {
  const noJson = createPreflightJobs({ spawnImpl: fakeChild({ stdout: 'garbage', stderr: 'npm ERR! boom\n', code: 1 }) });
  noJson.start('latest');
  await settle();
  assert.equal(noJson.snapshot().status, 'failed');
  assert.match(noJson.snapshot().error, /exited with code 1.*npm ERR! boom/);

  const spawnFail = createPreflightJobs({ spawnImpl: fakeChild({ spawnError: new Error('ENOENT node') }) });
  spawnFail.start('latest');
  await settle();
  assert.equal(spawnFail.snapshot().status, 'failed');
  assert.match(spawnFail.snapshot().error, /ENOENT node/);

  const runner = createPreflightJobs({ spawnImpl: fakeChild() });
  assert.throws(() => runner.start('bad target'), /invalid target/);
  assert.equal(runner.snapshot().status, 'idle');
});

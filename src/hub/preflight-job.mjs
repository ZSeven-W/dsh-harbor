// One-at-a-time preflight job for the hub. The work itself (npm install of the
// target host into Harbor's cache, import probes) always runs in a child
// process — `harbor preflight --json` — so a crashing plugin entry or a slow
// registry can never stall or kill the running DSH host, and the host's own
// module cache is never touched by the probe's resolve hook.

import { spawn as spawnProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');
const MAX_LOG_LINES = 400;
const MAX_LINE = 400;
const JOB_TIMEOUT_MS = 20 * 60 * 1000;
const TARGET_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

export function validTarget(value) {
  return typeof value === 'string' && TARGET_PATTERN.test(value);
}

/**
 * @param {{spawnImpl?: typeof spawn, nodeBin?: string, env?: object, now?: () => number, timeoutMs?: number}} [options]
 */
export function createPreflightJobs(options = {}) {
  const spawnImpl = options.spawnImpl ?? null;
  const nodeBin = options.nodeBin ?? process.execPath;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? JOB_TIMEOUT_MS;
  let seq = 0;
  let current = idle();

  function idle() {
    return { id: null, status: 'idle', target: null, startedAt: null, finishedAt: null, log: [], report: null, error: null };
  }

  function snapshot() {
    return { ...current, log: [...current.log] };
  }

  function pushLog(line) {
    const text = String(line).slice(0, MAX_LINE);
    current.log.push(text);
    if (current.log.length > MAX_LOG_LINES) current.log.splice(0, current.log.length - MAX_LOG_LINES);
  }

  function start(target) {
    if (!validTarget(target)) throw Object.assign(new Error('invalid target'), { code: 'BAD_TARGET' });
    if (current.status === 'running') throw Object.assign(new Error('a preflight is already running'), { code: 'BUSY' });
    seq += 1;
    current = { ...idle(), id: `pf-${seq}`, status: 'running', target, startedAt: new Date(now()).toISOString() };
    const job = current;
    const stdout = [];

    let child;
    try {
      const args = [CLI, 'preflight', '--dsh', target, '--json'];
      const spawnOptions = { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };
      child = spawnImpl ? spawnImpl(nodeBin, args, spawnOptions) : spawnProcess(nodeBin, args, spawnOptions);
    } catch (error) {
      finish(job, { error: String(error?.message ?? error) });
      return snapshot();
    }
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* gone */ }
      finish(job, { error: `preflight timed out after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => stdout.push(String(chunk)));
    child.stderr?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) pushLog(line.replace(/^\s*·\s*/, ''));
    });
    child.on('error', (error) => { clearTimeout(timer); finish(job, { error: String(error?.message ?? error) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = stdout.join('').trim();
      let report = null;
      if (text) {
        try { report = JSON.parse(text); } catch { /* reported below */ }
      }
      if (report) finish(job, { report });
      else finish(job, { error: `preflight exited with code ${code} without a JSON report${job.log.length ? `: ${job.log.slice(-3).join(' | ')}` : ''}` });
    });
    return snapshot();
  }

  function finish(job, { report = null, error = null }) {
    if (job !== current || job.status !== 'running') return;
    current = { ...job, status: error ? 'failed' : 'done', finishedAt: new Date(now()).toISOString(), report, error };
  }

  return { start, snapshot };
}

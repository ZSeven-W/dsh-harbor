#!/usr/bin/env node
// Ecosystem enumeration: every npm package carrying the `dsh-plugin` keyword
// whose latest version declares `dsh.bundle` or `dsh.client`. Keyword alone is
// not enough (it is a free-text tag); the manifest field is what makes a
// package a DSH plugin. Writes board/registry.json:
//   { fetchedAt, total, plugins: [{ name, version, bundle, client, hostDeps, modified }] }
// Incremental: packages whose search-listed version and modified date did not
// change keep their previous classification without a packument fetch.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = new URL('../../board/registry.json', import.meta.url);
const REGISTRY = process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org';
const UA = `dsh-harbor-board (+https://github.com/ZSeven-W/dsh-harbor)`;
const PAGE = 250;
const CONCURRENCY = 8;
const LIMIT = Number(process.env.BOARD_LIMIT ?? 0); // for local trials

async function getJson(url, abbreviated = false) {
  const headers = { 'user-agent': UA, ...(abbreviated ? { accept: 'application/vnd.npm.install-v1+json' } : {}) };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

let previous = { plugins: [] };
try { previous = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* first run */ }
const prevByName = new Map(previous.plugins.map((p) => [p.name, p]));

// 1. Search listing (name, version, date) — cheap, paginated.
const listed = [];
let total = Infinity;
for (let from = 0; from < total; from += PAGE) {
  const page = await getJson(`${REGISTRY}/-/v1/search?text=keywords:dsh-plugin&size=${PAGE}&from=${from}`, true);
  if (!page) break;
  total = page.total;
  for (const o of page.objects) listed.push({ name: o.package.name, version: o.package.version, modified: o.package.date ?? null });
  if (LIMIT && listed.length >= LIMIT) { listed.length = LIMIT; break; }
  process.stderr.write(`listed ${listed.length}/${total}\n`);
}

// 2. Classify: full packument only when the listing moved since last time.
const queue = [...listed];
const plugins = [];
let fetched = 0;
async function worker() {
  while (queue.length) {
    const item = queue.shift();
    const prev = prevByName.get(item.name);
    if (prev && prev.version === item.version && prev.modified === item.modified) { plugins.push(prev); continue; }
    const p = await getJson(`${REGISTRY}/${item.name.replace('/', '%2f')}`);
    fetched++;
    if (!p) continue;
    const tag = p['dist-tags']?.latest;
    const v = tag ? p.versions?.[tag] : null;
    if (!v) continue;
    const dsh = v.dsh && typeof v.dsh === 'object' ? v.dsh : {};
    const deps = { ...(v.dependencies ?? {}), ...(v.peerDependencies ?? {}) };
    plugins.push({
      name: item.name,
      version: tag,
      modified: item.modified,
      bundle: !!dsh.bundle,
      client: !!dsh.client,
      clientInject: Array.isArray(dsh.client?.inject) ? dsh.client.inject : [],
      hostDeps: Object.keys(deps).filter((k) => k.startsWith('@deepseek-ai/')).sort(),
      repository: typeof v.repository === 'string' ? v.repository : (v.repository?.url ?? null),
    });
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const real = plugins.filter((p) => p.bundle || p.client).sort((a, b) => a.name.localeCompare(b.name));
mkdirSync(dirname(OUT.pathname), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ fetchedAt: new Date().toISOString(), listed: listed.length, total, fetchedPackuments: fetched, plugins: real }, null, 2)}\n`);
process.stderr.write(`plugins with dsh.bundle/client: ${real.length} of ${listed.length} listed (${fetched} packuments fetched)\n`);

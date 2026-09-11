#!/usr/bin/env node
// Merge every shard result for every probed DSH version into board/index.json
// and render board/site/index.html (a static page; GitHub Pages serves it).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../board/', import.meta.url).pathname;
const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const resultsRoot = join(root, 'results');
const versions = existsSync(resultsRoot) ? readdirSync(resultsRoot).filter((d) => !d.startsWith('.')).sort() : [];

const byVersion = {};
for (const v of versions) {
  const merged = {};
  for (const file of readdirSync(join(resultsRoot, v)).filter((f) => f.endsWith('.json'))) {
    const shard = JSON.parse(readFileSync(join(resultsRoot, v, file), 'utf8'));
    Object.assign(merged, shard.results ?? {});
  }
  byVersion[v] = merged;
}

const rows = registry.plugins.map((p) => ({
  name: p.name, version: p.version, client: p.client, bundle: p.bundle, repository: p.repository,
  results: Object.fromEntries(versions.map((v) => [v, byVersion[v][p.name] ?? null])),
}));
const summary = Object.fromEntries(versions.map((v) => {
  const c = { 'blocks-boot': 0, ok: 0, unresolvable: 0, unknown: 0, withAdvisories: 0, probed: 0 };
  for (const r of Object.values(byVersion[v])) { c.probed++; c[r.verdict] = (c[r.verdict] ?? 0) + 1; if (r.advisories?.length) c.withAdvisories++; }
  return [v, c];
}));
const index = { generatedAt: new Date().toISOString(), registryFetchedAt: registry.fetchedAt, plugins: rows.length, versions, summary, rows };
writeFileSync(join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const mark = { 'blocks-boot': '✖', ok: '✓', unresolvable: '?', unknown: '?' };
const cls = { 'blocks-boot': 'bad', ok: 'ok', unresolvable: 'na', unknown: 'na' };
const cell = (r) => (r ? `<td class="${cls[r.verdict]}" title="${esc(r.import?.message ?? '')}">${mark[r.verdict]} ${esc(r.verdict)}${r.advisories?.length ? ` <small>⚠${r.advisories.length}</small>` : ''}</td>` : '<td class="na">–</td>');
const order = { 'blocks-boot': 0, unresolvable: 1, unknown: 2, ok: 3 };
const latest = versions[versions.length - 1];
const sorted = [...rows].sort((a, b) => (order[a.results[latest]?.verdict] ?? 9) - (order[b.results[latest]?.verdict] ?? 9) || a.name.localeCompare(b.name));
const html = `<!doctype html><meta charset="utf-8"><title>DSH plugin compatibility board</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#1f2328;background:#fff}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d0d7de;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f6f8fa;position:sticky;top:0}.bad{background:#ffebe9;color:#a40e26}.ok{color:#1a7f37}.na{color:#6e7781}small{opacity:.7}code{font:12px ui-monospace,monospace}.sum{margin:12px 0 20px;display:flex;gap:18px;flex-wrap:wrap}.sum div{border:1px solid #d0d7de;border-radius:8px;padding:8px 12px}</style>
<h1>DSH plugin compatibility board</h1>
<p>${rows.length} plugins on npm declaring <code>dsh.bundle</code> or <code>dsh.client</code>, each import-probed against real DSH host trees by <a href="https://github.com/ZSeven-W/dsh-harbor">DSH Harbor</a>. Generated ${esc(index.generatedAt)}. Raw data: <a href="index.json">index.json</a>.</p>
<div class="sum">${versions.map((v) => `<div><b>DSH ${esc(v)}</b><br>probed ${summary[v].probed} · <span class="bad">blocks boot ${summary[v]['blocks-boot']}</span> · <span class="ok">loads ${summary[v].ok}</span> · unresolvable ${summary[v].unresolvable} · stale declarations ${summary[v].withAdvisories}</div>`).join('')}</div>
<table><thead><tr><th>plugin</th><th>version</th>${versions.map((v) => `<th>DSH ${esc(v)}</th>`).join('')}</tr></thead><tbody>
${sorted.map((r) => `<tr><td><code>${esc(r.name)}</code></td><td><code>${esc(r.version)}</code></td>${versions.map((v) => cell(r.results[v])).join('')}</tr>`).join('\n')}
</tbody></table>
<p><small>blocks boot = the plugin's server entry fails to import against that DSH (removed package or export); the DSH loader is fail-loud, so every profile holding it would not boot. unresolvable = the plugin's own dependencies could not be resolved from the registry tarball, not a host problem. ⚠n = stale client inject ids or peer ranges (advisory only).</small></p>
`;
mkdirSync(join(root, 'site'), { recursive: true });
writeFileSync(join(root, 'site', 'index.html'), html);
writeFileSync(join(root, 'site', 'index.json'), JSON.stringify(index));
process.stderr.write(`aggregated ${rows.length} plugins × ${versions.length} versions\n`);

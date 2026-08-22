// Wrap the compiled client bundle into the dsh-web module-loader artifact:
// "window.__ModuleLoader__.load({ id, factory })". The id must equal the
// package name (= the cordis entry name). Pattern from dsh-noema.
//
// The same pass also stamps a build identifier into the artifact so the
// panel and the hub can detect code-freshness skew:
//   - 'var CLIENT_BUILD_ID = "<hex>"' inside the factory — the running
//     panel reads this constant to learn its own build;
//   - a trailing '//__HARBOR_CLIENT_BUILD__=<hex>' line — the hub's
//     readClientBuildId() extracts it from lib/client.js on disk.
// The hex is the sha256 of the wrapped bundle *before* either of these is
// added (a fixed point would be unsolvable), and it contains no timestamp:
// rebuilding identical sources must produce the identical id, otherwise
// every rebuild would look like a staleness event.

import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const pluginId = manifest.name;
const source = await readFile(join(root, '.client-build', 'index.cjs'), 'utf8');
const wrapped = [
  'window.__ModuleLoader__.load({ id: ' + JSON.stringify(pluginId) + ', factory: (require) => {',
  'var module = { exports: {} }; var exports = module.exports;',
  source.replace(/\n?\/\/# sourceMappingURL=.*$/u, ''),
  'return module.exports; } });',
  '',
].join('\n');

// Identifier is derived from the wrapped bundle as composed above (source
// code only, no timestamp) — deterministic for identical inputs.
const clientBuildId = createHash('sha256').update(wrapped).digest('hex').slice(0, 16);

// Inject the constant at factory scope so the compiled panel code can read
// CLIENT_BUILD_ID as a free variable (declared via "declare const" in
// src/client/index.tsx).
const stamped = wrapped.replace(
  'var module = { exports: {} }; var exports = module.exports;\n',
  'var module = { exports: {} }; var exports = module.exports;\nvar CLIENT_BUILD_ID = ' + JSON.stringify(clientBuildId) + ';\n',
);
const final = stamped + '//__HARBOR_CLIENT_BUILD__=' + clientBuildId + '\n';

await mkdir(join(root, 'lib'), { recursive: true });
await writeFile(join(root, 'lib', 'client.js'), final);
await rm(join(root, '.client-build'), { recursive: true, force: true });
console.log('built lib/client.js (' + final.length + ' bytes) as module "' + pluginId + '" — client build id ' + clientBuildId);

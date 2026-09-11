// Entry executed by the import probe child. Imports one plugin entry and
// reports the outcome as a single JSON line on stdout. Runs under the resolve
// hook (hook-register.mjs) so host imports bind to the target DSH tree.
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: 'HARBOR_NO_ENTRY', message: 'entry path required' })}\n`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolution messages arrive from the loader thread asynchronously; wait for a short quiet period. */
async function drainResolved() {
  const list = globalThis.__harborResolved ?? [];
  let count = -1;
  for (let i = 0; i < 10 && count !== list.length; i++) {
    count = list.length;
    await sleep(25);
  }
  return [...new Set(list)].sort();
}

try {
  const mod = await import(pathToFileURL(entry).href);
  const exportsList = Object.keys(mod ?? {}).sort();
  const resolved = await drainResolved();
  process.stdout.write(`${JSON.stringify({ ok: true, exports: exportsList, resolved })}\n`);
  process.exitCode = 0;
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code : (error?.name ?? 'Error');
  const message = typeof error?.message === 'string' ? error.message : String(error);
  const resolved = await drainResolved();
  process.stdout.write(`${JSON.stringify({ ok: false, code, message, resolved })}\n`);
  process.exitCode = 1;
}

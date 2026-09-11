// Child entry for host-diff: import a list of package entry files and print
// their export names as one JSON object. Runs only on official host packages
// from an installed tree, never on third-party plugins.
import { pathToFileURL } from 'node:url';

const files = JSON.parse(process.argv[2] ?? '[]');
const out = {};
for (const [name, file] of files) {
  try {
    const mod = await import(pathToFileURL(file).href);
    out[name] = { exports: Object.keys(mod ?? {}).sort() };
  } catch (error) {
    out[name] = { error: `${error?.code ?? error?.name ?? 'Error'}: ${String(error?.message ?? error).slice(0, 300)}` };
  }
}
process.stdout.write(`${JSON.stringify(out)}\n`);

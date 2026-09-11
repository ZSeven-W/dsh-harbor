// ESM resolve hook for the import probe. Registered in a *child* process via
// hook-register.mjs; never loaded inside the running DSH host, where it would
// redirect the host's own imports.
//
// Two rules, mirroring how a real profile resolves:
//   1. `@deepseek-ai/*` always resolves from the target host tree, so the
//      plugin links against the DSH version being evaluated.
//   2. Any other bare specifier resolves from the plugin first; if that fails
//      it is retried from the host tree, because a profile hoists the host's
//      own dependencies (react, pi-ai, …) next to the plugin and plugins
//      legitimately import them as peers.
// Each host-resolved specifier is reported back over the MessagePort handed in
// at registration (hooks run on Node's loader thread; a port is the channel).

let hostAnchor = null;
let port = null;
let seen = null;

export function initialize(data) {
  hostAnchor = data?.hostAnchor ?? null;
  port = data?.port ?? null;
  seen = new Set();
}

function report(specifier, url, via) {
  if (!seen || seen.has(specifier)) return;
  seen.add(specifier);
  try { port?.postMessage({ harborResolve: specifier, url, via }); } catch { /* best effort */ }
}

const isBare = (s) => !s.startsWith('.') && !s.startsWith('/') && !s.startsWith('node:') && !s.startsWith('file:') && !s.startsWith('data:');

export async function resolve(specifier, context, nextResolve) {
  if (!hostAnchor) return nextResolve(specifier, context);
  if (specifier.startsWith('@deepseek-ai/')) {
    const resolved = await nextResolve(specifier, { ...context, parentURL: hostAnchor });
    report(specifier, resolved.url, 'host');
    return resolved;
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !isBare(specifier)) throw error;
    let resolved;
    try { resolved = await nextResolve(specifier, { ...context, parentURL: hostAnchor }); } catch { throw error; }
    report(specifier, resolved.url, 'host-fallback');
    return resolved;
  }
}

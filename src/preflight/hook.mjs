// ESM resolve hook for the import probe. Registered in a *child* process via
// hook-register.mjs; never loaded inside the running DSH host, where it would
// redirect the host's own imports.
//
// Every `@deepseek-ai/*` specifier is resolved as if it were imported from a
// file inside the target host tree, so the plugin under test links against the
// DSH version being evaluated while its own dependencies keep resolving from
// its real install location. Each redirected specifier is reported back to
// the main thread over the MessagePort handed in at registration, so the
// probe can list which host packages the plugin actually touched. (Hooks run
// on Node's loader thread; a port is the supported channel, stderr is not.)

let hostAnchor = null;
let port = null;
let seen = null;

export function initialize(data) {
  hostAnchor = data?.hostAnchor ?? null;
  port = data?.port ?? null;
  seen = new Set();
}

export async function resolve(specifier, context, nextResolve) {
  if (hostAnchor && specifier.startsWith('@deepseek-ai/')) {
    const resolved = await nextResolve(specifier, { ...context, parentURL: hostAnchor });
    if (seen && !seen.has(specifier)) {
      seen.add(specifier);
      try { port?.postMessage({ harborResolve: specifier, url: resolved.url }); } catch { /* reporting is best effort */ }
    }
    return resolved;
  }
  return nextResolve(specifier, context);
}

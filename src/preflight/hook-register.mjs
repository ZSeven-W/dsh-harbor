// `node --import <this file>` registrar for the import probe child process.
// HARBOR_HOST_ANCHOR is a file: URL inside the target host tree; module
// resolution of `@deepseek-ai/*` starts from there. See hook.mjs.
//
// The hook thread reports each redirected specifier over a MessageChannel;
// probe-main.mjs drains `globalThis.__harborResolved` after the import.
import { register } from 'node:module';
import { MessageChannel } from 'node:worker_threads';

const hostAnchor = process.env.HARBOR_HOST_ANCHOR;
if (!hostAnchor) throw new Error('HARBOR_HOST_ANCHOR is required');

const { port1, port2 } = new MessageChannel();
const resolved = [];
port1.on('message', (message) => {
  if (message && typeof message.harborResolve === 'string') resolved.push(message.harborResolve);
});
port1.unref();
globalThis.__harborResolved = resolved;

register('./hook.mjs', import.meta.url, { data: { hostAnchor, port: port2 }, transferList: [port2] });

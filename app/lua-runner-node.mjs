import { Worker } from 'node:worker_threads';
import { validatePluginOptions } from './lua-plugin-schema.mjs';
import { luaRequest } from './lua-request.mjs';
import { createLuaWorkerController } from './lua-worker-controller.mjs';

/** Real Lua 5.4, isolated from the editor. Without an explicit trusted onDialog
 * host this remains headless. The CLI never supplies a dialog host. */
export function runLuaScript(input, { wasmUri, workerUrl = new URL('./lua-node-worker.mjs', import.meta.url), onDialog, onCommand, plugin, isCurrent, dialogWaitMs } = {}) {
  const request = luaRequest(input), signal = input.signal;
  if (plugin !== undefined) {
    if (typeof onCommand !== 'function') return Promise.reject(Error('Package commands require an explicit interactive host.'));
    request.plugin = validatePluginOptions(plugin);
  }
  if (signal?.aborted) return Promise.reject(new Error('Lua script cancelled.'));
  const worker = new Worker(workerUrl, { workerData: { request, wasmUri, dialogs: typeof onDialog === 'function' }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
  let controller;
  try { controller = createLuaWorkerController(request, { signal, onDialog, onCommand, plugin, isCurrent, dialogWaitMs, postMessage: message => worker.postMessage(message), terminate: () => { void worker.terminate(); } }); }
  catch (error) { void worker.terminate(); return Promise.reject(error); }
  worker.on('message', controller.message);
  worker.once('error', controller.error);
  worker.once('exit', controller.exit);
  return controller.promise;
}

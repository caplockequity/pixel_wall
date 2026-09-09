import { validatePluginOptions } from './lua-plugin-schema.mjs';
import { luaRequest } from './lua-request.mjs';
import { createLuaWorkerController } from './lua-worker-controller.mjs';

/** wasmUri is a trusted same-origin bundled asset. onDialog and isCurrent are
 * host callbacks, never script parameters; no host means explicitly headless. */
export function runLuaScript(input, { wasmUri, createWorker, onDialog, onCommand, plugin, isCurrent, dialogWaitMs } = {}) {
  const request = luaRequest(input), signal = input.signal;
  if (plugin !== undefined) {
    if (typeof onCommand !== 'function') return Promise.reject(Error('Package commands require an explicit interactive host.'));
    request.plugin = validatePluginOptions(plugin);
  }
  if (signal?.aborted) return Promise.reject(new Error('Lua script cancelled.'));
  if (typeof wasmUri !== 'string') return Promise.reject(new Error('A bundled Lua WebAssembly asset is required.'));
  const asset = new URL(wasmUri, globalThis.location?.href);
  const page = new URL(globalThis.location.href);
  if (asset.protocol !== page.protocol || asset.host !== page.host || asset.username || asset.password || !['https:', 'http:', 'pixelwall:'].includes(asset.protocol)) return Promise.reject(new Error('Lua WebAssembly must be hosted with this editor.'));
  const worker = createWorker ? createWorker() : new Worker(new URL('lua-browser-worker.mjs', asset), {type:'module'});
  let controller;
  try { controller = createLuaWorkerController(request, { signal, onDialog, onCommand, plugin, isCurrent, dialogWaitMs, postMessage: message => worker.postMessage(message), terminate: () => worker.terminate() }); }
  catch (error) { worker.terminate(); return Promise.reject(error); }
  worker.onmessage = event => controller.message(event.data);
  worker.onerror = () => controller.error(Error('Lua worker could not run.'));
  try { worker.postMessage({ request, wasmUri: asset.href, dialogs: typeof onDialog === 'function' }); }
  catch (error) { controller.error(error); }
  return controller.promise;
}

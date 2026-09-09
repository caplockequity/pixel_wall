import { createLuaPluginChannel } from './lua-plugin-channel.mjs';
import { needsLuaColorManager } from './lua-color-spaces.mjs';
import { loadNodeColorManager } from './color-runtime-node.mjs';
import { parentPort, workerData } from 'node:worker_threads';
import { executeLuaInWorker } from './lua-runtime.mjs';
import { createLuaDialogChannel } from './lua-dialog-channel.mjs';
const channel = createLuaDialogChannel(message => parentPort.postMessage(message));
const pluginChannel = createLuaPluginChannel(message => parentPort.postMessage(message), workerData.request.plugin);
const receive = message => channel.receive(message) || pluginChannel.receive(message);
parentPort.on('message', receive);
let colorManager;
try {
  if (needsLuaColorManager(workerData.request)) colorManager = await loadNodeColorManager();
  parentPort.postMessage({ ok: true, result: await executeLuaInWorker(workerData.request, workerData.wasmUri, { requestDialog: workerData.dialogs === true ? channel.requestDialog : undefined, requestCommand: workerData.request.plugin ? pluginChannel.requestCommand : undefined, colorManager }) });
}
catch (error) { parentPort.postMessage({ ok: false, error: String(error?.message ?? error).slice(0, 4096) }); }
finally { colorManager?.close(); parentPort.off('message', receive); }

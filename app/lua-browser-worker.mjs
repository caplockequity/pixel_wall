import { createLuaPluginChannel } from './lua-plugin-channel.mjs';
import { loadLuaBrowserColorManager } from './lua-color-runtime-browser.mjs';
import { executeLuaInWorker } from './lua-runtime.mjs';
import { createLuaDialogChannel } from './lua-dialog-channel.mjs';
// Fresh worker per script. Only bounded dialog responses can resume its live VM.
const channel = createLuaDialogChannel(message => self.postMessage(message));
let started = false, pluginChannel;
self.onmessage = async event => {
  if (started) { if (!channel.receive(event.data)) pluginChannel?.receive(event.data); return; }
  started = true;
  let colorManager;
  try {
    const { request, wasmUri, dialogs } = event.data;
    pluginChannel = createLuaPluginChannel(message => self.postMessage(message), request.plugin);
    colorManager = await loadLuaBrowserColorManager(request, wasmUri);
    self.postMessage({ ok: true, result: await executeLuaInWorker(request, wasmUri, { requestDialog: dialogs === true ? channel.requestDialog : undefined, requestCommand: request.plugin ? pluginChannel.requestCommand : undefined, colorManager }) });
  } catch (error) { self.postMessage({ ok: false, error: String(error?.message ?? error).slice(0, 4096) }); }
  finally { colorManager?.close(); }
};

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Sandboxed Electron preloads require CommonJS.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pixelwallUpdates', {
  state: () => ipcRenderer.invoke('pixelwall-update:state'),
  action: name => ipcRenderer.invoke('pixelwall-update:action', name),
  subscribe: callback => { ipcRenderer.on('pixelwall-update:state', (_event, state) => callback(state)); },
});

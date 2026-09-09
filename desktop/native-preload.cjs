// Sandboxed preloads may import electron but never expose its generic IPC objects.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron sandbox preloads require CommonJS and cannot use ESM imports.
const { contextBridge, ipcRenderer } = require('electron');
const invoke = (method, payload) => ipcRenderer.invoke(`pixelwall:native:${method}`, payload);
contextBridge.exposeInMainWorld('pixelwallNativeFiles', Object.freeze({
  open: () => invoke('open'),
  reopen: payload => invoke('reopen', payload),
  ready: () => invoke('ready'),
  bindOpen: payload => invoke('bindOpen', payload),
  cancelOpen: payload => invoke('cancelOpen', payload),
  ackOpen: payload => invoke('ackOpen', payload),
  list: () => invoke('list'),
  info: payload => invoke('info', payload),
  chooseSave: payload => invoke('chooseSave', payload),
  writeSave: payload => invoke('writeSave', payload),
  cancelSave: payload => invoke('cancelSave', payload),
  onOpen: callback => {
    if (typeof callback !== 'function') throw new TypeError('Open handler must be a function.');
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pixelwall:native:opened', listener);
    return () => ipcRenderer.removeListener('pixelwall:native:opened', listener);
  },
}));

// Grant one image operation only for real copy/paste input. Never prevent default:
// ordinary text fields keep Electron's native text clipboard behavior.
function clipboardTextTarget(target) {
  return !!target?.closest?.('input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"]') || !!target?.isContentEditable;
}
function clipboardGesture(event) {
  if (!event.isTrusted) return;
  const path = event.composedPath?.() || [event.target];
  let action;
  if (event.type === 'keydown') {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) return;
    action = ({ c: 'copy', x: 'cut', v: 'paste' })[String(event.key).toLowerCase()];
  } else if (event.type === 'click' && event.button === 0) {
    action = path.map(target => target?.closest?.('[data-pixelwall-clipboard]')?.getAttribute('data-pixelwall-clipboard')).find(value => ['copy', 'cut', 'paste'].includes(value));
  }
  if (action) {
    // Text Copy/Cut/Paste must cancel an older pending image write without
    // granting image access or interfering with the normal text operation.
    if (path.some(clipboardTextTarget)) ipcRenderer.send('pixelwall:clipboard:revoke');
    else ipcRenderer.send('pixelwall:clipboard:gesture', action);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', clipboardGesture, true);
  window.addEventListener('click', clipboardGesture, true);
}
contextBridge.exposeInMainWorld('pixelwallNativeClipboard', Object.freeze({
  readImage: () => ipcRenderer.invoke('pixelwall:clipboard:readImage'),
  beginWrite: () => ipcRenderer.invoke('pixelwall:clipboard:beginWrite'),
  cancelWrite: payload => ipcRenderer.invoke('pixelwall:clipboard:cancelWrite', { token: payload?.token }),
  writeImage: payload => ipcRenderer.invoke('pixelwall:clipboard:writeImage', payload),
}));

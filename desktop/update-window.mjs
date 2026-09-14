import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function createUpdateWindow({ BrowserWindow, ipcMain, folder, getState, action }) {
  let window;
  const url = pathToFileURL(join(folder, 'update.html')).href;
  const trusted = event => window && !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === url;
  const allowed = new Set(['check', 'download', 'cancel', 'install', 'notes', 'later']);
  ipcMain.handle('pixelwall-update:state', event => trusted(event) ? getState() : null);
  ipcMain.handle('pixelwall-update:action', async (event, name) => {
    if (!trusted(event) || !allowed.has(name)) return;
    if (name === 'later') { window.close(); return; }
    // Dispatch without holding IPC open through a download or an app restart.
    void Promise.resolve().then(() => action(name)).catch(() => {});
  });
  return {
    show() {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
      window = new BrowserWindow({ width: 490, height: 460, minWidth: 420, minHeight: 380, title: 'PixelWall updates',
        backgroundColor: '#111219', autoHideMenuBar: true, show: false,
        webPreferences: { preload: join(folder, 'update-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      window.setMenu(null);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.once('ready-to-show', () => { if (window && !window.isDestroyed()) window.show(); });
      void window.loadFile(join(folder, 'update.html'));
    },
    send(state) { if (window && !window.isDestroyed()) window.webContents.send('pixelwall-update:state', state); },
    dispose() {
      ipcMain.removeHandler('pixelwall-update:state'); ipcMain.removeHandler('pixelwall-update:action');
      if (window && !window.isDestroyed()) window.destroy();
    },
  };
}

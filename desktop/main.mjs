import { app, BrowserWindow, protocol, net, shell, session, dialog } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { access } from 'node:fs/promises';
const folder = join(dirname(fileURLToPath(import.meta.url)), 'app');
protocol.registerSchemesAsPrivileged([{ scheme: 'pixelwall', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.setName('PixelWall');
if (process.env.PIXELWALL_DESKTOP_USER_DATA) app.setPath('userData', resolve(process.env.PIXELWALL_DESKTOP_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window;
  let quitting = false;
  app.on('before-quit', () => { quitting = true; });
  app.on('second-instance', () => {
    if (!window || window.isDestroyed()) { app.emit('activate'); return; }
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  });
  // Do not await app readiness at ESM module top level: Electron must finish
  // loading the main module before emitting ready and starting Chromium.
  void app.whenReady().then(async () => {
    protocol.handle('pixelwall', async (request) => {
      const url = new URL(request.url);
      if (url.host !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
      let path;
      try { path = resolve(folder, '.' + decodeURIComponent(url.pathname)); } catch { return new Response('Bad request', { status: 400 }); }
      if (path !== folder && !path.startsWith(folder + sep)) return new Response('Not found', { status: 404 });
      if (url.pathname === '/' || url.pathname === '/editor') path = join(folder, 'index.html');
      try { await access(path); return net.fetch(pathToFileURL(path).href); } catch { return new Response('This file is missing from the desktop app.', { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    function openWindow() {
      window = new BrowserWindow({ width: 1440, height: 980, minWidth: 960, minHeight: 640, backgroundColor: '#111219', title: 'PixelWall', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
      window.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/|^mailto:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
      window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('pixelwall://app/')) { event.preventDefault(); if (/^https:\/\/|^mailto:/.test(url)) void shell.openExternal(url); } });
      let savingBeforeClose = false;
      window.on('close', (event) => {
        event.preventDefault();
        if (savingBeforeClose) return;
        savingBeforeClose = true;
        void window.webContents.executeJavaScript('window.pixelwall?.save()').then(() => { window.destroy(); if (quitting) app.quit(); }).catch(async (error) => {
          const answer = await dialog.showMessageBox(window, { type: 'warning', title: 'Save needs attention', message: 'PixelWall could not save the current project.', detail: `${error.message}\nKeep this window open and download a project backup.`, buttons: ['Keep editing', 'Close without saving'], defaultId: 0, cancelId: 0 });
          if (answer.response === 1) { window.destroy(); if (quitting) app.quit(); }
          else { savingBeforeClose = false; quitting = false; }
        });
      });
      void window.loadURL('pixelwall://app/editor');
    }
    openWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) openWindow(); });
  }).catch((error) => { dialog.showErrorBox('PixelWall could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

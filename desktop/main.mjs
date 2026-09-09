import { app, BrowserWindow, protocol, net, shell, session, dialog, Menu } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { access } from 'node:fs/promises';
import { createUpdateController, createFileSettingsStore, createDesktopMenuTemplate } from './update-checker.mjs';
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
    async function updateDialog(event) {
      const owner = BrowserWindow.getFocusedWindow() ?? (window && !window.isDestroyed() ? window : undefined);
      const show = options => owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
      if (event.kind === 'available') {
        const notes = event.manifest.releaseNotes.map(note => `• ${note}`).join('\n');
        const answer = await show({ type: 'info', title: 'PixelWall update available', message: `PixelWall ${event.manifest.version} is available`, detail: `You have version ${event.currentVersion}.\n\n${notes || 'A new desktop release is available.'}\n\nDownload opens the release in your browser.`, buttons: ['Download', 'Later', 'Release notes'], defaultId: 0, cancelId: 1, noLink: true });
        return answer.response === 0 ? 'download' : answer.response === 2 ? 'notes' : 'later';
      }
      if (event.kind === 'current') await show({ type: 'info', title: 'PixelWall is up to date', message: `PixelWall ${event.currentVersion} is up to date`, buttons: ['OK'] });
      else if (event.kind === 'unsupported') await show({ type: 'info', title: 'No desktop update available', message: 'No update download is available for this computer yet.', detail: `Platform: ${event.target}\nCurrent version: ${event.currentVersion}`, buttons: ['OK'] });
      else if (event.kind === 'error') await show({ type: 'warning', title: 'Update check unavailable', message: event.message, buttons: ['OK'] });
      return 'later';
    }
    const updater = createUpdateController({
      currentVersion: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged,
      fetch: (url, options) => net.fetch(url, options),
      ...createFileSettingsStore(join(app.getPath('userData'), 'update-checker.json')),
      notify: updateDialog, openExternal: url => shell.openExternal(url),
    });
    const updateSettings = await updater.start();
    Menu.setApplicationMenu(Menu.buildFromTemplate(createDesktopMenuTemplate({
      platform: process.platform, appName: app.name, packaged: app.isPackaged, automaticChecks: updateSettings.automaticChecks,
      onCheck: () => { void updater.check({ manual: true }); },
      onToggle: enabled => { void updater.setAutomaticChecks(enabled); },
      onDocumentation: () => { void shell.openExternal('https://www.pixelwall.dev/guides/offline-and-downloads').catch(() => {}); },
    })));
    app.on('will-quit', () => updater.dispose());
  }).catch((error) => { dialog.showErrorBox('PixelWall could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

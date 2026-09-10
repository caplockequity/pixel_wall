import { app, BrowserWindow, protocol, net, shell, session, dialog, Menu, ipcMain, clipboard, nativeImage } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { access } from 'node:fs/promises';
import { createUpdateController, createFileSettingsStore, createDesktopMenuTemplate } from './update-checker.mjs';
import { createCloseController, runEditorAction } from './editor-controls.mjs';
import { createNativeClipboardIpc } from './native-clipboard-ipc.mjs';
import { createNativeFileIpc } from './native-file-ipc.mjs';
import { createNativeBindingStore, nativePathsFromArgv } from './native-files.mjs';
const desktopFolder = dirname(fileURLToPath(import.meta.url));
const folder = join(desktopFolder, 'app');
protocol.registerSchemesAsPrivileged([{ scheme: 'pixelwall', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.setName('PixelWall');
if (process.env.PIXELWALL_DESKTOP_USER_DATA) app.setPath('userData', resolve(process.env.PIXELWALL_DESKTOP_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window;
  let nativeFiles;
  const pendingFiles = nativePathsFromArgv(process.argv.slice(app.isPackaged ? 1 : 2));
  let quitting = false;
  function openRequestedFiles(paths) {
    if (!paths.length) return;
    if (!window || window.isDestroyed() || !nativeFiles) {
      pendingFiles.push(...paths);
      if (app.isReady()) app.emit('activate');
      return;
    }
    nativeFiles.enqueue(window, paths);
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  }
  // macOS emits this before ready when a document launches the app.
  app.on('open-file', (event, path) => { event.preventDefault(); openRequestedFiles(nativePathsFromArgv([path])); });
  app.on('before-quit', () => { quitting = true; });
  app.on('second-instance', (_event, argv, workingDirectory) => {
    openRequestedFiles(nativePathsFromArgv(argv.slice(app.isPackaged ? 1 : 2), workingDirectory));
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
    nativeFiles = createNativeFileIpc({ ipcMain, dialog, store: createNativeBindingStore(join(app.getPath('userData'), 'native-documents.json')) });
    const nativeClipboard = createNativeClipboardIpc({ ipcMain, clipboard, nativeImage });
    function openWindow() {
      window = new BrowserWindow({ width: 1440, height: 980, minWidth: 960, minHeight: 640, backgroundColor: '#111219', title: 'PixelWall', webPreferences: { preload: join(desktopFolder, 'native-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
      window.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/|^mailto:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
      window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('pixelwall://app/')) { event.preventDefault(); if (/^https:\/\/|^mailto:/.test(url)) void shell.openExternal(url); } });
      const owner = window;
      const native = nativeFiles.attach(owner);
      nativeClipboard.attach(owner);
      const closeController = createCloseController({
        prepare: async attemptId => native.verifyClose(await runEditorAction(owner.webContents, 'prepareClose', attemptId)),
        cancel: attemptId => runEditorAction(owner.webContents, 'cancelClose', attemptId),
        isDestroyed: () => owner.isDestroyed(),
        isWaitingForUser: native.service.isWaitingForUser,
        confirmDiscard: async error => {
          const answer = await dialog.showMessageBox(owner, { type: 'warning', title: 'Save needs attention', message: 'PixelWall could not confirm that all projects were saved.', detail: `${error.message}\nKeep this window open and use Save or Save As to preserve your artwork.`, buttons: ['Keep editing', 'Close without saving'], defaultId: 0, cancelId: 0 });
          return answer.response === 1;
        },
        onKeepEditing: () => { quitting = false; },
        onReleaseError: error => { if (!owner.isDestroyed()) void dialog.showMessageBox(owner, { type: 'warning', title: 'Editor needs attention', message: error.message, detail: 'Your window has been kept open. Save a project backup before restarting PixelWall.', buttons: ['OK'] }).catch(() => {}); },
        close: () => { if (!owner.isDestroyed()) owner.destroy(); if (quitting) app.quit(); },
      });
      nativeFiles.enqueue(owner, pendingFiles.splice(0));
      owner.on('close', event => {
        event.preventDefault();
        void closeController.request();
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
      // Node fetch supplies the final response URL needed for strict feed validation.
      // Electron net.fetch currently omits it and uses a separate TLS implementation.
      fetch: (url, options) => globalThis.fetch(url, options),
      ...createFileSettingsStore(join(app.getPath('userData'), 'update-checker.json')),
      notify: updateDialog, openExternal: url => shell.openExternal(url),
    });
    const updateSettings = await updater.start();
    Menu.setApplicationMenu(Menu.buildFromTemplate(createDesktopMenuTemplate({
      platform: process.platform, appName: app.name, packaged: app.isPackaged, automaticChecks: updateSettings.automaticChecks,
      onCheck: () => { void updater.check({ manual: true }); },
      onToggle: enabled => { void updater.setAutomaticChecks(enabled); },
      onDocumentation: () => { void shell.openExternal('https://www.pixelwall.dev/guides/offline-and-downloads').catch(() => {}); },
      onAgentGuide: () => { void shell.openExternal('https://www.pixelwall.dev/guides/ai-agents').catch(() => {}); },
      onEditorAction: (action, selectedWindow) => {
        const owner = selectedWindow ?? BrowserWindow.getFocusedWindow() ?? window;
        if (!owner || owner.isDestroyed()) return;
        const clipboardGeneration = ['copy', 'cut', 'paste'].includes(action) ? nativeClipboard.revoke(owner) : undefined;
        void runEditorAction(owner.webContents, action, undefined, {authorizeClipboard: requested => nativeClipboard.authorize(owner, requested, {generation:clipboardGeneration})}).catch(error => {
          if (!owner.isDestroyed()) void dialog.showMessageBox(owner, { type: 'warning', title: 'Editor needs attention', message: error.message, buttons: ['OK'] }).catch(() => {});
        });
      },
    })));
    app.on('will-quit', () => { updater.dispose(); nativeFiles.dispose(); nativeClipboard.dispose(); });
  }).catch((error) => { dialog.showErrorBox('PixelWall could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

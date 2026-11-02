import { app, autoUpdater as nativeUpdater, BrowserWindow, protocol, net, shell, session, dialog, Menu, ipcMain, clipboard, nativeImage } from 'electron';
import electronUpdater from 'electron-updater';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { access } from 'node:fs/promises';
import { createFileSettingsStore, createDesktopMenuTemplate } from './update-checker.mjs';
import { createUpdateInstaller } from './update-installer.mjs';
import { createDesktopUpdater } from './desktop-updater.mjs';
import { createUpdateWindow } from './update-window.mjs';
import { createCloseController, createUpdateUnloadGuard, runEditorAction } from './editor-controls.mjs';
import { createNativeClipboardIpc } from './native-clipboard-ipc.mjs';
import { createNativeFileIpc } from './native-file-ipc.mjs';
import { createNativeBindingStore, nativePathsFromArgv } from './native-files.mjs';
import { createMcpBridge } from './mcp-bridge.mjs';
import { createAutomationTelemetrySettingsStore, createDesktopAutomationTelemetry } from './automation-telemetry.mjs';
import { createDesktopHealthSettingsStore, createDesktopHealthTelemetry } from './health-telemetry.mjs';
const desktopFolder = dirname(fileURLToPath(import.meta.url));
const folder = join(desktopFolder, 'app');
protocol.registerSchemesAsPrivileged([{ scheme: 'pixelwall', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
app.setName('PixelWall');
if (process.env.PIXELWALL_DESKTOP_USER_DATA) app.setPath('userData', resolve(process.env.PIXELWALL_DESKTOP_USER_DATA));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window;
  let healthReadyResolve;
  const healthReady = new Promise(resolve => { healthReadyResolve = resolve; });
  let nativeFiles;
  let closeController, installAction, savedForUpdate = false, mcpBridge;
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
    nativeFiles = createNativeFileIpc({ ipcMain, dialog, store: createNativeBindingStore(join(app.getPath('userData'), 'native-documents.json')),
      onReady: () => healthReady.then(() => healthTelemetry?.report({ operation: 'launch', outcome: 'success' })),
    });
    const nativeClipboard = createNativeClipboardIpc({ ipcMain, clipboard, nativeImage });
    function openWindow() {
      window = new BrowserWindow({ width: 1440, height: 980, minWidth: 960, minHeight: 640, backgroundColor: '#111219', title: 'PixelWall', webPreferences: { preload: join(desktopFolder, 'native-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
      window.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/|^mailto:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
      window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('pixelwall://app/')) { event.preventDefault(); if (/^https:\/\/|^mailto:/.test(url)) void shell.openExternal(url); } });
      window.webContents.on('will-prevent-unload', createUpdateUnloadGuard({ isRestarting: () => savedForUpdate }));
      const owner = window;
      owner.on('closed', () => { if (mcpBridge) { void mcpBridge.stop(); mcpBridge = undefined; } const item = Menu.getApplicationMenu()?.getMenuItemById('pixelwall-local-agent'); if (item) item.checked = false; });
      const native = nativeFiles.attach(owner);
      nativeClipboard.attach(owner);
      closeController = createCloseController({
        prepare: async attemptId => native.verifyClose(await runEditorAction(owner.webContents, 'prepareClose', attemptId)),
        cancel: attemptId => runEditorAction(owner.webContents, 'cancelClose', attemptId),
        isDestroyed: () => owner.isDestroyed(),
        isWaitingForUser: native.service.isWaitingForUser,
        confirmDiscard: async (error, { forUpdate } = {}) => {
          if (forUpdate) {
            await dialog.showMessageBox(owner, { type: 'warning', title: 'Update postponed', message: 'PixelWall could not safely restart for the update.', detail: `${error.message}\nYour artwork has been kept open. Save your work and try again.`, buttons: ['Keep editing'] });
            return false;
          }
          const answer = await dialog.showMessageBox(owner, { type: 'warning', title: 'Save needs attention', message: 'PixelWall could not confirm that all projects were saved.', detail: `${error.message}\nKeep this window open and use Save or Save As to preserve your artwork.`, buttons: ['Keep editing', 'Close without saving'], defaultId: 0, cancelId: 0 });
          return answer.response === 1;
        },
        onKeepEditing: () => { quitting = false; savedForUpdate = false; installAction = undefined; },
        onReleaseError: error => { if (!owner.isDestroyed()) void dialog.showMessageBox(owner, { type: 'warning', title: 'Editor needs attention', message: error.message, detail: 'Your window has been kept open. Save a project backup before restarting PixelWall.', buttons: ['OK'] }).catch(() => {}); },
        close: async ({ forUpdate } = {}) => {
          if (forUpdate) {
            savedForUpdate = true;
            try { await installAction(); }
            catch (error) { savedForUpdate = false; throw error; }
            return;
          }
          if (!owner.isDestroyed()) owner.destroy();
          if (quitting || process.platform !== 'darwin') app.quit();
        },
      });
      nativeFiles.enqueue(owner, pendingFiles.splice(0));
      owner.on('close', event => {
        if (savedForUpdate) return;
        event.preventDefault();
        void closeController.request();
      });
      void window.loadURL('pixelwall://app/editor');
    }
    openWindow();
    app.on('activate', () => { if ((!window || window.isDestroyed()) && !savedForUpdate) openWindow(); });
    let healthTelemetry;
    const installer = createUpdateInstaller({ engine: electronUpdater.autoUpdater, nativeUpdater, CancellationToken: electronUpdater.CancellationToken,
      currentVersion: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, appImagePath: process.env.APPIMAGE });
    let updateWindow;
    const updater = createDesktopUpdater({
      currentVersion: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged,
      // Node fetch supplies the final response URL needed for strict feed validation.
      // Electron net.fetch currently omits it and uses a separate TLS implementation.
      fetch: (url, options) => globalThis.fetch(url, options),
      ...createFileSettingsStore(join(app.getPath('userData'), 'update-checker.json')),
      installer,
      show: () => updateWindow.show(),
      onState: state => {
        updateWindow.send(state);
        if (window && !window.isDestroyed()) window.setProgressBar(state.status === 'downloading' ? state.progress / 100 : -1);
      },
      onHealth: async event => {
        if (!healthTelemetry) return;
        if (event.operation === 'update_install_attempt' && event.version) await healthTelemetry.setPendingVersion(event.version);
        if (event.operation === 'update_failure' && event.outcome === 'failure') await healthTelemetry.clearPendingVersion();
        healthTelemetry.report(event);
        if (event.operation === 'update_install_attempt') await healthTelemetry.flush(300);
      },
      restart: async action => {
        if (!window || window.isDestroyed()) { await action(); return true; }
        if (closeController.getState() !== 'idle') return false;
        installAction = action;
        await closeController.request({ forUpdate: true });
        return closeController.getState() === 'closed';
      },
      openExternal: url => shell.openExternal(url),
    });
    updateWindow = createUpdateWindow({ BrowserWindow, ipcMain, folder: desktopFolder, getState: updater.getState,
      action: name => name === 'check' ? updater.check({ manual: true }) : updater[name]() });
    const updateSettings = await updater.start();
    const automationTelemetry = createDesktopAutomationTelemetry({
      version: app.getVersion(), packaged: app.isPackaged,
      ...createAutomationTelemetrySettingsStore(join(app.getPath('userData'), 'automation-telemetry.json')),
    });
    const telemetrySettings = await automationTelemetry.start();
    const healthStore = createDesktopHealthSettingsStore(join(app.getPath('userData'), 'health-telemetry.json'));
    healthTelemetry = createDesktopHealthTelemetry({
      version: app.getVersion(), packaged: app.isPackaged,
      isReportingEnabled: () => automationTelemetry.isEnabled(),
      readSettings: async () => ({ ...await healthStore.readSettings(), enabled: telemetrySettings.enabled }),
      writeSettings: healthStore.writeSettings,
    });
    await healthTelemetry.start();
    healthReadyResolve();
    const toggleMcp = async enabled => {
      try {
        if (enabled) {
          const reporting = await dialog.showMessageBox(window, {
            type: 'question',
            title: 'Local agent usage reporting',
            message: automationTelemetry.isEnabled() ? 'Anonymous app and MCP usage reporting is on.' : 'Anonymous app and MCP usage reporting is off.',
            detail: 'PixelWall reports app launches, update outcomes, and bounded MCP operation totals. It does not send artwork, scripts, file paths, agent names, or persistent IDs. You can change this anytime in Help → Share anonymous app and MCP usage.',
            buttons: automationTelemetry.isEnabled() ? ['Continue with reporting on', 'Turn reporting off and continue'] : ['Enable reporting and continue', 'Keep reporting off'],
            defaultId: automationTelemetry.isEnabled() ? 0 : 1,
            cancelId: 1,
          });
          if (reporting.response === 1) { void healthTelemetry.setEnabled(false); await automationTelemetry.setEnabled(false); }
          else if (!automationTelemetry.isEnabled()) await automationTelemetry.setEnabled(true);
          await healthTelemetry.setEnabled(automationTelemetry.isEnabled());
          const picked = await dialog.showOpenDialog(window, { title: 'Choose the local agent export folder', properties: ['openDirectory', 'createDirectory'] });
          if (picked.canceled || !picked.filePaths[0]) { const item = Menu.getApplicationMenu()?.getMenuItemById('pixelwall-local-agent'); if (item) item.checked = false; return; }
          if (mcpBridge) await mcpBridge.stop();
          mcpBridge = createMcpBridge({ webContents: window.webContents, appVersion: app.getVersion(), configPath: join(app.getPath('home'), '.pixelwall', 'mcp.json'), exportRoot: picked.filePaths[0], telemetry: automationTelemetry, onStatus: status => window.webContents.send('pixelwall:mcp:changed', status) });
          await mcpBridge.start();
          void dialog.showMessageBox(window, { type: 'info', title: 'Local agent connection enabled', message: `Agents can control this window while PixelWall is open.\n\nApproved export folder:\n${picked.filePaths[0]}\n\nConfigure your MCP client to run:\nnode pixelwall-mcp.mjs`, buttons: ['OK'] });
        } else if (mcpBridge) await mcpBridge.stop();
        const item = Menu.getApplicationMenu()?.getMenuItemById('pixelwall-local-agent'); if (item) item.checked = !!mcpBridge?.connected;
        window.webContents.send('pixelwall:mcp:changed', mcpBridge?.status?.() || { connected: false });
      } catch (error) {
        if (enabled) await mcpBridge?.stop().catch(() => {});
        const item = Menu.getApplicationMenu()?.getMenuItemById('pixelwall-local-agent'); if (item) item.checked = false;
        window.webContents.send('pixelwall:mcp:changed', { connected: false });
        void dialog.showMessageBox(window, { type: 'warning', title: 'Local agent connection unavailable', message: error.message, buttons: ['OK'] }).catch(() => {});
      }
    };
    const toggleDesktopTelemetry = async enabled => {
      try {
        if (enabled) {
          const answer = await dialog.showMessageBox(window, {
            type: 'question', title: 'Share anonymous app and MCP usage?',
            message: 'Help improve PixelWall by sharing anonymous app health and agent operation totals?',
            detail: 'PixelWall sends bounded lifecycle categories such as launch and update result, plus MCP operation totals, app version, operating system, and limited export or preview categories. It never sends artwork, file paths, content, IDs, agent names, or error text. This is separate from allowing a local agent connection and can be turned off here at any time.',
            buttons: ['Share anonymous usage', 'Keep disabled'], defaultId: 0, cancelId: 1,
          });
          if (answer.response !== 0) enabled = false;
        }
        // Withdraw both reporters immediately; a slow health-state write must
        // not delay withdrawal of the authoritative MCP reporting preference.
        if (!enabled) void healthTelemetry?.setEnabled(false);
        const next = await automationTelemetry.setEnabled(enabled);
        await healthTelemetry?.setEnabled(next.enabled);
        const item = Menu.getApplicationMenu()?.getMenuItemById('pixelwall-desktop-telemetry'); if (item) item.checked = next.enabled;
      } catch {
        const item = Menu.getApplicationMenu()?.getMenuItemById('pixelwall-desktop-telemetry'); if (item) item.checked = false;
        void dialog.showMessageBox(window, { type: 'warning', title: 'Anonymous MCP usage unavailable', message: 'PixelWall could not update this preference.', buttons: ['OK'] }).catch(() => {});
      }
    };
    const trustedMcpFrame = event => event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === 'pixelwall://app/editor';
    ipcMain.handle('pixelwall:mcp:status', event => trustedMcpFrame(event) ? (mcpBridge?.status?.() || { enabled: false, connected: false }) : { enabled: false, connected: false });
    ipcMain.handle('pixelwall:mcp:disable', async event => { if (!trustedMcpFrame(event)) throw Error('The local agent connection is restricted to the editor window.'); await toggleMcp(false); return mcpBridge?.status?.() || { enabled: false, connected: false }; });
    Menu.setApplicationMenu(Menu.buildFromTemplate(createDesktopMenuTemplate({
      platform: process.platform, appName: app.name, packaged: app.isPackaged, automaticChecks: updateSettings.automaticChecks,
      onCheck: () => { void updater.check({ manual: true }); },
      onToggle: enabled => { void updater.setAutomaticChecks(enabled); },
      onDocumentation: () => { void shell.openExternal('https://www.pixelwall.dev/guides/offline-and-downloads').catch(() => {}); },
      onAgentGuide: () => { void shell.openExternal('https://www.pixelwall.dev/guides/ai-agents').catch(() => {}); },
      onMcpToggle: toggleMcp, mcpConnected: !!mcpBridge?.connected,
      desktopTelemetryEnabled: telemetrySettings.enabled,
      onDesktopTelemetryToggle: enabled => { void toggleDesktopTelemetry(enabled); },
      onEditorAction: (action, selectedWindow) => {
        const focused = selectedWindow ?? BrowserWindow.getFocusedWindow();
        if (focused && focused !== window) {
          // Shortcuts in the update window must never edit artwork behind it.
          if (['copy', 'cut', 'paste', 'undo', 'redo'].includes(action)) focused.webContents[action]();
          return;
        }
        const owner = window;
        if (!owner || owner.isDestroyed()) return;
        const clipboardGeneration = ['copy', 'cut', 'paste'].includes(action) ? nativeClipboard.revoke(owner) : undefined;
        void runEditorAction(owner.webContents, action, undefined, {authorizeClipboard: requested => nativeClipboard.authorize(owner, requested, {generation:clipboardGeneration})}).catch(error => {
          if (!owner.isDestroyed()) void dialog.showMessageBox(owner, { type: 'warning', title: 'Editor needs attention', message: error.message, buttons: ['OK'] }).catch(() => {});
        });
      },
    })));
    app.on('will-quit', () => { updater.dispose(); automationTelemetry.dispose(); healthTelemetry?.dispose(); updateWindow.dispose(); nativeFiles.dispose(); nativeClipboard.dispose(); void mcpBridge?.stop(); });
  }).catch((error) => { dialog.showErrorBox('PixelWall could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

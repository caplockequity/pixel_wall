// Real Electron transport and sandboxed update-window smoke test. Loopback only;
// never stages an OS update, installs an application, or uses the user's app data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { app, autoUpdater as nativeUpdater, BrowserWindow, ipcMain } from 'electron';
import { createUpdateInstaller, updateMetadataName, RELEASE_BASE } from '../desktop/update-installer.mjs';
import { createUpdateWindow } from '../desktop/update-window.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'desktop/package.json'));
const scratch = mkdtempSync(join(tmpdir(), 'pixelwall-updater-smoke-'));
app.setPath('userData', scratch);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  let server, installer, view;
  try {
    const library = require('electron-updater');
    const engine = library.autoUpdater;
    engine.forceDevUpdateConfig = true;
    Object.defineProperty(engine.app, 'baseCachePath', { value: scratch });
    const config = join(scratch, 'app-update.yml');
    await writeFile(config, JSON.stringify({ updaterCacheDirName: 'test-cache' }));
    engine.updateConfigPath = config;
    const currentVersion = engine.currentVersion.format(), version = '999.0.0';
    const platform = process.platform, arch = process.arch;
    const suffix = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : 'linux';
    const ext = platform === 'darwin' ? 'zip' : platform === 'win32' ? 'exe' : 'AppImage';
    const filename = `PixelWall-${version}-${suffix}-${arch}.${ext}`;
    const bytes = Buffer.alloc(1024 * 1024 + 1, 42);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const info = { version, files: [{ url: filename, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') }] };
    const metadataName = updateMetadataName(platform, arch), requests = [];
    server = createServer((request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      requests.push(pathname);
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers.cookie, undefined);
      if (pathname === `/${metadataName}`) { response.setHeader('content-type', 'text/yaml'); response.end(JSON.stringify(info)); }
      else if (pathname === `/${filename}`) { response.setHeader('content-length', bytes.length); response.end(bytes); }
      else { response.writeHead(404); response.end(); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const originalSetFeed = engine.setFeedURL.bind(engine);
    engine.setFeedURL = options => {
      assert.equal(options.url, `${RELEASE_BASE}desktop-v${version}/`);
      originalSetFeed({ ...options, url: `http://127.0.0.1:${server.address().port}/` });
    };
    engine.quitAndInstall = () => assert.fail('Smoke test must never install or relaunch.');
    installer = createUpdateInstaller({ engine, nativeUpdater, CancellationToken: library.CancellationToken,
      currentVersion, platform, arch, packaged: true, appImagePath: platform === 'linux' ? join(scratch, 'app.AppImage') : undefined,
      checkWritable: async () => {} });
    const candidate = { manifest: { version }, download: { filename, size: bytes.length, sha256 }, signal: new AbortController().signal, onProgress: () => {} };
    await installer.download(candidate);
    assert.deepEqual(requests, [`/${metadataName}`, `/${filename}`]);
    assert.equal(engine.autoInstallOnAppQuit, false);
    if (platform === 'darwin') assert.equal(engine.squirrelDownloadedUpdate, false);
    // A cached artifact still has to match the independent website hash.
    await assert.rejects(installer.download({ ...candidate, download: { ...candidate.download, sha256: '0'.repeat(64) } }), /verification/);
    console.log('PASS: real updater metadata, download, cache, hashes, and no implicit install');

    let window;
    function HiddenWindow(options) {
      window = new BrowserWindow({ ...options, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false, offscreen: true } });
      window.show = () => {}; window.focus = () => {};
      return window;
    }
    let state = { status: 'available', version: '0.3.3', currentVersion: '0.3.2', notes: ['Download and install updates inside PixelWall.'], message: '' };
    const actions = [];
    view = createUpdateWindow({ BrowserWindow: HiddenWindow, ipcMain, folder: join(root, 'desktop'), getState: () => state, action: name => actions.push(name) });
    view.show();
    console.log('Checking the sandboxed update window…');
    await once(window.webContents, 'did-finish-load');
    await window.webContents.executeJavaScript('window.pixelwallUpdates.state()');
    // Wait for initial state IPC/render, without relying on an arbitrary sleep.
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.match(await window.webContents.executeJavaScript('document.body.innerText'), /Download update/);
    await window.webContents.executeJavaScript("window.pixelwallUpdates.action('download')");
    assert.deepEqual(actions, ['download']);
    await window.webContents.executeJavaScript("window.pixelwallUpdates.action('run-shell')");
    assert.deepEqual(actions, ['download']);
    const otherWindow = new BrowserWindow({ show: false, webPreferences: { preload: join(root, 'desktop/update-preload.cjs'), sandbox: true, contextIsolation: true } });
    await otherWindow.loadFile(join(root, 'desktop/update.html'));
    assert.equal(await otherWindow.webContents.executeJavaScript('window.pixelwallUpdates.state()'), null);
    await otherWindow.webContents.executeJavaScript("window.pixelwallUpdates.action('install')");
    assert.deepEqual(actions, ['download'], 'Another renderer must not trigger installation.');
    otherWindow.destroy();
    state = { ...state, status: 'downloading', progress: 42 }; view.send(state);
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(resolve))');
    assert.equal(await window.webContents.executeJavaScript('document.querySelector("progress").value'), 42);
    state = { ...state, status: 'ready' }; view.send(state);
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(resolve))');
    assert.match(await window.webContents.executeJavaScript('document.body.innerText'), /Restart to update/);
    const output = join(root, 'outputs/desktop-updater'); await mkdir(output, { recursive: true });
    await writeFile(join(output, 'update-ready.png'), (await window.webContents.capturePage()).toPNG());
    console.log('PASS: sandboxed update window, progress, ready state, and restricted IPC');
  } finally {
    view?.dispose(); installer?.dispose(); server?.closeAllConnections(); server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

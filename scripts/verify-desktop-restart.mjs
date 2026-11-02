// Regression smoke test for the native updater restart path. It uses a private
// Electron profile and a local data URL; it never touches the installed app.
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { createCloseController, createUpdateUnloadGuard } from '../desktop/editor-controls.mjs';
import { createDesktopSession } from '../app/desktop-session.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratchRoot = process.env.PIXELWALL_DESKTOP_TEST_OUTPUT || process.env.TMPDIR || '/tmp';
mkdirSync(scratchRoot, { recursive: true });
const userData = mkdtempSync(join(scratchRoot, 'user-data-'));
app.setPath('userData', userData);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const watchdog = setTimeout(() => {
  console.error('Desktop restart regression exceeded 15 seconds.');
  app.exit(1);
}, 15_000);

const waitFor = (event, emitter, timeout = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { emitter.removeListener(event, done); reject(new Error(`Timed out waiting for ${event}.`)); }, timeout);
  const done = (...args) => { clearTimeout(timer); resolve(args); };
  emitter.once(event, done);
});

void app.whenReady().then(async () => {
  const mainSource = await readFile(join(root, 'desktop/main.mjs'), 'utf8');
  assert.match(mainSource, /createUpdateUnloadGuard/, 'Updater close path must guard the restart quit.');
  assert.match(mainSource, /will-prevent-unload/, 'Updater quit must release a renderer unload veto.');

  const ordinary = new BrowserWindow({
    show: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  let ordinaryPrevented = 0;
  let ordinaryClosed = false;
  ordinary.webContents.on('will-prevent-unload', event => {
    ordinaryPrevented += 1;
    createUpdateUnloadGuard({ isRestarting: () => false })(event);
  });
  ordinary.once('closed', () => { ordinaryClosed = true; });
  await ordinary.loadURL('data:text/html,<title>PixelWall updater restart fixture</title>');
  await ordinary.webContents.executeJavaScript('window.addEventListener("beforeunload", event => event.preventDefault())');
  const ordinaryVeto = waitFor('will-prevent-unload', ordinary.webContents);
  ordinary.close();
  await ordinaryVeto;
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(ordinaryPrevented > 0, 'Fixture must exercise the renderer unload veto.');
  assert.equal(ordinaryClosed, false, 'A renderer veto should keep an ordinary close open.');
  const ordinaryCleanup = waitFor('closed', ordinary);
  ordinary.destroy();
  await ordinaryCleanup;
  // Exercise the actual save handshake used before update installation.
  let installAuthorized = false;
  const desktop = createDesktopSession({
    desktopState: () => ({ loaded: true, id: 'restart-fixture', revision: 1, canSave: true, busy: false }),
    saveForClose: async () => ({ saved: true, document: { id: 'restart-fixture' }, revision: 1 }),
  });
  const closeController = createCloseController({
    prepare: attemptId => desktop.prepareClose(attemptId),
    cancel: attemptId => desktop.cancelClose(attemptId),
    confirmDiscard: async () => false,
    close: async ({ forUpdate }) => {
      assert.equal(forUpdate, true);
      assert.equal(desktop.locked, true, 'Edits must remain locked after saving.');
      installAuthorized = true;
    },
  });
  await closeController.request({ forUpdate: true });
  assert.equal(installAuthorized, true, 'Restart must wait for a successful save handshake.');

  // A fresh native close models the updater's quit path after the handshake.
  const approved = new BrowserWindow({ show: true, webPreferences: { contextIsolation: true, sandbox: true } });
  let approvedPrevented = 0;
  approved.webContents.on('will-prevent-unload', event => {
    approvedPrevented += 1;
    createUpdateUnloadGuard({ isRestarting: () => installAuthorized })(event);
  });
  await approved.loadURL('data:text/html,<title>PixelWall updater restart fixture</title>');
  await approved.webContents.executeJavaScript('window.addEventListener("beforeunload", event => event.preventDefault())');
  const approvedVeto = waitFor('will-prevent-unload', approved.webContents);
  const approvedClosed = waitFor('closed', approved);
  approved.close();
  await approvedVeto;
  await approvedClosed;
  assert.ok(approvedPrevented > 0, 'Approved restart must encounter the renderer veto.');
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  console.log(JSON.stringify({ status: 'passed', checks: ['production-wiring', 'renderer-unload-veto-released', 'window-closed'], userData }));
}).then(async () => {
  clearTimeout(watchdog);
  await rm(userData, { recursive: true, force: true });
  app.exit(0);
}).catch(async error => {
  clearTimeout(watchdog);
  console.error(error.stack || String(error));
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await rm(userData, { recursive: true, force: true });
  app.exit(1);
});

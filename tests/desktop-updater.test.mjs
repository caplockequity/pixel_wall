import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDesktopUpdater } from '../desktop/desktop-updater.mjs';
import { createUpdateInstaller, updateMetadataName, validateInstallInfo, RELEASE_BASE } from '../desktop/update-installer.mjs';
import { createCloseController } from '../desktop/editor-controls.mjs';
import { UPDATE_FEED_URL } from '../desktop/update-checker.mjs';

const version = '0.3.3', currentVersion = '0.3.2';
const filename = `PixelWall-${version}-mac-arm64.zip`;
const download = { filename, url: `https://www.pixelwall.dev/downloads/desktop/${version}/${filename}`, sha256: 'a'.repeat(64), size: 1234 };
const manifest = { schemaVersion: 1, version, releaseNotes: ['Better updates.'], releaseNotesUrl: 'https://www.pixelwall.dev/downloads#release-0-3-3', downloads: { 'darwin-arm64': download } };
const metadata = () => ({ version, files: [{ url: filename, size: download.size, sha512: 'a'.repeat(86) + '==' }] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function response() { const result = new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }); Object.defineProperty(result, 'url', { value: UPDATE_FEED_URL }); return result; }
function uiHarness(overrides = {}) {
  const states = [], actions = [];
  const controller = createDesktopUpdater({ currentVersion, platform: 'darwin', arch: 'arm64', packaged: false,
    fetch: async () => response(), onState: state => states.push(state), show: () => actions.push('show'),
    openExternal: url => actions.push(url), restart: async install => { actions.push('save'); await install(); return true; },
    installer: { download: async ({ onProgress }) => { actions.push('download'); onProgress(42); }, install: async () => actions.push('install'), dispose() {} }, ...overrides });
  return { controller, states, actions };
}
test('update discovery does not download; download and restart require separate user actions', async () => {
  const run = uiHarness();
  await run.controller.check({ manual: true });
  assert.equal(run.controller.getState().status, 'available');
  assert.ok(!run.actions.includes('download'));
  await run.controller.download();
  assert.equal(run.controller.getState().status, 'ready');
  assert.ok(run.states.some(state => state.progress === 42));
  assert.ok(!run.actions.includes('install'));
  await run.controller.check({ manual: true });
  assert.equal(run.controller.getState().status, 'ready');
  await run.controller.install();
  assert.deepEqual(run.actions.slice(-2), ['save', 'install']);
});
test('cancellation joins concurrent downloads, preserves the candidate, and supports retry', async () => {
  let count = 0;
  const waiting = deferred();
  const run = uiHarness({ installer: { download: async ({ signal }) => { count++; if (count === 1) { signal.addEventListener('abort', () => waiting.reject(new Error('Cancelled'))); await waiting.promise; } }, dispose() {} } });
  await run.controller.check({ manual: true });
  const first = run.controller.download();
  assert.equal(first, run.controller.download());
  run.controller.cancel(); await first;
  assert.equal(run.controller.getState().status, 'available');
  await run.controller.download();
  assert.equal(count, 2); assert.equal(run.controller.getState().status, 'ready');
});
test('download failures expose retry, while background network failures stay silent', async () => {
  const run = uiHarness({ installer: { download: async () => { throw new Error('checksum'); }, dispose() {} } });
  await run.controller.check(); await run.controller.download();
  assert.equal(run.controller.getState().retry, 'download');
  assert.equal(run.controller.getState().status, 'error');
  const offline = uiHarness({ fetch: async () => { throw new Error('offline'); } });
  await offline.controller.check(); assert.deepEqual(offline.actions, []);
  await offline.controller.check({ manual: true }); assert.equal(offline.controller.getState().retry, 'check');
});
test('a cancelled save retains the ready update without installing', async () => {
  const run = uiHarness({ restart: async () => false });
  await run.controller.check(); await run.controller.download(); await run.controller.install();
  assert.equal(run.controller.getState().status, 'ready');
  assert.ok(!run.actions.includes('install'));
});
test('disposing a download suppresses late state changes and ready notifications', async () => {
  const waiting = deferred();
  const run = uiHarness({ installer: { download: () => waiting.promise, dispose() {} } });
  await run.controller.check(); const job = run.controller.download();
  run.controller.dispose(); const count = run.states.length; waiting.resolve(); await job;
  assert.equal(run.states.length, count);
});

function engineHarness(overrides = {}) {
  const events = [];
  const nativeUpdater = new EventEmitter(); nativeUpdater.on('error', () => {});
  const engine = new EventEmitter();
  engine.setFeedURL = config => events.push(config);
  engine.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: metadata() });
  engine.downloadUpdate = async () => { events.push('download'); engine.emit('download-progress', { percent: 30 }); engine.emit('update-downloaded', { downloadedFile: '/test/update.zip' }); };
  engine.quitAndInstall = () => { events.push('install'); nativeUpdater.emit('before-quit-for-update'); };
  nativeUpdater.checkForUpdates = () => { events.push('stage'); engine.squirrelDownloadedUpdate = true; nativeUpdater.emit('update-downloaded'); };
  class CancellationToken { cancel() { events.push('cancel'); } }
  const installer = createUpdateInstaller({ engine, nativeUpdater, CancellationToken, currentVersion, platform: 'darwin', arch: 'arm64', packaged: true,
    verify: async (_path, checksum) => { assert.equal(checksum, download.sha256); events.push('verify'); }, ...overrides });
  return { engine, nativeUpdater, installer, events, download: () => installer.download({ manifest, download, signal: new AbortController().signal, onProgress: () => {} }) };
}
test('installer pins version and architecture, verifies both manifests, and only stages Mac after consent', async () => {
  const run = engineHarness();
  assert.equal(run.engine.autoDownload, false); assert.equal(run.engine.autoInstallOnAppQuit, false);
  await run.download();
  assert.equal(run.events[0].url, `${RELEASE_BASE}desktop-v${version}/`);
  assert.equal(run.events[0].channel, 'latest-arm64');
  assert.deepEqual(run.events.slice(1), ['download', 'verify']);
  await run.installer.install();
  assert.deepEqual(run.events.slice(-3), ['verify', 'stage', 'install']);
  run.installer.dispose();
});
for (const [name, change] of [
  ['wrong version', info => { info.version = '0.3.4'; }], ['wrong architecture', info => { info.files[0].url = filename.replace('arm64', 'x64'); }],
  ['external artifact', info => { info.files[0].url = 'https://evil.example/update.zip'; }], ['missing checksum', info => { delete info.files[0].sha512; }],
  ['wrong size', info => { info.files[0].size++; }], ['extra files', info => { info.files.push({ ...info.files[0] }); }],
  ['web installer', info => { info.packages = {}; }], ['alternate path', info => { info.path = '../other.zip'; }],
]) test(`installer rejects ${name} before downloading`, async () => {
  const run = engineHarness(); const info = metadata(); change(info);
  run.engine.checkForUpdates = async () => ({ isUpdateAvailable: true, updateInfo: info });
  await assert.rejects(run.download()); assert.ok(!run.events.includes('download'));
  await assert.rejects(run.installer.install(), /verify/);
});
test('failed artifact hash prevents installation', async () => {
  const run = engineHarness({ verify: async () => { throw new Error('checksum'); } });
  await assert.rejects(run.download(), /checksum/); await assert.rejects(run.installer.install(), /verify/);
});
test('an OS-incompatible release cannot download a stale previously checked candidate', async () => {
  const run = engineHarness();
  run.engine.checkForUpdates = async () => ({ isUpdateAvailable: false, updateInfo: metadata() });
  await assert.rejects(run.download(), /not supported/);
  assert.ok(!run.events.includes('download'));
});
test('failed or timed-out native staging never registers a late forced restart', async () => {
  for (const timeout of [false, true]) {
    const run = engineHarness({ installTimeoutMs: 10 }); await run.download();
    run.nativeUpdater.checkForUpdates = () => { if (!timeout) run.nativeUpdater.emit('error', new Error('signature')); };
    await assert.rejects(run.installer.install(), timeout ? /too long/ : /signature/);
    run.nativeUpdater.emit('update-downloaded');
    assert.ok(!run.events.includes('install'));
    run.installer.dispose();
  }
});
test('asynchronous Windows installer errors reject the restart', async () => {
  const run = engineHarness({ platform: 'win32', arch: 'x64' }); await run.download();
  run.engine.quitAndInstall = () => setImmediate(() => run.engine.emit('error', new Error('installer failed')));
  await assert.rejects(run.installer.install(), /installer failed/);
});
test('development builds and non-writable AppImages cannot download updates', async () => {
  for (const options of [{ packaged: false }, { platform: 'linux' }, { platform: 'linux', appImagePath: '/test/PixelWall.AppImage', checkWritable: async () => { throw new Error('read-only'); } }]) {
    const run = engineHarness(options); await assert.rejects(run.download()); assert.equal(run.events.length, 0);
  }
});
test('metadata channels cannot collide between CPU architectures or operating systems', () => {
  assert.deepEqual(['darwin/arm64', 'darwin/x64', 'win32/x64', 'linux/x64'].map(value => updateMetadataName(...value.split('/'))),
    ['latest-arm64-mac.yml', 'latest-x64-mac.yml', 'latest-x64.yml', 'latest-x64-linux.yml']);
  assert.throws(() => validateInstallInfo(metadata(), { manifest, download, currentVersion: version }));
});
test('update restart requires save acknowledgement and refuses discard on failure', async () => {
  for (const failure of ['save', 'install']) {
    const events = [];
    const controller = createCloseController({ prepare: async attemptId => {
      events.push('save'); if (failure === 'save') throw new Error('disk full'); return { status: 'ready', attemptId, id: 'doc', revision: 1 };
    }, cancel: async () => events.push('unlock'), confirmDiscard: async () => true,
    close: async ({ forUpdate }) => { assert.equal(forUpdate, true); events.push('install'); throw new Error('signature'); } });
    await controller.request({ forUpdate: true });
    assert.equal(controller.getState(), 'idle'); assert.equal(events.at(-1), 'unlock');
    assert.equal(events.includes('install'), failure === 'install');
  }
});
test('update restart holds the renderer lock while native staging is in flight', async () => {
  const waiting = deferred(), events = [];
  const controller = createCloseController({ prepare: async attemptId => ({ status: 'ready', attemptId, id: 'doc', revision: 1 }),
    cancel: async () => events.push('unlock'), confirmDiscard: async () => false,
    close: async () => { events.push('stage'); await waiting.promise; events.push('quit'); } });
  const job = controller.request({ forUpdate: true }); await tick();
  assert.equal(controller.getState(), 'preparing'); assert.deepEqual(events, ['stage']);
  waiting.resolve(); await job; assert.equal(controller.getState(), 'closed'); assert.deepEqual(events, ['stage', 'quit']);
});

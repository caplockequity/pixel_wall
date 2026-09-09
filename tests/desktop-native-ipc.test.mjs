import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createNativeFileIpc, trustedNativeSender, NATIVE_METHODS } from '../desktop/native-file-ipc.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const owner = new EventEmitter(), contents = new EventEmitter(), handlers = new Map(), received = [], calls = [];
  contents.id = 1; contents.mainFrame = { url: 'pixelwall://app/editor' }; contents.send = (channel, payload) => received.push([channel, payload]);
  owner.webContents = contents; owner.isDestroyed = () => false;
  const api = createNativeFileIpc({ ipcMain: { handle: (name, cb) => handlers.set(name, cb), removeHandler: name => handlers.delete(name) }, createService: () => ({
    openPaths: async paths => { calls.push(['openPaths', paths]); return { status: 'opened', files: paths }; },
    open: async () => { calls.push(['open']); return 'open result'; },
    verifyClose: async result => result, dispose: () => calls.push(['dispose']),
  }) });
  const attached = api.attach(owner), event = { sender: contents, senderFrame: contents.mainFrame };
  const invoke = (method, payload, from = event) => handlers.get(`pixelwall:native:${method}`)(from, payload);
  return { api, owner, contents, event, received, calls, attached, invoke, handlers };
}
test('native IPC only accepts the exact owning top frame on the packaged app origin', async () => {
  const run = harness();
  assert.equal(await run.invoke('open'), 'open result');
  for (const event of [{ sender: { id: 1 }, senderFrame: run.contents.mainFrame }, { sender: run.contents, senderFrame: { url: 'pixelwall://app/editor' } }, { sender: { id: 2 }, senderFrame: run.contents.mainFrame }]) await assert.rejects(run.invoke('open', null, event), /restricted/);
  for (const url of ['https://www.pixelwall.dev/editor', 'pixelwall://other/editor', 'pixelwall://app.evil/editor', 'pixelwall://app/other']) {
    run.contents.mainFrame.url = url; assert.equal(trustedNativeSender(run.event, run.owner), false);
  }
  run.api.dispose(); assert.equal(run.handlers.size, 0);
});
test('OS file events wait until renderer ready, drain once, and block close while queued', async () => {
  const run = harness(); run.api.enqueue(run.owner, ['/one.pixelwall']); await tick(); assert.equal(run.received.length, 0);
  assert.equal((await run.attached.verifyClose({ status: 'ready' })).status, 'blocked');
  await run.invoke('ready'); await tick(); assert.deepEqual(run.received[0], ['pixelwall:native:opened', { status: 'opened', files: ['/one.pixelwall'], deliveryId: run.received[0][1].deliveryId }]);
  assert.equal(typeof run.received[0][1].deliveryId, 'string');
  await run.invoke('ready'); await tick(); assert.equal(run.received.length, 1);
  run.api.dispose();
});
test('reload stops delivery until a new renderer subscription is ready', async () => {
  const run = harness(); await run.invoke('ready');
  run.contents.emit('did-start-navigation', {}, 'pixelwall://app/editor', false, true);
  run.api.enqueue(run.owner, ['/two.pixelwall']); await tick(); assert.equal(run.received.length, 0);
  await run.invoke('ready'); await tick(); assert.equal(run.received.length, 1);
  run.owner.emit('closed'); assert.equal(run.calls.at(-1)[0], 'dispose');
  await assert.rejects(run.invoke('open'), /restricted/); run.api.dispose();
});
test('sandbox preload exposes only fixed methods and strips IPC events from notifications', async () => {
  const source = await readFile(new URL('../desktop/native-preload.cjs', import.meta.url), 'utf8');
  let bridge, listener, removed;
  const messages = [], secretEvent = { sender: 'privileged' };
  vm.runInNewContext(source, { require(name) { assert.equal(name, 'electron'); return {
    contextBridge: { exposeInMainWorld: (name, api) => { assert.ok(['pixelwallNativeFiles', 'pixelwallNativeClipboard'].includes(name)); if (name === 'pixelwallNativeFiles') bridge = api; } },
    ipcRenderer: { invoke: (channel, payload) => messages.push([channel, payload]), on: (channel, fn) => { listener = fn; }, removeListener: (_channel, fn) => { removed = fn; } },
  }; } });
  assert.deepEqual(Object.keys(bridge).sort(), [...NATIVE_METHODS, 'onOpen'].sort());
  assert.equal(bridge.send, undefined); assert.equal(bridge.invoke, undefined); assert.equal(bridge.readFile, undefined);
  bridge.info({ documentId: 'doc' }); assert.deepEqual(messages[0], ['pixelwall:native:info', { documentId: 'doc' }]);
  let notified; const stop = bridge.onOpen((...args) => { notified = args; }); listener(secretEvent, { files: [] });
  assert.deepEqual(notified, [{ files: [] }]); stop(); assert.equal(removed, listener);
});
test('desktop packages native modules, preserves sandbox settings and declares both editable associations', async () => {
  const main = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  for (const file of ['native-files.mjs', 'native-file-ipc.mjs', 'native-preload.cjs']) assert.ok(pkg.build.files.includes(file));
  assert.match(main, /contextIsolation: true, nodeIntegration: false, sandbox: true/);
  assert.match(main, /app\.on\('open-file'/); assert.match(main, /native\.verifyClose/); assert.match(main, /nativePathsFromArgv\(argv/);
  assert.deepEqual(pkg.build.fileAssociations.map(value => [value.ext, value.role]), [['pixelwall', 'Editor'], ['aseprite', 'Editor']]);
});

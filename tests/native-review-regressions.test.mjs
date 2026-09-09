import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { createNativeFileService, atomicSaveNative, readNativeFile } from '../desktop/native-files.mjs';
import { createNativeFileIpc } from '../desktop/native-file-ipc.mjs';
import { createNativeDocumentSession } from '../app/native-document-session.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const project = name => Buffer.from(JSON.stringify({ format: 'pixelwall-document', version: 4, name }));
const ready = nativeDocuments => ({ status: 'ready', attemptId: 'review', id: 'a', revision: 1, nativeDocuments });
async function folder(t) { const path = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'pixelwall-native-regression-'))); t.after(() => fs.rm(path, { recursive: true, force: true })); return path; }
async function open(service, path, id) { const result = await service.openPaths([path]); const file = result.files[0]; await service.bindOpen({ token: file.token, documentId: id, revision: 1 }); }
function ipcHarness(t, configure = service => service) {
  const owner = new EventEmitter(), contents = new EventEmitter(), handlers = new Map(), received = [];
  contents.id = 11; contents.mainFrame = { url: 'pixelwall://app/editor' }; owner.webContents = contents; owner.isDestroyed = () => false;
  let uiReady = false, generation = 0, service;
  const firstDelivery = deferred();
  contents.send = (channel, payload) => { received.push({ channel, payload: structuredClone(payload), uiReady, generation }); firstDelivery.resolve(); };
  const ipc = createNativeFileIpc({ ipcMain: { handle: (name, callback) => handlers.set(name, callback), removeHandler: name => handlers.delete(name) }, createService: options => { service = configure(createNativeFileService(options)); return service; } });
  const attached = ipc.attach(owner), event = { sender: contents, senderFrame: contents.mainFrame };
  const invoke = (method, payload) => handlers.get(`pixelwall:native:${method}`)(event, payload);
  t.after(() => ipc.dispose());
  return { ipc, attached, owner, received, invoke, service, firstDelivery: firstDelivery.promise, ready: async () => { uiReady = true; await invoke('ready'); await tick(); }, navigate: () => { uiReady = false; generation++; contents.emit('did-start-navigation', {}, 'pixelwall://app/editor', false, true); } };
}
test('native close rechecks the complete binding membership after its asynchronous fingerprint reads', async t => {
  const dir = await folder(t), a = join(dir, 'a.pixelwall'), b = join(dir, 'b.pixelwall'); await fs.writeFile(a, project('a')); await fs.writeFile(b, project('b'));
  const entered = deferred(), release = deferred(); let pause = false;
  const service = createNativeFileService({ fs: { ...fs, lstat: async path => { if (pause && path === a) { pause = false; entered.resolve(); await release.promise; } return fs.lstat(path); } } });
  await open(service, a, 'a'); pause = true;
  const closing = service.verifyClose(ready([{ id: 'a', revision: 1 }])); await entered.promise;
  await open(service, b, 'b'); release.resolve();
  assert.equal((await closing).status, 'blocked'); assert.equal((await service.list()).length, 2);
});
test('two concurrent Save As selections cannot reserve or overwrite the same target', async t => {
  const dir = await folder(t), path = join(dir, 'shared.pixelwall'); await fs.writeFile(path, project('original'));
  const both = deferred(), release = deferred(); let reads = 0;
  const service = createNativeFileService({ fs: { ...fs, lstat: async target => { if (target === path && reads < 2) { reads++; if (reads === 2) both.resolve(); await release.promise; } return fs.lstat(target); } }, dialog: { showSaveDialog: async () => ({ canceled: false, filePath: path }) } });
  const choosing = Promise.all(['a', 'b'].map(documentId => service.chooseSave({ documentId }))); await both.promise; release.resolve(); const choices = await choosing;
  assert.deepEqual(choices.map(choice => choice.status).sort(), ['error', 'ready']);
  assert.deepEqual(await fs.readFile(path), project('original'));
  const winner = choices.findIndex(choice => choice.status === 'ready'), id = winner ? 'b' : 'a';
  assert.equal((await service.writeSave({ token: choices[winner].token, documentId: id, revision: 2, bytes: project(id) })).status, 'saved');
  assert.deepEqual(await fs.readFile(path), project(id)); assert.equal((await service.list()).length, 1);
});
test('atomic save succeeds for a valid long target basename and leaves no staging files', async t => {
  const dir = await folder(t), name = 'x'.repeat(230) + '.pixelwall', path = join(dir, name); await fs.writeFile(path, project('original'));
  const before = await readNativeFile(path); await atomicSaveNative(path, project('edited'), before.fingerprint);
  assert.deepEqual(await fs.readFile(path), project('edited')); assert.deepEqual(await fs.readdir(dir), [name]);
});
test('open grants created during a reload are retained and delivered only after new readiness', async t => {
  const dir = await folder(t), path = join(dir, 'a.pixelwall'); await fs.writeFile(path, project('a'));
  const entered = deferred(), release = deferred();
  const run = ipcHarness(t, service => { const original = service.openPaths; service.openPaths = async paths => { const result = await original.call(service, paths); entered.resolve(); await release.promise; return result; }; return service; });
  await run.ready(); run.ipc.enqueue(run.owner, [path]); await entered.promise; run.navigate(); release.resolve(); await tick();
  assert.equal(run.received.length, 0);
  await run.ready(); assert.equal(run.received.length, 1); assert.equal(run.received[0].uiReady, true); assert.equal(run.received[0].generation, 1);
  const file = run.received[0].payload.files[0]; await run.invoke('bindOpen', { token: file.token, documentId: 'a', revision: 1 });
  assert.equal((await run.attached.verifyClose(ready([{ id: 'a', revision: 1 }]))).status, 'ready');
});
test('unacknowledged open batches replay across navigation; bound and cancelled tokens do not', async t => {
  const dir = await folder(t), a = join(dir, 'a.pixelwall'), b = join(dir, 'b.pixelwall'); await fs.writeFile(a, project('a')); await fs.writeFile(b, project('b'));
  const run = ipcHarness(t); await run.ready(); run.ipc.enqueue(run.owner, [a, b]);
  await run.firstDelivery;
  const first = run.received[0].payload; assert.equal(first.files.length, 2);
  assert.equal((await run.invoke('ackOpen', { deliveryId: first.deliveryId })).status, 'busy');
  await run.invoke('bindOpen', { token: first.files[0].token, documentId: 'a', revision: 1 });
  run.navigate(); await run.ready();
  assert.equal(run.received.length, 2); assert.equal(run.received[1].payload.deliveryId, first.deliveryId); assert.deepEqual(run.received[1].payload.files.map(file => file.token), [first.files[1].token]);
  await run.invoke('cancelOpen', { token: first.files[1].token }); run.navigate(); await run.ready(); assert.equal(run.received.length, 2);
  assert.equal((await run.attached.verifyClose(ready([{ id: 'a', revision: 1 }]))).status, 'ready');
});
test('ready during an in-flight old-generation read delivers once to the current generation', async t => {
  const dir = await folder(t), path = join(dir, 'a.pixelwall'); await fs.writeFile(path, project('a'));
  const entered = deferred(), release = deferred();
  const run = ipcHarness(t, service => { const original = service.openPaths; service.openPaths = async paths => { const result = await original.call(service, paths); entered.resolve(); await release.promise; return result; }; return service; });
  await run.ready(); run.ipc.enqueue(run.owner, [path]); await entered.promise; run.navigate(); await run.ready(); release.resolve(); await tick();
  assert.equal(run.received.length, 1); assert.equal(run.received[0].generation, 1); assert.equal(run.received[0].uiReady, true);
  await run.ready(); assert.equal(run.received.length, 1);
});
test('close IPC rechecks queued/in-flight requests and renderer generation after native verification awaits', async t => {
  for (const action of ['enqueue', 'navigate']) {
    const entered = deferred(), release = deferred(), opening = deferred();
    const run = ipcHarness(t, service => { service.verifyClose = async result => { entered.resolve(); await release.promise; return result; }; service.openPaths = () => opening.promise; return service; });
    await run.ready(); const checking = run.attached.verifyClose(ready([])); await entered.promise;
    if (action === 'enqueue') run.ipc.enqueue(run.owner, ['/a.pixelwall']); else run.navigate();
    release.resolve(); assert.equal((await checking).status, 'blocked');
    opening.resolve({ status: 'opened', files: [], errors: [] }); await tick();
  }
});
test('direct native reopen responses survive navigation until their recovery token is consumed', async t => {
  const dir = await folder(t), path = join(dir, 'a.pixelwall'); await fs.writeFile(path, project('a'));
  const run = ipcHarness(t); await open(run.service, path, 'a'); await run.ready();
  const response = await run.invoke('reopen', { documentId: 'a' }); assert.ok(response.deliveryId); assert.equal(run.received.length, 0);
  run.navigate(); await run.ready(); assert.equal(run.received.length, 1); assert.equal(run.received[0].payload.files[0].token, response.files[0].token);
  await run.invoke('cancelOpen', { token: response.files[0].token }); run.navigate(); await run.ready(); assert.equal(run.received.length, 1);
});
function recoveryHarness() {
  const calls = [], bridge = {
    list: async () => [{ documentId: 'missing', name: 'missing.pixelwall' }, { documentId: 'healthy', name: 'healthy.pixelwall' }],
    reopen: async ({ documentId }) => { calls.push(['reopen', documentId]); return documentId === 'missing' ? { status: 'error', deliveryId: 'missing-delivery', files: [], errors: [{ name: 'missing.pixelwall', reason: 'The file was moved or deleted.' }] } : { status: 'opened', deliveryId: 'healthy-delivery', files: [{ token: 'good', name: 'healthy.pixelwall' }], errors: [] }; },
    bindOpen: async ({ documentId }) => ({ status: 'bound', documentId }), cancelOpen: async value => calls.push(['cancel', value]), ackOpen: async value => calls.push(['ack', value]),
  }, host = { read: async () => null, flushRecovery: async () => {}, decode: async () => ({ document: { id: 'restored' } }), persistImported: async document => ({ document, revision: 1 }), activate: async () => calls.push(['activate']) };
  return { calls, bridge, host, session: createNativeDocumentSession(bridge, host) };
}
test('recovery reports a missing first file and still recovers later projects with actionable errors', async () => {
  const run = recoveryHarness(), report = await run.session.recoverMissing();
  assert.equal(report.status, 'partial'); assert.deepEqual(report.recovered, ['healthy']); assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].documentId, 'missing'); assert.match(report.errors[0].action, /File → Open/);
  assert.deepEqual(run.calls.filter(call => call[0] === 'reopen').map(call => call[1]), ['missing', 'healthy']);
  assert.equal(run.calls.filter(call => call[0] === 'activate').length, 1);
  assert.deepEqual(run.calls.filter(call => call[0] === 'ack').map(call => call[1].deliveryId), ['missing-delivery', 'healthy-delivery']);
  assert.equal(run.session.busy, false);
});
test('a per-document read failure does not abort recovery, and an unavailable registry produces an error report', async () => {
  const run = recoveryHarness(); run.host.read = async id => { if (id === 'missing') throw Error('Broken recovery entry'); return null; };
  const report = await run.session.recoverMissing(); assert.equal(report.status, 'partial'); assert.deepEqual(report.recovered, ['healthy']);
  run.bridge.list = async () => { throw Error('Registry unavailable'); };
  const unavailable = await run.session.recoverMissing(); assert.equal(unavailable.status, 'error'); assert.match(unavailable.errors[0].reason, /Registry/); assert.equal(run.session.busy, false);
});
test('initial recovery-save failure still cancels open tokens and acknowledges the consumed delivery', async () => {
  const run = recoveryHarness(); run.host.flushRecovery = async () => { throw Error('Storage full'); };
  await assert.rejects(run.session.acceptOpen({ deliveryId: 'failed', files: [{ token: 'pending' }] }), /Storage full/);
  assert.deepEqual(run.calls, [['cancel', { token: 'pending' }], ['ack', { deliveryId: 'failed' }]]);
});
test('failed nested recovery acknowledges both the original and nested error deliveries', async () => {
  const run = recoveryHarness();
  await assert.rejects(run.session.acceptOpen({ deliveryId: 'outer', files: [{ existingDocumentId: 'missing', name: 'missing.pixelwall' }] }), /moved or deleted/);
  assert.deepEqual(run.calls.filter(call => call[0] === 'ack').map(call => call[1].deliveryId), ['outer', 'missing-delivery']);
});

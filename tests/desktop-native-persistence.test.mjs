import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNativeBindingStore, createNativeFileService } from '../desktop/native-files.mjs';
const project = name => Buffer.from(JSON.stringify({ format: 'pixelwall-document', version: 4, name }));
const close = (id, revision) => ({ status: 'ready', attemptId: 'close', id, revision, nativeDocuments: [{ id, revision }] });
async function fixture(t) {
  const folder = await fs.mkdtemp(join(tmpdir(), 'pixelwall-native-registry-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const registry = join(folder, 'userData', 'native-documents.json');
  const store = createNativeBindingStore(registry);
  const dialog = { showSaveDialog: () => assert.fail('existing Save must not prompt'), showMessageBox: async () => ({ response: 1 }) };
  const service = createNativeFileService({ store, dialog });
  async function add(name = 'art', revision = 8) {
    const path = join(folder, `${name}.pixelwall`); await fs.writeFile(path, project(name));
    const opened = await service.openPaths([path]);
    await service.bindOpen({ token: opened.files[0].token, documentId: name, revision });
    return path;
  }
  return { folder, registry, store, dialog, service, add };
}
test('native file locations survive relaunch and Save writes the same path after revision reset', async t => {
  const run = await fixture(t), path = await run.add(); run.service.dispose();
  const restored = createNativeFileService({ store: createNativeBindingStore(run.registry), dialog: run.dialog });
  assert.deepEqual(await restored.list(), [{ documentId: 'art', name: 'art.pixelwall', format: 'pixelwall', lastSavedRevision: 8 }]);
  assert.equal((await restored.verifyClose(close('art', 0))).status, 'blocked');
  const save = await restored.chooseSave({ documentId: 'art' });
  assert.equal((await restored.writeSave({ token: save.token, documentId: 'art', revision: 0, bytes: project('after relaunch') })).status, 'saved');
  assert.deepEqual(await fs.readFile(path), project('after relaunch'));
  assert.equal((await restored.verifyClose(close('art', 0))).status, 'ready');
  assert.equal((await createNativeBindingStore(run.registry).load())[0].revision, 0);
  assert.equal((await fs.stat(run.registry)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(await restored.list()).includes(run.folder), false);
});
test('changed native reopen carries current bytes and transfers binding only after a new import succeeds', async t => {
  const run = await fixture(t), path = await run.add(); await fs.writeFile(path, project('external'));
  const result = await run.service.openPaths([path]), file = result.files[0];
  assert.equal(file.changed, true); assert.equal(file.existingDocumentId, 'art'); assert.deepEqual(Buffer.from(file.bytes), project('external'));
  assert.equal((await run.service.list())[0].documentId, 'art');
  await assert.rejects(run.service.bindOpen({ token: file.token, documentId: 'art', revision: 9 }), /new document ID/);
  await run.service.bindOpen({ token: file.token, documentId: 'external-copy', revision: 9 });
  assert.equal((await run.service.list())[0].documentId, 'external-copy');
  assert.equal((await run.store.load())[0].documentId, 'external-copy');
  // The main process never deletes the old document from renderer recovery storage.
});
test('cancelled changed-file import preserves previous binding and registry', async t => {
  const run = await fixture(t), path = await run.add(); await fs.writeFile(path, project('external'));
  const file = (await run.service.openPaths([path])).files[0]; run.service.cancelOpen({ token: file.token });
  assert.equal((await run.service.list())[0].documentId, 'art'); assert.equal((await run.store.load())[0].documentId, 'art');
  assert.equal((await run.service.info({ documentId: 'art' })).status, 'changed');
});
test('bounded reopen recovers only a known native file and can retain its missing IDB document ID', async t => {
  const run = await fixture(t); await run.add();
  const result = await run.service.reopen({ documentId: 'art' }), file = result.files[0];
  assert.equal(file.recovery, true); assert.equal(file.existingDocumentId, 'art');
  await run.service.bindOpen({ token: file.token, documentId: 'art', revision: 0 });
  assert.equal((await run.service.list())[0].lastSavedRevision, 0);
  assert.equal((await run.service.reopen({ documentId: join(run.folder, 'art.pixelwall') })).status, 'error');
});
test('concurrent binding persistence retains both documents without overwriting an older snapshot', async t => {
  const run = await fixture(t);
  await Promise.all([run.add('one', 1), run.add('two', 2)]);
  assert.deepEqual((await run.store.load()).map(value => value.documentId).sort(), ['one', 'two']);
  assert.deepEqual((await run.service.list()).map(value => value.documentId).sort(), ['one', 'two']);
});
test('registry persistence failure never acknowledges close; Save retry repairs registry without conflict', async t => {
  const run = await fixture(t), path = await run.add();
  let failing = true;
  const service = createNativeFileService({ dialog: run.dialog, store: { load: () => run.store.load(), save: records => failing ? Promise.reject(Object.assign(new Error('registry full'), { code: 'ENOSPC' })) : run.store.save(records) } });
  const first = await service.chooseSave({ documentId: 'art' });
  const failed = await service.writeSave({ token: first.token, documentId: 'art', revision: 9, bytes: project('latest') });
  assert.equal(failed.status, 'error'); assert.match(failed.reason, /reached disk/);
  assert.deepEqual(await fs.readFile(path), project('latest'));
  assert.equal((await service.verifyClose(close('art', 8))).status, 'blocked');
  assert.equal((await service.verifyClose(close('art', 9))).status, 'blocked');
  failing = false;
  const retry = await service.chooseSave({ documentId: 'art' }); assert.equal(retry.status, 'ready');
  assert.equal((await service.writeSave({ token: retry.token, documentId: 'art', revision: 9, bytes: project('latest') })).status, 'saved');
  assert.equal((await service.verifyClose(close('art', 9))).status, 'ready');
});
test('failed bind persistence retains its open token and does not claim an unremembered file', async t => {
  const run = await fixture(t); let fails = true;
  const service = createNativeFileService({ store: { load: async () => [], save: async () => { if (fails) throw new Error('registry unavailable'); } }, dialog: run.dialog });
  const path = join(run.folder, 'file.pixelwall'); await fs.writeFile(path, project('file'));
  const file = (await service.openPaths([path])).files[0];
  await assert.rejects(service.bindOpen({ token: file.token, documentId: 'file', revision: 1 }), /unavailable/);
  assert.deepEqual(await service.list(), []);
  assert.equal((await service.verifyClose({ ...close('file', 1), nativeDocuments: [] })).status, 'blocked');
  fails = false; assert.equal((await service.bindOpen({ token: file.token, documentId: 'file', revision: 1 })).status, 'bound');
});
test('invalid registry data does not silently forget file-backed documents', async t => {
  const run = await fixture(t); await fs.mkdir(join(run.folder, 'userData')); await fs.writeFile(run.registry, '{broken');
  const service = createNativeFileService({ store: run.store, dialog: run.dialog });
  await assert.rejects(service.list(), /could not be restored/);
  await assert.rejects(service.verifyClose({ ...close('file', 1), nativeDocuments: [] }), /could not be restored/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicSaveNative, createNativeFileService, nativePathsFromArgv, readNativeFile, sameFingerprint } from '../desktop/native-files.mjs';
import { createCloseController } from '../desktop/editor-controls.mjs';

const project = name => Buffer.from(JSON.stringify({ format: 'pixelwall-document', version: 4, id: 'source', name }));
const aseprite = () => { const bytes = Buffer.alloc(128); bytes.writeUInt32LE(128); bytes.writeUInt16LE(0xa5e0, 4); return bytes; };
const ready = nativeDocuments => ({ status: 'ready', attemptId: 'close', id: 'current', revision: 1, nativeDocuments });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, options = {}) {
  const folder = await fs.mkdtemp(join(tmpdir(), 'pixelwall-native-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const selected = [], answers = [], opened = [], dialogs = [];
  const service = createNativeFileService({ dialog: {
    showSaveDialog: async (_owner, options) => { dialogs.push(options); const filePath = selected.shift(); return { canceled: !filePath, filePath }; },
    showOpenDialog: async () => ({ canceled: !opened.length, filePaths: opened.splice(0) }),
    showMessageBox: async (_owner, options) => { dialogs.push(options); return { response: answers.shift() ?? 1 }; },
  }, ...options });
  async function open(name = 'art.pixelwall', documentId = 'doc', revision = 1) {
    const path = join(folder, name); await fs.writeFile(path, name.endsWith('.aseprite') ? aseprite() : project(name));
    const result = await service.openPaths([path]);
    assert.equal(result.status, 'opened'); assert.equal(result.files.length, 1);
    assert.equal((await service.bindOpen({ token: result.files[0].token, documentId, revision })).status, 'bound');
    return path;
  }
  return { folder, selected, answers, opened, dialogs, service, open };
}

test('open binds only a user-selected token; filenames and lists reveal no filesystem paths', async t => {
  const run = await fixture(t), path = await run.open();
  assert.deepEqual((await run.service.list()), [{ documentId: 'doc', name: 'art.pixelwall', format: 'pixelwall', lastSavedRevision: 1 }]);
  assert.equal((await run.service.info({ documentId: 'doc' })).status, 'current');
  await assert.rejects(run.service.bindOpen({ token: path, documentId: 'other', revision: 0 }), /no longer valid/);
  assert.equal((await run.service.openPaths([path])).files[0].existingDocumentId, 'doc');
  assert.equal(JSON.stringify((await run.service.list())).includes(run.folder), false);
});

test('saving a new document prompts once, writes native bytes, and subsequent Save uses that file', async t => {
  const run = await fixture(t), path = join(run.folder, 'new.pixelwall'); run.selected.push(path);
  const first = await run.service.chooseSave({ documentId: 'new', name: 'new' });
  assert.equal(first.status, 'ready'); assert.equal(first.format, 'pixelwall');
  assert.equal((await run.service.writeSave({ token: first.token, documentId: 'new', revision: 1, bytes: project('first') })).status, 'saved');
  const second = await run.service.chooseSave({ documentId: 'new' });
  assert.equal(run.dialogs.length, 1);
  assert.equal((await run.service.writeSave({ token: second.token, documentId: 'new', revision: 2, bytes: project('second') })).status, 'saved');
  assert.deepEqual(await fs.readFile(path), project('second'));
  assert.equal((await run.service.verifyClose(ready([{ id: 'new', revision: 2 }]))).status, 'ready');
});

test('Save As can choose Aseprite format and only rebinds after successful bytes are written', async t => {
  const run = await fixture(t), original = await run.open(), path = join(run.folder, 'copy.aseprite'); run.selected.push(path);
  const choice = await run.service.chooseSave({ documentId: 'doc', saveAs: true });
  assert.equal(choice.format, 'aseprite');
  assert.equal((await run.service.list())[0].name, 'art.pixelwall');
  assert.equal((await run.service.writeSave({ token: choice.token, documentId: 'doc', revision: 2, bytes: aseprite() })).status, 'saved');
  assert.equal((await run.service.list())[0].name, 'copy.aseprite');
  assert.deepEqual(await fs.readFile(original), project('art.pixelwall'));
  assert.deepEqual(await fs.readFile(path), aseprite());
});

test('cancelled Save As retains binding, and cancelled first Save cannot manufacture an acknowledgement', async t => {
  const run = await fixture(t); await run.open();
  assert.equal((await run.service.chooseSave({ documentId: 'doc', saveAs: true })).status, 'cancelled');
  assert.equal((await run.service.list())[0].name, 'art.pixelwall');
  assert.equal((await run.service.chooseSave({ documentId: 'new' })).status, 'cancelled');
  assert.equal((await run.service.verifyClose(ready([{ id: 'doc', revision: 2 }]))).status, 'blocked');
});

test('failed atomic write preserves original bytes and does not advance the saved revision', async t => {
  const run = await fixture(t, { atomicSave: async () => { throw Object.assign(new Error('ENOSPC private/path'), { code: 'ENOSPC' }); } });
  const path = await run.open(), choice = await run.service.chooseSave({ documentId: 'doc' });
  const result = await run.service.writeSave({ token: choice.token, documentId: 'doc', revision: 2, bytes: project('new') });
  assert.equal(result.status, 'error'); assert.match(result.reason, /disk space/); assert.doesNotMatch(result.reason, /private/);
  assert.deepEqual(await fs.readFile(path), project('art.pixelwall'));
  assert.equal((await run.service.list())[0].lastSavedRevision, 1);
  assert.equal((await run.service.verifyClose(ready([{ id: 'doc', revision: 2 }]))).status, 'blocked');
});

test('external content and metadata changes trigger Save As; same path is refused', async t => {
  const run = await fixture(t), path = await run.open(); await fs.writeFile(path, project('external'));
  assert.equal((await run.service.info({ documentId: 'doc' })).status, 'changed');
  assert.equal((await run.service.verifyClose(ready([{ id: 'doc', revision: 1 }]))).status, 'blocked');
  run.answers.push(0); run.selected.push(path);
  const choice = await run.service.chooseSave({ documentId: 'doc' });
  assert.equal(choice.status, 'error'); assert.match(choice.reason, /different file name/);
  assert.deepEqual(await fs.readFile(path), project('external'));
  run.answers.push(0); run.selected.push(join(run.folder, 'copy.pixelwall'));
  const copy = await run.service.chooseSave({ documentId: 'doc' });
  assert.equal(copy.status, 'ready');
  assert.equal((await run.service.writeSave({ token: copy.token, documentId: 'doc', revision: 2, bytes: project('editor') })).status, 'saved');
  assert.deepEqual(await fs.readFile(path), project('external'));
});

test('fingerprint includes SHA256 even when size and mtime are restored', async t => {
  const run = await fixture(t), path = await run.open(), before = await readNativeFile(path), stat = await fs.stat(path);
  const edited = Buffer.from(before.bytes); edited[edited.length - 3] = 65; await fs.writeFile(path, edited); await fs.utimes(path, stat.atime, stat.mtime);
  const after = await readNativeFile(path);
  assert.notEqual(before.fingerprint.sha256, after.fingerprint.sha256);
  assert.equal(sameFingerprint(before.fingerprint, after.fingerprint), false);
});

test('atomic write rechecks for concurrent external edits before replace and removes temporary file', async t => {
  const run = await fixture(t), path = await run.open(), read = await readNativeFile(path);
  await assert.rejects(atomicSaveNative(path, project('editor'), read.fingerprint, { beforeReplace: () => fs.writeFile(path, project('external')) }), /changed while saving/);
  assert.deepEqual(await fs.readFile(path), project('external'));
  assert.deepEqual(await fs.readdir(run.folder), ['art.pixelwall']);
});

test('new-file save uses a no-clobber install if another program creates the path', async t => {
  const run = await fixture(t), path = join(run.folder, 'new.pixelwall');
  await assert.rejects(atomicSaveNative(path, project('editor'), null, { beforeReplace: () => fs.writeFile(path, project('external')) }), /changed while saving/);
  assert.deepEqual(await fs.readFile(path), project('external'));
});

test('native write refuses invalid payloads, arbitrary path strings, and another document token', async t => {
  const run = await fixture(t); await run.open();
  const choice = await run.service.chooseSave({ documentId: 'doc' });
  assert.equal((await run.service.writeSave({ token: choice.token, documentId: 'other', revision: 2, bytes: project('x') })).status, 'error');
  assert.equal((await run.service.writeSave({ token: choice.token, documentId: 'doc', revision: 2, bytes: Buffer.from('<html>no</html>') })).status, 'error');
  assert.equal((await run.service.writeSave({ token: '/tmp/anything', documentId: 'doc', revision: 2, bytes: project('x') })).status, 'error');
  assert.equal((await run.service.list())[0].lastSavedRevision, 1);
});

test('Save As refuses files owned by another document, including a pending new save', async t => {
  const run = await fixture(t), path = await run.open(); run.selected.push(path);
  assert.equal((await run.service.chooseSave({ documentId: 'other' })).status, 'error');
  const newPath = join(run.folder, 'pending.pixelwall'); run.selected.push(newPath, newPath);
  assert.equal((await run.service.chooseSave({ documentId: 'new' })).status, 'ready');
  assert.equal((await run.service.chooseSave({ documentId: 'other' })).status, 'error');
});

test('close requires each native document exactly once, matching saved revisions', async t => {
  const run = await fixture(t); await run.open('one.pixelwall', 'one', 3); await run.open('two.pixelwall', 'two', 7);
  for (const entries of [undefined, [], [{ id: 'one', revision: 3 }], [{ id: 'one', revision: 3 }, { id: 'one', revision: 3 }], [{ id: 'one', revision: 3 }, { id: 'two', revision: 8 }]]) {
    assert.equal((await run.service.verifyClose(ready(entries))).status, 'blocked');
  }
  assert.equal((await run.service.verifyClose(ready([{ id: 'one', revision: 3 }, { id: 'two', revision: 7 }]))).status, 'ready');
});

test('unbound open tokens and unfinished saves block close until explicitly cancelled', async t => {
  const run = await fixture(t), path = join(run.folder, 'open.pixelwall'); await fs.writeFile(path, project('open'));
  const opening = await run.service.openPaths([path]);
  assert.equal((await run.service.verifyClose(ready([]))).status, 'blocked');
  run.service.cancelOpen({ token: opening.files[0].token });
  assert.equal((await run.service.verifyClose(ready([]))).status, 'ready');
  run.selected.push(join(run.folder, 'new.pixelwall'));
  const save = await run.service.chooseSave({ documentId: 'new' });
  assert.equal((await run.service.verifyClose(ready([]))).status, 'blocked');
  run.service.cancelSave({ token: save.token });
  assert.equal((await run.service.verifyClose(ready([]))).status, 'ready');
});

test('one save selection per document, single-use and expired save tokens', async t => {
  let now = 0; const run = await fixture(t, { now: () => now }); await run.open();
  const first = await run.service.chooseSave({ documentId: 'doc' });
  assert.equal((await run.service.chooseSave({ documentId: 'doc' })).status, 'busy');
  now = 300001;
  assert.equal((await run.service.writeSave({ token: first.token, documentId: 'doc', revision: 2, bytes: project('new') })).status, 'error');
  const next = await run.service.chooseSave({ documentId: 'doc' });
  assert.equal((await run.service.writeSave({ token: next.token, documentId: 'doc', revision: 2, bytes: project('new') })).status, 'saved');
  assert.equal((await run.service.writeSave({ token: next.token, documentId: 'doc', revision: 3, bytes: project('new') })).status, 'error');
});

test('open accepts legacy projects and Aseprite; malformed/unsupported files remain unbound', async t => {
  const run = await fixture(t), legacy = join(run.folder, 'legacy.pixelwall'), bad = join(run.folder, 'bad.pixelwall');
  await fs.writeFile(legacy, JSON.stringify({ format: 'pixelwall-project', version: 3 })); await fs.writeFile(bad, 'not JSON');
  const result = await run.service.openPaths([legacy, bad, join(run.folder, 'script.js')]);
  assert.equal(result.files.length, 1); assert.equal(result.errors.length, 2);
  assert.equal(JSON.stringify(result.errors).includes(run.folder), false);
  await run.open('native.aseprite', 'aseprite');
});

test('opened symlinks resolve user-chosen targets but later symlink substitution blocks saving', async t => {
  const run = await fixture(t), target = join(run.folder, 'target.pixelwall'), link = join(run.folder, 'link.pixelwall');
  await fs.writeFile(target, project('target')); await fs.symlink(target, link);
  const opened = await run.service.openPaths([link]); await run.service.bindOpen({ token: opened.files[0].token, documentId: 'doc', revision: 1 });
  await fs.unlink(target); await fs.symlink(join(run.folder, 'other.pixelwall'), target);
  assert.equal((await run.service.info({ documentId: 'doc' })).status, 'unavailable');
  assert.equal((await run.service.chooseSave({ documentId: 'doc' })).status, 'cancelled');
});

test('OS argv accepts only native local paths and ignores options, URLs and other files', () => {
  assert.deepEqual(nativePathsFromArgv(['--flag', 'one.pixelwall', 'two.aseprite', 'https://host/a.pixelwall', '--bad.pixelwall', 'other.png'], '/tmp'), ['/tmp/one.pixelwall', '/tmp/two.aseprite']);
});

test('close deadline pauses while a native picker waits for the user, then finishes normally', async () => {
  let waiting = true, finish, closed = false, confirmed = false;
  const controller = createCloseController({ prepare: attemptId => new Promise(resolve => { finish = () => resolve({ status: 'ready', attemptId, id: 'doc', revision: 1 }); }), cancel: async () => {}, close: () => { closed = true; }, confirmDiscard: () => { confirmed = true; return false; }, timeoutMs: 10, isWaitingForUser: () => waiting });
  const pending = controller.request(); await delay(35); assert.equal(confirmed, false); waiting = false; finish(); await pending;
  assert.equal(closed, true); assert.equal(confirmed, false);
});

test('metadata-only changes preserve save and close while byte or identity changes still conflict', async t => {
  const run = await fixture(t), path = await run.open();
  const before = (await readNativeFile(path)).fingerprint;
  assert.equal(sameFingerprint(before, {...before, ctimeNs: String(BigInt(before.ctimeNs) + 1n)}), true);
  for (const key of ['size','mtimeNs','dev','ino','sha256']) assert.equal(sameFingerprint(before, {...before,[key]:before[key]+'1'}),false);
  await fs.chmod(path, 0o600);
  assert.equal((await run.service.info({documentId:'doc'})).status,'current');
  const chosen = await run.service.chooseSave({documentId:'doc'});
  assert.equal(chosen.status,'ready');
  const saved = await run.service.writeSave({token:chosen.token,documentId:'doc',revision:2,bytes:project('updated')});
  assert.equal(saved.status,'saved');
  await fs.chmod(path,0o640);
  assert.equal((await run.service.verifyClose(ready([{id:'doc',revision:2}]))).status,'ready');
  assert.equal(run.dialogs.length,0);
});

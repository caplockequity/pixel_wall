/** Native editable files. Paths never cross the renderer boundary. */
import * as nodeFs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

export const MAX_NATIVE_BYTES = 64 * 1024 * 1024;
const extensions = { pixelwall: '.pixelwall', aseprite: '.aseprite' };
const filters = [{ name: 'PixelWall project', extensions: ['pixelwall'] }, { name: 'Editable sprite', extensions: ['aseprite'] }];
const fail = message => { throw new Error(message); };
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && [...value].every(char => char.charCodeAt(0) >= 32);
const validRevision = value => Number.isSafeInteger(value) && value >= 0;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const errorReason = error => error?.code ? ({ ENOENT: 'The selected file or folder no longer exists.', EACCES: 'PixelWall does not have permission to access that file.', EPERM: 'The selected file could not be accessed. Check its permissions and try Save As.', ENOSPC: 'There is not enough disk space to save this file.', EEXIST: 'A file appeared at the destination while saving. Use Save As to preserve it.', EBUSY: 'The file is in use by another program. Try Save As.', EIO: 'The disk reported an error. Keep the editor open and save to another location.' }[error.code] || 'The file could not be read or saved. Keep the editor open and try another location.') : error.message;
const stats = value => ({ size: String(value.size), mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs), dev: String(value.dev), ino: String(value.ino) });
const sameStats = (a, b) => a && b && ['size', 'mtimeNs', 'ctimeNs', 'dev', 'ino'].every(key => a[key] === b[key]);
// Finder may update tags/metadata after Save As. ctime alone is not an artwork
// conflict; retain inode/device identity, modification time, size and byte hash.
export const sameFingerprint = (a, b) => a === null && b === null || !!(a && b && ['size', 'mtimeNs', 'dev', 'ino', 'sha256'].every(key => a[key] === b[key]));
export function nativeFormat(path) { return Object.keys(extensions).find(format => extname(path).toLowerCase() === extensions[format]) || null; }

export function nativePathsFromArgv(argv, cwd = process.cwd()) {
  // Only filesystem paths supplied by the OS/launch command are authority here.
  return [...new Set(argv.filter(value => typeof value === 'string' && !value.startsWith('-') && !/^[a-z]+:\/\//i.test(value) && nativeFormat(value)).map(value => resolve(cwd, value)))].slice(0, 32);
}

export async function readNativeFile(path, { fs = nodeFs, maxBytes = MAX_NATIVE_BYTES, allowMissing = false } = {}) {
  let handle;
  try {
    const link = await fs.lstat(path);
    if (link.isSymbolicLink()) fail('The file path changed into a link. Open the file again before saving.');
    handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maxBytes)) fail('Choose a regular editable file smaller than 64 MB.');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await handle.read(buffer, length, buffer.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const bytes = buffer.subarray(0, length);
    const after = await handle.stat({ bigint: true });
    if (bytes.byteLength > maxBytes || !sameStats(stats(before), stats(after))) fail('The file changed while it was being read. Try again.');
    return { bytes, fingerprint: { ...stats(after), sha256: hash(bytes) }, mode: Number(after.mode & 0o777n) };
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') return { bytes: null, fingerprint: null, mode: 0o600 };
    throw error;
  } finally { await handle?.close(); }
}

function validateBytes(value, format) {
  if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) fail('Save requires editable file bytes.');
  const bytes = value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(value.slice(0));
  if (!bytes.length || bytes.length > MAX_NATIVE_BYTES) fail('The editable file must be between 1 byte and 64 MB.');
  if (format === 'pixelwall') {
    let doc; try { doc = JSON.parse(bytes.toString('utf8')); } catch { fail('The PixelWall project is not valid JSON.'); }
    if (!doc || !['pixelwall-document', 'pixelwall-project'].includes(doc.format)) fail('Save accepts only editable PixelWall projects.');
  } else if (format === 'aseprite') {
    if (bytes.length < 128 || bytes.readUInt32LE(0) !== bytes.length || bytes.readUInt16LE(4) !== 0xa5e0) fail('Save accepts only editable sprite files.');
  } else fail('Choose PixelWall or editable sprite format.');
  return bytes;
}

export async function atomicSaveNative(path, bytes, expected, { fs = nodeFs, beforeReplace = async () => {} } = {}) {
  const current = await readNativeFile(path, { fs, allowMissing: true });
  if (!sameFingerprint(current.fingerprint, expected)) fail('The file changed outside PixelWall. Save As a different file to keep both versions.');
  const temporary = join(dirname(path), `.pixelwall-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', current.mode || 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = null;
    await beforeReplace();
    const latest = await readNativeFile(path, { fs, allowMissing: true });
    if (!sameFingerprint(latest.fingerprint, expected)) fail('The file changed while saving. Save As a different file to keep both versions.');
    if (expected === null) {
      // link is an atomic no-clobber install: a newly created external file wins.
      await fs.link(temporary, path);
      await fs.unlink(temporary);
    } else await fs.rename(temporary, path);
    // Flush the directory entry on platforms supporting it. Windows does not.
    let directory;
    try { directory = await fs.open(dirname(path), 'r'); await directory.sync(); }
    catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF', 'EPERM', 'EACCES'].includes(error.code)) throw error; }
    finally { await directory?.close(); }
    const saved = await readNativeFile(path, { fs });
    if (saved.fingerprint.sha256 !== hash(bytes)) fail('Another program changed the file immediately after saving. Keep PixelWall open and use Save As.');
    return saved.fingerprint;
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** One service per BrowserWindow, therefore grants cannot be used across windows. */
export function createNativeFileService({ dialog, owner, fs = nodeFs, now = Date.now, token = randomUUID, atomicSave = atomicSaveNative, store } = {}) {
  const bindings = new Map(), opens = new Map(), saves = new Map(), selecting = new Set();
  let dialogCount = 0, disposed = false;
  let startupError, persistence = Promise.resolve();
  const loaded = store ? Promise.resolve().then(() => store.load()).then(records => { for (const record of records) bindings.set(record.documentId, record); }).catch(error => { startupError = error; }) : Promise.resolve();
  const assertAlive = () => { if (disposed) fail('This window has closed.'); };
  const assertReady = async () => { await loaded; assertAlive(); if (startupError) fail(`Saved file locations could not be restored. ${errorReason(startupError)}`); };
  function persistBinding(record, replacesDocumentId, opening = false, recovery = false) {
    const writing = persistence.catch(() => {}).then(async () => {
      if (opening && bindings.has(record.documentId) && !(recovery && replacesDocumentId === record.documentId)) fail('This project ID already belongs to an open file. Import with a new document ID.');
      if ([...bindings.values()].some(value => value.path === record.path && value.documentId !== record.documentId && value.documentId !== replacesDocumentId)) fail('Another open document owns that file.');
      const updated = new Map(bindings);
      if (replacesDocumentId) updated.delete(replacesDocumentId);
      updated.set(record.documentId, record);
      await store?.save([...updated.values()].filter(value => validRevision(value.revision)));
      if (replacesDocumentId) bindings.delete(replacesDocumentId);
      bindings.set(record.documentId, record);
    });
    persistence = writing; return writing;
  }
  const info = binding => binding ? { documentId: binding.documentId, name: basename(binding.path), format: binding.format, lastSavedRevision: binding.revision } : null;
  const publicError = error => ({ status: 'error', reason: errorReason(error) });
  async function show(method, options) { dialogCount++; try { return await dialog[method](owner, options); } finally { dialogCount--; } }
  async function canonical(path) {
    if (typeof path !== 'string' || !isAbsolute(path) || !nativeFormat(path)) fail('Choose a supported editable project or sprite file.');
    try { return await fs.realpath(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return join(await fs.realpath(dirname(path)), basename(path)); }
  }
  function purgeExpired() {
    for (const [key, value] of saves) if (!value.writing && now() - value.created > 5 * 60_000) saves.delete(key);
  }
  function targetOwned(path, documentId) { return [...bindings.values(), ...saves.values()].some(value => value.path === path && value.documentId !== documentId); }
  function hasSave(documentId) { purgeExpired(); return selecting.has(documentId) || [...saves.values()].some(value => value.documentId === documentId); }
  return {
    isWaitingForUser: () => dialogCount > 0,
    async openPaths(paths) {
      await assertReady();
      if (!Array.isArray(paths) || paths.length > 32) fail('Open at most 32 files at once.');
      const files = [], errors = [];
      for (const selected of paths) {
        try {
          if (opens.size >= 32) fail('Finish opening the current files before opening more.');
          const path = await canonical(selected), format = nativeFormat(selected);
          const existing = [...bindings.values()].find(value => value.path === path);
          if ([...opens.values()].some(value => value.path === path)) continue;
          const read = await readNativeFile(path, { fs });
          if (existing && sameFingerprint(existing.fingerprint, read.fingerprint)) { files.push({ existingDocumentId: existing.documentId, name: basename(path), format: existing.format }); continue; }
          validateBytes(read.bytes, format);
          assertAlive();
          const key = token(); opens.set(key, { path, format, fingerprint: read.fingerprint, ...(existing ? { replacesDocumentId: existing.documentId } : {}) });
          files.push({ token: key, name: basename(selected), format, bytes: new Uint8Array(read.bytes), ...(existing ? { existingDocumentId: existing.documentId, changed: true } : {}) });
        } catch (error) { errors.push({ name: basename(String(selected)), reason: errorReason(error) }); }
      }
      return { status: errors.length && !files.length ? 'error' : 'opened', files, errors };
    },
    async open() {
      await assertReady();
      const choice = await show('showOpenDialog', { title: 'Open editable artwork', properties: ['openFile', 'multiSelections'], filters });
      if (choice.canceled || !choice.filePaths?.length) return { status: 'cancelled', files: [], errors: [] };
      return this.openPaths(choice.filePaths);
    },
    async reopen({ documentId } = {}) {
      await assertReady();
      const binding = bindings.get(documentId);
      if (!binding) return { status: 'error', files: [], errors: [{ name: 'Project', reason: 'This project has no saved native file location.' }] };
      try {
        if (opens.size >= 32) fail('Finish opening the current files before recovering more.');
        const read = await readNativeFile(binding.path, { fs }); validateBytes(read.bytes, binding.format);
        const key = token();
        opens.set(key, { path: binding.path, format: binding.format, fingerprint: read.fingerprint, replacesDocumentId: documentId, recovery: true });
        return { status: 'opened', files: [{ token: key, existingDocumentId: documentId, recovery: true, changed: !sameFingerprint(binding.fingerprint, read.fingerprint), name: basename(binding.path), format: binding.format, bytes: new Uint8Array(read.bytes) }], errors: [] };
      } catch (error) { return { status: 'error', files: [], errors: [{ name: basename(binding.path), reason: errorReason(error) }] }; }
    },
    async bindOpen({ token: key, documentId, revision } = {}) {
      await assertReady();
      const grant = opens.get(key);
      if (!grant || !validId(documentId) || !validRevision(revision)) fail('This open request is no longer valid.');
      if (bindings.has(documentId) && !(grant.recovery && grant.replacesDocumentId === documentId)) fail('This project ID already belongs to an open file. Import the file with a new document ID.');
      if (targetOwned(grant.path, documentId) && !grant.replacesDocumentId) fail('This file is already open.');
      try { await persistBinding({ path: grant.path, format: grant.format, fingerprint: grant.fingerprint, documentId, revision }, grant.replacesDocumentId, true, grant.recovery); }
      catch (error) { fail(errorReason(error)); }
      opens.delete(key);
      return { status: 'bound', ...info(bindings.get(documentId)) };
    },
    cancelOpen({ token: key } = {}) { return { status: opens.delete(key) ? 'cancelled' : 'missing' }; },
    async list() { await assertReady(); return [...bindings.values()].map(info); },
    async info({ documentId } = {}) {
      await assertReady();
      if (!validId(documentId)) fail('Choose a document.');
      const binding = bindings.get(documentId);
      if (!binding) return null;
      try {
        const current = await readNativeFile(binding.path, { fs, allowMissing: true });
        return { ...info(binding), status: sameFingerprint(binding.fingerprint, current.fingerprint) ? 'current' : 'changed', pending: hasSave(documentId) };
      } catch (error) { return { ...info(binding), status: 'unavailable', pending: hasSave(documentId), reason: errorReason(error) }; }
    },
    async chooseSave({ documentId, name = 'Untitled', format = 'pixelwall', saveAs = false } = {}) {
      await assertReady();
      if (!validId(documentId) || !extensions[format] || typeof saveAs !== 'boolean') fail('Invalid editable save request.');
      if (hasSave(documentId)) return { status: 'busy', reason: 'This document already has a save in progress.' };
      selecting.add(documentId);
      try {
        const binding = bindings.get(documentId);
        let path = binding?.path, expected = binding?.fingerprint, conflict = false;
        if (binding) {
          try { conflict = !sameFingerprint(binding.fingerprint, (await readNativeFile(path, { fs, allowMissing: true })).fingerprint); }
          catch { conflict = true; }
        }
        if (conflict) {
          const answer = await show('showMessageBox', { type: 'warning', title: 'The file changed outside PixelWall', message: 'Save a separate copy to keep both versions.', detail: `${basename(path)} was changed, moved, or deleted by another program.`, buttons: ['Save As…', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true });
          if (answer.response !== 0) return { status: 'cancelled' };
        }
        if (!binding || saveAs || conflict) {
          const safeName = basename(String(name)).replace(/[<>:"/\\|?*]/g, '-').split('').map(char => char.charCodeAt(0) < 32 ? '-' : char).join('').slice(0, 160) || 'Untitled';
          const stem = safeName.replace(/\.(pixelwall|aseprite)$/i, '');
          const defaultPath = binding ? join(dirname(binding.path), `${conflict ? stem + ' copy' : stem}${extensions[format]}`) : stem + extensions[format];
          const choice = await show('showSaveDialog', { title: 'Save editable artwork', defaultPath, filters: [...filters].sort((a, b) => Number(b.extensions[0] === format) - Number(a.extensions[0] === format)), properties: ['createDirectory', 'showOverwriteConfirmation'] });
          if (choice.canceled || !choice.filePath) return { status: 'cancelled' };
          // A missing extension uses the selected/default format. Other extensions are refused.
          const selected = extname(choice.filePath) ? choice.filePath : choice.filePath + extensions[format];
          format = nativeFormat(selected) || fail('Use a supported editable project or sprite extension.');
          path = await canonical(selected);
          if (conflict && path === binding.path) fail('Choose a different file name to preserve the externally changed version.');
          if (targetOwned(path, documentId)) fail('Another open document owns that file. Choose a different file name.');
          expected = (await readNativeFile(path, { fs, allowMissing: true })).fingerprint;
        } else format = binding.format;
        assertAlive();
        // The fingerprint read above yields. Reserve ownership only after a final
        // synchronous check so concurrent pickers cannot grant the same target.
        if (targetOwned(path, documentId)) fail('Another open document owns that file. Choose a different file name.');
        const key = token(); saves.set(key, { documentId, path, format, expected, created: now(), writing: false });
        return { status: 'ready', token: key, format, name: basename(path) };
      } catch (error) { return publicError(error); }
      finally { selecting.delete(documentId); }
    },
    async writeSave({ token: key, documentId, revision, bytes } = {}) {
      await assertReady(); purgeExpired();
      const grant = saves.get(key);
      if (!grant || grant.documentId !== documentId || !validRevision(revision) || grant.writing) return { status: 'error', reason: 'This save request is no longer valid. Choose Save again.' };
      grant.writing = true;
      try {
        const data = validateBytes(bytes, grant.format);
        const fingerprint = await atomicSave(grant.path, data, grant.expected, { fs });
        assertAlive();
        const record = { documentId, path: grant.path, format: grant.format, fingerprint, revision };
        try { await persistBinding(record); }
        catch (error) {
          // Bytes did reach disk, but the location must also persist before close.
          bindings.set(documentId, { ...record, revision: bindings.get(documentId)?.revision ?? null, persistencePending: true });
          return { status: 'error', reason: `The artwork reached disk, but its file location could not be remembered. Keep the editor open and choose Save again. ${errorReason(error)}` };
        }
        return { status: 'saved', ...info(bindings.get(documentId)) };
      } catch (error) { return publicError(error); }
      finally { saves.delete(key); }
    },
    cancelSave({ token: key } = {}) {
      const grant = saves.get(key);
      if (grant?.writing) return { status: 'busy', reason: 'The disk write is already in progress.' };
      return { status: saves.delete(key) ? 'cancelled' : 'missing' };
    },
    async verifyClose(result) {
      await assertReady(); purgeExpired();
      if (result?.status !== 'ready') return result;
      const block = reason => ({ status: 'blocked', attemptId: result.attemptId, reason });
      if (opens.size || saves.size || selecting.size || dialogCount) return block('Finish opening or saving all native files before closing.');
      if (!Array.isArray(result.nativeDocuments) || result.nativeDocuments.length !== bindings.size) return block('The editor has not confirmed the saved state of every native file.');
      const seen = new Set(), checkedBindings = new Map();
      for (const entry of result.nativeDocuments) {
        const binding = bindings.get(entry?.id);
        if (!binding || binding.persistencePending || seen.has(entry.id) || !validRevision(entry.revision) || binding.revision !== entry.revision) return block('An editable file has unsaved changes. Keep this window open and save it.');
        seen.add(entry.id);
        checkedBindings.set(entry.id, binding);
        try {
          const current = await readNativeFile(binding.path, { fs, allowMissing: true });
          if (!sameFingerprint(binding.fingerprint, current.fingerprint)) return block(`${basename(binding.path)} changed outside PixelWall. Keep this window open and use Save As.`);
        } catch (error) { return block(errorReason(error)); }
      }
      if (opens.size || saves.size || selecting.size || dialogCount) return block('A native file operation began while checking the saved documents.');
      if (bindings.size !== seen.size || [...bindings.keys()].some(id => !seen.has(id)) || result.nativeDocuments.some(entry => bindings.get(entry.id) !== checkedBindings.get(entry.id) || bindings.get(entry.id)?.revision !== entry.revision || bindings.get(entry.id)?.persistencePending)) return block('A native file changed while checking the saved documents.');
      return result;
    },
    dispose() { disposed = true; opens.clear(); saves.clear(); bindings.clear(); },
  };
}

/** Main-owned grant registry. It contains paths and is never exposed to preload. */
export function createNativeBindingStore(path, { fs = nodeFs } = {}) {
  let pending = Promise.resolve();
  function normalize(records) {
    if (!Array.isArray(records) || records.length > 512) fail('Saved file locations are invalid.');
    const seen = new Set(), targets = new Set();
    return records.map(record => {
      const f = record?.fingerprint;
      if (!record || !validId(record.documentId) || seen.has(record.documentId) || typeof record.path !== 'string' || record.path.length > 4096 || record.path.includes('\0') || !isAbsolute(record.path) || targets.has(record.path) || !extensions[record.format] || !validRevision(record.revision) || !f || !/^[a-f0-9]{64}$/.test(f.sha256) || !['size', 'mtimeNs', 'ctimeNs', 'dev', 'ino'].every(key => typeof f[key] === 'string' && /^-?\d+$/.test(f[key]))) fail('Saved file locations are invalid.');
      seen.add(record.documentId); targets.add(record.path);
      return { documentId: record.documentId, path: record.path, format: record.format, revision: record.revision, fingerprint: { ...stats({ ...f, size: f.size, mtimeNs: f.mtimeNs, ctimeNs: f.ctimeNs, dev: f.dev, ino: f.ino }), sha256: f.sha256 } };
    });
  }
  return {
    async load() {
      try {
        const { bytes } = await readNativeFile(path, { fs, maxBytes: 1024 * 1024 });
        let content; try { content = JSON.parse(bytes.toString('utf8')); } catch { fail('Saved file locations are not valid JSON.'); }
        if (content?.format !== 'pixelwall-native-files' || content.version !== 1) fail('Saved file locations have an unsupported format.');
        return normalize(content.documents);
      } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    },
    save(records) {
      const documents = normalize(records);
      const bytes = Buffer.from(JSON.stringify({ format: 'pixelwall-native-files', version: 1, documents }));
      const save = pending.catch(() => {}).then(async () => {
        await fs.mkdir(dirname(path), { recursive: true });
        const previous = await readNativeFile(path, { fs, maxBytes: 1024 * 1024, allowMissing: true });
        await atomicSaveNative(path, bytes, previous.fingerprint, { fs });
      });
      pending = save; return save;
    },
  };
}

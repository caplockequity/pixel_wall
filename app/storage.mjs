/** Durable local document library. Browser IndexedDB; no server or artwork upload.
 * Image entries MUST be immutable: replace the changed image value after editing.
 * changedImageIds can invalidate fingerprints when integrating mutable buffers.
 * Every successful save is atomic (head + recovery revision + image records).
 */
export const STORAGE_VERSION = 1;
export const DEFAULT_STORAGE_BUDGET = 96 * 1024 * 1024;
export const DEFAULT_REVISION_LIMIT = 40;
export const LEGACY_DOCUMENT_KEYS = ['pixelwall-project-v3', 'pixelwall-project-v2', 'pixelwall-project-v1'];
const STORES = ['documents', 'revisions', 'images', 'imageInfo', 'settings'];
const encoder = new TextEncoder();
export class DocumentStorageError extends Error {
  constructor(message, code = 'STORAGE_FAILED', cause) { super(message, { cause }); this.name = 'DocumentStorageError'; this.code = code; }
}
const request = (operation) => new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });
const complete = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new DocumentStorageError('The save was interrupted. Your previous saved version is intact.', 'ABORTED')); tx.onerror = () => {}; });
function storageError(error) {
  if (error instanceof DocumentStorageError) return error;
  if (error?.name === 'QuotaExceededError') return new DocumentStorageError('This browser is out of storage. Download your project before closing; your previous saved version is intact.', 'QUOTA_EXCEEDED', error);
  return new DocumentStorageError('The browser could not save this change. Download your project before closing; your previous saved version is intact.', 'STORAGE_FAILED', error);
}
function canonical(value, seen = new Set()) {
  if (value === undefined) return '["undefined"]';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) throw new DocumentStorageError('Circular data cannot be saved.', 'INVALID_DOCUMENT');
  seen.add(value);
  let result;
  if (ArrayBuffer.isView(value)) result = `{"$type":${JSON.stringify(value.constructor.name)},"bytes":[${new Uint8Array(value.buffer, value.byteOffset, value.byteLength).join(',')}]}`;
  else if (value instanceof ArrayBuffer) result = `{"$type":"ArrayBuffer","bytes":[${new Uint8Array(value).join(',')}]}`;
  else if (Array.isArray(value)) result = `[${value.map((entry) => canonical(entry, seen)).join(',')}]`;
  else result = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return result;
}
function summary(record) { return { id: record.id, name: record.metadata.name, width: record.metadata.width, height: record.metadata.height, frameCount: record.metadata.frames.length, layerCount: record.metadata.layers.length, colorMode: record.metadata.colorMode, savedAt: record.updatedAt, revision: record.revision, metadataBytes: record.bytes }; }
function revisionSummary(record) { return { id: record.id, documentId: record.documentId, revision: record.revision, savedAt: record.updatedAt, label: record.label, pinned: record.pinned, name: record.metadata.name }; }
function keysIn(records) { const keys = new Set(); for (const record of records) for (const key of Object.values(record.imageRefs)) keys.add(key); return keys; }
function validate(doc) {
  if (!doc || doc.format !== 'pixelwall-document' || doc.version !== 4 || typeof doc.id !== 'string' || !doc.id || doc.id.length > 200 || !Array.isArray(doc.frames) || !Array.isArray(doc.layers) || !doc.images || typeof doc.images !== 'object') throw new DocumentStorageError('Expected a PixelWall v4 document with an ID and image records.', 'INVALID_DOCUMENT');
  if (!Number.isSafeInteger(doc.width) || doc.width < 1 || !Number.isSafeInteger(doc.height) || doc.height < 1) throw new DocumentStorageError('Document dimensions are invalid.', 'INVALID_DOCUMENT');
  for (const frame of doc.frames) for (const cel of Object.values(frame.cels ?? {})) if (cel && !Object.hasOwn(doc.images, cel.imageId)) throw new DocumentStorageError(`Missing image ${cel.imageId}. The document was not saved.`, 'MISSING_IMAGE');
}
/** openStore({name,indexedDB,crypto,budgetBytes,maxRevisions,navigator,now}). */
export async function openStore(options = {}) {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const crypto = options.crypto ?? globalThis.crypto;
  if (!factory || !crypto?.subtle) throw new DocumentStorageError('This browser cannot provide durable local storage. Use Save Project to keep a copy.', 'UNAVAILABLE');
  const opening = factory.open(options.name ?? 'pixelwall-library-v4', STORAGE_VERSION);
  opening.onupgradeneeded = () => { const db = opening.result; for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : name === 'images' || name === 'imageInfo' ? 'key' : 'id' }); };
  opening.onblocked = () => options.onBlocked?.();
  const db = await request(opening).catch((error) => { throw storageError(error); });
  db.onversionchange = () => { db.close(); options.onVersionChange?.(); };
  const now = options.now ?? Date.now;
  const budgetBytes = Math.max(1024, options.budgetBytes ?? DEFAULT_STORAGE_BUDGET);
  const maxRevisions = Math.max(2, options.maxRevisions ?? DEFAULT_REVISION_LIMIT);
  const fingerprints = new WeakMap();
  let sequence = Promise.resolve();
  const serialize = (fn) => { const next = sequence.then(fn); sequence = next.catch(() => {}); return next; };
  async function read(names, fn) {
    const tx = db.transaction(names, 'readonly'); const finished = complete(tx);
    try { const result = await fn(tx); await finished; return result; } catch (error) { await finished.catch(() => {}); throw storageError(error); }
  }
  async function write(fn) {
    const tx = db.transaction(STORES, 'readwrite'); const finished = complete(tx);
    try { const result = await fn(tx); await finished; return result; } catch (error) { try { tx.abort(); } catch { /* A completed transaction cannot be aborted again. */ } await finished.catch(() => {}); throw storageError(error); }
  }
  async function fingerprint(value, force) {
    if (!force && value && typeof value === 'object' && fingerprints.has(value)) return fingerprints.get(value);
    const text = canonical(value); const bytes = encoder.encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const result = { key: Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join(''), bytes: bytes.byteLength };
    if (value && typeof value === 'object') fingerprints.set(value, result);
    return result;
  }
  async function prepare(document, settings) {
    validate(document);
    const { images, ...metadata } = document;
    const imageRefs = {}; const records = new Map(); const changed = new Set(settings.changedImageIds ?? []);
    await Promise.all(Object.entries(images).map(async ([id, value]) => { const info = await fingerprint(value, changed.has(id)); imageRefs[id] = info.key; records.set(info.key, { ...info, value }); }));
    return { metadata: structuredClone(metadata), imageRefs, records, bytes: encoder.encode(canonical({ metadata, imageRefs })).byteLength };
  }
  function prune(heads, snapshots, imageInfo) {
    const pruned = [];
    const perDocument = new Map();
    for (const snapshot of snapshots) { const values = perDocument.get(snapshot.documentId) ?? []; values.push(snapshot); perDocument.set(snapshot.documentId, values); }
    for (const values of perDocument.values()) values.sort((a, b) => a.updatedAt - b.updatedAt || a.revision - b.revision);
    function removable(item) { const values = perDocument.get(item.documentId); return !item.pinned && values.length > 2 && values[values.length - 1] !== item && values[values.length - 2] !== item; }
    function remove(item) { const values = perDocument.get(item.documentId); values.splice(values.indexOf(item), 1); snapshots.splice(snapshots.indexOf(item), 1); pruned.push(revisionSummary(item)); }
    for (const values of perDocument.values()) { for (const item of [...values]) if (values.length > maxRevisions && removable(item)) remove(item); }
    function usage() { const referenced = keysIn([...heads, ...snapshots]); return [...heads, ...snapshots].reduce((sum, r) => sum + r.bytes, 0) + [...referenced].reduce((sum, key) => sum + (imageInfo.get(key)?.bytes ?? 0), 0); }
    let bytes = usage();
    for (const item of [...snapshots].sort((a, b) => a.updatedAt - b.updatedAt || a.revision - b.revision)) { if (bytes <= budgetBytes) break; if (removable(item)) { remove(item); bytes = usage(); } }
    if (bytes > budgetBytes) throw new DocumentStorageError('The local library has reached its storage budget. Download a backup and remove an unneeded document before saving again. Your previous saved version is intact.', 'BUDGET_EXCEEDED');
    return { snapshots, pruned, bytes, referenced: keysIn([...heads, ...snapshots]) };
  }
  async function persistMany(entries, {settings: settingChanges = []} = {}) {
    if (!Array.isArray(entries) || !entries.length || entries.length > 8 || new Set(entries.map(entry => entry.document?.id)).size !== entries.length)
      throw new DocumentStorageError('Save between one and eight distinct documents.', 'INVALID_DOCUMENT');
    if (!Array.isArray(settingChanges) || settingChanges.length > 8 || new Set(settingChanges.map(change => change?.key)).size !== settingChanges.length || settingChanges.some(change => typeof change?.key !== 'string' || !change.key || change.key.length > 240 || !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0))
      throw new DocumentStorageError('Settings save guards are invalid.', 'INVALID_SETTINGS');
    const changes = structuredClone(settingChanges);
    const prepared = await Promise.all(entries.map(async ({document, settings = {}}) => ({document, settings, value:await prepare(document,settings)})));
    return write(async (tx) => {
      const guardedSettings = await Promise.all(changes.map(async change => {
        const previous = await request(tx.objectStore('settings').get(change.key));
        if ((previous?.revision ?? 0) !== change.expectedRevision) throw new DocumentStorageError('The package or its settings changed in another window. Run the command again.', 'CONFLICT');
        return {change, previous};
      }));
      const [heads, snapshots, infos] = await Promise.all(['documents', 'revisions', 'imageInfo'].map(name => request(tx.objectStore(name).getAll())));
      const candidates = new Map(heads.map(head => [head.id,head])), nextSnapshots = [...snapshots], imageInfo = new Map(infos.map(item => [item.key,item]));
      const existingKeys = new Set(imageInfo.keys()), records = new Map(), results = [];
      for (const {document,settings,value} of prepared) {
        const previous = candidates.get(document.id);
        if (settings.expectedRevision !== undefined && settings.expectedRevision !== (previous?.revision ?? 0)) throw new DocumentStorageError('A newer version was saved in another window. Open that version or save this document under a new name.', 'CONFLICT');
        const revision = (previous?.revision ?? 0)+1, updatedAt = now();
        const head = {id:document.id,metadata:value.metadata,imageRefs:value.imageRefs,bytes:value.bytes,revision,updatedAt};
        const snapshot = {...head,id:`${document.id}:${revision}`,documentId:document.id,label:String(settings.label ?? 'Autosave').slice(0,120),pinned:Boolean(settings.pinned)};
        candidates.set(document.id,head);nextSnapshots.push(snapshot);
        let imagesWritten=0;
        for(const record of value.records.values()){imageInfo.set(record.key,{key:record.key,bytes:record.bytes});if(!existingKeys.has(record.key)&&!records.has(record.key))imagesWritten++;records.set(record.key,record);}
        results.push({document,revision,savedAt:updatedAt,imagesWritten,head,snapshot});
      }
      const retained = prune([...candidates.values()],nextSnapshots,imageInfo);
      for(const result of results){tx.objectStore('documents').put(result.head);tx.objectStore('revisions').put(result.snapshot);}
      for(const record of records.values())if(!existingKeys.has(record.key)){tx.objectStore('images').put(record);tx.objectStore('imageInfo').put({key:record.key,bytes:record.bytes});}
      for(const removed of retained.pruned)tx.objectStore('revisions').delete(removed.id);
      for(const key of imageInfo.keys())if(!retained.referenced.has(key)){tx.objectStore('images').delete(key);tx.objectStore('imageInfo').delete(key);}
      for (const {change,previous} of guardedSettings) if (Object.hasOwn(change, 'value')) tx.objectStore('settings').put({key:change.key,value:change.value,revision:nextSettingRevision(previous),updatedAt:now()});
      return results.map(result=>{delete result.head;delete result.snapshot;return {...result,bytesUsed:retained.bytes,prunedRevisions:retained.pruned};});
    });
  }
  async function persist(document, settings = {}) { return (await persistMany([{document,settings}]))[0]; }
  function nextSettingRevision(previous) {
    const revision = (previous?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(revision) || revision < 1) throw new DocumentStorageError('The saved settings revision is invalid.', 'INVALID_SETTINGS');
    return revision;
  }
  async function hydrate(record, tx) {
    if (!record) return null;
    const images = {};
    const unique = [...new Set(Object.values(record.imageRefs))];
    const stored = new Map(await Promise.all(unique.map(async (key) => { const image = await request(tx.objectStore('images').get(key)); if (!image) throw new DocumentStorageError('A saved image is missing. Try another recovery version or open your project backup.', 'CORRUPT_RECORD'); return [key, image]; })));
    for (const [id, key] of Object.entries(record.imageRefs)) { const image = stored.get(key); images[id] = image.value; if (image.value && typeof image.value === 'object') fingerprints.set(image.value, { key, bytes: image.bytes }); }
    return { document: { ...record.metadata, images }, revision: record.revision, savedAt: record.updatedAt };
  }
  const store = {
    listDocuments: () => read(['documents'], async (tx) => (await request(tx.objectStore('documents').getAll())).sort((a, b) => b.updatedAt - a.updatedAt).map(summary)),
    saveDocument: (document, settings) => serialize(() => persist(document, settings)),
    saveDocuments: (entries, options) => serialize(() => persistMany(entries, options)),
    loadDocument: (id) => read(['documents', 'images'], async (tx) => hydrate(await request(tx.objectStore('documents').get(id)), tx)),
    listRevisions: (id) => read(['revisions'], async (tx) => (await request(tx.objectStore('revisions').getAll())).filter((item) => item.documentId === id).sort((a, b) => b.revision - a.revision).map(revisionSummary)),
    restoreRevision: (id, revisionId) => serialize(async () => {
      const loaded = await read(['documents', 'revisions', 'images'], async (tx) => {
        const head = await request(tx.objectStore('documents').get(id));
        const record = await request(tx.objectStore('revisions').get(typeof revisionId === 'number' ? `${id}:${revisionId}` : revisionId));
        if (!head || !record || record.documentId !== id) throw new DocumentStorageError('That recovery version no longer exists.', 'NOT_FOUND');
        return { ...(await hydrate(record, tx)), expectedRevision: head.revision };
      });
      return persist(loaded.document, { label: `Restored version ${loaded.revision}`, expectedRevision: loaded.expectedRevision });
    }),
    deleteDocument: (id) => serialize(() => write(async (tx) => {
      const [heads, snapshots, infos] = await Promise.all(['documents', 'revisions', 'imageInfo'].map((name) => request(tx.objectStore(name).getAll())));
      const keep = [...heads.filter((item) => item.id !== id), ...snapshots.filter((item) => item.documentId !== id)];
      const referenced = keysIn(keep);
      tx.objectStore('documents').delete(id);
      for (const item of snapshots) if (item.documentId === id) tx.objectStore('revisions').delete(item.id);
      for (const { key } of infos) if (!referenced.has(key)) { tx.objectStore('images').delete(key); tx.objectStore('imageInfo').delete(key); }
      return { deleted: heads.some((item) => item.id === id) };
    })),
    getSetting: (key, fallback = /** @type {any} */ (null)) => read(['settings'], async (tx) => { const item = await request(tx.objectStore('settings').get(key)); return item === undefined || item.deleted ? fallback : item.value; }),
    getSettingsSnapshot: (keys) => read(['settings'], async (tx) => {
      if (!Array.isArray(keys) || keys.length > 8 || keys.some(key => typeof key !== 'string' || !key || key.length > 240)) throw new DocumentStorageError('Settings snapshot keys are invalid.', 'INVALID_SETTINGS');
      return Promise.all(keys.map(async key => {const item = await request(tx.objectStore('settings').get(key));return {key,revision:item?.revision ?? 0,exists:!!item && !item.deleted,value:item?.deleted ? undefined : item?.value};}));
    }),
    setSetting: (key, value) => serialize(() => write(async (tx) => { const previous = await request(tx.objectStore('settings').get(key)); tx.objectStore('settings').put({ key, value, revision:nextSettingRevision(previous), updatedAt: now() }); return value; })),
    deleteSetting: (key) => serialize(() => write(async (tx) => { const previous = await request(tx.objectStore('settings').get(key)); tx.objectStore('settings').put({key,deleted:true,revision:nextSettingRevision(previous),updatedAt:now()}); })),
    importLegacy: async ({ storage = globalThis.localStorage, keys = LEGACY_DOCUMENT_KEYS, convert } = {}) => {
      if (typeof convert !== 'function') throw new TypeError('importLegacy requires a converter returning a v4 document');
      const results = [];
      for (const key of keys) {
        try {
          const source = storage.getItem(key); if (!source) continue;
          const signature = (await fingerprint(source, false)).key;
          const marker = `legacy-import:${key}:${signature}`;
          const imported = await store.getSetting(marker);
          if (imported) { results.push({ key, documentId: imported, status: 'already-imported' }); continue; }
          const converted = await convert(JSON.parse(source), key);
          // A deterministic ID makes an interrupted import idempotent. Legacy
          // localStorage is never overwritten or removed, even after success.
          const document = { ...converted, id: `legacy-${signature.slice(0, 24)}` };
          const exists = await store.loadDocument(document.id);
          if (!exists) await store.saveDocument(document, { label: `Imported ${key}`, expectedRevision: 0 });
          await store.setSetting(marker, document.id);
          results.push({ key, documentId: document.id, status: 'imported' });
        } catch (error) { results.push({ key, status: 'failed', error: error.message }); }
      }
      return results;
    },
    requestPersistence: async () => { const storage = (options.navigator ?? globalThis.navigator)?.storage; if (!storage) return { persistent: false, supported: false }; const persistent = await storage.persisted?.() || await storage.persist?.() || false; const estimate = await storage.estimate?.(); return { persistent, supported: Boolean(storage.persist), ...estimate }; },
    close: () => db.close(),
  };
  return store;
}
// Functional form for integrations preferring explicit handles.
export const listDocuments = (store) => store.listDocuments();
export const saveDocument = (store, document, options) => store.saveDocument(document, options);
export const loadDocument = (store, id) => store.loadDocument(id);
export const listRevisions = (store, id) => store.listRevisions(id);
export const restoreRevision = (store, id, revision) => store.restoreRevision(id, revision);
export const deleteDocument = (store, id) => store.deleteDocument(id);
export const getSetting = (store, key, fallback) => store.getSetting(key, fallback);
export const setSetting = (store, key, value) => store.setSetting(key, value);

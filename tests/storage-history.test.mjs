import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openStore } from '../app/storage.mjs';
import { createHistory } from '../app/history.mjs';
const makeDoc = (id = 'sprite', count = 64) => ({ format: 'pixelwall-document', version: 4, id, name: 'Sprite', width: 8, height: 8, colorMode: 'rgba', palette: ['#ffffff'], layers: [{ id: 'ink' }], frames: [{ id: 'first', cels: { ink: { imageId: 'pixels' } } }], images: { pixels: { width: 8, height: 8, pixels: new Uint32Array(count) } } });
const change = (doc, index, value) => { const pixels = doc.images.pixels.pixels.slice(); pixels[index] = value; return { ...doc, images: { ...doc.images, pixels: { ...doc.images.pixels, pixels } } }; };
const open = (options = {}) => openStore({ indexedDB: new IDBFactory(), ...options });
test('package preferences and all artwork commit atomically under settings revision guards', async () => {
 const store = await open();
 await store.setSetting('registry', {enabled:true});
 const captured = await store.getSettingsSnapshot(['registry','preferences']);
 const saved = await store.saveDocuments([{document:makeDoc('a')},{document:makeDoc('b')}], {settings:[{key:'registry',expectedRevision:captured[0].revision},{key:'preferences',expectedRevision:captured[1].revision,value:{runs:1}}]});
 assert.deepEqual(saved.map(entry=>entry.revision),[1,1]);
 assert.deepEqual(await store.getSetting('preferences'),{runs:1});
 assert.equal((await store.getSettingsSnapshot(['registry']))[0].revision,captured[0].revision);
 const next = await store.getSettingsSnapshot(['registry','preferences']);
 await store.setSetting('registry',{enabled:false});
 await assert.rejects(store.saveDocuments([{document:{...makeDoc('a'),name:'Rejected'},settings:{expectedRevision:1}},{document:makeDoc('new')}], {settings:next.map(entry=>({key:entry.key,expectedRevision:entry.revision,...(entry.key==='preferences'?{value:{runs:2}}:{})}))}), {code:'CONFLICT'});
 assert.equal((await store.loadDocument('a')).revision,1);assert.equal(await store.loadDocument('new'),null);
 assert.deepEqual(await store.getSetting('preferences'),{runs:1});assert.equal((await store.listRevisions('a')).length,1);
 store.close();
});
test('setting deletion and recreation cannot fool a captured package command revision', async () => {
 const indexedDB = new IDBFactory(), first = await openStore({indexedDB}), other = await openStore({indexedDB});
 const [absent] = await first.getSettingsSnapshot(['preferences']);
 await other.setSetting('preferences',{runs:1});await other.deleteSetting('preferences');
 assert.equal(await first.getSetting('preferences','missing'),'missing');
 await assert.rejects(first.saveDocuments([{document:makeDoc()}],{settings:[{key:'preferences',expectedRevision:absent.revision,value:{runs:2}}]}),{code:'CONFLICT'});
 assert.equal(await first.loadDocument('sprite'),null);
 const [deleted] = await first.getSettingsSnapshot(['preferences']);assert.equal(deleted.exists,false);assert.ok(deleted.revision>0);
 await other.setSetting('preferences',{runs:1});assert.ok((await first.getSettingsSnapshot(['preferences']))[0].revision>deleted.revision);
 first.close();other.close();
});
test('failed document budget validation also rolls back pending preference updates', async () => {
 const store=await open({budgetBytes:5000});await store.setSetting('preferences',{runs:0});
 const [captured] = await store.getSettingsSnapshot(['preferences']);
 await assert.rejects(store.saveDocuments([{document:{...makeDoc(),notes:'x'.repeat(6000)}}],{settings:[{key:'preferences',expectedRevision:captured.revision,value:{runs:1}}]}),{code:'BUDGET_EXCEEDED'});
 assert.deepEqual(await store.getSetting('preferences'),{runs:0});assert.equal((await store.getSettingsSnapshot(['preferences']))[0].revision,captured.revision);store.close();
});
test('multi-document script saves commit together and conflicts roll every document back', async () => {
 const store=await open(),first=makeDoc('first'),second=makeDoc('second');
 const saved=await store.saveDocuments([{document:first,settings:{expectedRevision:0}},{document:second,settings:{expectedRevision:0}}]);
 assert.deepEqual(saved.map(entry=>entry.revision),[1,1]);assert.equal(saved.reduce((n,entry)=>n+entry.imagesWritten,0),1);
 await assert.rejects(store.saveDocuments([{document:{...first,name:'Must roll back'},settings:{expectedRevision:1}},{document:{...second,name:'Stale edit'},settings:{expectedRevision:0}}]),{code:'CONFLICT'});
 assert.equal((await store.loadDocument('first')).document.name,'Sprite');assert.equal((await store.loadDocument('first')).revision,1);
 assert.equal((await store.loadDocument('second')).revision,1);
 assert.equal((await store.listRevisions('first')).length,1);store.close();
});
test('multi-document budget failure creates no partial documents or recovery entries', async () => {
 const store=await open({budgetBytes:5000});
 await assert.rejects(store.saveDocuments([{document:makeDoc('small')},{document:{...makeDoc('large'),notes:'x'.repeat(6000)}}]),{code:'BUDGET_EXCEEDED'});
 assert.equal((await store.listDocuments()).length,0);assert.equal((await store.listRevisions('small')).length,0);store.close();
});
test('atomic saves, reopen, image deduplication, metadata edits and version restoration', async () => {
 const indexedDB = new IDBFactory(); let store = await openStore({ indexedDB }); let doc = makeDoc();
 assert.equal((await store.saveDocument(doc)).imagesWritten, 1);
 assert.equal((await store.saveDocument({ ...doc, name: 'Renamed' }, { expectedRevision: 1 })).imagesWritten, 0);
 doc = change(doc, 4, 0xffaabbcc); assert.equal((await store.saveDocument(doc)).imagesWritten, 1);
 store.close(); store = await openStore({ indexedDB });
 const loaded = await store.loadDocument('sprite'); assert.equal(loaded.revision, 3); assert.deepEqual(loaded.document, doc);
 const restored = await store.restoreRevision('sprite', 1); assert.equal(restored.revision, 4); assert.equal(restored.document.images.pixels.pixels[4], 0);
 assert.equal((await store.listDocuments()).length, 1); assert.equal((await store.listRevisions('sprite')).length, 4);
 await assert.rejects(store.saveDocument(doc, { expectedRevision: 1 }), { code: 'CONFLICT' }); assert.equal((await store.loadDocument('sprite')).revision, 4);
});
test('linked images survive cross-document deletion and shared entries are stored once', async () => {
 const store = await open(); const first = makeDoc('a'); const second = { ...first, id: 'b' };
 await store.saveDocument(first); assert.equal((await store.saveDocument(second)).imagesWritten, 0);
 await store.deleteDocument('a'); assert.deepEqual((await store.loadDocument('b')).document.images, first.images); assert.equal(await store.loadDocument('a'), null);
});
test('bounded revisions preserve two recovery versions and reject excessive new content without data loss', async () => {
 const store = await open({ maxRevisions: 3, budgetBytes: 20000 }); let doc = makeDoc();
 for (let i = 0; i < 8; i++) { doc = change(doc, i, i + 1); await store.saveDocument(doc); }
 assert.equal((await store.listRevisions('sprite')).length, 3);
 const current = await store.loadDocument('sprite'); const huge = { ...doc, notes: 'a'.repeat(30000) };
 await assert.rejects(store.saveDocument(huge), { code: 'BUDGET_EXCEEDED' }); assert.deepEqual(await store.loadDocument('sprite'), current);
});
test('corrupt legacy keys are reported, valid data imported idempotently, originals retained', async () => {
 const store = await open(); const values = new Map([['old', JSON.stringify({ name: 'old' })], ['corrupt', '{']]);
 const storage = { getItem: (key) => values.get(key) }; const options = { storage, keys: ['old', 'corrupt'], convert: () => makeDoc() };
 const first = await store.importLegacy(options); assert.deepEqual(first.map(r => r.status), ['imported', 'failed']);
 const second = await store.importLegacy(options); assert.equal(second[0].status, 'already-imported'); assert.equal((await store.listDocuments()).length, 1); assert.equal(values.get('corrupt'), '{');
 await store.setSetting('shortcuts', { pencil: 'b' }); assert.deepEqual(await store.getSetting('shortcuts'), { pencil: 'b' });
});
test('one stroke is one sparse undo transaction and unaffected images preserve identity', () => {
 const doc = makeDoc('large', 1024 * 1024); doc.images.shared = { pixels: new Uint32Array(64) };
 const history = createHistory(doc); history.begin('Pencil'); let next = doc;
 for (let i = 0; i < 10; i++) { next = change(next, i * 2, i + 1); history.update(next); }
 assert.equal(history.stats.undo, 0); history.end(); assert.equal(history.stats.undo, 1); assert.ok(history.stats.bytes < 10000);
 const undone = history.undo(); assert.deepEqual(undone.images.pixels.pixels, doc.images.pixels.pixels); assert.equal(undone.images.shared, doc.images.shared);
 assert.deepEqual(history.redo().images.pixels.pixels, next.images.pixels.pixels);
 history.undo(); history.commit(change(history.present, 100, 123)); assert.equal(history.canRedo, false);
});
test('structural changes, cancel, and bounded history preserve correct document state', () => {
 const doc = makeDoc(); const history = createHistory(doc, { maxEntries: 2 });
 const added = { ...doc, layers: [...doc.layers, { id: 'shade' }], images: { ...doc.images, extra: { pixels: [1, 2] } } };
 history.commit(added, 'Add'); assert.deepEqual(history.undo(), doc); assert.deepEqual(history.redo(), added);
 history.begin(); history.update({ ...added, name: 'cancelled' }); assert.deepEqual(history.cancel(), added);
 for (let i = 0; i < 10; i++) history.commit({ ...history.present, name: `Rename ${i}` });
 assert.equal(history.stats.undo, 2); assert.equal(history.undo().name, 'Rename 8'); assert.equal(history.undo().name, 'Rename 7');
});

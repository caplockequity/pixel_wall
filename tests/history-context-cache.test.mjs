import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, historyValuesEqual } from '../app/history.mjs';
import { createDocumentHistoryCache } from '../app/history-cache.mjs';
import { createDocument, applyCommand } from '../app/editor-core.mjs';
const document = id => createDocument({ id, width: 4, height: 4, name: id });
const rename = (doc, name) => applyCommand(doc, { type: 'document.update', patch: { name } });
const context = (index, selected = true) => ({ selection: selected ? { width: 2, height: 2, mask: Uint8Array.from([index, 0, 0, 1]) } : null, range: { frameIds: [`frame-${index}`], layerIds: ['layer'] } });

test('one Lua transaction undoes/redoes both artwork and detached UI selection/range context', () => {
  const before = document('one'), after = rename(before, 'changed'), history = createHistory(before), initial = context(1), final = context(2);
  history.commit(after, 'Lua script', { beforeContext: initial, afterContext: final });
  initial.selection.mask[0] = 99; final.range.frameIds.push('mutated');
  assert.equal(history.undo().name, 'one'); assert.deepEqual(history.lastContext, context(1));
  const exposed = history.lastContext; exposed.selection.mask[0] = 55;
  assert.deepEqual(history.lastContext, context(1));
  assert.equal(history.redo().name, 'changed'); assert.deepEqual(history.lastContext, context(2));
});
test('selection-only transaction remains undoable with exactly the same document reference', () => {
  const doc = document('one'), history = createHistory(doc);
  history.commit(doc, 'Lua selection', { beforeContext: context(0, false), afterContext: context(1) });
  assert.equal(history.present, doc); assert.equal(history.canUndo, true); assert.equal(history.stats.undo, 1); assert.equal(history.lastChange.changed, true);
  assert.equal(history.undo(), doc); assert.deepEqual(history.lastContext, context(0, false)); assert.equal(history.canRedo, true);
  assert.equal(history.redo(), doc); assert.deepEqual(history.lastContext, context(1));
});
test('ordinary edits, exhausted history, reset and cancelled gesture clear stale UI context', () => {
  const doc = document('one'), history = createHistory(doc);
  history.commit(doc, 'select', { beforeContext: null, afterContext: context(1) });
  history.undo(); assert.equal(history.lastContext, null); history.undo(); assert.equal(history.lastContext, undefined);
  history.redo(); assert.deepEqual(history.lastContext, context(1));
  history.commit(rename(doc, 'name'), 'rename'); assert.equal(history.lastContext, undefined);
  history.undo(); assert.equal(history.lastContext, undefined); history.redo(); assert.equal(history.lastContext, undefined);
  history.begin(); history.cancel(); assert.equal(history.lastContext, undefined);
  history.reset(doc); assert.equal(history.lastContext, undefined);
});
test('unchanged UI context and artwork is a no-op that preserves redo', () => {
  const doc = document('one'), history = createHistory(doc);
  history.commit(rename(doc, 'two')); history.undo();
  history.commit(doc, 'no-op', { beforeContext: context(1), afterContext: context(1) });
  assert.equal(history.stats.undo, 0); assert.equal(history.canRedo, true); assert.equal(history.lastChange.changed, false);
});
test('large typed selection masks retain byte-based context accounting and are included in pruning', () => {
  const doc = document('one'), size = 4 * 1024 * 1024, before = { selection: new Uint8Array(size) }, after = { selection: new Uint8Array(size) }; after.selection[size - 1] = 1;
  const history = createHistory(doc, { maxBytes: 10 * 1024 * 1024 });
  history.commit(doc, 'large selection', { beforeContext: before, afterContext: after });
  assert.ok(history.stats.bytes > size * 2); assert.ok(history.stats.bytes < size * 2 + 2048);
  history.undo(); assert.equal(history.lastContext.selection[size - 1], 0); history.redo(); assert.equal(history.lastContext.selection[size - 1], 1);
  const bounded = createHistory(doc, { maxBytes: 1024 }); bounded.commit(doc, 'too large to retain', { beforeContext: before, afterContext: after });
  assert.equal(bounded.canUndo, false); assert.equal(bounded.lastChange.recorded, false); assert.equal(bounded.stats.bytes, 0);
});
test('invalid or oversized context rejects atomically before changing artwork/history', () => {
  const doc = document('one'), next = rename(doc, 'next'), history = createHistory(doc, { maxContextBytes: 1024 });
  for (const options of [{ beforeContext: null }, { beforeContext: undefined, afterContext: null }, { beforeContext: null, afterContext: new Uint8Array(2048) }]) assert.throws(() => history.commit(next, 'invalid', options));
  assert.equal(history.present, doc); assert.equal(history.canUndo, false);
  if (typeof SharedArrayBuffer !== 'undefined') assert.throws(() => history.commit(next, 'shared', { beforeContext: null, afterContext: new Uint8Array(new SharedArrayBuffer(32)) }), /shared/);
  history.begin(); assert.throws(() => history.commit(next, 'invalid', { beforeContext: null, afterContext: context(1) }), /gesture/); history.cancel();
});
test('cache reuses exact saved content and revision, preserving Undo, Redo and Lua context', () => {
  const cache = createDocumentHistoryCache(), before = document('one'), history = cache.acquire(before).history;
  history.commit(rename(before, 'two'), 'Lua', { beforeContext: context(1), afterContext: context(2) }); history.undo();
  assert.equal(cache.park({ history, document: history.present, storedRevision: 5 }).cached, true);
  const restored = cache.acquire(structuredClone(history.present), { storedRevision: 5 });
  assert.equal(restored.reused, true); assert.equal(restored.history, history); assert.equal(restored.history.canRedo, true); assert.equal(cache.stats.documents, 0);
  restored.history.redo(); assert.deepEqual(restored.history.lastContext, context(2));
});
test('cache refuses revision mismatch or same-revision content mismatch from external/recovery writes', () => {
  for (const changed of ['revision', 'content']) {
    const cache = createDocumentHistoryCache(), doc = document('one'), history = cache.acquire(doc).history; history.commit(rename(doc, 'two'));
    cache.park({ history, document: history.present, storedRevision: 3 });
    const next = changed === 'content' ? rename(history.present, 'externally changed') : structuredClone(history.present);
    const restored = cache.acquire(next, { storedRevision: changed === 'revision' ? 4 : 3 });
    assert.equal(restored.reused, false); assert.equal(restored.history.present, next); assert.equal(restored.history.canUndo, false);
  }
});
test('cache never parks an unfinished gesture, unsaved content, missing revision or oversized active budget', () => {
  const cache = createDocumentHistoryCache({ maxBytes: 2048, activeBudgetBytes: 1024 }), doc = document('one'), history = cache.acquire(doc).history;
  assert.equal(cache.park({ history, document: doc }).cached, false);
  history.commit(rename(doc, 'two')); assert.equal(cache.park({ history, document: doc, storedRevision: 1 }).cached, false);
  history.begin(); assert.equal(cache.park({ history, document: history.present, storedRevision: 1 }).cached, false); history.cancel();
  assert.equal(cache.park({ history: createHistory(doc, { maxBytes: 2048 }), document: doc, storedRevision: 1 }).cached, false);
});
test('LRU eviction bounds retained document, Undo, Redo and UI context bytes across parked histories', () => {
  const histories = ['a', 'b', 'c'].map(id => { const doc = document(id), h = createHistory(doc, { maxBytes: 1024 }); h.commit(rename(doc, id + ' changed')); return h; });
  const allowance = histories[0].retainedBytes + histories[1].retainedBytes + 8;
  const cache = createDocumentHistoryCache({ maxBytes: 1024 + allowance, activeBudgetBytes: 1024, maxDocuments: 4 });
  for (const history of histories.slice(0, 2)) cache.park({ history, document: history.present, storedRevision: 1 });
  const a = cache.acquire(structuredClone(histories[0].present), { storedRevision: 1 }); cache.park({ history: a.history, document: a.history.present, storedRevision: 1 });
  cache.park({ history: histories[2], document: histories[2].present, storedRevision: 1 });
  assert.deepEqual(cache.stats.documentIds, ['a', 'c']); assert.ok(cache.stats.bytes <= cache.stats.maxBytes);
  assert.equal(cache.acquire(histories[1].present, { storedRevision: 1 }).reused, false);
});
test('cache also bounds document count, supports invalidation, and never mutates evicted artwork', () => {
  const cache = createDocumentHistoryCache({ maxDocuments: 1 }), histories = ['a', 'b'].map(id => cache.acquire(document(id)).history);
  for (const history of histories) cache.park({ history, document: history.present, storedRevision: 1 });
  assert.deepEqual(cache.stats.documentIds, ['b']); assert.equal(histories[0].present.name, 'a');
  assert.equal(cache.invalidate('b'), true); assert.equal(cache.stats.documents, 0);
  cache.park({ history: histories[0], document: histories[0].present, storedRevision: 1 }); cache.clear(); assert.equal(cache.stats.documents, 0);
});
test('history equality respects typed view ranges, values and object key order', () => {
  assert.equal(historyValuesEqual({ a: 1, b: new Uint8Array([1, 2]) }, { b: new Uint8Array([1, 2]), a: 1 }), true);
  assert.equal(historyValuesEqual(new Uint8Array([0, 1, 2]).subarray(1), new Uint8Array([1, 2])), true);
  assert.equal(historyValuesEqual(new Uint8Array([1, 2]), new Uint8Array([2, 1])), false);
  assert.equal(historyValuesEqual([1, 2], [1, 2, 3]), false);
});

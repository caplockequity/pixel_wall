import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument, applyCommand } from '../app/editor-core.mjs';
import { createHistory } from '../app/history.mjs';

const source = readFileSync(new URL('../app/workbench.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  async function applyAutomation(');
const end = source.indexOf('  useEffect(() => {', start);
const body = source.slice(source.indexOf(') {', start) + 3, end).replace('\n  }\n', '\n');

function harness({ failAt = 0, mutateSelection = false } = {}) {
  const original = createDocument({ id: 'automation', width: 8, height: 8 });
  const docRef = { current: original }, revisionRef = { current: 0 }, operationRef = { current: null };
  const activeRef = { current: { frameId: original.frames[0].id, layerId: original.layers[0].id } };
  const historyRef = { current: createHistory(original) }, documentRevisionsRef = { current: new Map() };
  const calls = [], progress = [];
  let waits = 0;
  const deferred = async () => {
    waits++;
    if (mutateSelection) activeRef.current = { frameId: 'changed-frame', layerId: 'changed-layer' };
  };
  const apply = (input, command) => {
    calls.push({ frameId: command.frameId, layerId: command.layerId });
    if (failAt && calls.length === failAt) throw Error('command failed');
    return applyCommand(input, command);
  };
  const fn = new Function('automationRef','nativeSessionRef','luaAbortRef','restoringRef','operationRef','docRef','revisionRef','activeRef','applyCommand','deferred','historyRef','setSaveStatus','documentRevisionsRef','analyticsRef','reconcile','setDoc','setHistoryVersion','setHistoryState','setNotice', `return async function(commands,label,{onProgress} = {}){${body}}`) (
    { current: { desktop: { assertEditable() {} } } }, { current: null }, { current: null }, { current: false }, operationRef,
    docRef, revisionRef, activeRef, apply, deferred, historyRef, () => {}, documentRevisionsRef,
    { current: { committed() {} } }, () => {}, () => {}, () => {}, () => {}, message => progress.push(message),
  );
  return { fn, original, docRef, revisionRef, operationRef, activeRef, historyRef, calls, progress, waits };
}

test('automation captures target selection before yielding and commits one history entry', async () => {
  const h = harness({ mutateSelection: true });
  await h.fn([{ type: 'draw.stroke', points: [{ x: 1, y: 1 }], color: '#ffffffff' }], 'batch', { onProgress: () => {} });
  assert.equal(h.calls[0].frameId, h.original.frames[0].id);
  assert.equal(h.calls[0].layerId, h.original.layers[0].id);
  assert.equal(h.revisionRef.current, 1);
  assert.equal(h.historyRef.current.canUndo, true);
  assert.equal(h.operationRef.current, null);
});

test('automation failure after scratch work leaves the live document and lock unchanged', async () => {
  const h = harness({ failAt: 2 });
  await assert.rejects(h.fn([
    { type: 'draw.stroke', points: [{ x: 1, y: 1 }], color: '#ffffffff' },
    { type: 'draw.stroke', points: [{ x: 2, y: 2 }], color: '#ffffffff' },
  ], 'batch', { onProgress: () => {} }), /command failed/);
  assert.deepEqual(h.docRef.current, h.original);
  assert.equal(h.revisionRef.current, 0);
  assert.equal(h.historyRef.current.canUndo, false);
  assert.equal(h.operationRef.current, null);
});

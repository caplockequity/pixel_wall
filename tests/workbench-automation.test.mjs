import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument, applyCommand } from '../app/editor-core.mjs';
import { createHistory } from '../app/history.mjs';
import { throwIfCancelled } from '../app/command-preflight.mjs';

const source = readFileSync(new URL('../app/workbench.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  async function applyAutomation(');
const end = source.indexOf('  useEffect(() => {', start);
const body = source.slice(source.indexOf(') {', start) + 3, end).replace('\n  }\n', '\n');
const applyPropertyStart = source.indexOf('      apply: async (commands, label', end);
const applyPropertyEnd = source.indexOf('      newDocument:', applyPropertyStart);
const applyProperty = source.slice(applyPropertyStart, applyPropertyEnd).replace(/,\s*$/, '');

function harness({ failAt = 0, mutateSelection = false, onYield } = {}) {
  const original = createDocument({ id: 'automation', width: 8, height: 8 });
  const docRef = { current: original }, revisionRef = { current: 0 }, operationRef = { current: null };
  const activeRef = { current: { frameId: original.frames[0].id, layerId: original.layers[0].id } };
  const historyRef = { current: createHistory(original) }, documentRevisionsRef = { current: new Map() };
  const calls = [], progress = [], analyticsCalls = [];
  let waits = 0;
  const deferred = async () => {
    waits++;
    onYield?.(waits);
    if (mutateSelection) activeRef.current = { frameId: 'changed-frame', layerId: 'changed-layer' };
  };
  const apply = (input, command) => {
    calls.push({ frameId: command.frameId, layerId: command.layerId });
    if (failAt && calls.length === failAt) throw Error('command failed');
    return applyCommand(input, command);
  };
  const fn = new Function('automationRef','nativeSessionRef','luaAbortRef','restoringRef','operationRef','docRef','revisionRef','activeRef','applyCommand','deferred','historyRef','setSaveStatus','documentRevisionsRef','analyticsRef','reconcile','setDoc','setHistoryVersion','setHistoryState','setNotice','throwIfCancelled', `return async function(commands,label,{onProgress,signal} = {}){${body}}`) (
    { current: { desktop: { assertEditable() {} } } }, { current: null }, { current: null }, { current: false }, operationRef,
    docRef, revisionRef, activeRef, apply, deferred, historyRef, () => {}, documentRevisionsRef,
    { current: { committed() {}, automation: (...args) => analyticsCalls.push(['automation', ...args]), automationEdit: (...args) => analyticsCalls.push(['automationEdit', ...args]) } }, () => {}, () => {}, () => {}, () => {}, message => progress.push(message), throwIfCancelled,
  );
  const apiApply = new Function('scope', `with(scope){return ({${applyProperty}}).apply}`)({
    applyAutomation: fn, analyticsRef: { current: { automation: (...args) => analyticsCalls.push(['automation', ...args]), automationEdit: (...args) => analyticsCalls.push(['automationEdit', ...args]) } },
    historyRef, revisionRef, setNotice: message => progress.push(message),
  });
  return { fn, apiApply, original, docRef, revisionRef, operationRef, activeRef, historyRef, calls, progress, waits, analyticsCalls };
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


test('cancellation after a yielded chunk discards actual raster work and preserves history', async () => {
  const controller = new AbortController();
  const h = harness({onYield: count => {if(count === 2) controller.abort();}});
  const commands = Array.from({length:64}, (_, n) => ({type:'draw.stroke',points:[{x:n%8,y:Math.floor(n/8)}],color:'#ffffffff'}));
  await assert.rejects(h.fn(commands, 'cancelled', {signal:controller.signal}), {name:'AbortError'});
  assert.ok(h.calls.length > 0 && h.calls.length < commands.length);
  assert.deepEqual(h.docRef.current, h.original);
  assert.equal(h.revisionRef.current, 0);
  assert.equal(h.historyRef.current.canUndo, false);
  assert.equal(h.operationRef.current, null);
});

test('production automation API reports successful changed edits, excludes no-ops, and skips failures', async () => {
  const changed = harness();
  await changed.apiApply([{ type: 'draw.stroke', points: [{ x: 1, y: 1 }], color: '#ffffffff' }], 'agent batch');
  assert.deepEqual(changed.analyticsCalls, [['automation', 'apply', 1], ['automationEdit', 'apply', true, 1]]);

  const noop = harness();
  await noop.apiApply([{ type: 'document.update', patch: { name: noop.original.name } }], 'agent no-op');
  assert.deepEqual(noop.analyticsCalls, [['automation', 'apply', 1], ['automationEdit', 'apply', false, 1]]);

  const failed = harness({ failAt: 1 });
  await assert.rejects(failed.apiApply([{ type: 'draw.stroke', points: [{ x: 1, y: 1 }], color: '#ffffffff' }], 'agent failure'));
  assert.deepEqual(failed.analyticsCalls, []);
});

test('the editor cancel control aborts UI command batches without automation attribution', async () => {
  const h = harness({onYield: count => { if (count === 2) h.operationRef.current.cancel(); }});
  const commands = Array.from({length:64}, (_, n) => ({type:'draw.stroke',points:[{x:n%8,y:Math.floor(n/8)}],color:'#ffffffff'}));
  await assert.rejects(h.fn(commands, 'UI batch'), {name:'AbortError'});
  assert.ok(h.calls.length > 0 && h.calls.length < commands.length);
  assert.deepEqual(h.docRef.current, h.original);
  assert.equal(h.historyRef.current.canUndo, false);
  assert.equal(h.operationRef.current, null);
  assert.deepEqual(h.analyticsCalls, []);
});

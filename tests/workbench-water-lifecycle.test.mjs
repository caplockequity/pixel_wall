import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument, applyCommand } from '../app/editor-core.mjs';

const source = readFileSync(new URL('../app/workbench.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  const newWaterScene = useCallback');
const bodyStart = source.indexOf('async (options = {}) => {', start) + 'async (options = {}) => {'.length;
const bodyEnd = source.indexOf('  }, [activate, saveBeforeSwitch, setBusy]);', bodyStart);
const body = source.slice(bodyStart, bodyEnd);

function harness({ save, activate } = {}) {
  const original = createDocument({ id: 'original', width: 16, height: 16 });
  const docRef = { current: original }, busyRef = { current: false };
  let busy = false;
  const setBusy = value => { busy = value; busyRef.current = value; };
  const calls = [];
  const saveFn = save || (async () => { calls.push('save'); return { revision: 1 }; });
  const fn = new Function('automationRef', 'busyRef', 'luaAbortRef', 'nativeSessionRef', 'operationRef', 'restoringRef', 'docRef', 'setBusy', 'createDocument', 'applyCommand', 'saveBeforeSwitch', 'activate', 'analyticsRef', 'setModal', 'setNotice', `return async (options = {}) => {${body}}`)(
    { current: null }, busyRef, { current: null }, { current: null }, { current: null }, { current: false }, docRef, setBusy, createDocument, applyCommand,
    saveFn, activate || (async next => { calls.push('activate'); docRef.current = next; }),
    { current: { project() {}, committed() {} } }, () => calls.push('modal'), message => calls.push(message),
  );
  return { fn, original, docRef, calls, get busy() { return busy; } };
}

test('failed save preserves original document and clears busy state', async () => {
  const h = harness({ save: async () => { throw new Error('save failed'); } });
  await assert.rejects(h.fn({ scene: 'pond' }), /save failed/);
  assert.equal(h.docRef.current.id, 'original'); assert.equal(h.busy, false); assert.deepEqual(h.calls, []);
});
test('null save preserves original document and does not activate', async () => {
  const h = harness({ save: async () => null });
  await assert.rejects(h.fn({ scene: 'pond' }), /Save a checkpoint or bound file before generating a water scene/);
  assert.equal(h.docRef.current.id, 'original'); assert.equal(h.busy, false); assert.deepEqual(h.calls, []);
});
test('invalid generator options fail before save or activation', async () => {
  let saves = 0; const h = harness({ save: async () => { saves++; return { revision: 1 }; } });
  await assert.rejects(h.fn({ scene: 'not-a-scene' }), /Unknown water scene/);
  assert.equal(saves, 0); assert.equal(h.docRef.current.id, 'original'); assert.equal(h.busy, false);
});
test('successful generation saves then activates and clears busy state', async () => {
  const h = harness();
  await h.fn({ scene: 'pond', width: 16, height: 16, frames: 1 });
  assert.deepEqual(h.calls, ['save', 'activate', 'modal', 'Water scene generated in a new project tab.']);
  assert.notEqual(h.docRef.current.id, 'original'); assert.equal(h.busy, false);
});

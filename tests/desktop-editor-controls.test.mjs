import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createCloseController, runEditorAction } from '../desktop/editor-controls.mjs';
import { createDesktopMenuTemplate } from '../desktop/update-checker.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function harness(overrides = {}) {
  const events = [];
  const controller = createCloseController({
    prepare: async attemptId => { events.push(['prepare', attemptId]); return { status: 'ready', attemptId, id: 'document', revision: 3 }; },
    cancel: async attemptId => events.push(['cancel', attemptId]),
    confirmDiscard: async error => { events.push(['confirm', error.message]); return false; },
    close: () => events.push(['close']),
    onKeepEditing: () => events.push(['keep']),
    ...overrides,
  });
  return { controller, events };
}

test('close requires the renderer lock and durable-save acknowledgement for this attempt', async () => {
  const run = harness();
  await run.controller.request();
  assert.deepEqual(run.events, [['prepare', 'desktop-close-1'], ['close']]);
  assert.equal(run.controller.getState(), 'closed');
  await run.controller.request();
  assert.equal(run.events.length, 2);
});

for (const [name, result] of [
  ['saved false', { saved: false, reason: 'Device storage is unavailable.' }],
  ['null', null], ['undefined', undefined],
  ['legacy successful save without a lock', { id: 'document', revision: 3 }],
  ['editor not loaded', { status: 'blocked', reason: 'The editor is opening.' }],
  ['gesture in progress', { status: 'blocked', reason: 'Finish the current edit.' }],
  ['wrong attempt', { status: 'ready', attemptId: 'old', id: 'document', revision: 3 }],
  ['missing document', { status: 'ready', attemptId: 'desktop-close-1', revision: 3 }],
]) test(`close keeps artwork when prepare returns ${name}`, async () => {
  const run = harness({ prepare: async () => result });
  await run.controller.request();
  assert.deepEqual(run.events.map(event => event[0]), ['confirm', 'keep', 'cancel']);
  assert.equal(run.controller.getState(), 'idle');
});

test('a rejected save offers a choice and a second close can save successfully', async () => {
  let first = true;
  const run = harness({ prepare: async attemptId => { if (first) { first = false; throw new Error('Disk is full'); } return { status: 'ready', attemptId, id: 'doc', revision: 4 }; } });
  await run.controller.request();
  assert.equal(run.events[0][1], 'Disk is full');
  await run.controller.request();
  assert.equal(run.events.at(-1)[0], 'close');
  assert.deepEqual(run.events.find(event => event[0] === 'cancel'), ['cancel', 'desktop-close-1']);
});

test('repeated close and quit requests join one save and one discard dialog', async () => {
  const waiting = deferred();
  let calls = 0;
  const run = harness({ prepare: () => { calls++; return waiting.promise; } });
  const first = run.controller.request(), second = run.controller.request();
  assert.equal(first, second);
  await tick();
  assert.equal(calls, 1);
  waiting.resolve({ saved: false });
  await first;
  assert.equal(run.events.filter(event => event[0] === 'confirm').length, 1);
});

test('only explicit discard closes after a failed save; a failed dialog keeps the window', async () => {
  for (const decision of [true, false, 'true', undefined, 'throw']) {
    const run = harness({ prepare: async () => null, confirmDiscard: async () => { if (decision === 'throw') throw new Error('dialog failed'); return decision; } });
    await run.controller.request();
    assert.equal(run.events.some(event => event[0] === 'close'), decision === true);
    assert.equal(run.events.some(event => event[0] === 'cancel'), decision !== true);
  }
});

test('timed-out saves cannot close later, and Keep editing invalidates their attempt', async () => {
  const waiting = deferred();
  const run = harness({ prepare: () => waiting.promise, timeoutMs: 5 });
  await run.controller.request();
  assert.match(run.events[0][1], /too long/);
  assert.deepEqual(run.events.at(-1), ['cancel', 'desktop-close-1']);
  waiting.resolve({ status: 'ready', attemptId: 'desktop-close-1', id: 'doc', revision: 3 });
  await tick();
  assert.equal(run.events.some(event => event[0] === 'close'), false);
});

test('a renderer edit arriving during save must block rather than accept a stale result', async () => {
  const waiting = deferred();
  let currentRevision = 3;
  const run = harness({ prepare: async attemptId => {
    const captured = currentRevision;
    await waiting.promise;
    return captured === currentRevision
      ? { status: 'ready', attemptId, id: 'doc', revision: captured }
      : { status: 'blocked', reason: 'The document changed while saving.' };
  } });
  const closing = run.controller.request();
  await tick(); currentRevision++; waiting.resolve(); await closing;
  assert.equal(run.events.some(event => event[0] === 'close'), false);
  assert.match(run.events[0][1], /changed/);
});

test('a destroyed owner suppresses late dialogs and close callbacks', async () => {
  const waiting = deferred(); let destroyed = false;
  const run = harness({ prepare: () => waiting.promise, isDestroyed: () => destroyed });
  const closing = run.controller.request();
  destroyed = true; waiting.reject(new Error('renderer destroyed')); await closing;
  assert.deepEqual(run.events, []);
});

function rendererHarness({ activeElement = null, api } = {}) {
  const events = [];
  const context = vm.createContext({ window: { pixelwall: api }, document: { activeElement } });
  return { events, contents: {
    executeJavaScript: async (source, gesture) => { assert.equal(gesture, true); return vm.runInContext(source, context); },
    undo: () => events.push('text undo'), redo: () => events.push('text redo'),
    copy: () => events.push('text copy'), cut: () => events.push('text cut'), paste: () => events.push('text paste'),
  } };
}

test('native menu undo and redo call document history when the canvas owns focus', async () => {
  const calls = [];
  const run = rendererHarness({ activeElement: { tagName: 'CANVAS' }, api: { undo: async () => calls.push('document undo'), redo: async () => calls.push('document redo') } });
  await runEditorAction(run.contents, 'undo'); await runEditorAction(run.contents, 'redo');
  assert.deepEqual(calls, ['document undo', 'document redo']);
  assert.deepEqual(run.events, []);
});

test('native image clipboard grants follow the focus check and precede renderer artwork dispatch', async () => {
  const calls = [];
  const run = rendererHarness({activeElement:{tagName:'CANVAS'},api:{desktop:{action:async action => calls.push(action)}}});
  for (const action of ['copy','cut','paste']) await runEditorAction(run.contents,action,undefined,{authorizeClipboard:requested => {calls.push(`grant ${requested}`);return true;}});
  assert.deepEqual(calls,['grant copy','copy','grant cut','cut','grant paste','paste']);
  assert.deepEqual(run.events,[]);
  await assert.rejects(runEditorAction(run.contents,'paste'),/not ready/);
  assert.equal(calls.length,6);
});

test('native clipboard commands preserve text-field behavior without authorizing image access', async () => {
  const run = rendererHarness({activeElement:{tagName:'TEXTAREA'},api:{desktop:{action:() => assert.fail('must not dispatch artwork')}}});
  for (const action of ['copy','cut','paste']) await runEditorAction(run.contents,action,undefined,{authorizeClipboard:() => assert.fail('must not grant image access')});
  assert.deepEqual(run.events,['text copy','text cut','text paste']);
});

for (const activeElement of [
  { tagName: 'TEXTAREA' }, { tagName: 'INPUT', type: 'text' }, { tagName: 'INPUT', type: 'number' },
  { tagName: 'DIV', isContentEditable: true },
  { tagName: 'CUSTOM-EDITOR', shadowRoot: { activeElement: { tagName: 'TEXTAREA' } } },
]) test(`native undo preserves text history for ${activeElement.tagName}/${activeElement.type || ''}`, async () => {
  const run = rendererHarness({ activeElement, api: { undo: () => assert.fail('must not undo artwork'), redo: () => assert.fail('must not redo artwork') } });
  await runEditorAction(run.contents, 'undo'); await runEditorAction(run.contents, 'redo');
  assert.deepEqual(run.events, ['text undo', 'text redo']);
});

test('renderer file commands use the explicit desktop actions and project export', async () => {
  const calls = [];
  const run = rendererHarness({ api: { desktop: { action: action => calls.push(action) }, export: options => calls.push(options.format) } });
  for (const action of ['new', 'open', 'save', 'saveAs', 'export', 'backup']) await runEditorAction(run.contents, action);
  assert.deepEqual(calls, ['new', 'open', 'save', 'saveAs', 'export', 'project']);
  await assert.rejects(runEditorAction(run.contents, 'unknown'), /Unknown/);
});

test('renderer close forwards attempt tokens and refuses an unavailable editor', async () => {
  const missing = rendererHarness();
  assert.equal((await runEditorAction(missing.contents, 'prepareClose', 'one')).status, 'blocked');
  await runEditorAction(missing.contents, 'cancelClose', 'one');
  const calls = [];
  const run = rendererHarness({ api: { desktop: { prepareClose: id => calls.push(['prepare', id]), cancelClose: id => calls.push(['cancel', id]) } } });
  await runEditorAction(run.contents, 'prepareClose', 'one'); await runEditorAction(run.contents, 'cancelClose', 'one');
  assert.deepEqual(calls, [['prepare', 'one'], ['cancel', 'one']]);
});

test('native file and history menu items route to the selected window on every OS', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const calls = [], owner = {};
    const menu = createDesktopMenuTemplate({ platform, onEditorAction: (action, window) => calls.push([action, window]) });
    const file = menu.find(item => item.role === 'fileMenu');
    const edit = menu.find(item => item.role === 'editMenu');
    for (const item of [...file.submenu, ...edit.submenu].filter(item => item.click)) item.click({}, owner);
    assert.deepEqual(calls.map(([action]) => action), ['new', 'open', 'save', 'saveAs', 'export', 'undo', 'redo', 'cut', 'copy', 'paste']);
    assert.ok(calls.every(([, window]) => window === owner));
    assert.equal(edit.submenu.find(item => item.label === 'Undo').role, undefined);
    assert.equal(edit.submenu.find(item => item.label === 'Undo').accelerator, 'CmdOrCtrl+Z');
    assert.equal(edit.submenu.find(item => item.label === 'Paste').role, undefined);
  }
});

test('the actual main process uses the tested lifecycle and packages its controller', async () => {
  const main = await readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8');
  const metadata = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'));
  assert.match(main, /createCloseController\(/);
  assert.match(main, /closeController\.request\(\)/);
  assert.doesNotMatch(main, /window\.pixelwall\?\.save\(\)/);
  assert.ok(metadata.build.files.includes('editor-controls.mjs'));
});

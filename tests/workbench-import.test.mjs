import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument, normalizeDocument, migrateLegacy, applyCommand } from '../app/editor-core.mjs';
import { createBlankProject, encodeProjectContainer, stringifyProject, decodeProjectContainer, parseProject } from '../app/project-format.mjs';

const source = readFileSync(new URL('../app/workbench.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  async function importFiles(');
const end = source.indexOf('  function chooseImport(', start);
assert.ok(start >= 0 && end > start);
const functionSource = source.slice(start, end);
const body = functionSource.slice(functionSource.indexOf('{') + 1, functionSource.lastIndexOf('\n  }'));

function file(name, bytes) { return new File([bytes], name); }

function harness(original = createDocument({ width: 2, height: 2, name: 'Original' })) {
  const state = { current: original }, calls = [], errors = [];
  const refs = {
    nativeSessionRef: { current: null }, luaAbortRef: { current: null }, automationRef: { current: null },
    fileRef: { current: { value: 'selected' } }, pendingImportFormatRef: { current: null },
  };
  const deps = {
    importKind: 'project', ...refs, report: error => errors.push(error), setBusy: () => {},
    fileRef: refs.fileRef, analyticsFormat: ext => ext,
    analyticsRef: { current: { imported: (...args) => calls.push(args) } },
    setImportedProfile: () => {}, setProfileTarget: () => {}, setModal: () => {}, setLuaSource: () => {},
    setScriptLanguage: () => {}, setPanel: () => {}, extensions: [], storeRef: { current: { setSetting: async () => {} } },
    setExtensions: () => {}, setNotice: message => calls.push(message), setPendingImage: () => {},
    setImportWarnings: () => {}, setActiveLayer: () => {}, decodeImage: async () => {}, readAseprite: () => {}, importGif: () => {},
    normalizeDocument, decodeProjectContainer,
    parseProject, migrateLegacy, createDocument, applyCommand, pixelsFromRgba: () => [],
    stem: name => name.replace(/\.[^.]+$/, ''), save: async () => ({ revision: 1 }), saveBeforeSwitch: async () => ({ saved: true, revision: 1 }),
    activate: async next => { state.current = next; calls.push('activate'); }, crypto: { randomUUID: () => 'imported-id' },
    docRef: { current: state.current },
  };
  const fn = new Function(...Object.keys(deps), `return async function importFiles(files, kind = importKind) {${body}}`)(...Object.values(deps));
  return { fn, state, calls, errors, refs };
}

async function importOne(h, input) {
  await h.fn([input]);
  return h.state.current;
}

test('browser import restores artwork from compact current project backups', async () => {
  const original = applyCommand(createDocument({ width: 2, height: 2, name: 'Compact current' }), {
    type: 'draw.rect', x: 0, y: 0, width: 2, height: 1, color: '#338b96ff', filled: true,
  });
  const bytes = encodeProjectContainer(original);
  const h = harness();
  const opened = await importOne(h, file('current.pixelwall', bytes));
  assert.deepEqual(h.errors, [], JSON.stringify({ errors: h.errors, calls: h.calls }));
  assert.deepEqual(opened, { ...original, id: 'imported-id' });
});

test('browser import opens compact portable legacy projects', async () => {
  const legacy = createBlankProject({ size: 2, name: 'Compact portable' });
  const bytes = encodeProjectContainer(JSON.parse(stringifyProject(legacy.project, legacy.editor)));
  const h = harness();
  const opened = await importOne(h, file('portable.pixelwall', bytes));
  assert.equal(opened.name, 'Compact portable');
  assert.equal(opened.metadata.migratedFrom, 'runtime');
});

test('browser import retains JSON current and portable compatibility for both extensions', async () => {
  const current = normalizeDocument(createDocument({ width: 2, height: 2, name: 'JSON current' }));
  const legacy = createBlankProject({ size: 2, name: 'JSON portable' });
  for (const extension of ['pixelwall', 'json']) {
    const currentHarness = harness();
    const currentOpened = await importOne(currentHarness, file(`current.${extension}`, new TextEncoder().encode(JSON.stringify(current))));
    assert.equal(currentOpened.name, 'JSON current');
    const legacyHarness = harness();
    const legacyOpened = await importOne(legacyHarness, file(`portable.${extension}`, new TextEncoder().encode(stringifyProject(legacy.project, legacy.editor))));
    assert.equal(legacyOpened.name, 'JSON portable');
  }
});

test('browser import rejects corrupt compact projects without replacing the current document', async () => {
  const original = createDocument({ width: 2, height: 2, name: 'Keep me' });
  const valid = encodeProjectContainer(original);
  for (const bytes of [valid.subarray(0, valid.length - 1), Uint8Array.from(valid, (value, index) => index === valid.length - 1 ? value ^ 0xff : value)]) {
    const h = harness(original);
    await h.fn([file('broken.pixelwall', bytes)]);
    assert.equal(h.state.current, original);
    assert.equal(h.calls.includes('activate'), false);
    assert.equal(h.errors.length, 1);
  }
});

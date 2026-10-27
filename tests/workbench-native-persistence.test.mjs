import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createDocument } from '../app/editor-core.mjs';
import { createNativeDocumentSession } from '../app/native-document-session.mjs';

const source = readFileSync(new URL('../app/workbench.jsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('workbench.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const ref = current => ({current});

function productionHost(name, scope) {
  let found;
  const visit = node => {
    if (ts.isBinaryExpression(node) && node.left.getText(parsed) === 'hostRef.current' && ts.isObjectLiteralExpression(node.right)) {
      found = node.right.properties.find(property => property.name?.getText(parsed) === name)?.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert(found, `Missing production host method ${name}`);
  return new Function('scope', `with(scope){return (${found.getText(parsed)});}`)(scope);
}

function makeBridge({ revisions, bindingRevisions = revisions, saveStatus = 'saved', chooseStatus = 'ready' } = {}) {
  return {
    async list() { return Object.entries(bindingRevisions).map(([documentId, revision]) => ({documentId, revision})); },
    async info() { return {format: 'pixelwall'}; },
    async chooseSave() { return chooseStatus === 'ready' ? {status: 'ready', token: 'save-token', format: 'pixelwall'} : {status: chooseStatus}; },
    async writeSave({documentId, revision}) { return saveStatus === 'saved' ? {status: 'saved', documentId, lastSavedRevision: bindingRevisions[documentId] ?? revision, name: 'scene.pixelwall'} : {status: saveStatus, reason: 'Save failed'}; },
    async cancelSave() { return {status: 'cancelled'}; },
  };
}

function makeScope({mode = 'file', current, globalRevision = 17, localRevisions = {}, retained = [], bridgeOptions = {}, save = async () => ({saved: true})} = {}) {
  const docs = new Map([[current.id, current], ...retained.map(entry => [entry.document.id, entry.document])]);
  const local = new Map(Object.entries(localRevisions));
  const temporaryDocuments = new Map(retained.map(entry => [entry.document.id, entry]));
  const scope = {
    nativeSessionRef: ref(null),
    nativeReadyRef: ref(true),
    luaAbortRef: ref(null),
    operationRef: ref(null),
    restoringRef: ref(false),
    busyRef: ref(false),
    docRef: ref(current),
    revisionRef: ref(globalRevision),
    documentModeRef: ref(mode),
    checkpointDeliveryRef: ref(null),
    temporaryDocumentsRef: ref(temporaryDocuments),
    savedDocumentsRef: ref(new Map()),
    historyValuesEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    save,
    setSaveStatus() {},
    setNotice() {},
    report(error) { scope.reported = error; },
    analyticsRef: ref({saveResult() {}}),
    downloads: {getLastResult: () => null},
  };
  const host = productionHost('nativeSaved', scope);
  const sessionHost = {
    read: async id => ({document: docs.get(id || current.id), revision: local.get(id || current.id) ?? 0}),
    encode: async () => new TextEncoder().encode(JSON.stringify({format: 'pixelwall-project'})),
    saved: (result, captured) => host(result, captured),
  };
  scope.nativeSessionRef.current = createNativeDocumentSession(makeBridge({revisions: localRevisions, ...bridgeOptions}), sessionHost);
  scope.host = productionHost('saveForClose', scope);
  scope.action = productionHost('desktopAction', scope);
  return scope;
}

test('close uses each native binding revision, not the global editor revision', async () => {
  const current = createDocument({id: 'current', width: 2, height: 2});
  const retained = createDocument({id: 'retained', width: 2, height: 2});
  const scope = makeScope({current, globalRevision: 17, localRevisions: {current: 3, retained: 5}, retained: [{document: retained, revision: 5, mode: 'file'}]});
  const result = await scope.host();
  assert.equal(result.saved, true);
  assert.deepEqual(result.nativeDocuments.map(entry => [entry.id, entry.revision]), [['current', 3], ['retained', 5]]);
});

test('close blocks a stale or missing native revision', async () => {
  const current = createDocument({id: 'current', width: 2, height: 2});
  const scope = makeScope({current, globalRevision: 17, localRevisions: {current: 2}, bridgeOptions: {bindingRevisions: {current: 3}}});
  await assert.rejects(scope.host(), /file was not saved|save/i);
  const missingScope = makeScope({current, globalRevision: 17, localRevisions: {}, save: async () => ({saved: false})});
  const missing = await missingScope.host();
  assert.equal(missing.saved, false);
});

test('Save As under a full library establishes file mode without retrying the library save', async () => {
  const current = createDocument({id: 'current', width: 2, height: 2});
  let librarySaves = 0;
  const scope = makeScope({current, mode: 'library', globalRevision: 17, localRevisions: {current: 17}, save: async () => { librarySaves++; const error = Error('The local library is full'); error.code = 'BUDGET_EXCEEDED'; throw error; }});
  await scope.action('saveAs');
  assert.equal(scope.documentModeRef.current, 'file');
  assert.equal(librarySaves, 0);
  assert.equal((await scope.host()).saved, true);
});

test('cancelled and failed Save As leave a library document in library mode', async t => {
  for (const bridgeOptions of [{chooseStatus: 'cancelled'}, {saveStatus: 'error'}]) {
    await t.test(bridgeOptions.chooseStatus || bridgeOptions.saveStatus, async () => {
      const current = createDocument({id: 'current', width: 2, height: 2});
      const scope = makeScope({current, mode: 'library', localRevisions: {current: 3}, bridgeOptions, save: async () => ({saved: true})});
      await assert.rejects(scope.action('saveAs'));
      assert.equal(scope.documentModeRef.current, 'library');
    });
  }
});

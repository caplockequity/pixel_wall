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

function productionBinding(name, scope) {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name?.getText(parsed) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert(found, `Missing production binding ${name}`);
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

function makeScope({mode = 'file', current, globalRevision = 17, localRevisions = {}, retained = [], bridgeOptions = {}, save = null} = {}) {
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
    documentRevisionsRef: ref(new Map(Object.entries(localRevisions))),
    historyValuesEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    save: null,
    setSaveStatus() {},
    setNotice() {},
    report(error) { scope.reported = error; },
    analyticsRef: ref({saveResult() {}}),
    downloads: {getLastResult: () => null},
  };
  scope.save = save || (async () => scope.documentModeRef.current === 'library' ? {saved: true} : {saved: false, skipped: true, mode: scope.documentModeRef.current});
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

function makeRestoreScope({mode = 'library', current, incoming, savedCurrent = current, retained = []} = {}) {
  const temporaryDocuments = new Map(retained.map(entry => [entry.document.id, entry]));
  const savedDocuments = new Map([[savedCurrent.id, savedCurrent]]);
  const scope = {
    docRef: ref(current), documentModeRef: ref(mode), revisionRef: ref(17), storedRevisionRef: ref(4),
    documentRevisionsRef: ref(new Map([[current.id, 17], ...retained.map(entry => [entry.document.id, entry.revision])])),
    savedDocumentsRef: ref(savedDocuments), temporaryDocumentsRef: ref(temporaryDocuments),
    historyValuesEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    nativeSessionRef: ref(null), historyRef: ref({present: current}), historyCacheRef: {park() {}, invalidate() {}},
    setSaveStatus() {}, setNotice() {}, setDocuments(updater) { scope.documents = updater(scope.documents || []); },
    documents: [{id: current.id, name: current.name}, ...retained.map(entry => ({id: entry.document.id, name: entry.document.name}))],
    activate: async (document, storedRevision, options) => { scope.activation = {document, storedRevision, options}; scope.docRef.current = document; scope.documentModeRef.current = options?.mode || 'library'; },
    install() {},
    report(error) { scope.reported = error; },
    currentIncoming: incoming,
  };
  scope.restore = productionHost('nativeRestoreNative', scope);
  scope.read = productionHost('nativeRead', scope);
  return scope;
}

test('close uses each native binding revision, not the global editor revision', async () => {
  const current = createDocument({id: 'current', width: 2, height: 2});
  const retained = createDocument({id: 'retained', width: 2, height: 2});
  const scope = makeScope({current, globalRevision: 17, localRevisions: {current: 3, retained: 5}, retained: [{document: retained, revision: 11, mode: 'file'}]});
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
  const scope = makeScope({current, mode: 'library', globalRevision: 17, localRevisions: {current: 3}, bridgeOptions: {bindingRevisions: {current: 3}}, save: async () => { librarySaves++; const error = Error('The local library is full'); error.code = 'BUDGET_EXCEEDED'; throw error; }});
  await scope.action('saveAs');
  assert.equal(scope.documentModeRef.current, 'file');
  assert.equal(librarySaves, 0);
  assert.equal((await scope.host()).saved, true);
});

test('saving a bound retained document does not rely on its global tab revision', async () => {
  const current = createDocument({id: 'current', width: 2, height: 2});
  const retained = createDocument({id: 'retained', width: 2, height: 2});
  const entry = {document: retained, revision: 11, mode: 'library'};
  const scope = makeScope({current, mode: 'file', globalRevision: 17, localRevisions: {current: 3, retained: 5}, retained: [entry], bridgeOptions: {bindingRevisions: {current: 3, retained: 5}}});
  const result = await scope.host();
  assert.equal(result.saved, true);
  assert.equal(entry.mode, 'file');
});

test('a stale native save acknowledgement cannot switch the active library document to file mode', () => {
  const current = createDocument({id: 'current', width: 2, height: 2});
  const stale = createDocument({id: 'stale', width: 2, height: 2});
  const scope = makeScope({current, mode: 'library', localRevisions: {current: 3}});
  const saved = productionHost('nativeSaved', scope);
  saved({status: 'saved', name: 'stale.pixelwall'}, {document: stale, revision: 3});
  assert.equal(scope.documentModeRef.current, 'library');
});

function switchScope({saveCurrent = async () => {}, retained = new Map()} = {}) {
  const current = createDocument({id: 'switch-current', width: 2, height: 2});
  const scope = {
    useCallback: fn => fn,
    docRef: ref(current), documentModeRef: ref('file'), revisionRef: ref(17), storedRevisionRef: ref(3),
    checkpointDeliveryRef: ref(null), temporaryDocumentsRef: ref(retained), nativeSessionRef: ref({saveCurrent}),
    save: async () => ({saved: false, skipped: true}),
  };
  scope.switch = productionBinding('saveBeforeSwitch', scope);
  return scope;
}

test('file-backed switch saves first and retains the exact document for nativeRead', async () => {
  let writes = 0;
  const scope = switchScope({saveCurrent: async () => { writes++; }});
  const result = await scope.switch();
  assert.equal(result.saved, true);
  assert.equal(writes, 1);
  const retained = scope.temporaryDocumentsRef.current.get('switch-current');
  assert.equal(retained.document, scope.docRef.current);
  assert.equal(retained.revision, 17);
  assert.equal(retained.mode, 'file');
});

test('failed file save does not retain or switch away from the current document', async () => {
  const scope = switchScope({saveCurrent: async () => { throw Error('disk unavailable'); }});
  await assert.rejects(scope.switch(), /disk unavailable/);
  assert.equal(scope.temporaryDocumentsRef.current.size, 0);
  assert.equal(scope.docRef.current.id, 'switch-current');
});

test('file-backed switch checks the eight-document retention limit before writing', async () => {
  let writes = 0;
  const retained = new Map(Array.from({length: 8}, (_, index) => [`retained-${index}`, {document:{id:`retained-${index}`}, revision:index, mode:'file'}]));
  const scope = switchScope({retained, saveCurrent: async () => { writes++; }});
  const result = await scope.switch();
  assert.equal(result.saved, false);
  assert.equal(writes, 0);
  assert.match(result.reason, /eight retained/i);
});

test('native restore replaces a clean current library document without overwriting its library snapshot', async () => {
  const current = createDocument({id: 'current', width: 2, height: 2});
  const incoming = createDocument({id: 'current', width: 2, height: 2, name: 'restored from disk'});
  const scope = makeRestoreScope({current, incoming});
  await scope.restore({document: incoming, revision: 7, source: 'disk', binding: {documentId: 'current'}});
  assert.equal(scope.activation.document, incoming);
  assert.equal(scope.activation.storedRevision, undefined);
  assert.deepEqual(scope.activation.options, {allowNative: true, mode: 'file'});
  assert.equal(scope.documentRevisionsRef.current.get('current'), 7);
  assert.equal(scope.savedDocumentsRef.current.get('current'), current);
  assert.ok(scope.documents.some(entry => entry.id === 'current' && entry.name === incoming.name));
});

test('native restore retains a noncurrent file and nativeRead prefers it over the library copy', async () => {
  const current = createDocument({id: 'current', width: 2, height: 2});
  const incoming = createDocument({id: 'other', width: 2, height: 2, name: 'restored other'});
  const stale = createDocument({id: 'other', width: 2, height: 2, name: 'stale library copy'});
  const scope = makeRestoreScope({current, incoming});
  scope.savedDocumentsRef.current.set('other', stale);
  await scope.restore({document: incoming, revision: 9, source: 'disk', binding: {documentId: 'other'}});
  const retained = scope.temporaryDocumentsRef.current.get('other');
  assert.equal(retained.document, incoming);
  assert.equal(retained.mode, 'file');
  assert.equal(retained.revision, 17);
  assert.equal(scope.documentRevisionsRef.current.get('other'), 9);
  const loaded = await scope.read('other');
  assert.equal(loaded.document, incoming);
});

test('native restore refuses to replace a dirty retained document', async () => {
  const current = createDocument({id: 'current', width: 2, height: 2});
  const retained = createDocument({id: 'other', width: 2, height: 2});
  const dirty = {...retained, name: 'dirty retained'};
  const incoming = createDocument({id: 'other', width: 2, height: 2, name: 'disk version'});
  const scope = makeRestoreScope({current, incoming, retained: [{document: dirty, revision: 3, mode: 'file'}]});
  scope.savedDocumentsRef.current.set('other', retained);
  await assert.rejects(scope.restore({document: incoming, revision: 4, source: 'disk', binding: {documentId: 'other'}}), /dirty|unsaved|retained|changes/i);
  assert.equal(scope.temporaryDocumentsRef.current.get('other').document, dirty);
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

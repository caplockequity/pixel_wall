import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createDocument,applyCommand} from '../app/editor-core.mjs';
import {historyValuesEqual} from '../app/history.mjs';
import {validateExportScale} from '../app/export-scale.mjs';
import {exportFrameTraversal} from '../app/frame-traversal.mjs';
import {packAtlas} from '../app/formats.mjs';
import {renderScaledExportFrame} from '../app/export-render.mjs';
const text=readFileSync(new URL('../app/workbench.jsx',import.meta.url),'utf8');
const parsed=ts.createSourceFile('workbench.jsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function production(name,scope,host=false){let found;function visit(node){if(!host&&ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;if(host&&ts.isBinaryExpression(node)&&node.left.getText(parsed)==='hostRef.current'&&ts.isObjectLiteralExpression(node.right)){found=node.right.properties.find(p=>p.name?.getText(parsed)===name)?.initializer??found;}ts.forEachChild(node,visit);}visit(parsed);assert(found,`Missing production ${name}`);return new Function('scope',`with(scope){return (${found.getText(parsed)});}`)(scope);}
const ref=current=>({current});
function closeScope(){const document=createDocument({width:2,height:2});const scope={temporaryDocumentsRef:ref(new Map()),savedDocumentsRef:ref(new Map()),documentRevisionsRef:ref(new Map([[document.id,5]])),docRef:ref(document),revisionRef:ref(17),documentModeRef:ref('temporary'),checkpointDeliveryRef:ref(null),nativeSessionRef:ref(null),historyValuesEqual,save:async()=>({saved:false}),setSaveStatus(){},setNotice(){}};scope.close=production('saveForClose',scope,true);return scope;}
const checkpoint=(document,revision)=>({status:'verified',documentId:document.id,revision,sha256:'a'.repeat(64),bytes:20});
function checkpointGuard({current, revision = 0, mode = 'library', checkpoint: receipt = null, retained = [], saved = []} = {}) {
  const savedDocuments = new Map(saved.map(document => [document.id, document]));
  return production('hasUncheckpointedWork', { historyValuesEqual })(current, revision, mode, receipt, new Map(retained.map(entry => [entry.document.id, entry])), savedDocuments);
}

test('production checkpoint guard includes retained temporary work when current library is saved', () => {
  const current = createDocument({ id: 'saved-current', width: 2, height: 2 });
  const retained = createDocument({ id: 'retained-temp', width: 2, height: 2 });
  assert.equal(checkpointGuard({ current, saved: [current], retained: [{ document: retained, revision: 2, mode: 'temporary' }] }), true);
});

test('production checkpoint guard accepts an exact verified checkpoint for retained temporary work', () => {
  const current = createDocument({ id: 'saved-current', width: 2, height: 2 });
  const retained = createDocument({ id: 'retained-temp', width: 2, height: 2 });
  assert.equal(checkpointGuard({ current, saved: [current], retained: [{ document: retained, revision: 2, mode: 'temporary', checkpoint: checkpoint(retained, 2) }] }), false);
});

test('production checkpoint guard rejects stale checkpoints and generated receipts', () => {
  const current = createDocument({ id: 'saved-current', width: 2, height: 2 });
  const retained = createDocument({ id: 'retained-temp', width: 2, height: 2 });
  assert.equal(checkpointGuard({ current, saved: [current], retained: [{ document: retained, revision: 3, mode: 'temporary', checkpoint: checkpoint(retained, 2) }] }), true);
  assert.equal(checkpointGuard({ current, saved: [current], retained: [{ document: retained, revision: 2, mode: 'temporary', checkpoint: { status: 'generated', documentId: retained.id, revision: 2 } }] }), true);
});

test('production checkpoint guard warns for dirty retained library documents', () => {
  const current = createDocument({ id: 'saved-current', width: 2, height: 2 });
  const retained = createDocument({ id: 'retained-library', width: 2, height: 2 });
  const savedRetained = applyCommand(retained, { type: 'draw.rect', x: 0, y: 0, width: 1, height: 1, filled: true, color: '#ff0000ff' });
  assert.equal(checkpointGuard({ current, saved: [current, savedRetained], retained: [{ document: retained, revision: 2, mode: 'library' }] }), true);
});

function openScope({mode = 'temporary', saveResult = { saved: true }, retained = [], stored = []} = {}) {
  const current = createDocument({ id: 'current', width: 2, height: 2 });
  const temporaryDocuments = new Map(retained.map(entry => [entry.document.id, entry]));
  const loaded = new Map(stored.map(entry => [entry.document.id, entry]));
  const scope = {
    nativeSessionRef: ref(null), luaAbortRef: ref(null), automationRef: ref({ desktop: { assertEditable() {} } }),
    docRef: ref(current), revisionRef: ref(2), storedRevisionRef: ref(0), documentModeRef: ref(mode), checkpointDeliveryRef: ref(null), temporaryDocumentsRef: ref(temporaryDocuments),
    savedDocumentsRef: ref(new Map()),
    storeRef: ref({ loadDocument: async id => loaded.get(id) ?? null }),
    setBusy() {}, save: async () => saveResult, activate: async (document, revision) => { scope.activated = { document, revision }; scope.docRef.current = document; },
    setClosedDocuments: updater => { scope.closed = updater([]); }, analyticsRef: ref({ project() {} }), report: error => { scope.error = error; },
  };
  scope.hostRef = ref({ restoreTemporary: async ({ documentId }) => { const entry = temporaryDocuments.get(documentId); scope.activated = { document: entry.document, revision: entry.revision }; scope.docRef.current = entry.document; } });
  scope.open = production('openDocument', scope);
  return scope;
}

test('production openDocument retains a temporary current document before switching', async () => {
  const target = createDocument({ id: 'target', width: 2, height: 2 });
  const s = openScope({ mode: 'temporary', saveResult: { saved: false }, stored: [{ document: target, revision: 4 }] });
  await s.open('target');
  if (!s.activated) assert.fail(s.error?.message || 'open did not activate');
  assert.equal(s.activated.document.id, 'target');
  assert.equal(s.temporaryDocumentsRef.current.get('current').document.id, 'current');
  assert.equal(s.temporaryDocumentsRef.current.get('current').mode, 'temporary');
});

test('production openDocument restores a retained session before consulting the library', async () => {
  const retained = createDocument({ id: 'retained', width: 2, height: 2 });
  const stale = createDocument({ id: 'retained', width: 2, height: 2, name: 'stale library copy' });
  const s = openScope({ mode: 'library', retained: [{ document: retained, revision: 8, storedRevision: 3, mode: 'library' }], stored: [{ document: stale, revision: 3 }] });
  await s.open('retained');
  if (!s.activated) assert.fail(s.error?.message || 'open did not activate');
  assert.equal(s.activated.document.name, retained.name);
  assert.equal(s.activated.revision, 8);
});

test('production openDocument keeps the current library document after a failed save', async () => {
  const target = createDocument({ id: 'target', width: 2, height: 2 });
  const s = openScope({ mode: 'library', saveResult: { saved: false }, stored: [{ document: target, revision: 4 }] });
  await s.open('target');
  assert.equal(s.activated, undefined);
  assert.equal(s.docRef.current.id, 'current');
});

test('production closeDocumentTab describes retained checkpoint state instead of claiming device save', async () => {
  const document = createDocument({ id: 'temporary', width: 2, height: 2 });
  const notices = [];
  const scope = { busy: false, luaAbortRef: ref(null), nativeSessionRef: ref(null), docRef: ref(document), documentModeRef: ref('temporary'), temporaryDocumentsRef: ref(new Map([[document.id, { document, revision: 2, mode: 'temporary' }]])), checkpointDeliveryRef: ref(null), documents: [{ id: document.id }, { id: 'other' }], closedDocuments: [], openDocument: async () => true, setClosedDocuments: updater => { scope.closedDocuments = updater(scope.closedDocuments); }, setNotice: message => notices.push(message) };
  const close = production('closeDocumentTab', scope);
  await close(document.id);
  assert.match(notices.at(-1), /retained|checkpoint|temporary/i);
  assert.doesNotMatch(notices.at(-1), /saved on this device/i);
});
test('production close handler accepts only exact checkpoints and protects dirty retained library content',async()=>{
 const s=closeScope();assert.equal((await s.close()).saved,false);s.checkpointDeliveryRef.current=checkpoint(s.docRef.current,16);assert.equal((await s.close()).saved,false);
 s.checkpointDeliveryRef.current=checkpoint(s.docRef.current,17);assert.equal((await s.close()).saved,true);
 const original=createDocument({width:2,height:2}),dirty=applyCommand(original,{type:'draw.rect',x:0,y:0,width:1,height:1,filled:true,color:'#ff0000ff'});
 s.savedDocumentsRef.current.set(original.id,original);s.temporaryDocumentsRef.current.set(original.id,{document:dirty,revision:2,storedRevision:2,mode:'library'});
 assert.equal((await s.close()).saved,false,'equal revision counters do not prove content saved');
 s.temporaryDocumentsRef.current.get(original.id).checkpoint=checkpoint(dirty,2);assert.equal((await s.close()).saved,true);
 s.temporaryDocumentsRef.current.set(original.id,{document:original,revision:0,storedRevision:7,mode:'library'});assert.equal((await s.close()).saved,true,'different counters do not make persisted content dirty');
});
test('production close handler verifies every retained bound file and its revision',async()=>{
 const s=closeScope();s.documentModeRef.current='file';s.nativeSessionRef.current={saveAll:async()=>[{id:s.docRef.current.id,revision:5}]};
 assert.equal((await s.close()).saved,true,'real native saveAll uses id and revision');
 s.nativeSessionRef.current.saveAll=async()=>[];assert.equal((await s.close()).saved,false,'a missing current binding is not replaced by a successful library fallback');
 s.nativeSessionRef.current.saveAll=async()=>[{id:s.docRef.current.id,revision:4}];assert.equal((await s.close()).saved,false);
 s.nativeSessionRef.current.saveAll=async()=>[{id:s.docRef.current.id,revision:5}];const retained=createDocument({width:2,height:2});
 s.documentRevisionsRef.current.set(retained.id,3);s.temporaryDocumentsRef.current.set(retained.id,{document:retained,revision:11,mode:'file'});assert.equal((await s.close()).saved,false,'unbound retained file cannot be assumed saved');
 s.nativeSessionRef.current.saveAll=async()=>[{id:s.docRef.current.id,revision:5},{id:retained.id,revision:3}];assert.equal((await s.close()).saved,true);
});
test('production close saves a retained bound library document before treating it as file-backed',async()=>{
 const s=closeScope();s.documentModeRef.current='file';const original=createDocument({id:'retained-bound',width:2,height:2});const dirty=applyCommand(original,{type:'draw.rect',x:0,y:0,width:1,height:1,filled:true,color:'#ff0000ff'});
 s.savedDocumentsRef.current.set(original.id,original);s.documentRevisionsRef.current.set(original.id,5);const entry={document:dirty,revision:11,mode:'library'};s.temporaryDocumentsRef.current.set(dirty.id,entry);
 s.nativeSessionRef.current={saveAll:async()=>[{id:s.docRef.current.id,revision:5},{id:dirty.id,revision:5}]};
 assert.equal((await s.close()).saved,true);
});
test('production export plan describes exact frames and current entitlement without asking for access',()=>{
 let doc=createDocument({width:4,height:3});doc=applyCommand(doc,{type:'frame.duplicate',frameId:doc.frames[0].id,linked:true});doc=applyCommand(doc,{type:'frame.duplicate',frameId:doc.frames[0].id,linked:true});
 const s={docRef:ref(doc),revisionRef:ref(9),activeRef:ref({frameId:doc.frames[1].id,layerId:doc.layers[0].id}),clipId:'',validateExportScale,exportFrameTraversal,renderScaledExportFrame,packAtlas,scaleExportSlices:()=>[],colorManager:null,renderingIntent:1,targetLayers:()=>[doc.layers[0].id],PAID_FORMATS:new Set(['gif','sheet','zip']),stem:()=> 'fixture',access:{pro:false,requestAccess(){throw Error('Plan must not open checkout');}}};
 s.exportFrameIds=production('exportFrameIds',s);s.plan=production('createExportPlan',s);
 assert.deepEqual(s.plan({format:'png'}).frameIds,[doc.frames[1].id]);assert.equal(s.plan({format:'project'}).frameCount,3);assert.equal(s.plan({format:'gif'}).frameCount,3);
 assert.equal(s.plan({format:'gif'}).canExport,false);assert.equal(s.plan({format:'png'}).canExport,true);s.access.pro=true;assert.equal(s.plan({format:'gif'}).canExport,true);
 assert.throws(()=>s.plan({format:'png',expectedFrameCount:3}),/frame count/);assert.throws(()=>s.plan({format:'png',frameId:'missing'}),/frame/);assert.throws(()=>s.plan({format:'gif',clipId:'missing'}),/clip/);assert.throws(()=>s.plan({format:'bogus'}),/format/);
});
test('production atlas plan reports packed output dimensions and layout inputs',()=>{
 let doc=createDocument({width:4,height:3});doc=applyCommand(doc,{type:'draw.rect',layerId:doc.layers[0].id,frameId:doc.frames[0].id,x:0,y:0,width:2,height:2,filled:true,color:'#ff0000ff'});doc=applyCommand(doc,{type:'frame.duplicate',frameId:doc.frames[0].id,linked:true});
 const s={docRef:ref(doc),revisionRef:ref(1),activeRef:ref({frameId:doc.frames[0].id,layerId:doc.layers[0].id}),clipId:'',validateExportScale,exportFrameTraversal,renderScaledExportFrame,packAtlas,scaleExportSlices:()=>[],colorManager:null,renderingIntent:1,targetLayers:()=>[doc.layers[0].id],PAID_FORMATS:new Set(['gif','sheet','zip']),stem:()=> 'fixture',access:{pro:true}};
 s.buildExportAtlasPlan=production('buildExportAtlasPlan',s);s.exportFrameIds=production('exportFrameIds',s);s.plan=production('createExportPlan',s);
 const plan=s.plan({format:'sheet',scale:2,trim:false,padding:2,border:3,extrude:1,layout:'horizontal'});
 assert.equal(plan.sourceWidth,8);assert.equal(plan.sourceHeight,6);assert.equal(plan.outputWidth,plan.atlas.width);assert.equal(plan.outputHeight,plan.atlas.height);assert.equal(plan.atlas.layout,'horizontal');assert.equal(plan.atlas.border,3);assert.ok(plan.outputWidth>plan.sourceWidth);
 assert.throws(()=>s.plan({format:'sheet',scale:1,width:8192,height:8192}),/pixel budget|atlas|maximum/i);
});

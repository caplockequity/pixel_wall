import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openStore } from '../app/storage.mjs';
import { createNativeDocumentSession } from '../app/native-document-session.mjs';
import { createDocument, normalizeDocument } from '../app/editor-core.mjs';

const bytesFor = doc => new TextEncoder().encode(JSON.stringify(doc));
function harness({ documents, initial }) {
  let current = initial, mode='temporary', revision=0; const temporary=new Map();
  const bridge={
    async openTemporary(){const file=documents.shift();return {files:file?[{name:file.name,bytes:file.bytes}]:[]};},
    async open(){const file=documents.shift();return {files:file?[{name:file.name,token:'t',bytes:file.bytes}]:[]};},
    async bindOpen(){return {status:'bound'};}, async cancelOpen(){}, async list(){return []},
    async info(){return {format:'pixelwall'}}, async chooseSave(){return {status:'ready',token:'s',format:'pixelwall'}},
    async writeSave({documentId,revision}){return {status:'saved',documentId,lastSavedRevision:revision}}, async cancelSave(){},
  };
  const host={
    read:async()=>({document:current,revision}), encode:async doc=>bytesFor(doc), decode:async file=>({document:normalizeDocument(JSON.parse(new TextDecoder().decode(file.bytes))),warnings:[]}),
    flushRecovery:async()=>{}, activateTemporary:async ({document})=>{temporary.set(document.id,{document,revision:0});current=document;mode='temporary';},
    activateFileBacked:async ({document})=>{current=document;mode='file';revision=0;return {document,revision}}, activate:async ({document,revision:nextRevision=0})=>{current=document;revision=nextRevision}, imported:()=>{}, saved:()=>{},
  };
  return {session:createNativeDocumentSession(bridge,host),get state(){return {current,mode,revision,temporary}}};
}

test('full library keeps file checkpoints and temporary documents independently recoverable', async () => {
  const store=await openStore({indexedDB:new IDBFactory(),budgetBytes:1024});
  const first=createDocument({id:'first',width:8,height:8});
  await assert.rejects(store.saveDocument({...first,metadata:{padding:'x'.repeat(4000)}}),{code:'BUDGET_EXCEEDED'});
  const second=createDocument({id:'second',width:8,height:8});
  const source=[{name:'second.pixelwall',bytes:bytesFor(second)},{name:'first.pixelwall',bytes:bytesFor(first)}];
  const h=harness({documents:source,initial:first});
  await h.session.openTemporary();
  assert.equal(h.state.mode,'temporary'); assert.equal(h.state.current.id,'second');
  const projects=await store.listDocuments(); assert.equal(projects.length,0);
  await h.session.openTemporary();
  assert.equal(h.state.current.id,'first');
  store.close();
});

test('file-backed session saves by file when library persistence is unavailable', async () => {
  const first=createDocument({id:'file-backed',width:4,height:4});
  const h=harness({documents:[{name:'file-backed.pixelwall',bytes:bytesFor(first)}],initial:first});
  await h.session.openFileBacked();
  assert.equal(h.state.mode,'file');
  const saved=await h.session.saveCurrent(); assert.deepEqual(saved,{id:'file-backed',revision:0});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeDocumentSession} from '../app/native-document-session.mjs';
import {createDesktopSession} from '../app/desktop-session.mjs';
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture() {
  const calls=[], documents=new Map([['a',{document:{id:'a',name:'A'},revision:3}],['b',{document:{id:'b',name:'B'},revision:7}]]);
  const bridge={
    info:async()=>({format:'pixelwall'}),list:async()=>[{documentId:'a'},{documentId:'b'}],
    chooseSave:async request=>{calls.push(['choose',request]);return {status:'ready',token:request.documentId,format:'aseprite'};},
    writeSave:async request=>{calls.push(['write',request]);return {status:'saved',documentId:request.documentId,lastSavedRevision:request.revision};},
    cancelSave:async request=>calls.push(['cancelSave',request]),cancelOpen:async request=>calls.push(['cancelOpen',request]),
    bindOpen:async request=>{calls.push(['bind',request]);return {status:'bound',documentId:request.documentId};},
  };
  const host={read:async(id='a')=>documents.get(id),encode:async(doc,format)=>{calls.push(['encode',format]);return new TextEncoder().encode(doc.name);},saved:()=>{},flushRecovery:async()=>calls.push(['recovery']),decode:async file=>({document:{id:'new',name:file.name}}),persistImported:async document=>{calls.push(['persist',document.id]);return {document,revision:0};},activate:async captured=>calls.push(['activate',captured.document.id])};
  const session=createNativeDocumentSession(bridge,host);
  return {calls,documents,bridge,host,session};
}
test('native Save encodes the selected format and only confirms the captured revision',async()=>{
  const {calls,session}=fixture();assert.deepEqual(await session.saveCurrent(),{id:'a',revision:3});
  assert.equal(calls.find(c=>c[0]==='encode')[1],'aseprite');assert.equal(calls.find(c=>c[0]==='write')[1].revision,3);assert.equal(session.busy,false);
});
test('cancelled, failed and mismatched native save acknowledgements never report success',async()=>{
  for(const result of [null,{status:'cancelled'},{status:'error',reason:'Disk full'},{status:'saved',documentId:'b',lastSavedRevision:3},{status:'saved',documentId:'a',lastSavedRevision:2}]){
    const f=fixture();f.bridge.writeSave=async()=>result;await assert.rejects(f.session.saveCurrent());assert.ok(f.calls.some(c=>c[0]==='cancelSave'));assert.equal(f.session.busy,false);
  }
  const f=fixture();f.bridge.chooseSave=async()=>({status:'cancelled'});await assert.rejects(f.session.saveCurrent(),/cancelled/);assert.equal(f.calls.length,0);
});
test('close saves inactive bound documents and disk failure cannot become a ready acknowledgement',async()=>{
  const f=fixture();const host={desktopState:()=>({loaded:true,id:'a',revision:9,canSave:true,busy:f.session.busy}),saveForClose:async()=>({document:{id:'a'},revision:4,nativeDocuments:await f.session.saveAll()})};
  const desktop=createDesktopSession(host);assert.deepEqual((await desktop.prepareClose('ok')).nativeDocuments,[{id:'a',revision:3},{id:'b',revision:7}]);desktop.cancelClose('ok');
  f.bridge.writeSave=async request=>request.documentId==='b'?{status:'error',reason:'Disk full'}:{status:'saved',documentId:'a',lastSavedRevision:3};
  await assert.rejects(desktop.prepareClose('failure'),/Disk full/);assert.equal(desktop.locked,true);
});
test('failed serialization cancels native grants and leaves save state',async()=>{
  const f=fixture();f.host.encode=async()=>{throw Error('Unsupported property');};await assert.rejects(f.session.saveCurrent(),/Unsupported property/);assert.equal(f.session.busy,false);assert.ok(f.calls.some(c=>c[0]==='cancelSave'));
});
test('opening requires recovery storage before binding or switching documents',async()=>{
  const f=fixture();f.host.flushRecovery=async()=>{throw Error('Storage unavailable');};await assert.rejects(f.session.acceptOpen({files:[{token:'one',name:'One'},{token:'two',name:'Two'}]}),/Storage unavailable/);assert.equal(f.calls.filter(c=>c[0]==='cancelOpen').length,2);assert.ok(!f.calls.some(c=>c[0]==='activate'||c[0]==='bind'));
});
test('new native open persists, binds, then activates; changed bytes supersede an existing document ID',async()=>{
  const f=fixture();await f.session.acceptOpen({files:[{token:'t',existingDocumentId:'a',changed:true,name:'Fresh',bytes:new Uint8Array()}]});assert.deepEqual(f.calls.map(c=>c[0]),['recovery','persist','bind','activate']);assert.deepEqual(f.calls.at(-1),['activate','new']);
});
test('binding failure retains a recovery copy but cannot activate or forget an open grant',async()=>{
  const f=fixture();f.bridge.bindOpen=async()=>{throw Error('Registry full');};await assert.rejects(f.session.acceptOpen({files:[{token:'t',name:'Fresh'}]}),/Registry full/);assert.ok(f.calls.some(c=>c[0]==='persist'));assert.ok(f.calls.some(c=>c[0]==='cancelOpen'));assert.ok(!f.calls.some(c=>c[0]==='activate'));
});
test('file events arriving during Save wait and are imported exactly once afterwards',async()=>{
  const f=fixture(),waiting=deferred();f.bridge.chooseSave=()=>waiting.promise;
  const saving=f.session.saveCurrent(),opening=f.session.acceptOpen({files:[{token:'t',name:'New'}]});assert.equal(f.session.busy,true);await assert.rejects(f.session.saveCurrent(),/current file/);
  waiting.resolve({status:'ready',token:'a',format:'pixelwall'});await saving;await opening;assert.equal(f.calls.filter(c=>c[0]==='activate').length,1);assert.equal(f.session.busy,false);
});
test('missing recovery documents reopen only the bridge-owned original path',async()=>{
  const f=fixture();f.documents.delete('b');f.bridge.reopen=async request=>{assert.deepEqual(request,{documentId:'b'});return {status:'opened',files:[{token:'t',existingDocumentId:'b',recovery:true,name:'Recovered'}]};};await f.session.recoverMissing();assert.ok(f.calls.some(c=>c[0]==='activate'));assert.equal(f.session.busy,false);
});

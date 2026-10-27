import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {openOperationReceipts} from '../app/operation-receipts.mjs';
import {createAutomation} from '../app/editor-automation.mjs';

const commands = [{type:'document.update',patch:{name:'Updated'}}];
function host() {
  let revision = 0, calls = 0;
  return {revision:()=>revision,inspect:()=>({id:'test-doc'}),persistence:()=>({library:{status:'failed',code:'BUDGET_EXCEEDED'}}),
    apply:async (_commands,_label,{onProgress})=>{calls++;onProgress({phase:'staging',commandsProcessed:1});onProgress({phase:'committing'});revision++;return {changed:true};},calls:()=>calls};
}
test('completed keyed edit survives restart without replay even when the current revision differs',async()=>{
  const indexedDB = new IDBFactory();
  let receipts = await openOperationReceipts({indexedDB}), first = host();
  const before = createAutomation(first,{operationReceipts:receipts});
  const result = await before.apply({commands,requestKey:'once',expectedRevision:0,diagnostics:true});
  assert.equal(result.operation.phase,'completed');assert.equal(result.operation.committedCommands,1);
  assert.equal(result.operation.persistence.library.status,'failed');assert.ok(result.operation.diagnostics.totalMs>=0);
  receipts.close(); receipts = await openOperationReceipts({indexedDB});
  const second = host(), after = createAutomation(second,{operationReceipts:receipts});
  const recovered = await after.apply({commands,requestKey:'once',expectedRevision:0});
  assert.equal(recovered.outcome,'completed');assert.equal(recovered.replayed,false);assert.equal(second.calls(),0);
  assert.equal(recovered.receipt.resultingRevision,1);
  await assert.rejects(after.apply({commands:[{type:'document.update',patch:{name:'Different'}}],requestKey:'once',expectedRevision:0}),/different edit/);
  receipts.close();
});
test('pending receipt after restart reports unknown and does not apply again',async()=>{
  const indexedDB = new IDBFactory(), receipts = await openOperationReceipts({indexedDB}), fixture = host();
  const payload = new TextEncoder().encode(JSON.stringify({commands,expectedRevision:0,label:'Script'}));
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256',payload)).toString('hex');
  await receipts.claim({requestKey:'interrupted',payloadHash:hash,documentId:'test-doc',startingRevision:0,status:'pending'});
  const api = createAutomation(fixture,{operationReceipts:receipts});
  const result = await api.apply({commands,expectedRevision:0,requestKey:'interrupted'});
  assert.equal(result.outcome,'unknown');assert.equal(fixture.calls(),0);receipts.close();
});
test('claims are atomic between clients, bounded, and do not evict old retry keys',async()=>{
  const indexedDB = new IDBFactory(), a = await openOperationReceipts({indexedDB,limit:1}), b = await openOperationReceipts({indexedDB,limit:1});
  const receipt = {requestKey:'a',payloadHash:'0'.repeat(64),status:'pending'};
  const results = await Promise.all([a.claim(receipt),b.claim(receipt)]);
  assert.equal(results.filter(r=>r.claimed).length,1);
  await assert.rejects(b.claim({...receipt,requestKey:'b'}),/budget is full/);
  assert.equal((await a.get('a')).status,'pending');a.close();b.close();
});
test('receipt persistence failure after commit never reports a rollback',async()=>{
  const real = await openOperationReceipts({indexedDB:new IDBFactory()});
  const receipts = {...real,update:async()=>{throw Error('storage unavailable');}};
  const api = createAutomation(host(),{operationReceipts:receipts});
  const result = await api.apply({commands,requestKey:'receipt-failure'});
  assert.equal(result.operation.status,'completed');assert.equal(result.operation.receipt.persisted,false);
  assert.equal((await real.get('receipt-failure')).status,'pending');real.close();
});
test('wait-for-change returns progress and final status with bounded timeout',async()=>{
  let release;
  const fixture = host(), original = fixture.apply;
  fixture.apply = async (...args)=>{await new Promise(resolve=>{release=resolve;});return original(...args);};
  const api = createAutomation(fixture), started = await api.apply({commands,wait:false});
  const pending = api.waitForOperation({operationId:started.operationId,afterSequence:started.updateSequence,timeoutMs:1000});
  release(); const changed = await pending;
  assert.ok(changed.updateSequence>started.updateSequence);assert.equal(changed.phase,'completed');
  await assert.rejects(api.waitForOperation({operationId:started.operationId,timeoutMs:10001}),/timeout/);
});

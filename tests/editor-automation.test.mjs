import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomation,registerAutomation} from '../app/editor-automation.mjs';
import {createDocument,applyCommand,renderFrame,describeDocument,COMMANDS} from '../app/editor-core.mjs';
import {createHistory} from '../app/history.mjs';
import {validateExtension,parsePalette} from '../app/editor-extensions.mjs';

function fixture(){let doc=createDocument({width:8,height:8}),revision=0;const history=createHistory(doc);const api=createAutomation({revision:()=>revision,inspect:()=>describeDocument(doc),commands:()=>COMMANDS,apply:async(commands,label)=>{let next=doc;for(const command of commands)next=applyCommand(next,command);history.commit(next,label);doc=next;revision++;},undo:()=>{history.undo();doc=history.present;revision++;},redo:()=>{history.redo();doc=history.present;revision++;},save:()=>({revision}),newDocument:options=>{doc=createDocument(options);revision++;},preview:()=>renderFrame(doc,doc.frames[0].id),export:()=>{throw Error('Pro access is required for this export.');}});return {api,history,doc:()=>doc};}
test('agent batches mutate the shared document once, reject stale writes, undo and redo exact pixels',async()=>{const {api,history,doc}=fixture(),blank=await api.preview();const state=api.inspect();assert.ok(state.document.layerList[0].id);assert.ok(state.document.frameList[0].id);await api.apply({expectedRevision:state.revision,commands:[{type:'draw.rect',x:1,y:1,width:3,height:3,color:'#ff0000ff',filled:true},{type:'draw.line',from:{x:0,y:0},to:{x:7,y:7},color:'#00ff00ff'}]});assert.equal(api.inspect().revision,1);assert.equal(history.canUndo,true);const painted=await api.preview();assert.notDeepEqual(painted,blank);await assert.rejects(api.apply({expectedRevision:0,commands:[{type:'document.update',patch:{name:'Stale'}}]}),/document changed/);assert.notEqual(doc().name,'Stale');await api.undo();assert.deepEqual(await api.preview(),blank);await api.redo();assert.deepEqual(await api.preview(),painted);});
test('bad commands roll back the complete batch and malformed input cannot bypass the host export gate',async()=>{const {api,history}=fixture(),before=api.inspect();await assert.rejects(api.apply({commands:[{type:'document.update',patch:{name:'Must roll back'}},{type:'unknown.command'}]}));const after=api.inspect();assert.deepEqual(after.document,before.document);assert.equal(after.revision,before.revision);assert.equal(after.latestOperation.status,'failed');assert.equal(history.canUndo,false);await assert.rejects(api.apply({commands:[]}));await assert.rejects(api.export({format:'gif',pro:true}),/Pro access/);});
test('WebMCP tools expose bounded operation polling while preserving normal apply completion',async()=>{const {api}=fixture(),registered=new Map();const dispose=registerAutomation({registerTool:(tool,{signal})=>{registered.set(tool.name,tool);signal.addEventListener('abort',()=>registered.delete(tool.name));}},api);assert.equal(registered.size,13);assert.equal(registered.get('pixelwall_inspect').annotations.readOnlyHint,true);const result=await registered.get('pixelwall_apply').execute({commands:[{type:'draw.stroke',points:[{x:3,y:3}],color:'#ffffffff'}]});assert.equal(result.revision,1);assert.equal(result.operation.status,'completed');const pending=await api.apply({wait:false,commands:[{type:'draw.stroke',points:[{x:4,y:4}],color:'#ffffffff'}]});assert.equal(pending.status,'running');assert.equal(api.inspect().latestOperation.id,pending.operationId);let status=registered.get('pixelwall_operation').execute({operationId:pending.operationId});assert.equal(status.commandsTotal,1);while (status.status === 'running') { await new Promise(resolve=>setTimeout(resolve,0)); status=registered.get('pixelwall_operation').execute({operationId:pending.operationId}); }assert.equal(status.status,'completed');assert.equal(status.revision,2);assert.ok(registered.get('pixelwall_export').inputSchema.properties.layerIds);dispose();assert.equal(registered.size,0);});
test('failed operations retain partial scratch progress without advancing the document revision',async()=>{let revision=4;const api=createAutomation({revision:()=>revision,inspect:()=>({name:'unchanged'}),commands:()=>[],apply:async(_commands,_label,{onProgress})=>{onProgress({commandsProcessed:1,revision});throw Error('scratch command failed');}});const pending=await api.apply({wait:false,commands:[{type:'draw.stroke',points:[{x:1,y:1}],color:'#ffffffff'},{type:'draw.stroke',points:[{x:2,y:2}],color:'#ffffffff'}]});await new Promise(resolve=>setTimeout(resolve,0));const status=api.operation(pending.operationId);assert.equal(status.status,'failed');assert.equal(status.commandsProcessed,1);assert.equal(status.revision,4);assert.match(status.error,/scratch command failed/);assert.equal(revision,4);});
test('portable extensions contain commands only and palettes read HEX, GPL and JASC without losing alpha',()=>{const extension=validateExtension({format:'pixelwall-extension',version:1,id:'outline.red',name:'Outline red',commands:[{type:'effect.apply',effect:'outline',color:'#ff0000ff'}],execute:'fetch(secret)'});assert.equal('execute' in extension,false);assert.throws(()=>validateExtension({...extension,id:'../bad'}));assert.deepEqual(parsePalette('#11223380\n445566'),['#11223380','#445566ff']);assert.deepEqual(parsePalette('GIMP Palette\nName: Small\nColumns: 2\n# header\n255 0 32 Red'),['#ff0020ff']);assert.deepEqual(parsePalette('JASC-PAL\n0100\n1\n16 32 64'),['#102040ff']);assert.throws(()=>parsePalette('nonsense'));});

test('pending operations reject competing mutations and own an immutable command snapshot', async () => {
  let resume, seen, revision = 0;
  const wait = new Promise(resolve => { resume = resolve; });
  const api = createAutomation({ revision: () => revision, inspect: () => ({id:'original'}), apply: async commands => { await wait; seen = commands; revision++; } });
  const commands = [{type:'document.update', patch:{name:'original'}}];
  const job = await api.apply({commands, wait:false});
  commands[0].patch.name = 'mutated by caller';
  assert.equal(job.documentId, 'original');
  for (const call of [() => api.newDocument(), () => api.undo(), () => api.redo(), () => api.runLua({source:''}), () => api.colorProfile({operation:'assign'}), () => api.apply({commands})]) {
    await assert.rejects(call(), /current editor operation/);
  }
  resume(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(seen[0].patch.name, 'original');
  assert.equal(api.operation(job.operationId).status, 'completed');
});

test('operation retention is bounded and the latest result remains discoverable', async () => {
  const {api} = fixture(); let first;
  for (let n = 0; n < 70; n++) {
    const result = await api.apply({commands:[{type:'document.update',patch:{name:`Project ${n}`}}]});
    first ??= result.operationId;
  }
  assert.equal(api.operations().length, 64);
  assert.throws(() => api.operation(first), /Unknown/);
  assert.equal(api.inspect().latestOperation.id, api.operations().at(-1).id);
});

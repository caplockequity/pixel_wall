import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {IDBFactory} from 'fake-indexeddb';
import {createNativeDocumentSession} from '../app/native-document-session.mjs';
import {createDesktopSession} from '../app/desktop-session.mjs';
import {runLuaScript} from '../app/lua-runner-node.mjs';
import {createDocument,describeDocument,pixelRGBA} from '../app/editor-core.mjs';
import {createHistory,historyValuesEqual} from '../app/history.mjs';
import {createDocumentHistoryCache} from '../app/history-cache.mjs';
import {editorUiContext} from '../app/editor-ui-context.mjs';
import {openStore} from '../app/storage.mjs';

// Locate and run actual Workbench closures, without a browser or copied logic.
const source=readFileSync(new URL('../app/workbench.jsx',import.meta.url),'utf8');
const parsed=ts.createSourceFile('workbench.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
function closure(name,scope){let target;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)target=node;if(ts.isVariableDeclaration(node)&&node.name.getText(parsed)===name&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(parsed)==='useCallback')target=node.initializer.arguments[0];ts.forEachChild(node,visit);}visit(parsed);assert(target,`Missing production closure ${name}`);return new Function('scope',`with(scope){return (${target.getText(parsed)});}`)(scope);}
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const ref=current=>({current});
async function harness(t){
 const original=createDocument({id:'project',width:2,height:2}),store=await openStore({name:crypto.randomUUID(),indexedDB:new IDBFactory()});t.after(()=>store.close());const saved=await store.saveDocument(original,{expectedRevision:0});
 const scope={luaTimeout:3000,editorUiContext,historyValuesEqual,pixelRGBA,describeDocument,createHistory,
 docRef:ref(original),revisionRef:ref(0),documentRevisionsRef:ref(new Map([[original.id,0]])),storedRevisionRef:ref(saved.revision),savedRevisionsRef:ref(new Map([[original.id,saved.revision]])),savedDocumentsRef:ref(new Map([[original.id,original]])),historyRef:ref(createHistory(original)),historyCacheRef:ref(createDocumentHistoryCache()),nativeSessionRef:ref(null),activeRef:ref({frameId:original.frames[0].id,layerId:original.layers[0].id}),uiContextRef:ref(editorUiContext(original)),operationRef:ref(null),restoringRef:ref(false),busyRef:ref(false),luaAbortRef:ref(null),luaSavingRef:ref(false),saveQueueRef:ref(Promise.resolve()),storeRef:ref(store),pathRef:ref([]),luaRangeRef:ref({}),viewportRef:ref(null),window:{innerWidth:1024,innerHeight:768},clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),canvasRef:ref({focus(){}}),automationRef:ref(null),process:{env:{}},location:{origin:'http://localhost',href:'http://localhost/studio'},luaDialog:{show(){throw Error('Unexpected dialog');}},luaCommands:{show(){throw Error('Unexpected commands');}},
 runLuaScript:(input,options)=>runLuaScript(input,{...options,wasmUri:undefined}),hex:p=>'#'+p.map(v=>v.toString(16).padStart(2,'0')).join(''),reconcile(){},analyticsRef:ref({})};
 for(const name of ['setZoom','setTimelinePage','setSelectedFrames','setSelectedLayers','setPlaying','setLuaSaving','setDoc','setHistoryVersion','setHistoryState','setSelection','setActiveFrame','setActiveLayer','setClipId','setSaveStatus','setDocuments','setCommandResult','setNotice'])scope[name]=()=>{};
 scope.setBusy=value=>{scope.busyRef.current=value;};scope.restoreUiContext=context=>{scope.uiContextRef.current=editorUiContext(scope.docRef.current,context);};
 for(const name of ['install','activate','commitSnapshot','undo','redo','runLua'])scope[name]=closure(name,scope);
 const close=createDesktopSession({desktopState:()=>({loaded:true,id:scope.docRef.current.id,revision:scope.revisionRef.current,canSave:true,busy:scope.busyRef.current||scope.nativeSessionRef.current?.busy}),save:()=>store.saveDocument(scope.docRef.current)});scope.automationRef.current={desktop:close};
 const bridge={cancelOpen:async()=>{},ackOpen:async()=>{},bindOpen:async()=>({status:'bound',documentId:'imported'})},calls=[];
 const host={flushRecovery:async()=>{if(scope.luaAbortRef.current)throw Error('Finish the current edit or script before opening a file.');calls.push('flush');},decode:async()=>{calls.push('decode');return {document:createDocument({id:'imported',width:1,height:1})};},persistImported:async document=>{calls.push('persist');return {document,revision:0};},activate:async()=>calls.push('activate')};
 const native=createNativeDocumentSession(bridge,host);scope.nativeSessionRef.current=native;
 return {scope,store,original,native,bridge,host,calls,close};
}

test('durable Lua results install during rejected external-open cleanup and remain undoable',async t=>{
 const f=await harness(t),durable=gate(),releaseSave=gate(),cleanup=gate(),enteredCleanup=gate(),actualSave=f.store.saveDocuments;
 f.store.saveDocuments=async(...args)=>{const result=await actualSave(...args);durable.resolve();await releaseSave.promise;return result;};
 f.bridge.cancelOpen=async()=>{enteredCleanup.resolve();await cleanup.promise;};
 const running=f.scope.runLua({source:"app.activeSprite.layers[1].name='Lua result'"});
 await durable.promise;const opening=f.native.acceptOpen({files:[{token:'external',name:'external.aseprite'}]}),rejected=assert.rejects(opening,/Finish the current edit or script/);await enteredCleanup.promise;
 assert.equal(f.native.busy,true);assert.equal(f.scope.luaSavingRef.current,true);assert.equal((await f.store.loadDocument(f.original.id)).document.layers[0].name,'Lua result');releaseSave.resolve();
 try{await running;assert.equal(f.scope.docRef.current.layers[0].name,'Lua result');assert.equal(f.scope.historyRef.current.canUndo,true);assert.deepEqual(f.calls,[]);}finally{cleanup.resolve();await rejected;}
 f.scope.undo();assert.equal(f.scope.docRef.current.layers[0].name,'Layer 1');f.scope.redo();assert.equal(f.scope.docRef.current.layers[0].name,'Lua result');
});

test('Lua cannot start when an accepted native open already owns the editor',async t=>{
 const f=await harness(t),entered=gate(),release=gate();f.host.flushRecovery=async()=>{entered.resolve();await release.promise;};const opening=f.native.acceptOpen({files:[{token:'external',name:'external.aseprite'}]});await entered.promise;
 await assert.rejects(f.scope.runLua({source:"error('must never run')"}),/Finish the current operation/);assert.equal(f.scope.luaAbortRef.current,null);release.resolve();await opening;assert.deepEqual(f.calls,['decode','persist','activate']);assert.equal(f.scope.docRef.current,f.original);
});

test('close during durable Lua save remains blocked while completion still installs',async t=>{
 const f=await harness(t),durable=gate(),release=gate(),actualSave=f.store.saveDocuments;f.store.saveDocuments=async(...args)=>{const result=await actualSave(...args);durable.resolve();await release.promise;return result;};const running=f.scope.runLua({source:"app.activeSprite.layers[1].name='After close prompt'"});await durable.promise;
 const closed=await f.close.prepareClose('during-lua');assert.equal(closed.status,'blocked');assert.equal(f.close.locked,true);release.resolve();await running;assert.equal(f.scope.docRef.current.layers[0].name,'After close prompt');f.scope.undo();assert.equal(f.scope.docRef.current.layers[0].name,'After close prompt');f.close.cancelClose('during-lua');f.scope.undo();assert.equal(f.scope.docRef.current.layers[0].name,'Layer 1');
});

test('ordinary and merely-running Lua snapshots remain blocked by native operations',async t=>{
 const f=await harness(t),entered=gate(),release=gate();f.host.flushRecovery=async()=>{entered.resolve();await release.promise;};const opening=f.native.acceptOpen({files:[{token:'external',name:'external.aseprite'}]});await entered.promise;
 assert.throws(()=>f.scope.commitSnapshot(f.original,'ordinary',f.original,0),/file operation/);f.scope.luaAbortRef.current=new AbortController();f.scope.luaSavingRef.current=false;assert.throws(()=>f.scope.commitSnapshot(f.original,'running Lua',f.original,0,{allowLua:true}),/file operation/);f.scope.luaAbortRef.current=null;release.resolve();await opening;
});

 test('new Lua documents also finish activation while rejected native-open grants are releasing',async t=>{
 const f=await harness(t),durable=gate(),releaseSave=gate(),cleanup=gate(),enteredCleanup=gate(),actualSave=f.store.saveDocuments;
 f.store.saveDocuments=async(...args)=>{const result=await actualSave(...args);durable.resolve();await releaseSave.promise;return result;};f.bridge.cancelOpen=async()=>{enteredCleanup.resolve();await cleanup.promise;};
 const running=f.scope.runLua({source:"local second=Sprite(2,2);second.layers[1].name='New Lua document'"});await durable.promise;
 const opening=f.native.acceptOpen({files:[{token:'external',name:'external.aseprite'}]}),rejected=assert.rejects(opening,/Finish the current edit or script/);await enteredCleanup.promise;releaseSave.resolve();
 try {await running;assert.notEqual(f.scope.docRef.current.id,f.original.id);assert.equal(f.scope.docRef.current.layers[0].name,'New Lua document');assert.deepEqual(f.calls,[]);assert.equal((await f.store.loadDocument(f.scope.docRef.current.id)).document.layers[0].name,'New Lua document');}finally{cleanup.resolve();await rejected;}
 f.scope.undo();assert.equal(f.scope.docRef.current.layers[0].name,'Layer 1');f.scope.redo();assert.equal(f.scope.docRef.current.layers[0].name,'New Lua document');
});

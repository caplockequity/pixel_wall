import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { openStore } from '../app/storage.mjs';
import { createDocument, describeDocument, pixelRGBA } from '../app/editor-core.mjs';
import { createHistory, historyValuesEqual } from '../app/history.mjs';
import { createDocumentHistoryCache } from '../app/history-cache.mjs';
import { editorUiContext } from '../app/editor-ui-context.mjs';
import { createDesktopSession } from '../app/desktop-session.mjs';
import { createAsepriteExtensionRegistry } from '../app/aseprite-extensions.mjs';
import { capturePackageRun, packageRunSettings, packagePreferenceKey, assertPackageRunCurrent } from '../app/aseprite-package-session.mjs';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { createCloseController } from '../desktop/editor-controls.mjs';
import { createNativeDocumentSession } from '../app/native-document-session.mjs';

const workbench = await readFile(new URL('../app/workbench.jsx', import.meta.url), 'utf8');
const extract = (start, end) => workbench.slice(workbench.indexOf(start), workbench.indexOf(end, workbench.indexOf(start)));
const source = [extract('  const install = useCallback(', '  const commit = useCallback('), extract('  const activate = useCallback(', '  const newDocument = useCallback('), extract('  function commitSnapshot(', '  function guardScriptInteraction('), extract('  function guardScriptInteraction(', '  async function convertIndexed('), extract('  async function runPackageCommand(', '  async function showRecovery(')].join('\n');
const nativeHooks = extract('      nativePersistImported:', '      nativeImported:');
const recoveryBody = extract('                    if (restoringRef.current || automationRef.current?.desktop.locked', '                  }}\n                >\n                  Restore');
const ref = current => ({current});
const options = {packageId:'host-review',contributionId:'commands'};
const archive = script => zipSync({'package.json':strToU8(JSON.stringify({name:'host-review',displayName:'Host Review',version:'1',contributes:{scripts:[{id:'commands',path:'commands.lua'}]}})), 'commands.lua':strToU8(script)});
const lua = body => `function init(plugin)plugin:newCommand{id='Run',onclick=function()plugin.preferences.runs=(plugin.preferences.runs or 0)+1;${body} end}end`;
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const choose = () => ({action:'run',commandId:'Run'});
async function fixture(t, script, {onCommand = choose, onDialog = () => ({action:'close'})} = {}) {
  const factory = new IDBFactory(), store = await openStore({indexedDB:factory}), other = await openStore({indexedDB:factory});
  t.after(() => {store.close();other.close();});
  const registry = createAsepriteExtensionRegistry(store), otherRegistry = createAsepriteExtensionRegistry(other);
  await registry.install(archive(script));
  const before = createDocument({id:'review-document',width:2,height:2});
  const saved = await store.saveDocument(before);
  const context = editorUiContext(before), host = {
    docRef:ref(before), revisionRef:ref(1), uiContextRef:ref(context), activeRef:ref(context.active),
    storeRef:ref(store), automationRef:ref(null), nativeSessionRef:ref(null), luaAbortRef:ref(null), luaSavingRef:ref(false),
    busyRef:ref(false), operationRef:ref(null), restoringRef:ref(false), historyRef:ref(createHistory(before)), historyCacheRef:ref(createDocumentHistoryCache()),
    documentRevisionsRef:ref(new Map()),pathRef:ref([]),luaRangeRef:ref({}),viewportRef:ref({clientWidth:512,clientHeight:512}),
    saveQueueRef:ref(Promise.resolve()), savedRevisionsRef:ref(new Map([[before.id,saved.revision]])), savedDocumentsRef:ref(new Map([[before.id,before]])), storedRevisionRef:ref(saved.revision), canvasRef:ref(null),
    luaSource:'', luaTimeout:3000, luaDialog:{show:onDialog}, luaCommands:{show:onCommand}, location:{href:'https://pixelwall.example/editor',origin:'https://pixelwall.example'},
    editorUiContext, historyValuesEqual, createHistory, capturePackageRun, packageRunSettings, assertPackageRunCurrent, pixelRGBA, describeDocument,
    useCallback:fn=>fn,clamp:(value,min,max)=>Math.min(max,Math.max(min,value)),
    analyticsRef:ref({recovery(){}}),errors:[],setModal(){},report(error){host.errors.push(error);},
    hex:p=>'#'+p.map(value=>value.toString(16).padStart(2,'0')).join(''),
    setBusy(value){host.busyRef.current=value;}, setLuaSaving(){}, setPlaying(){}, setScriptLanguage(){}, setDocuments(){}, setCommandResult(){}, setNotice(){}, setSaveStatus(){},
    setDoc(){},setHistoryVersion(){},setHistoryState(){},setSelection(){},setActiveFrame(){},setActiveLayer(){},setClipId(){},setSelectedFrames(){},setSelectedLayers(){},setTimelinePage(){},setZoom(){},
    restoreUiContext(value){host.uiContextRef.current=value;},
    runLuaScript(input, settings){const {wasmUri:unused, ...rest}=settings;void unused;return runLuaScript(input,rest);},
  };
  host.save=async()=>({saved:true,document:host.docRef.current,revision:host.revisionRef.current});
  host.doc=before;
  host.automationRef.current = {desktop:createDesktopSession({desktopState:()=>({loaded:true,id:host.docRef.current.id,revision:host.revisionRef.current,canSave:true,busy:host.busyRef.current||!!host.nativeSessionRef.current?.busy||host.restoringRef.current}),save:host.save})};
  // Exercise the current workbench functions with real storage/history/Lua. Only
  // React setters, canvas focus and worker transport are substituted.
  const api = Function('host', `with(host) { ${source};return {runPackageCommand,runLua,guardScriptInteraction,install,commitSnapshot,native:{${nativeHooks}},restore:async(r)=>{${recoveryBody}}}; }`)(host);
  return {host,api,store,other,registry,otherRegistry,before,context};
}

test('actual package host commits preferences and artwork atomically; one Undo restores document/context only', async t => {
  const {host,api,store,before,context} = await fixture(t,lua('app.sprite:newLayer();app.sprite.selection:selectAll();app.fgColor=Color{r=9,g=8,b=7}'));
  await api.runPackageCommand(options);
  assert.equal(host.docRef.current.layers.length,2);assert.equal((await store.loadDocument(before.id)).document.layers.length,2);
  assert.deepEqual((await store.getSetting(packagePreferenceKey(options.packageId))).preferences,{runs:1});
  assert.equal(host.busyRef.current,false);assert.equal(host.luaAbortRef.current,null);assert.equal(host.historyRef.current.canUndo,true);
  host.historyRef.current.undo();assert.deepEqual(host.historyRef.current.present,before);assert.deepEqual(host.historyRef.current.lastContext,context);
  assert.equal(host.historyRef.current.canUndo,false);assert.equal(host.historyRef.current.canRedo,true);
  assert.deepEqual((await store.getSetting(packagePreferenceKey(options.packageId))).preferences,{runs:1});
});

test('a different-window disable or replacement during a nested Dialog cannot commit either result', async t => {
  for (const replacement of [false,true]) {
    let update;
    const {host,api,store,otherRegistry,before} = await fixture(t,lua('app.sprite:newLayer();Dialog():show()'),{onDialog:async()=>{await update();return {action:'close'};}});
    update = replacement ? () => otherRegistry.install(archive(lua("error('replacement')")),{replace:true}) : () => otherRegistry.setEnabled(options.packageId,false);
    await assert.rejects(api.runPackageCommand(options),/package or its preferences changed/);
    assert.equal(host.docRef.current,before);assert.equal((await store.loadDocument(before.id)).revision,1);assert.equal(await store.getSetting(packagePreferenceKey(options.packageId)),null);
    assert.equal(host.historyRef.current.canUndo,false);assert.equal(host.busyRef.current,false);
  }
});

test('different-window preference write immediately before final atomic save rejects artwork too', async t => {
  const {host,api,store,other,before} = await fixture(t,lua('app.sprite:newLayer()'));
  const save = store.saveDocuments; store.saveDocuments = async (...args) => {await other.setSetting(packagePreferenceKey(options.packageId),{version:1,packageId:options.packageId,preferences:{runs:12}});return save(...args);};
  await assert.rejects(api.runPackageCommand(options),{code:'CONFLICT'});
  assert.equal(host.docRef.current,before);assert.equal((await store.loadDocument(before.id)).revision,1);assert.deepEqual((await store.getSetting(packagePreferenceKey(options.packageId))).preferences,{runs:12});
});

test('picker cancel and nested Dialog cancellation preserve Undo/Redo and saved settings', async t => {
  for (const mode of ['picker','abort-dialog','close-dialog']) {
    let host;
    const f = await fixture(t,lua("app.sprite:newLayer();local d=Dialog():button{id='ok'};d:show();if not d.data.ok then error('closed dialog')end"),{
      onCommand:() => mode==='picker'?{action:'cancel'}:choose(), onDialog:() => {if(mode==='abort-dialog'){host.luaAbortRef.current.abort();return new Promise(()=>{});}return {action:'close'};},
    }); host=f.host;
    await assert.rejects(f.api.runPackageCommand(options),/cancelled|closed dialog/);
    assert.equal(host.docRef.current,f.before);assert.equal(host.historyRef.current.canUndo,false);assert.equal(host.historyRef.current.canRedo,false);
    assert.equal(await f.store.getSetting(packagePreferenceKey(options.packageId)),null);assert.equal(host.busyRef.current,false);
  }
});

test('busy Lua controls permit only script UI and a second run cannot release the first busy lock', async t => {
  let answer;
  const {host,api} = await fixture(t,lua(''),{onCommand:()=>new Promise(resolve=>{answer=resolve;})});
  const running=api.runPackageCommand(options);while(!answer)await pause(5);
  let stopped=0;api.guardScriptInteraction({target:{closest:()=>null},preventDefault:()=>stopped++,stopPropagation:()=>stopped++});assert.equal(stopped,2);
  api.guardScriptInteraction({target:{closest:()=>({})},preventDefault:()=>stopped++,stopPropagation:()=>stopped++});assert.equal(stopped,2);
  await assert.rejects(api.runLua({source:''}),/Finish the current operation/);assert.equal(host.busyRef.current,true);
  answer(choose());await running;assert.equal(host.busyRef.current,false);
});

test('close during atomic save allows tracked result/history installation but cannot close without a user decision', async t => {
  const {host,api,store,before} = await fixture(t,lua('app.sprite:newLayer()'));
  let chooseClose,closing,closed=0;const prepared=[];
  const close=createCloseController({prepare:async id=>{const result=await host.automationRef.current.desktop.prepareClose(id);prepared.push(result);return result;},cancel:id=>host.automationRef.current.desktop.cancelClose(id),confirmDiscard:()=>new Promise(resolve=>{chooseClose=resolve;}),close:()=>closed++});
  const save=store.saveDocuments;store.saveDocuments=async(...args)=>{closing=close.request();while(!chooseClose)await pause(1);return save(...args);};
  await api.runPackageCommand(options);
  assert.equal(prepared[0].status,'blocked');assert.equal(closed,0);assert.equal(close.getState(),'confirming');assert.equal(host.automationRef.current.desktop.locked,true);
  assert.equal(host.docRef.current.layers.length,2);assert.equal(host.historyRef.current.canUndo,true);assert.equal(host.revisionRef.current,2);
  assert.equal((await store.loadDocument(before.id)).document.layers.length,2);assert.deepEqual((await store.getSetting(packagePreferenceKey(options.packageId))).preferences,{runs:1});
  await assert.rejects(api.runLua({source:''}),/Finish the close dialog/);
  chooseClose(false);await closing;assert.equal(closed,0);assert.equal(host.automationRef.current.desktop.locked,false);
  await close.request();assert.equal(prepared[1].status,'ready');assert.equal(prepared[1].revision,2);assert.equal(closed,1);
});

test('tracked durable generated-document activation also finishes beneath a blocked close prompt', async t => {
  const {host,api,store,before}=await fixture(t,lua("local made=Sprite(2,2);made:newLayer();made.selection:selectAll()"));
  const save=store.saveDocuments;store.saveDocuments=async(...args)=>{await host.automationRef.current.desktop.prepareClose('generated-save');return save(...args);};
  await api.runPackageCommand(options);
  assert.notEqual(host.docRef.current.id,before.id);assert.equal(host.docRef.current.layers.length,2);assert.equal((await store.listDocuments()).length,2);
  assert.equal(host.automationRef.current.desktop.locked,true);assert.equal(host.historyRef.current.canUndo,true);host.historyRef.current.undo();assert.equal(host.historyRef.current.present.layers.length,1);
});

test('allowLua alone cannot bypass close lock and tracked commit still enforces original document revision', async t=>{
  const {host,api,before}=await fixture(t,lua(''));await host.automationRef.current.desktop.prepareClose('guard');
  assert.throws(()=>api.install(before,{allowLua:true}),/Finish the close dialog/);
  host.luaAbortRef.current=new AbortController();assert.throws(()=>api.install(before,{allowLua:true}),/Finish the close dialog/);
  host.luaSavingRef.current=true;
  assert.throws(()=>api.commitSnapshot(before,'stale',before,0,{allowLua:true}),/project changed/);
  assert.throws(()=>api.commitSnapshot(before,'ordinary',before,1),/Finish the close dialog/);
  host.luaAbortRef.current=null;assert.throws(()=>api.install(before,{allowLua:true}),/Finish the close dialog/);
  assert.throws(()=>api.install(before,{allowNative:true}),/Finish the close dialog/);assert.throws(()=>api.install(before,{allowRecovery:true}),/Finish the close dialog/);
});

test('native Open that already persisted/bound a file completes activation under a blocked close',async t=>{
  const {host,api,store,before}=await fixture(t,lua(''));let bound,closeResult;
  const bridge={bindOpen:async request=>{bound=request;closeResult=await host.automationRef.current.desktop.prepareClose('native-bind');return {status:'bound',documentId:request.documentId};},cancelOpen:async()=>{throw Error('Successful import must not be cancelled');}};
  const session=createNativeDocumentSession(bridge,{flushRecovery:api.native.nativeFlushRecovery,persistImported:api.native.nativePersistImported,activate:api.native.nativeActivate,decode:async()=>({document:createDocument({width:3,height:3})})});
  host.nativeSessionRef.current=session;
  assert.equal((await session.acceptOpen({files:[{token:'picked-file',name:'Picked.pixelwall'}]})).status,'opened');
  assert.equal(closeResult.status,'blocked');assert.equal(host.docRef.current.id,bound.documentId);assert.notEqual(host.docRef.current.id,before.id);
  assert.equal((await store.loadDocument(bound.documentId)).document.width,3);assert.equal(host.automationRef.current.desktop.locked,true);assert.equal(session.busy,false);
});

test('a new native Open delivered after the close lock cannot persist, bind or activate',async t=>{
  const {host,api,before}=await fixture(t,lua(''));await host.automationRef.current.desktop.prepareClose('already-closing');let persisted=0,cancelled=0;
  const session=createNativeDocumentSession({cancelOpen:async()=>cancelled++},{flushRecovery:api.native.nativeFlushRecovery,persistImported:()=>persisted++,activate:api.native.nativeActivate});host.nativeSessionRef.current=session;
  await assert.rejects(session.acceptOpen({files:[{token:'late-open'}]}),/Finish the close dialog/);
  assert.equal(persisted,0);assert.equal(cancelled,1);assert.equal(host.docRef.current,before);
});

test('recovery that already persisted a revision completes activation under a blocked close',async t=>{
  const {host,api,store,before}=await fixture(t,lua(''));
  const newer={...before,name:'Newer name'};const saved=await store.saveDocument(newer,{expectedRevision:1});api.install(newer,{resetHistory:true,storedRevision:saved.revision});host.doc=newer;
  const restore=store.restoreRevision;let closeResult;store.restoreRevision=async(...args)=>{const restored=await restore(...args);closeResult=await host.automationRef.current.desktop.prepareClose('restored-saving');return restored;};
  await api.restore({id:`${before.id}:1`});
  assert.equal(closeResult.status,'blocked');assert.equal(host.docRef.current.name,before.name);assert.equal(host.storedRevisionRef.current,3);
  assert.equal(host.restoringRef.current,false);assert.equal(host.automationRef.current.desktop.locked,true);assert.equal((await store.loadDocument(before.id)).document.name,before.name);
});

test('recovery blocks competing installs and rejects a changed source before durable restoration',async t=>{
  const {host,api,store,before}=await fixture(t,lua(''));let restored=0;
  host.save=async()=>{assert.throws(()=>api.install(before),/current recovery/);host.revisionRef.current++;return {saved:true};};store.restoreRevision=async()=>restored++;
  await api.restore({id:`${before.id}:1`});assert.match(host.errors[0].message,/project changed while preparing recovery/);
  assert.equal(restored,0);assert.equal(host.restoringRef.current,false);assert.equal(host.busyRef.current,false);
});

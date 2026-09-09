import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { openStore } from '../app/storage.mjs';
import { createDocument } from '../app/editor-core.mjs';
import { createAsepriteExtensionRegistry } from '../app/aseprite-extensions.mjs';
import { capturePackageRun, packageRunSettings, packagePreferenceKey } from '../app/aseprite-package-session.mjs';
const archive = source => zipSync({'package.json':strToU8(JSON.stringify({name:'package-session-qa',displayName:'Package session QA',version:'1.0',contributes:{scripts:[{id:'commands',path:'commands.lua'}]}})), 'commands.lua':strToU8(source)});
async function setup(t) {const store=await openStore({indexedDB:new IDBFactory()});t.after(()=>store.close());const registry=createAsepriteExtensionRegistry(store);await registry.install(archive('error("capture must never execute source")'));return {store,registry};}
const requested={packageId:'package-session-qa',contributionId:'commands'};
test('package capture is inert and preferences commit with its artwork',async t=>{
 const {store}=await setup(t),captured=await capturePackageRun(store,requested);
 assert.match(captured.source,/capture must never execute/);assert.deepEqual(captured.plugin.preferences,{});
 const result={name:captured.plugin.name,version:captured.plugin.version,preferences:{runs:1},preferencesChanged:true};
 await store.saveDocuments([{document:createDocument({id:'result',width:2,height:2})}],{settings:packageRunSettings(captured,result)});
 const again=await capturePackageRun(store,requested);assert.deepEqual(again.plugin.preferences,{runs:1});assert.equal((await store.loadDocument('result')).revision,1);
});
test('disabled or replaced packages reject pending command commits without saving preferences',async t=>{
 const {store,registry}=await setup(t),captured=await capturePackageRun(store,requested),doc=createDocument({id:'stale',width:2,height:2});
 const settings=packageRunSettings(captured,{name:captured.plugin.name,version:captured.plugin.version,preferences:{runs:1},preferencesChanged:true});
 await registry.setEnabled(requested.packageId,false);
 await assert.rejects(capturePackageRun(store,requested),/Enable/);
 await assert.rejects(store.saveDocuments([{document:doc}],{settings}),{code:'CONFLICT'});
 assert.equal(await store.loadDocument(doc.id),null);assert.equal(await store.getSetting(packagePreferenceKey(requested.packageId)),null);
 await registry.setEnabled(requested.packageId,true);const renewed=await capturePackageRun(store,requested);
 await registry.install(archive('function init() end'),{replace:true});
 await assert.rejects(store.saveDocuments([{document:doc}],{settings:packageRunSettings(renewed,{name:renewed.plugin.name,version:renewed.plugin.version,preferences:{},preferencesChanged:false})}),{code:'CONFLICT'});
});
test('invalid saved preferences and stale or mismatched identities fail explicitly',async t=>{
 const {store}=await setup(t);await store.setSetting(packagePreferenceKey(requested.packageId),{version:1,packageId:'another',preferences:{}});
 await assert.rejects(capturePackageRun(store,requested),/preferences are invalid/);
 await store.deleteSetting(packagePreferenceKey(requested.packageId));const captured=await capturePackageRun(store,requested);
 assert.throws(()=>packageRunSettings(captured,{name:'another',version:'1.0',preferencesChanged:true}),/invalid identity/);
 await assert.rejects(capturePackageRun(store,{...requested,contributionId:'missing'}),/no longer available/);
 assert.throws(()=>packagePreferenceKey('../bad'),/identity/);
});

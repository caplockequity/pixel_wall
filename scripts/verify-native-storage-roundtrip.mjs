import {app, BrowserWindow, protocol, net, ipcMain} from 'electron';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createNativeFileIpc} from '../desktop/native-file-ipc.mjs';
import {createNativeBindingStore} from '../desktop/native-files.mjs';
import {renderFrame} from '../app/editor-core.mjs';
import {decodeProjectContainer} from '../app/project-format.mjs';
// Run after build:standalone with Electron and --output <disposable build directory>.
const outputIndex=process.argv.indexOf('--output');
assert.ok(outputIndex>=0 && process.argv[outputIndex+1], 'Pass --output with a disposable build directory.');
const outputRoot=resolve(process.argv[outputIndex+1]);mkdirSync(outputRoot,{recursive:true});
const root=mkdtempSync(join(outputRoot,'native-storage-'));
const source=fileURLToPath(new URL('../',import.meta.url));
const appIndex=process.argv.indexOf('--app-root');
const appRoot=appIndex>=0?resolve(process.argv[appIndex+1]):join(source,'desktop/app');
const userData=join(root,'roundtrip-data'), bindingPath=join(root,'roundtrip-bindings.json'), output=join(root,'roundtrip.pixelwall');
mkdirSync(userData,{recursive:true});
app.setPath('userData',userData);app.on('window-all-closed',()=>{});
protocol.registerSchemesAsPrivileged([{scheme:'pixelwall',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
let win,ipc;const report={};const deadline=setTimeout(()=>{console.error('TEST TIMEOUT');win?.destroy();app.exit(1);},60000);
void app.whenReady().then(async()=>{
 try {
  protocol.handle('pixelwall',request=>{const url=new URL(request.url);const path=['/','/editor'].includes(url.pathname)?join(appRoot,'index.html'):resolve(appRoot,'.'+url.pathname);return net.fetch(pathToFileURL(path).href);});
  ipcMain.handle('pixelwall:mcp:status',()=>({enabled:false}));
  ipc=createNativeFileIpc({ipcMain,dialog:{showSaveDialog:async()=>({canceled:false,filePath:output}),showMessageBox:async()=>({response:0}),showOpenDialog:async()=>({canceled:true,filePaths:[]})},store:createNativeBindingStore(bindingPath)});
  async function open(){win=new BrowserWindow({show:false,webPreferences:{preload:join(source,'desktop/native-preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});const binding=ipc.attach(win);await win.loadURL('pixelwall://app/editor');for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript('(()=>{try{return !!window.pixelwall?.inspect().document?.id}catch{return false}})()'))break;await new Promise(r=>setTimeout(r,50));}return binding;}
  let binding=await open();const js=code=>win.webContents.executeJavaScript('(async()=>{try{return {ok:true,value:await ('+code+')}}catch(error){return {ok:false,error:error.message,stack:error.stack}}})()').then(result=>{if(!result.ok)throw Error(result.error+'\n'+result.stack);return result.value;});
  await new Promise(r=>setTimeout(r,1100));
  report.initial=await js('window.pixelwall.inspect()');
  report.baseline=await js('window.pixelwall.save()');assert.equal(report.baseline.saved,true);
  await js(`new Promise((resolve,reject)=>{const req=indexedDB.open('pixelwall-library-v4');req.onsuccess=()=>{const db=req.result,tx=db.transaction('revisions','readwrite');tx.objectStore('revisions').put({id:'quota-fixture',documentId:'budget-fixture',bytes:100663296,imageRefs:{},metadata:{name:'Protected quota fixture',frames:[],layers:[]},revision:1,pinned:true,updatedAt:Date.now()});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})`);
  report.edit=await js(`window.pixelwall.apply({commands:[{type:'draw.rect',x:0,y:0,width:4,height:4,filled:true,color:'#ff0000ff'}]})`);
  report.failedLibrary=await js('window.pixelwall.save().catch(error=>({failed:true,message:error.message}))');assert.equal(report.failedLibrary.failed,true);
  report.saveAs=await js(`window.pixelwall.desktop.action('saveAs')`);
  report.persistence=await js('window.pixelwall.persistence()');assert.equal(report.persistence.mode,'file');
  report.firstClose=await js(`window.pixelwall.desktop.prepareClose('roundtrip-first')`);assert.equal(report.firstClose.status,'ready');assert.equal((await binding.verifyClose(report.firstClose)).status,'ready');
  const disk=decodeProjectContainer(await readFile(output));assert.equal(Object.keys(disk.images).length,1);assert.deepEqual(Array.from(renderFrame(disk).slice(0,4)),[255,0,0,255]);
  win.destroy();win=null;binding=await open();await new Promise(r=>setTimeout(r,1000));
  report.reopened=await js('window.pixelwall.inspect()');assert.equal(report.reopened.document.images,1);assert.equal(report.reopened.document.id,report.initial.document.id);
  report.reopenedPersistence=await js('window.pixelwall.persistence()');assert.equal(report.reopenedPersistence.mode,'file');
  report.libraryHead=await js(`new Promise((resolve,reject)=>{const req=indexedDB.open('pixelwall-library-v4');req.onsuccess=()=>{const db=req.result,tx=db.transaction('documents','readonly'),item=tx.objectStore('documents').get(window.pixelwall.inspect().document.id);item.onsuccess=()=>resolve(item.result);item.onerror=()=>reject(item.error);tx.oncomplete=()=>db.close()}})`);assert.equal(Object.keys(report.libraryHead.imageRefs).length,0,'Original library backup remains intact');
  report.secondClose=await js(`window.pixelwall.desktop.prepareClose('roundtrip-second')`);assert.equal(report.secondClose.status,'ready');assert.equal((await binding.verifyClose(report.secondClose)).status,'ready');
  assert.deepEqual(renderFrame(decodeProjectContainer(await readFile(output))),renderFrame(disk),'Reopened artwork must match the saved pixels');
  report.result='passed';console.log('Report: '+join(root,'roundtrip-report.json'));console.log('PASS: full library -> Save As -> verified close -> reopen native pixels over intact older library -> verified close');
 }catch(error){report.result='failed';report.error=error.stack;console.error(error);process.exitCode=1;}
 finally{await writeFile(join(root,'roundtrip-report.json'),JSON.stringify(report,null,2));win?.destroy();ipc?.dispose();clearTimeout(deadline);app.exit(report.result==='passed'?0:1);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {EventEmitter} from 'node:events';
import {hostedDestination,installHostedLinks} from '../standalone/navigation.mjs';
const storefront='https://private.pixelwall.example';
for(const path of ['/','/guides/scripting','/editor/classic'])test(`real hosted destination for ${path}`,()=>assert.equal(hostedDestination(path,storefront),storefront+path));
test('preserves download blobs, anchors, mail and already-external links',()=>{for(const href of ['blob:local/art','#canvas','mailto:contact@caplock.ai','https://other.example/','//other.example'])assert.equal(hostedDestination(href,storefront),null);});
test('rewrites initial and newly mounted anchors while keeping safe existing rel values',()=>{
 function anchor(href,rel=''){const attrs={href,rel};return{matches:()=>true,querySelectorAll:()=>[],getAttribute:key=>attrs[key]??null,setAttribute:(key,value)=>attrs[key]=value,attrs};}
 const home=anchor('/','author'),doc={documentElement:{},querySelectorAll:()=>[home]};let callback,disconnected=false;
 class Observer{constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}}
 const cleanup=installHostedLinks(doc,storefront,Observer);assert.equal(home.attrs.href,storefront+'/');assert.equal(home.attrs.target,'_blank');assert.equal(home.attrs.rel,'author noopener noreferrer');
 const scripting=anchor('/guides/scripting');callback([{type:'childList',addedNodes:[scripting]}]);assert.equal(scripting.attrs.href,storefront+'/guides/scripting');
 home.attrs.href='/editor/classic';callback([{type:'attributes',target:home}]);assert.equal(home.attrs.href,storefront+'/editor/classic');cleanup();assert.equal(disconnected,true);
});
test('desktop second instance recreates a previously closed window',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'pixelwall-desktop-mock-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const app=new EventEmitter();Object.assign(app,{setName(){},setPath(){},getVersion:()=>"0.2.0",getPath:()=>folder,isReady:()=>true,isPackaged:false,requestSingleInstanceLock:()=>true,quit(){},whenReady:async()=>{}});
 const windows=[];class BrowserWindow extends EventEmitter{constructor(){super();this.destroyed=false;this.webContents=Object.assign(new EventEmitter(),{id:windows.length+1,setWindowOpenHandler(){},send(){}});windows.push(this);}static getAllWindows(){return windows.filter(window=>!window.destroyed);}loadURL(){return Promise.resolve();}isDestroyed(){return this.destroyed;}isMinimized(){return false;}show(){assert.equal(this.destroyed,false);}focus(){assert.equal(this.destroyed,false);}}
 globalThis.__pixelwallElectronMock={app,BrowserWindow,ipcMain:{handle(){},removeHandler(){},on(){},removeListener(){}},Menu:{buildFromTemplate:template=>template,setApplicationMenu(){}},protocol:{registerSchemesAsPrivileged(){},handle(){}},net:{},shell:{},session:{defaultSession:{setPermissionRequestHandler(){}}},dialog:{showErrorBox(title,message){throw Error(`${title}: ${message}`);}}};t.after(()=>delete globalThis.__pixelwallElectronMock);
 const source=(await readFile(new URL('../desktop/main.mjs',import.meta.url),'utf8')).replace(/import \{([^}]+)\} from 'electron';/,"const {$1} = globalThis.__pixelwallElectronMock;");const path=join(folder,'main.mjs');await writeFile(path,source.replace(/from '(\.\/[^']+\.mjs)'/g,(_match,name)=>`from ${JSON.stringify(new URL('../desktop/'+name.slice(2),import.meta.url).href)}`));await import(pathToFileURL(path));await Promise.resolve();
 assert.equal(windows.length,1);windows[0].destroyed=true;assert.doesNotThrow(()=>app.emit('second-instance', {}, []));assert.equal(windows.length,2);
});

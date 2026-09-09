import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {runLuaScript} from '../app/lua-runner-node.mjs';
import {runLuaScript as runBrowser} from '../app/lua-runner-browser.mjs';
import {createDocument,applyCommand,renderFrame,normalizeDocument} from '../app/editor-core.mjs';
import {readAseprite} from '../app/formats.mjs';
import {validateLuaResult} from '../app/lua-session.mjs';
const fixture=name=>readFileSync(new URL(`./fixtures/${name}`,import.meta.url));
const source=fixture('lua-image-spec-oracle.lua').toString();
const native=JSON.parse(fixture('lua-image-spec-native.json'));
const sample=()=>applyCommand(createDocument({width:2,height:2}),{type:'cel.set',width:2,height:2,pixels:['#80502863',null,null,null]});

test('real Lua matches original native ImageSpec constructor, profile, mask, clone and owner-copy fixture',async()=>{
  const r=await runLuaScript({source});assert.deepEqual(r.prints,native.prints);validateLuaResult(r);
});

test('spec creation and mutation leave owners unchanged and produce no artwork transaction',async()=>{
  const document=sample(),before=structuredClone(document);
  const r=await runLuaScript({document,source:`local a=app.sprite.spec;local b=app.image.spec;local c=ImageSpec(a);assert(a==b and a==c);a.width=3;b.transparentColor=123;c.colorSpace=ColorSpace();local d=Image(c);assert(d.spec.colorSpace==ColorSpace());assert(app.sprite.width==2 and app.image.spec.transparentColor==0);assert(not pcall(function()app.image.spec=c end));assert(not pcall(function()app.sprite.spec=c end))`});
  assert.deepEqual(document,before);assert.deepEqual(r.document,document);assert.deepEqual(r.transactions,[]);
});

test('retained ICC spec creates a new profiled sprite through normal replay and permits real conversion',async()=>{
  const document=sample();document.metadata.aseprite={colorProfile:{type:2,flags:0,gamma:0,icc:[...fixture('aseprite-oracle/audit-synthetic-rgb.icc')]}};
  const r=await runLuaScript({document,source:`local original=app.sprite;local spec=original.spec;local new=Sprite(spec);assert(new.colorSpace==original.colorSpace);app.image:drawPixel(0,0,app.pixelColor.rgba(128,80,40,99));new:convertColorSpace(ColorSpace{sRGB=true});assert(app.image:getPixel(0,0)==1665161882);assert(original.colorSpace==spec.colorSpace)`});
  assert.equal(r.documents.length,2);assert.deepEqual(r.documents.find(d=>d.id===document.id),document);assert.equal(Object.values(r.document.images)[0].pixels[0],'#9a5a4063');validateLuaResult(r,document);
});

test('spec profile and mask overrides restore through nested rollback and original converted handles revive',async()=>{
  const document=sample(),before=structuredClone(document);
  const r=await runLuaScript({document,source:`local sprite=app.sprite;local image=app.image;local originalSpec=image.spec;local converted
    assert(not pcall(function()app.transaction(function()
      sprite.cels[1].image=Image(2,2);assert(app.image.spec.colorSpace==ColorSpace())
      sprite:assignColorSpace(ColorSpace());assert(app.image.spec.colorSpace.name=='None')
      app.transaction(function()sprite:convertColorSpace(ColorSpace{sRGB=true});converted=app.image;error('rollback nested')end)
    end)end))
    assert(image.spec==originalSpec and sprite.colorSpace==ColorSpace{sRGB=true})
    assert(not pcall(function()return converted.spec end));assert(app.image.spec.colorSpace.name=='sRGB')
  `});
  assert.deepEqual(r.document,before);assert.deepEqual(r.transactions,[]);validateLuaResult(r,document);
});

test('a returned spec remains usable after its image handle is retired; detached image edits remain isolated',async()=>{
  const document=sample();const r=await runLuaScript({document,source:`local image=app.image;local spec=image.spec;app.sprite:convertColorSpace(ColorSpace());assert(not pcall(function()return image.spec end));local independent=Image(spec);assert(independent.spec==spec);independent:clear(Color{r=99});assert(app.image:getPixel(0,0)~=independent:getPixel(0,0))`});validateLuaResult(r,document);
});

test('indexed Image(spec) can use its complete byte mask while the active sprite has a short palette',async()=>{
  const document=createDocument({width:1,height:1,palette:['#000000ff','#ffffffff']});
  const r=await runLuaScript({document,source:`local spec=ImageSpec{width=2,height=1,colorMode=ColorMode.INDEXED,transparentColor=255};local i=Image(spec);assert(i:getPixel(0,0)==255 and i:isEmpty());i:drawPixel(0,0,254);assert(i:getPixel(0,0)==254);i:clear();assert(i:getPixel(0,0)==255);local s=Sprite(spec);assert(s.transparentColor==255 and app.image:getPixel(0,0)==0)`});
  assert.equal(r.document.metadata.aseprite.transparentIndex,255);assert.equal(renderFrame(r.document)[3],255);validateLuaResult(r,document);
});

test('tile image specs keep independent None profiles through document profile changes',async()=>{
  const document=normalizeDocument(readAseprite(fixture('aseprite-oracle/2x2tilemap2x2tile.aseprite')).document);
  const r=await runLuaScript({document,source:`local image=app.sprite.tilesets[1]:tile(1).image;local spec=image.spec;assert(spec.colorSpace==ColorSpace() and spec.colorSpace.name=='');app.sprite:assignColorSpace(ColorSpace{sRGB=true});assert(image.spec.colorSpace==ColorSpace() and image.spec==spec)`});validateLuaResult(r,document);
});

test('numeric spec bounds and unknown modes fail before sprite publication; a later valid constructor still works',async()=>{
  const r=await runLuaScript({source:`
    for _,spec in ipairs{ImageSpec{width=2049},ImageSpec{width=2048,height=2048},ImageSpec{colorMode=ColorMode.TILEMAP},ImageSpec{colorMode=3},ImageSpec{colorMode=ColorMode.INDEXED,transparentColor=256}}do
      assert(not pcall(function()Image(spec)end));assert(not pcall(function()Sprite(spec)end))
    end
    local negative=ImageSpec{width=-2,height=0};assert(Image(negative).width==1);assert(not pcall(function()Sprite(negative)end))
    assert(not pcall(function()ImageSpec{width=math.huge}end));assert(not pcall(function()ImageSpec{height=0/0}end))
    assert(not pcall(function()ImageSpec().colorSpace=nil end));assert(not pcall(function()ImageSpec().garbage=1 end));assert(not pcall(function()return ImageSpec{width=1}.garbage end))
    local s=Sprite(ImageSpec());assert(s.width==1)
  `});assert.equal(r.documents.length,1);validateLuaResult(r);
});

test('gray profile cannot instantiate an RGB sprite and does not leave a partial generated document',async()=>{
  const vectors=JSON.parse(fixture('aseprite-oracle/lua-color-space-conversions.json'));const document=createDocument({width:1,height:1,colorMode:'grayscale'});document.metadata.aseprite={colorProfile:{type:2,flags:0,gamma:0,icc:[...Buffer.from(vectors.grayICC.base64,'base64')]}};
  const r=await runLuaScript({document,source:`local spec=app.sprite.spec;spec.colorMode=ColorMode.RGB;assert(not pcall(function()Sprite(spec)end));assert(app.sprite.colorMode==ColorMode.GRAY)`});assert.equal(r.documents.length,1);assert.deepEqual(r.document,document);
});

test('spec and pixel allocation budgets remain terminal even when script catches failures',async()=>{
  await assert.rejects(runLuaScript({source:'for i=1,2049 do ImageSpec() end'}),/ImageSpec value limit/);
  await assert.rejects(runLuaScript({source:'local spec=ImageSpec{width=1024,height=1024};for i=1,6 do pcall(function()Image(spec)end)end'}),/allocation budget|execution budget/);
});

test('the real browser worker supports the same ImageSpec fixture and validates generated documents',async t=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{configurable:true,value:{href:'https://pixelwall.example/editor',origin:'https://pixelwall.example'}});t.after(()=>prior?Object.defineProperty(globalThis,'location',prior):delete globalThis.location);
  const createWorker=()=>{const w=new Worker(new URL('./fixtures/lua-dialog-browser-worker.mjs',import.meta.url),{execArgv:[]});const bridge={postMessage:m=>w.postMessage(m),terminate:()=>w.terminate()};w.on('message',data=>bridge.onmessage?.({data}));w.on('error',e=>bridge.onerror?.(e));return bridge;};
  const r=await runBrowser({source},{wasmUri:'/runtimes/lua.wasm',createWorker});assert.deepEqual(r.prints,native.prints);
});

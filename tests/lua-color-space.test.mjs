import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { runLuaScript as runBrowser } from '../app/lua-runner-browser.mjs';
import { createDocument, applyCommand, normalizeDocument } from '../app/editor-core.mjs';
import { readAseprite } from '../app/formats.mjs';
import { validateLuaResult } from '../app/lua-session.mjs';
import { normalizeColorProfile } from '../app/color-profile-command.mjs';
const fixture = name => readFileSync(new URL(`./fixtures/aseprite-oracle/${name}`, import.meta.url));
const profile = {type:2,flags:0,gamma:0,icc:[...fixture('audit-synthetic-rgb.icc')]};
const vectors=JSON.parse(fixture('lua-color-space-conversions.json'));
const srgb = {type:1,flags:0,gamma:0};
function sample(colorMode='rgba', working=profile) {
  let d=createDocument({width:2,height:1,colorMode,palette:['#00000000','#808080dc']});
  d=applyCommand(d,{type:'cel.set',width:2,height:1,pixels:colorMode==='indexed'?[1,0]:colorMode==='grayscale'?['#80808063',null]:['#80502863',null]});
  d.metadata.aseprite={colorProfile:structuredClone(working)};return d;
}
const pixels = d=>Object.values(d.images).find(i=>!i.tilemap).pixels;
const run = (document,source)=>runLuaScript({document,source});

test('native oracle constructor, equality, detached names and assignments match in real Lua',async()=>{
  const oracle=JSON.parse(fixture('lua-color-space.json'));
  const result=await runLuaScript({source:fixture('lua-color-space.lua').toString()});
  assert.deepEqual(result.prints,oracle.prints);validateLuaResult(result);
});

for(const [mode,expected,palette] of [['rgba',vectors.rgb.pixel,vectors.indexed.paletteOutput],['grayscale',vectors.grayscale.pixel,vectors.indexed.paletteInput],['indexed',vectors.indexed.index,vectors.indexed.paletteOutput]])test(`${mode} native ICC conversion vector, alpha and storage mode replay exactly`,async()=>{
  const document=sample(mode),before=structuredClone(document);
  const result=await run(document,`local s=app.sprite;local source=s.colorSpace;assert(source.name=='Custom Profile');assert(s:convertColorSpace(ColorSpace{sRGB=true}));assert(s.colorSpace.name=='sRGB')`);
  assert.equal(result.document.colorMode,mode);assert.equal(pixels(result.document)[0],expected);assert.equal(result.document.palette[1],palette);
  assert.deepEqual(document,before);validateLuaResult(result,document);assert.ok(result.transactions.some(t=>t.commands.some(c=>c.type==='document.colorProfile')));
});

test('assignment preserves bytes and existing image handles; None conversion preserves bytes',async()=>{
  const document=sample();const result=await run(document,`local s=app.sprite;local image=app.image;local before=image.bytes;local copy=Image(image);local c=ColorSpace();c.name='Unmanaged';s.colorSpace=c;c.name='Detached';assert(s.colorSpace.name=='Unmanaged' and image.bytes==before);s:convertColorSpace(ColorSpace{sRGB=true});assert(app.image.bytes==before and copy.bytes==before);assert(not pcall(function()return image.bytes end))`);
  assert.deepEqual(pixels(result.document),pixels(document));validateLuaResult(result,document);
});

test('buffered writes flush before ICC conversion and linked cel identity is preserved',async()=>{
  let document=sample();document=applyCommand(document,{type:'frame.duplicate',frameId:document.frames[0].id,linked:true});
  const result=await run(document,`local s=app.sprite;local i=s.cels[1].image;i:drawPixel(1,0,app.pixelColor.rgba(128,80,40,99));s:convertColorSpace(ColorSpace{sRGB=true});assert(s.cels[1].image==s.cels[2].image)`);
  assert.deepEqual(pixels(result.document),['#9a5a4063','#9a5a4063']);
  assert.equal(result.document.frames[0].cels['layer-1'].imageId,result.document.frames[1].cels['layer-1'].imageId);validateLuaResult(result,document);
});

test('raster handles restore through failed nested conversion; discarded generations never revive',async()=>{
  const result=await run(sample(),`local s=app.sprite;local original=app.image;local before=original.bytes;local later,firstRead
    assert(not pcall(function()app.transaction(function()
      firstRead=s.cels[1].image;s:convertColorSpace(ColorSpace{sRGB=true});later=app.image
      assert(not pcall(function()return original.bytes end))
      app.transaction(function()s:convertColorSpace(ColorSpace());error('nested')end)
    end)end))
    assert(original.bytes==before and firstRead.bytes==before);assert(not pcall(function()return later.bytes end))
    s:convertColorSpace(ColorSpace{sRGB=true});assert(not pcall(function()return later.bytes end))
    assert(not pcall(function()return original.bytes end));assert(app.image:getPixel(0,0)==1665161882)
  `);assert.equal(pixels(result.document)[0],'#9a5a4063');
});

test('first raster handle obtained inside failed transaction remains usable for original image',async()=>{
  const result=await run(sample(),`local image;assert(not pcall(function()app.transaction(function()image=app.image;error('stop')end)end));assert(image:getPixel(0,0)==1663586432);image:drawPixel(1,0,Color{r=10})`);
  assert.equal(pixels(result.document)[1],'#0a0000ff');
});

test('frame palettes are converted without creating overrides or breaking indexed links',async()=>{
  const d=sample('indexed');d.frames[0].palette=[...d.palette];
  const r=await run(d,'app.sprite:convertColorSpace(ColorSpace{sRGB=true})');
  assert.deepEqual(r.document.frames[0].palette,['#00000000','#929292dc']);assert.deepEqual(pixels(r.document),[1,0]);validateLuaResult(r,d);
});

test('fixed gamma is loaded in isolated runtime and profile values are detached copies',async()=>{
  const d=sample('rgba',{type:1,flags:1,gamma:1});pixels(d)[0]='#80808063';
  const r=await run(d,`local s=app.sprite;local cs=s.colorSpace;assert(cs.name=='Linear Transfer with sRGB Gamut');s:convertColorSpace(ColorSpace{sRGB=true});local t=Sprite(1,1);t.colorSpace=ColorSpace(cs);assert(t.colorSpace==cs)`);
  assert.equal(pixels(r.documents.find(x=>x.id===d.id))[0],'#bcbcbc63');validateLuaResult(r,d);
});

test('native tile images remain live and tilemap artwork stays unchanged during color conversion',async()=>{
  const d=normalizeDocument(readAseprite(fixture('2x2tilemap2x2tile.aseprite')).document);d.metadata.aseprite.colorProfile=structuredClone(profile);
  const r=await run(d,`local s=app.sprite;local tile=s.tilesets[1]:tile(1).image;local pixels=tile.bytes;s:convertColorSpace(ColorSpace{sRGB=true});assert(tile.bytes==pixels);assert(s.tilesets[1]:tile(1).image==tile)`);
  assert.deepEqual(r.document.images,d.images);validateLuaResult(r,d);
});

test('locked layers, unsupported file capability and unrecognized ColorSpace members fail atomically',async()=>{
  const d=sample();d.layers[0].locked=true;const before=structuredClone(d);
  await assert.rejects(run(d,'app.sprite:convertColorSpace(ColorSpace{sRGB=true})'),/Unlock every layer/);assert.deepEqual(d,before);
  for(const source of ["ColorSpace{fromFile='/tmp/private.icc'}",'print(ColorSpace().icc)','ColorSpace().icc={}'])await assert.rejects(runLuaScript({source}),/file|Unsupported ColorSpace/);
  await assert.rejects(runLuaScript({source:'for i=1,513 do ColorSpace() end'}),/ColorSpace value limit/);
});

test('profile command rejects forged structure, image IDs and incompatible modes without mutation',()=>{
  const d=sample(),before=structuredClone(d),image=Object.keys(d.images)[0];
  const valid={type:'document.colorProfile',profile:srgb,replacements:{images:[{id:image,pixels:[...pixels(d)]}],palette:[...d.palette],framePalettes:[]}};
  for(const change of [c=>c.extra=true,c=>c.replacements.images[0].id='missing',c=>c.replacements.images[0].width=2,c=>c.replacements.images[0].pixels=[],c=>c.replacements.palette=[],c=>c.replacements.framePalettes=[{frameId:d.frames[0].id,palette:d.palette}],c=>c.profile={...profile,icc:[...profile.icc.slice(0,-1)]}]){
    const command=structuredClone(valid);change(command);assert.throws(()=>applyCommand(d,command));assert.deepEqual(d,before);
  }
  assert.throws(()=>applyCommand(sample('indexed'),valid),/preserve pixel indices/);
  const gray=sample('grayscale'),grayCommand=structuredClone(valid);grayCommand.replacements={images:[{id:Object.keys(gray.images)[0],pixels:['#010203ff',null]}]};assert.throws(()=>applyCommand(gray,grayCommand),/equal RGB/);
  for(const p of [{type:3},{type:1,flags:1,gamma:0},{type:1,icc:[]},{...profile,name:'bad\0name'},{...profile,icc:profile.icc.map((b,i)=>i===36?0:b)}])assert.throws(()=>normalizeColorProfile(p));
});

test('result validation rejects changed profiles or bytes absent from validated command log',async()=>{
  const d=sample(),r=await run(d,'app.sprite:convertColorSpace(ColorSpace{sRGB=true})');
  const forged=structuredClone(r);pixels(forged.document)[0]='#010203ff';assert.throws(()=>validateLuaResult(forged,d),/replay|match|inconsistent/);
});

test('real browser worker transport loads the optional color engine and validates ICC replay',async t=>{
  const prior=Object.getOwnPropertyDescriptor(globalThis,'location');Object.defineProperty(globalThis,'location',{configurable:true,value:{href:'https://pixelwall.example/editor',origin:'https://pixelwall.example'}});t.after(()=>prior?Object.defineProperty(globalThis,'location',prior):delete globalThis.location);
  const createWorker=()=>{const w=new Worker(new URL('./fixtures/lua-dialog-browser-worker.mjs',import.meta.url),{execArgv:[]});const bridge={postMessage:m=>w.postMessage(m),terminate:()=>w.terminate()};w.on('message',data=>bridge.onmessage?.({data}));w.on('error',error=>bridge.onerror?.(error));return bridge;};
  const d=sample(),r=await runBrowser({document:d,source:'app.sprite:convertColorSpace(ColorSpace{sRGB=true})'},{wasmUri:'/runtimes/lua.wasm',createWorker});assert.equal(pixels(r.document)[0],'#9a5a4063');
});


test('embedded gray ICC uses gray LittleCMS channel layout and matches native gamma-one bytes',async()=>{
  const profile={type:2,flags:0,gamma:0,icc:[...Buffer.from(vectors.grayICC.base64,'base64')]},d=sample('grayscale',profile);
  const r=await run(d,'app.sprite:convertColorSpace(ColorSpace{sRGB=true});print(app.image:getPixel(0,0))');
  assert.equal(pixels(r.document)[0],vectors.grayICC.pixel);assert.deepEqual(r.prints,[String(vectors.grayICC.packed)]);assert.deepEqual(r.document.palette,d.palette);validateLuaResult(r,d);
  assert.throws(()=>applyCommand(sample(),{type:'document.colorProfile',profile}),/gray profile requires a grayscale/);
});

test('a failed later image or palette replacement leaves earlier images and metadata untouched',()=>{
  let d=sample();d=applyCommand(d,{type:'frame.duplicate',frameId:d.frames[0].id});const before=structuredClone(d);
  const images=Object.entries(d.images).map(([id,image])=>({id,pixels:[...image.pixels]}));images[0].pixels[0]='#010203ff';images[1].pixels[0]='bad';
  assert.throws(()=>applyCommand(d,{type:'document.colorProfile',profile:srgb,replacements:{images,palette:d.palette,framePalettes:[]}}),/RGBA colors/);assert.deepEqual(d,before);
});

test('cancel during a profile-edit transaction dialog returns no staged conversion',async()=>{
  const d=sample(),before=structuredClone(d),abort=new AbortController();let dialogSignal;
  const promise=runLuaScript({document:d,signal:abort.signal,source:'app.transaction(function()app.sprite:convertColorSpace(ColorSpace{sRGB=true});Dialog():button{id="ok"}:show()end)'},{onDialog:(_schema,{signal})=>{dialogSignal=signal;abort.abort();return new Promise(()=>{});}});
  await assert.rejects(promise,/cancelled/);assert.ok(dialogSignal.aborted);assert.deepEqual(d,before);
});

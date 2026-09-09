import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { applyCommand, createDocument, getCel, renderFrame } from '../app/editor-core.mjs';
const run=(document,...commands)=>commands.reduce((value,command)=>applyCommand(value,command),document);

test('original Image/Color/geometry contract runs unchanged in the actual Lua VM and official native oracle',async()=>{
 const source=readFileSync(new URL('./fixtures/lua-image-color-oracle.lua',import.meta.url),'utf8');
 const result=await runLuaScript({source});
 assert.deepEqual(result.prints,['image-color-native-contract-ok']);
 assert.equal(result.documents.length,3);
});

test('packed image byte strings roundtrip every byte value across binary-safe bridge chunks',async()=>{
 const result=await runLuaScript({source:`
  local pattern={};for n=0,255 do pattern[#pattern+1]=string.char(n) end
  local raw=string.rep(table.concat(pattern),256)
  local image=Image(128,128)
  image.bytes=raw
  assert(#image.bytes==65536 and image.bytes==raw)
  assert(image:getPixel(0,0)==app.pixelColor.rgba(0,1,2,3))
  local clone=Image(image,Rectangle(0,0,2,1));assert(clone.bytes==raw:sub(1,8))
  local gray=Image(128,128,ColorMode.GRAY);gray.bytes=raw:sub(1,32768);assert(gray.bytes==raw:sub(1,32768))
  local index=Image(128,128,ColorMode.INDEXED);index.bytes=raw:sub(1,16384);assert(index.bytes==raw:sub(1,16384))
  print('binary-ok')
 `});
 assert.deepEqual(result.prints,['binary-ok']);assert.equal(result.document,null);
});

test('invalid bytes reject before mutation and a subsequent valid transfer still succeeds',async()=>{
 const result=await runLuaScript({source:`
  local image=Image(2,1);local old=image.bytes
  assert(not pcall(function()image.bytes='short'end))
  assert(not pcall(function()image.bytes={1,2,3}end))
  assert(image.bytes==old)
  image.bytes=string.char(255,0,0,255,0,255,0,255)
  assert(image:getPixel(0,0)==app.pixelColor.rgba(255,0,0,255))
  assert(image:getPixel(1,0)==app.pixelColor.rgba(0,255,0,255))
 `});
 assert.equal(result.stats.commands,0);
});

test('attached bytes, nearest resize and flip commit through linked cels and roll back together',async()=>{
 let document=run(createDocument({width:2,height:1}),{type:'cel.set',width:2,height:1,pixels:['#ff0000ff','#0000ffff']},{type:'frame.duplicate',linked:true});
 const before=structuredClone(document);
 const result=await runLuaScript({document,source:`
  local i=app.image;local old=i.bytes
  local ok=pcall(function()app.transaction('failed image edit',function()
    i.bytes=string.char(0,255,0,255,0,255,0,255)
    i:resize(4,2);i:flip();error('rollback')
  end)end)
  assert(not ok and i.width==2 and i.height==1 and i.bytes==old)
  app.transaction('image authoring',function()
    i:resize(4,2);i:flip(FlipType.HORIZONTAL)
  end)
  assert(app.sprite.cels[1].image.id==app.sprite.cels[2].image.id)
 `});
 assert.deepEqual(document,before);assert.equal(getCel(result.document).image.width,4);
 assert.equal(getCel(result.document,result.document.frames[0].id).cel.imageId,getCel(result.document,result.document.frames[1].id).cel.imageId);
 assert.deepEqual(getCel(result.document).image.pixels,['#0000ffff','#0000ffff','#ff0000ff','#ff0000ff','#0000ffff','#0000ffff','#ff0000ff','#ff0000ff']);
 assert.ok(result.transactions.every(entry=>entry.label==='image authoring'));
});

test('every locked reference protects a shared image before a direct or buffered write',async()=>{
 let document=run(createDocument({width:1,height:1}),{type:'cel.set',width:1,height:1,pixels:['#ff0000ff']},{type:'layer.add',layer:{id:'locked',locked:false}});
 document.frames[0].cels.locked={...document.frames[0].cels['layer-1']};document.layers[1].locked=true;
 const result=await runLuaScript({document,activeLayerId:'layer-1',source:`
  local i=app.image;local before=i.bytes
  assert(not pcall(function()i:drawPixel(0,0,app.pixelColor.rgba(0,255,0,255))end))
  assert(not pcall(function()i.bytes=string.char(0,255,0,255)end))
  assert(not pcall(function()i:flip()end))
  assert(not pcall(function()i:resize(2,2)end))
  assert(i.bytes==before)
 `});
 assert.equal(result.stats.commands,0);assert.deepEqual(renderFrame(result.document),renderFrame(document));
});

test('Color retains HSV/HSL kinds across detached app-color copies and rejects bad setters atomically',async()=>{
 const result=await runLuaScript({source:`
  app.fgColor=Color{h=45,s=.5,v=.2,a=128}
  local copy=app.fgColor
  assert(copy.hsvHue==45 and copy.hsvSaturation==.5 and copy.hsvValue==.2)
  local old=copy.rgbaPixel
  assert(not pcall(function()copy.hsvValue=2 end))
  assert(copy.rgbaPixel==old and copy.hsvValue==.2)
  assert(not pcall(function()copy.hue=-30 end))
  copy.hslLightness=.5;app.fgColor=copy
  assert(app.fgColor.hslLightness==.5)
  app.bgColor=Color{gray=91,alpha=73}
 `});
 assert.deepEqual(result.bgColor,[91,91,91,73]);assert.equal(result.fgColor[3],128);
});

test('indexed Colors follow effective active-frame palettes and nearest lookup uses that frame',async()=>{
 let document=run(createDocument({width:1,height:1,colorMode:'indexed',palette:['#00000000','#ff0000ff','#0000ffff']}),{type:'frame.add',id:'second'});
 document.frames[1].palette=['#00000000','#0000ffff','#ff0000ff'];
 const result=await runLuaScript({document,source:`
  local c=Color{index=1};assert(c.red==255)
  app.frame=app.sprite.frames[2];assert(c.blue==255 and c.red==0)
  assert(Color{r=255,g=0,b=0,a=255}.index==2)
  app.fgColor=c
 `});
 assert.deepEqual(result.fgColor,[0,0,255,255]);
});

test('unsupported resize and cross-mode render choices fail explicitly',async()=>{
 await runLuaScript({source:`
  local s=Sprite(2,2);local image=Image(2,2)
  assert(not pcall(function()image:resize{width=4,height=4,method='bilinear'}end))
  assert(not pcall(function()image:resize{width=4,height=4,pivot=Point(1,1)}end))
  assert(not pcall(function()image:resize{width=4,height=4,unknown=true}end))
  assert(not pcall(function()image:flip(77)end))
  local index=Image(2,2,ColorMode.INDEXED)
  assert(not pcall(function()index:drawSprite(s,1)end))
  assert(image.width==2 and image.height==2)
 `});
});

test('image allocation limits remain enforced for crop-copy and resize work',async()=>{
 await assert.rejects(runLuaScript({source:`
  local i=Image(1024,1024)
  for n=1,6 do i=Image(i) end
 `}),/allocation budget/);
 await assert.rejects(runLuaScript({source:`local i=Image(1,1);i:resize(2048,2048)`}),/pixel budget/);
});


test('drawSprite can paint native background index zero while drawImage retains its mask behavior',async()=>{
 let document=run(createDocument({width:1,height:1,colorMode:'indexed',palette:['#000000ff','#ff0000ff']}),{type:'cel.set',width:1,height:1,pixels:[0]});
 document.metadata.aseprite={transparentIndex:0};document.layers[0].asepriteFlags=8;
 await runLuaScript({document,source:`
  local target=Image(1,1,ColorMode.INDEXED);target:clear(1);target:drawSprite(app.sprite,1);assert(target:getPixel(0,0)==0)
  local copy=Image(app.sprite);target:clear(1);target:drawImage(copy);assert(target:getPixel(0,0)==1)
 `});
});

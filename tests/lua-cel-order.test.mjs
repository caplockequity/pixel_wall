import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runLuaScript} from '../app/lua-runner-node.mjs';
import {createDocument,applyCommand,normalizeDocument,renderFrame} from '../app/editor-core.mjs';
import {readAseprite,writeAseprite} from '../app/formats.mjs';
import {validateLuaResult} from '../app/lua-session.mjs';
const expected=['0,0,0\t4290857789','3,0,0\t4280819430','1,0,0\t4290655319','2,0,0\t4280819430','0,0,-1\t4286415670','0,0,-2\t4281497725','0,0,-3\t4281497725','3,-1,-2\t4280819430','-32768,32767,0\t4286415670','32767,-32768,1\t4280819430'];
const seed=(width=2,height=2)=>applyCommand(createDocument({width,height}),{type:'cel.set',width,height,pixels:Array(width*height).fill(null)});
const source=readFileSync(new URL('./fixtures/cel-z-order-oracle.lua',import.meta.url),'utf8');
test('original cel drawing-order script matches independently captured native pixels and reopens',async()=>{
 const r=await runLuaScript({source});assert.deepEqual(r.prints,expected);validateLuaResult(r);
 const reopened=normalizeDocument(readAseprite(writeAseprite(r.document)).document);
 assert.deepEqual(renderFrame(reopened),renderFrame(r.document));assert.deepEqual(Object.values(reopened.frames[0].cels).map(c=>c.zIndex),[32767,-32768,1]);
});
test('drawing order belongs to each cel while shared image identity survives pixel flush and assignment',async()=>{
 let d=seed();d=applyCommand(d,{type:'frame.duplicate',linked:true});
 const r=await runLuaScript({document:d,source:`local s=app.sprite;local a=s.cels[1];local b=s.cels[2];assert(a.image==b.image);a.zIndex=7;b.zIndex=-3;a.image:drawPixel(0,0,Color{r=255});assert(a.zIndex==7 and b.zIndex==-3 and a.image==b.image);a.image=Image(a.image);assert(a.zIndex==7 and b.zIndex==-3)`});
 assert.equal(r.document.frames[0].cels['layer-1'].zIndex,7);assert.equal(r.document.frames[1].cels['layer-1'].zIndex,-3);validateLuaResult(r,d);
});
test('failed nested transaction restores drawing order and earlier buffered artwork',async()=>{
 const d=seed();const r=await runLuaScript({document:d,source:`local c=app.cel;c.zIndex=2;assert(not pcall(function()app.transaction(function()c.zIndex=4;c.image:drawPixel(0,0,Color{g=255});app.transaction(function()c.zIndex=-8;error('cancel')end)end)end));assert(c.zIndex==2 and c.image:isEmpty())`});
 assert.equal(r.document.frames[0].cels['layer-1'].zIndex,2);assert.ok(renderFrame(r.document).every(v=>v===0));validateLuaResult(r,d);
});
test('tilemap cel metadata remains accessible without creating unsupported raster Image handles',async()=>{
 const d=readAseprite(readFileSync(new URL('./fixtures/aseprite-oracle/2x2tilemap2x2tile.aseprite',import.meta.url))).document;
 const r=await runLuaScript({document:d,source:`for _,c in ipairs(app.sprite.cels) do if c.layer.isTilemap then assert(c.bounds==Rectangle(1,1,4,4));assert(c.zIndex==0);c.zIndex=-2;c.position=Point(1,2);assert(c.position==Point(1,2));assert(not pcall(function()return c.image end)) end end`});
 const layer=r.document.layers.find(l=>l.type==='tilemap');assert.equal(r.document.frames[0].cels[layer.id].zIndex,-2);validateLuaResult(r,d);
});
test('drawing order validation rejects malformed values and locked layers before mutation',async()=>{
 const d=seed(1,1),before=structuredClone(d);
 for(const value of[null,1.25,NaN,Infinity,2147483648,-2147483649,'3'])assert.throws(()=>applyCommand(d,{type:'cel.move',zIndex:value}),/integer|JSON|finite|number/);
 assert.deepEqual(d,before);
 const locked=applyCommand(d,{type:'layer.update',patch:{locked:true}});await assert.rejects(()=>runLuaScript({document:locked,source:'app.cel.zIndex=1'}),/locked/i);
 const forged=structuredClone(d);forged.frames[0].cels['layer-1'].zIndex='wrong';assert.throws(()=>normalizeDocument(forged),/z-index/);
});
test('signed32 drawing order stays editable while portable sprite save rejects unrepresentable values',async()=>{
 const d=seed(1,1);const r=await runLuaScript({document:d,source:'app.cel.zIndex=32768;assert(app.cel.zIndex==32768)'});
 assert.equal(r.document.frames[0].cels['layer-1'].zIndex,32768);assert.throws(()=>writeAseprite(r.document),/signed 16-bit/);validateLuaResult(r,d);
});

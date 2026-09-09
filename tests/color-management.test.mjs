import test from 'node:test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as constants from 'lcms-wasm';
import { createColorManager, createGammaProfile, documentProfile } from '../app/color-management.mjs';
import { createDocument, applyCommand } from '../app/editor-core.mjs';
import { writeAseprite, readAseprite, writePng, readPng } from '../app/formats.mjs';
import { createHistory } from '../app/history.mjs';
const lcms=await constants.instantiate();
const manager=createColorManager(lcms,constants);
const linear=manager.readProfile(createGammaProfile(1));
test.after(()=>manager.close());
test('LittleCMS converts linear RGB to sRGB and preserves straight alpha',()=>{
  const input=Uint8Array.from([128,128,128,17,0,255,0,0]);
  const actual=manager.transformRGBA(input,linear,'sRGB');
  for(const c of actual.subarray(0,3))assert.ok(Math.abs(c-188)<=1);
  assert.equal(actual[3],17);assert.equal(actual[7],0);
  const roundtrip=manager.transformRGBA(actual,'sRGB',linear);
  for(let i=0;i<roundtrip.length;i++)assert.ok(Math.abs(roundtrip[i]-input[i])<=1);
});
test('assign changes interpretation, convert changes pixels, both remain undoable',()=>{
  const doc=applyCommand(createDocument({width:1,height:1}),{type:'draw.stroke',points:[{x:0,y:0}],color:'#808080ff'});
  const assigned=manager.assignProfile(doc,linear);
  assert.deepEqual(assigned.images,doc.images);
  assert.equal(manager.displayFrame(assigned)[0],188);
  const converted=manager.convertDocument(assigned,'sRGB');
  assert.equal(converted.images[Object.keys(converted.images)[0]].pixels[0],'#bcbcbcff');
  assert.deepEqual([...manager.displayFrame(converted)],[...manager.displayFrame(assigned)]);
  const history=createHistory(doc);history.commit(assigned,'Assign profile');history.commit(converted,'Convert colors');
  history.undo();assert.deepEqual(history.present,assigned);history.undo();assert.deepEqual(history.present,doc);
});
test('indexed conversion transforms every frame palette without changing pixel indices or links',()=>{
  let doc=createDocument({width:1,height:1,colorMode:'indexed',palette:['#00000000','#808080ff']});
  doc=applyCommand(doc,{type:'draw.stroke',points:[{x:0,y:0}],color:1});
  doc=applyCommand(doc,{type:'frame.duplicate',frameId:doc.frames[0].id,linked:true});
  doc.frames[1].palette=['#00000000','#404040ff'];
  const assigned=manager.assignProfile(doc,linear),converted=manager.convertDocument(assigned,'sRGB');
  assert.deepEqual(converted.images,doc.images);
  assert.equal(converted.palette[1],'#bcbcbcff');assert.equal(converted.frames[1].palette[1],'#898989ff');
});
test('native export/import preserves exact embedded ICC bytes',()=>{
  const doc=manager.assignProfile(createDocument(),linear);
  assert.deepEqual(documentProfile(readAseprite(writeAseprite(doc)).document).icc,linear.icc);
});
test('PNG embeds ICC instead of a conflicting sRGB tag and decodes its profile',()=>{
  const input=Uint8Array.of(128,128,128,200),png=writePng(1,1,input,{colorProfile:linear}),image=readPng(png);
  assert.deepEqual(image.colorProfile,linear);assert.deepEqual(image.rgba,input);
  assert.equal(manager.transformRGBA(image.rgba,image.colorProfile)[0],188);
  assert.ok(!new TextDecoder().decode(png).includes('sRGB'));
});
test('malformed profiles are rejected before entering LittleCMS',()=>{
  assert.throws(()=>manager.readProfile(new Uint8Array(200)),/header/);
  const bytes=createGammaProfile();new DataView(bytes.buffer).setUint32(136,bytes.length+10);
  assert.throws(()=>manager.readProfile(bytes),/beyond/);
  assert.throws(()=>manager.readProfile(Array(140).fill(-1)),/bytes/);
  assert.throws(()=>manager.transformRGBA(Uint8Array.of(1,2,3)),/RGBA/);
});

test('ICC conversion matches all 17 independent Aseprite colors, including partial and zero alpha',async()=>{
  const path=new URL('./fixtures/aseprite-oracle/',import.meta.url);
  const oracle=JSON.parse(await readFile(new URL('color-conversion.json',path),'utf8'));
  const profile=manager.readProfile(await readFile(new URL(oracle.profilePath,path)));
  for(const sample of oracle.samples)assert.deepEqual([...manager.transformRGBA(Uint8Array.from(sample.input),profile)],sample.output);
});
test('bounded profile cache recreates evicted transforms without stale native handles',()=>{
  const input=Uint8Array.of(128,80,50,72), expected=manager.transformRGBA(input,linear);
  for(let gamma=1;gamma<=20;gamma++)manager.transformRGBA(input,manager.readProfile(createGammaProfile(0.5+gamma/10)));
  assert.deepEqual(manager.transformRGBA(input,linear),expected);
});

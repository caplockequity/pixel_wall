/** Native interoperability oracle. Asset provenance is in fixtures/aseprite-oracle/manifest.json. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAseprite } from '../app/formats.mjs';
import { normalizeDocument, renderFrame } from '../app/editor-core.mjs';
const assets=new URL('./fixtures/aseprite-oracle/',import.meta.url);
const load=name=>fs.readFileSync(new URL(name,assets));
const cases=JSON.parse(load('render-cases.json'));
function visiblePixels(bytes){const copy=Uint8Array.from(bytes);for(let i=0;i<copy.length;i+=4)if(!copy[i+3])copy.fill(0,i,i+3);return copy;}
for(const item of cases)test(`Aseprite 1.3.18.5 native render: ${item.file}`,()=>{
 const doc=normalizeDocument(readAseprite(load(item.file)).document);
 assert.equal(doc.frames.length,item.frames.length);
 for(let i=0;i<item.frames.length;i++)assert.deepEqual(visiblePixels(renderFrame(doc,doc.frames[i].id)),visiblePixels(load(item.frames[i])),`frame ${i+1}`);
});
const vectors=JSON.parse(load('blend-vectors.json'));
const hex=v=>'#'+v.map(n=>n.toString(16).padStart(2,'0')).join('');
function sample(mode,input,opaque=false){
 const b=opaque?[...input.backdrop.slice(0,3),255]:input.backdrop,s=opaque?[...input.source.slice(0,3),255]:input.source;
 return renderFrame({width:1,height:1,palette:[],colorMode:'rgba',metadata:{},frames:[{id:'f',cels:{b:{imageId:'b',x:0,y:0,opacity:1},s:{imageId:'s',x:0,y:0,opacity:1}}}],layers:[{id:'b',parentId:null,type:'image',visible:true,opacity:1,blendMode:'normal'},{id:'s',parentId:null,type:'image',visible:true,opacity:opaque?1:input.opacity/255,blendMode:mode}],images:{b:{width:1,height:1,pixels:[hex(b)]},s:{width:1,height:1,pixels:[hex(s)]}}});
}
for(const [key,outputs]of Object.entries(vectors.modes)){
 const mode=key.startsWith('hsl_')?key.slice(4).replace('luminosity','luminosity'):key.replaceAll('_','-');
 test(`Aseprite 1.3.18.5 ${mode}: 256 independently captured mixed-opacity and opaque colors`,()=>{
  for(let i=0;i<vectors.inputs.length;i++){
   const actual=sample(mode,vectors.inputs[i]);
   assert.deepEqual(visiblePixels(actual),visiblePixels(outputs[i].rgba),`mixed-opacity sample ${i}`);
   assert.deepEqual([...sample(mode,vectors.inputs[i],true)],outputs[i].opaque,`opaque sample ${i}`);
  }
 });
}
const corners=JSON.parse(load('blend-corners.json'));
for(const [key,outputs]of Object.entries(corners.modes)){
 const mode=key.startsWith('hsl_')?key.slice(4):key.replaceAll('_','-');
 test(`Aseprite ${mode}: 121 gray endpoint/boundary pairs`,()=>{
  for(let i=0;i<corners.inputs.length;i++)assert.deepEqual([...sample(mode,corners.inputs[i])],outputs[i].rgba,`gray pair ${i}`);
 });
}

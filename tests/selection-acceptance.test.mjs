import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, applyCommand } from '../app/editor-core.mjs';
import { decodeSelection, encodeSelectionMask } from '../app/selection-spec.mjs';
import { createSelectionRegistry } from '../app/selection-registry.mjs';

test('concave polygon, rectangle and RLE selections have bounded exact masks', () => {
  const polygon=decodeSelection({type:'polygon',points:[{x:1,y:1},{x:6,y:1},{x:6,y:3},{x:4,y:3},{x:4,y:6},{x:1,y:6}]},8,8);
  assert.equal(polygon.reduce((sum,value)=>sum+value,0),19);
  const mask=Uint8Array.from({length:64},(_,i)=>i%9===0?1:0), rle=encodeSelectionMask([...mask],8,8);
  assert.deepEqual([...decodeSelection(rle,8,8)], [...mask]);
  const rect=decodeSelection({type:'rect',x:2,y:2,width:3,height:2},8,8);
  assert.equal(rect.reduce((sum,value)=>sum+value,0),6);
  assert.equal(rect[0],0); assert.equal(rect[2+2*8],1); assert.equal(rect[7+7*8],0);
});

test('regional replacement respects cel offsets, frame and layer scope', () => {
  let doc=createDocument({id:'selection-doc',width:8,height:8});
  doc=applyCommand(doc,{type:'layer.add',layer:{id:'other',name:'Other'}});
  doc=applyCommand(doc,{type:'frame.add',id:'second',durationMs:100});
  const red=Array(4).fill('#ff0000ff');
  doc=applyCommand(doc,{type:'cel.set',frameId:'frame-1',layerId:'layer-1',width:2,height:2,pixels:red,x:2,y:2});
  doc=applyCommand(doc,{type:'cel.set',frameId:'second',layerId:'other',width:2,height:2,pixels:red,x:2,y:2});
  doc=applyCommand(doc,{type:'selection.replaceColors',frameId:'frame-1',layerId:'layer-1',selection:{type:'rect',x:2,y:2,width:2,height:2},mapping:{'#ff0000ff':'#00ff00ff'}});
  const first=doc.images[doc.frames[0].cels['layer-1'].imageId].pixels;
  const second=doc.images[doc.frames[1].cels.other.imageId].pixels;
  assert.deepEqual(first,Array(4).fill('#00ff00ff')); assert.deepEqual(second,red);
});

test('selection registry rejects stale IDs and bounds retention', () => {
  const registry=createSelectionRegistry({maxEntries:2});
  registry.create({documentId:'d',revision:1,id:'a',selection:{type:'rect',x:0,y:0,width:1,height:1}});
  registry.create({documentId:'d',revision:1,id:'b',selection:{type:'rect',x:1,y:1,width:1,height:1}});
  assert.throws(()=>registry.create({documentId:'d',revision:1,id:'c',selection:{type:'rect',x:2,y:2,width:1,height:1}}),/full/);
  assert.throws(()=>registry.resolve({documentId:'d',revision:2,id:'b'}),/missing/);
});

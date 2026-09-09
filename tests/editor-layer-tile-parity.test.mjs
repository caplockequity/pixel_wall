import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,applyCommand,normalizeDocument,renderFrame,getCel,getTile} from '../app/editor-core.mjs';
import {readAseprite,writeAseprite} from '../app/formats.mjs';
const red='#ff0000ff',green='#00ff00ff',blue='#0000ffff',yellow='#ffff00ff',magenta='#ff00ffff',clear='#00000000';
const run=(doc,...commands)=>commands.reduce((state,command)=>applyCommand(state,command),doc);
const native=doc=>normalizeDocument(readAseprite(writeAseprite(doc)).document);
const pixels=(doc,frameId)=>Array.from(renderFrame(doc,frameId));
function tileDocument(unused=false){
 let doc=createDocument({width:2,height:2});
 doc=run(doc,{type:'tileset.add',tileset:{id:'tiles',tileWidth:2,tileHeight:2,tiles:[{id:'red',pixels:[red,green,blue,null]},...(unused?[{id:'unused',pixels:[blue,blue,blue,blue]}]:[])]}},
 {type:'layer.add',layer:{id:'map',type:'tilemap',tilesetId:'tiles'}},{type:'tilemap.paint',layerId:'map',points:[{x:0,y:0,tileId:'red',rotate:90,flipX:true}]});
 return doc;
}

test('Auto removes only the newly unused tile, retaining pre-existing unused tiles and bounded image storage',()=>{
 let doc=tileDocument(true);
 for(const color of [green,yellow,magenta]){
  doc=applyCommand(doc,{type:'tilemap.edit',layerId:'map',x:0,y:0,mode:'auto',pixels:Array(4).fill(color)});
  assert.equal(doc.tilesets[0].tiles.length,2);assert.ok(doc.tilesets[0].tiles.some(tile=>tile.id==='unused'));
  assert.equal(Object.keys(doc.images).length,2);
 }
 const map=doc.layers.find(layer=>layer.id==='map').tilemaps['frame-1'];assert.equal(map.cells[0].rotate,90);assert.equal(map.cells[0].flipX,true);
});

test('Auto reference checks include hidden layers and every frame',()=>{
 let doc=run(tileDocument(),{type:'frame.duplicate',linked:true},{type:'layer.add',layer:{id:'hidden',type:'tilemap',tilesetId:'tiles',visible:false}},
 {type:'tilemap.paint',layerId:'hidden',frameId:'frame-1',points:[{x:0,y:0,tileId:'red'}]});
 const second=doc.frames[1].id;
 doc=run(doc,{type:'tilemap.edit',layerId:'map',frameId:'frame-1',x:0,y:0,mode:'auto',pixels:Array(4).fill(yellow)},
 {type:'tilemap.edit',layerId:'map',frameId:second,x:0,y:0,mode:'auto',pixels:Array(4).fill(yellow)});
 assert.ok(doc.tilesets[0].tiles.some(tile=>tile.id==='red'));
 doc=applyCommand(doc,{type:'tilemap.edit',layerId:'hidden',frameId:'frame-1',x:0,y:0,mode:'auto',pixels:Array(4).fill(yellow)});
 assert.equal(doc.tilesets[0].tiles.length,1);assert.ok(!doc.tilesets[0].tiles.some(tile=>tile.id==='red'));
});

test('native Auto compacts tile IDs only after all native links stop referencing the replaced tile',()=>{
 const original=native(run(tileDocument(true),{type:'frame.duplicate',linked:true}));const before=JSON.stringify(original),layerId=original.layers.find(layer=>layer.type==='tilemap').id;
 let doc=applyCommand(original,{type:'tilemap.edit',layerId,frameId:original.frames[0].id,x:0,y:0,mode:'auto',pixels:Array(4).fill(yellow)});
 assert.deepEqual(pixels(doc,doc.frames[1].id),pixels(original,original.frames[1].id));
 assert.deepEqual(pixels(native(doc),native(doc).frames[1].id),pixels(original,original.frames[1].id));
 doc=applyCommand(doc,{type:'tilemap.edit',layerId,frameId:doc.frames[1].id,x:0,y:0,mode:'auto',pixels:Array(4).fill(yellow)});
 assert.equal(doc.tilesets[0].tiles.length,2);assert.equal(doc.tilesets[0].imageId,undefined);
 const exported=native(doc);assert.equal(exported.tilesets[0].tileCount,3);
 assert.deepEqual(exported.frames.map(frame=>pixels(exported,frame.id)),doc.frames.map(frame=>pixels(doc,frame.id)));
 assert.equal(JSON.stringify(original),before);
});

for(const [name,make]of [['engine',tileDocument],['native',()=>native(tileDocument())]]){
 test(`${name} Auto erases a transparent cell and exports an empty tileset`,()=>{
  const original=make(),layerId=original.layers.find(layer=>layer.type==='tilemap').id;
  const doc=applyCommand(original,{type:'tilemap.edit',layerId,x:0,y:0,mode:'auto',pixels:Array(4).fill(null)});
  assert.equal(doc.layers.find(layer=>layer.id===layerId).tilemaps[doc.frames[0].id].cells[0],null);
  assert.equal(doc.tilesets[0].tiles.length,0);assert.ok(pixels(doc).every(value=>value===0));
  const exported=native(doc);assert.equal(exported.tilesets[0].tileCount,1);assert.ok(pixels(exported).every(value=>value===0));
 });
}

test('Manual and Stack keep their distinct tile sharing behavior',()=>{
 let doc=tileDocument();doc=applyCommand(doc,{type:'tilemap.edit',layerId:'map',x:0,y:0,mode:'stack',pixels:Array(4).fill(yellow)});
 assert.equal(doc.tilesets[0].tiles.length,2);assert.deepEqual(getTile(doc,'tiles','red').pixels,[red,green,blue,null]);
 doc=applyCommand(doc,{type:'tilemap.edit',layerId:'map',x:0,y:0,mode:'manual',pixels:Array(4).fill(green)});assert.equal(doc.tilesets[0].tiles.length,2);
});

function rasterLayers(){
 let doc=createDocument({width:2,height:1});
 return run(doc,{type:'cel.set',width:2,height:1,pixels:[red,red]},
 {type:'layer.add',layer:{id:'top',name:'Top'}},{type:'cel.set',layerId:'top',width:2,height:1,pixels:[blue,null]});
}

test('Merge Down follows native hidden-root semantics and offers a visible-only alternative',()=>{
 let doc=run(rasterLayers(),{type:'layer.update',layerId:'top',patch:{visible:false}});
 const merged=applyCommand(doc,{type:'layer.mergeDown',layerId:'top'});assert.deepEqual(pixels(merged),[0,0,255,255,255,0,0,255]);
 assert.equal(merged.layers[0].visible,true);
 const visibleOnly=applyCommand(doc,{type:'layer.mergeDown',layerId:'top',visibleOnly:true});assert.deepEqual(pixels(visibleOnly),pixels(doc));
 doc=run(rasterLayers(),{type:'layer.update',layerId:'layer-1',patch:{visible:false}});
 const hidden=applyCommand(doc,{type:'layer.mergeDown',layerId:'top'});assert.equal(hidden.layers[0].visible,false);assert.ok(pixels(hidden).every(value=>value===0));
 assert.deepEqual(getCel(hidden).image.pixels,[blue,red]);
});

test('Merge Down accepts group and tilemap siblings, bakes blend mode and retains independent tilesets',()=>{
 let doc=tileDocument();doc=run(doc,{type:'layer.add',layer:{id:'group',type:'group'}},{type:'layer.add',layer:{id:'child',parentId:'group',blendMode:'multiply'}},
 {type:'cel.set',layerId:'child',width:2,height:2,pixels:[yellow,yellow,yellow,yellow]});
 const before=pixels(doc),merged=applyCommand(doc,{type:'layer.mergeDown',layerId:'group'});
 assert.deepEqual(pixels(merged),before);assert.equal(merged.layers.find(layer=>layer.id==='map').type,'image');
 assert.ok(!merged.layers.some(layer=>layer.id==='group'||layer.id==='child'));assert.equal(merged.tilesets.length,1);
 assert.deepEqual(pixels(native(merged)),pixels(merged));
});

test('Flatten layer preserves root style, ancestor placement, hidden-root behavior, and off-canvas pixels',()=>{
 let doc=createDocument({width:2,height:1});
 doc=run(doc,{type:'layer.add',layer:{id:'parent',type:'group',opacity:.5}},{type:'layer.add',layer:{id:'group',type:'group',parentId:'parent',opacity:.5,blendMode:'screen'}},
 {type:'layer.add',layer:{id:'child',parentId:'group'}},{type:'cel.set',layerId:'child',width:4,height:1,x:-1,pixels:[red,green,blue,yellow]});
 const before=pixels(doc),flat=applyCommand(doc,{type:'layer.flatten',layerId:'group'}),layer=flat.layers.find(layer=>layer.id==='group');
 assert.deepEqual(pixels(flat),before);assert.equal(layer.parentId,'parent');assert.equal(layer.opacity,.5);assert.equal(layer.blendMode,'screen');
 const cel=getCel(flat,flat.frames[0].id,'group');assert.equal(cel.cel.x,-1);assert.equal(cel.image.width,4);assert.deepEqual(cel.image.pixels,[red,green,blue,yellow]);
 const hidden=applyCommand(run(doc,{type:'layer.update',layerId:'group',patch:{visible:false}}),{type:'layer.flatten',layerId:'group'});
 assert.equal(hidden.layers.find(layer=>layer.id==='group').visible,false);assert.deepEqual(getCel(hidden,undefined,'group').image.pixels,[red,green,blue,yellow]);
});

test('Flatten document preserves visible composite, linked frames and hidden root layers by default',()=>{
 let doc=run(rasterLayers(),{type:'layer.add',layer:{id:'hidden',visible:false}},{type:'cel.set',layerId:'hidden',width:2,height:1,pixels:[green,green]},
 {type:'frame.duplicate',linked:true});const before=doc.frames.map(frame=>pixels(doc,frame.id));
 const flat=applyCommand(doc,{type:'document.flatten'});assert.equal(flat.layers.length,2);assert.ok(flat.layers.some(layer=>layer.id==='hidden'&&!layer.visible));
 assert.deepEqual(flat.frames.map(frame=>pixels(flat,frame.id)),before);assert.equal(getCel(flat,flat.frames[0].id).cel.imageId,getCel(flat,flat.frames[1].id).cel.imageId);
 const all=applyCommand(doc,{type:'document.flatten',visibleOnly:false});assert.equal(all.layers.length,1);assert.deepEqual(all.frames.map(frame=>pixels(all,frame.id)),before);
});

test('Flatten uses effective indexed palettes and honors locked descendants atomically',()=>{
 let doc=createDocument({width:1,height:1,colorMode:'indexed',palette:[clear,red,green]});
 doc=run(doc,{type:'cel.set',width:1,height:1,pixels:[1]},{type:'frame.duplicate',linked:true});doc.frames[1].palette=[clear,green,red];doc=normalizeDocument(doc);
 const before=doc.frames.map(frame=>pixels(doc,frame.id)),flat=applyCommand(doc,{type:'document.flatten'});assert.deepEqual(flat.frames.map(frame=>pixels(flat,frame.id)),before);assert.equal(getCel(flat,flat.frames[0].id).cel.imageId,getCel(flat,flat.frames[1].id).cel.imageId);
 let locked=run(rasterLayers(),{type:'layer.add',layer:{id:'group',type:'group'}},{type:'layer.update',layerId:'top',patch:{parentId:'group',locked:true}});const saved=JSON.stringify(locked);
 assert.throws(()=>applyCommand(locked,{type:'layer.flatten',layerId:'group'}),/locked/);assert.equal(JSON.stringify(locked),saved);
});

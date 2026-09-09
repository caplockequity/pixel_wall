import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, applyCommand, normalizeDocument, renderFrame, getCel, getFramePalette, buildSelection } from '../app/editor-core.mjs';
import { readAseprite, writeAseprite } from '../app/formats.mjs';

const red='#ff0000ff',green='#00ff00ff',blue='#0000ffff',clear='#00000000';
const run=(doc,...commands)=>commands.reduce((state,command)=>applyCommand(state,command),doc);
const frames=doc=>doc.frames.map(frame=>Array.from(renderFrame(doc,frame.id)));
const native=doc=>normalizeDocument(readAseprite(writeAseprite(doc)).document);
function indexedAnimation(){
 let doc=createDocument({width:2,height:1,colorMode:'indexed',palette:[clear,red]});
 doc=run(doc,{type:'cel.set',width:2,height:1,pixels:[1,null]},{type:'frame.duplicate',linked:true},{type:'frame.duplicate',frameId:'frame-1',linked:true});
 doc.frames[1].palette=[clear,green];doc.frames[2].palette=[clear,red];return normalizeDocument(doc);
}

test('color conversion resolves each frame palette and preserves linking only for equal color contexts',()=>{
 const original=native(indexedAnimation()),before=JSON.stringify(original),expected=frames(original);
 const converted=applyCommand(original,{type:'document.colorMode',colorMode:'rgba'});
 assert.deepEqual(frames(converted),expected);
 assert.equal(getCel(converted,converted.frames[0].id).cel.imageId,getCel(converted,converted.frames[2].id).cel.imageId);
 assert.notEqual(getCel(converted,converted.frames[0].id).cel.imageId,getCel(converted,converted.frames[1].id).cel.imageId);
 assert.deepEqual(frames(native(converted)),expected);
 assert.equal(JSON.stringify(original),before);
 const gray=applyCommand(original,{type:'document.colorMode',colorMode:'grayscale'});
 assert.deepEqual(frames(gray).map(p=>p.slice(0,4)),[[54,54,54,255],[182,182,182,255],[54,54,54,255]]);
});

test('conversion separates background and transparent layers sharing the same indexed image',()=>{
 let doc=createDocument({width:1,height:1,colorMode:'indexed',palette:[red,green]});
 doc=run(doc,{type:'cel.set',width:1,height:1,pixels:[0]},{type:'layer.add',layer:{id:'background',asepriteFlags:8}});
 doc.frames[0].cels.background={...doc.frames[0].cels['layer-1']};doc.metadata.aseprite={transparentIndex:0};doc=normalizeDocument(doc);
 const converted=applyCommand(doc,{type:'document.colorMode',colorMode:'rgba'});
 assert.deepEqual(getCel(converted,undefined,'layer-1').image.pixels,[null]);
 assert.deepEqual(getCel(converted,undefined,'background').image.pixels,[red]);
 assert.notEqual(getCel(converted,undefined,'layer-1').cel.imageId,getCel(converted,undefined,'background').cel.imageId);
 assert.deepEqual(frames(converted),frames(doc));
 assert.deepEqual(getFramePalette(doc,'frame-1','layer-1'),[clear,green]);
 assert.deepEqual(getFramePalette(doc,'frame-1','background'),[red,green]);
});

function tileAnimation(){
 let doc=createDocument({width:2,height:2,colorMode:'indexed',palette:[clear,red,blue]});
 doc=run(doc,{type:'tileset.add',tileset:{id:'tiles',tileWidth:2,tileHeight:2,tiles:[{id:'tile',pixels:[1,2,null,1]}]}},
  {type:'layer.add',layer:{id:'map',type:'tilemap',tilesetId:'tiles'}},
  {type:'tilemap.paint',layerId:'map',points:[{x:0,y:0,tileId:'tile',flipX:true,rotate:90}]},
  {type:'frame.duplicate',linked:true});
 doc.frames[1].palette=[clear,green,red];return normalizeDocument(doc);
}
for(const [kind,make]of [['engine',tileAnimation],['native atlas',()=>native(tileAnimation())]]){
 test(`${kind} tilemap color conversion preserves all frames and a single exportable tileset`,()=>{
  const original=make(),before=JSON.stringify(original),expected=frames(original);
  const converted=applyCommand(original,{type:'document.colorMode',colorMode:'rgba'});
  assert.deepEqual(frames(converted),expected);
  assert.equal(converted.tilesets.length,1);
  const layer=converted.layers.find(layer=>layer.type==='tilemap');
  assert.equal(new Set(Object.values(layer.tilemaps).map(map=>map.tilesetId)).size,1);
  assert.notEqual(layer.tilemaps[converted.frames[0].id].cells[0].tileId,layer.tilemaps[converted.frames[1].id].cells[0].tileId);
  assert.deepEqual(frames(native(converted)),expected);
  assert.equal(JSON.stringify(original),before);
 });
}

test('unused embedded tiles remain editable after conversion and missing external pixels reject atomically',()=>{
 let doc=createDocument({width:1,height:1,colorMode:'indexed',palette:[clear,red]});
 doc=run(doc,{type:'tileset.add',tileset:{id:'unused',tileWidth:1,tileHeight:1,tiles:[{id:'tile',pixels:[1]}]}});
 const converted=applyCommand(doc,{type:'document.colorMode',colorMode:'rgba'});
 assert.deepEqual(converted.images[converted.tilesets[0].tiles[0].imageId].pixels,[red]);
 doc.tilesets.push({id:'external',tileWidth:1,tileHeight:1,externalFileId:1,externalTilesetId:2,tiles:[]});
 doc=normalizeDocument(doc);const before=JSON.stringify(doc);
 assert.throws(()=>applyCommand(doc,{type:'document.colorMode',colorMode:'rgba'}),/Embed external tileset/);
 assert.equal(JSON.stringify(doc),before);
});


test('all-frame palette replacement recolors native indexed artwork without rewriting its images',()=>{
 const original=native(indexedAnimation()),image=getCel(original).image;
 const updated=applyCommand(original,{type:'palette.update',palette:[clear,blue]});
 assert.equal(getCel(updated).image,image);
 assert.deepEqual(frames(updated).map(p=>p.slice(0,4)),Array(3).fill([0,0,255,255]));
 assert.deepEqual(frames(native(updated)),frames(updated));
});

test('frame and range palette edits preserve unselected inherited palettes and exact raster links',()=>{
 let original=indexedAnimation();delete original.frames[2].palette;original=normalizeDocument(original);
 const before=frames(original),image=getCel(original).image;
 const updated=applyCommand(original,{type:'palette.update',scope:'frame',frameId:original.frames[1].id,palette:[clear,blue]});
 assert.deepEqual(frames(updated)[0],before[0]);assert.deepEqual(frames(updated)[2],before[2]);
 assert.deepEqual(frames(updated)[1].slice(0,4),[0,0,255,255]);assert.equal(getCel(updated).image,image);
 const range=applyCommand(original,{type:'palette.update',frameIds:[original.frames[0].id,original.frames[2].id],palette:[clear,blue]});
 assert.deepEqual(frames(range).map(p=>p.slice(0,4)),[[0,0,255,255],[0,255,0,255],[0,0,255,255]]);
 assert.throws(()=>applyCommand(original,{type:'palette.update',scope:'range',palette:[clear,red]}),/frameIds/);
});

test('scoped indexed remap splits shared images and preserves unselected indices and colors',()=>{
 const original=native(indexedAnimation()),before=JSON.stringify(original),expected=frames(original);
 const mapped=applyCommand(original,{type:'palette.remap',frameId:original.frames[1].id,palette:[clear,red,green],mapping:[0,2]});
 assert.deepEqual(frames(mapped),expected);assert.deepEqual(getCel(mapped,mapped.frames[1].id).image.pixels,[2,null]);
 assert.deepEqual(getCel(mapped,mapped.frames[0].id).image.pixels,getCel(original,original.frames[0].id).image.pixels);
 assert.notEqual(getCel(mapped,mapped.frames[1].id).cel.imageId,getCel(mapped,mapped.frames[0].id).cel.imageId);
 assert.deepEqual(frames(native(mapped)),expected);assert.equal(JSON.stringify(original),before);
 const shrunk=applyCommand(mapped,{type:'palette.remap',frameId:mapped.frames[0].id,palette:[clear,red]});
 assert.deepEqual(frames(native(shrunk)),frames(shrunk));
});

for(const [kind,make]of [['engine',tileAnimation],['native atlas',()=>native(tileAnimation())]]){
 test(`${kind} tilemap scoped remap preserves unselected tiles and native export pixels`,()=>{
  const original=make(),expected=frames(original),mapped=applyCommand(original,{type:'palette.remap',scope:'frame',frameId:original.frames[1].id,palette:[clear,red,green],mapping:[0,2,1]});
  assert.deepEqual(frames(mapped),expected);assert.equal(mapped.tilesets.length,1);
  assert.deepEqual(frames(native(mapped)),expected);
 });
}

test('active-frame palette drives drawing, stamping, fill, effects, and transparent-index wand selection',()=>{
 let doc=createDocument({width:2,height:1,colorMode:'indexed',palette:[clear,red,green]});
 doc=run(doc,{type:'frame.add',id:'active'});doc.frames[1].palette=[clear,green,red];doc=normalizeDocument(doc);
 const cases=[
  {type:'draw.stroke',points:[{x:0,y:0}],color:green},
  {type:'cel.set',width:2,height:1,pixels:[green,null]},
  {type:'image.stamp',x:0,y:0,width:1,height:1,pixels:[green]},
  {type:'draw.fill',x:0,y:0,color:green},
 ];
 for(const command of cases){const result=applyCommand(doc,{...command,frameId:'active'});assert.deepEqual(frames(result)[1].slice(0,4),[0,255,0,255],command.type);assert.equal(getCel(result,'active').image.pixels[0],1);}
 doc=run(doc,{type:'cel.set',frameId:'active',width:2,height:1,pixels:[green,null]},{type:'effect.apply',frameId:'active',effect:'replace',fromColor:green,toColor:red});
 assert.deepEqual(frames(doc)[1].slice(0,4),[255,0,0,255]);
 doc.frames[1].palette=[red,green,green];doc.metadata.aseprite={transparentIndex:0};
 doc=run(normalizeDocument(doc),{type:'cel.set',frameId:'active',width:2,height:1,pixels:[0,null]});
 assert.deepEqual(buildSelection(doc,{shape:'wand',frameId:'active',layerId:'layer-1',x:0,y:0}),[1,1]);
});

test('palette shading follows the supplied ramp once per stroke with endpoint clamping',()=>{
 for(const colorMode of ['rgba','indexed']){
  let doc=createDocument({width:2,height:1,colorMode,palette:[red,green,blue]});
  doc=run(doc,{type:'cel.set',width:2,height:1,pixels:[green,blue]});
  const darker=applyCommand(doc,{type:'draw.stroke',points:[{x:0,y:0},{x:1,y:0},{x:0,y:0}],ink:'shading',ramp:[0,1,2],shadeStep:-1});
  assert.deepEqual(frames(darker)[0],[255,0,0,255,0,255,0,255]);
  const lighter=applyCommand(doc,{type:'draw.stroke',points:[{x:0,y:0},{x:1,y:0}],ink:'shading',ramp:[0,1,2],shadeStep:1});
  assert.deepEqual(frames(lighter)[0],[0,0,255,255,0,0,255,255]);
 }
});

test('frame palettes validate colors and support native documents whose later palette is longer',()=>{
 let doc=createDocument({width:1,height:1,colorMode:'indexed',palette:[clear,red]});
 doc=run(doc,{type:'frame.add',id:'long'});doc.frames[1].palette=[clear,red,green];
 doc.images.extra={width:1,height:1,pixels:[2]};doc.frames[1].cels['layer-1']={imageId:'extra',x:0,y:0,opacity:1};
 doc=normalizeDocument(doc);assert.deepEqual(frames(native(doc)),frames(doc));
 assert.throws(()=>normalizeDocument({...doc,frames:doc.frames.map((frame,i)=>i?{...frame,palette:['invalid']}:frame)}),/Invalid RGBA/);
});


test('range effects split linked indexed cels when palette lookup differs and process equal contexts once',()=>{
 let doc=createDocument({width:1,height:1,colorMode:'indexed',palette:[clear,red,green,blue]});
 doc=run(doc,{type:'cel.set',width:1,height:1,pixels:[1]},{type:'frame.duplicate',linked:true},{type:'frame.duplicate',frameId:'frame-1',linked:true});
 doc.frames[1].palette=[clear,red,blue,green];doc.frames[2].palette=[clear,red,green,blue];doc=normalizeDocument(doc);
 const result=applyCommand(doc,{type:'effect.apply',effect:'hue',amount:120,frameIds:doc.frames.map(frame=>frame.id)});
 assert.deepEqual(frames(result),Array(3).fill([0,255,0,255]));
 assert.equal(getCel(result,result.frames[0].id).cel.imageId,getCel(result,result.frames[2].id).cel.imageId);
 assert.notEqual(getCel(result,result.frames[0].id).cel.imageId,getCel(result,result.frames[1].id).cel.imageId);
});

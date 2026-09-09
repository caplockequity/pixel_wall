import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument, normalizeDocument, applyCommand, renderFrame} from '../app/editor-core.mjs';
import {sameFrameRender} from '../app/frame-render-equality.mjs';

const red='#ff0000ff',blue='#0000ffff';
const edit=(d,...commands)=>commands.reduce((doc,c)=>applyCommand(doc,c),d);
const paint=(frameId='frame-1',extra={})=>({type:'draw.stroke',frameId,points:[{x:0,y:0}],color:red,...extra});
function equivalent(a,b,id){assert.equal(sameFrameRender(a,b,id),true);assert.deepEqual(renderFrame(a,id),renderFrame(b,id));}

test('an independent frame edit invalidates only that frame; linked edits invalidate every use',()=>{
 let d=edit(createDocument({width:4,height:4}),paint(),{type:'frame.duplicate',linked:false});
 const id=d.frames[1].id,after=applyCommand(d,paint('frame-1',{color:blue}));
 assert.equal(sameFrameRender(d,after,'frame-1'),false);equivalent(d,after,id);
 d=applyCommand(d,{type:'cel.link',sourceFrameId:'frame-1',layerId:'layer-1',frameId:id});
 const linked=applyCommand(d,paint(id,{color:blue}));
 assert.equal(sameFrameRender(d,linked,'frame-1'),false);assert.equal(sameFrameRender(d,linked,id),false);
});
test('names, locks, clips and durations preserve thumbnail pixels',()=>{
 const d=edit(createDocument({width:4,height:4}),paint());
 const n=edit(d,{type:'document.update',patch:{name:'renamed'}},{type:'frame.update',patch:{durationMs:999}},{type:'layer.update',layerId:'layer-1',patch:{name:'renamed layer',locked:true}},{type:'clip.update',clipId:'clip-1',patch:{direction:'reverse'}});
 equivalent(d,n,'frame-1');
});
test('layer opacity, hierarchy/order and cel transforms invalidate',()=>{
 const d=edit(createDocument({width:4,height:4}),paint(),{type:'layer.add',layer:{id:'top'}});
 for(const c of [
  {type:'layer.update',layerId:'layer-1',patch:{opacity:.5}},
  {type:'layer.update',layerId:'layer-1',patch:{visible:false}},
  {type:'layer.reorder',layerId:'top',index:0},
  {type:'cel.move',layerId:'layer-1',x:1},
 ])assert.equal(sameFrameRender(d,applyCommand(d,c),'frame-1'),false);
});
test('indexed palette edits, inherited frame palettes and transparent indices invalidate',()=>{
 let d=edit(createDocument({width:4,height:4,colorMode:'indexed',palette:[red,blue]}),paint(),{type:'frame.duplicate',linked:true});
 const id=d.frames[1].id;
 assert.equal(sameFrameRender(d,applyCommand(d,{type:'palette.update',palette:[blue,red]}),id),false);
 const n={...d,frames:d.frames.map((f,i)=>i===0?{...f,palette:[blue,red]}:f)};
 assert.equal(sameFrameRender(d,n,id),false);
 const transparent={...d,metadata:{aseprite:{transparentIndex:0}}};assert.equal(sameFrameRender(d,transparent,id),false);
});
test('tile cells, referenced tile images and native atlas crops are tracked',()=>{
 const d=edit(createDocument({width:4,height:4}),{type:'tileset.add',tileset:{id:'ts',tileWidth:2,tileHeight:2,tiles:[{id:'r',pixels:[red,red,red,red]},{id:'b',pixels:[blue,blue,blue,blue]}]}},{type:'layer.add',layer:{id:'map',type:'tilemap'}},{type:'tilemap.paint',layerId:'map',tilesetId:'ts',points:[{x:0,y:0,tileId:'r'}]},{type:'frame.duplicate'});
 const renamed=applyCommand(d,{type:'document.update',patch:{name:'x'}});equivalent(d,renamed,'frame-1');
 const changed=applyCommand(d,{type:'tilemap.paint',layerId:'map',points:[{x:0,y:0,tileId:'b'}]});assert.equal(sameFrameRender(d,changed,'frame-1'),false);equivalent(d,changed,d.frames[1].id);
 const manual=applyCommand(d,{type:'tilemap.edit',layerId:'map',x:0,y:0,mode:'manual',pixels:[blue,blue,blue,blue]});assert.equal(sameFrameRender(d,manual,'frame-1'),false);assert.equal(sameFrameRender(d,manual,d.frames[1].id),false);
 let native=createDocument({width:2,height:2});native.layers=[{...native.layers[0],type:'tilemap',tilesetId:'native'}];native.images={atlas:{width:2,height:4,pixels:[red,red,red,red,blue,blue,blue,blue]},map:{width:1,height:1,pixels:[],tilemap:{tiles:[0]}}};native.frames[0].cels={'layer-1':{imageId:'map',x:0,y:0,opacity:1}};native.tilesets=[{id:'native',tileWidth:2,tileHeight:2,tileCount:2,flags:0,imageId:'atlas'}];native=normalizeDocument(native);
 equivalent(native,applyCommand(native,{type:'document.update',patch:{name:'renamed'}}),'frame-1');
 const edited=applyCommand(native,{type:'tilemap.edit',layerId:'layer-1',x:0,y:0,mode:'manual',pixels:[blue,blue,blue,blue]});assert.equal(sameFrameRender(native,edited,'frame-1'),false);
});
test('precise bounds and z-order affect raster thumbnails',()=>{
 const d=edit(createDocument({width:4,height:4}),paint());
 for(const extra of [{zIndex:2},{preciseBounds:{flags:1,x:1,y:1,width:2,height:2}}]){
  const n={...d,frames:[{...d.frames[0],cels:{'layer-1':{...d.frames[0].cels['layer-1'],...extra}}}]};assert.equal(sameFrameRender(d,n,'frame-1'),false);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocument,normalizeDocument,migrateLegacy,applyCommand,renderFrame,getCel,getTile,describeDocument,buildSelection,COMMANDS,EditorError} from '../app/editor-core.mjs';

const red='#ff0000ff',green='#00ff00ff',blue='#0000ffff',white='#ffffffff',black='#000000ff';
const blank=(width=8,height=width,options={})=>createDocument({width,height,...options});
const run=(doc,...commands)=>commands.reduce((d,c)=>applyCommand(d,c),doc);
const pixel=(doc,x,y,fid)=>[...renderFrame(doc,fid).slice((y*doc.width+x)*4,(y*doc.width+x)*4+4)];
const painted=doc=>[...renderFrame(doc)].filter((_,i)=>i%4===3).filter(Boolean).length;
const stroke=(x,y,color=red,extra={})=>({type:'draw.stroke',points:[{x,y}],color,...extra});
function freezeDeep(o){if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);for(const v of Object.values(o))freezeDeep(v);}return o;}

test('rectangular document dimensions and strict stored-pixel validation',()=>{
 const d=blank(2048,1);assert.equal(d.width,2048);assert.equal(d.height,1);assert.equal(renderFrame(d).length,8192);
 assert.equal(blank(4096,1).width,4096);assert.equal(blank(65535,1).width,65535);
 assert.throws(()=>blank(65536,1),EditorError);assert.throws(()=>blank(4096,4096),/pixel budget/);assert.throws(()=>blank(1,0),EditorError);
 assert.throws(()=>applyCommand(d,{type:'document.resize',width:4096,height:4096}),/pixel budget/);
 const bad=blank();bad.images.a={width:8,height:8,pixels:[red]};assert.throws(()=>normalizeDocument(bad),/pixel count/);
});

test('immutable linked cel edits, independent unlink and storage object identities',()=>{
 let d=run(blank(4),stroke(1,1),{type:'layer.add',layer:{id:'other',name:'Other'}},stroke(2,2,blue,{layerId:'other'}));
 const original=freezeDeep(d),unchangedImage=getCel(d,undefined,'other').image;
 d=run(d,{type:'frame.duplicate',linked:true});const second=d.frames[1].id;
 const firstImageId=getCel(d).cel.imageId;assert.equal(getCel(d,second).cel.imageId,firstImageId);
 d=applyCommand(d,stroke(0,0,green,{frameId:second}));assert.deepEqual(pixel(d,0,0),[0,255,0,255]);assert.deepEqual(pixel(original,0,0),[0,0,0,0]);
 assert.equal(getCel(d,undefined,'other').image,unchangedImage);
 assert.notEqual(getCel(d).image,getCel(original).image);
 d=run(d,{type:'cel.unlink',frameId:second,layerId:'layer-1'},stroke(0,0,red,{frameId:second}));
 assert.deepEqual(pixel(d,0,0),[0,255,0,255]);assert.deepEqual(pixel(d,0,0,second),[255,0,0,255]);
});

test('failed commands and failed batches preserve every input byte',()=>{
 const d=freezeDeep(run(blank(),stroke(1,1))),before=JSON.stringify(d);
 assert.throws(()=>applyCommand(d,{type:'draw.stroke',points:[{x:2,y:2}],color:'bad-color'}));
 assert.throws(()=>applyCommand(d,{type:'batch',commands:[stroke(2,2),{type:'frame.remove',frameId:'frame-1'}]}));
 assert.equal(JSON.stringify(d),before);assert.deepEqual(pixel(d,2,2),[0,0,0,0]);
});

test('group opacity is isolated; blend modes and hidden ancestors render correctly',()=>{
 let d=run(blank(1),{type:'layer.add',layer:{id:'group',type:'group',opacity:.5}},{type:'layer.update',layerId:'layer-1',patch:{parentId:'group'}},stroke(0,0,red),{type:'layer.add',layer:{id:'top',parentId:'group'}},stroke(0,0,blue,{layerId:'top'}));
 assert.deepEqual(pixel(d,0,0),[0,0,255,128]);
 d=run(d,{type:'layer.update',layerId:'group',patch:{opacity:1}},{type:'layer.update',layerId:'top',patch:{blendMode:'multiply'}});assert.deepEqual(pixel(d,0,0),[0,0,0,255]);
 d=applyCommand(d,{type:'layer.update',layerId:'group',patch:{visible:false}});assert.equal(painted(d),0);
 assert.throws(()=>applyCommand(d,{type:'layer.update',layerId:'group',patch:{parentId:'top'}}),/parent/);
});

test('locked ancestors prohibit edits and removal of their children',()=>{
 const d=run(blank(),{type:'layer.add',layer:{id:'group',type:'group'}},{type:'layer.update',layerId:'layer-1',patch:{parentId:'group'}},{type:'layer.update',layerId:'group',patch:{locked:true}});
 assert.throws(()=>applyCommand(d,stroke(0,0)),/locked/);assert.throws(()=>applyCommand(d,{type:'layer.remove',layerId:'layer-1'}),/locked/);
});

test('off-canvas line clipping, pixel-perfect corners, mirrored colored masks, pressure zero',()=>{
 let d=applyCommand(blank(8,4),{type:'draw.line',from:{x:-100,y:2},to:{x:100,y:2},color:red});assert.equal(painted(d),8);assert.deepEqual(pixel(d,0,2),[255,0,0,255]);
 d=applyCommand(blank(4),{type:'draw.stroke',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}],color:red,pixelPerfect:true});assert.equal(painted(d),2);assert.deepEqual(pixel(d,1,0),[0,0,0,0]);
 d=applyCommand(blank(6,3),stroke(1,1,red,{symmetry:'x',mask:{width:2,height:1,pixels:[1,1],colors:[red,blue]}}));assert.equal(painted(d),4);assert.deepEqual(pixel(d,0,1),[255,0,0,255]);assert.deepEqual(pixel(d,1,1),[0,0,255,255]);
 d=applyCommand(blank(),{type:'draw.stroke',points:[{x:1,y:1,pressure:0}],color:red});assert.equal(painted(d),0);
});

test('rectangle, ellipse, polygons, curves and bitmap text produce bounded raster art',()=>{
 let d=applyCommand(blank(12),{type:'draw.rect',x:1,y:1,width:5,height:4,color:red,filled:false});assert.equal(painted(d),14);assert.deepEqual(pixel(d,2,2),[0,0,0,0]);
 d=applyCommand(blank(12),{type:'draw.ellipse',x:2,y:2,width:5,height:5,color:red,filled:true});assert.deepEqual(pixel(d,4,4),[255,0,0,255]);assert.deepEqual(pixel(d,2,2),[0,0,0,0]);
 d=applyCommand(blank(12),{type:'draw.polygon',points:[{x:1,y:1},{x:9,y:1},{x:5,y:9}],filled:true,color:red});assert.deepEqual(pixel(d,5,4),[255,0,0,255]);
 d=applyCommand(blank(12),{type:'draw.curve',points:[{x:0,y:5},{x:3,y:0},{x:8,y:11},{x:11,y:5}],color:blue});assert.deepEqual(pixel(d,0,5),[0,0,255,255]);assert.deepEqual(pixel(d,11,5),[0,0,255,255]);
 d=applyCommand(blank(20,16),{type:'draw.text',x:1,y:1,text:'A\nB',color:red});assert.ok(painted(d)>25);assert.deepEqual(pixel(d,3,1),[255,0,0,255]);
});

test('contiguous flood fill respects islands, tolerance, masks, and transparent color',()=>{
 let d=run(blank(5,3),{type:'draw.line',from:{x:2,y:0},to:{x:2,y:2},color:white},{type:'draw.fill',x:0,y:0,color:red});assert.equal(painted(d),9);assert.deepEqual(pixel(d,4,0),[0,0,0,0]);
 d=applyCommand(d,{type:'draw.fill',x:0,y:0,color:null});assert.equal(painted(d),3);
 d=applyCommand(d,{type:'draw.fill',x:0,y:0,color:blue,contiguous:false});assert.equal(painted(d),15);
 const mask=buildSelection(d,{shape:'rect',x:0,y:0,width:1,height:1});d=applyCommand(d,{type:'draw.fill',x:0,y:0,color:red,selection:mask});assert.deepEqual(pixel(d,0,0),[255,0,0,255]);assert.deepEqual(pixel(d,1,0),[0,0,255,255]);
});

test('selection combinations, wand, ellipse and lasso are binary and canvas-sized',()=>{
 const d=run(blank(6),{type:'draw.rect',x:1,y:1,width:2,height:2,color:red,filled:true});
 const a=buildSelection(d,{shape:'rect',x:0,y:0,width:3,height:3}),b=buildSelection(d,{shape:'rect',x:2,y:2,width:3,height:3},a,'union');assert.equal(b.reduce((a,b)=>a+b),17);
 assert.equal(buildSelection(d,{shape:'rect',x:2,y:2,width:3,height:3},a,'intersect').reduce((a,b)=>a+b),1);
 assert.equal(buildSelection(d,{shape:'rect',x:2,y:2,width:3,height:3},a,'subtract').reduce((a,b)=>a+b),8);
 assert.ok(buildSelection(d,{shape:'rect',x:0,y:0,width:1,height:1},null,'union').every(v=>v===0||v===1));
 assert.equal(buildSelection(d,{shape:'wand',x:1,y:1}).reduce((a,b)=>a+b),4);
 assert.ok(buildSelection(d,{shape:'ellipse',x:0,y:0,width:5,height:5}).reduce((a,b)=>a+b)>10);
 assert.ok(buildSelection(d,{shape:'lasso',points:[{x:0,y:0},{x:5,y:0},{x:2,y:5}]}).reduce((a,b)=>a+b)>10);
});

test('selection move/copy/flip/rotate and nearest scaling preserve expected positions',()=>{
 const d=run(blank(8),stroke(1,1,red),stroke(2,1,blue));const selection=buildSelection(d,{shape:'rect',x:1,y:1,width:2,height:1});
 const moved=applyCommand(d,{type:'selection.transform',selection,operation:'move',dx:3,dy:2});assert.deepEqual(pixel(moved,1,1),[0,0,0,0]);assert.deepEqual(pixel(moved,4,3),[255,0,0,255]);
 const copy=applyCommand(d,{type:'selection.transform',selection,operation:'move',dx:3,copy:true});assert.equal(painted(copy),4);
 const flip=applyCommand(d,{type:'selection.transform',selection,operation:'flipX'});assert.deepEqual(pixel(flip,1,1),[0,0,255,255]);
 const rotated=applyCommand(d,{type:'selection.transform',selection,operation:'rotate',angle:180});assert.deepEqual(pixel(rotated,1,1),[0,0,255,255]);
 const scaled=applyCommand(d,{type:'selection.transform',selection,operation:'scale',scaleX:2,scaleY:2});assert.equal(painted(scaled),8);
});

test('indexed palette edits recolor without rewriting images, remaps retain color appearance',()=>{
 let d=run(blank(2,1,{colorMode:'indexed',palette:[red,blue]}),stroke(0,0,0),stroke(1,0,1));const oldImage=getCel(d).image;
 d=applyCommand(d,{type:'palette.update',palette:[green,blue]});assert.equal(getCel(d).image,oldImage);assert.deepEqual(pixel(d,0,0),[0,255,0,255]);
 d=applyCommand(d,{type:'palette.remap',palette:[blue,green],mapping:[1,0]});assert.deepEqual(getCel(d).image.pixels,[1,0]);assert.deepEqual(pixel(d,0,0),[0,255,0,255]);
 assert.throws(()=>applyCommand(d,{type:'palette.update',palette:[white]}),/remapping/);
 d=applyCommand(d,{type:'palette.remap',palette:[blue],mapping:[0,null]});assert.deepEqual(pixel(d,0,0),[0,0,0,0]);
});

test('RGBA, indexed, grayscale conversions and alpha survive rendering',()=>{
 let d=run(blank(2,1,{palette:[red,blue]}),stroke(0,0,red),stroke(1,0,'#0000ff80'));
 d=applyCommand(d,{type:'document.colorMode',colorMode:'grayscale'});const gray=pixel(d,0,0);assert.equal(gray[0],gray[1]);assert.equal(gray[1],gray[2]);assert.equal(pixel(d,1,0)[3],128);
 d=applyCommand(d,{type:'document.colorMode',colorMode:'indexed'});assert.ok(getCel(d).image.pixels.every(p=>Number.isInteger(p)));
 d=applyCommand(d,{type:'document.colorMode',colorMode:'rgba'});assert.ok(getCel(d).image.pixels.every(p=>typeof p==='string'));
});

test('RGBA gradient endpoints, ordered dithering and shading ink',()=>{
 let d=applyCommand(blank(5,1),{type:'draw.gradient',from:{x:0,y:0},to:{x:4,y:0},color:black,endColor:white});assert.deepEqual(pixel(d,0,0),[0,0,0,255]);assert.deepEqual(pixel(d,4,0),[255,255,255,255]);assert.deepEqual(pixel(d,2,0),[128,128,128,255]);
 d=applyCommand(blank(8,8),{type:'draw.gradient',from:{x:0,y:0},to:{x:7,y:0},color:red,endColor:blue,dither:true});assert.ok(getCel(d).image.pixels.every(p=>p===red||p===blue));
 d=run(blank(1),stroke(0,0,'#808080ff'),stroke(0,0,red,{ink:'lighten',amount:.1}));assert.ok(pixel(d,0,0)[0]>128);assert.equal(pixel(d,0,0)[0],pixel(d,0,0)[1]);
});

test('effects replace alpha, add outline and apply meaningful convolution and hue',()=>{
 const d=run(blank(5),stroke(2,2,red));let e=applyCommand(d,{type:'effect.apply',effect:'outline',color:blue,radius:1});assert.equal(painted(e),9);assert.deepEqual(pixel(e,2,2),[255,0,0,255]);
 e=applyCommand(d,{type:'effect.apply',effect:'replace',fromColor:red,toColor:null});assert.equal(painted(e),0);
 e=applyCommand(d,{type:'effect.apply',effect:'hue',amount:120});assert.deepEqual(pixel(e,2,2),[0,255,0,255]);
 e=applyCommand(d,{type:'effect.apply',effect:'saturation',amount:-1});assert.deepEqual(pixel(e,2,2),[128,128,128,255]);
 e=applyCommand(d,{type:'effect.apply',effect:'convolution',kernel:[1,1,1,1,1,1,1,1,1],divisor:9,affectAlpha:true});assert.equal(painted(e),9);assert.equal(pixel(e,2,2)[3],28);
 e=applyCommand(d,{type:'effect.apply',effect:'despeckle'});assert.equal(painted(e),0);
 assert.throws(()=>applyCommand(d,{type:'effect.apply',effect:'convolution',kernel:[1,2]}));
});

test('frame range commands repair clips, preserve linked images and durations',()=>{
 let d=run(blank(),stroke(1,1),{type:'frame.duplicate',linked:true},{type:'frame.duplicate',frameId:'frame-1',linked:false});assert.equal(d.frames.length,3);
 const ids=d.frames.map(f=>f.id);d=run(d,{type:'frame.update',frameIds:ids,patch:{durationMs:222}},{type:'clip.add',clip:{id:'walk',name:'walk',frameIds:ids,direction:'pingpong'}},{type:'frame.reverse',frameIds:ids});assert.equal(d.frames[0].id,ids[2]);assert.equal(describeDocument(d).durationMs,666);
 d=applyCommand(d,{type:'frame.reorder',frameIds:[ids[0]],index:0});assert.equal(d.frames[0].id,ids[0]);
 d=applyCommand(d,{type:'frame.remove',frameIds:[ids[1]]});assert.ok(!d.clips.find(c=>c.id==='walk').frameIds.includes(ids[1]));
});

test('baked tweens have independent cels; linked tween retains shared source and exact endpoints',()=>{
 let d=run(blank(12),stroke(1,1),{type:'frame.add'},{type:'frame.add'});const frameIds=d.frames.map(f=>f.id);
 const baked=applyCommand(d,{type:'animation.tween',frameIds,layerId:'layer-1',from:{x:0,y:0},to:{x:6,y:4,opacity:.5},easing:'easeInOut'});assert.equal(new Set(baked.frames.map(f=>f.cels['layer-1'].imageId)).size,3);assert.equal(getCel(baked,frameIds[1]).cel.x,3);assert.equal(getCel(baked,frameIds[2]).cel.opacity,.5);
 const linked=applyCommand(d,{type:'animation.tween',frameIds,layerId:'layer-1',to:{x:6},bake:false});assert.equal(new Set(linked.frames.map(f=>f.cels['layer-1'].imageId)).size,1);assert.deepEqual(pixel(linked,7,1,frameIds[2]),[255,0,0,255]);
});

test('seeded particle bakes replay exactly and vary with seed',()=>{
 const d=run(blank(32),{type:'frame.add',durationMs:200},{type:'frame.add',durationMs:200});const frameIds=d.frames.map(f=>f.id),command={type:'animation.particles',layerId:'layer-1',frameIds,seed:123,count:12,x:16,y:16,speed:15,lifetime:2,color:red};
 const a=applyCommand(d,command),b=applyCommand(d,command),different=applyCommand(d,{...command,seed:456});assert.deepEqual(a,b);assert.notDeepEqual(renderFrame(a,frameIds[2]),renderFrame(different,frameIds[2]));assert.ok(a.metadata.motion['last-particles']);
});

test('independent tilemap painting, tile rotations and editing references',()=>{
 let d=run(blank(4,2),{type:'tileset.add',tileset:{id:'terrain',tileWidth:2,tileHeight:2,tiles:[{id:'a',pixels:[red,blue,green,white]}]}},{type:'layer.add',layer:{id:'map',type:'tilemap'}},{type:'tilemap.paint',layerId:'map',tilesetId:'terrain',columns:2,rows:1,points:[{x:0,y:0,tileId:'a'},{x:1,y:0,tileId:'a',rotate:90}]});
 assert.deepEqual(pixel(d,0,0),[255,0,0,255]);assert.deepEqual(pixel(d,2,0),[0,255,0,255]);assert.deepEqual(pixel(d,3,0),[255,0,0,255]);
 const source=freezeDeep(d);d=applyCommand(d,{type:'tilemap.paint',layerId:'map',points:[{x:0,y:0,tileId:null}]});assert.equal(painted(d),4);assert.equal(painted(source),8);
 assert.throws(()=>applyCommand(d,{type:'tileset.remove',tilesetId:'terrain'}),/used/);
});

test('canvas expansion, nearest resampling and offset cel editing keep artwork',()=>{
 let d=run(blank(3,2),stroke(0,0),{type:'document.resize',width:5,height:4,mode:'canvas',anchor:'center'});assert.deepEqual(pixel(d,1,1),[255,0,0,255]);
 d=applyCommand(d,stroke(4,3,blue));assert.deepEqual(pixel(d,4,3),[0,0,255,255]);
 d=applyCommand(d,{type:'document.resize',width:10,height:8,mode:'scale'});assert.deepEqual(pixel(d,2,2),[255,0,0,255]);assert.deepEqual(pixel(d,9,7),[0,0,255,255]);
});

test('legacy v3 compact, runtime and v1 square sprites migrate with layers and clips',()=>{
 const compact={format:'pixelwall-project',version:3,name:'Legacy',size:2,colors:['#ff0000'],bytesPerIndex:1,layers:[{id:1,name:'base',opacity:50}],frames:[{id:1,durationMs:100,cels:[{layerId:1,data:Buffer.from([1,0,0,1]).toString('base64')}]}],clips:[{id:1,name:'default',frameIds:[1]}],palette:['#ff0000']};
 const d=migrateLegacy(compact);assert.equal(d.version,4);assert.equal(d.layers[0].opacity,.5);assert.deepEqual(pixel(d,0,0),[255,0,0,128]);
 const raw=migrateLegacy({size:2,frames:[{id:3,pixels:['#00ff00',null,null,null]}]});assert.deepEqual(pixel(raw,0,0),[0,255,0,255]);
});

test('Aseprite frame palettes, transparent index, background flags and animated slice extras survive',()=>{
 let d=run(blank(2,1,{colorMode:'indexed',palette:[red,blue]}),stroke(0,0,0),{type:'frame.duplicate',linked:true});d.metadata.aseprite={transparentIndex:0,colorProfile:{type:1,flags:0,gamma:1}};d.frames[1].palette=[green,blue];d.slices=[{id:'animated',name:'slice',keys:[{frameId:d.frames[0].id,x:-1,y:0,width:0,height:1}]}];
 d=normalizeDocument(d);assert.equal(pixel(d,0,0)[3],0);d.layers[0].asepriteFlags=8;assert.deepEqual(pixel(d,0,0,d.frames[1].id),[0,255,0,255]);const edited=applyCommand(d,{type:'document.update',patch:{name:'Renamed'}});assert.deepEqual(edited.metadata.aseprite,d.metadata.aseprite);assert.deepEqual(edited.slices,d.slices);
});

test('Aseprite atlas tile ids ignore display-only baseIndex and diagonal means transpose',()=>{
 let d=blank(2);d.layers=[{...d.layers[0],type:'tilemap',tilesetId:'ts'}];d.images={atlas:{width:2,height:2,pixels:[red,blue,green,white]},map:{width:1,height:1,pixels:[],tilemap:{idMask:0x1fffffff,xFlipMask:0x80000000,yFlipMask:0x40000000,diagonalFlipMask:0x20000000,tiles:[0x20000000]}}};d.frames[0].cels={'layer-1':{imageId:'map',x:0,y:0,opacity:1}};d.tilesets=[{id:'ts',tileWidth:2,tileHeight:2,tileCount:1,baseIndex:100,flags:0,imageId:'atlas'}];d=normalizeDocument(d);assert.deepEqual(pixel(d,0,0),[255,0,0,255]);assert.deepEqual(pixel(d,1,0),[0,255,0,255]);assert.deepEqual(pixel(d,0,1),[0,0,255,255]);
});

test('cel import detaches linked edits and respects grayscale storage',()=>{
 const d=run(blank(2),stroke(0,0),{type:'frame.duplicate',linked:true});const second=d.frames[1].id;
 const replaced=applyCommand(d,{type:'cel.set',frameId:second,width:1,height:1,pixels:[blue],x:1,y:1});assert.deepEqual(pixel(replaced,0,0),[255,0,0,255]);assert.deepEqual(pixel(replaced,1,1,second),[0,0,255,255]);assert.notEqual(getCel(replaced).cel.imageId,getCel(replaced,second).cel.imageId);
});

test('slice and clip CRUD, layer reorder and remove, cel move/clear are executable',()=>{
 let d=run(blank(8),{type:'document.update',patch:{name:'Test'}},{type:'slice.add',slice:{id:'s',bounds:{x:0,y:0,width:4,height:4},pivot:{x:2,y:2},ninePatch:{left:1,right:1,top:1,bottom:1}}},{type:'slice.update',sliceId:'s',patch:{name:'slice'}},{type:'clip.update',clipId:'clip-1',patch:{direction:'reverse'}},stroke(1,1),{type:'cel.move',x:2,y:1,layerId:'layer-1'},{type:'layer.add',layer:{id:'second'}},{type:'layer.reorder',layerId:'second',index:0});assert.equal(d.name,'Test');assert.deepEqual(pixel(d,3,2),[255,0,0,255]);assert.equal(d.layers[0].id,'second');
 d=run(d,{type:'layer.remove',layerId:'second'},{type:'cel.clear',layerId:'layer-1'},{type:'slice.remove',sliceId:'s'},{type:'clip.remove',clipId:'clip-1'});assert.equal(painted(d),0);assert.equal(d.slices.length,0);assert.equal(d.clips.length,0);
 assert.ok(COMMANDS.length>40);assert.equal(new Set(COMMANDS.map(c=>c.type)).size,COMMANDS.length);assert.ok(COMMANDS.every(c=>c.description&&Object.keys(c.parameters).length));
});

test('seamless wrapped strokes cross tile edges; disabled pressure keeps requested size',()=>{
 let d=applyCommand(blank(8,4),{type:'draw.line',from:{x:7,y:1},to:{x:10,y:1},color:red,wrap:'x'});assert.equal(painted(d),4);assert.deepEqual(pixel(d,0,1),[255,0,0,255]);assert.deepEqual(pixel(d,2,1),[255,0,0,255]);
 d=applyCommand(blank(8),{...stroke(0,0),size:3,wrap:'both'});assert.equal(painted(d),9);assert.deepEqual(pixel(d,7,7),[255,0,0,255]);
 d=applyCommand(blank(8),{type:'draw.stroke',points:[{x:4,y:4,pressure:.1}],size:5,pressure:false,color:red});assert.equal(painted(d),25);
});

test('pixel-safe rotation preserves the palette and exact right-angle transforms',()=>{
 const d=run(blank(10),{type:'draw.rect',x:3,y:3,width:4,height:4,filled:true,color:red},stroke(4,4,blue)),selection=buildSelection(d,{shape:'rect',x:3,y:3,width:4,height:4});
 const nearest=applyCommand(d,{type:'selection.transform',selection,operation:'rotate',angle:90}),safe=applyCommand(d,{type:'selection.transform',selection,operation:'rotate',angle:90,method:'pixel-safe'});assert.deepEqual(renderFrame(safe),renderFrame(nearest));
 const diagonal=applyCommand(d,{type:'selection.transform',selection,operation:'rotate',angle:35,method:'pixel-safe'});assert.ok(getCel(diagonal).image.pixels.every(p=>[null,red,blue].includes(p)));assert.ok(painted(diagonal)>8);
 assert.throws(()=>applyCommand(d,{type:'selection.transform',selection,operation:'move',method:'pixel-safe'}),/rotation/);
});

test('image stamping preserves existing cel, alpha blends, and optionally replaces transparent pixels',()=>{
 const d=run(blank(4,2),{type:'draw.rect',x:0,y:0,width:4,height:2,filled:true,color:blue});
 const pasted=applyCommand(d,{type:'image.stamp',width:2,height:1,pixels:[red,null],x:1,y:0});assert.equal(pasted.layers.length,1);assert.deepEqual(pixel(pasted,1,0),[255,0,0,255]);assert.deepEqual(pixel(pasted,2,0),[0,0,255,255]);assert.deepEqual(pixel(d,1,0),[0,0,255,255]);
 const replaced=applyCommand(pasted,{type:'image.stamp',width:1,height:1,pixels:[null],x:2,y:0,transparent:'replace'});assert.equal(pixel(replaced,2,0)[3],0);
 const blended=applyCommand(d,{type:'image.stamp',width:1,height:1,pixels:['#ff000080'],x:0,y:0});assert.deepEqual(pixel(blended,0,0),[128,0,127,255]);
});

test('manual tile edits update all shared instances; auto reuses and stack creates independent tiles',()=>{
 const d=run(blank(4,2),{type:'tileset.add',tileset:{id:'ts',tileWidth:2,tileHeight:2,tiles:[{id:'base',pixels:[red,red,red,red]}]}},{type:'layer.add',layer:{id:'map',type:'tilemap'}},{type:'tilemap.paint',layerId:'map',tilesetId:'ts',points:[{x:0,y:0,tileId:'base'},{x:1,y:0,tileId:'base'}]});
 const manual=applyCommand(d,{type:'tilemap.edit',layerId:'map',x:0,y:0,mode:'manual',pixels:[blue,blue,blue,blue]});assert.deepEqual(pixel(manual,2,0),[0,0,255,255]);assert.equal(manual.tilesets[0].tiles.length,1);assert.deepEqual(pixel(d,2,0),[255,0,0,255]);
 const automatic=applyCommand(d,{type:'tilemap.edit',layerId:'map',x:0,y:0,mode:'auto',pixels:[red,red,red,red]});assert.equal(automatic.tilesets[0].tiles.length,1);
 const changed=applyCommand(d,{type:'tilemap.edit',layerId:'map',x:0,y:0,mode:'auto',pixels:[blue,blue,blue,blue]});assert.equal(changed.tilesets[0].tiles.length,2);assert.deepEqual(pixel(changed,2,0),[255,0,0,255]);
 const stacked=applyCommand(d,{type:'tilemap.edit',layerId:'map',x:0,y:0,mode:'stack',pixels:[red,red,red,red]});assert.equal(stacked.tilesets[0].tiles.length,2);
});

test('layer duplication copies group hierarchy and preserves internal cel links; merge preserves RGBA result',()=>{
 let d=run(blank(3),{type:'layer.add',layer:{id:'g',type:'group'}},{type:'layer.update',layerId:'layer-1',patch:{parentId:'g'}},stroke(1,1),{type:'frame.duplicate',linked:true});
 const duplicated=applyCommand(d,{type:'layer.duplicate',layerId:'g'});assert.equal(duplicated.layers.length,4);const group=duplicated.layers.find(l=>l.name==='Layer 2 copy'),copy=duplicated.layers.find(l=>l.parentId===group.id);assert.notEqual(duplicated.frames[0].cels[copy.id].imageId,d.frames[0].cels['layer-1'].imageId);assert.equal(duplicated.frames[0].cels[copy.id].imageId,duplicated.frames[1].cels[copy.id].imageId);
 d=run(blank(3),stroke(1,1,blue),{type:'layer.add',layer:{id:'top',opacity:.5}},stroke(1,1,red,{layerId:'top'}),{type:'frame.duplicate',linked:true});const before=d.frames.map(f=>renderFrame(d,f.id)),merged=applyCommand(d,{type:'layer.mergeDown',layerId:'top'});assert.equal(merged.layers.length,1);merged.frames.forEach((f,i)=>assert.deepEqual(renderFrame(merged,f.id),before[i]));
});

test('precise Aseprite bounds scale cels and zIndex moves a cel above a higher layer',()=>{
 let d=run(blank(4),{type:'cel.set',width:1,height:1,pixels:[red]}, {type:'layer.add',layer:{id:'top'}},stroke(0,0,blue,{layerId:'top'}));d.frames[0].cels['layer-1'].preciseBounds={flags:1,x:0,y:0,width:2,height:2};d.frames[0].cels['layer-1'].zIndex=2;
 assert.deepEqual(pixel(d,0,0),[255,0,0,255]);assert.deepEqual(pixel(d,1,1),[255,0,0,255]);assert.equal(pixel(d,2,2)[3],0);
});

test('document identifiers are unique and inspection supplies usable editing references',()=>{
 const a=blank(),b=blank();assert.notEqual(a.id,b.id);const info=describeDocument(a);assert.equal(info.layerList[0].id,'layer-1');assert.equal(info.frameList[0].id,'frame-1');assert.equal(info.clipList[0].id,'clip-1');
});

test('native atlas tiles become editable on demand without copying the whole atlas',()=>{
 let d=blank(4,2);d.layers=[{...d.layers[0],type:'tilemap',tilesetId:'ts'}];d.images={atlas:{width:2,height:4,pixels:[red,red,red,red,blue,blue,blue,blue]},map:{width:2,height:1,pixels:[],tilemap:{idMask:0x1fffffff,tiles:[0,1]}}};d.frames[0].cels={'layer-1':{imageId:'map',x:0,y:0,opacity:1}};d.tilesets=[{id:'ts',tileWidth:2,tileHeight:2,tileCount:2,baseIndex:10,flags:0,imageId:'atlas'}];d=normalizeDocument(d);const atlas=d.images.atlas,map=d.images.map;
 assert.equal(Object.keys(d.images).length,2);assert.equal(d.tilesets[0].tiles[1].asepriteTileId,1);assert.deepEqual(getTile(d,'ts','ase-tile-1').pixels,[blue,blue,blue,blue]);
 const edited=applyCommand(d,{type:'tilemap.paint',layerId:'layer-1',points:[{x:0,y:0,tileId:'ase-tile-1'}]});assert.deepEqual(pixel(edited,0,0),[0,0,255,255]);assert.equal(edited.images.atlas,atlas);assert.equal(edited.images.map,map);assert.equal(edited.layers[0].tilemaps['frame-1'].sourceImageId,'map');
 const manual=applyCommand(d,{type:'tilemap.edit',layerId:'layer-1',x:0,y:0,mode:'manual',pixels:[green,green,green,green]});assert.deepEqual(pixel(manual,0,0),[0,255,0,255]);assert.deepEqual(pixel(manual,2,0),[0,0,255,255]);assert.deepEqual(pixel(d,0,0),[255,0,0,255]);assert.equal(manual.images.atlas.height,4);
});

test('irrelevant effect amount is ignored; RGBA palette remap can clear a chosen entry',()=>{
 let d=run(blank(5),stroke(2,2,red));d=applyCommand(d,{type:'effect.apply',effect:'outline',amount:20,color:blue});assert.equal(painted(d),9);
 d=run(blank(2,1,{palette:[red,blue]}),stroke(0,0,red),stroke(1,0,blue),{type:'palette.remap',palette:[blue],mapping:[null,0]});assert.equal(pixel(d,0,0)[3],0);assert.deepEqual(pixel(d,1,0),[0,0,255,255]);
});

test('image stamps edit linked cels once and preserve original snapshot identities',()=>{
 const d=freezeDeep(run(blank(2),stroke(0,0,red),{type:'frame.duplicate',linked:true})),second=d.frames[1].id;
 const pasted=applyCommand(d,{type:'image.stamp',frameId:second,width:1,height:1,pixels:[blue],x:1,y:1});assert.equal(getCel(pasted).cel.imageId,getCel(pasted,second).cel.imageId);assert.deepEqual(pixel(pasted,1,1),[0,0,255,255]);assert.deepEqual(pixel(d,1,1),[0,0,0,0]);assert.notEqual(getCel(pasted).image,getCel(d).image);
});

test('validation cache does not permit indexed palette truncation and exact cel bounds rasterize before drawing',()=>{
 let indexed=run(blank(2,1,{colorMode:'indexed',palette:[red,blue]}),stroke(0,0,1));assert.throws(()=>applyCommand(indexed,{type:'palette.update',palette:[red]}),/remapping/);
 let d=run(blank(4),{type:'cel.set',width:1,height:1,pixels:[red]});d.frames[0].cels['layer-1'].preciseBounds={flags:1,x:0,y:0,width:2,height:2};d=normalizeDocument(d);const edited=applyCommand(d,stroke(3,3,blue));assert.deepEqual(pixel(edited,1,1),[255,0,0,255]);assert.deepEqual(pixel(edited,3,3),[0,0,255,255]);assert.equal(getCel(edited).cel.preciseBounds.flags&1,0);assert.equal(getCel(d).cel.preciseBounds.flags&1,1);
});

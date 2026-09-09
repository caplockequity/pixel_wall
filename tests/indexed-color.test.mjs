import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quantizePalette, mapIndexedImage, indexedConversionOptions } from '../app/indexed-color.mjs';
import { createDocument, applyCommand, normalizeDocument, getCel, renderFrame } from '../app/editor-core.mjs';
import { readAseprite, writeAseprite } from '../app/formats.mjs';
const clear='#00000000', black='#000000ff', white='#ffffffff', red='#ff0000ff', green='#00ff00ff', blue='#0000ffff';
const raster=(width,height,value)=>({width,height,pixels:Array(width*height).fill(value)});
const native=doc=>normalizeDocument(readAseprite(writeAseprite(doc)).document);
const run=(doc,...commands)=>commands.reduce((state,command)=>applyCommand(state,command),doc);
const pixels=doc=>doc.frames.map(frame=>Array.from(renderFrame(doc,frame.id)));

test('generated palettes retain exact colors, partial alpha and a reserved transparent slot within budget',()=>{
 const samples=[red,red,green,blue,'#ff000080',null,'#abcdef00'];
 const first=quantizePalette(samples,{maxColors:8});
 assert.deepEqual(new Set(first),new Set([clear,red,green,blue,'#ff000080']));
 assert.deepEqual(quantizePalette(samples,{maxColors:8}),first);
 assert.equal(first[0],clear);
 const opaque=quantizePalette(samples,{maxColors:8,withAlpha:false});
 assert.deepEqual(new Set(opaque),new Set([clear,red,green,blue]));
 const shifted=quantizePalette([red,green],{maxColors:8,transparentIndex:5});
 assert.equal(shifted[5],clear);assert.ok(shifted.includes(red));assert.ok(shifted.includes(green));
});

test('median cut weights repeated colors and remains bounded on high-color input',()=>{
 const weighted=quantizePalette([...Array(100).fill(red),blue],{maxColors:2});
 assert.equal(weighted[1],'#fc0003ff');
 function* many(){for(let index=0;index<70000;index++)yield '#'+(index*12347%16777216).toString(16).padStart(6,'0')+'ff';}
 const palette=quantizePalette(many(),{maxColors:16});
 assert.ok(palette.length<=16);assert.ok(palette.length>8);
 assert.deepEqual(palette,quantizePalette(many(),{maxColors:16}));
});

test('Bayer matrices reproduce expected ordered tone coverage without changing opaque alpha',()=>{
 for(const size of [2,4,8]){
  const output=mapIndexedImage(raster(size,size,'#808080ff'),[clear,black,white],{dithering:'ordered',ditherMatrix:`bayer${size}x${size}`,transparentIndex:0});
  assert.equal(output.filter(index=>index===2).length,size*size/2);
  assert.equal(output.filter(index=>index===null).length,0);
 }
 assert.deepEqual(mapIndexedImage(raster(2,2,'#808080ff'),[clear,black,white],{dithering:'ordered',ditherMatrix:'bayer2x2',transparentIndex:0}),[2,1,1,2]);
});

test('Floyd–Steinberg preserves average tone and transparent gaps stop carrying error',()=>{
 const image=raster(32,32,'#606060ff'),palette=[clear,black,white];
 const output=mapIndexedImage(image,palette,{dithering:'floyd-steinberg',transparentIndex:0});
 const average=255*output.filter(value=>value===2).length/output.length;
 assert.ok(Math.abs(average-96)<3,`average ${average}`);
 const split={width:3,height:1,pixels:['#606060ff',null,'#606060ff']};
 assert.deepEqual(mapIndexedImage(split,palette,{dithering:'floyd-steinberg',transparentIndex:0}),[1,null,1]);
});

test('zero dither strength exactly matches nearest remapping for all named methods',()=>{
 const image={width:4,height:1,pixels:['#404040ff','#808080ff','#a0a0a0ff',null]},palette=[clear,black,white];
 const expected=mapIndexedImage(image,palette,{transparentIndex:0});
 for(const dithering of ['ordered','floyd-steinberg'])assert.deepEqual(mapIndexedImage(image,palette,{dithering,ditherStrength:0,transparentIndex:0}),expected);
});

test('exact partial-alpha matches survive and invisible RGB never leaks into generated entries',()=>{
 const palette=[clear,'#ff000080',red],image={width:3,height:1,pixels:['#ff000080',red,'#ffff0000']};
 for(const dithering of ['none','ordered','floyd-steinberg'])assert.deepEqual(mapIndexedImage(image,palette,{dithering,transparentIndex:0}),[1,2,null]);
 assert.deepEqual(quantizePalette([null,'#12345600'],{maxColors:8}),[clear]);
});

test('native atlas tiles reset Bayer origins and diffusion state independently',()=>{
 const tile=raster(3,2,'#808080ff'),atlas=raster(3,4,'#808080ff'),palette=[clear,black,white];
 for(const dithering of ['ordered','floyd-steinberg']){
  const expected=mapIndexedImage(tile,palette,{dithering,transparentIndex:0});
  const actual=mapIndexedImage(atlas,palette,{dithering,transparentIndex:0,tileWidth:3,tileHeight:2});
  assert.deepEqual(actual,[...expected,...expected]);
 }
});

test('invalid algorithms, dimensions, indices and work exhaustion reject explicitly',()=>{
 assert.throws(()=>indexedConversionOptions({quantization:'unknown'}),/quantization/);
 assert.throws(()=>indexedConversionOptions({dithering:'unknown'}),/dithering/);
 assert.throws(()=>indexedConversionOptions({ditherStrength:NaN}),/strength/);
 assert.throws(()=>quantizePalette([red],{maxColors:4,transparentIndex:4}),/transparent index/);
 assert.throws(()=>mapIndexedImage(raster(2,2,red),[clear,red],{tileWidth:3}),/tile width/);
 assert.throws(()=>mapIndexedImage(raster(2,2,red),[clear,red],{budget:{remaining:1}}),/work limit/);
 assert.throws(()=>mapIndexedImage(raster(2,2,red),[clear],{transparentIndex:0}),/no visible color/);
});

test('global palette generation includes hidden layers, all frame palettes and unused tiles',()=>{
 let doc=createDocument({width:1,height:1,colorMode:'indexed',palette:[clear,red]});
 doc=run(doc,{type:'cel.set',width:1,height:1,pixels:[1]},{type:'frame.duplicate',linked:true},{type:'tileset.add',tileset:{id:'unused',tileWidth:1,tileHeight:1,tiles:[{id:'blue',pixels:[blue]}]}});
 // Add blue using an explicitly larger source palette so unused indexed tile stores the real color.
 doc.palette=[clear,red,blue];doc.frames[1].palette=[clear,green,blue];doc.images[doc.tilesets[0].tiles[0].imageId].pixels=[2];
 doc.layers[0].visible=false;doc=normalizeDocument(doc);const before=JSON.stringify(doc);
 const result=applyCommand(doc,{type:'document.colorMode',colorMode:'indexed',paletteMode:'generate',maxColors:8});
 assert.deepEqual(new Set(result.palette),new Set([clear,red,green,blue]));
 assert.equal(result.layers[0].visible,false);assert.equal(JSON.stringify(doc),before);
 assert.notEqual(getCel(result,result.frames[0].id).cel.imageId,getCel(result,result.frames[1].id).cel.imageId);
 assert.deepEqual(pixels(native(result)),pixels(result));
});

test('existing per-frame palettes split linked images only when actual mapped indices differ',()=>{
 let doc=createDocument({width:2,height:1,palette:[clear,black,white]});
 doc=run(doc,{type:'cel.set',width:2,height:1,pixels:['#808080ff','#303030ff']},{type:'frame.duplicate',linked:true},{type:'frame.duplicate',frameId:'frame-1',linked:true});
 doc.frames[1].palette=[clear,white,black];doc.frames[2].palette=[clear,black,white];doc=normalizeDocument(doc);
 const result=applyCommand(doc,{type:'document.colorMode',colorMode:'indexed',dithering:'none'});
 assert.notEqual(getCel(result,result.frames[0].id).cel.imageId,getCel(result,result.frames[1].id).cel.imageId);
 assert.equal(getCel(result,result.frames[0].id).cel.imageId,getCel(result,result.frames[2].id).cel.imageId);
 assert.deepEqual(pixels(native(result)),pixels(result));
});

test('background and transparent indexed contexts remain distinct during regenerated palette conversion',()=>{
 let doc=createDocument({width:1,height:1,colorMode:'indexed',palette:[red,green]});
 doc=run(doc,{type:'cel.set',width:1,height:1,pixels:[0]},{type:'layer.add',layer:{id:'background',asepriteFlags:8}});
 doc.frames[0].cels.background={...doc.frames[0].cels['layer-1']};doc.metadata.aseprite={transparentIndex:0};doc=normalizeDocument(doc);
 const result=applyCommand(doc,{type:'document.colorMode',colorMode:'indexed',paletteMode:'generate',maxColors:8});
 assert.deepEqual(getCel(result,undefined,'layer-1').image.pixels,[null]);
 assert.equal(result.palette[getCel(result,undefined,'background').image.pixels[0]],red);
 assert.deepEqual(pixels(result),pixels(doc));assert.deepEqual(pixels(native(result)),pixels(doc));
});

test('generated conversion retains editable transformed native tilemaps and all-frame appearance',()=>{
 let doc=createDocument({width:2,height:2,palette:[clear,red,blue]});
 doc=run(doc,{type:'tileset.add',tileset:{id:'tiles',tileWidth:2,tileHeight:2,tiles:[{id:'tile',pixels:[red,blue,null,red]}]}},{type:'layer.add',layer:{id:'map',type:'tilemap',tilesetId:'tiles'}},{type:'tilemap.paint',layerId:'map',points:[{x:0,y:0,tileId:'tile',flipX:true,rotate:90}]},{type:'frame.duplicate',linked:true});
 doc=native(doc);const expected=pixels(doc);
 const result=applyCommand(doc,{type:'document.colorMode',colorMode:'indexed',paletteMode:'generate',maxColors:8,dithering:'floyd-steinberg'});
 assert.deepEqual(pixels(result),expected);assert.deepEqual(pixels(native(result)),expected);
 assert.equal(result.tilesets.length,1);assert.equal(result.layers.find(layer=>layer.id==='layer-2').type,'tilemap');
});

test('new options preserve input atomically on incompatible palette or mode requests',()=>{
 const doc=applyCommand(createDocument({width:1,height:1}),{type:'cel.set',width:1,height:1,pixels:[red]}),before=JSON.stringify(doc);
 assert.throws(()=>applyCommand(doc,{type:'document.colorMode',colorMode:'rgba',dithering:'ordered'}),/require indexed/);
 assert.throws(()=>applyCommand(doc,{type:'document.colorMode',colorMode:'indexed',paletteMode:'generate',maxColors:1}),/color limit/);
 assert.equal(JSON.stringify(doc),before);
});


const oracle=JSON.parse(readFileSync(new URL('./fixtures/indexed-conversion-oracle.json',import.meta.url)));
for(const job of oracle.jobs)test(`independent Aseprite fixture: ${job.name} native reopen and measured algorithm distinction`,()=>{
 const source=readAseprite(Buffer.from(job.source,'base64')).document;
 const actual=applyCommand(source,job.command),expected=Buffer.from(job.pixelwallRGBA,'base64');
 assert.deepEqual(Buffer.from(renderFrame(actual)),expected);
 assert.deepEqual(Buffer.from(renderFrame(native(actual))),expected);
 const aseprite=readAseprite(Buffer.from(job.asepriteIndexed,'base64')).document;
 assert.deepEqual(Buffer.from(renderFrame(aseprite)),Buffer.from(job.asepriteRGBA,'base64'));
 if(job.name==='none')assert.deepEqual(expected,Buffer.from(job.asepriteRGBA,'base64'));
 if(job.cliMatches!==null)assert.equal(job.cliMatches,true);
 assert.ok(actual.palette.length<=256);
});

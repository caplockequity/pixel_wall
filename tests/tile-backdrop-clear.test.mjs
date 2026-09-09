import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unzlibSync,unzipSync} from 'fflate';
import {createDocument,applyCommand,normalizeDocument,renderFrame} from '../app/editor-core.mjs';
import {readAseprite,writeAseprite,makeGamePackage,readPng} from '../app/formats.mjs';
import {renderScaledExportFrame} from '../app/export-render.mjs';
import {scaleExportDocument} from '../app/export-scale.mjs';
import {TILE_BACKDROP_CLEAR} from '../app/tile-render-flags.mjs';
const oracle=JSON.parse(readFileSync(new URL('./fixtures/tile-backdrop-clear/cases.json',import.meta.url)));
const read=item=>normalizeDocument(readAseprite(Buffer.from(item.input,'base64')).document);
const rgba=value=>Buffer.from(unzlibSync(Buffer.from(value.rgbaDeflate,'base64')));
function canonical(input){
 const doc=structuredClone(input);
 for(const layer of doc.layers)if(layer.type==='tilemap')for(const frame of doc.frames){
  const cel=frame.cels[layer.id],image=doc.images[cel?.imageId],raw=image?.tilemap;if(!raw)continue;
  const ts=doc.tilesets.find(t=>t.id===layer.tilesetId);
  layer.tilemaps??={};layer.tilemaps[frame.id]={tilesetId:ts.id,columns:image.width,rows:image.height,x:cel.x,y:cel.y,opacity:cel.opacity,cells:raw.tiles.map(value=>{
   const index=(value&raw.idMask)>>>0;if((ts.flags&4)?index===0:value===0xffffffff)return null;
   const tile=ts.tiles.find(t=>t.asepriteTileId===index),d=!!(value&raw.diagonalFlipMask),fx=!!(value&raw.xFlipMask),fy=!!(value&raw.yFlipMask);
   return {tileId:tile.id,flipX:d?fy:fx,flipY:d?!fx:fy,rotate:d?90:0};
  })};
 }
 return doc;
}
for(const item of oracle.cases)test(`native rectangular tile backdrop: ${item.name}`,()=>{
 const raw=read(item),before=structuredClone(raw),grid=canonical(raw),expected=rgba(item.renders.find(r=>r.scale===1));
 assert.deepEqual(Buffer.from(renderFrame(raw)),expected,'raw native flags');assert.deepEqual(Buffer.from(renderFrame(grid)),expected,'canonical flags preserve clockwise mapping');
 assert.deepEqual(Buffer.from(renderFrame(normalizeDocument(readAseprite(writeAseprite(grid)).document))),expected,'canonical editable export roundtrip');
 for(const output of item.renders)for(const document of [raw,grid]){const actual=renderScaledExportFrame(document,document.frames[0].id,output.scale);assert.equal(actual.width,output.width);assert.equal(actual.height,output.height);assert.deepEqual(Buffer.from(actual.rgba),rgba(output),`scaled ${output.scale}`);}
 assert.deepEqual(raw,before,'source artwork remains unchanged');
});

test('temporary prerendered export tiles keep zero-opacity clearing separate from ordinary transparency',()=>{
 const item=oracle.cases.find(c=>c.name==='rgba-2x3-cel-zero'),source=read(item),scaled=scaleExportDocument(source,1);
 const masks=Object.values(scaled.images).filter(image=>image[TILE_BACKDROP_CLEAR]);assert.equal(masks.length,4);assert.ok(masks.every(image=>image[TILE_BACKDROP_CLEAR] instanceof Uint8Array));
 assert.equal(Object.values(source.images).some(image=>image[TILE_BACKDROP_CLEAR]),false);
 assert.equal(JSON.stringify(scaled).includes('backdrop'),false);
 assert.deepEqual(Buffer.from(renderFrame(scaled)),rgba(item.renders[0]));
 const without=structuredClone(scaled);assert.notDeepEqual(Buffer.from(renderFrame(without)),rgba(item.renders[0]),'ordinary alpha-zero tiles cannot encode backdrop clearing');
});

test('quarter-turn API remains clockwise on square canonical tiles',()=>{
 let d=createDocument({width:2,height:2});d=applyCommand(d,{type:'tileset.add',tileset:{id:'t',tileWidth:2,tileHeight:2,tiles:[{id:'a',pixels:['#110000ff','#220000ff','#330000ff','#440000ff']}]}});d=applyCommand(d,{type:'layer.add',layer:{id:'map',type:'tilemap'}});d=applyCommand(d,{type:'tilemap.paint',layerId:'map',tilesetId:'t',columns:1,rows:1,points:[{x:0,y:0,tileId:'a',rotate:90}]});
 assert.deepEqual(Array.from(renderFrame(d)).filter((_,i)=>i%4===0),[0x33,0x11,0x44,0x22]);
 const files=unzipSync(makeGamePackage(d)),manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));assert.ok(!manifest.warnings.some(w=>w.includes('erase artwork')));
});

test('game package records rectangular clearing limitation and keeps exact frame pixels and original project',()=>{
 const item=oracle.cases.find(c=>c.name==='indexed-3x2-normal');
 for(const document of [read(item),canonical(read(item))]){
  const files=unzipSync(makeGamePackage(document)),json=path=>JSON.parse(new TextDecoder().decode(files[path])),manifest=json('manifest.json');
  assert.equal(manifest.warnings.filter(w=>w.includes('erase artwork')).length,1);assert.deepEqual(Buffer.from(readPng(files[manifest.frames[0].image]).rgba),rgba(item.renders[0]));assert.deepEqual(json(manifest.project),document);
 }
 const noDiagonal=read(item);for(const image of Object.values(noDiagonal.images))if(image.tilemap)image.tilemap.tiles=image.tilemap.tiles.map(v=>(v&~0x20000000)>>>0);
 const files=unzipSync(makeGamePackage(noDiagonal)),manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));assert.ok(!manifest.warnings.some(w=>w.includes('erase artwork')));
});

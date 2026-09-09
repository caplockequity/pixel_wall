import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, readdir, copyFile, symlink, mkdtemp, rm, access } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import { createDocument, normalizeDocument } from '../app/editor-core.mjs';
import { readAseprite, readPng, packAtlas } from '../app/formats.mjs';
import { parseCliArguments } from '../app/cli-arguments.mjs';
import { planExport, buildExportMetadata } from '../app/cli-export-plan.mjs';
import { buildCliExportOutputs } from '../app/cli.mjs';
import { exportGridCells, parseExportGrid } from '../app/export-grid.mjs';
import { loadNodeColorManager } from '../app/color-runtime-node.mjs';

const directory = new URL('./fixtures/cli-grid/native/', import.meta.url);
const oracle = JSON.parse(readFileSync(new URL('probes.json', directory)));
const documents = Object.fromEntries(['basic','offset','negative','outside','default','sparse','layers','indexed','linked-indexed','tilemap'].map(name => [name, normalizeDocument(readAseprite(readFileSync(new URL(`${name}.ase`, directory))).document)]));
const input = name => ({ filename: `${name}.ase`, document: documents[name] });
const cases = {
 'linked-indexed': {}, 'linked-indexed-scale': { scale: 1.5 }, tilemap: {}, 'tilemap-scale': { scale: 1.5 },
 basic: {}, offset: {}, negative: {}, outside: {}, sparse: {}, indexed: {},
 'sparse-trim': { trim: true }, 'indexed-trim': { trim: true }, 'offset-trim': { trim: true }, trim: { trim: true },
 range: { frameRange: [1,1] }, tag: { tag: 'run' },
 fractional: { scale: .5 }, scale: { scale: 2 },
 'split-layers': { splitLayers: true }, 'selected-layer': { layer: 'Top' }, 'all-layers': { splitLayers: true, allLayers: true },
};
for (const [name, options] of Object.entries(cases)) test(`recorded native grid pixels, dimensions, timing and row order: ${name}`, () => {
  const record = oracle.find(row => row.name === name), source = basename(record.args.find(arg => arg.endsWith('.ase')), '.ase');
  const before = structuredClone(documents[source]), plan = planExport([input(source)], { splitGrid: true, ...options });
  assert.equal(plan.entries.length, record.frames.length);
  plan.entries.forEach((entry, index) => {
    const expected = record.frames[index];
    assert.equal(entry.width, expected.frame.w); assert.equal(entry.height, expected.frame.h);
    assert.equal(entry.durationMs, expected.duration);
    assert.deepEqual([...entry.rgba], expected.rgba, `every RGBA byte of entry ${index}`);
    assert.deepEqual(entry.grid.bounds, { x: expected.spriteSourceSize.x, y: expected.spriteSourceSize.y, width: expected.sourceSize.w, height: expected.sourceSize.h });
    assert.deepEqual(entry.sourceSize, expected.sourceSize);
    assert.deepEqual(entry.spriteSourceSize, { x: 0, y: 0, w: entry.width, h: entry.height });
    assert.equal(entry.trimmed, false);
  });
  assert.equal(new Set(plan.entries.map(entry => entry.name)).size, plan.entries.length);
  assert.deepEqual(documents[source], before);
});

for (const [name, argv] of [
 ['scoped-later', ['basic.ase','--split-grid','offset.ase']],
 ['scoped-all', ['--split-grid','basic.ase','offset.ase']],
 ['after', ['basic.ase','--split-grid']],
]) test(`ordered grid input scope matches recorded native outputs: ${name}`, () => {
  const record = oracle.find(row => row.name === name), { args, inputs } = parseCliArguments(['export','--ordered-inputs',...argv,'--format','sheet']);
  const plan = buildCliExportOutputs(inputs.map(value => ({ ...value, document: documents[basename(value.filename,'.ase')] })), args).plan;
  assert.equal(plan.entries.length, record.frames.length);
  plan.entries.forEach((entry,index) => { assert.deepEqual([...entry.rgba],record.frames[index].rgba); assert.equal(entry.durationMs,record.frames[index].duration); });
});

test('global trailing flags remain global, grid overrides snapshot and disabling clears the override', () => {
  const global = parseCliArguments(['export','basic.ase','offset.ase','--split-grid']);
  assert.equal(global.args['split-grid'],true); assert.deepEqual(global.inputs.map(value=>value.options),[{},{}]);
  assert.equal(planExport(global.inputs.map(value=>({...value,document:documents[basename(value.filename,'.ase')]})),global.args).entries.length,20);
  const parsed = parseCliArguments(['export','--ordered-inputs','--split-grid','--grid','0,0,1,2','basic.ase','--grid','1,1,2,2','offset.ase','--split-grid=false','outside.ase']);
  assert.deepEqual(parsed.inputs.map(value=>value.options),[
    { 'split-grid':true,grid:'0,0,1,2' },{ 'split-grid':true,grid:'1,1,2,2' },{ 'split-grid':false },
  ]);
  const plan = planExport(parsed.inputs.map(value=>({...value,document:documents[basename(value.filename,'.ase')]})),parsed.args);
  assert.deepEqual(plan.jobs.map(job=>job.entries.length),[20,12,2]);
  assert.equal(parsed.args.grid,undefined); assert.equal(parsed.args['split-grid'],undefined);
});

test('safe cell filenames and metadata retain source frame, cell origin and full source coordinates', () => {
  const plan = planExport([input('offset')], { splitGrid:true,scale:2,filenameFormat:'{title}-{frame001}-{cell000}-{column}-{row}' });
  assert.equal(plan.entries[0].name,'offset-001-000-0-0'); assert.equal(plan.entries[1].name,'offset-001-001-1-0');
  assert.equal(plan.entries[20].name,'offset-002-000-0-0');
  const metadata = buildExportMetadata(packAtlas(plan.entries,plan.atlasOptions),plan,'json-array');
  assert.deepEqual(metadata.frames[0].source.grid,{ index:0,column:0,row:0,columns:5,rows:4,definition:{x:1,y:1,width:2,height:2},bounds:{x:-1,y:-1,width:2,height:2} });
  assert.deepEqual(metadata.frames[0].source.crop,{x:0,y:0,width:5,height:4});
  assert.deepEqual(metadata.frames[0].source.scaledCrop,{x:-1,y:-1,width:2,height:2});
  assert.equal(metadata.frames[0].source.scale,2); assert.equal(metadata.frames[20].source.frame,1);
  assert.equal(metadata.frames[20].duration,130);
  assert.throws(()=>planExport([input('basic')],{splitGrid:true,filenameFormat:'{title}-{frame}'}),/Duplicate export filename/);
  assert.throws(()=>planExport([input('basic')],{filenameFormat:'{cell}'}),/Unknown filename placeholder/);
});

test('ignore-empty drops only transparent cells without renumbering, and cell dimensions survive trim', () => {
  const plan=planExport([input('sparse')],{splitGrid:true,ignoreEmpty:true,trim:true});
  assert.deepEqual(plan.entries.map(entry=>entry.grid.index),[0,3,0,3]);
  assert.deepEqual(plan.entries.map(entry=>entry.name),['sparse 0 (cell 0).ase','sparse 0 (cell 3).ase','sparse 1 (cell 0).ase','sparse 1 (cell 3).ase']);
  const recorded=oracle.find(row=>row.name==='sparse').frames.filter(frame=>frame.rgba.some((value,index)=>index%4===3&&value));
  assert.deepEqual(plan.entries.map(entry=>[...entry.rgba]),recorded.map(frame=>frame.rgba));
  assert(plan.entries.every(entry=>entry.width===2&&entry.height===2));
});

test('grid validation and aggregate limits reject unsafe work before raster allocation', () => {
  assert.deepEqual(exportGridCells(5,4,{x:7,y:6,width:2,height:2}).map(cell=>cell.bounds),[
    {x:-1,y:0,width:2,height:2},{x:1,y:0,width:2,height:2},{x:3,y:0,width:2,height:2},
    {x:-1,y:2,width:2,height:2},{x:1,y:2,width:2,height:2},{x:3,y:2,width:2,height:2},
  ]);
  assert.deepEqual(exportGridCells(5,4),[]);
  assert.equal(exportGridCells(256,128,'0,0,1,1').length,32768);
  assert.throws(()=>exportGridCells(257,128,'0,0,1,1'),/cell limit/);
  for(const value of ['0,0,0,2','0,0,-1,2','0,0,1.5,2','0,0,65536,1','0,0,65535,65535','2147483648,0,1,1','0,0,NaN,1','0,0,2'])assert.throws(()=>parseExportGrid(value),/Grid requires/);
  const doc=createDocument({width:256,height:128});doc.frames.push({...structuredClone(doc.frames[0]),id:'frame-2'});
  assert.throws(()=>planExport([{document:doc}],{splitGrid:true,grid:'0,0,1,1'}),/total pixel or frame limit/);
  const one=createDocument({width:8192,height:8});one.frames=Array.from({length:1025},(_,index)=>({...structuredClone(one.frames[0]),id:`frame-${index}`}));
  assert.throws(()=>planExport([{document:one}],{splitGrid:true,grid:'0,0,8192,8'}),/total pixel or frame limit/);
});

test('grid selectors reject unsupported formats and uncertain geometry combinations', () => {
  for(const format of ['png','bmp','tga','gif'])assert.throws(()=>buildCliExportOutputs([input('basic')],{format,'split-grid':true}),/sheet, atlas and ZIP/);
  for(const options of [{crop:'0,0,2,2'},{slice:'middle'},{splitSlices:true},{trimSprite:true}])assert.throws(()=>planExport([input('layers')],{splitGrid:true,...options}),/cannot be combined/);
  assert.throws(()=>planExport([input('basic')],{grid:'0,0,2,2'}),/requires --split-grid/);
  assert.throws(()=>buildCliExportOutputs([input('default')],{format:'sheet','split-grid':true}),/No frames matched/);
});

for(const format of ['sheet','atlas','zip'])test(`${format} grid output includes every cell, preserves original projects and stable metadata`,()=>{
  const before=structuredClone(documents.indexed),{plan,outputs}=buildCliExportOutputs([input('indexed')],{format,'split-grid':true,padding:0,border:0});
  let data,metadata;
  if(format==='zip'){
    const files=unzipSync(outputs[0].data);data=files['sprites.png'];metadata=JSON.parse(new TextDecoder().decode(files['sprites.json']));
    const sources=JSON.parse(new TextDecoder().decode(files['sources.json']));
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files[sources.sources[0].project])),before);
    const manifest=JSON.parse(new TextDecoder().decode(files['manifest.json']));
    assert.equal(manifest.frames.length,plan.entries.length);
    manifest.frames.forEach((frame,index)=>{assert.deepEqual(frame.grid,plan.entries[index].grid);assert.equal(frame.entryId,plan.entries[index].id);});
  }else{data=outputs.find(output=>output.kind==='image').data;metadata=JSON.parse(new TextDecoder().decode(outputs.find(output=>output.kind==='metadata').data));}
  const packed=readPng(data),frames=Object.values(metadata.frames);
  assert.equal(frames.length,12);
  frames.forEach((frame,index)=>{
    const rgba=[];for(let y=0;y<frame.frame.h;y++)for(let x=0;x<frame.frame.w;x++)rgba.push(...packed.rgba.subarray(((y+frame.frame.y)*packed.width+x+frame.frame.x)*4,((y+frame.frame.y)*packed.width+x+frame.frame.x)*4+4));
    assert.deepEqual(rgba,[...plan.entries[index].rgba]);assert.deepEqual(frame.source.grid,plan.entries[index].grid);
  });
  assert.deepEqual(documents.indexed,before);
});

test('grid cells use rendered ICC appearance while keeping original native profile bytes',async()=>{
  const path=new URL('./fixtures/export-color/',import.meta.url),doc=normalizeDocument(readAseprite(readFileSync(new URL('source.aseprite',path))).document),expected=readPng(readFileSync(new URL('expected.png',path))),before=structuredClone(doc);
  const manager=await loadNodeColorManager();
  try{
    const plan=planExport([{document:doc}],{splitGrid:true,grid:'0,0,1,1'},{colorManager:manager});
    assert.equal(plan.entries.length,expected.width*expected.height);
    plan.entries.forEach((entry,index)=>assert.deepEqual([...entry.rgba],[...expected.rgba.subarray(index*4,index*4+4)]));
    assert.deepEqual(doc,before);
  }finally{manager.close();}
});

const exec=promisify(execFile);
test('real CLI grid exports enforce licenses, unsupported-target and collision failures without modifying files',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'pixelwall-grid-driver-'));t.after(()=>rm(folder,{recursive:true,force:true}));
  const appDirectory=new URL('../app/',import.meta.url);
  for(const name of (await readdir(appDirectory)).filter(name=>name.endsWith('.mjs')))await copyFile(new URL(name,appDirectory),join(folder,name));
  await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(folder,'node_modules'),'dir');
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
  const claims={version:2,product:'pixelwall-pro',mode:'live',purchaseId:'cs_live_gridfixture12345',issuedAt:1,perpetual:true,keyId:'grid-fixture'},payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(`PW2.${payload}`)),token=`PW2.${payload}.${Buffer.from(signature).toString('base64url')}`;
  await writeFile(join(folder,'license-public-keys.mjs'),`export const PINNED_PUBLIC_KEYS=${JSON.stringify({'grid-fixture':publicKey})};`);
  const source=join(folder,'source.pixelwall');await writeFile(source,JSON.stringify(documents.basic));
  const run=(args,license='')=>exec(process.execPath,[join(folder,'cli.mjs'),...args],{env:{...process.env,PIXELWALL_PRO_LICENSE:license}});
  for(const format of ['sheet','atlas','zip']){
    const out=join(folder,`out-${format}`),args=['export','--split-grid',source,'--format',format,'--out',out];
    await assert.rejects(run(args),error=>error.stderr.includes('valid PixelWall Pro license'));await assert.rejects(access(out));
    await run(args,token);assert((await readFile(out)).length>20);
    const before=await readFile(out);
    await assert.rejects(run([...args,'--filename-format','{frame}'],token),error=>error.stderr.includes('Duplicate export filename'));assert.deepEqual(await readFile(out),before);
  }
  for(const format of ['ase','pixelwall','png','gif']){
    const out=join(folder,`unsupported-${format}`);await writeFile(out,'keep');
    await assert.rejects(run(['export',source,'--split-grid','--format',format,'--out',out],token),error=>error.stderr.includes('sheet, atlas and ZIP'));
    assert.equal(await readFile(out,'utf8'),'keep');
  }
  const overridden=join(folder,'override.png');await run(['export','--ordered-inputs','--split-grid','--grid','0,0,1,1',source,'--format','sheet','--out',overridden],token);
  const metadata=JSON.parse(await readFile(join(folder,'override.json'),'utf8'));assert.equal(Object.keys(metadata.frames).length,40);
});

test('canonical diagonal tiles retain leading off-canvas pixels after grid translation and scaling',()=>{
  const doc=structuredClone(documents.tilemap),layer=doc.layers.find(layer=>layer.type==='tilemap'),ts=doc.tilesets.find(ts=>ts.id===layer.tilesetId),frame=doc.frames[0],cel=frame.cels[layer.id];
  ts.tiles=Array.from({length:ts.tileCount},(_,index)=>({id:`tile-${index}`,imageId:ts.imageId,sourceRect:{x:0,y:index*ts.tileHeight,width:ts.tileWidth,height:ts.tileHeight}}));
  layer.tilemaps={[frame.id]:{tilesetId:ts.id,columns:1,rows:1,x:cel.x,y:cel.y,opacity:cel.opacity,cells:[{tileId:'tile-1',flipX:false,flipY:true,rotate:90}]}};
  for(const [scale,name]of [[1,'tilemap'],[1.5,'tilemap-scale']]){
    const plan=planExport([{filename:'canonical.ase',document:doc}],{splitGrid:true,scale}),record=oracle.find(row=>row.name===name);
    assert.deepEqual(plan.entries.map(entry=>[...entry.rgba]),record.frames.map(frame=>frame.rgba));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCliArguments } from '../app/cli-arguments.mjs';
import { planExport } from '../app/cli-export-plan.mjs';
import { readAseprite } from '../app/formats.mjs';
import { applyOrderedExportScales } from '../app/export-transform.mjs';
const root = new URL('./fixtures/cli-transform-order/native/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, root)));
const docs = Object.fromEntries(['alpha','beta','tilemap','linked-indexed','reference'].map(name=>[name,readAseprite(readFileSync(new URL(name+'.ase',root))).document]));
function plan(argv, format='sheet') {
 const {args,inputs}=parseCliArguments(['export','--ordered-inputs',...argv,'--format',format]);
 return planExport(inputs.map(input=>({...input,document:docs[input.filename]})),{...args,mode:format==='sheet'?'atlas':'sequence'});
}
function compare(entries,frames){assert.equal(entries.length,frames.length);entries.forEach((entry,i)=>{const expected=frames[i];assert.equal(entry.width,expected.width??expected.frame.w);assert.equal(entry.height,expected.height??expected.frame.h);assert.deepEqual([...entry.rgba],expected.rgba,`frame ${i}`);if(expected.duration!=null)assert.equal(entry.durationMs,expected.duration);});}
for(const row of read('probes.json').filter(row=>!row.argv.includes('--crop') && row.name !== 'slice-scale'))test(`ordered export independently matches native ${row.name}`,()=>{
 if(row.name.startsWith('tilemap-')&&row.name!=='tilemap-one'){assert.throws(()=>plan(row.argv),/one effective ordered scale/);return;}
 compare(plan(row.argv).entries,row.frames);
});
for(const row of read('save-probes.json').filter(row=>!['crop-native','crop-gif'].includes(row.name)))test(`final ordered crop matches native ${row.name}`,()=>{
 let argv=row.argv.filter(arg=>!arg.startsWith('save:'));
 if(row.name==='crop-slice') argv=['--slice','middle',...argv.filter((arg,i,all)=>arg!=='--slice'&&all[i-1]!=='--slice')];
 let entries=plan(argv,'png').entries,frames=row.files;
 if(row.name==='crop-after')entries=entries.filter(entry=>entry.inputIndex===1);
 if(row.name==='crop-repeat')frames=frames.filter(frame=>frame.name.startsWith('second'));
 compare(entries,frames);
});
test('ordered transformations preserve source data and report intermediate rounding',()=>{
 const before=structuredClone(docs.alpha),p=plan(['alpha','--scale','.5','--scale','2']);
 assert.deepEqual(docs.alpha,before);assert.deepEqual(p.sources[0].document,before);
 assert.deepEqual(p.sources[0].transforms.map(x=>x.after),[{width:3,height:2},{width:6,height:4}]);
 assert.notDeepEqual([...p.entries[0].rgba],[...plan(['alpha']).entries[0].rgba]);
});
test('ordered input limits and incompatible outputs reject explicitly',()=>{
 assert.throws(()=>plan(['alpha','--crop','0,0,2,2']),/Ordered crop/);
 assert.throws(()=>plan(['--split-grid','alpha','--crop','0,0,2,2'],'png'),/split-grid|Ordered crop/);
 assert.throws(()=>parseCliArguments(['export','--ordered-inputs','alpha',...Array.from({length:33},()=>['--scale','1']).flat()]),/at most 32/);
 assert.throws(()=>applyOrderedExportScales(docs.alpha,[{type:'unknown',factor:2}]),/Unsupported/);
 assert.throws(()=>applyOrderedExportScales(docs.alpha,[{type:'scale',factor:64}],{steps:1024,workPixels:0}),/total scale-operation/);
});
test('legacy export scale stays global and ordered leading scale applies to no later inputs',()=>{
 const plain=parseCliArguments(['export','alpha','--scale','2','beta']);assert.equal(plain.args.scale,'2');
 const ordered=plan(['--scale','2','alpha','beta']);assert.deepEqual(ordered.sources.map(source=>source.transforms),[[],[]]);
});

test('input-scoped slices keep their export selection after ordered scaling',()=>{const p=plan(['--slice','middle','alpha','--scale','2','beta']);assert.deepEqual(p.entries.map(e=>[e.width,e.height]),[[6,4],[6,4],[3,2],[3,2]]);});

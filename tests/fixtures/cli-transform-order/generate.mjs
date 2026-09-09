// Original test corpus, CC0-1.0. Run from the repository root.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { readPng } from '../../../app/formats.mjs';
const bin=process.argv[2];if(!bin)throw Error('Supply a native CLI executable.');
const root='tests/fixtures/cli-transform-order/native';mkdirSync(root,{recursive:true});
const made=spawnSync(bin,['-b','--script-param',`out=${process.cwd()}/${root}`,'--script','tests/fixtures/cli-transform-order/create.lua'],{encoding:'utf8'});if(made.status || made.stderr)throw Error(made.stderr || made.stdout);
const jobs=[
 ...[[1.5,.67],[.67,1.5],[1.25,1.75],[1.5,1.5],[2.2,.67]].map(scales=>['tilemap-'+scales.join('-'),['tilemap',...scales.flatMap(scale=>['--scale',String(scale)])]]),
 ['tilemap-up-down',['tilemap','--scale','2','--scale','.5']],
 ['tilemap-down-up',['tilemap','--scale','.5','--scale','2']],
 ['tilemap-one',['tilemap','--scale','1.5']],
 ['indexed-chain',['linked-indexed','--scale','.5','--scale','1.5']],
 ['reference-chain',['reference','--scale','.5','--scale','1.5']],
 ['plain',['alpha','beta']],
 ['scale-before',['--scale','2','alpha','beta']],
 ['scale-middle',['alpha','--scale','2','beta']],
 ['scale-after',['alpha','beta','--scale','2']],
 ['scale-twice',['alpha','--scale','2','beta','--scale','.5']],
 ['scale-rounding',['alpha','--scale','.5','--scale','2']],
 ['crop-before',['--crop','1,1,3,2','alpha','beta']],
 ['crop-middle',['alpha','--crop','1,1,3,2','beta']],
 ['crop-after',['alpha','beta','--crop','1,1,3,2']],
 ['crop-twice',['alpha','--crop','1,1,3,2','beta','--crop','0,0,2,3']],
 ['crop-repeat',['alpha','--crop','1,1,3,2','--crop','1,0,2,2']],
 ['crop-scale',['alpha','--crop','1,1,3,2','--scale','2']],
 ['scale-crop',['alpha','--scale','2','--crop','1,1,3,2']],
 ['crop-scale-later',['alpha','--crop','1,1,3,2','--scale','2','beta']],
 ['scale-crop-later',['alpha','--scale','2','--crop','1,1,3,2','beta']],
 ['crop-before-scale',['--crop','1,1,3,2','alpha','--scale','2','beta']],
 ['negative',['alpha','--crop','-2,-1,5,4']],
 ['grid-scale',['--split-grid','alpha','--scale','2','beta','--scale','.5']],
 ['layer-scale',['--layer','Detail','alpha','--scale','.5','beta']],
 ['slice-scale',['--slice','middle','alpha','--scale','2','beta']],
];
const results=[];
for(const[name,argv]of jobs){const out=`${root}/${name}`;mkdirSync(out,{recursive:true});const args=['-b',...argv.map(value=>['alpha','beta','tilemap','linked-indexed','reference'].includes(value)?`${root}/${value}.ase`:value),'--sheet-type','horizontal','--format','json-array','--sheet',`${out}/sheet.png`,'--data',`${out}/sheet.json`];const run=spawnSync(bin,args,{encoding:'utf8'});const result={name,argv,args,status:run.status,stdout:run.stdout,stderr:run.stderr,files:readdirSync(out)};
 if(result.files.includes('sheet.png')){const metadata=JSON.parse(readFileSync(`${out}/sheet.json`)),image=readPng(readFileSync(`${out}/sheet.png`));result.frames=metadata.frames.map(frame=>{const rgba=[];for(let y=0;y<frame.frame.h;y++)for(let x=0;x<frame.frame.w;x++){const at=((y+frame.frame.y)*image.width+x+frame.frame.x)*4;rgba.push(...image.rgba.subarray(at,at+4));}return {...frame,rgba};});result.meta=metadata.meta;}
 results.push(result);
}
writeFileSync(`${root}/probes.json`,JSON.stringify(results,null,2).replace(/("rgba": \[)([0-9,\s]*)(\])/g,(_m,a,b,c)=>a+b.trim().replace(/\s+/g,' ')+c)+'\n');
console.log(JSON.stringify(results.map(r=>({name:r.name,frames:r.frames?.map(f=>({name:f.filename,w:f.frame.w,h:f.frame.h,source:f.spriteSourceSize,first:f.rgba.slice(0,4)})),error:r.stdout+r.stderr})),null,2));

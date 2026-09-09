// Original generator, CC0-1.0. No upstream application implementation is copied.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { readPng } from '../../../app/formats.mjs';
// Run from the repository root; supply a separately licensed oracle executable.
const bin=process.argv[2];if(!bin)throw Error('Provide the native CLI executable path.');
const root='tests/fixtures/cli-grid/native';
const cases=[
 ...['linked-indexed','tilemap'].flatMap(n=>[[n,n,['--split-grid'],[],'sheet'],[n+'-scale',n,['--split-grid'],['--scale','1.5'],'sheet']]),
 ['scoped-later','basic',[],['--split-grid',`${root}/offset.ase`],'sheet'],
 ['scoped-all',['basic','offset'],['--split-grid'],[],'sheet'],
 ...['sparse','indexed'].flatMap(n=>[[n,n,['--split-grid'],[],'sheet'],[n+'-trim',n,['--split-grid','--trim'],[],'sheet'],[n+'-empty',n,['--split-grid','--ignore-empty'],[],'sheet']]),
 ['split-layers','layers',['--split-grid','--split-layers'],[],'sheet'],
 ['selected-layer','layers',['--split-grid','--layer','Top'],[],'sheet'],
 ['all-layers','layers',['--split-grid','--split-layers','--all-layers'],[],'sheet'],
 ['slice','layers',['--split-grid','--slice','middle'],[],'sheet'],
 ['fractional','basic',['--split-grid'],['--scale','.5'],'sheet'],
 ['trim-sprite','sparse',['--split-grid','--trim-sprite'],[],'sheet'],
 ['offset-trim','offset',['--split-grid','--trim'],[],'sheet'],
 ...['basic','offset','negative','outside','default'].map(n=>[n,n,['--split-grid'],[],'sheet']),
 ['after','basic',[],['--split-grid'],'sheet'],
 ['png','basic',['--split-grid'],[],'png'],
 ['gif','basic',['--split-grid'],[],'gif'],
 ['trim','basic',['--split-grid','--trim'],[],'sheet'],
 ['range','basic',['--split-grid','--frame-range','1,1'],[],'sheet'],
 ['tag','basic',['--split-grid','--tag','run'],[],'sheet'],
 ['naming','basic',['--split-grid','--filename-format','{title}-{frame}-{tagframe}-{tag}'],[],'sheet'],
 ['crop','basic',['--split-grid'],['--crop','1,1,3,2'],'sheet'],
 ['scale','basic',['--split-grid'],['--scale','2'],'sheet'],
];
mkdirSync(root,{recursive:true});
for(const file of ['create.lua','more.lua']){const run=spawnSync(bin,['-b','--script-param',`out=${process.cwd()}/${root}`,'--script',`tests/fixtures/cli-grid/${file}`],{encoding:'utf8'});if(run.status || run.stderr)throw Error(run.stderr || run.stdout);}
const results=[];
for(const [name,input,before,after,format] of cases){
 const path=`${root}/${name}-export`;mkdirSync(path,{recursive:true});
 const args=['-b',...before,...(Array.isArray(input)?input.map(n=>`${root}/${n}.ase`):[`${root}/${input}.ase`]),...after,...(format==='sheet'?['--sheet-type','horizontal','--format','json-array','--sheet',`${path}/out.png`,'--data',`${path}/out.json`]:['--save-as',`${path}/out.${format}`])];
 const run=spawnSync(bin,args,{encoding:'utf8'});
 const result={name,args,status:run.status,stdout:run.stdout,stderr:run.stderr,files:readdirSync(path)};
 if(format==='sheet' && result.files.includes('out.png') && readFileSync(`${path}/out.json`,'utf8').trim()){
  const meta=JSON.parse(readFileSync(`${path}/out.json`)); const image=readPng(readFileSync(`${path}/out.png`));
  result.frames=meta.frames.map(f=>{const rgba=[];for(let y=0;y<f.frame.h;y++)for(let x=0;x<f.frame.w;x++)rgba.push(...image.rgba.subarray(((y+f.frame.y)*image.width+x+f.frame.x)*4,((y+f.frame.y)*image.width+x+f.frame.x)*4+4));return {...f,rgba};});result.meta=meta.meta;
 }
 results.push(result);
}
const invalid=spawnSync(bin,['-b','--grid','2,2',`${root}/basic.ase`],{encoding:'utf8'});
writeFileSync(`${root}/invalid-grid.json`,JSON.stringify({argv:['-b','--grid','2,2','basic.ase'],status:invalid.status,stdout:invalid.stdout,stderr:invalid.stderr},null,2)+'\n');
writeFileSync(`${root}/probes.json`,JSON.stringify(results,null,2).replace(/("rgba": \[)([0-9,\s]*)(\])/g,(_match,open,body,close)=>open+body.trim().replace(/\s+/g,' ')+close)+'\n');
console.log(results.map(r=>({name:r.name,count:r.frames?.length,error:r.stdout+r.stderr,rects:r.frames?.slice(0,5).map(f=>f.spriteSourceSize)})));

const fixtureRoot='tests/fixtures/cli-grid';
function files(path=''){return readdirSync(`${fixtureRoot}/${path}`,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(`${path}${entry.name}/`):[path+entry.name]);}
const paths=files().filter(path=>path!=='manifest.json');
writeFileSync(`${fixtureRoot}/manifest.json`,JSON.stringify({date:'2026-09-09',oracleVersion:results.find(result=>result.meta)?.meta.version,source:'https://github.com/aseprite/aseprite/releases/download/v1.3.18.5/Aseprite-v1.3.18.5-Source.zip',fixtureLicense:'CC0-1.0',files:Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(`${fixtureRoot}/${path}`)).digest('hex')]))},null,2)+'\n');

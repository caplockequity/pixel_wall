// Original test corpus, CC0-1.0. Run from the repository root with a native CLI executable.
import {spawnSync} from 'node:child_process';import{mkdirSync,readFileSync,readdirSync,writeFileSync}from'node:fs';import{readPng,readAseprite}from'../../../app/formats.mjs';import{GifReader}from'omggif';
const bin=process.argv[2],root='tests/fixtures/cli-transform-order/native';const jobs=[
 ['crop-before',['--crop','1,1,3,2','alpha','save:first','beta','save:second']],
 ['crop-after',['alpha','beta','--crop','1,1,3,2','save:second']],
 ['crop-scale',['alpha','--crop','1,1,3,2','--scale','2','save:first']],
 ['scale-crop',['alpha','--scale','2','--crop','1,1,3,2','save:first']],
 ['crop-repeat',['alpha','--crop','1,1,3,2','save:first','--crop','1,0,2,2','save:second']],
 ['crop-sequence',['alpha','--crop','1,1,3,2','save:first','beta','save:second']],
 ['crop-native',['alpha','--crop','1,1,3,2','save:native.ase']],
 ['crop-fraction',['alpha','--crop','-1,0,4,4','--scale','.5','save:first']],
 ['crop-gif',['alpha','--crop','1,1,3,2','--scale','2','save:animated.gif']],
 ['scale-before',['--scale','2','alpha','save:first']],
 ['crop-slice',['alpha','--crop','0,0,2,2','--slice','middle','--scale','2','save:first']],
];
let results=[];
for(const[name,argv]of jobs){let dir=`${root}/save-${name}`;mkdirSync(dir,{recursive:true});let args=['-b',...argv.flatMap(v=>v.startsWith('save:')?['--save-as',`${dir}/${v.slice(5)}${v.includes('.')?'':'.png'}`]:['alpha','beta'].includes(v)?[`${root}/${v}.ase`]:[v])];let run=spawnSync(bin,args,{encoding:'utf8'});let files=readdirSync(dir).map(name=>{let bytes=readFileSync(`${dir}/${name}`);if(name.endsWith('.png')){let im=readPng(bytes);return {name,width:im.width,height:im.height,rgba:[...im.rgba]};}if(name.endsWith('.ase')){let doc=readAseprite(bytes).document;return{name,width:doc.width,height:doc.height,cels:doc.frames.map(f=>f.cels)};}let reader=new GifReader(bytes);return{name,width:reader.width,height:reader.height,frames:reader.numFrames()};});results.push({name,argv,args,status:run.status,stdout:run.stdout,stderr:run.stderr,files});}
writeFileSync(`${root}/save-probes.json`,JSON.stringify(results,null,2));console.log(results.map(r=>({name:r.name,files:r.files.map(f=>({...f,rgba:f.rgba?.slice(0,4)}))}))); 

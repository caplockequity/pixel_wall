// Original CC0 fixture generator. Run from repository root; see README.md.
import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';import omggif from 'omggif';import {readPng} from '../../../app/formats.mjs';
const bin=process.env.ASEPRITE_BIN,root='tests/fixtures/tag-traversal';
const lua=`local s=Sprite(1,1);for i=1,7 do if i>1 then s:newEmptyFrame() end;local im=Image(1,1);im:drawPixel(0,0,app.pixelColor.rgba(i*30,0,0,255));s:newCel(s.layers[1],i,im);s.frames[i].duration=(5+i)*.01 end\nlocal a=s:newTag(2,6);a.name='outer';a.aniDir=AniDir.PING_PONG;a.repeats=3;local b=s:newTag(3,4);b.name='inner';b.aniDir=AniDir.REVERSE;b.repeats=2;local c=s:newTag(5,7);c.name='overlap';c.aniDir=AniDir.PING_PONG_REVERSE;c.repeats=2;s:saveAs(app.params.path);s:close()`;
writeFileSync(`${root}/nested.lua`,lua);execFileSync(bin,['--batch','--script-param',`path=${root}/nested.aseprite`,'--script',`${root}/nested.lua`]);const results=[];
for(const fixture of ['nested','pingpong-3','reverse-2'])for(const subtags of [false,true])for(const tag of [null,fixture==='nested'?'outer':'clip'])for(const range of [null,'2,3'])for(const format of ['gif','sequence','sheet']){
 const name=`${fixture}-${subtags}-${tag}-${range?.replace(',','_')}-${format}`,dir=`${root}/exports/${name}`;mkdirSync(dir,{recursive:true});const args=['--batch',`${root}/${fixture}.aseprite`,...(subtags?['--play-subtags']:[]),...(tag?['--tag',tag]:[]),...(range?['--frame-range',range]:[]),...(format==='sheet'?['--sheet-type','horizontal','--sheet',`${dir}/sheet.png`]:['--save-as',`${dir}/${format==='gif'?'animation.gif':'frame01.png'}`])];execFileSync(bin,args);const divisor=fixture==='nested'?30:40;let frames=[];
 if(format==='gif'){const g=new omggif.GifReader(readFileSync(`${dir}/animation.gif`));let p=new Uint8Array(4);for(let i=0;i<g.numFrames();i++){g.decodeAndBlitFrameRGBA(i,p);frames.push({frame:p[0]/divisor-1,ms:g.frameInfo(i).delay*10})}}
 else if(format==='sequence')frames=readdirSync(dir).sort().map(file=>({frame:readPng(readFileSync(`${dir}/${file}`)).rgba[0]/divisor-1}));
 else {const png=readPng(readFileSync(`${dir}/sheet.png`));frames=Array.from({length:png.width},(_,i)=>({frame:png.rgba[i*4]/divisor-1}));}
 results.push({fixture,subtags,tag,range,format,args,frames});
}
writeFileSync(`${root}/cli-more-vectors.json`,JSON.stringify(results,null,2)+'\n');console.log(results.map(x=>`${x.fixture} sub=${x.subtags} tag=${x.tag} range=${x.range} ${x.format}: ${x.frames.map(f=>f.frame).join(',')}`).join('\n'));

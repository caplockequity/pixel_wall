// Original fixture packer. Run after capture.lua and scaled.lua; paths are explicit.
import fs from 'node:fs';
import {zlibSync} from 'fflate';
const [manifest,output]=process.argv.slice(2);
if(!manifest||!output)throw Error('Supply the captured manifest and output JSON path.');
const cases=JSON.parse(fs.readFileSync(manifest)).map(c=>{
 const renders=[];
 for(const scale of [1,.5,.75,1.5,2.25]){
  const file=c.path+(scale===1?'':'.'+scale)+'.rgba';if(!fs.existsSync(file))continue;
  renders.push({scale,width:Math.max(1,Math.trunc(c.width*scale)),height:Math.max(1,Math.trunc(c.height*scale)),rgbaDeflate:Buffer.from(zlibSync(fs.readFileSync(file))).toString('base64')});
 }
 return {name:c.name,mode:c.mode,tw:c.tw,th:c.th,scenario:c.scenario,input:fs.readFileSync(c.path).toString('base64'),renders};
});
fs.writeFileSync(output,JSON.stringify({provenance:{version:'Native 1.3.18.5 self-built batch, API 41',composeGroups:true,source:'Original generated fixtures; independent native RGBA capture; CC0 test art'},cases},null,2)+'\n');

import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const RUNTIME_FILES=['lcms.mjs','lcms.wasm','lcms-LICENSE.txt','lua.wasm','lua-runtime-LICENSE.txt','lua-browser-worker.mjs','engine-NOTICES.txt','rotation-NOTICES.txt','playback-NOTICES.txt','indexed-NOTICES.txt','provenance.json'];
export async function prepareRuntimes(target=resolve(root,'public/runtimes')) {
  await mkdir(target,{recursive:true});
  const browserWorker=await rolldown({input:resolve(root,'app/lua-browser-worker.mjs'),platform:'browser',plugins:[{name:'lua-browser-node-stubs',resolveId(id){if(['module','url'].includes(id))return '\0lua-node-only';},load(id){if(id==='\0lua-node-only')return 'export const createRequire=()=>{throw Error("Node APIs are unavailable in this worker")}; export const fileURLToPath=createRequire;';}}]});
  try{await browserWorker.write({file:resolve(target,'lua-browser-worker.mjs'),format:'es',sourcemap:false,codeSplitting:false});}finally{await browserWorker.close();}
  for(const [from,to]of [
    ['lcms-wasm/dist/lcms.js','lcms.mjs'],['lcms-wasm/dist/lcms.wasm','lcms.wasm'],
    ['lcms-wasm/LICENSE.md','lcms-LICENSE.txt'],['wasmoon/dist/glue.wasm','lua.wasm'],
    ['wasmoon/LICENSE','lua-runtime-LICENSE.txt'],
  ])await copyFile(resolve(root,'node_modules',from),resolve(target,to));
  await copyFile(resolve(root,'docs/runtime-engine-notices.txt'),resolve(target,'engine-NOTICES.txt'));
  await copyFile(resolve(root,'docs/rotation-NOTICES.txt'),resolve(target,'rotation-NOTICES.txt'));
  await copyFile(resolve(root,'docs/playback-NOTICES.txt'),resolve(target,'playback-NOTICES.txt'));
  await copyFile(resolve(root,'docs/indexed-NOTICES.txt'),resolve(target,'indexed-NOTICES.txt'));
  await writeFile(resolve(target,'provenance.json'),JSON.stringify({indexed:{upstream:'Aseprite Document and Render Libraries',version:'1.3.18.5',license:'MIT',notice:'indexed-NOTICES.txt',source:'https://github.com/aseprite/aseprite/tree/v1.3.18.5/src/render'},playback:{upstream:'Aseprite Document Library',version:'1.3.18.5',license:'MIT',notice:'playback-NOTICES.txt',source:'https://github.com/aseprite/aseprite/blob/v1.3.18.5/src/doc/playback.cpp'},rotation:{upstream:'Aseprite Document Library',version:'1.3.18.5',license:'MIT',notice:'rotation-NOTICES.txt',source:'https://github.com/aseprite/aseprite/tree/v1.3.18.5/src/doc/algorithm'},lcms:{package:'lcms-wasm',version:'1.0.5',engineVersion:'2.16',engineRevision:'c2a54017d73080f97c5cd34a78ff2fb51564aade',license:'MIT',source:'https://github.com/mattdesl/lcms-wasm'},lua:{package:'wasmoon',version:'1.16.0',engineVersion:'5.4.5',engineRevision:'be908a7d4d8130264ad67c5789169769f824c5d1',license:'MIT',source:'https://github.com/ceifa/wasmoon'}},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await prepareRuntimes();

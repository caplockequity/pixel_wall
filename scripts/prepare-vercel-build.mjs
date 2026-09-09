import {rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const STOREFRONT='https://www.pixelwall.dev';
function runNode(script,{root,env}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[join(root,script)],{cwd:root,env,stdio:'inherit'});
    child.on('error',reject);
    child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(`${script} failed (${signal??code}).`)));
  });
}
export async function prepareVercel({root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),env=process.env,run=runNode}={}) {
  // Vinext and Next generate incompatible declarations in this ignored directory.
  await Promise.all([
    rm(join(root,'.next/types'),{recursive:true,force:true}),
    rm(join(root,'.next/dev/types'),{recursive:true,force:true}),
    // Next's adapter can copy public files at build-start. Remove old generated
    // workers before building; the postbuild step creates the current inventory.
    rm(join(root,'public/sw.js'),{force:true}),
    rm(join(root,'public/offline-assets.json'),{force:true}),
  ]);
  // Never reuse the private Sites download or its old standalone override.
  const storefront=STOREFRONT;
  const buildEnv={...env,PIXELWALL_STANDALONE_SITE_URL:storefront,PIXELWALL_SOURCE_ROOT:root,PIXELWALL_CLI_ENTRY:join(root,'app/cli.mjs')};
  await run('scripts/build-standalone.mjs',{root,env:buildEnv});
  await run('scripts/package-downloads.mjs',{root,env:buildEnv});
  console.log(`Vercel downloads prepared for ${storefront}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await prepareVercel();

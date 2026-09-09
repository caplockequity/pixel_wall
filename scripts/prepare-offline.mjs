#!/usr/bin/env node
/** Run after either build: node scripts/prepare-offline.mjs [dist/client|--next]. */
import {readdir,readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

async function walk(directory) {
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory())result.push(...await walk(path));
    else if(entry.isFile())result.push(path);
    else throw new Error('Offline assets must be regular build files.');
  }
  return result;
}
const urlPath=path=>path.split('\\').join('/').split('/').map(encodeURIComponent).join('/');

export async function prepareOffline({root=process.cwd(),next=false,output}={}) {
  root=resolve(root);
  const assetRoot=next?join(root,'.next/static'):resolve(root,output??'dist/client');
  const outputRoot=next?join(root,'public'):assetRoot;
  const files=(await walk(assetRoot)).filter(path=>/\.(?:m?js|css|wasm|png|svg|ico|woff2?)$/.test(path)&&!path.endsWith('/sw.js')).sort();
  if(!files.some(path=>/\.(?:m?js)$/.test(path)))throw new Error('Offline build contains no editor scripts.');
  const assets=files.map(path=>(next?'/_next/static/':'/')+urlPath(relative(assetRoot,path))).sort();
  let runtimeFiles=[];
  if(next){try{runtimeFiles=await walk(join(root,'public/runtimes'));}catch(error){if(error.code!=='ENOENT')throw error;}assets.push(...runtimeFiles.map(path=>'/runtimes/'+urlPath(relative(join(root,'public/runtimes'),path))));assets.sort();}
  const template=await readFile(join(root,'scripts/offline-worker.js'),'utf8');
  if(!template.includes('__PIXELWALL_BUILD_ID__'))throw new Error('Offline worker source is missing its build placeholder.');
  const hash=createHash('sha256');
  for(const path of files){hash.update(relative(assetRoot,path).split('\\').join('/'));hash.update(await readFile(path));}
  for(const path of runtimeFiles){hash.update('/runtimes/'+relative(join(root,'public/runtimes'),path));hash.update(await readFile(path));}
  hash.update(template);
  if(next)hash.update(await readFile(join(root,'.next/BUILD_ID')));
  const buildId=hash.digest('hex').slice(0,16);
  const generated={
    'offline-assets.json':JSON.stringify({version:1,buildId,assets}),
    'sw.js':template.replaceAll('__PIXELWALL_BUILD_ID__',buildId),
  };
  await mkdir(outputRoot,{recursive:true});
  for(const [name,data]of Object.entries(generated))await writeFile(join(outputRoot,name),data);
  if(next){
    // The Vercel Next adapter may copy public files during `next build`.
    // Update its finished static output as well, including previously copied files.
    const adapterStatic=join(root,'.next/output/static');
    let adapterExists=false;
    try{adapterExists=(await stat(adapterStatic)).isDirectory();}catch(error){if(error.code!=='ENOENT')throw error;}
    if(adapterExists)for(const [name,data]of Object.entries(generated))await writeFile(join(adapterStatic,name),data);
  }
  console.log(`Offline shell prepared: ${assets.length} assets, build ${buildId}`);
  return {buildId,assets,outputRoot};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await prepareOffline({next:process.argv[2]==='--next',output:process.argv[2]==='--next'?undefined:process.argv[2]});

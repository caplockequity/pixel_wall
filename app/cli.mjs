#!/usr/bin/env node
/** Standalone trusted-user CLI; no app server or AI service is required. */
import { loadNodeColorManager } from './color-runtime-node.mjs';
import { documentProfile, isSRGB } from './color-management.mjs';
import { renderScaledExportFrame } from './export-render.mjs';
import { parseCliArguments } from './cli-arguments.mjs';
import { runLuaScript } from './lua-runner-node.mjs';
import { planExport, buildExportMetadata } from './cli-export-plan.mjs';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import {readFile,writeFile,rename,mkdir,unlink,stat,link,lstat,open} from 'node:fs/promises';
import {resolve,dirname,extname,basename,join as joinPath} from 'node:path';
import { randomUUID } from 'node:crypto';
import {realpathSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createDocument,normalizeDocument,applyCommand,describeDocument,COMMANDS} from './editor-core.mjs';
import {readAseprite,writeAseprite,readPng,writePng,importGif,importSequence,importSheet,packAtlas,encodeGif,makeGamePackage,readBmp,writeBmp,readTga,writeTga} from './formats.mjs';
import {verifyOfflineLicense} from './offline-license.mjs';
import {PINNED_PUBLIC_KEYS} from './license-public-keys.mjs';
const HELP=`PixelWall CLI — local sprite editing and export

  pixelwall new --width 32 --height 32 --name Hero --out hero.pixelwall
  pixelwall inspect hero.pixelwall
  pixelwall commands
  pixelwall apply hero.pixelwall --commands edits.json --out hero.pixelwall
  pixelwall script hero.pixelwall --script ./draw.mjs --out hero.pixelwall
  pixelwall script hero.pixelwall --script ./draw.lua --params '{"shade":"red"}' --out hero.pixelwall
  pixelwall profile hero.pixelwall --convert sRGB --out converted.pixelwall
  pixelwall profile hero.pixelwall --assign ./working.icc --out assigned.pixelwall
  pixelwall import art.ase --out hero.pixelwall
  pixelwall import sheet.png --frame-width 32 --frame-height 32 --out hero.pixelwall
  pixelwall import-sequence frame1.png frame2.png --duration 100 --out hero.pixelwall
  pixelwall render hero.pixelwall --frame 0 --scale 4 --out hero.png
  pixelwall export hero.pixelwall --format ase --out hero.ase
  pixelwall export hero.pixelwall --format gif --out hero.gif --license license.txt
  pixelwall export hero.pixelwall --format sheet --columns 4 --out hero.png --license license.txt
  pixelwall export hero.pixelwall --format atlas --trim --padding 2 --extrude 1 --power-of-two --out atlas.png --license license.txt
  pixelwall export hero.pixelwall --format zip --out frames.zip --license license.txt
  pixelwall export hero.pixelwall --format png --out-dir frames --split-layers
  pixelwall export hero.pixelwall enemy.ase --format atlas --out sprites.png --license license.txt
  pixelwall export --ordered-inputs --tag idle hero.ase --tag run enemy.ase --format atlas --out sprites.png --license license.txt
  pixelwall export tiles.png --split-grid --grid 0,0,16,16 --format sheet --out tiles-sheet.png --license license.txt
  pixelwall export hero.pixelwall --format gif --play-subtags --split-tags --out-dir animations --license license.txt

Frames are zero-based indices or frame IDs. --clip selects a clip by name or ID.
PNG/BMP/TGA and editable projects are free; GIF, sheet, atlas and ZIP require Pro.
A signed perpetual license can also be supplied with PIXELWALL_PRO_LICENSE.
Lua scripts run in a bounded Lua 5.4 worker with supported sprite editing APIs.
Use --out-dir for scripts that edit several projects and image sequences or split GIF jobs.
Directory exports refuse existing or colliding output filenames. --out and --out-dir are exclusive.
Export flags apply to every input by default, preserving existing commands.
Add --ordered-inputs for selectors before each input: they affect that file and later files.
Repeated --layer/--import-layer/--ignore-layer accumulate; --tag/--clip and ranges replace.
Layer/split visibility flags, --frame, --slice and --grid are also captured per input.
With ordered inputs, --split-grid=false also clears the preceding grid override.
Each --scale resizes inputs already listed; leading scales do not affect later files.
Repeated scales keep intermediate rounding. Tilemaps allow one effective scale.
The last --crop selects the final scaled canvas region for PNG/BMP/TGA/GIF output;
ordered crop cannot be combined with sheet/atlas/ZIP. Editable exports retain originals.
Packing, filenames, crop, trim, scale, license and output paths remain global.
Export accepts --frame-range from,to, --tag, --slice, --crop x,y,w,h, --trim-sprite,
--split-layers/--split-tags/--split-slices, --ignore-empty, and positive --scale up to 64 (including fractions such as 0.5 or 1.5).
GIF/PNG/BMP/TGA tags export timeline order by default. --play-subtags applies tag directions,
finite repeats and nested tags; --frame-range/--frame suppress traversal. Sheets remain timeline order.
Reference layers are omitted from rendered exports; --include-reference-layers opts in.
Atlas/sheet support --sheet-type, --shape-padding, --inner-padding, --border-padding,
--metadata-format json-hash|json-array and --filename-format using source-file placeholders.
Filename templates name files within --out-dir; path separators become underscores.
PNG/BMP/TGA --out exports frame 0 by default; explicit multi-frame selections require --out-dir.
ZIP retains original projects and source packages alongside the combined atlas and source metadata.
Grid extraction: --split-grid supports sheet, atlas and ZIP. --grid x,y,w,h overrides
the saved sprite grid (default 0,0,16,16); it requires --split-grid. Scale applies to
the sprite first; cell dimensions stay fixed. Cells keep their size under --trim.
Incomplete right/bottom cells are omitted; --ignore-empty removes empty cells.
Grid cannot combine with crop, slice, split-slices or trim-sprite. Names include a
cell number; templates can use {cell}, {column}, {row} (zero-based, e.g. {cell001}).
Metadata source.grid records each cell rectangle, index and grid definition.
Atlas coordinates follow the selected PixelWall packing settings.
--timeout allows up to 10000 ms for Lua scripts.
JavaScript modules are explicitly trusted local scripts with normal Node access.
Export default async ({document,apply}) => { apply({type:...}); } from your script.
All edits use the same document commands as the editor. No embedded AI is used.
`;
function fail(message){throw new Error(message);}
function number(args,key,fallback){if(args[key]==null)return fallback;const n=Number(args[key]);if(!Number.isFinite(n))fail(`--${key} must be a number.`);return n;}
function required(args,key){const value=args[key];if(typeof value!=='string'||!value)fail(`--${key} is required.`);return value;}
function warn(warnings){for(const warning of warnings||[])process.stderr.write(`Warning: ${warning}\n`);}
async function readManagedPng(bytes){const image=readPng(bytes);if(!image.colorProfile)return image;return {...image,rgba:(await loadNodeColorManager()).transformRGBA(image.rgba,image.colorProfile),colorProfile:undefined};}
async function readDocument(path){if(!path)fail('Input file is required.');const input=new Uint8Array(await readFile(resolve(path))),extension=extname(path).toLowerCase();if(['.ase','.aseprite'].includes(extension)){const result=readAseprite(input);warn(result.warnings);return normalizeDocument(result.document);}if(['.png','.bmp','.tga'].includes(extension)){const image=extension==='.bmp'?readBmp(input):extension==='.tga'?readTga(input):await readManagedPng(input);warn(image.warnings);return normalizeDocument(importSequence([image],{name:path.split(/[\\/]/).at(-1)}));}if(extension==='.gif'){const result=importGif(input);warn(result.warnings);return normalizeDocument(result.document);}return normalizeDocument(JSON.parse(new TextDecoder().decode(input)));}
async function atomicWrite(path,data){const target=resolve(path);await mkdir(dirname(target),{recursive:true});const temp=`${target}.${process.pid}.${Date.now()}.tmp`;try{await writeFile(temp,data);await rename(temp,target);}catch(error){await unlink(temp).catch(()=>{});throw error;}}
async function saveDocument(path,document){await atomicWrite(path,JSON.stringify(normalizeDocument(document),null,2)+'\n');}
function outputName(value,extension){let name=String(value||'sprite').replace(/\.(ase|aseprite|pixelwall|json|png|bmp|tga|gif|zip)$/i,'').replace(/[<>:"/\\|?*]/g,'_').split('').map(char=>char.charCodeAt(0)<32?'_':char).join('').replace(/^[. ]+|[. ]+$/g,'').slice(0,180)||'sprite';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name))name='_'+name;return `${name}.${extension}`;}
async function writeOutputs(outputs,{exclusive=false}={}){
 const seen=new Set();for(const output of outputs){const target=resolve(output.path),key=target.toLowerCase();if(seen.has(key))fail(`Output filenames collide: ${output.path}. Choose distinct names.`);seen.add(key);if(exclusive){try{await lstat(target);fail(`Output already exists: ${output.path}. Choose an empty --out-dir.`);}catch(error){if(error.code!=='ENOENT')throw error;}}}
 if(!exclusive){for(const output of outputs)await atomicWrite(output.path,output.data);return;}
 const staged=[],installed=[];
 try{
  for(const output of outputs){const target=resolve(output.path);await mkdir(dirname(target),{recursive:true});const temporary=joinPath(dirname(target),`.pixelwall-${randomUUID()}.tmp`);const handle=await open(temporary,'wx');staged.push({target,temporary});try{await handle.writeFile(output.data);}finally{await handle.close();}}
  for(const item of staged){await link(item.temporary,item.target);installed.push({...item,identity:await stat(item.temporary,{bigint:true})});}
 }catch(error){
  for(const item of installed){const current=await lstat(item.target,{bigint:true}).catch(()=>null);if(current&&current.dev===item.identity.dev&&current.ino===item.identity.ino&&current.mtimeNs===item.identity.mtimeNs)await unlink(item.target).catch(()=>{});}
  throw error;
 }finally{for(const item of staged)await unlink(item.temporary).catch(()=>{});}
}
const jsonBytes=value=>strToU8(JSON.stringify(value,null,2)+'\n');
const selectionKeys=['play-subtags','clip','tag','frame-tag','frame-range','split-tags','split-layers','split-slices','split-grid','grid'];

/** Pure output construction, like the format codecs. The CLI checks Pro before calling this for paid formats. */
export function buildCliExportOutputs(inputs,args,rendering={}){
 const format=String(args.format).toLowerCase(),raster=['png','bmp','tga'].includes(format),imageName=format==='zip'?'sprites.png':basename(args.out||'sprites.png');
 if(!['png','bmp','tga','gif','atlas','sheet','zip'].includes(format))fail(`Unknown planned export format ${format}.`);
 const options={...args,mode:raster?'sequence':format==='gif'?'animation':'atlas',imageName};
 const singleSelection={...args,...inputs[0]?.options};
 if(raster&&!args['out-dir']&&inputs.length===1&&singleSelection.frame==null&&!selectionKeys.some(key=>singleSelection[key]))options.frame='0';
 if(['atlas','zip'].includes(format)){options.trim=args.trim??true;options.padding=args['shape-padding']??args.padding??1;options.border=args['border-padding']??args.border??options.padding;}
 if(format==='sheet'){options['sheet-type']=args['sheet-type']??args.layout??'rows';options.padding=args['shape-padding']??args.padding??0;options.border=args['border-padding']??args.border??0;}
 const plan=planExport(inputs,options,rendering);if(!plan.entries.length)fail('No frames matched the export selection. No output was written.');
 let outputs;
 if(raster){const encoder=format==='bmp'?writeBmp:format==='tga'?writeTga:writePng;outputs=plan.entries.map(entry=>({name:outputName(entry.name,format),data:encoder(entry.width,entry.height,entry.rgba),entryId:entry.id}));}
 else if(format==='gif')outputs=plan.jobs.filter(job=>job.entries.length).map(job=>{const name=args['filename-format']?job.entries[0].name:`${basename(job.filename,extname(job.filename))}${job.layer?` (${job.layerPath})`:''}${job.tag?` (${job.tag.name})`:''}${job.slice?` (${job.slice.name})`:''}`;return {name:outputName(name,'gif'),data:encodeGif(job.entries,{loop:number(args,'loop',0)}),jobId:job.id};});
 else{
  if(format==='sheet'&&!plan.atlasOptions.columns&&!plan.options.rows&&['rows','grid'].includes(plan.options.sheetType))plan.atlasOptions.columns=plan.entries.length;
  const atlas=packAtlas(plan.entries,plan.atlasOptions),metadata=buildExportMetadata(atlas,plan);
  if(format==='sheet'&&plan.atlasOptions.layout==='grid'){metadata.meta.columns=plan.atlasOptions.columns||Math.ceil(Math.sqrt(plan.entries.length));metadata.meta.rows=Math.ceil(plan.entries.length/metadata.meta.columns);}
  if(format==='zip'){
   const files={'sprites.png':writePng(atlas.width,atlas.height,atlas.rgba),'sprites.json':jsonBytes(metadata)},sources=[];
   for(const [index,source]of plan.sources.entries()){
    const original=normalizeDocument(inputs[index].originalDocument||inputs[index].document),projectName=outputName(`${String(index+1).padStart(3,'0')}-${basename(source.filename)}`,'pixelwall'),project=`projects/${projectName}`;
    files[project]=jsonBytes(original);
    const entries=plan.entries.filter(entry=>entry.inputIndex===index).map(entry=>({...entry,entryId:entry.id,id:entry.sourceFrameId}));
    let gamePackage=null;
    if(entries.length){
     const sourceFiles=unzipSync(makeGamePackage(source.document,{...rendering,entries,trim:false,scale:plan.options.scale,padding:plan.options.padding,extrude:plan.options.extrude,powerOfTwo:plan.options.powerOfTwo})),prefix=plan.sources.length===1?'':`packages/${String(index+1).padStart(3,'0')}-${outputName(basename(source.filename),'source')}/`;
     const manifest=JSON.parse(new TextDecoder().decode(sourceFiles['manifest.json']));
     if(source.transforms.length){manifest.sourceTransforms=source.transforms;sourceFiles['manifest.json']=jsonBytes(manifest);}
     if(entries.some(entry=>entry.grid)){manifest.frames=manifest.frames.map((frame,index)=>({...frame,entryId:entries[index].entryId,...(entries[index].grid?{grid:entries[index].grid}: {})}));sourceFiles['manifest.json']=jsonBytes(manifest);}
     sourceFiles[manifest.project]=jsonBytes(original);
     for(const [name,data]of Object.entries(sourceFiles))if(prefix||!['sprites.png','sprites.json'].includes(name))files[prefix+name]=data;
     gamePackage=prefix+'manifest.json';
    }
    sources.push({inputIndex:index,filename:source.filename,documentId:original.id,...(source.transforms.length?{transforms:source.transforms}:{}),project,gamePackage,entryIds:plan.entries.filter(entry=>entry.inputIndex===index).map(entry=>entry.id),jobIds:plan.jobs.filter(job=>job.inputIndex===index).map(job=>job.id)});
   }
   const sourceMetadata={format:'pixelwall-export-sources',version:1,atlas:{image:'sprites.png',metadata:'sprites.json'},sources,jobs:plan.jobs.map(job=>({id:job.id,inputIndex:job.inputIndex,layerIds:job.layerIds,tagId:job.tag?.id??null,sliceId:job.slice?.id??null,sourceFrameIds:job.frameIds,entryIds:job.entryIds}))};
   files['sources.json']=jsonBytes(sourceMetadata);
   if(plan.sources.length>1)files['manifest.json']=jsonBytes({format:'pixelwall-game-package',version:2,atlas:sourceMetadata.atlas,sources:'sources.json',projects:sources.map(source=>source.project),packages:sources.map(source=>source.gamePackage).filter(Boolean)});
   outputs=[{name:'sprites.zip',data:zipSync(files)}];
  }else outputs=[{name:imageName,data:writePng(atlas.width,atlas.height,atlas.rgba),kind:'image'},{name:outputName(imageName,'json'),data:jsonBytes(metadata),kind:'metadata'}];
 }
 const names=new Set();for(const output of outputs){const name=output.name.toLowerCase();if(names.has(name))fail(`Output filenames collide after filename sanitizing: ${output.name}. Use a distinct --filename-format.`);names.add(name);}
 return {plan,outputs};
}
export function extractLicenseToken(text){if(Buffer.byteLength(text,'utf8')>65536)fail('Ownership license file exceeds 64 KiB.');const candidates=text.split(/\s+/).filter(word=>word.startsWith('PW2.'));if(candidates.length!==1)fail(candidates.length?'Ownership license file contains multiple PW2 codes; keep exactly one code in the file.':'Ownership license file does not contain a PW2 code.');const token=candidates[0];if(!/^PW2\.[A-Za-z0-9_-]{1,2667}\.[A-Za-z0-9_-]{86}$/.test(token))fail('Ownership license file contains a malformed PW2 code.');return token;}
async function requirePro(args){let token=process.env.PIXELWALL_PRO_LICENSE||'';if(args.license){const value=required(args,'license');if(value.startsWith('PW2.'))token=value;else{const path=resolve(value);if((await stat(path)).size>65536)fail('Ownership license file exceeds 64 KiB.');token=extractLicenseToken(await readFile(path,'utf8'));}}const claims=await verifyOfflineLicense(token,{publicKeys:PINNED_PUBLIC_KEYS,mode:'live'});if(!claims)fail('A valid PixelWall Pro license is required for this export. Supply --license license.txt or PIXELWALL_PRO_LICENSE.');return claims;}
function framesFor(doc,args,rendering={}){if(args['include-reference-layers']!==true)doc={...doc,layers:doc.layers.map(layer=>layer.type==='reference'?{...layer,visible:false}:layer)};let frames=doc.frames;if(args.clip){const clip=doc.clips.find(c=>c.id===args.clip||c.name===args.clip);if(!clip)fail('Unknown clip.');frames=clip.frameIds.map(id=>doc.frames.find(f=>f.id===id));if(clip.direction==='reverse'||clip.direction==='pingpong_reverse')frames.reverse();if(clip.direction==='pingpong'||clip.direction==='pingpong_reverse')frames=[...frames,...frames.slice(1,-1).reverse()];}if(args.frame!=null){const frame=doc.frames.find(f=>f.id===args.frame)||doc.frames[Number(args.frame)];if(!frame)fail('Unknown frame.');frames=[frame];}const scale=number(args,'scale',1);return frames.map((frame,index)=>({id:frame.id,name:`${doc.name.replace(/[^a-z0-9_-]/gi,'_')}-${String(index+1).padStart(4,'0')}`,...renderScaledExportFrame(doc,frame.id,scale,rendering),durationMs:frame.durationMs}));}
export async function main(argv=process.argv.slice(2)){
 const {args,inputs:inputScopes,orderedScaleCount}=parseCliArguments(argv),[command,input,...rest]=args._;if(!command||command==='help'||args.help){process.stdout.write(HELP);return;}
 if(command==='commands'){process.stdout.write(JSON.stringify(COMMANDS,null,2)+'\n');return;}
 if(command==='new'){const doc=createDocument({width:number(args,'width',32),height:number(args,'height',number(args,'width',32)),name:args.name||'Untitled Sprite',colorMode:args['color-mode']||'rgba',durationMs:number(args,'duration',100)});await saveDocument(required(args,'out'),doc);return;}
 if(command==='import-sequence'){const paths=[input,...rest].filter(Boolean);if(!paths.length)fail('Provide one or more PNG filenames.');const entries=[];for(const path of paths){const result=await readManagedPng(new Uint8Array(await readFile(resolve(path))));warn(result.warnings);entries.push(result);}await saveDocument(required(args,'out'),importSequence(entries,{name:args.name||'Imported sequence',durationMs:number(args,'duration',100)}));return;}
 let doc=await readDocument(input);
 if(command==='inspect'){process.stdout.write(JSON.stringify({...describeDocument(doc),layerDetails:doc.layers,frameDetails:doc.frames.map(f=>({id:f.id,durationMs:f.durationMs,cels:Object.keys(f.cels)})),clips:doc.clips,slices:doc.slices,metadata:doc.metadata},null,2)+'\n');return;}
 if(command==='import'){if(args['frame-width']||args['frame-height']){if(extname(input).toLowerCase()!=='.png')fail('Sheet import requires a PNG image.');doc=importSheet(await readManagedPng(new Uint8Array(await readFile(resolve(input)))),{frameWidth:number(args,'frame-width'),frameHeight:number(args,'frame-height'),margin:number(args,'margin',0),spacing:number(args,'spacing',0),count:number(args,'count'),durationMs:number(args,'duration',100),order:args.order||'row',name:args.name||'Imported sheet'});}await saveDocument(required(args,'out'),doc);return;}
 if(command==='apply'){const data=JSON.parse(await readFile(resolve(required(args,'commands')),'utf8')),commands=Array.isArray(data)?data:data.commands;if(!Array.isArray(commands))fail('Command file must be a JSON array or {commands:[...]}.');for(const cmd of commands)doc=applyCommand(doc,cmd);await saveDocument(required(args,'out'),doc);return;}
 if(command==='script'){
  const scriptPath=resolve(required(args,'script'));
  if(extname(scriptPath).toLowerCase()==='.lua'){
   const wasm=new URL('./runtimes/lua.wasm',import.meta.url),result=await runLuaScript({source:await readFile(scriptPath,'utf8'),document:doc,params:args.params?JSON.parse(required(args,'params')):{},timeoutMs:number(args,'timeout',3000)},{wasmUri:existsSync(wasm)?wasm.href:undefined});
   const changedIds=new Set(result.transactions.map(item=>item.documentId));
   if(args['out-dir']){let index=0;const outputs=[];for(const output of result.documents)if(changedIds.has(output.id)||result.created.some(created=>created.id===output.id)){const name=output.name.replace(/[^a-z0-9_-]/gi,'_')||'sprite';outputs.push({path:joinPath(required(args,'out-dir'),`${String(++index).padStart(3,'0')}-${name}.pixelwall`),data:jsonBytes(normalizeDocument(output))});}await writeOutputs(outputs,{exclusive:true});}
   else{if([...changedIds].some(id=>id!==result.document?.id))fail('The script edited multiple projects. Supply --out-dir to save every result.');if(!result.document)fail('The Lua script returned no active sprite.');await saveDocument(required(args,'out'),result.document);}
   for(const line of result.prints)process.stderr.write(line+'\n');return;
  }
  const scriptModule=await import(pathToFileURL(scriptPath).href);if(typeof scriptModule.default!=='function')fail('Script must export a default function.');const context={get document(){return structuredClone(doc);},apply(command){doc=applyCommand(doc,command);return structuredClone(doc);},commands:COMMANDS};const result=await scriptModule.default(context);if(result!=null)doc=normalizeDocument(result);await saveDocument(required(args,'out'),doc);return;}
 if(command==='profile'){if(args.assign&&args.convert)fail('Choose either --assign or --convert.');const manager=await loadNodeColorManager(),file=args.assign||args.convert;if(!file||file===true)fail('Supply --assign or --convert with sRGB or an ICC filename.');const target=file==='sRGB'?'sRGB':manager.readProfile(new Uint8Array(await readFile(resolve(file))));doc=args.assign?manager.assignProfile(doc,target):manager.convertDocument(doc,target,{intent:number(args,'intent',1)});await saveDocument(required(args,'out'),doc);return;}
 if(command==='render'){const colorManager=isSRGB(documentProfile(doc))?undefined:await loadNodeColorManager();const [entry]=framesFor(doc,{...args,frame:args.frame??'0'},{colorManager,intent:number(args,'intent',1)});await atomicWrite(required(args,'out'),writePng(entry.width,entry.height,entry.rgba));return;}
 if(command==='export'){
  const format=required(args,'format').toLowerCase(),paths=[input,...rest],outDir=args['out-dir']?required(args,'out-dir'):null;
  if(!['ase','aseprite','pixelwall','json','png','bmp','tga','gif','sheet','atlas','zip'].includes(format))fail(`Unknown export format ${format}.`);
  if(outDir&&args.out)fail('Choose --out or --out-dir, not both.');
  const out=outDir?null:required(args,'out');
  if(outDir&&['sheet','atlas','zip'].includes(format))fail(`Combined ${format} export requires --out; --out-dir is for separate files.`);
  if(['gif','sheet','atlas','zip'].includes(format))await requirePro(args);
  const inputs=[];for(const [index,path]of paths.entries()){const originalDocument=index===0?doc:await readDocument(path);inputs.push({filename:path,document:originalDocument,originalDocument,options:inputScopes[index]?.options,transforms:inputScopes[index]?.transforms});}
  if(['ase','aseprite','pixelwall','json'].includes(format)){
   if(orderedScaleCount)fail('Ordered scale operations are available for rendered exports only. Editable exports preserve the original project.');
   if(inputs.some(source=>(source.options?.['split-grid']??args['split-grid']) || (source.options?.grid??args.grid)!=null))fail('--split-grid and --grid are available for sheet, atlas and ZIP exports only.');
   if(inputs.length>1&&!outDir)fail('Multiple editable projects require --out-dir so every input is saved.');
   if(inputs.some(source=>[...selectionKeys,'layer','ignore-layer','slice','crop','frame','all-layers','trim-sprite'].some(key=>{const value=source.options?.[key]??args[key];return value!=null&&value!==false;})))fail('Native editable exports preserve the complete project. Use raster exports for layer, frame, tag, slice or crop selections.');
   const extension=['ase','aseprite'].includes(format)?'aseprite':'pixelwall',outputs=inputs.map(source=>({path:outDir?joinPath(outDir,outputName(basename(source.filename),extension)):out,data:extension==='aseprite'?writeAseprite(source.document):jsonBytes(source.document)}));
   await writeOutputs(outputs,{exclusive:!!outDir});return;
  }
  const colorManager=inputs.some(source=>!isSRGB(documentProfile(source.document)))?await loadNodeColorManager():undefined;
  const {plan,outputs}=buildCliExportOutputs(inputs,{...args,format},{colorManager,intent:number(args,'intent',1)});
  if(['png','bmp','tga','gif'].includes(format)){
   if(!outDir&&(outputs.length>1||(format==='gif'&&(inputs.some(source=>['split-layers','split-tags','split-slices'].some(key=>source.options?.[key]??args[key]))||inputs.length>1))))fail('Multiple frames or split animation jobs require --out-dir; no output was written.');
   if(format==='gif')warn(['GIF reduces alpha to binary transparency and quantizes images that exceed 255 opaque colors.']);
   await writeOutputs(outputs.map(output=>({path:outDir?joinPath(outDir,output.name):out,data:output.data})),{exclusive:!!outDir});return;
  }
  const files=outputs.map(output=>({path:output.kind==='metadata'?(args.metadata?required(args,'metadata'):joinPath(dirname(out),basename(out,extname(out))+'.json')):out,data:output.data}));
  if(plan.entries.length)await writeOutputs(files);return;
 }
 fail(`Unknown command ${command}. Run pixelwall help.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(resolve(process.argv[1]))).href)main().catch(error=>{process.stderr.write(`PixelWall: ${error.message}\n`);process.exitCode=1;});

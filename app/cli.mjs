#!/usr/bin/env node
/** Standalone trusted-user CLI; no app server or AI service is required. */
import {readFile,writeFile,rename,mkdir,unlink,stat} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createDocument,normalizeDocument,applyCommand,renderFrame,describeDocument,COMMANDS} from './editor-core.mjs';
import {readAseprite,writeAseprite,readPng,writePng,importGif,importSequence,importSheet,packAtlas,makeSpriteSheet,encodeGif,makeGamePackage,readBmp,writeBmp,readTga,writeTga} from './formats.mjs';
import {verifyOfflineLicense} from './offline-license.mjs';
import {PINNED_PUBLIC_KEYS} from './license-public-keys.mjs';
const HELP=`PixelWall CLI — local sprite editing and export

  pixelwall new --width 32 --height 32 --name Hero --out hero.pixelwall
  pixelwall inspect hero.pixelwall
  pixelwall commands
  pixelwall apply hero.pixelwall --commands edits.json --out hero.pixelwall
  pixelwall script hero.pixelwall --script ./draw.mjs --out hero.pixelwall
  pixelwall import art.aseprite --out hero.pixelwall
  pixelwall import sheet.png --frame-width 32 --frame-height 32 --out hero.pixelwall
  pixelwall import-sequence frame1.png frame2.png --duration 100 --out hero.pixelwall
  pixelwall render hero.pixelwall --frame 0 --scale 4 --out hero.png
  pixelwall export hero.pixelwall --format aseprite --out hero.aseprite
  pixelwall export hero.pixelwall --format gif --out hero.gif --license license.txt
  pixelwall export hero.pixelwall --format sheet --columns 4 --out hero.png --license license.txt
  pixelwall export hero.pixelwall --format atlas --trim --padding 2 --extrude 1 --power-of-two --out atlas.png --license license.txt
  pixelwall export hero.pixelwall --format zip --out frames.zip --license license.txt

Frames are zero-based indices or frame IDs. --clip selects a clip by name or ID.
PNG/BMP/TGA, native projects and Aseprite are free; GIF, sheet, atlas and ZIP require Pro.
A signed perpetual license can also be supplied with PIXELWALL_PRO_LICENSE.
Scripts are explicitly trusted local JavaScript modules, with normal Node access.
Export default async ({document,apply}) => { apply({type:...}); } from your script.
All edits use the same document commands as the editor. No embedded AI is used.
`;
function fail(message){throw new Error(message);}
function parseArgs(argv){const args={_:[]};for(let i=0;i<argv.length;i++){const value=argv[i];if(!value.startsWith('--')){args._.push(value);continue;}const eq=value.indexOf('='),key=value.slice(2,eq<0?undefined:eq);if(!key)fail('Invalid option.');if(eq>=0)args[key]=value.slice(eq+1);else if(argv[i+1]&&!argv[i+1].startsWith('--'))args[key]=argv[++i];else args[key]=true;}return args;}
function number(args,key,fallback){if(args[key]==null)return fallback;const n=Number(args[key]);if(!Number.isFinite(n))fail(`--${key} must be a number.`);return n;}
function required(args,key){const value=args[key];if(typeof value!=='string'||!value)fail(`--${key} is required.`);return value;}
function warn(warnings){for(const warning of warnings||[])process.stderr.write(`Warning: ${warning}\n`);}
async function readDocument(path){if(!path)fail('Input file is required.');const input=new Uint8Array(await readFile(resolve(path))),extension=extname(path).toLowerCase();if(['.ase','.aseprite'].includes(extension)){const result=readAseprite(input);warn(result.warnings);return normalizeDocument(result.document);}if(['.png','.bmp','.tga'].includes(extension)){const image=extension==='.bmp'?readBmp(input):extension==='.tga'?readTga(input):readPng(input);warn(image.warnings);return normalizeDocument(importSequence([image],{name:path.split(/[\\/]/).at(-1)}));}if(extension==='.gif'){const result=importGif(input);warn(result.warnings);return normalizeDocument(result.document);}return normalizeDocument(JSON.parse(new TextDecoder().decode(input)));}
async function atomicWrite(path,data){const target=resolve(path);await mkdir(dirname(target),{recursive:true});const temp=`${target}.${process.pid}.${Date.now()}.tmp`;try{await writeFile(temp,data);await rename(temp,target);}catch(error){await unlink(temp).catch(()=>{});throw error;}}
async function saveDocument(path,document){await atomicWrite(path,JSON.stringify(normalizeDocument(document),null,2)+'\n');}
export function extractLicenseToken(text){if(Buffer.byteLength(text,'utf8')>65536)fail('Ownership license file exceeds 64 KiB.');const candidates=text.split(/\s+/).filter(word=>word.startsWith('PW2.'));if(candidates.length!==1)fail(candidates.length?'Ownership license file contains multiple PW2 codes; keep exactly one code in the file.':'Ownership license file does not contain a PW2 code.');const token=candidates[0];if(!/^PW2\.[A-Za-z0-9_-]{1,2667}\.[A-Za-z0-9_-]{86}$/.test(token))fail('Ownership license file contains a malformed PW2 code.');return token;}
async function requirePro(args){let token=process.env.PIXELWALL_PRO_LICENSE||'';if(args.license){const value=required(args,'license');if(value.startsWith('PW2.'))token=value;else{const path=resolve(value);if((await stat(path)).size>65536)fail('Ownership license file exceeds 64 KiB.');token=extractLicenseToken(await readFile(path,'utf8'));}}const claims=await verifyOfflineLicense(token,{publicKeys:PINNED_PUBLIC_KEYS,mode:'live'});if(!claims)fail('A valid PixelWall Pro license is required for this export. Supply --license license.txt or PIXELWALL_PRO_LICENSE.');return claims;}
function scaleFrame(entry,scale){if(scale===1)return entry;if(!Number.isInteger(scale)||scale<1||scale>64)fail('Scale must be an integer from 1 to 64.');const width=entry.width*scale,height=entry.height*scale;if(width*height>64*1024*1024)fail('Scaled output exceeds the pixel limit.');const rgba=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(Math.floor(y/scale)*entry.width+Math.floor(x/scale))*4;rgba.set(entry.rgba.subarray(p,p+4),(y*width+x)*4);}return {...entry,width,height,rgba};}
function framesFor(doc,args){let frames=doc.frames;if(args.clip){const clip=doc.clips.find(c=>c.id===args.clip||c.name===args.clip);if(!clip)fail('Unknown clip.');frames=clip.frameIds.map(id=>doc.frames.find(f=>f.id===id));if(clip.direction==='reverse'||clip.direction==='pingpong_reverse')frames.reverse();if(clip.direction==='pingpong'||clip.direction==='pingpong_reverse')frames=[...frames,...frames.slice(1,-1).reverse()];}if(args.frame!=null){const frame=doc.frames.find(f=>f.id===args.frame)||doc.frames[Number(args.frame)];if(!frame)fail('Unknown frame.');frames=[frame];}const scale=number(args,'scale',1);return frames.map((frame,index)=>scaleFrame({id:frame.id,name:`${doc.name.replace(/[^a-z0-9_-]/gi,'_')}-${String(index+1).padStart(4,'0')}`,width:doc.width,height:doc.height,rgba:renderFrame(doc,frame.id),durationMs:frame.durationMs},scale));}
export async function main(argv=process.argv.slice(2)){
 const args=parseArgs(argv),[command,input,...rest]=args._;if(!command||command==='help'||args.help){process.stdout.write(HELP);return;}
 if(command==='commands'){process.stdout.write(JSON.stringify(COMMANDS,null,2)+'\n');return;}
 if(command==='new'){const doc=createDocument({width:number(args,'width',32),height:number(args,'height',number(args,'width',32)),name:args.name||'Untitled Sprite',colorMode:args['color-mode']||'rgba',durationMs:number(args,'duration',100)});await saveDocument(required(args,'out'),doc);return;}
 if(command==='import-sequence'){const paths=[input,...rest].filter(Boolean);if(!paths.length)fail('Provide one or more PNG filenames.');const entries=[];for(const path of paths){const result=readPng(new Uint8Array(await readFile(resolve(path))));warn(result.warnings);entries.push(result);}await saveDocument(required(args,'out'),importSequence(entries,{name:args.name||'Imported sequence',durationMs:number(args,'duration',100)}));return;}
 let doc=await readDocument(input);
 if(command==='inspect'){process.stdout.write(JSON.stringify({...describeDocument(doc),layerDetails:doc.layers,frameDetails:doc.frames.map(f=>({id:f.id,durationMs:f.durationMs,cels:Object.keys(f.cels)})),clips:doc.clips,slices:doc.slices,metadata:doc.metadata},null,2)+'\n');return;}
 if(command==='import'){if(args['frame-width']||args['frame-height']){if(extname(input).toLowerCase()!=='.png')fail('Sheet import requires a PNG image.');doc=importSheet(readPng(new Uint8Array(await readFile(resolve(input)))),{frameWidth:number(args,'frame-width'),frameHeight:number(args,'frame-height'),margin:number(args,'margin',0),spacing:number(args,'spacing',0),count:number(args,'count'),durationMs:number(args,'duration',100),order:args.order||'row',name:args.name||'Imported sheet'});}await saveDocument(required(args,'out'),doc);return;}
 if(command==='apply'){const data=JSON.parse(await readFile(resolve(required(args,'commands')),'utf8')),commands=Array.isArray(data)?data:data.commands;if(!Array.isArray(commands))fail('Command file must be a JSON array or {commands:[...]}.');for(const cmd of commands)doc=applyCommand(doc,cmd);await saveDocument(required(args,'out'),doc);return;}
 if(command==='script'){const scriptModule=await import(pathToFileURL(resolve(required(args,'script'))).href);if(typeof scriptModule.default!=='function')fail('Script must export a default function.');const context={get document(){return structuredClone(doc);},apply(command){doc=applyCommand(doc,command);return structuredClone(doc);},commands:COMMANDS};const result=await scriptModule.default(context);if(result!=null)doc=normalizeDocument(result);await saveDocument(required(args,'out'),doc);return;}
 if(command==='render'){const [entry]=framesFor(doc,{...args,frame:args.frame??'0'});await atomicWrite(required(args,'out'),writePng(entry.width,entry.height,entry.rgba));return;}
 if(command==='export'){
  const format=required(args,'format').toLowerCase(),out=required(args,'out');if(['ase','aseprite'].includes(format)){await atomicWrite(out,writeAseprite(doc));return;}if(format==='pixelwall'||format==='json'){await saveDocument(out,doc);return;}if(['png','bmp','tga'].includes(format)){const [entry]=framesFor(doc,{...args,frame:args.frame??'0'});const write=format==='bmp'?writeBmp:format==='tga'?writeTga:writePng;await atomicWrite(out,write(entry.width,entry.height,entry.rgba));return;}
  if(!['gif','sheet','atlas','zip'].includes(format))fail(`Unknown export format ${format}.`);await requirePro(args);const entries=framesFor(doc,args);if(format==='gif'){warn(['GIF reduces alpha to binary transparency and quantizes images that exceed 255 opaque colors.']);await atomicWrite(out,encodeGif(entries,{loop:number(args,'loop',0)}));return;}if(format==='zip'){await atomicWrite(out,makeGamePackage(doc,{entries,scale:number(args,'scale',1),padding:number(args,'padding',1),extrude:number(args,'extrude',0),powerOfTwo:!!args['power-of-two']}));return;}
  const result=format==='atlas'?packAtlas(entries,{scale:number(args,'scale',1),trim:args.trim!=='false',padding:number(args,'padding',1),extrude:number(args,'extrude',0),border:number(args,'border',number(args,'padding',1)),powerOfTwo:!!args['power-of-two'],maxSize:number(args,'max-size',8192),clips:doc.clips,slices:doc.slices,imageName:out.split(/[\\/]/).at(-1)}):makeSpriteSheet(entries,{columns:number(args,'columns',entries.length),padding:number(args,'padding',0)});await atomicWrite(out,writePng(result.width,result.height,result.rgba));await atomicWrite(args.metadata||out.replace(/\.[^.]+$/,'')+'.json',JSON.stringify({frames:result.frames,meta:result.meta},null,2)+'\n');return;
 }
 fail(`Unknown command ${command}. Run pixelwall help.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(resolve(process.argv[1]))).href)main().catch(error=>{process.stderr.write(`PixelWall: ${error.message}\n`);process.exitCode=1;});

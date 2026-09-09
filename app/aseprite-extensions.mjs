/** Aseprite ZIP packages as inert local data. Importing never executes Lua or plugin hooks. */
import { Inflate } from 'fflate';
import { parsePalette } from './editor-extensions.mjs';
import { readPng } from './formats.mjs';
export const ASEPRITE_EXTENSION_LIMITS=Object.freeze({archive:16*1024*1024,expanded:32*1024*1024,file:8*1024*1024,manifest:256*1024,script:1024*1024,entries:1024,contributions:512,path:240,packages:64,stored:32*1024*1024,registryExpanded:64*1024*1024,decoded:32*1024*1024});
const L=ASEPRITE_EXTENSION_LIMITS,decoder=new TextDecoder('utf-8',{fatal:true});
export class AsepriteExtensionError extends Error{constructor(message,code='INVALID_EXTENSION'){super(message);this.name='AsepriteExtensionError';this.code=code;}}
const fail=(message,code)=>{throw new AsepriteExtensionError(message,code);};
const check=(value,message,code)=>{if(!value)fail(message,code);};
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function bytes(input){if(input instanceof Uint8Array)return input;if(input instanceof ArrayBuffer)return new Uint8Array(input);fail('Extension must be a ZIP file.');}
function utf8(input,label){try{return decoder.decode(input);}catch{fail(`${label} is not valid UTF-8.`);}}
function text(value,label,max=240,required=false){if(value===undefined&&!required)return '';check(typeof value==='string'&&value.length<=max&&(!required||value.trim()),`${label} is invalid.`);return value;}
function boundedMetadata(value,depth=0,budget={nodes:0}){check(depth<=32&&++budget.nodes<=16384,'Package metadata exceeds nesting or node limits.','ZIP_LIMIT');if(value&&typeof value==='object')for(const child of Object.values(value))boundedMetadata(child,depth+1,budget);}
function safePath(value,{directory=false}={}){
 check(typeof value==='string'&&value.length>0&&value.length<=L.path,'Extension path is invalid.');
 let path=value;while(path.startsWith('./'))path=path.slice(2);
 if(directory&&path.endsWith('/'))path=path.slice(0,-1);
 check(path&&!/[\\:]/.test(path)&&![...path].some(c=>c.codePointAt(0)<32||c.codePointAt(0)===127)&&!path.startsWith('/'),'Extension contains an unsafe path.','UNSAFE_PATH');
 for(const part of path.split('/'))check(part&&part!=='.'&&part!=='..'&&part.trim()===part&&!part.endsWith('.')&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),'Extension contains an unsafe path.','UNSAFE_PATH');
 return path.normalize('NFC');
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(data){let n=0xffffffff;for(const b of data)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
function boundedInflate(compressed,size){
 const result=new Uint8Array(size);let count=0,finished=false;
 const stream=new Inflate((chunk,final)=>{check(count+chunk.length<=size,'ZIP data exceeds its declared size.','ZIP_LIMIT');result.set(chunk,count);count+=chunk.length;finished=final;});
 try{for(let p=0;p<compressed.length;p+=256)stream.push(compressed.subarray(p,p+256),p+256>=compressed.length);if(!compressed.length)stream.push(compressed,true);}catch(error){if(error instanceof AsepriteExtensionError)throw error;fail('ZIP compressed data is invalid.');}
 check(finished&&count===size,'ZIP data does not match its declared size.');return result;
}
/** Validate the central directory before inflating; retain files in memory only. */
function unzipPackage(input){
 const data=bytes(input);check(data.length>=22&&data.length<=L.archive,'Extension archive exceeds 16 MB or is truncated.','ZIP_LIMIT');
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength),u16=p=>view.getUint16(p,true),u32=p=>view.getUint32(p,true);
 let end=-1;for(let p=data.length-22;p>=Math.max(0,data.length-65557);p--)if(u32(p)===0x06054b50&&p+22+u16(p+20)===data.length){end=p;break;}
 check(end>=0,'ZIP end directory is missing.');check(!u16(end+4)&&!u16(end+6)&&u16(end+8)===u16(end+10),'Split ZIP archives are unsupported.');
 const count=u16(end+10),length=u32(end+12),offset=u32(end+16);check(count>0&&count<=L.entries,'ZIP has too many or no entries.','ZIP_LIMIT');check(offset+length===end&&offset>0,'ZIP directory bounds are invalid.');check(u32(0)===0x04034b50,'Self-extracting ZIP archives are unsupported.');
 const entries=[],names=new Set(),ranges=[];let p=offset,total=0;
 for(let i=0;i<count;i++){
  check(p+46<=end&&u32(p)===0x02014b50,'ZIP directory is truncated.');
  const flags=u16(p+8),method=u16(p+10),crc=u32(p+16),compressed=u32(p+20),size=u32(p+24),nameLength=u16(p+28),extraLength=u16(p+30),commentLength=u16(p+32),local=u32(p+42),host=u16(p+4)>>>8,mode=u32(p+38)>>>16;
  check(!u16(p+34),'Split ZIP archives are unsupported.');check(!(flags&~0x080e)&&!(flags&1),'Encrypted or unsupported ZIP flags.');check(method===0||method===8,'Only stored or deflated ZIP files are supported.');
  check(p+46+nameLength+extraLength+commentLength<=end,'ZIP filename or extra data is truncated.');
  const rawName=utf8(data.subarray(p+46,p+46+nameLength),'ZIP filename'),directory=rawName.endsWith('/'),path=safePath(rawName,{directory});
  check(!names.has(path.toLowerCase()),'ZIP contains duplicate or conflicting paths.','UNSAFE_PATH');names.add(path.toLowerCase());
  check(host!==3||!mode||[0,0x4000,0x8000].includes(mode&0xf000),'ZIP links and special files are unsupported.','UNSAFE_PATH');
  check(size<=L.file&&compressed<=L.archive&&size!==0xffffffff&&compressed!==0xffffffff,'ZIP entry exceeds the file limit.','ZIP_LIMIT');total+=size;check(total<=L.expanded,'ZIP expansion exceeds 32 MB.','ZIP_LIMIT');
  check(!directory||size===0,'ZIP directory contains file data.');check(local+30<=offset&&u32(local)===0x04034b50,'ZIP local header is invalid.');
  const localNameLength=u16(local+26),localExtraLength=u16(local+28),start=local+30+localNameLength+localExtraLength,stop=start+compressed;
  check(start<=offset&&stop<=offset&&u16(local+6)===flags&&u16(local+8)===method,'ZIP local and directory headers disagree.');
  check(utf8(data.subarray(local+30,local+30+localNameLength),'ZIP local filename')===rawName,'ZIP filenames disagree.');
  if(!(flags&8))check(u32(local+14)===crc&&u32(local+18)===compressed&&u32(local+22)===size,'ZIP sizes or checksum disagree.');
  let rangeEnd=stop;
  if(flags&8){let d=stop;check(d+12<=offset,'ZIP data descriptor is missing.');if(u32(d)===0x08074b50&&d+16<=offset&&u32(d+4)===crc)d+=4;check(d+12<=offset&&u32(d)===crc&&u32(d+4)===compressed&&u32(d+8)===size,'ZIP data descriptor disagrees.');rangeEnd=d+12;}
  ranges.push([local,rangeEnd]);entries.push({path,directory,method,crc,compressed,size,start});p+=46+nameLength+extraLength+commentLength;
 }
 check(p===offset+length,'ZIP directory size mismatch.');ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)check(ranges[i-1][1]<=ranges[i][0],'ZIP entries overlap.');
 const files=new Map();for(const e of entries){if(e.directory)continue;check(![...names].some(n=>n.startsWith(e.path.toLowerCase()+'/')),'ZIP file conflicts with a directory.','UNSAFE_PATH');const source=data.subarray(e.start,e.start+e.compressed),value=e.method===0?source.slice():boundedInflate(source,e.size);check(value.length===e.size&&crc32(value)===e.crc,'ZIP file checksum mismatch.');files.set(e.path,value);}
 return{files,total};
}
const rgbaHex=c=>'#'+Array.from(c,v=>v.toString(16).padStart(2,'0')).join('');
// Palette chunks are read directly; embedded cels and images are never inflated.
function nativePalette(data){
 check(data.length>=128,'Native palette document is truncated.');const v=new DataView(data.buffer,data.byteOffset,data.byteLength),u16=p=>v.getUint16(p,true),u32=p=>v.getUint32(p,true);
 check(u16(4)===0xa5e0&&u32(0)===data.length&&u16(6)>0,'Not a supported sprite palette document.');check(data.length>=144&&u16(132)===0xf1fa,'Native palette frame is invalid.');
 const end=128+u32(128),count=u16(134)===65535?u32(140):u16(134);check(end<=data.length&&end>=144,'Native palette frame is truncated.');let pos=144,palette=Array(u16(32)||256).fill('#000000ff'),found=false,modern=false;
 for(let c=0;c<count;c++){check(pos+6<=end,'Native palette chunk is truncated.');const size=u32(pos),kind=u16(pos+4),stop=pos+size;check(size>=6&&stop<=end,'Native palette chunk size is invalid.');let p=pos+6;
  if(kind===0x2019){check(p+20<=stop,'Native palette header is truncated.');const total=u32(p),first=u32(p+4),last=u32(p+8);check(total>=1&&total<=65536&&first<=last&&last<total,'Native palette range is invalid.');palette=Array.from({length:total},(_,i)=>palette[i]??'#000000ff');p+=20;for(let i=first;i<=last;i++){check(p+6<=stop,'Native palette entry is truncated.');const flags=u16(p);check(!(flags&~1),'Unsupported palette entry flags.');palette[i]=rgbaHex(data.subarray(p+2,p+6));p+=6;if(flags&1){check(p+2<=stop,'Native color name is truncated.');const len=u16(p);p+=2;check(p+len<=stop,'Native color name is truncated.');p+=len;}}found=true;modern=true;
  }else if(!modern&&(kind===4||kind===17)){check(p+2<=stop,'Legacy palette is truncated.');const packets=u16(p);p+=2;let index=0;for(let packet=0;packet<packets;packet++){check(p+2<=stop,'Legacy palette packet is truncated.');index+=data[p++];const n=data[p++]||256;check(index+n<=256&&p+n*3<=stop,'Legacy palette range is invalid.');for(let i=0;i<n;i++){const values=[...data.subarray(p,p+3)].map(x=>kind===17?Math.round(x*255/63):x);check(values.every(x=>x<=255),'Legacy palette channel is invalid.');palette[index++]=rgbaHex([...values,255]);p+=3;}}found=true;}
  pos=stop;
 }
 check(found,'The document has no palette in its first frame.');return palette;
}
function pngPalette(data){
 const image=smallPng(data),type=data[25];
 if(type===3){let p=8,colors,alpha;while(p<data.length){const v=new DataView(data.buffer,data.byteOffset+p,data.length-p),length=v.getUint32(0),kind=new TextDecoder().decode(data.subarray(p+4,p+8));if(kind==='PLTE')colors=data.subarray(p+8,p+8+length);if(kind==='tRNS')alpha=data.subarray(p+8,p+8+length);p+=12+length;}return Array.from({length:colors.length/3},(_,i)=>rgbaHex([...colors.subarray(i*3,i*3+3),alpha?.[i]??255]));}
 check(type===2||type===6,'Grayscale PNG palettes are preserved but not yet interpreted.','UNSUPPORTED_CONTRIBUTION');
 const unique=new Map([['#00000000',[0,0,0,0]]]);for(let p=0;p<image.rgba.length;p+=4){const c=Array.from(image.rgba.subarray(p,p+4));if(c[3])unique.set(rgbaHex(c),c);}
 check(unique.size<=256,'PNG has more than 255 visible colors and needs palette quantization; use an explicit GPL/PAL palette.','UNSUPPORTED_CONTRIBUTION');
 // Independently pinned against Aseprite Palette{fromFile}: RGBA octree order.
 const key=c=>{let value=0;for(let bit=7;bit>=0;bit--)value=value*16+((c[0]>>>bit)&1)+(((c[1]>>>bit)&1)<<1)+(((c[2]>>>bit)&1)<<2)+(((c[3]>>>bit)&1)<<3);return value;};
 return[...unique.values()].sort((a,b)=>key(a)-key(b)).map(rgbaHex);
}
function paletteData(path,data){
 const suffix=path.split('.').at(-1).toLowerCase();
 if(['gpl','pal','hex','txt'].includes(suffix)){const source=utf8(data,'Palette'),colors=parsePalette(source);if(source.startsWith('JASC-PAL')){const lines=source.split(/\r?\n/);check(lines[1]?.trim()==='0100'&&/^\d+$/.test(lines[2]?.trim()??'')&&Number(lines[2].trim())===colors.length,'JASC palette header or color count is invalid.');}return colors;}
 if(['aseprite','ase'].includes(suffix))return nativePalette(data);
 if(suffix==='png')return pngPalette(data);
 fail(`Palette format .${suffix} is preserved but cannot be applied.`,'UNSUPPORTED_CONTRIBUTION');
}
function smallPng(data){check(data.length>=24&&data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71,'Contribution is not a PNG image.');const v=new DataView(data.buffer,data.byteOffset,data.byteLength),w=v.getUint32(16),h=v.getUint32(20);check(w>0&&h>0&&w<=1024&&h<=1024&&w*h<=65536,'Contribution image exceeds 65,536 pixels.','ZIP_LIMIT');return readPng(data);}
const packageFiles=new WeakMap();
/** Every contribution has an explicit state. Returned source/metadata is untrusted display data. */
export function readAsepriteExtension(input){
 const{files,total}=unzipPackage(input);let root='';
 if(!files.has('package.json')){const matches=[...files.keys()].filter(p=>p.endsWith('/package.json'));check(matches.length===1,'Extension needs one package.json.');root=matches[0].slice(0,-12);check([...files.keys()].every(p=>p.startsWith(root)),'Wrapped extension contains files outside its package folder.');}
 const manifestBytes=files.get(root+'package.json');check(manifestBytes?.length<=L.manifest,'Package manifest exceeds 256 KB.','ZIP_LIMIT');let manifest;try{manifest=JSON.parse(utf8(manifestBytes,'Package manifest'));}catch(error){if(error instanceof AsepriteExtensionError)throw error;fail('package.json is not valid JSON.');}
 boundedMetadata(manifest);
 check(record(manifest)&&record(manifest.contributes),'Package manifest needs contributions.');
 const name=text(manifest.name,'Package name',128,true);check(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name),'Package name must be a simple identifier.');
 const pkg={format:'aseprite-extension',id:name.toLowerCase(),name,displayName:text(manifest.displayName,'Display name',240)||name,version:text(manifest.version,'Version',80,true),description:text(manifest.description,'Description',4000),author:manifest.author??null,publisher:text(manifest.publisher,'Publisher',240),license:text(manifest.license,'License',240),categories:[],manifest:structuredClone(manifest),contributions:[],warnings:[],assets:[],expandedBytes:total};
 if(manifest.categories!==undefined){check(Array.isArray(manifest.categories)&&manifest.categories.length<=32,'Package categories are invalid.');pkg.categories=manifest.categories.map(c=>text(c,'Category',80,true));}
 const assetMap=new Map();for(const[path,data]of files){const local=path.slice(root.length);assetMap.set(local,data);pkg.assets.push({path:local,size:data.length});}
 let count=0,decodedBytes=0;for(const[kind,items]of Object.entries(manifest.contributes)){
  check(Array.isArray(items),`Contribution ${kind} must be a list.`);const ids=new Set();
  for(const item of items){check(++count<=L.contributions&&record(item),'Too many or malformed contributions.','ZIP_LIMIT');const known=['scripts','palettes','keys','ditheringMatrices','themes','languages'].includes(kind),rawPath=text(item.path,'Contribution path',L.path,known),isTheme=kind==='themes',path=!rawPath||isTheme&&['.','./'].includes(rawPath)?'':safePath(rawPath),id=item.id===undefined?(path||`${kind}-${count}`):text(item.id,'Contribution ID',240,true);check(!ids.has(id),`Duplicate ${kind} contribution ID.`);ids.add(id);
   const entry={kind,id,name:text(item.name??item.displayName,'Contribution name',240)||id,path,status:'unsupported',reason:'',metadata:structuredClone(item)};
   const data=assetMap.get(path);
   if(kind==='themes'){check(path===''||[...assetMap.keys()].some(p=>p.startsWith(path+'/')),'Theme directory is missing.');entry.reason='Theme assets are preserved for download; custom UI themes are not supported.';}
   else if(kind==='languages'){check(data,'Language file is missing.');entry.reason='Language resources are preserved for download; custom translations are not supported.';}
   else if(!['scripts','palettes','keys','ditheringMatrices'].includes(kind)){entry.reason=`Contribution type ${kind} is not supported. Its original metadata and package assets are preserved.`;}
   else{check(data,`Missing ${kind} file: ${path}`);
    if(kind==='scripts'){check(/\.lua$/i.test(path)&&data.length<=L.script,'Script must be a Lua text file of at most 1 MB.','ZIP_LIMIT');entry.source=utf8(data,'Lua source');check(!entry.source.includes('\0')&&!entry.source.startsWith('\x1bLua'),'Lua bytecode is unsupported.');entry.status='source-ready';entry.requiresPluginLifecycle=true;entry.reason='Review the Lua source or choose Run package commands. Importing does not execute scripts.';}
    if(kind==='palettes'){try{entry.colors=paletteData(path,data);entry.status='ready';}catch(error){if(error.code==='ZIP_LIMIT')throw error;entry.reason=`Palette preserved but not decoded: ${error.message}`;}}
    if(kind==='keys'){entry.xml=utf8(data,'Keyboard shortcuts');check(!/<!DOCTYPE|<!ENTITY/i.test(entry.xml),'Keyboard shortcut external declarations are unsupported.');entry.status='data-only';entry.reason='Shortcut XML is preserved for review; imported commands are not automatically bound to keys.';}
    if(kind==='ditheringMatrices'){try{check(/\.png$/i.test(path),'Only PNG dithering matrix images can currently be decoded.');const image=smallPng(data);entry.image={width:image.width,height:image.height,pixels:Array.from(image.rgba)};entry.status='data-only';entry.reason='Dithering matrix pixels are decoded; installing a package does not change the active drawing matrix.';}catch(error){if(error.code==='ZIP_LIMIT')throw error;entry.reason=`Dithering matrix preserved but not decoded: ${error.message}`;}}
   }
   decodedBytes+=(entry.source?.length??0)*2+(entry.xml?.length??0)*2+(entry.colors?.length??0)*64+(entry.image?.pixels.length??0)*8;check(decodedBytes<=L.decoded,'Decoded contributions exceed 32 MB.','ZIP_LIMIT');
   if(entry.reason)pkg.warnings.push({kind,id,message:entry.reason});pkg.contributions.push(entry);
  }
 }
 check(count>0,'Extension has no contributions.');packageFiles.set(pkg,assetMap);return pkg;
}
/** Assets are copied out, so callers cannot alter the validated package. No filesystem extraction. */
export function readExtensionAsset(pkg,path){const files=packageFiles.get(pkg);check(files,'Read the archive before accessing assets.');const value=files.get(safePath(path));check(value,`Package asset is missing: ${path}`);return value.slice();}
export const ASEPRITE_EXTENSION_STORAGE_KEY='aseprite-extension-packages-v1';
/** Adapter: existing durable store.getSetting/setSetting. One registry serializes its mutations. */
export function createAsepriteExtensionRegistry(store,{now=Date.now}={}){
 check(typeof store?.getSetting==='function'&&typeof store?.setSetting==='function','Extension registry needs durable settings storage.');let sequence=Promise.resolve();
 const queue=fn=>{const task=sequence.then(fn);sequence=task.catch(()=>{});return task;};
 async function state(){const value=await store.getSetting(ASEPRITE_EXTENSION_STORAGE_KEY,{version:1,packages:[]});check(record(value)&&value.version===1&&Array.isArray(value.packages)&&value.packages.length<=L.packages,'Saved extension registry is invalid.','INVALID_STORAGE');let total=0,expanded=0;const ids=new Set();for(const p of value.packages){check(record(p)&&typeof p.id==='string'&&/^[a-z0-9][a-z0-9._-]{0,127}$/.test(p.id)&&!ids.has(p.id)&&typeof p.enabled==='boolean'&&Number.isFinite(p.installedAt)&&Number.isFinite(p.updatedAt),'Saved extension entry is invalid.','INVALID_STORAGE');ids.add(p.id);const data=bytes(p.archive);check(data.length<=L.archive,'Saved extension exceeds its archive limit.','INVALID_STORAGE');total+=data.length;check(Number.isSafeInteger(p.expandedBytes)&&p.expandedBytes>=0&&p.expandedBytes<=L.expanded,'Saved expanded size is invalid.','INVALID_STORAGE');expanded+=p.expandedBytes;}check(expanded<=L.registryExpanded,'Installed extensions exceed the expanded storage budget.','INVALID_STORAGE');check(total<=L.stored,'Saved extensions exceed 32 MB.','INVALID_STORAGE');return structuredClone(value);}
 function details(entry){const pkg=readAsepriteExtension(entry.archive);check(pkg.id===entry.id&&pkg.expandedBytes===entry.expandedBytes,'Saved extension identity or size does not match its archive.','INVALID_STORAGE');return{...pkg,enabled:entry.enabled,installedAt:entry.installedAt,updatedAt:entry.updatedAt};}
 return{
  list:()=>queue(async()=>{const value=await state();return value.packages.map(p=>{const d=details(p);return{id:d.id,name:d.name,displayName:d.displayName,description:d.description,version:d.version,enabled:d.enabled,installedAt:d.installedAt,updatedAt:d.updatedAt,contributions:d.contributions.map(c=>({kind:c.kind,id:c.id,name:c.name,path:c.path,status:c.status,reason:c.reason})),warnings:d.warnings};});}),
  get:id=>queue(async()=>{const entry=(await state()).packages.find(p=>p.id===id);if(!entry)return null;const pkg=readAsepriteExtension(entry.archive);check(pkg.id===entry.id&&pkg.expandedBytes===entry.expandedBytes,'Saved extension identity or size does not match its archive.','INVALID_STORAGE');pkg.enabled=entry.enabled;pkg.installedAt=entry.installedAt;pkg.updatedAt=entry.updatedAt;return pkg;}),
  install:(input,{replace=false}={})=>queue(async()=>{const archive=bytes(input).slice(),pkg=readAsepriteExtension(archive),value=await state(),index=value.packages.findIndex(p=>p.id===pkg.id);check(index<0||replace,'Extension already exists. Use replace to update it.','ALREADY_INSTALLED');const time=now();check(Number.isFinite(time),'Extension timestamp is invalid.');const previous=value.packages[index],entry={id:pkg.id,enabled:previous?.enabled??true,installedAt:previous?.installedAt??time,updatedAt:time,expandedBytes:pkg.expandedBytes,archive};if(index<0)value.packages.push(entry);else value.packages[index]=entry;check(value.packages.length<=L.packages&&value.packages.reduce((n,p)=>n+p.archive.length,0)<=L.stored&&value.packages.reduce((n,p)=>n+p.expandedBytes,0)<=L.registryExpanded,'Installed extension storage limit exceeded.','ZIP_LIMIT');await store.setSetting(ASEPRITE_EXTENSION_STORAGE_KEY,value);pkg.enabled=entry.enabled;pkg.installedAt=entry.installedAt;pkg.updatedAt=time;return pkg;}),
  setEnabled:(id,enabled)=>queue(async()=>{check(typeof enabled==='boolean','Enabled must be true or false.');const value=await state(),entry=value.packages.find(p=>p.id===id);check(entry,'Extension is not installed.');entry.enabled=enabled;await store.setSetting(ASEPRITE_EXTENSION_STORAGE_KEY,value);return enabled;}),
  remove:id=>queue(async()=>{const value=await state(),count=value.packages.length;value.packages=value.packages.filter(p=>p.id!==id);if(value.packages.length===count)return false;await store.setSetting(ASEPRITE_EXTENSION_STORAGE_KEY,value);return true;})
 };
}

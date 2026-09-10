import { TILE_BACKDROP_CLEAR } from './tile-render-flags.mjs';
import { setNativePalette, generateNativePalette, convertNativeColorMode } from './native-color-commands.mjs';
import { applyColorProfileCommand } from './color-profile-command.mjs';
import { createNativeTileset, changeTilesetSlots, assignLayerTileset } from './tileset-structure.mjs';
import { rasterizeRotation } from './rotation-raster.mjs';
import { tilesetSlots, assertTilesetEditable } from './tileset-access.mjs';
import { indexedConversionOptions, quantizePalette, mapIndexedImage } from './indexed-color.mjs';
import { validateAsepriteUserData } from './aseprite-properties.mjs';
/** PixelWall v4: a portable, transactional 2D document and raster engine. No DOM. */
export const LIMITS = Object.freeze({ edge: 65535, canvasPixels: 4194304, imageEdge: 65535, pixels: 16777216, layers: 256, frames: 2048, palette: 65536, operations: 67108864 });
export const BLEND_MODES = Object.freeze(['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','addition','subtract','divide','hue','saturation','color','luminosity']);
const DEFAULT_PALETTE = ['#16152bff','#3c315fff','#7059c7ff','#ff6b57ff','#ffb34bff','#ffe66dff','#70d6b2ff','#218c89ff','#f8f0dfff'];
const DIRECTIONS = ['forward','reverse','pingpong','pingpong_reverse'];
// Snapshots produced by this module are immutable by contract. Cache only
// validated image objects; a changed palette length invalidates indexed checks.
const validatedImages = new WeakMap();
const clamp = (v, lo=0, hi=1) => Math.max(lo, Math.min(hi, v));
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const record = o => o !== null && typeof o === 'object' && !Array.isArray(o);
export class EditorError extends Error { constructor(message, code='INVALID_DOCUMENT') { super(message); this.name='EditorError'; this.code=code; } }
function fail(message, code) { throw new EditorError(message,code); }
function integer(v,label,min=0,max=Number.MAX_SAFE_INTEGER) { if(!Number.isSafeInteger(v)||v<min||v>max) fail(`${label} must be an integer from ${min} to ${max}`); return v; }
function finite(v,label,min=-1e6,max=1e6) { if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max) fail(`${label} is outside ${min}…${max}`); return v; }
function id(v,label='Id') { if(typeof v!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(v)||['constructor','prototype','__proto__'].includes(v)) fail(`${label} is invalid`); return v; }
function name(v,fallback) { const n=typeof v==='string'&&v.trim()?v.trim():fallback; if(n.length>240) fail('Name is too long'); return n; }
function jsonCopy(v) { if(v===undefined)return undefined; try { const s=JSON.stringify(v); if(s.length>64*1024*1024)fail('Metadata is too large'); return JSON.parse(s); } catch(e) { if(e instanceof EditorError)throw e; fail('Value must be serializable'); } }
function unique(items,label) { const s=new Set(); for(const item of items) {id(item.id,label);if(s.has(item.id))fail(`Duplicate ${label}: ${item.id}`);s.add(item.id);}return s; }
function rgba(value) {
 if(value===null||value===undefined)return [0,0,0,0];
 if(typeof value!=='string')fail('Color must be a hex string');
 let s=value.trim().toLowerCase();
 if(/^#[0-9a-f]{3,4}$/.test(s))s='#'+[...s.slice(1)].map(c=>c+c).join('');
 if(/^#[0-9a-f]{6}$/.test(s))s+='ff';
 if(!/^#[0-9a-f]{8}$/.test(s))fail(`Invalid RGBA color: ${String(value).slice(0,30)}`);
 return [1,3,5,7].map(i=>parseInt(s.slice(i,i+2),16));
}
const hex = c => '#'+c.map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('');
export const normalizeColor = value => hex(rgba(value));
export function pixelRGBA(doc,pixel) { return rgba(typeof pixel==='number'?doc.palette[pixel]:pixel); }
/** Effective palette at a frame. Pass a layer to apply Aseprite transparent-index semantics. */
export function getFramePalette(doc,frameId=doc.frames[0]?.id,layerId){
 const frame=frameFor(doc,frameId);let palette=doc.palette;
 for(const current of doc.frames){if(current.palette)palette=current.palette;if(current.id===frame.id)break;}
 const layer=layerId==null?null:layerFor(doc,layerId),transparent=doc.metadata?.aseprite?.transparentIndex;
 if(doc.colorMode==='indexed'&&layer&&!(layer.asepriteFlags&8)&&Number.isInteger(transparent)&&transparent<palette.length){palette=[...palette];palette[transparent]='#00000000';}
 return [...palette];
}
function colorContext(doc,frameId,layerId){return {...doc,palette:getFramePalette(doc,frameId,layerId)};}

function nearest(palette,c) { let result=0,d=Infinity; for(let i=0;i<palette.length;i++){const p=rgba(palette[i]);const q=(p[0]-c[0])**2+(p[1]-c[1])**2+(p[2]-c[2])**2+2*(p[3]-c[3])**2;if(q<d){result=i;d=q;}}return result; }
function encodeColor(doc,color) {
 if(color===null||color===undefined)return null;
 if(typeof color==='number') { integer(color,'Palette index',0,doc.palette.length-1); return doc.colorMode==='indexed'?color:encodeColor(doc,doc.palette[color]); }
 const c=rgba(color); if(c[3]===0)return null;
 if(doc.colorMode==='indexed')return nearest(doc.palette,c);
 if(doc.colorMode==='grayscale')c[0]=c[1]=c[2]=Math.round(.2126*c[0]+.7152*c[1]+.0722*c[2]);
 return hex(c);
}
function validatePixels(image,doc,label,copy=true) {
 integer(image.width,`${label} width`,1,LIMITS.imageEdge);integer(image.height,`${label} height`,1,LIMITS.imageEdge);
 const count=image.width*image.height;
 if(count>LIMITS.pixels)fail('Image exceeds pixel budget');
 if(image.tilemap){if(!Array.isArray(image.tilemap.tiles)||image.tilemap.tiles.length!==count)fail('Tilemap image size mismatch');for(const value of image.tilemap.tiles)integer(value,'Tile data',0,0xffffffff);if(!Array.isArray(image.pixels)||(image.pixels.length!==0&&image.pixels.length!==count))fail('Tilemap pixels are invalid'); return copy?[...image.pixels]:image.pixels;}
 if(!Array.isArray(image.pixels)||image.pixels.length!==count)fail(`${label} pixel count does not match dimensions`);
 const convert=p=>{if(p===null)return null;if(doc.colorMode==='indexed')return integer(p,'Indexed pixel',0,doc.palette.length-1);if(typeof p!=='string')fail('RGBA pixels must be strings or null');const c=rgba(p);if(doc.colorMode==='grayscale'&&(c[0]!==c[1]||c[1]!==c[2]))fail('Grayscale pixels must have equal RGB channels');return c[3]===0?null:hex(c);};
 if(copy)return image.pixels.map(convert);for(const p of image.pixels)convert(p);return image.pixels;
}
export function createDocument(options={}) {
 const width=integer(options.width??options.size??32,'Width',1,LIMITS.edge),height=integer(options.height??options.size??width,'Height',1,LIMITS.edge);
 return normalizeDocument({format:'pixelwall-document',version:4,id:options.id??globalThis.crypto?.randomUUID?.()??`document-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,name:options.name??'Untitled Sprite',width,height,colorMode:options.colorMode??'rgba',colorProfile:'sRGB',palette:options.palette??DEFAULT_PALETTE,layers:[{id:'layer-1',name:'Layer 1',type:'image',parentId:null,visible:true,locked:false,opacity:1,blendMode:'normal'}],frames:[{id:'frame-1',durationMs:options.durationMs??125,cels:{}}],images:{},clips:[{id:'clip-1',name:'default',frameIds:['frame-1'],direction:'forward',loop:true}],slices:[],tilesets:[],metadata:{}});
}
export function normalizeDocument(input, options={}) {
 if(typeof input==='string'){try{input=JSON.parse(input);}catch{fail('Invalid document JSON');}}
 if(!record(input))fail('Document must be an object');
 if(input.format!=='pixelwall-document'||input.version!==4)return migrateLegacy(input);
 const width=integer(input.width,'Width',1,LIMITS.edge),height=integer(input.height,'Height',1,LIMITS.edge);
 if(width*height>LIMITS.canvasPixels)fail('Canvas exceeds the 4,194,304 pixel budget','MEMORY_BUDGET');
 if(!['rgba','indexed','grayscale'].includes(input.colorMode))fail('Unsupported color mode');
 if(input.colorProfile&&input.colorProfile!=='sRGB')fail('Only the sRGB working profile is supported');
 if(!Array.isArray(input.palette)||input.palette.length<1||input.palette.length>LIMITS.palette)fail('Palette must have 1–65536 colors');
 const doc={...input,id:id(input.id??'document-1'),name:name(input.name,'Untitled Sprite'),width,height,colorMode:input.colorMode,colorProfile:'sRGB',palette:input.palette.map(normalizeColor)};
 let paletteCapacity=doc.palette.length;
 if(Array.isArray(input.frames))for(const frame of input.frames)if(frame?.palette!==undefined){
  if(!Array.isArray(frame.palette)||frame.palette.length<1||frame.palette.length>LIMITS.palette)fail('Frame palette must have 1–65536 colors');
  for(const color of frame.palette)normalizeColor(color);paletteCapacity=Math.max(paletteCapacity,frame.palette.length);
 }
 const pixelDocument=doc.colorMode==='indexed'&&paletteCapacity!==doc.palette.length?{...doc,palette:{length:paletteCapacity}}:doc;

 if(!Array.isArray(input.layers)||input.layers.length<1||input.layers.length>LIMITS.layers)fail('Document must have 1–256 layers');
 doc.layers=input.layers.map((layer,i)=>{
  if(!record(layer))fail('Invalid layer');const type=layer.type??'image';if(!['image','group','reference','tilemap'].includes(type))fail('Unsupported layer type');
  const blendMode=layer.blendMode??'normal';if(!BLEND_MODES.includes(blendMode))fail(`Unsupported blend mode: ${blendMode}`);
  return {...jsonCopy(layer),id:id(layer.id),name:name(layer.name,`Layer ${i+1}`),type,parentId:layer.parentId==null?null:id(layer.parentId),visible:layer.visible!==false,locked:!!layer.locked,opacity:finite(layer.opacity??1,'Layer opacity',0,1),blendMode};
 });
 const layerIds=unique(doc.layers,'layer id'); const layerMap=new Map(doc.layers.map(l=>[l.id,l]));
 for(const layer of doc.layers){let current=layer;const seen=new Set();while(current.parentId!==null){if(seen.has(current.id))fail('Layer groups cannot contain cycles');seen.add(current.id);const p=layerMap.get(current.parentId);if(!p||p.type!=='group')fail('Layer parent must be an existing group');current=p;}}
 if(!record(input.images))fail('Images must be an object');if(Object.keys(input.images).length>131072)fail('Too many stored images');doc.images={};let pixels=0;
 const validationKey=doc.colorMode==='indexed'?`indexed:${paletteCapacity}`:doc.colorMode;
 for(const [key,image]of Object.entries(input.images)){id(key,'Image id');if(!record(image))fail('Invalid image');pixels+=image.width*image.height;if(pixels>LIMITS.pixels)fail('Document exceeds the 16,777,216 stored pixel budget');if(options.shareImages){if(validatedImages.get(image)!==validationKey)validatePixels(image,pixelDocument,`Image ${key}`,false);doc.images[key]=image;}else doc.images[key]={...image,...(image.tilemap?{tilemap:jsonCopy(image.tilemap)}:{}),pixels:validatePixels(image,pixelDocument,`Image ${key}`)};validatedImages.set(doc.images[key],validationKey);}
 if(!Array.isArray(input.frames)||input.frames.length<1||input.frames.length>LIMITS.frames)fail('Document must have 1–2048 frames');
 let celCount=0;doc.frames=input.frames.map(frame=>{
  if(!record(frame)||!record(frame.cels))fail('Invalid frame');const cels={};
  for(const [layerId,cel]of Object.entries(frame.cels)){if(!layerIds.has(layerId)||layerMap.get(layerId).type==='group')fail('Cel references missing or group layer');if(!record(cel)||!own(doc.images,cel.imageId))fail('Cel references missing image');if(++celCount>131072)fail('Too many cels');cels[layerId]={...jsonCopy(cel),imageId:id(cel.imageId),x:integer(cel.x??0,'Cel x',-65535,65535),y:integer(cel.y??0,'Cel y',-65535,65535),opacity:finite(cel.opacity??1,'Cel opacity',0,1),...(cel.zIndex!==undefined?{zIndex:integer(cel.zIndex,'Cel z-index',-2147483648,2147483647)}:{})};}
  return {...jsonCopy({...frame,cels:undefined}),...(frame.palette?{palette:frame.palette.map(normalizeColor)}:{}),id:id(frame.id),durationMs:integer(frame.durationMs??125,'Frame duration',1,65535),cels};
 });const frameIds=unique(doc.frames,'frame id');
 doc.clips=(input.clips??[]).map((clip,i)=>{if(!record(clip)||!Array.isArray(clip.frameIds)||!clip.frameIds.length)fail('Invalid clip');for(const f of clip.frameIds)if(!frameIds.has(f))fail('Clip references missing frame');if(!DIRECTIONS.includes(clip.direction??'forward'))fail('Invalid clip direction');if(clip.repeat!==undefined)integer(clip.repeat,'Tag repeats',0,65535);if(clip.color!==undefined)normalizeColor(clip.color);return {...jsonCopy(clip),id:id(clip.id),name:name(clip.name,`Clip ${i+1}`),direction:clip.direction??'forward',loop:clip.loop!==false};});unique(doc.clips,'clip id');if(doc.clips.length>512)fail('Too many clips');
 doc.slices=jsonCopy(input.slices??[]);if(!Array.isArray(doc.slices)||doc.slices.length>1024)fail('Too many slices');
 for(const slice of doc.slices){id(slice.id);const b=slice.bounds;if(record(b)){integer(b.x,'Slice x',0,width-1);integer(b.y,'Slice y',0,height-1);integer(b.width,'Slice width',1,width-b.x);integer(b.height,'Slice height',1,height-b.y);}else if(Array.isArray(slice.keys)){for(const key of slice.keys){if(key.frameId&&!frameIds.has(key.frameId))fail('Slice key references missing frame');integer(key.x,'Slice key x',-2147483648,2147483647);integer(key.y,'Slice key y',-2147483648,2147483647);integer(key.width,'Slice key width',0,65535);integer(key.height,'Slice key height',0,65535);}}else fail('Invalid slice');}unique(doc.slices,'slice id');
 doc.tilesets=jsonCopy(input.tilesets??[]);if(!Array.isArray(doc.tilesets)||doc.tilesets.length>256)fail('Too many tilesets');unique(doc.tilesets,'Tileset id');if(doc.tilesets.reduce((s,t)=>s+(t.tiles?.length??t.tileCount??0),0)>131072)fail('Too many tile definitions');
 for(const ts of doc.tilesets){integer(ts.tileWidth,'Tile width',1,LIMITS.edge);integer(ts.tileHeight,'Tile height',1,LIMITS.edge);if(ts.imageId&&!own(doc.images,ts.imageId))fail('Tileset atlas image is missing');if(!ts.tiles&&ts.imageId){const atlas=doc.images[ts.imageId],columns=Math.floor(atlas.width/ts.tileWidth),count=ts.tileCount??columns*Math.floor(atlas.height/ts.tileHeight);integer(count,'Native tile count',0,65536);if(columns<1||count>columns*Math.floor(atlas.height/ts.tileHeight))fail('Native atlas dimensions mismatch');ts.tiles=Array.from({length:count},(_,i)=>({id:`ase-tile-${i}`,imageId:ts.imageId,asepriteTileId:i,sourceRect:{x:(i%columns)*ts.tileWidth,y:Math.floor(i/columns)*ts.tileHeight,width:ts.tileWidth,height:ts.tileHeight}}));}if(ts.tiles){if(!Array.isArray(ts.tiles)||ts.tiles.length>65536)fail('Invalid tileset');unique(ts.tiles,'tile id');for(const t of ts.tiles){if(!own(doc.images,t.imageId))fail('Tile image missing');if(t.sourceRect){const image=doc.images[t.imageId],r=t.sourceRect;integer(r.x,'Tile source x',0,image.width-1);integer(r.y,'Tile source y',0,image.height-1);integer(r.width,'Tile source width',1,image.width-r.x);integer(r.height,'Tile source height',1,image.height-r.y);}}}}
 for(const layer of doc.layers){if(layer.tilesetId&&!doc.tilesets.some(t=>t.id===layer.tilesetId))fail('Layer tileset missing');for(const [fid,map]of Object.entries(layer.tilemaps??{})){if(!frameIds.has(fid))fail('Tilemap frame missing');validateTilemap(doc,map);}}
 doc.metadata=jsonCopy(input.metadata??{});if(!record(doc.metadata))fail('Metadata must be an object');return doc;
}
function decodeLegacyPixels(data,bpi,colors,total){if(typeof data!=='string'||!(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).test(data))fail('Invalid legacy pixel encoding');if(bpi!==1&&bpi!==2)fail('Invalid legacy color index size');let bytes;if(typeof atob==='function')bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));else if(globalThis.Buffer)bytes=new Uint8Array(globalThis.Buffer.from(data,'base64'));else fail('Base64 decoding unavailable');if(bytes.length!==total*bpi)fail('Legacy pixel size mismatch');return Array.from({length:total},(_,i)=>{const n=bytes[i*bpi]+(bpi===2?bytes[i*bpi+1]*256:0);if(n>colors.length)fail('Legacy palette index missing');return n?normalizeColor(colors[n-1]):null;});}
export function migrateLegacy(input){
 if(typeof input==='string'){try{input=JSON.parse(input);}catch{fail('Invalid document JSON');}}const p=input?.project??input;
 if(!record(p)||!Array.isArray(p.frames)||!p.frames.length)fail('Unsupported document');if(p.version!==undefined&&![1,2,3].includes(p.version))fail('Unsupported document version');
 const width=integer(p.size??p.width,'Legacy width',1,LIMITS.edge),height=integer(p.height??width,'Legacy height',1,LIMITS.edge),total=width*height;
 if(total>LIMITS.canvasPixels)fail('Canvas exceeds the 4,194,304 pixel budget','MEMORY_BUDGET');
 const doc=createDocument({width,height,name:p.name,palette:p.palette?.length?p.palette:DEFAULT_PALETTE});doc.layers=(p.layers?.length?p.layers:[{id:1,name:'Layer 1'}]).map((l,i)=>({...l,id:`layer-${l.id??i+1}`,name:l.name??`Layer ${i+1}`,type:'image',parentId:null,visible:l.visible!==false,locked:!!l.locked,opacity:(l.opacity??100)/100,blendMode:'normal'}));doc.images={};const used=new Set();
 doc.frames=p.frames.map((f,i)=>{let fid=`frame-${f.id??i+1}`;if(used.has(fid))fid=`frame-migrated-${i}`;used.add(fid);const cels={};const source=Array.isArray(f.cels)?f.cels:[{layerId:p.layers?.[0]?.id??1,pixels:f.pixels,data:f.data}];for(const [j,c]of source.entries()){let pix;if(Array.isArray(c.pixels))pix=c.pixels.map(v=>v==null?null:normalizeColor(v));else if(c.data!==undefined)pix=decodeLegacyPixels(c.data,c.bytesPerIndex??f.bytesPerIndex??p.bytesPerIndex,p.colors??[],total);else continue;if(pix.length!==total)fail('Legacy pixel count mismatch');const imageId=`image-migrated-${i}-${j}`;doc.images[imageId]={width,height,pixels:pix};cels[`layer-${c.layerId??1}`]={imageId,x:0,y:0,opacity:1};}return {id:fid,durationMs:f.durationMs??125,cels};});
 const oldFrameMap=new Map(p.frames.map((f,i)=>[String(f.id??i+1),doc.frames[i].id]));doc.clips=p.clips?.length?p.clips.map((c,i)=>({id:`clip-${c.id??i+1}`,name:c.name??`Clip ${i+1}`,frameIds:c.frameIds.map(fid=>oldFrameMap.get(String(fid))),direction:c.direction??'forward',loop:c.loop!==false})):[{id:'clip-1',name:'default',frameIds:doc.frames.map(f=>f.id),direction:'forward',loop:true}];
 doc.slices=(p.slices??[]).map((s,i)=>({...s,id:`slice-${s.id??i+1}`}));doc.metadata={migratedFrom:p.version??'runtime',legacy:{pivot:jsonCopy(p.pivot),tile:jsonCopy(p.tile),tilemap:jsonCopy(p.tilemap),projector:jsonCopy(p.projector),editor:jsonCopy(input.editor??p.editor)}};
 return normalizeDocument(doc);
}
export function getCel(doc,frameId=doc.frames[0]?.id,layerId=doc.layers.find(l=>l.type!=='group')?.id) { const frame=doc.frames.find(f=>f.id===frameId);const cel=frame?.cels[layerId];return cel?{cel,image:doc.images[cel.imageId]}:null; }
export function describeDocument(doc){return {id:doc.id,name:doc.name,width:doc.width,height:doc.height,colorMode:doc.colorMode,layers:doc.layers.length,frames:doc.frames.length,images:Object.keys(doc.images).length,storedPixels:Object.values(doc.images).reduce((s,i)=>s+i.width*i.height,0),durationMs:doc.frames.reduce((s,f)=>s+f.durationMs,0),linkedCels:doc.frames.reduce((s,f)=>s+Object.keys(f.cels).length,0)-new Set(doc.frames.flatMap(f=>Object.values(f.cels).map(c=>c.imageId))).size,tilesets:doc.tilesets.length,layerList:doc.layers.map(({id,name,type,parentId,visible,locked,opacity,blendMode,tilesetId})=>({id,name,type,parentId,visible,locked,opacity,blendMode,...(tilesetId?{tilesetId}:{})})),frameList:doc.frames.map(f=>({id:f.id,durationMs:f.durationMs,cels:Object.fromEntries(Object.entries(f.cels).map(([lid,c])=>[lid,{imageId:c.imageId,x:c.x,y:c.y,opacity:c.opacity}]))})),clipList:doc.clips.map(c=>({...c,frameIds:[...c.frameIds]})),sliceList:doc.slices.map(s=>({id:s.id,name:s.name,...(s.bounds?{bounds:{...s.bounds}}:{}),...(s.keys?{keyFrames:s.keys.map(k=>k.frameId)}:{})})),tilesetList:doc.tilesets.map(t=>({id:t.id,name:t.name,tileWidth:t.tileWidth,tileHeight:t.tileHeight,tileCount:t.tiles?.length??t.tileCount??0,tileIds:t.tiles?.map(t=>t.id)??[]}))};}
function validateTilemap(doc,map){const ts=doc.tilesets.find(t=>t.id===map.tilesetId);if(!ts)fail('Tilemap tileset missing');integer(map.columns,'Tilemap columns',1,2048);integer(map.rows,'Tilemap rows',1,2048);integer(map.x??0,'Tilemap x',-65535,65535);integer(map.y??0,'Tilemap y',-65535,65535);finite(map.opacity??1,'Tilemap opacity',0,1);if(map.columns*map.rows>1048576||!Array.isArray(map.cells)||map.cells.length!==map.columns*map.rows)fail('Invalid tilemap dimensions');const ids=new Set((ts.tiles??[]).map(t=>t.id));for(const c of map.cells)if(c!==null&&(!record(c)||!ids.has(c.tileId)||![0,90,180,270].includes(c.rotate??0)))fail('Tilemap tile is invalid');}

function rgbHsl(rgb){const r=rgb[0]/255,g=rgb[1]/255,b=rgb[2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,l=(max+min)/2;let h=0,s=0;if(d){s=d/(1-Math.abs(2*l-1));h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;h=((h/6)%1+1)%1;}return [h,s,l];}
function hslRgb([h,s,l]){h=((h%1)+1)%1;s=clamp(s);l=clamp(l);const a=s*Math.min(l,1-l);return [0,8,4].map(n=>{const k=(n+h*12)%12;return 255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)));});}
function blendChannel(b,s,mode){switch(mode){case'multiply':return b*s;case'screen':return b+s-b*s;case'overlay':return b<.5?2*b*s:1-2*(1-b)*(1-s);case'darken':return Math.min(b,s);case'lighten':return Math.max(b,s);case'color-dodge':return s>=1?1:Math.min(1,b/(1-s));case'color-burn':return s<=0?0:1-Math.min(1,(1-b)/s);case'hard-light':return s<.5?2*b*s:1-2*(1-b)*(1-s);case'soft-light':return s<=.5?b-(1-2*s)*b*(1-b):b+(2*s-1)*((b<=.25?((16*b-12)*b+4)*b:Math.sqrt(b))-b);case'difference':return Math.abs(b-s);case'exclusion':return b+s-2*b*s;case'addition':return Math.min(1,b+s);case'subtract':return Math.max(0,b-s);case'divide':return s===0?1:Math.min(1,b/s);default:return s;}}
// Preserve a single rounding for the final luminance multiply-add. These
// bounded color values avoid overflow in the compensated product and sum.
function colorMultiplyAdd(a,b,c){const split=134217729,as=split*a,bs=split*b,ah=as-(as-a),al=a-ah,bh=bs-(bs-b),bl=b-bh,product=a*b,error=((ah*bh-product)+ah*bl+al*bh)+al*bl,sum=product+c,z=sum-product;return sum+(error+((product-(sum-z))+(c-z)));}
const luminosity=c=>colorMultiplyAdd(.11,c[2],.3*c[0]+.59*c[1]),saturation=c=>Math.max(...c)-Math.min(...c);
function setLuminosity(c,l){const delta=l-luminosity(c);let result=c.map(v=>v+delta);const mid=luminosity(result),min=Math.min(...result),max=Math.max(...result);if(min<0)result=result.map(v=>mid+(v-mid)*mid/(mid-min));if(max>1)result=result.map(v=>mid+(v-mid)*(1-mid)/(max-mid));return result;}
function setSaturation(c,s){const order=[0,1,2].sort((a,b)=>c[a]-c[b]),result=[0,0,0],[lo,mid,hi]=order;if(c[hi]>c[lo]){result[mid]=(c[mid]-c[lo])*s/(c[hi]-c[lo]);result[hi]=s;}return result;}
// 8-bit coverage multiplication, including signed interpolation deltas.
// Quantize byte coverage before compositing, including signed color deltas.
// Pinned by independent Aseprite 1.3.18.5 rendering fixtures.
function coverageProduct(a,b){const value=a*b+128;return (value+(value>>8))>>8;}
function blendAt(out,index,source,opacity=1,mode='normal'){
 const sourceAlpha=coverageProduct(source[3],Math.round(opacity*255));if(sourceAlpha<=0)return;
 const backdropAlpha=out[index+3],alpha=sourceAlpha+backdropAlpha-coverageProduct(sourceAlpha,backdropAlpha);
 if(mode==='normal'||!backdropAlpha){for(let k=0;k<3;k++)out[index+k]=backdropAlpha?out[index+k]+Math.trunc((source[k]-out[index+k])*sourceAlpha/alpha):source[k];out[index+3]=alpha;return;}
 const backdrop=Array.from(out.subarray(index,index+3)),foreground=Array.from(source).slice(0,3);
 const over=color=>backdrop.map((value,k)=>value+Math.trunc((color[k]-value)*sourceAlpha/alpha));
 const normal=backdropAlpha?over(foreground):foreground;let result=normal;
 if(mode!=='normal'&&backdropAlpha){
  const b=backdrop.map(v=>v/255),s=foreground.map(v=>v/255);let color;
  if(['hue','saturation','color','luminosity'].includes(mode))color=mode==='hue'?setLuminosity(setSaturation(s,saturation(b)),luminosity(b)):mode==='saturation'?setLuminosity(setSaturation(b,saturation(s)),luminosity(b)):mode==='color'?setLuminosity(s,luminosity(b)):setLuminosity(b,luminosity(s));
  else if(mode==='exclusion')color=backdrop.map((v,k)=>(v+foreground[k]-2*coverageProduct(v,foreground[k]))/255);
  else if(mode==='color-dodge')color=backdrop.map((v,k)=>v===0?0:foreground[k]===255?1:Math.min(255,Math.floor((v*255+(255-foreground[k])/2)/(255-foreground[k])))/255);
  else if(mode==='color-burn')color=backdrop.map((v,k)=>v===255?1:foreground[k]===0?0:1-Math.min(255,Math.floor(((255-v)*255+foreground[k]/2)/foreground[k]))/255);
  else if(mode==='divide')color=backdrop.map((v,k)=>v===0?0:foreground[k]===0?1:Math.min(255,Math.floor((v*255+foreground[k]/2)/foreground[k]))/255);
  else color=b.map((value,k)=>blendChannel(value,s[k],mode));
  const blended=over(color.map(v=>['hue','saturation','color','luminosity'].includes(mode)?Math.floor(clamp(v)*255):Math.round(clamp(v)*255))),intersection=coverageProduct(backdropAlpha,sourceAlpha);
  result=normal.map((value,k)=>{const mixed=value+coverageProduct(blended[k]-value,backdropAlpha);return mixed+coverageProduct(blended[k]-mixed,intersection);});
 }
 for(let k=0;k<3;k++)out[index+k]=result[k];out[index+3]=alpha;
}
function renderImage(doc,out,image,cel,opacity,mode){
 if(!image||image.tilemap)return;
 if(cel.preciseBounds?.flags&1){const b=cel.preciseBounds;if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<=0||b.height<=0)return;for(let y=Math.max(0,Math.ceil(b.y-.5));y<Math.min(doc.height,Math.ceil(b.y+b.height-.5));y++)for(let x=Math.max(0,Math.ceil(b.x-.5));x<Math.min(doc.width,Math.ceil(b.x+b.width-.5));x++){const ix=clamp(Math.floor((x+.5-b.x)/b.width*image.width),0,image.width-1),iy=clamp(Math.floor((y+.5-b.y)/b.height*image.height),0,image.height-1),p=image.pixels[iy*image.width+ix];if(p!==null)blendAt(out,(y*doc.width+x)*4,pixelRGBA(doc,p),opacity,mode);}return;}
 const x0=Math.max(0,cel.x),y0=Math.max(0,cel.y),x1=Math.min(doc.width,cel.x+image.width),y1=Math.min(doc.height,cel.y+image.height);
 for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const p=image.pixels[(y-cel.y)*image.width+x-cel.x];if(p!==null)blendAt(out,(y*doc.width+x)*4,pixelRGBA(doc,p),opacity,mode);}
}
function renderTile(doc,out,image,sx,sy,sw,sh,dx,dy,dw,dh,flipX,flipY,rotate,opacity,mode){
 let fx=!!flipX,fy=!!flipY,diagonal=false;
 if(rotate===90){diagonal=true;[fx,fy]=[!fy,fx];}else if(rotate===180){fx=!fx;fy=!fy;}else if(rotate===270){diagonal=true;[fx,fy]=[fy,!fx];}
 for(let y=Math.max(0,dy);y<Math.min(doc.height,dy+dh);y++)for(let x=Math.max(0,dx);x<Math.min(doc.width,dx+dw);x++){
  let u=fx?dw-1-(x-dx):x-dx,v=fy?dh-1-(y-dy):y-dy;
  if(diagonal)[u,v]=[v,u];
  // Native diagonal flips transpose integer grid coordinates. Non-square tiles
  // clear the existing backdrop outside that grid, even at zero opacity.
  if(u<0||v<0||u>=dw||v>=dh){out.fill(0,(y*doc.width+x)*4,(y*doc.width+x)*4+4);continue;}
  const ix=sx+Math.min(sw-1,Math.floor((u+.5)*sw/dw)),iy=sy+Math.min(sh-1,Math.floor((v+.5)*sh/dh));if(ix<0||iy<0||ix>=image.width||iy>=image.height)continue;if(image[TILE_BACKDROP_CLEAR]?.[iy*image.width+ix]){out.fill(0,(y*doc.width+x)*4,(y*doc.width+x)*4+4);continue;}const p=image.pixels[iy*image.width+ix];if(p!=null)blendAt(out,(y*doc.width+x)*4,pixelRGBA(doc,p),opacity,mode);
 }
}
function renderTilemap(doc,out,layer,frame,opacity,mode){
 const map=layer.tilemaps?.[frame.id];if(map){const ts=doc.tilesets.find(t=>t.id===map.tilesetId);if(!ts)return;const tiles=new Map((ts.tiles??[]).map(t=>[t.id,t]));for(let i=0;i<map.cells.length;i++){const cell=map.cells[i];if(!cell)continue;const tile=tiles.get(cell.tileId),image=doc.images[tile?.imageId],rect=tile?.sourceRect;if(image)renderTile(doc,out,image,rect?.x??0,rect?.y??0,rect?.width??image.width,rect?.height??image.height,(map.x??0)+(i%map.columns)*ts.tileWidth,(map.y??0)+Math.floor(i/map.columns)*ts.tileHeight,ts.tileWidth,ts.tileHeight,cell.flipX,cell.flipY,cell.rotate??0,opacity*(map.opacity??1),mode);}return;}
 const cel=frame.cels[layer.id],image=doc.images[cel?.imageId],tilemap=image?.tilemap,ts=doc.tilesets.find(t=>t.id===layer.tilesetId),atlas=doc.images[ts?.imageId];if(!tilemap||!ts||!atlas)return;
 const tw=ts.tileWidth,th=ts.tileHeight,cols=Math.floor(atlas.width/tw);if(cols<1)return;
 for(let i=0;i<tilemap.tiles.length;i++){const value=tilemap.tiles[i]>>>0,index=(value&(tilemap.idMask??0x1fffffff))>>>0;if((ts.flags&4)?index===0:value===0xffffffff)continue;if(index>=(ts.tileCount??Math.floor(atlas.height/th)*cols))continue;const diagonal=!!(value&(tilemap.diagonalFlipMask??0x20000000)),flipX=!!(value&(tilemap.xFlipMask??0x80000000)),flipY=!!(value&(tilemap.yFlipMask??0x40000000));renderTile(doc,out,atlas,(index%cols)*tw,Math.floor(index/cols)*th,tw,th,cel.x+(i%image.width)*tw,cel.y+Math.floor(i/image.width)*th,tw,th,diagonal?flipY:flipX,diagonal?!flipX:flipY,diagonal?90:0,opacity*cel.opacity,mode);}
}
/** Layers are ordered bottom-to-top. Groups composite their children in isolation. */
export function renderFrame(doc,frameId=doc.frames[0]?.id){
 if(!Number.isSafeInteger(doc.width)||!Number.isSafeInteger(doc.height)||doc.width<1||doc.height<1||doc.width>LIMITS.edge||doc.height>LIMITS.edge||doc.width*doc.height>LIMITS.canvasPixels)fail('Invalid canvas dimensions or pixel budget','MEMORY_BUDGET');
 const frame=doc.frames.find(f=>f.id===frameId);if(!frame)fail('Frame not found');let palette=doc.palette;for(const f of doc.frames){if(f.palette)palette=f.palette;if(f.id===frame.id)break;}const working=palette===doc.palette?doc:{...doc,palette};const children=new Map(),positions=new Map(doc.layers.map((l,i)=>[l.id,i]));for(const l of doc.layers){const key=l.parentId??null;if(!children.has(key))children.set(key,[]);children.get(key).push(l);}for(const list of children.values())list.sort((a,b)=>{const za=frame.cels[a.id]?.zIndex??0,zb=frame.cels[b.id]?.zIndex??0;return positions.get(a.id)+za-positions.get(b.id)-zb||za-zb||positions.get(a.id)-positions.get(b.id);});
 function renderGroup(parent,depth){if(depth>24)fail('Layer nesting exceeds rendering limit');const out=new Uint8ClampedArray(doc.width*doc.height*4);for(const layer of children.get(parent)??[]){if(!layer.visible||(layer.opacity===0&&layer.type!=='tilemap'))continue;let display=working;const transparent=doc.metadata?.aseprite?.transparentIndex;if(doc.colorMode==='indexed'&&Number.isInteger(transparent)&&!(layer.asepriteFlags&8)){display={...working,palette:[...working.palette]};if(transparent<display.palette.length)display.palette[transparent]='#00000000';}if(layer.type==='group'){const sub=renderGroup(layer.id,depth+1);for(let i=0;i<sub.length;i+=4)if(sub[i+3])blendAt(out,i,sub.subarray(i,i+4),layer.opacity,layer.blendMode);}else if(layer.type==='tilemap')renderTilemap(display,out,layer,frame,layer.opacity,layer.blendMode);else{const cel=frame.cels[layer.id];if(cel)renderImage(display,out,doc.images[cel.imageId],cel,layer.opacity*cel.opacity,layer.blendMode);}}return out;}
 return renderGroup(null,0);
}
function shallowDocument(doc){return {...doc,palette:[...doc.palette],layers:doc.layers.map(l=>({...l})),frames:doc.frames.map(f=>({...f,cels:Object.fromEntries(Object.entries(f.cels).map(([k,c])=>[k,{...c}]))})),images:{...doc.images},clips:doc.clips.map(c=>({...c,frameIds:[...c.frameIds]})),slices:doc.slices.map(s=>({...s,...(s.bounds?{bounds:{...s.bounds}}:{})})),tilesets:doc.tilesets.map(t=>({...t,...(t.tiles?{tiles:t.tiles.map(a=>({...a}))}:{})})),metadata:{...doc.metadata}};}
function fresh(doc,prefix){const keys=new Set([doc.id,...doc.layers.map(l=>l.id),...doc.frames.map(f=>f.id),...Object.keys(doc.images),...doc.clips.map(c=>c.id),...doc.slices.map(s=>s.id),...doc.tilesets.map(t=>t.id)]);let n=1;while(keys.has(`${prefix}-${n}`))n++;return `${prefix}-${n}`;}
function frameFor(doc,fid){const f=doc.frames.find(f=>f.id===(fid??doc.frames[0].id));if(!f)fail('Frame not found');return f;}
function layerFor(doc,lid,write=false){const l=doc.layers.find(l=>l.id===(lid??doc.layers.find(l=>l.type==='image')?.id));if(!l)fail('Layer not found');if(write){let a=l;while(a){if(a.locked)fail('Layer is locked','LOCKED_LAYER');a=a.parentId?doc.layers.find(l=>l.id===a.parentId):null;}}return l;}
function targetFrames(doc,c){const ids=c.frameIds??(c.frameId?[c.frameId]:[doc.frames[0].id]);if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail('Frame range must be a nonempty list of unique ids');return ids.map(fid=>frameFor(doc,fid));}
function reserve(doc,count,replacing){const total=Object.values(doc.images).reduce((s,i)=>s+i.width*i.height,0)-(replacing?doc.images[replacing].width*doc.images[replacing].height:0);if(total+count>LIMITS.pixels)fail('Document exceeds the stored pixel budget','MEMORY_BUDGET');}
function writable(doc,c,changed){
 const layer=layerFor(doc,c.layerId,true);if(!['image','reference'].includes(layer.type))fail('Drawing requires an image or reference layer');const frame=frameFor(doc,c.frameId);let cel=frame.cels[layer.id];
 if(!cel){reserve(doc,doc.width*doc.height);const imageId=fresh(doc,'image');doc.images[imageId]={width:doc.width,height:doc.height,pixels:Array(doc.width*doc.height).fill(null)};cel=frame.cels[layer.id]={imageId,x:0,y:0,opacity:1};changed.add(imageId);}
 let image=doc.images[cel.imageId];if(image.tilemap)fail('Raster drawing cannot edit tile indices');
 // Fractional imported cel transforms are baked before raster editing. Keep
 // other linked cels on their original source so their transforms remain exact.
 if(cel.preciseBounds?.flags&1){const b=cel.preciseBounds,x=integer(Math.floor(b.x),'Rasterized cel x',-65535,65535),y=integer(Math.floor(b.y),'Rasterized cel y',-65535,65535),width=integer(Math.ceil(b.x+b.width)-x,'Rasterized width',1,LIMITS.imageEdge),height=integer(Math.ceil(b.y+b.height)-y,'Rasterized height',1,LIMITS.imageEdge),source=image,imageId=fresh(doc,'image');delete frame.cels[layer.id];gcImages(doc);reserve(doc,width*height);const pixels=Array(width*height).fill(null);for(let py=0;py<height;py++)for(let px=0;px<width;px++){const wx=x+px+.5,wy=y+py+.5;if(wx<b.x||wy<b.y||wx>=b.x+b.width||wy>=b.y+b.height)continue;const ix=clamp(Math.floor((wx-b.x)/b.width*source.width),0,source.width-1),iy=clamp(Math.floor((wy-b.y)/b.height*source.height),0,source.height-1);pixels[py*width+px]=source.pixels[iy*source.width+ix];}image=doc.images[imageId]={width,height,pixels};cel=frame.cels[layer.id]={...cel,imageId,x,y,preciseBounds:{...b,flags:b.flags&~1}};changed.add(imageId);}
 if(!changed.has(cel.imageId)){image=doc.images[cel.imageId]={...image,pixels:[...image.pixels]};changed.add(cel.imageId);}
 // Extend the shared image to include the canvas without discarding off-canvas art.
 const x0=Math.min(cel.x,0),y0=Math.min(cel.y,0),w=Math.max(cel.x+image.width,doc.width)-x0,h=Math.max(cel.y+image.height,doc.height)-y0;
 if(w!==image.width||h!==image.height){if(w>LIMITS.imageEdge||h>LIMITS.imageEdge)fail('Image expansion exceeds bounds');reserve(doc,w*h,cel.imageId);const pixels=Array(w*h).fill(null),ox=cel.x-x0,oy=cel.y-y0;for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)pixels[(y+oy)*w+x+ox]=image.pixels[y*image.width+x];image=doc.images[cel.imageId]={...image,width:w,height:h,pixels};for(const f of doc.frames)for(const linked of Object.values(f.cels))if(linked.imageId===cel.imageId){linked.x-=ox;linked.y-=oy;}}
 return {frame,layer,cel,image};
}
function selectionMask(doc,mask){if(mask===undefined||mask===null)return null;if((!Array.isArray(mask)&&!(mask instanceof Uint8Array))||mask.length!==doc.width*doc.height)fail('Selection must match canvas dimensions');for(const x of mask)if(x!==0&&x!==1&&x!==false&&x!==true)fail('Selection values must be 0 or 1');return mask;}
function point(p,label='Point'){if(!record(p))fail(`${label} is missing`);return {x:Math.round(finite(p.x,`${label} x`,-65535,65535)),y:Math.round(finite(p.y,`${label} y`,-65535,65535)),...(p.pressure===undefined?{}:{pressure:finite(p.pressure,'Pressure',0,1)})};}
function points(ps,min=1,max=65536){if(!Array.isArray(ps)||ps.length<min||ps.length>max)fail(`Expected ${min}–${max} points`);return ps.map(p=>point(p));}
function context(doc,c,changed){const t=writable(doc,c,changed),mask=selectionMask(doc,c.selection),wrap=c.wrap===true?'both':c.wrap??'none';if(!['none','x','y','both'].includes(wrap))fail('Invalid drawing wrap mode');let ops=0;return {...t,doc:colorContext(doc,t.frame.id,t.layer.id),command:c,mask,put(x,y,color){if(++ops>LIMITS.operations)fail('Drawing operation exceeds work budget');x=Math.round(x);y=Math.round(y);if(wrap==='x'||wrap==='both')x=((x%doc.width)+doc.width)%doc.width;if(wrap==='y'||wrap==='both')y=((y%doc.height)+doc.height)%doc.height;if(x<0||y<0||x>=doc.width||y>=doc.height||mask&&!mask[y*doc.width+x])return;const ix=x-t.cel.x,iy=y-t.cel.y;if(ix>=0&&iy>=0&&ix<t.image.width&&iy<t.image.height)t.image.pixels[iy*t.image.width+ix]=color;},get(x,y){if(wrap==='x'||wrap==='both')x=((x%doc.width)+doc.width)%doc.width;if(wrap==='y'||wrap==='both')y=((y%doc.height)+doc.height)%doc.height;x=Math.round(x)-t.cel.x;y=Math.round(y)-t.cel.y;return x<0||y<0||x>=t.image.width||y>=t.image.height?null:t.image.pixels[y*t.image.width+x];}};}
function clippedLine(a,b,width,height,pad=0){let lo=0,hi=1;const dx=b.x-a.x,dy=b.y-a.y;for(const [p,q]of [[-dx,a.x+pad],[dx,width-1+pad-a.x],[-dy,a.y+pad],[dy,height-1+pad-a.y]]){if(p===0){if(q<0)return null;}else{const r=q/p;if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);if(lo>hi)return null;}}return [{x:Math.round(a.x+lo*dx),y:Math.round(a.y+lo*dy)},{x:Math.round(a.x+hi*dx),y:Math.round(a.y+hi*dy)}];}
function linePoints(a,b,width,height,pad=0){const clip=clippedLine(a,b,width,height,pad);if(!clip)return [];let [{x:x0,y:y0},{x:x1,y:y1}]=clip;const out=[],dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;let e=dx+dy;for(;;){out.push({x:x0,y:y0});if(x0===x1&&y0===y1)break;const e2=2*e;if(e2>=dy){e+=dy;x0+=sx;}if(e2<=dx){e+=dx;y0+=sy;}}return out;}
function brush(c,doc){const size=integer(c.size??1,'Brush size',1,256);let mask=null;if(c.mask){const m=c.mask;integer(m.width,'Mask width',1,256);integer(m.height,'Mask height',1,256);if(!Array.isArray(m.pixels)||m.pixels.length!==m.width*m.height)fail('Brush mask dimensions mismatch');if(m.colors&&(!Array.isArray(m.colors)||m.colors.length!==m.pixels.length))fail('Brush colors dimensions mismatch');mask={...m,colors:m.colors?.map(p=>encodeColor(doc,p))};}const symmetry=c.symmetry??'none';if(!['none','x','y','both'].includes(symmetry))fail('Invalid symmetry');
 if(!['paint','lighten','darken','shading'].includes(c.ink??'paint'))fail('Unsupported ink');
 let shading=null;
 if(c.ink==='shading'){
  const entries=c.ramp??doc.palette.map((_color,index)=>index);
  if(!Array.isArray(entries)||!entries.length||entries.length>LIMITS.palette)fail('Shading ramp must contain palette indices or colors');
  const ramp=entries.map(color=>encodeColor(doc,color)),step=integer(c.shadeStep??-1,'Shading step',-65535,65535);shading=new Map();
  ramp.forEach((color,index)=>{if(!shading.has(color))shading.set(color,ramp[clamp(index+step,0,ramp.length-1)]);});
 }
 return {size,mask,symmetry,shading,round:c.brush==='circle',color:c.erase?null:encodeColor(doc,(c.color===undefined?doc.palette[0]:c.color))};}
function stamp(ctx,p,b){if(p.pressure===0)return;const pressure=p.pressure??1,size=Math.max(1,Math.round(b.size*pressure)),w=b.mask?b.mask.width:size,h=b.mask?b.mask.height:size;const xs=b.symmetry==='x'||b.symmetry==='both'?[p.x,ctx.doc.width-1-p.x]:[p.x],ys=b.symmetry==='y'||b.symmetry==='both'?[p.y,ctx.doc.height-1-p.y]:[p.y];for(const cx of new Set(xs))for(const cy of new Set(ys))for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(b.mask&&!b.mask.pixels[y*w+x])continue;if(!b.mask&&b.round&&((x-(w-1)/2)**2+(y-(h-1)/2)**2)>(size/2)**2)continue;const dx=cx+x-Math.floor(w/2),dy=cy+y-Math.floor(h/2);let color=b.mask?.colors?b.mask.colors[y*w+x]:b.color;
 if(b.shading){
  const old=ctx.get(dx,dy);if(!pixelRGBA(ctx.doc,old)[3]||!b.shading.has(old))continue;
  const wrap=ctx.command.wrap===true?'both':ctx.command.wrap,px=wrap==='x'||wrap==='both'?((dx%ctx.doc.width)+ctx.doc.width)%ctx.doc.width:dx,py=wrap==='y'||wrap==='both'?((dy%ctx.doc.height)+ctx.doc.height)%ctx.doc.height:dy;
  const key=py*ctx.doc.width+px;ctx.shaded??=new Set();if(ctx.shaded.has(key))continue;ctx.shaded.add(key);color=b.shading.get(old);
 }else if(ctx.command.ink==='lighten'||ctx.command.ink==='darken'){const old=pixelRGBA(ctx.doc,ctx.get(dx,dy)),delta=255*finite(ctx.command.amount??.12,'Shade amount',0,1)*(ctx.command.ink==='lighten'?1:-1);color=old[3]?encodeColor(ctx.doc,hex([old[0]+delta,old[1]+delta,old[2]+delta,old[3]])):null;}ctx.put(dx,dy,color);}}
function drawStroke(ctx,ps,c){if(c.pressure===false)ps=ps.map(p=>({...p,pressure:1}));const b=brush(c,ctx.doc),path=[];for(let i=0;i<ps.length;i++){if(i===0){path.push(ps[i]);continue;}const segment=c.wrap&&c.wrap!=='none'?linePoints({x:ps[i-1].x+65535,y:ps[i-1].y+65535},{x:ps[i].x+65535,y:ps[i].y+65535},131071,131071).map(p=>({x:p.x-65535,y:p.y-65535})):linePoints(ps[i-1],ps[i],ctx.doc.width,ctx.doc.height,Math.max(b.size,b.mask?.width??0,b.mask?.height??0));for(let j=0;j<segment.length;j++){if(path.at(-1)?.x===segment[j].x&&path.at(-1)?.y===segment[j].y)continue;path.push({...segment[j],pressure:(ps[i-1].pressure??1)+((ps[i].pressure??1)-(ps[i-1].pressure??1))*j/Math.max(1,segment.length-1)});if(path.length>1048576)fail('Stroke exceeds work budget');}}const filtered=[];for(const p of path){const a=filtered.at(-2),b0=filtered.at(-1);if(c.pixelPerfect&&b.size===1&&!b.mask&&a&&b0&&Math.abs(a.x-p.x)===1&&Math.abs(a.y-p.y)===1&&Math.abs(a.x-b0.x)+Math.abs(a.y-b0.y)===1&&Math.abs(p.x-b0.x)+Math.abs(p.y-b0.y)===1)filtered.pop();filtered.push(p);}for(const p of filtered)stamp(ctx,p,b);}
function bounds(c){const x=integer(c.x,'X',-65535,65535),y=integer(c.y,'Y',-65535,65535),width=integer(c.width,'Shape width',1,65535),height=integer(c.height,'Shape height',1,65535);return {x,y,width,height};}
function drawShape(ctx,c,ellipse=false){const b=bounds(c),color=encodeColor(ctx.doc,(c.color===undefined?ctx.doc.palette[0]:c.color)),thickness=integer(c.size??1,'Outline size',1,256);const x1=Math.max(0,b.x),y1=Math.max(0,b.y),x2=Math.min(ctx.doc.width,b.x+b.width),y2=Math.min(ctx.doc.height,b.y+b.height);for(let y=y1;y<y2;y++)for(let x=x1;x<x2;x++){const dx=x-b.x+.5-b.width/2,dy=y-b.y+.5-b.height/2;const outer=ellipse?(dx/(b.width/2))**2+(dy/(b.height/2))**2<=1:true;const iw=b.width/2-thickness,ih=b.height/2-thickness;const inner=ellipse?(iw>0&&ih>0&&(dx/iw)**2+(dy/ih)**2<1):(x>=b.x+thickness&&y>=b.y+thickness&&x<b.x+b.width-thickness&&y<b.y+b.height-thickness);if(outer&&(c.filled||!inner))ctx.put(x,y,color);}}
function floodMask(doc,get,c){const seed=point(c),mask=Array(doc.width*doc.height).fill(0);if(seed.x<0||seed.y<0||seed.x>=doc.width||seed.y>=doc.height)return mask;const target=pixelRGBA(doc,get(seed.x,seed.y)),tolerance=finite(c.tolerance??0,'Tolerance',0,255);const matches=(x,y)=>{const p=pixelRGBA(doc,get(x,y));return Math.max(...p.map((v,k)=>Math.abs(v-target[k])))<=tolerance;};if(c.contiguous===false){for(let y=0;y<doc.height;y++)for(let x=0;x<doc.width;x++)if(matches(x,y))mask[y*doc.width+x]=1;return mask;}const queue=new Int32Array(doc.width*doc.height);let read=0,write=0;const enqueue=(x,y)=>{if(x<0||y<0||x>=doc.width||y>=doc.height)return;const i=y*doc.width+x;if(mask[i]!==0)return;mask[i]=2;if(matches(x,y)){mask[i]=1;queue[write++]=i;}};enqueue(seed.x,seed.y);while(read<write){const i=queue[read++],x=i%doc.width,y=Math.floor(i/doc.width);enqueue(x-1,y);enqueue(x+1,y);enqueue(x,y-1);enqueue(x,y+1);}return mask.map(v=>v===1?1:0);}
export function buildSelection(doc,spec,existing=null,operation='replace'){
 if(!record(spec))fail('Selection specification missing');if(!['replace','union','subtract','intersect'].includes(operation))fail('Invalid selection combination');existing=selectionMask(doc,existing);let mask=Array(doc.width*doc.height).fill(0);
 if(spec.shape==='wand'){const {cel,image}=getCel(doc,spec.frameId,spec.layerId)??{cel:{x:0,y:0},image:null};const rendered=spec.merged?renderFrame(doc,spec.frameId):null;const get=(x,y)=>{if(rendered){const i=(y*doc.width+x)*4;return hex([...rendered.subarray(i,i+4)]);}x-=cel.x;y-=cel.y;return !image||x<0||y<0||x>=image.width||y>=image.height?null:image.pixels[y*image.width+x];};mask=floodMask(spec.merged?doc:colorContext(doc,spec.frameId,spec.layerId??doc.layers.find(layer=>layer.type!=='group')?.id),get,spec);}
 else if(spec.shape==='lasso'){const ps=points(spec.points,3,4096);for(let y=0;y<doc.height;y++){const scan=y+.5,crossings=[];for(let i=0,j=ps.length-1;i<ps.length;j=i++){const a=ps[i],b=ps[j];if((a.y>scan)!==(b.y>scan))crossings.push(a.x+(scan-a.y)*(b.x-a.x)/(b.y-a.y));}crossings.sort((a,b)=>a-b);for(let i=0;i+1<crossings.length;i+=2)for(let x=Math.max(0,Math.ceil(crossings[i]-.5));x<Math.min(doc.width,Math.ceil(crossings[i+1]-.5));x++)mask[y*doc.width+x]=1;}for(let i=0;i<ps.length;i++)for(const p of linePoints(ps[i],ps[(i+1)%ps.length],doc.width,doc.height))mask[p.y*doc.width+p.x]=1;}
 else if(spec.shape==='rect'||spec.shape==='ellipse'){const b=bounds(spec);for(let y=Math.max(0,b.y);y<Math.min(doc.height,b.y+b.height);y++)for(let x=Math.max(0,b.x);x<Math.min(doc.width,b.x+b.width);x++)if(spec.shape==='rect'||((x-b.x+.5-b.width/2)/(b.width/2))**2+((y-b.y+.5-b.height/2)/(b.height/2))**2<=1)mask[y*doc.width+x]=1;}
 else fail('Unsupported selection shape');if(operation==='replace')return mask;return mask.map((v,i)=>operation==='union'?+(!!v||!!existing?.[i]):operation==='subtract'?+(!!existing?.[i]&&!v):+(v&&!!existing?.[i]));
}

const FONT_ROWS={
 'A':['01110','10001','10001','11111','10001','10001','10001'],'B':['11110','10001','10001','11110','10001','10001','11110'],'C':['01111','10000','10000','10000','10000','10000','01111'],'D':['11110','10001','10001','10001','10001','10001','11110'],'E':['11111','10000','10000','11110','10000','10000','11111'],'F':['11111','10000','10000','11110','10000','10000','10000'],'G':['01111','10000','10000','10111','10001','10001','01111'],'H':['10001','10001','10001','11111','10001','10001','10001'],'I':['11111','00100','00100','00100','00100','00100','11111'],'J':['00111','00010','00010','00010','10010','10010','01100'],'K':['10001','10010','10100','11000','10100','10010','10001'],'L':['10000','10000','10000','10000','10000','10000','11111'],'M':['10001','11011','10101','10101','10001','10001','10001'],'N':['10001','11001','10101','10011','10001','10001','10001'],'O':['01110','10001','10001','10001','10001','10001','01110'],'P':['11110','10001','10001','11110','10000','10000','10000'],'Q':['01110','10001','10001','10001','10101','10010','01101'],'R':['11110','10001','10001','11110','10100','10010','10001'],'S':['01111','10000','10000','01110','00001','00001','11110'],'T':['11111','00100','00100','00100','00100','00100','00100'],'U':['10001','10001','10001','10001','10001','10001','01110'],'V':['10001','10001','10001','10001','10001','01010','00100'],'W':['10001','10001','10001','10101','10101','10101','01010'],'X':['10001','10001','01010','00100','01010','10001','10001'],'Y':['10001','10001','01010','00100','00100','00100','00100'],'Z':['11111','00001','00010','00100','01000','10000','11111'],
 '0':['01110','10001','10011','10101','11001','10001','01110'],'1':['00100','01100','00100','00100','00100','00100','01110'],'2':['01110','10001','00001','00010','00100','01000','11111'],'3':['11110','00001','00001','01110','00001','00001','11110'],'4':['00010','00110','01010','10010','11111','00010','00010'],'5':['11111','10000','10000','11110','00001','00001','11110'],'6':['01110','10000','10000','11110','10001','10001','01110'],'7':['11111','00001','00010','00100','01000','01000','01000'],'8':['01110','10001','10001','01110','10001','10001','01110'],'9':['01110','10001','10001','01111','00001','00001','01110'],
 '?':['01110','10001','00010','00100','00100','00000','00100'],'!':['00100','00100','00100','00100','00100','00000','00100'],'.':['00000','00000','00000','00000','00000','00110','00110'],',':['00000','00000','00000','00000','00110','00110','00100'],':':['00000','00110','00110','00000','00110','00110','00000'],';':['00000','00110','00110','00000','00110','00110','00100'],'-':['00000','00000','00000','11111','00000','00000','00000'],'_':['00000','00000','00000','00000','00000','00000','11111'],'+':['00000','00100','00100','11111','00100','00100','00000'],'=':['00000','00000','11111','00000','11111','00000','00000'],'/':['00001','00010','00010','00100','01000','01000','10000'],'\\':['10000','01000','01000','00100','00010','00010','00001'],'(':['00010','00100','01000','01000','01000','00100','00010'],')':['01000','00100','00010','00010','00010','00100','01000'],'[':['01110','01000','01000','01000','01000','01000','01110'],']':['01110','00010','00010','00010','00010','00010','01110'],'<':['00010','00100','01000','10000','01000','00100','00010'],'>':['01000','00100','00010','00001','00010','00100','01000'],'#':['01010','01010','11111','01010','11111','01010','01010'],'*':['00000','10101','01110','11111','01110','10101','00000'],'"':['01010','01010','00000','00000','00000','00000','00000'],"'":['00100','00100','00000','00000','00000','00000','00000'],' ':['00000','00000','00000','00000','00000','00000','00000']
};
export const BITMAP_FONT=Object.freeze({width:5,height:7,glyphs:Object.freeze(Object.fromEntries(Object.entries(FONT_ROWS).map(([k,v])=>[k,Object.freeze(v.join('').split('').map(Number))])))});
function drawText(ctx,c){const pos=point(c),scale=integer(c.scale??1,'Text scale',1,64),font=c.font??BITMAP_FONT,w=integer(font.width,'Glyph width',1,64),h=integer(font.height,'Glyph height',1,64);if(typeof c.text!=='string'||c.text.length>4096)fail('Text must contain at most 4096 characters');const spacing=integer(c.spacing??1,'Text spacing',0,64),lineHeight=integer(c.lineHeight??h+1,'Line height',1,128),color=encodeColor(ctx.doc,(c.color===undefined?ctx.doc.palette[0]:c.color));let x=pos.x,y=pos.y;for(const ch of c.text){if(ch==='\n'){x=pos.x;y+=lineHeight*scale;continue;}const glyph=font.glyphs[ch]??font.glyphs[ch.toUpperCase()]??font.glyphs['?'];if(!Array.isArray(glyph)||glyph.length!==w*h)fail(`Missing or invalid glyph: ${ch}`);for(let gy=0;gy<h;gy++)for(let gx=0;gx<w;gx++)if(glyph[gy*w+gx])for(let py=0;py<scale;py++)for(let px=0;px<scale;px++)ctx.put(x+gx*scale+px,y+gy*scale+py,color);x+=(w+spacing)*scale;}}
function gradient(ctx,c){const a=point(c.from,'Gradient start'),b=point(c.to,'Gradient end'),ac=pixelRGBA(ctx.doc,encodeColor(ctx.doc,(c.color===undefined?ctx.doc.palette[0]:c.color))),bc=pixelRGBA(ctx.doc,encodeColor(ctx.doc,(c.endColor===undefined?ctx.doc.palette.at(-1):c.endColor))),dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;if(!den)fail('Gradient endpoints must differ');const bayer=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];for(let y=0;y<ctx.doc.height;y++)for(let x=0;x<ctx.doc.width;x++){let t=clamp(((x-a.x)*dx+(y-a.y)*dy)/den);if(c.dither){const threshold=(bayer[(y%4)*4+x%4]+.5)/16;ctx.put(x,y,encodeColor(ctx.doc,hex(t>=threshold?bc:ac)));}else ctx.put(x,y,encodeColor(ctx.doc,hex(ac.map((v,k)=>v+(bc[k]-v)*t))));}}
function drawCurve(ctx,c){const ps=points(c.points,3,4);if(ps.length!==3&&ps.length!==4)fail('Curve requires 3 or 4 control points');const length=ps.slice(1).reduce((s,p,i)=>s+Math.hypot(p.x-ps[i].x,p.y-ps[i].y),0),steps=Math.max(4,Math.min(16384,Math.ceil(length*2))),path=[];for(let i=0;i<=steps;i++){const t=i/steps,u=1-t;path.push(ps.length===3?{x:Math.round(u*u*ps[0].x+2*u*t*ps[1].x+t*t*ps[2].x),y:Math.round(u*u*ps[0].y+2*u*t*ps[1].y+t*t*ps[2].y)}:{x:Math.round(u**3*ps[0].x+3*u*u*t*ps[1].x+3*u*t*t*ps[2].x+t**3*ps[3].x),y:Math.round(u**3*ps[0].y+3*u*u*t*ps[1].y+3*u*t*t*ps[2].y+t**3*ps[3].y)});}drawStroke(ctx,path,c);}
function drawPolygon(ctx,c){const ps=points(c.points,c.filled?3:2,4096),color=encodeColor(ctx.doc,(c.color===undefined?ctx.doc.palette[0]:c.color));if(c.filled){const minY=Math.max(0,Math.min(...ps.map(p=>p.y))),maxY=Math.min(ctx.doc.height-1,Math.max(...ps.map(p=>p.y)));for(let y=minY;y<=maxY;y++){const scan=y+.5,intersections=[];for(let i=0,j=ps.length-1;i<ps.length;j=i++){const a=ps[i],b=ps[j];if((a.y>scan)!==(b.y>scan))intersections.push(a.x+(scan-a.y)*(b.x-a.x)/(b.y-a.y));}intersections.sort((a,b)=>a-b);for(let i=0;i+1<intersections.length;i+=2)for(let x=Math.max(0,Math.ceil(intersections[i]-.5));x<Math.min(ctx.doc.width,Math.ceil(intersections[i+1]-.5));x++)ctx.put(x,y,color);}}drawStroke(ctx,[...ps,ps[0]],c);}
function maskBounds(mask,width,height){let x=width,y=height,x2=-1,y2=-1;for(let i=0;i<mask.length;i++)if(mask[i]){const px=i%width,py=Math.floor(i/width);x=Math.min(x,px);y=Math.min(y,py);x2=Math.max(x2,px);y2=Math.max(y2,py);}return x2<0?null:{x,y,width:x2-x+1,height:y2-y+1};}
function selectionTransform(doc,c,changed){
 const mask=selectionMask(doc,c.selection);if(!mask)fail('Transform requires a selection');const b=maskBounds(mask,doc.width,doc.height);if(!b)return;
 const ctx=context(doc,{...c,selection:null},changed),snapshot=[...ctx.image.pixels],get=(x,y)=>{const ix=x-ctx.cel.x,iy=y-ctx.cel.y;return ix<0||iy<0||ix>=ctx.image.width||iy>=ctx.image.height?null:snapshot[iy*ctx.image.width+ix];},op=c.operation??'move',method=c.method??'nearest';
 if(!['move','scale','rotate','flipX','flipY'].includes(op))fail('Unsupported selection transform');if(!['nearest','pixel-safe','fast','rotsprite'].includes(method))fail('Unsupported transform sampling method');if(method!=='nearest'&&op!=='rotate')fail('Fast and RotSprite sampling are only used for rotation');
 const dx=finite(c.dx??0,'Move x',-65535,65535),dy=finite(c.dy??0,'Move y',-65535,65535),sx=op==='scale'?finite(c.scaleX??1,'Scale x',.01,64):op==='flipX'?-1:1,sy=op==='scale'?finite(c.scaleY??c.scaleX??1,'Scale y',.01,64):op==='flipY'?-1:1,angle=op==='rotate'?finite(c.angle??0,'Angle',-36000,36000)*Math.PI/180:0,cos=Math.cos(angle),sin=Math.sin(angle),cx=c.pivot?.x??(b.x+b.width/2),cy=c.pivot?.y??(b.y+b.height/2);finite(cx,'Pivot x',-65535,65535);finite(cy,'Pivot y',-65535,65535);
 if(op==='rotate'){
  // PixelWall rounds three outer corners and derives the fourth, keeping an
  // exact parallelogram. The native raster algorithms accept corners, not angles.
  const corner=(x,y)=>[Math.round((x-cx)*cos-(y-cy)*sin+cx+dx),Math.round((x-cx)*sin+(y-cy)*cos+cy+dy)],q0=corner(b.x,b.y),q1=corner(b.x+b.width,b.y),q3=corner(b.x,b.y+b.height),corners=[q0,q1,[q1[0]+q3[0]-q0[0],q1[1]+q3[1]-q0[1]],q3];
  const left=Math.min(...corners.map(p=>p[0])),top=Math.min(...corners.map(p=>p[1])),width=Math.max(...corners.map(p=>p[0]))-left,height=Math.max(...corners.map(p=>p[1]))-top;
  let transformed=null;
  if(width&&height&&left<doc.width&&top<doc.height&&left+width>0&&top+height>0){
   const pixels=new Uint32Array(b.width*b.height),selection=new Uint8Array(pixels.length),indexed=doc.colorMode==='indexed',gray=doc.colorMode==='grayscale';
   for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){const at=y*b.width+x;if(!mask[(y+b.y)*doc.width+x+b.x])continue;selection[at]=1;const raw=get(x+b.x,y+b.y),rgba=pixelRGBA(ctx.doc,raw);pixels[at]=indexed?(raw==null||!rgba[3]?0:raw+1):gray?(rgba[0]|rgba[3]<<8):((rgba[0]|rgba[1]<<8|rgba[2]<<16|rgba[3]<<24)>>>0);}
   transformed=rasterizeRotation({pixels,width:b.width,height:b.height,destinationWidth:width,destinationHeight:height,corners:corners.map(([x,y])=>[x-left,y-top]),method:['pixel-safe','rotsprite'].includes(method)?'rotsprite':'fast',pixelFormat:indexed?'values':gray?'grayscale':'rgba',mask:selection});
  }
  if(!c.copy)for(let y=b.y;y<b.y+b.height;y++)for(let x=b.x;x<b.x+b.width;x++)if(mask[y*doc.width+x])ctx.put(x,y,null);
  if(transformed){const back=new Uint8ClampedArray(4);for(let y=Math.max(0,-top);y<Math.min(height,doc.height-top);y++)for(let x=Math.max(0,-left);x<Math.min(width,doc.width-left);x++){const at=y*width+x;if(!transformed.coverage[at])continue;const value=transformed.pixels[at];if(doc.colorMode==='indexed'){if(value)ctx.put(x+left,y+top,value-1);continue;}const rgba=doc.colorMode==='grayscale'?[value&255,value&255,value&255,(value>>>8)&255]:[value&255,(value>>>8)&255,(value>>>16)&255,value>>>24];if(!rgba[3])continue;back.set(pixelRGBA(ctx.doc,ctx.get(x+left,y+top)));blendAt(back,0,rgba,1,'normal');ctx.put(x+left,y+top,encodeColor(ctx.doc,hex([...back])));}}
  return;
 }

 if(!c.copy)for(let y=b.y;y<b.y+b.height;y++)for(let x=b.x;x<b.x+b.width;x++)if(mask[y*doc.width+x])ctx.put(x,y,null);
 for(let y=0;y<doc.height;y++)for(let x=0;x<doc.width;x++){
  const tx=x+.5-cx-dx,ty=y+.5-cy-dy,sourceX=Math.floor((tx*cos+ty*sin)/sx+cx+1e-9),sourceY=Math.floor((-tx*sin+ty*cos)/sy+cy+1e-9);if(sourceX>=0&&sourceY>=0&&sourceX<doc.width&&sourceY<doc.height&&mask[sourceY*doc.width+sourceX])ctx.put(x,y,get(sourceX,sourceY));
 }
}
// A range effect is evaluated once per distinct image/palette context. Equal-context
// links remain linked; palette-dependent results cannot overwrite another context.
function separateEffectContexts(doc,c){
 const selected=targetFrames(doc,c);if(doc.colorMode!=='indexed'||selected.length<2)return;
 const layer=layerFor(doc,c.layerId,true),selectedImages=new Set(selected.map(frame=>frame.cels[layer.id]?.imageId).filter(Boolean)),groups=new Map();
 for(const frame of doc.frames){
  const cel=frame.cels[layer.id];if(!cel||!selectedImages.has(cel.imageId))continue;
  const originalId=cel.imageId,key=JSON.stringify(getFramePalette(doc,frame.id,layer.id));
  let contexts=groups.get(originalId);if(!contexts){contexts=new Map();groups.set(originalId,contexts);}
  if(!contexts.has(key)){
   if(!contexts.size)contexts.set(key,originalId);
   else{const image=doc.images[originalId];reserve(doc,image.width*image.height);const imageId=fresh(doc,'image');doc.images[imageId]={...image,pixels:[...image.pixels]};contexts.set(key,imageId);}
  }
  cel.imageId=contexts.get(key);
 }
}
function applyEffect(doc,c,changed){separateEffectContexts(doc,c);const effect=c.effect;const supported=['replace','outline','brightness','contrast','hue','saturation','convolution','despeckle'];if(!supported.includes(effect))fail('Unsupported effect');const handled=new Set();for(const frame of targetFrames(doc,c)){const cel0=frame.cels[c.layerId??doc.layers.find(l=>l.type==='image')?.id];if(cel0&&handled.has(cel0.imageId))continue;const ctx=context(doc,{...c,frameId:frame.id},changed);handled.add(ctx.cel.imageId);const source=[...ctx.image.pixels],sample=(x,y)=>{x=clamp(x,0,doc.width-1)-ctx.cel.x;y=clamp(y,0,doc.height-1)-ctx.cel.y;return x<0||y<0||x>=ctx.image.width||y>=ctx.image.height?null:source[y*ctx.image.width+x];};
 const color=['replace','outline'].includes(effect)?encodeColor(ctx.doc,(c.toColor===undefined?(c.color===undefined?doc.palette[0]:c.color):c.toColor)):null,from=effect==='replace'&&c.fromColor!==undefined?encodeColor(ctx.doc,c.fromColor):undefined,amount=['brightness','contrast','hue','saturation'].includes(effect)?finite(c.amount??(effect==='hue'?30:.1),'Effect amount',effect==='hue'?-360:effect==='contrast'?-.99:-1,effect==='hue'?360:effect==='contrast'?.99:1):0,radius=effect==='outline'?integer(c.radius??1,'Outline radius',1,64):1;let kernel,size,divisor;
 if(effect==='convolution'){kernel=c.kernel;if(!Array.isArray(kernel)||kernel.length<1||kernel.length>225||!Number.isInteger(Math.sqrt(kernel.length))||Math.sqrt(kernel.length)%2!==1)fail('Convolution requires an odd square kernel up to 15×15');for(const n of kernel)finite(n,'Kernel coefficient',-1000,1000);size=Math.sqrt(kernel.length);divisor=finite(c.divisor??(kernel.reduce((a,b)=>a+b,0)||1),'Kernel divisor',-1e6,1e6);if(divisor===0)fail('Kernel divisor cannot be zero');finite(c.bias??0,'Kernel bias',-255,255);}
 if((ctx.mask?ctx.mask.reduce((sum,v)=>sum+(v?1:0),0):doc.width*doc.height)*(effect==='outline'?(radius*2+1)**2:effect==='convolution'?kernel.length:effect==='despeckle'?9:1)>LIMITS.operations)fail('Effect exceeds work budget; use a smaller canvas or radius');
 for(let y=0;y<doc.height;y++)for(let x=0;x<doc.width;x++){if(ctx.mask&&!ctx.mask[y*doc.width+x])continue;const p=sample(x,y),v=pixelRGBA(ctx.doc,p);let result=p;
 if(effect==='replace'){const match=from===undefined?p!==null:hex(pixelRGBA(ctx.doc,from))===hex(v);if(match)result=color;}
 else if(effect==='outline'){if(v[3]===0){let hit=false;for(let oy=-radius;oy<=radius&&!hit;oy++)for(let ox=-radius;ox<=radius;ox++){if(c.diagonal===false&&Math.abs(ox)+Math.abs(oy)>radius)continue;if(x+ox<0||y+oy<0||x+ox>=doc.width||y+oy>=doc.height)continue;if(pixelRGBA(ctx.doc,sample(x+ox,y+oy))[3]){hit=true;break;}}if(hit)result=color;}}
 else if(effect==='convolution'){const sum=[0,0,0,0];for(let ky=0;ky<size;ky++)for(let kx=0;kx<size;kx++){const q=pixelRGBA(ctx.doc,sample(x+kx-(size-1)/2,y+ky-(size-1)/2)),weight=kernel[ky*size+kx];for(let k=0;k<4;k++)sum[k]+=q[k]*weight;}result=encodeColor(ctx.doc,hex(sum.map((n,k)=>k===3&&!c.affectAlpha?v[3]:n/divisor+(k===3?0:c.bias??0))));}
 else if(effect==='despeckle'){const samples=[];for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++)samples.push(pixelRGBA(ctx.doc,sample(x+ox,y+oy)));result=encodeColor(ctx.doc,hex([0,1,2,3].map(k=>samples.map(p=>p[k]).sort((a,b)=>a-b)[4])));}
 else if(v[3]){if(effect==='brightness')for(let k=0;k<3;k++)v[k]+=amount*255;else if(effect==='contrast'){const factor=(1+amount)/(1-amount);for(let k=0;k<3;k++)v[k]=(v[k]-127.5)*factor+127.5;}else{const hsl=rgbHsl(v);if(effect==='hue')hsl[0]+=amount/360;else hsl[1]=clamp(hsl[1]+amount);v.splice(0,3,...hslRgb(hsl));}result=encodeColor(ctx.doc,hex(v));}
 ctx.put(x,y,result);
 }
}}
function gcImages(doc){const used=new Set(doc.frames.flatMap(f=>Object.values(f.cels).map(c=>c.imageId)));for(const ts of doc.tilesets){if(ts.imageId)used.add(ts.imageId);for(const t of ts.tiles??[])used.add(t.imageId);}for(const key of Object.keys(doc.images))if(!used.has(key))delete doc.images[key];}
function resizeImage(image,width,height){const pixels=Array(width*height).fill(null);for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[y*width+x]=image.pixels[Math.min(image.height-1,Math.floor(y*image.height/height))*image.width+Math.min(image.width-1,Math.floor(x*image.width/width))];return {...image,width,height,pixels};}
function resizeDocument(doc,c){const width=integer(c.width,'Width',1,LIMITS.edge),height=integer(c.height,'Height',1,LIMITS.edge),mode=c.mode??'canvas';if(width*height>LIMITS.canvasPixels)fail('Canvas exceeds the 4,194,304 pixel budget','MEMORY_BUDGET');if(!['canvas','scale'].includes(mode))fail('Invalid resize mode');const sx=width/doc.width,sy=height/doc.height,dx=c.anchor==='center'?Math.floor((width-doc.width)/2):0,dy=c.anchor==='center'?Math.floor((height-doc.height)/2):0;
 if(mode==='scale'){const referenced=new Set(doc.frames.flatMap(f=>Object.values(f.cels).map(c=>c.imageId))),plans=[];let pixels=0;for(const [key,image]of Object.entries(doc.images)){if(referenced.has(key)&&!image.tilemap){const w=Math.max(1,Math.round(image.width*sx)),h=Math.max(1,Math.round(image.height*sy));integer(w,'Scaled image width',1,LIMITS.imageEdge);integer(h,'Scaled image height',1,LIMITS.imageEdge);pixels+=w*h;plans.push([key,w,h]);}else pixels+=image.width*image.height;}if(pixels>LIMITS.pixels)fail('Scaled document exceeds pixel budget');for(const [key,w,h]of plans)doc.images[key]=resizeImage(doc.images[key],w,h);for(const frame of doc.frames)for(const cel of Object.values(frame.cels)){cel.x=Math.round(cel.x*sx);cel.y=Math.round(cel.y*sy);}}
 else for(const frame of doc.frames)for(const cel of Object.values(frame.cels)){cel.x+=dx;cel.y+=dy;}
 doc.slices=doc.slices.map(s=>{if(!s.bounds)return {...s,keys:s.keys.map(k=>({...k,x:Math.round(mode==='scale'?k.x*sx:k.x+dx),y:Math.round(mode==='scale'?k.y*sy:k.y+dy),width:Math.round(k.width*(mode==='scale'?sx:1)),height:Math.round(k.height*(mode==='scale'?sy:1))}))};const x=clamp(Math.round(mode==='scale'?s.bounds.x*sx:s.bounds.x+dx),0,width-1),y=clamp(Math.round(mode==='scale'?s.bounds.y*sy:s.bounds.y+dy),0,height-1);return {...s,bounds:{x,y,width:clamp(Math.round(s.bounds.width*(mode==='scale'?sx:1)),1,width-x),height:clamp(Math.round(s.bounds.height*(mode==='scale'?sy:1)),1,height-y)}};});doc.width=width;doc.height=height;
}

export function easing(t,name='linear'){t=clamp(t);switch(name){case'linear':return t;case'easeIn':return t*t;case'easeOut':return 1-(1-t)**2;case'easeInOut':return t<.5?2*t*t:1-(-2*t+2)**2/2;case'bounce':{const n=7.5625,d=2.75;if(t<1/d)return n*t*t;if(t<2/d)return n*(t-=1.5/d)*t+.75;if(t<2.5/d)return n*(t-=2.25/d)*t+.9375;return n*(t-=2.625/d)*t+.984375;}default:fail('Unsupported easing');}}
function tween(doc,c){const layer=layerFor(doc,c.layerId,true);if(layer.type==='group'||layer.type==='tilemap')fail('Tween requires a raster layer');const frames=targetFrames(doc,c),source=frameFor(doc,c.sourceFrameId??frames[0].id).cels[layer.id];if(!source)fail('Tween source cel is empty');const from=c.from??{},to=c.to??{},start={x:finite(from.x??source.x,'Start x',-65535,65535),y:finite(from.y??source.y,'Start y',-65535,65535),opacity:finite(from.opacity??source.opacity,'Start opacity',0,1)},end={x:finite(to.x??start.x,'End x',-65535,65535),y:finite(to.y??start.y,'End y',-65535,65535),opacity:finite(to.opacity??start.opacity,'End opacity',0,1)};
 frames.forEach((f,i)=>{const t=easing(frames.length===1?0:i/(frames.length-1),c.easing??'linear');const cel={...source,x:Math.round(start.x+(end.x-start.x)*t),y:Math.round(start.y+(end.y-start.y)*t),opacity:start.opacity+(end.opacity-start.opacity)*t};if(c.bake!==false){const image=doc.images[source.imageId];reserve(doc,image.width*image.height);const key=fresh(doc,'image');doc.images[key]={...image,pixels:[...image.pixels]};cel.imageId=key;}f.cels[layer.id]=cel;});
 doc.metadata.motion={...(doc.metadata.motion??{}),[c.id??'last-tween']:{type:'tween',layerId:layer.id,frameIds:frames.map(f=>f.id),from:start,to:end,easing:c.easing??'linear',bake:c.bake!==false}};
}
function seededRandom(seed){let n=seed>>>0;return ()=>{n+=0x6d2b79f5;let t=n;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
function particles(doc,c,changed){const layer=layerFor(doc,c.layerId,true);if(layer.type!=='image')fail('Particles require an image layer');const frames=targetFrames(doc,c),seed=integer(c.seed??1,'Seed',0,0xffffffff),count=integer(c.count??32,'Particle count',1,4096),x=finite(c.x??doc.width/2,'Emitter x',-65535,65535),y=finite(c.y??doc.height/2,'Emitter y',-65535,65535),speed=finite(c.speed??20,'Speed',0,4096),spread=finite(c.spread??360,'Spread',0,360),angle=finite(c.angle??-90,'Direction',-36000,36000),gravity=finite(c.gravity??12,'Gravity',-4096,4096),lifetime=finite(c.lifetime??2,'Lifetime seconds',.01,3600),size=integer(c.size??1,'Particle size',1,64),random=seededRandom(seed),emission=finite(c.emission??0,'Emission seconds',0,3600),color=(c.color===undefined?doc.palette[0]:c.color);
 const ps=Array.from({length:count},()=>{const a=(angle+(random()-.5)*spread)*Math.PI/180,v=speed*(.5+random()*.5);return {vx:Math.cos(a)*v,vy:Math.sin(a)*v,birth:random()*emission,life:lifetime*(.7+.3*random())};});let time=0;
 for(const frame of frames){if(c.clear!==false){delete frame.cels[layer.id];gcImages(doc);}const ctx=context(doc,{...c,frameId:frame.id},changed),b=brush({size,color,brush:c.brush??'square'},ctx.doc);for(const p of ps){const t=time-p.birth;if(t<0||t>p.life)continue;const a=c.fade===false?1:1-t/p.life,base=pixelRGBA(ctx.doc,b.color);stamp(ctx,{x:Math.round(x+p.vx*t),y:Math.round(y+p.vy*t+.5*gravity*t*t)},{...b,color:encodeColor(ctx.doc,hex([base[0],base[1],base[2],base[3]*a]))});}time+=frame.durationMs/1000;}
 doc.metadata.motion={...(doc.metadata.motion??{}),[c.id??'last-particles']:{type:'particles',layerId:layer.id,frameIds:frames.map(f=>f.id),seed,count,x,y,speed,spread,angle,gravity,lifetime,size,emission,color,fade:c.fade!==false}};
}
function setCel(doc,c){const frame=frameFor(doc,c.frameId),layer=layerFor(doc,c.layerId,true);if(!['image','reference'].includes(layer.type))fail('Set cel requires a raster layer');const width=integer(c.width??doc.width,'Image width',1,LIMITS.imageEdge),height=integer(c.height??doc.height,'Image height',1,LIMITS.imageEdge);if(width*height>LIMITS.pixels||!Array.isArray(c.pixels)||c.pixels.length!==width*height)fail('Imported image dimensions mismatch');const working=colorContext(doc,frame.id,layer.id),pixels=c.pixels.map(v=>encodeColor(working,v));const existing=frame.cels[layer.id],key=c.editLinked&&existing?existing.imageId:fresh(doc,'image');if(existing&&!c.editLinked)delete frame.cels[layer.id];gcImages(doc);reserve(doc,width*height,own(doc.images,key)?key:undefined);doc.images[key]={width,height,pixels};frame.cels[layer.id]={...(existing?.userData?{userData:jsonCopy(existing.userData)}:{}),...(existing?.zIndex!==undefined?{zIndex:existing.zIndex}:{}),imageId:key,x:integer(c.x??0,'Cel x',-65535,65535),y:integer(c.y??0,'Cel y',-65535,65535),opacity:finite(c.opacity??1,'Cel opacity',0,1)};}
/** Convert each image in its actual frame/layer color context. Tile variants stay in
 * the same tileset, so palette animation remains exportable as a native tilemap. */
function convertColorMode(doc,colorMode,options={}){
 if(!['rgba','indexed','grayscale'].includes(colorMode))fail('Unsupported color mode');
 if(colorMode===doc.colorMode&&!options.remap&&!options.indexedOptions)return;
 const source=shallowDocument(doc),images={},variants=new Map(),tilesetVariants=new Map();
 const usedIds=new Set(Object.keys(source.images));let nextImage=1,storedPixels=0;
 const framePalettes=new Map(),contexts=new WeakMap();let palette=source.palette,workPixels=0;
 const indexedOptions=options.indexedOptions,indexedBudget={remaining:LIMITS.operations};
 const nativeMapping=indexedOptions&&indexedOptions.rgbmap!=='pixelwall',nativeGeneration=indexedOptions?.paletteMode==='generate'&&indexedOptions.quantization!=='median-cut';
 const backgroundOnly=source.layers.length===1&&!!(source.layers[0].asepriteFlags&8);
 let destinationTransparent=indexedOptions?(source.metadata?.aseprite?.transparentIndex??0):source.metadata?.aseprite?.transparentIndex;
 if(nativeMapping&&source.colorMode!=='indexed')destinationTransparent=Math.max(0,source.palette.indexOf('#00000000'));
 let generatedPalette;
 for(const frame of source.frames){if(frame.palette)palette=frame.palette;framePalettes.set(frame.id,palette);}
 if(indexedOptions?.paletteMode==='generate'){
  function* samples(){
   const seen=new Set(),usedTilesets=new Set();
   function* imageSamples(imageId,frameId,layerId){
    const image=source.images[imageId];if(!image||image.tilemap)return;
    const effective=getFramePalette(source,frameId,layerId),key=JSON.stringify([imageId,source.colorMode==='indexed'?effective:null]);if(seen.has(key))return;seen.add(key);
    const working={...source,palette:effective};for(const pixel of image.pixels)yield pixel==null?null:hex(pixelRGBA(working,pixel));
   }
   function* tileSamples(tilesetId,frameId,layerId){
    const ts=source.tilesets.find(value=>value.id===tilesetId);if(!ts)return;usedTilesets.add(ts.id);
    if(!ts.tiles?.length&&ts.externalFileId!=null)fail('Embed external tileset pixels before converting color mode');
    for(const imageId of new Set([ts.imageId,...(ts.tiles??[]).map(tile=>tile.imageId)].filter(Boolean)))yield* imageSamples(imageId,frameId,layerId);
   }
   for(const frame of source.frames)for(const layer of source.layers){
    const cel=frame.cels[layer.id];if(cel)yield* imageSamples(cel.imageId,frame.id,layer.id);
    if(layer.type==='tilemap')yield* tileSamples(layer.tilemaps?.[frame.id]?.tilesetId??layer.tilesetId,frame.id,layer.id);
   }
   for(const ts of source.tilesets)if(!usedTilesets.has(ts.id))yield* tileSamples(ts.id,source.frames[0].id);
  }
  function* renderedSamples(){for(const frame of source.frames){const cost=source.width*source.height*Math.max(1,source.layers.length);indexedBudget.remaining-=cost;if(indexedBudget.remaining<0)fail('Native indexed palette sampling exceeds the work budget');const rendered=renderFrame(source,frame.id);for(let at=0;at<rendered.length;at+=4)yield hex([...rendered.subarray(at,at+4)]);}}
  generatedPalette=quantizePalette(nativeGeneration?renderedSamples():samples(),{...indexedOptions,transparentIndex:nativeGeneration?(backgroundOnly?null:source.colorMode==='indexed'?destinationTransparent:0):destinationTransparent,budget:indexedBudget});
  if(nativeGeneration)destinationTransparent=Math.max(0,generatedPalette.indexOf('#00000000'));
 }
 function contextFor(frameId,layerId){
  const palette=framePalettes.get(frameId),layer=layerId==null?null:source.layers.find(item=>item.id===layerId);
  const transparent=source.metadata?.aseprite?.transparentIndex,maskTransparent=(!layer||!(layer.asepriteFlags&8))&&Number.isInteger(transparent),selected=options.selected?.has(frameId)??false;
  const targetTransparent=(!layer||!(layer.asepriteFlags&8))&&Number.isInteger(destinationTransparent)?destinationTransparent:null;
  const contextKey=`${maskTransparent}:${targetTransparent}:${selected}`;
  let byTransparency=contexts.get(palette);if(!byTransparency){byTransparency=new Map();contexts.set(palette,byTransparency);}
  if(!byTransparency.has(contextKey)){
   const effective=(mode,entries,index)=>{if(mode!=='indexed'||index==null||index>=entries.length)return entries;const copy=[...entries];copy[index]='#00000000';return copy;};
   const from={...source,palette:effective(source.colorMode,palette,maskTransparent?transparent:null)},to={...source,colorMode,palette:effective(colorMode,generatedPalette??(selected?options.palette:palette),nativeMapping?null:targetTransparent)};
   const signature=JSON.stringify([source.colorMode==='indexed'||options.remap?from.palette:null,colorMode==='indexed'||options.remap?to.palette:null,selected]);
   byTransparency.set(contextKey,{from,to,signature,selected,originalPalette:palette,transparent:maskTransparent?transparent:null,targetTransparent});
  }
  return byTransparency.get(contextKey);
 }
 function addImage(imageId,image){
  storedPixels+=image.width*image.height;
  if(storedPixels>LIMITS.pixels)fail('Color conversion exceeds the stored pixel budget','MEMORY_BUDGET');
  images[imageId]=image;return imageId;
 }
 function convertImage(imageId,context){
  const image=source.images[imageId];if(!image)fail('Color conversion references a missing image');
  if(image.tilemap){if(!images[imageId])addImage(imageId,image);return imageId;}
  let byContext=variants.get(imageId);if(!byContext){byContext=new Map();variants.set(imageId,byContext);}
  if(byContext.has(context.signature))return byContext.get(context.signature);
  let convertedId;
  workPixels+=image.pixels.length;if(workPixels>LIMITS.operations)fail('Color conversion exceeds the work budget','MEMORY_BUDGET');
  const pixels=indexedOptions?mapIndexedImage({...image,pixels:image.pixels.map(pixel=>pixel==null?null:hex(pixelRGBA(context.from,pixel)))},context.to.palette,{...indexedOptions,transparentIndex:context.targetTransparent,sourceColorMode:source.colorMode,budget:indexedBudget,...(context.tileGrid??{})}):image.pixels.map(pixel=>{
   if(pixel==null)return null;
   if(!options.remap)return encodeColor(context.to,hex(pixelRGBA(context.from,pixel)));
   if(!context.selected)return pixel;
   if(source.colorMode==='indexed'){
    if(pixel===context.transparent)return null;
    return options.mapping?options.mapping[pixel]:encodeColor(context.to,hex(pixelRGBA(context.from,pixel)));
   }
   const oldIndex=context.originalPalette.indexOf(pixel);
   const mapped=options.mapping&&oldIndex>=0?options.mapping[oldIndex]:nearest(context.to.palette,rgba(pixel));
   return mapped==null?null:encodeColor(context.to,context.to.palette[mapped]);
  });
  // Remapping one context must not break links when their stored pixels still agree.
  if(pixels.every((pixel,i)=>pixel===image.pixels[i])){
   convertedId=imageId;if(!images[convertedId])addImage(convertedId,image);
   else if(!images[convertedId].pixels.every((pixel,i)=>pixel===pixels[i]))convertedId=null;
  }else convertedId=null;
  if(convertedId==null){
   for(const candidate of new Set(byContext.values()))if(images[candidate].pixels.every((pixel,i)=>pixel===pixels[i])){convertedId=candidate;break;}
   if(convertedId==null){convertedId=imageId;if(images[convertedId]){while(usedIds.has(`image-color-${nextImage}`))nextImage++;convertedId=`image-color-${nextImage++}`;usedIds.add(convertedId);}addImage(convertedId,{...image,pixels});}
  }
  byContext.set(context.signature,convertedId);return convertedId;
 }
 function convertTileset(tilesetId,context){
  const original=source.tilesets.find(ts=>ts.id===tilesetId);if(!original)fail('Tileset missing');
  if(!original.tiles?.length&&original.externalFileId!=null)fail('Embed external tileset pixels before converting color mode');
  let state=tilesetVariants.get(tilesetId);
  if(!state){state={tileset:{...original,tiles:[]},contexts:new Map(),usedIds:new Set((original.tiles??[]).map(t=>t.id)),next:1};tilesetVariants.set(tilesetId,state);}
  if(state.contexts.has(context.signature))return state.contexts.get(context.signature);
  const first=state.contexts.size===0,ids=new Map();
  const atlasContext=indexedOptions&&original.imageId?{...context,tileGrid:{tileWidth:original.tileWidth,tileHeight:original.tileHeight},signature:context.signature+JSON.stringify([original.tileWidth,original.tileHeight])}:context;
  if(first&&original.imageId)state.tileset.imageId=convertImage(original.imageId,atlasContext);
  for(const tile of original.tiles??[]){
   let tileId=tile.id;
   if(!first){while(state.usedIds.has(`tile-color-${state.next}`))state.next++;tileId=`tile-color-${state.next++}`;state.usedIds.add(tileId);}
   const converted={...tile,id:tileId,imageId:convertImage(tile.imageId,tile.imageId===original.imageId?atlasContext:context)};
   if(!first)delete converted.asepriteTileId;
   state.tileset.tiles.push(converted);ids.set(tile.id,tileId);
   if(state.tileset.tiles.length>65536)fail('Color conversion exceeds the tileset limit','MEMORY_BUDGET');
  }
  state.contexts.set(context.signature,ids);return ids;
 }
 for(const frame of doc.frames){
  const originalFrame=frameFor(source,frame.id);
  for(const layer of doc.layers){
   const cel=originalFrame.cels[layer.id];
   if(layer.type==='tilemap'){
    const originalLayer=source.layers.find(item=>item.id===layer.id),originalMap=originalLayer.tilemaps?.[frame.id];
    const tilesetId=originalMap?.tilesetId??originalLayer.tilesetId,ts=source.tilesets.find(item=>item.id===tilesetId);
    const map=originalMap??(ts?nativeMap(source,originalLayer,originalFrame,ts):null);
    if(map){
     const ids=convertTileset(tilesetId,contextFor(frame.id,layer.id));
     // Keep native words/flags/links when their original slots still name the converted artwork.
     if(!(nativeMapping&&!originalMap&&map.cells.every(cell=>!cell||ids.get(cell.tileId)===cell.tileId)))layer.tilemaps={...(layer.tilemaps??{}),[frame.id]:{...map,cells:map.cells.map(cell=>cell?{...cell,tileId:ids.get(cell.tileId)}:null)}};
    }
   }
   if(cel)frame.cels[layer.id]={...cel,imageId:convertImage(cel.imageId,contextFor(frame.id,layer.id))};
  }
 }
 // Tilesets remain editable even when no frame currently places them.
 for(const tileset of source.tilesets)if(!tilesetVariants.has(tileset.id))convertTileset(tileset.id,contextFor(source.frames[0].id));
 doc.images=images;doc.tilesets=source.tilesets.map(ts=>tilesetVariants.get(ts.id).tileset);doc.colorMode=colorMode;
 if(generatedPalette){doc.palette=[...generatedPalette];for(const frame of doc.frames)frame.palette=[...generatedPalette];}
 if(indexedOptions)doc.metadata={...doc.metadata,aseprite:{...doc.metadata?.aseprite,transparentIndex:destinationTransparent}};
}

function paletteEdit(doc,c,remap){
 if(!Array.isArray(c.palette)||!c.palette.length||c.palette.length>LIMITS.palette)fail('Invalid palette');
 const palette=c.palette.map(normalizeColor),scope=c.scope??(c.frameIds?'range':c.frameId?'frame':'all');
 if(!['all','frame','range'].includes(scope))fail('Palette scope must be all, frame, or range');
 if(scope==='range'&&(!Array.isArray(c.frameIds)||!c.frameIds.length))fail('Palette range requires frameIds');
 const selected=new Set((scope==='all'?doc.frames:targetFrames(doc,scope==='frame'?{frameId:c.frameId??doc.frames[0].id}:{frameIds:c.frameIds})).map(frame=>frame.id));
 const palettes=new Map();let previous=doc.palette;
 for(const frame of doc.frames){if(frame.palette)previous=frame.palette;palettes.set(frame.id,[...previous]);}
 let mapping=c.mapping;
 if(remap&&mapping){
  if(!Array.isArray(mapping))fail('Palette mapping must include every old index');
  for(const frameId of selected)if(mapping.length!==palettes.get(frameId).length)fail('Palette mapping must include every old index in each selected frame');
  mapping=mapping.map(index=>index==null?null:integer(index,'Remapped index',0,palette.length-1));
 }
 if(remap)convertColorMode(doc,doc.colorMode,{remap:true,selected,palette,mapping});
 else if(doc.colorMode==='indexed'){
  const checked=new Set();
  function checkImage(imageId){if(checked.has(imageId))return;checked.add(imageId);const image=doc.images[imageId];if(!image||image.tilemap)return;for(const pixel of image.pixels)if(pixel!=null&&pixel>=palette.length)fail('Removing used palette entries requires remapping');}
  for(const frame of doc.frames)if(selected.has(frame.id)){
   for(const cel of Object.values(frame.cels))checkImage(cel.imageId);
   for(const layer of doc.layers)if(layer.type==='tilemap'){
    const tilesetId=layer.tilemaps?.[frame.id]?.tilesetId??layer.tilesetId,tileset=doc.tilesets.find(item=>item.id===tilesetId);
    if(tileset?.imageId)checkImage(tileset.imageId);for(const tile of tileset?.tiles??[])checkImage(tile.imageId);
   }
  }
  // All-frame changes also apply to tilesets which are not placed on a frame.
  if(scope==='all')for(const tileset of doc.tilesets){if(tileset.imageId)checkImage(tileset.imageId);for(const tile of tileset.tiles??[])checkImage(tile.imageId);}
 }
 // Explicit snapshots prevent a scoped edit from bleeding into following frames.
 for(const frame of doc.frames)frame.palette=selected.has(frame.id)?[...palette]:palettes.get(frame.id);
 doc.palette=[...doc.frames[0].palette];
 // The base storage palette covers every retained index; frame palettes control display.
 const capacity=Math.max(...doc.frames.map(frame=>frame.palette.length));
 while(doc.palette.length<capacity)doc.palette.push('#00000000');
}

function addTileset(doc,c){const input=c.tileset,working=colorContext(doc,c.frameId,c.layerId);if(!record(input))fail('Tileset is missing');const ts={...jsonCopy(input),id:input.id??fresh(doc,'tileset'),name:input.name??'Tileset',tileWidth:integer(input.tileWidth,'Tile width',1,LIMITS.edge),tileHeight:integer(input.tileHeight,'Tile height',1,LIMITS.edge),tiles:[]};if(doc.tilesets.some(t=>t.id===ts.id))fail('Tileset id exists');if(!Array.isArray(input.tiles)||input.tiles.length>65536)fail('Tileset requires a tile list');for(const [i,t]of input.tiles.entries()){let imageId=t.imageId;if(t.pixels){if(!Array.isArray(t.pixels)||t.pixels.length!==ts.tileWidth*ts.tileHeight)fail('Tile pixels size mismatch');reserve(doc,t.pixels.length);imageId=fresh(doc,'image');doc.images[imageId]={width:ts.tileWidth,height:ts.tileHeight,pixels:t.pixels.map(p=>encodeColor(working,p))};}if(!own(doc.images,imageId))fail('Tile image missing');ts.tiles.push({id:t.id??`tile-${i+1}`,imageId});}doc.tilesets.push(ts);}
function nativeMap(doc,layer,frame,ts){
 const cel=frame.cels[layer.id],image=doc.images[cel?.imageId],raw=image?.tilemap;if(!raw)return null;
 const ids=new Map((ts.tiles??[]).filter(t=>Number.isInteger(t.asepriteTileId)).map(t=>[t.asepriteTileId,t.id]));
 const cells=raw.tiles.map(rawValue=>{const value=rawValue>>>0,index=(value&(raw.idMask??0x1fffffff))>>>0;if((ts.flags&4)?index===0:value===0xffffffff)return null;const tileId=ids.get(index);if(!tileId)return null;const diagonal=!!(value&(raw.diagonalFlipMask??0x20000000)),flipY=!!(value&(raw.yFlipMask??0x40000000)),flipX=!!(value&(raw.xFlipMask??0x80000000));return {tileId,flipX:diagonal?flipY:flipX,flipY:diagonal?!flipX:flipY,rotate:diagonal?90:0};});
 return {tilesetId:ts.id,columns:image.width,rows:image.height,cells,x:cel.x,y:cel.y,opacity:cel.opacity,sourceImageId:cel.imageId};
}
export function getTile(doc,tilesetId,tileId){const ts=doc.tilesets.find(t=>t.id===tilesetId),tile=ts?.tiles?.find(t=>t.id===tileId);if(!tile)fail('Tile not found');const image=doc.images[tile.imageId],r=tile.sourceRect??{x:0,y:0,width:image.width,height:image.height},pixels=Array(ts.tileWidth*ts.tileHeight);for(let y=0;y<ts.tileHeight;y++)for(let x=0;x<ts.tileWidth;x++)pixels[y*ts.tileWidth+x]=image.pixels[(r.y+Math.min(r.height-1,Math.floor(y*r.height/ts.tileHeight)))*image.width+r.x+Math.min(r.width-1,Math.floor(x*r.width/ts.tileWidth))];return {width:ts.tileWidth,height:ts.tileHeight,pixels};}
function replaceTilesetImage(doc,c){
 const ts=doc.tilesets.find(t=>t.id===c.tilesetId);if(!ts)fail('Tileset missing');assertTilesetEditable(doc,ts.id);const slots=tilesetSlots(doc,ts),index=integer(c.tileIndex,'Tile index',0,slots.count-1),tile=slots.entries.get(index);if(!tile)fail((ts.flags&1)?'External tileset artwork must be embedded before editing':'Virtual or missing tile artwork cannot be edited');
 if(c.width!==ts.tileWidth||c.height!==ts.tileHeight)fail('Tile image dimensions must match the tileset grid');const capacity=Math.max(doc.palette.length,...doc.frames.map(f=>f.palette?.length??0)),pixels=validatePixels({width:c.width,height:c.height,pixels:c.pixels},{...doc,palette:{length:capacity}},'Tile image');
 if(ts.imageId&&Number.isInteger(tile.asepriteTileId)){const original=doc.images[ts.imageId];if(!original||original.tilemap)fail('Tileset atlas is missing');const columns=Math.floor(original.width/ts.tileWidth),x=(index%columns)*ts.tileWidth,y=Math.floor(index/columns)*ts.tileHeight;if(columns<1||y+ts.tileHeight>original.height)fail('Native tile index exceeds its atlas');
  const oldId=ts.imageId,shared=doc.tilesets.some(other=>other.id!==ts.id&&(other.imageId===oldId||other.tiles?.some(t=>t.imageId===oldId)))||doc.frames.some(f=>Object.values(f.cels).some(c=>c.imageId===oldId));let imageId=oldId;if(shared){reserve(doc,original.pixels.length);imageId=fresh(doc,'image');ts.imageId=imageId;for(const t of ts.tiles)if(t.imageId===oldId)t.imageId=imageId;}
  const atlas={...original,pixels:[...original.pixels]};for(let yy=0;yy<ts.tileHeight;yy++)for(let xx=0;xx<ts.tileWidth;xx++)atlas.pixels[(y+yy)*atlas.width+x+xx]=pixels[yy*ts.tileWidth+xx];doc.images[imageId]=atlas;tile.imageId=imageId;tile.sourceRect={x,y,width:ts.tileWidth,height:ts.tileHeight};
 }else{const shared=doc.tilesets.some(other=>other.tiles?.some(t=>t!==tile&&t.imageId===tile.imageId))||doc.frames.some(f=>Object.values(f.cels).some(c=>c.imageId===tile.imageId));const imageId=shared?fresh(doc,'image'):tile.imageId;if(shared)reserve(doc,pixels.length);doc.images[imageId]={width:ts.tileWidth,height:ts.tileHeight,pixels};tile.imageId=imageId;delete tile.sourceRect;}
}
function paintTilemap(doc,c){
 const layer=layerFor(doc,c.layerId,true);if(layer.type!=='tilemap')fail('Tile painting requires a tilemap layer');const frame=frameFor(doc,c.frameId),ts=doc.tilesets.find(t=>t.id===(c.tilesetId??layer.tilemaps?.[frame.id]?.tilesetId??layer.tilesetId));if(!ts)fail('Tileset missing');const previous=layer.tilemaps?.[frame.id]??nativeMap(doc,layer,frame,ts),columns=integer(c.columns??previous?.columns??Math.ceil(doc.width/ts.tileWidth),'Tile columns',1,2048),rows=integer(c.rows??previous?.rows??Math.ceil(doc.height/ts.tileHeight),'Tile rows',1,2048);if(columns*rows>1048576)fail('Tilemap too large');const cells=Array(columns*rows).fill(null);
 if(previous)for(let y=0;y<Math.min(rows,previous.rows);y++)for(let x=0;x<Math.min(columns,previous.columns);x++)cells[y*columns+x]=previous.cells[y*previous.columns+x];if(!Array.isArray(c.points)||c.points.length>65536)fail('Invalid tile paint points');for(const p of c.points){const x=integer(p.x,'Tile x',0,columns-1),y=integer(p.y,'Tile y',0,rows-1);cells[y*columns+x]=p.tileId==null?null:{tileId:id(p.tileId),flipX:!!p.flipX,flipY:!!p.flipY,rotate:p.rotate??0};}
 const map={...(previous??{}),tilesetId:ts.id,columns,rows,cells};validateTilemap(doc,map);layer.tilemaps={...(layer.tilemaps??{}),[frame.id]:map};layer.tilesetId=ts.id;
}

function stampImage(doc,c,changed){const width=integer(c.width,'Stamp width',1,LIMITS.imageEdge),height=integer(c.height,'Stamp height',1,LIMITS.imageEdge);if(width*height>LIMITS.pixels||!Array.isArray(c.pixels)||c.pixels.length!==width*height)fail('Stamp pixels size mismatch');const x0=integer(c.x??0,'Stamp x',-65535,65535),y0=integer(c.y??0,'Stamp y',-65535,65535),opacity=finite(c.opacity??1,'Stamp opacity',0,1),transparent=c.transparent??'skip';if(!['skip','replace'].includes(transparent))fail('Invalid transparent-pixel mode');const ctx=context(doc,c,changed),pixels=c.pixels.map(p=>encodeColor(ctx.doc,p));for(let y=Math.max(0,-y0);y<Math.min(height,doc.height-y0);y++)for(let x=Math.max(0,-x0);x<Math.min(width,doc.width-x0);x++){const source=pixels[y*width+x];if(source===null){if(transparent==='replace')ctx.put(x+x0,y+y0,null);continue;}if(c.blend===false&&opacity===1)ctx.put(x+x0,y+y0,source);else{const out=new Uint8ClampedArray(pixelRGBA(ctx.doc,ctx.get(x+x0,y+y0)));blendAt(out,0,pixelRGBA(ctx.doc,source),opacity,'normal');ctx.put(x+x0,y+y0,encodeColor(ctx.doc,hex([...out])));}}}
function removeUnusedTile(doc,tileset,tileId){
 if(!tileId)return;
 const used=new Set();
 for(const layer of doc.layers)if(layer.type==='tilemap')for(const frame of doc.frames){
  const map=layer.tilemaps?.[frame.id]??(layer.tilesetId===tileset.id?nativeMap(doc,layer,frame,tileset):null);
  if(map?.tilesetId===tileset.id)for(const cell of map.cells)if(cell)used.add(cell.tileId);
 }
 if(used.has(tileId))return;
 const removed=tileset.tiles.find(tile=>tile.id===tileId);if(!removed)return;
 const hasNativeAtlas=!!tileset.imageId&&Number.isInteger(tileset.asepriteId);
 if(!hasNativeAtlas){tileset.tiles=tileset.tiles.filter(tile=>tile.id!==tileId);gcImages(doc);return;}
 // Resolve every remaining native map before changing atlas indices. Stable editor
 // tile IDs survive the conversion; export regenerates the native numeric IDs.
 for(const layer of doc.layers)if(layer.type==='tilemap'&&layer.tilesetId===tileset.id)for(const frame of doc.frames){
  if(layer.tilemaps?.[frame.id])continue;const map=nativeMap(doc,layer,frame,tileset);
  if(map)layer.tilemaps={...(layer.tilemaps??{}),[frame.id]:map};
 }
 const remaining=tileset.tiles.filter(tile=>tile.id!==tileId&&!((tileset.flags&4)&&tile.asepriteTileId===0&&!used.has(tile.id)));
 const plans=remaining.map(tile=>({tile,pixels:getTile(doc,tileset.id,tile.id).pixels}));
 const tileUserData=tileset.tileUserData;
 tileset.tiles=[];delete tileset.imageId;delete tileset.tileCount;delete tileset.externalFileId;delete tileset.externalTilesetId;
 tileset.flags=((tileset.flags??0)|6)&~1;
 if(tileUserData)tileset.tileUserData=[null,...remaining.map(tile=>tileUserData[tile.asepriteTileId]??null)];
 gcImages(doc);
 for(const {tile,pixels}of plans){
  reserve(doc,pixels.length);const imageId=fresh(doc,'image');doc.images[imageId]={width:tileset.tileWidth,height:tileset.tileHeight,pixels};
  const copy={...tile,imageId};delete copy.sourceRect;delete copy.asepriteTileId;tileset.tiles.push(copy);
 }
}
function editTilemap(doc,c){
 const layer=layerFor(doc,c.layerId,true);if(layer.type!=='tilemap')fail('Tile editing requires a tilemap layer');
 const frame=frameFor(doc,c.frameId),ts=doc.tilesets.find(t=>t.id===(layer.tilemaps?.[frame.id]?.tilesetId??layer.tilesetId));if(!ts)fail('Tileset missing');
 const map=layer.tilemaps?.[frame.id]??nativeMap(doc,layer,frame,ts);if(!map)fail('Paint an initial tilemap cell before editing tiles');
 const x=integer(c.x,'Tile x',0,map.columns-1),y=integer(c.y,'Tile y',0,map.rows-1),mode=c.mode??'auto';if(!['manual','auto','stack'].includes(mode))fail('Tile edit mode must be manual, auto, or stack');
 if(!Array.isArray(c.pixels)||c.pixels.length!==ts.tileWidth*ts.tileHeight)fail('Tile pixel dimensions mismatch');
 const working=colorContext(doc,frame.id,layer.id),pixels=c.pixels.map(p=>encodeColor(working,p)),previous=map.cells[y*map.columns+x];let tile;
 if(mode==='manual'){
  tile=ts.tiles.find(t=>t.id===previous?.tileId);if(!tile)fail('Manual editing requires a nonempty tile');const source=doc.images[tile.imageId];
  if(tile.sourceRect){const r=tile.sourceRect,updated=[...source.pixels];for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++)updated[(r.y+y)*source.width+r.x+x]=pixels[Math.min(ts.tileHeight-1,Math.floor(y*ts.tileHeight/r.height))*ts.tileWidth+Math.min(ts.tileWidth-1,Math.floor(x*ts.tileWidth/r.width))];doc.images[tile.imageId]={...source,pixels:updated};}
  else{reserve(doc,pixels.length,tile.imageId);doc.images[tile.imageId]={...source,width:ts.tileWidth,height:ts.tileHeight,pixels};}
  return;
 }
 const empty=mode==='auto'&&pixels.every(pixel=>pixelRGBA(working,pixel)[3]===0);
 if(!empty){
  if(mode==='auto')tile=ts.tiles.find(t=>getTile(doc,ts.id,t.id).pixels.every((p,i)=>p===pixels[i]));
  if(!tile){
   if(mode==='auto'&&previous?.tileId){const cleared=[...map.cells];cleared[y*map.columns+x]=null;layer.tilemaps={...(layer.tilemaps??{}),[frame.id]:{...map,cells:cleared}};removeUnusedTile(doc,ts,previous.tileId);}
   if(ts.tiles.length>=65536)fail('Tileset limit reached');reserve(doc,pixels.length);const imageId=fresh(doc,'image');doc.images[imageId]={width:ts.tileWidth,height:ts.tileHeight,pixels};
   let n=1;while(ts.tiles.some(t=>t.id===`tile-${n}`))n++;tile={id:`tile-${n}`,imageId};ts.tiles.push(tile);
  }
 }
 const cells=[...map.cells];cells[y*map.columns+x]=tile?{tileId:tile.id,flipX:previous?.flipX??false,flipY:previous?.flipY??false,rotate:previous?.rotate??0}:null;
 layer.tilemaps={...(layer.tilemaps??{}),[frame.id]:{...map,cells}};
 if(mode==='auto'&&previous?.tileId!==tile?.id)removeUnusedTile(doc,ts,previous?.tileId);
}

function duplicateLayer(doc,c){const source=layerFor(doc,c.layerId),ids=new Set([source.id]);let again=true;while(again){again=false;for(const l of doc.layers)if(ids.has(l.parentId)&&!ids.has(l.id)){ids.add(l.id);again=true;}}const originals=doc.layers.filter(l=>ids.has(l.id));if(doc.layers.length+originals.length>LIMITS.layers)fail('Layer limit reached');const copies=[],idMap=new Map(),imageMap=new Map();for(const l of originals){const copy={...jsonCopy(l),id:fresh(doc,'layer'),name:l.id===source.id?name(c.name,`${l.name} copy`):l.name};idMap.set(l.id,copy.id);doc.layers.push(copy);copies.push(copy);}for(const copy of copies)if(idMap.has(copy.parentId))copy.parentId=idMap.get(copy.parentId);doc.layers=doc.layers.filter(l=>!copies.includes(l));const at=doc.layers.indexOf(originals.at(-1))+1;doc.layers.splice(at,0,...copies);
 for(const frame of doc.frames)for(const original of originals){const cel=frame.cels[original.id];if(!cel)continue;let imageId=cel.imageId;if(!c.linked){if(imageMap.has(imageId))imageId=imageMap.get(imageId);else{const image=doc.images[imageId],key=fresh(doc,'image');reserve(doc,image.width*image.height);doc.images[key]={...image,pixels:[...image.pixels],...(image.tilemap?{tilemap:jsonCopy(image.tilemap)}:{})};imageMap.set(imageId,key);imageId=key;}}frame.cels[idMap.get(original.id)]={...cel,imageId};}
}
function descendantIds(doc,rootIds){
 const ids=new Set(rootIds);let added=true;
 while(added){added=false;for(const layer of doc.layers)if(ids.has(layer.parentId)&&!ids.has(layer.id)){ids.add(layer.id);added=true;}}
 return ids;
}
function rasterLayer(source,patch={}){
 const layer={...source,...patch,type:'image'};
 delete layer.tilemaps;delete layer.tilesetId;delete layer.asepriteTilesetIndex;delete layer.reference;
 if(layer.asepriteFlags!==undefined)layer.asepriteFlags&=~64;
 return layer;
}
/** Bake selected whole layer subtrees, preserving off-canvas artwork and frame links.
 * Root blend/opacity can stay on the replacement, or be baked against transparency.
 * Non-normal blends that depend on unselected backdrop layers cannot be reproduced
 * by an isolated normal layer; Merge Down matches that native editor convention. */
function bakeLayerTrees(doc,rootIds,replacement,{forceRootsVisible=false,preserveRootStyle=false}={}){
 const included=descendantIds(doc,rootIds),rootSet=new Set(rootIds),source=shallowDocument(doc);
 for(const layerId of included)layerFor(doc,layerId,true);
 const sourceLayers=source.layers.filter(layer=>included.has(layer.id));
 const renderLayers=sourceLayers.map(layer=>rootSet.has(layer.id)?{...layer,parentId:null,visible:forceRootsVisible||layer.visible,...(preserveRootStyle?{opacity:1,blendMode:'normal'}:{})}:layer);
 const byId=new Map(renderLayers.map(layer=>[layer.id,layer]));
 function visible(layer){for(let item=layer;item;item=item.parentId?byId.get(item.parentId):null)if(!item.visible||item.opacity===0)return false;return true;}
 const visibleLayers=renderLayers.filter(visible),cache=new Map(),linkCache=new Map();let work=0;
 const insertion=source.layers.findIndex(layer=>layer.id===replacement.id);
 if(insertion<0)fail('Flatten replacement layer is missing');
 doc.layers=source.layers.filter(layer=>!included.has(layer.id));
 doc.layers.splice(source.layers.slice(0,insertion).filter(layer=>!included.has(layer.id)).length,0,replacement);
 for(const frame of doc.frames)for(const layerId of included)delete frame.cels[layerId];
 gcImages(doc);
 for(const frame of doc.frames){
  const originalFrame=frameFor(source,frame.id),palette=getFramePalette(source,frame.id);
  const sourceLinks=sourceLayers.map(layer=>[layer.id,originalFrame.cels[layer.id]??null,layer.tilemaps?.[frame.id]??null]),linkSignature=JSON.stringify(sourceLinks);
  const signature=JSON.stringify([source.colorMode==='indexed'?palette:null,sourceLinks]);
  if(cache.has(signature)){const cel=cache.get(signature);if(cel)frame.cels[replacement.id]={...cel};continue;}
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  function addBounds(x,y,width,height){if(width<=0||height<=0)return;left=Math.min(left,Math.floor(x));top=Math.min(top,Math.floor(y));right=Math.max(right,Math.ceil(x+width));bottom=Math.max(bottom,Math.ceil(y+height));}
  for(const layer of visibleLayers){
   if(layer.type==='group')continue;
   const cel=originalFrame.cels[layer.id],image=source.images[cel?.imageId];
   if(layer.type==='tilemap'){
    const map=layer.tilemaps?.[frame.id],tileset=source.tilesets.find(ts=>ts.id===(map?.tilesetId??layer.tilesetId));
    if(!tileset)fail('Cannot flatten a tilemap with a missing tileset');
    if(!tileset.tiles?.length&&!tileset.imageId&&tileset.externalFileId!=null)fail('Embed external tileset pixels before flattening');
    if(map)addBounds(map.x??0,map.y??0,map.columns*tileset.tileWidth,map.rows*tileset.tileHeight);
    else if(image)addBounds(cel.x,cel.y,image.width*tileset.tileWidth,image.height*tileset.tileHeight);
   }else if(image){const bounds=cel.preciseBounds;if(bounds?.flags&1)addBounds(bounds.x,bounds.y,bounds.width,bounds.height);else addBounds(cel.x,cel.y,image.width,image.height);}
  }
  if(left===Infinity){cache.set(signature,null);continue;}
  const width=right-left,height=bottom-top;
  integer(width,'Flattened image width',1,LIMITS.imageEdge);integer(height,'Flattened image height',1,LIMITS.imageEdge);
  if(width*height>LIMITS.pixels)fail('Flattened layer exceeds the pixel budget','MEMORY_BUDGET');
  work+=width*height*Math.max(1,visibleLayers.filter(layer=>layer.type!=='group').length);
  if(work>LIMITS.operations)fail('Flatten operation exceeds the work budget','MEMORY_BUDGET');
  const cels={};
  for(const layer of sourceLayers){const cel=originalFrame.cels[layer.id];if(cel)cels[layer.id]={...cel,x:cel.x-left,y:cel.y-top,...(cel.preciseBounds?{preciseBounds:{...cel.preciseBounds,x:cel.preciseBounds.x-left,y:cel.preciseBounds.y-top}}:{})};}
  const shiftedLayers=renderLayers.map(layer=>{
   const map=layer.tilemaps?.[frame.id];return map?{...layer,tilemaps:{[frame.id]:{...map,x:(map.x??0)-left,y:(map.y??0)-top}}}:layer;
  });
  const renderDoc={...source,width,height,palette,layers:shiftedLayers,frames:[{...originalFrame,palette,cels}]};
  const rgbaPixels=renderFrame(renderDoc,frame.id);let minX=width,minY=height,maxX=-1,maxY=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(rgbaPixels[(y*width+x)*4+3]){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  if(maxX<0){cache.set(signature,null);continue;}
  const outputWidth=maxX-minX+1,outputHeight=maxY-minY+1,pixels=Array(outputWidth*outputHeight),working=colorContext({...source,layers:source.layers.map(layer=>layer.id===replacement.id?replacement:layer)},frame.id,replacement.id);
  for(let y=0;y<outputHeight;y++)for(let x=0;x<outputWidth;x++){const offset=((y+minY)*width+x+minX)*4;pixels[y*outputWidth+x]=rgbaPixels[offset+3]?encodeColor(working,hex([...rgbaPixels.subarray(offset,offset+4)])):null;}
  const x=integer(left+minX,'Flattened cel x',-65535,65535),y=integer(top+minY,'Flattened cel y',-65535,65535);
  const linked=linkCache.get(linkSignature)??[];
  let imageId=linked.find(candidate=>candidate.x===x&&candidate.y===y&&candidate.width===outputWidth&&candidate.height===outputHeight&&candidate.pixels.every((pixel,index)=>pixel===pixels[index]))?.imageId;
  if(!imageId){reserve(doc,pixels.length);imageId=fresh(doc,'image');doc.images[imageId]={width:outputWidth,height:outputHeight,pixels};linked.push({imageId,x,y,width:outputWidth,height:outputHeight,pixels});linkCache.set(linkSignature,linked);}
  const previous=originalFrame.cels[replacement.id],cel={...(previous?.userData?{userData:jsonCopy(previous.userData)}:{}),imageId,x,y,opacity:1};
  frame.cels[replacement.id]=cel;cache.set(signature,cel);
 }
}
function mergeDown(doc,c){
 if(c.visibleOnly!==undefined&&typeof c.visibleOnly!=='boolean')fail('visibleOnly must be a boolean');
 const upper=layerFor(doc,c.layerId,true),at=doc.layers.indexOf(upper),lower=[...doc.layers.slice(0,at)].reverse().find(layer=>layer.parentId===upper.parentId);
 if(!lower)fail('No lower sibling layer to merge');
 const visibleOnly=c.visibleOnly===true,replacement=rasterLayer(lower,{name:name(c.name,lower.name),opacity:1,blendMode:'normal',visible:visibleOnly?(lower.visible||upper.visible):lower.visible});
 bakeLayerTrees(doc,[lower.id,upper.id],replacement,{forceRootsVisible:!visibleOnly});
}
function flattenLayer(doc,c){
 const layer=layerFor(doc,c.layerId,true),replacement=rasterLayer(layer,{name:name(c.name,layer.name)});
 bakeLayerTrees(doc,[layer.id],replacement,{forceRootsVisible:true,preserveRootStyle:true});
}
function flattenDocument(doc,c){
 if(c.visibleOnly!==undefined&&typeof c.visibleOnly!=='boolean')fail('visibleOnly must be a boolean');
 const visibleOnly=c.visibleOnly!==false,roots=doc.layers.filter(layer=>layer.parentId===null&&(!visibleOnly||layer.visible));
 if(!roots.length)return;
 const first=roots[0],replacement=rasterLayer(first,{name:name(c.name,'Flattened'),visible:true,opacity:1,blendMode:'normal'});
 if(replacement.asepriteFlags!==undefined)replacement.asepriteFlags&=~8;
 bakeLayerTrees(doc,roots.map(layer=>layer.id),replacement);
}

/** A failed command never changes its input. Untouched image objects retain identity. */
export function applyCommand(input,command){
 if(!record(command)||typeof command.type!=='string')fail('Command type is missing','INVALID_COMMAND');if(input?.format!=='pixelwall-document'||input.version!==4)fail('Normalize the document before editing');const doc=shallowDocument(input),c=command,changed=new Set();
 switch(c.type){
 case'batch':{if(!Array.isArray(c.commands)||c.commands.length>1024)fail('Invalid command batch');let result=input;for(const command of c.commands)result=applyCommand(result,command);return result;}
 case'object.userData':{let target;if(c.target==='sprite')target=doc;else if(c.target==='layer')target=layerFor(doc,c.layerId,true);else if(c.target==='cel'){const layer=layerFor(doc,c.layerId,true);target=frameFor(doc,c.frameId).cels[layer.id];}else if(c.target==='tileset'||c.target==='tile'){const ts=doc.tilesets.find(t=>t.id===c.tilesetId);if(!ts)fail('Tileset missing');assertTilesetEditable(doc,ts.id);if(c.target==='tileset')target=ts;else{const slots=tilesetSlots(doc,ts),index=integer(c.tileIndex,'Tile index',0,slots.count-1);ts.tileUserData=[...(ts.tileUserData??[])];const userData=validateAsepriteUserData(c.userData);ts.tileUserData[index]=userData;target=slots.entries.get(index);if(target)target.userData=userData;break;}}else if(c.target==='tag')target=doc.clips.find(v=>v.id===c.clipId);else if(c.target==='slice')target=doc.slices.find(v=>v.id===c.sliceId);else fail('Unsupported user-data target');if(!target)fail('User-data target missing');target.userData=validateAsepriteUserData(c.userData);break;}
 case'document.update':{if(!record(c.patch))fail('Document patch missing');for(const key of Object.keys(c.patch))if(!['name','metadata'].includes(key))fail(`Document field ${key} cannot be patched`);if(c.patch.name!==undefined)doc.name=name(c.patch.name,'Untitled Sprite');if(c.patch.metadata!==undefined)doc.metadata=jsonCopy(c.patch.metadata);break;}
 case'document.colorProfile':{applyColorProfileCommand(doc,c);break;}
 case'document.resize':resizeDocument(doc,c);break;
 case'document.nativeColorMode':{convertNativeColorMode(doc,c,{limits:LIMITS,getFramePalette});break;}
 case'palette.nativeSet':{setNativePalette(doc,c,{normalizeColor});break;}
 case'palette.nativeGenerate':{generateNativePalette(doc,c,{limits:LIMITS,normalizeColor,renderFrame});break;}
 case'document.colorMode':{const configured=['paletteMode','maxColors','quantization','withAlpha','dithering','ditherMatrix','ditherStrength','rgbmap','fitCriteria'].some(key=>own(c,key));if(configured&&c.colorMode!=='indexed')fail('Palette generation and dithering require indexed color mode');convertColorMode(doc,c.colorMode,configured?{indexedOptions:indexedConversionOptions(c)}:{});break;}
 case'layer.add':{const v=c.layer??{};const layer={id:v.id??fresh(doc,'layer'),name:v.name??`Layer ${doc.layers.length+1}`,type:v.type??'image',parentId:v.parentId??null,visible:v.visible!==false,locked:!!v.locked,opacity:v.opacity??1,blendMode:v.blendMode??'normal',...jsonCopy(v)};if(layer.parentId)layerFor(doc,layer.parentId,true);if(doc.layers.some(l=>l.id===layer.id))fail('Layer id exists');const index=integer(c.index??doc.layers.length,'Layer index',0,doc.layers.length);doc.layers.splice(index,0,layer);break;}
 case'layer.update':{const layer=layerFor(doc,c.layerId);if(!record(c.patch))fail('Layer patch missing');for(const key of Object.keys(c.patch))if(!['name','parentId','visible','locked','opacity','blendMode','reference','tilesetId'].includes(key))fail(`Layer field ${key} cannot be patched`);Object.assign(layer,jsonCopy(c.patch));break;}
 case'layer.reorder':{const layer=layerFor(doc,c.layerId,true),index=integer(c.index,'Layer index',0,doc.layers.length-1);doc.layers.splice(doc.layers.indexOf(layer),1);doc.layers.splice(index,0,layer);break;}
 case'layer.duplicate':duplicateLayer(doc,c);break;
 case'layer.mergeDown':mergeDown(doc,c);break;
 case'layer.flatten':flattenLayer(doc,c);break;
 case'document.flatten':flattenDocument(doc,c);break;
 case'layer.remove':{const layer=layerFor(doc,c.layerId,true),remove=new Set([layer.id]);let again=true;while(again){again=false;for(const l of doc.layers)if(remove.has(l.parentId)&&!remove.has(l.id)){remove.add(l.id);again=true;}}if(remove.size===doc.layers.length)fail('Document must retain a layer');doc.layers=doc.layers.filter(l=>!remove.has(l.id));for(const f of doc.frames)for(const key of remove)delete f.cels[key];break;}
 case'frame.add':{if(doc.frames.length>=LIMITS.frames)fail('Frame limit reached');const after=c.afterFrameId?doc.frames.indexOf(frameFor(doc,c.afterFrameId)):doc.frames.length-1,newId=c.id??fresh(doc,'frame');if(doc.frames.some(f=>f.id===newId))fail('Frame id exists');doc.frames.splice(after+1,0,{id:newId,durationMs:integer(c.durationMs??125,'Duration',1,65535),cels:{}});if(c.clipId){const clip=doc.clips.find(clip=>clip.id===c.clipId);if(!clip)fail('Clip missing');const pos=clip.frameIds.indexOf(c.afterFrameId);clip.frameIds.splice(pos<0?clip.frameIds.length:pos+1,0,newId);}break;}
 case'frame.duplicate':{const frames=targetFrames(doc,c);if(doc.frames.length+frames.length>LIMITS.frames)fail('Frame limit reached');let at=c.afterFrameId?doc.frames.indexOf(frameFor(doc,c.afterFrameId)):doc.frames.indexOf(frames.at(-1));for(const f of frames){const fid=fresh(doc,'frame'),cels={};for(const [lid,cel]of Object.entries(f.cels)){if(c.linked)cels[lid]={...cel};else{const source=doc.images[cel.imageId];reserve(doc,source.width*source.height);const imageId=fresh(doc,'image');doc.images[imageId]={...source,pixels:[...source.pixels],...(source.tilemap?{tilemap:jsonCopy(source.tilemap)}:{})};cels[lid]={...cel,imageId};}}doc.frames.splice(++at,0,{...f,id:fid,cels});for(const layer of doc.layers)if(layer.tilemaps?.[f.id])layer.tilemaps={...layer.tilemaps,[fid]:jsonCopy(layer.tilemaps[f.id])};if(c.clipId){const clip=doc.clips.find(v=>v.id===c.clipId);if(!clip)fail('Clip missing');clip.frameIds.push(fid);}}break;}
 case'frame.update':{if(!record(c.patch)||Object.keys(c.patch).some(k=>!['durationMs','name','pivot'].includes(k)))fail('Invalid frame patch');for(const f of targetFrames(doc,c))Object.assign(f,jsonCopy(c.patch));break;}
 case'frame.reorder':{const frames=targetFrames(doc,c),selected=new Set(frames.map(f=>f.id)),others=doc.frames.filter(f=>!selected.has(f.id)),index=integer(c.index,'Frame insertion index',0,others.length);others.splice(index,0,...frames);doc.frames=others;break;}
 case'frame.reverse':{const frames=targetFrames(doc,c),ids=new Set(frames.map(f=>f.id)),reverse=[...frames].reverse();let i=0;doc.frames=doc.frames.map(f=>ids.has(f.id)?reverse[i++]:f);break;}
 case'frame.remove':{const ids=new Set(targetFrames(doc,c).map(f=>f.id));if(ids.size===doc.frames.length)fail('Document must retain a frame');doc.frames=doc.frames.filter(f=>!ids.has(f.id));doc.slices=doc.slices.map(s=>s.keys?{...s,keys:s.keys.filter(k=>!ids.has(k.frameId))}:s);doc.clips=doc.clips.map(clip=>({...clip,frameIds:clip.frameIds.filter(fid=>!ids.has(fid))})).filter(clip=>clip.frameIds.length);for(const layer of doc.layers)if(layer.tilemaps){layer.tilemaps={...layer.tilemaps};for(const fid of ids)delete layer.tilemaps[fid];}break;}
 case'cel.set':setCel(doc,c);break;
 case'image.stamp':stampImage(doc,c,changed);break;
 case'cel.link':{const layer=layerFor(doc,c.layerId,true),source=frameFor(doc,c.sourceFrameId).cels[layer.id];if(!source)fail('Source cel is empty');for(const f of targetFrames(doc,c))f.cels[layer.id]={...source};break;}
 case'cel.unlink':{const layer=layerFor(doc,c.layerId,true);for(const f of targetFrames(doc,c)){const cel=f.cels[layer.id];if(!cel)continue;const source=doc.images[cel.imageId];reserve(doc,source.width*source.height);const key=fresh(doc,'image');doc.images[key]={...source,pixels:[...source.pixels],...(source.tilemap?{tilemap:jsonCopy(source.tilemap)}:{})};cel.imageId=key;}break;}
 case'cel.move':{const layer=layerFor(doc,c.layerId,true);for(const f of targetFrames(doc,c)){const cel=f.cels[layer.id];if(!cel)continue;cel.x=integer(c.x??cel.x,'Cel x',-65535,65535);cel.y=integer(c.y??cel.y,'Cel y',-65535,65535);if(c.opacity!==undefined)cel.opacity=finite(c.opacity,'Cel opacity',0,1);if(c.zIndex!==undefined)cel.zIndex=integer(c.zIndex,'Cel z-index',-2147483648,2147483647);}break;}
 case'cel.clear':{const layer=layerFor(doc,c.layerId,true);for(const f of targetFrames(doc,c))delete f.cels[layer.id];break;}
 case'draw.stroke':drawStroke(context(doc,c,changed),points(c.points),c);break;
 case'draw.line':drawStroke(context(doc,c,changed),[point(c.from),point(c.to)],c);break;
 case'draw.rect':drawShape(context(doc,c,changed),c,false);break;
 case'draw.ellipse':drawShape(context(doc,c,changed),c,true);break;
 case'draw.polygon':drawPolygon(context(doc,c,changed),c);break;
 case'draw.curve':drawCurve(context(doc,c,changed),c);break;
 case'draw.fill':{const ctx=context(doc,c,changed),mask=floodMask(ctx.doc,ctx.get,c),color=encodeColor(ctx.doc,(c.color===undefined?ctx.doc.palette[0]:c.color));for(let i=0;i<mask.length;i++)if(mask[i])ctx.put(i%doc.width,Math.floor(i/doc.width),color);break;}
 case'draw.gradient':gradient(context(doc,c,changed),c);break;
 case'draw.text':drawText(context(doc,c,changed),c);break;
 case'selection.transform':selectionTransform(doc,c,changed);break;
 case'selection.clear':{const ctx=context(doc,c,changed);if(!ctx.mask)fail('Clear selection requires a selection mask');for(let y=0;y<doc.height;y++)for(let x=0;x<doc.width;x++)ctx.put(x,y,null);break;}
 case'palette.update':paletteEdit(doc,c,false);break;
 case'palette.remap':paletteEdit(doc,c,true);break;
 case'effect.apply':applyEffect(doc,c,changed);break;
 case'animation.tween':tween(doc,c);break;
 case'animation.particles':particles(doc,c,changed);break;
 case'tileset.add':addTileset(doc,c);break;
 case'tileset.create':createNativeTileset(doc,c,{fresh,reserve,limits:LIMITS});break;
 case'tileset.tileInsert':case'tileset.tileRemove':changeTilesetSlots(doc,c,{fresh,reserve,limits:LIMITS});break;
 case'layer.tileset':assignLayerTileset(doc,c,{fresh,reserve,limits:LIMITS,layerFor});break;
 case'tileset.tileImage':replaceTilesetImage(doc,c);break;
 case'tileset.update':{const ts=doc.tilesets.find(t=>t.id===c.tilesetId);if(!ts)fail('Tileset missing');assertTilesetEditable(doc,ts.id);if(c.patch?.baseIndex!==undefined)integer(c.patch.baseIndex,'Tileset base index',-32768,32767);if(!record(c.patch)||Object.keys(c.patch).some(k=>!['name','tileWidth','tileHeight','tiles','imageId','baseIndex'].includes(k)))fail('Invalid tileset patch');Object.assign(ts,jsonCopy(c.patch));break;}
 case'tileset.remove':{if(doc.layers.some(l=>l.tilesetId===c.tilesetId||Object.values(l.tilemaps??{}).some(m=>m.tilesetId===c.tilesetId)))fail('Cannot remove a tileset used by a layer');if(!doc.tilesets.some(t=>t.id===c.tilesetId))fail('Tileset missing');doc.tilesets=doc.tilesets.filter(t=>t.id!==c.tilesetId);break;}
 case'tilemap.paint':paintTilemap(doc,c);break;
 case'tilemap.edit':editTilemap(doc,c);break;
 case'clip.add':{const v=c.clip??{};doc.clips.push({id:v.id??fresh(doc,'clip'),name:v.name??'Animation',frameIds:v.frameIds??doc.frames.map(f=>f.id),direction:v.direction??'forward',loop:v.loop!==false});break;}
 case'clip.update':{const clip=doc.clips.find(v=>v.id===c.clipId);if(!clip)fail('Clip missing');if(!record(c.patch)||Object.keys(c.patch).some(k=>!['name','frameIds','direction','loop','repeat','color'].includes(k)))fail('Invalid clip patch');Object.assign(clip,jsonCopy(c.patch));break;}
 case'clip.remove':{if(!doc.clips.some(v=>v.id===c.clipId))fail('Clip missing');doc.clips=doc.clips.filter(v=>v.id!==c.clipId);break;}
 case'slice.add':{const v=c.slice??{};doc.slices.push({...jsonCopy(v),id:v.id??fresh(doc,'slice'),name:v.name??'Slice'});break;}
 case'slice.update':{const s=doc.slices.find(v=>v.id===c.sliceId);if(!s)fail('Slice missing');if(!record(c.patch)||Object.keys(c.patch).some(k=>!['name','bounds','pivot','ninePatch','keys'].includes(k)))fail('Invalid slice patch');Object.assign(s,jsonCopy(c.patch));if(c.patch.keys!==undefined)delete s.bounds;break;}
 case'slice.remove':{if(!doc.slices.some(v=>v.id===c.sliceId))fail('Slice missing');doc.slices=doc.slices.filter(v=>v.id!==c.sliceId);break;}
 default:fail(`Unknown command: ${c.type}`,'UNKNOWN_COMMAND');
 }
 gcImages(doc);return normalizeDocument(doc,{shareImages:true});
}

const TARGET={frameId:'Optional frame id; defaults to first frame.',layerId:'Optional raster layer id; defaults to first image layer.'};
const RANGE={frameIds:'Nonempty list of unique frame ids; or pass frameId for one frame.'};
const DRAW={...TARGET,color:'Hex RGB/RGBA string, palette index, or null (transparent).',selection:'Optional canvas-size array of 0/1; restricts affected pixels.'};
const STROKE={...DRAW,size:'Integer 1–256 (default 1).',brush:'square | circle',mask:'Optional {width,height,pixels:[0|1],colors?:[RGBA|null]}; maximum 256×256.',symmetry:'none | x | y | both',wrap:'none | x | y | both; true is both. Wraps brush pixels and line paths for seamless tiles.',pressure:'false ignores point pressures; true or omitted uses supplied point pressures.',pixelPerfect:'Boolean; removes 1px orthogonal corners along the sampled path.',erase:'Boolean; stamps transparency.',ink:'paint | lighten | darken | shading',amount:'Lighten/darken amount 0–1 (default .12).',ramp:'Shading ink: ordered palette-index or color array; defaults to the active frame palette.',shadeStep:'Shading ink: signed steps along ramp; default -1. Endpoints clamp; unlisted colors are unchanged.'};
/** Machine-readable public catalog. Every listed command is executable. */
export const COMMANDS=Object.freeze([
 ['batch','Apply an ordered command list atomically.',{commands:'Array of up to 1024 command objects.'}],
 ['object.userData','Replace native user data on a sprite, layer, cel, tag, slice, tileset or tile.',{target:'sprite | layer | cel | tag | slice | tileset | tile',tilesetId:'Tileset/tile target ID',tileIndex:'Zero-based native tile index',layerId:'Layer target ID',frameId:'Cel frame ID',clipId:'Tag target ID',sliceId:'Slice target ID',userData:'{text?,color?:#rrggbbaa,propertiesBytes?:native property block}'}],
 ['document.update','Rename the document or replace metadata.',{patch:'{name?:string,metadata?:object}'}],
 ['document.colorProfile','Assign a working profile or apply a bounded precomputed color conversion.',{profile:'{type:0|1|2,flags?:0|1,gamma?:number,icc?:byte[],name?:string}',replacements:'Optional validated images/palette/framePalettes; preserves dimensions, IDs, links, layers and color mode.'}],
 ['document.resize','Resize canvas or nearest-neighbor artwork.',{width:'Integer 1–65535; width × height ≤ 4194304',height:'Integer 1–65535; width × height ≤ 4194304',mode:'canvas | scale',anchor:'top-left | center (canvas mode)'}],
 ['document.nativeColorMode','Convert native pixel format with first-exposure image links, indexed cel-opacity reset and grayscale palette reset.',{colorMode:'rgba | grayscale | indexed',rgbmap:'octree (default) | rgb5a3',fitCriteria:'default | rgb | linearizedRGB | ciexyz | cielab',dithering:'none | aseprite-ordered | aseprite-old | aseprite-error-diffusion',ditherMatrix:'bayer2x2 | bayer4x4 | bayer8x8',toGray:'luma | hsv | hsl'}],
 ['palette.nativeSet','Replace one existing effective palette key without remapping pixels.',{frameId:'Frame using the palette key; defaults first',paletteFrameIds:'Optional ordered existing key frames',palette:'1–256 RGBA colors'}],
 ['palette.nativeGenerate','Generate a palette from all visible frames and replace the active palette key without remapping pixels.',{frameId:'Active frame',paletteFrameIds:'Optional ordered existing key frames',algorithm:'octree (default) | rgb5a3',maxColors:'2–256, default 256',withAlpha:'Boolean, default true',colors:'Optional sorted selected palette entries; empty means no-op'}],
 ['document.colorMode','Convert pixel storage between working color modes.',{colorMode:'rgba | indexed | grayscale',paletteMode:'existing (default) | generate; supplying indexed options enables explicit indexed remapping.',maxColors:'Generated palette limit 2–256, including transparent slot; default 256.',quantization:'median-cut (default, stored artwork) | octree | rgb5a3 (native algorithms sampling visible composited frames).',rgbmap:'pixelwall (legacy default) | octree | rgb5a3; native quantization/dithering defaults to octree.',fitCriteria:'default | rgb | linearizedRGB | ciexyz | cielab; non-default fitting requires a native RGB map.',withAlpha:'Generated palette retains partial alpha unless false; transparent pixels remain transparent.',dithering:'none | ordered | floyd-steinberg | aseprite-ordered | aseprite-old | aseprite-error-diffusion; legacy/native modes require matching RGB map.',ditherMatrix:'bayer2x2 | bayer4x4 (default) | bayer8x8',ditherStrength:'0–1, default 1; native ordered/old require 1; native diffusion uses integer percentage strength.'}],
 ['layer.add','Insert image, group, reference, or tilemap layer.',{layer:'{id?,name?,type?,parentId?,visible?,locked?,opacity?,blendMode?}',index:'Optional bottom-to-top insertion index.'}],
 ['layer.update','Update layer properties.',{layerId:'Layer id',patch:'{name?,parentId?,visible?,locked?,opacity?,blendMode?,reference?,tilesetId?}'}],
 ['layer.reorder','Move a layer within bottom-to-top order.',{layerId:'Layer id',index:'Zero-based destination index.'}],
 ['layer.duplicate','Duplicate a layer or group hierarchy with independent image copies.',{layerId:'Layer id',name:'Optional duplicate name',linked:'True shares original image objects; false preserves linking only within the copied hierarchy.'}],
 ['layer.mergeDown','Bake two adjacent sibling subtrees into the lower raster layer across all frames.',{layerId:'Upper image/group/reference/tilemap layer id.',visibleOnly:'Default false includes both root layers regardless of visibility and retains lower visibility, matching native Merge Down. True uses current root visibility.',name:'Optional result name. Root blend modes/opacity bake against transparency, so blends depending on an outside backdrop may change appearance; use document.flatten for the whole visible composite.'}],
 ['layer.flatten','Rasterize one layer or group across all frames, retaining root visibility, opacity and blend mode.',{layerId:'Image/group/reference/tilemap root. Visible descendants are baked; hidden descendants are removed with the flattened subtree.',name:'Optional result name. Off-canvas pixels and equal-source frame links are retained within document budgets.'}],
 ['document.flatten','Bake the visible document composite into one normal raster layer across all frames.',{visibleOnly:'Default true retains hidden root layers separately. False removes hidden root layers as well, without adding their hidden pixels to the result.',name:'Optional result name; default Flattened.'}],
 ['layer.remove','Remove a layer and all descendants.',{layerId:'Layer id; at least one layer must remain.'}],
 ['frame.add','Insert an empty animation frame.',{id:'Optional new id',afterFrameId:'Optional preceding frame id',durationMs:'1–65535; default125',clipId:'Optional clip receiving the frame.'}],
 ['frame.duplicate','Duplicate a frame range with independent or shared images.',{...RANGE,frameId:'Single frame id',afterFrameId:'Optional insertion anchor',linked:'Boolean; default false',clipId:'Optional clip to append duplicates to.'}],
 ['frame.update','Change duration or metadata for a frame range.',{...RANGE,frameId:'Single frame id',patch:'{durationMs?:1–65535,name?:string,pivot?:object}'}],
 ['frame.reorder','Move a frame range to an insertion index.',{...RANGE,index:'Index among unselected frames.'}],
 ['frame.reverse','Reverse the selected animation frames.',RANGE],
 ['frame.remove','Remove frames and repair clips/tilemaps.',RANGE],
 ['cel.set','Import or replace a cel with decoded pixels.',{...TARGET,width:'Image width',height:'Image height',pixels:'Flat RGBA|null|palette-index array, width×height',x:'Optional integer offset',y:'Optional integer offset',opacity:'0–1',editLinked:'False by default; true replaces the shared image.'}],
 ['image.stamp','Paste image pixels into an existing cel.',{...DRAW,width:'Stamp width',height:'Stamp height',pixels:'Flat decoded RGBA|null|palette-index array.',x:'Destination left; default0',y:'Destination top; default0',transparent:'skip (default) | replace',blend:'true (default) composites source-over; false replaces pixels.',opacity:'0–1; default1'}],
 ['cel.link','Reference one cel image from multiple frames.',{...RANGE,layerId:'Layer id',sourceFrameId:'Frame containing the source cel.'}],
 ['cel.unlink','Give selected cels independent images.',{...RANGE,layerId:'Layer id'}],
 ['cel.move','Change cel offsets, opacity or drawing order across frames.',{...RANGE,layerId:'Layer id',x:'Integer -65535…65535',y:'Integer -65535…65535',opacity:'Optional 0–1',zIndex:'Optional signed 32-bit integer; portable sprite files require -32768…32767'}],
 ['cel.clear','Remove cels from selected frames.',{...RANGE,layerId:'Layer id'}],
 ['draw.stroke','Paint a pressure-aware freehand path with custom brush and symmetry.',{...STROKE,points:'Array of {x,y,pressure?:0–1}.'}],
 ['draw.line','Draw a straight pixel line.',{...STROKE,from:'{x,y}',to:'{x,y}'}],
 ['draw.rect','Draw a rectangle.',{...DRAW,x:'Integer left',y:'Integer top',width:'Positive width',height:'Positive height',filled:'Boolean',size:'Outline thickness1–256'}],
 ['draw.ellipse','Draw an ellipse.',{...DRAW,x:'Integer left',y:'Integer top',width:'Positive width',height:'Positive height',filled:'Boolean',size:'Outline thickness1–256'}],
 ['draw.polygon','Draw a closed polygon or its filled interior.',{...STROKE,points:'2–4096 vertices {x,y}; at least3 for fill.',filled:'Boolean'}],
 ['draw.curve','Rasterize quadratic or cubic Bézier curve.',{...STROKE,points:'[start,control,end] or [start,control1,control2,end].'}],
 ['draw.fill','Flood fill matching connected pixels or all matching colors.',{...DRAW,x:'Seed x',y:'Seed y',tolerance:'Channel tolerance0–255',contiguous:'Boolean; default true'}],
 ['draw.gradient','Paint an RGBA gradient or ordered two-color Bayer dither.',{...DRAW,from:'{x,y}',to:'{x,y}',endColor:'Ending color',dither:'Boolean; default false'}],
 ['draw.text','Rasterize text with included 5×7 bitmap font or custom glyphs.',{...DRAW,x:'Text x',y:'Text y',text:'Up to4096 characters',scale:'Integer1–64',spacing:'Glyph spacing0–64',lineHeight:'Line advance1–128',font:'Optional {width,height,glyphs:{character:[0|1]}}.'}],
 ['selection.transform','Move, scale, rotate, flip, or copy a masked raster region.',{...TARGET,selection:'Canvas-size array of0/1; required.',operation:'move | scale | rotate | flipX | flipY',dx:'Translation pixels',dy:'Translation pixels',scaleX:'Scale .01–64',scaleY:'Scale .01–64',angle:'Clockwise degrees',method:'nearest (default; Fast rotation alias) | fast | rotsprite | pixel-safe (RotSprite alias). Fast/RotSprite are rotation-only; RotSprite uses the MIT native8× algorithm. Temporary owned buffers limited to64MiB. Corner coordinates are rounded to the pixel grid.',pivot:'Optional {x,y}; defaults to selection center.',copy:'False moves/cuts, true copies.'}],
 ['selection.clear','Erase pixels under a mask.',{...TARGET,selection:'Canvas-size array of0/1; required.'}],
 ['palette.update','Edit scoped palette entries; indexed pixels retain their indices.',{palette:'1–65536 RGBA hex colors. Cannot remove used indexed entries.',scope:'all (default with no selectors) | frame | range',frameId:'Frame for frame scope; defaults to the first frame. A frameId without scope infers frame.',frameIds:'Nonempty unique frame IDs for range scope. frameIds without scope infers range.'}],
 ['palette.remap','Replace scoped palettes and remap pixels in their effective color context.',{palette:'New RGBA palette.',mapping:'Optional old-index→new-index array; null clears that entry. Must cover every selected old palette. Omit to find nearest colors.',scope:'all (default with no selectors) | frame | range',frameId:'Frame for frame scope; defaults first. Inferred when provided without scope.',frameIds:'Nonempty unique frame IDs for range scope; inferred when provided without scope.'}],
 ['effect.apply','Apply destructive raster effect to selected unique images.',{...DRAW,...RANGE,effect:'replace | outline | brightness | contrast | hue | saturation | convolution | despeckle',fromColor:'Replace source color; omit to replace all opaque pixels.',toColor:'Replacement color.',amount:'Brightness/saturation -1…1; contrast -.99….99; hue degrees-360…360.',radius:'Outline radius1–64',diagonal:'Boolean, default true.',kernel:'Odd square numeric array, up to15×15.',divisor:'Optional nonzero convolution divisor.',bias:'Optional convolution RGB bias-255…255.',affectAlpha:'Convolve alpha as well.'}],
 ['animation.tween','Bake or link reusable deterministic 2D position/opacity tween.',{...RANGE,layerId:'Raster layer id',sourceFrameId:'Optional source cel frame.',from:'{x?,y?,opacity?}',to:'{x?,y?,opacity?}',easing:'linear | easeIn | easeOut | easeInOut | bounce',bake:'Default true creates independent images; false links images.',id:'Optional reusable preset key in metadata.motion.'}],
 ['animation.particles','Bake deterministic 2D particle simulation into cels.',{...RANGE,layerId:'Image layer id',seed:'Unsigned32-bit integer',count:'1–4096',x:'Emitter x',y:'Emitter y',speed:'Pixels/second0–4096',angle:'Emission direction degrees (default -90)',spread:'Cone width0–360 degrees',gravity:'Pixels/second²',lifetime:'Seconds.01–3600',emission:'Emission interval in seconds',color:'RGBA or palette index',size:'1–64',fade:'Boolean; default true',clear:'Replace target cels unless false.',id:'Optional reusable preset key in metadata.motion.'}],
 ['tileset.add','Create an independent tileset from images or tile pixels.',{frameId:'Optional frame palette used to encode tile colors.',layerId:'Optional layer for transparent-index semantics.',tileset:'{id?,name?,tileWidth,tileHeight,tiles:[{id?,imageId}|{id?,pixels}]}'}],
 ['tileset.create','Create an embedded native tileset, optionally copying a same-document resource.',{tilesetId:'Optional ID',tileWidth:'Positive tile width',tileHeight:'Positive tile height',tileCount:'Count including tile zero; default 1',copyTilesetId:'Optional source tileset',gridOrigin:'Optional in-memory {x,y} origin'}],
 ['tileset.tileInsert','Insert tile artwork at an index; native Lua leaves map numbers unchanged.',{tilesetId:'Tileset ID',tileIndex:'Index 1 through count; default append'}],
 ['tileset.tileRemove','Delete tile artwork at an index; native Lua leaves map numbers unchanged.',{tilesetId:'Tileset ID',tileIndex:'Index 1 through count minus one'}],
 ['layer.tileset','Assign a tileset to one layer, retaining map numbers, flags and positions.',{layerId:'Tilemap layer ID',tilesetId:'Destination tileset ID'}],
 ['tileset.tileImage','Replace a tile image while retaining native tile IDs, placements and linked maps.',{tilesetId:'Tileset id',tileIndex:'Zero-based native tile index',width:'Exact tile grid width',height:'Exact tile grid height',pixels:'Exact native-mode raster pixels'}],
 ['tileset.update','Update independent tileset properties and references.',{tilesetId:'Tileset id',patch:'{name?,tileWidth?,tileHeight?,tiles?,imageId?,baseIndex?}'}],
 ['tileset.remove','Remove a tileset unused by layers.',{tilesetId:'Tileset id'}],
 ['tilemap.paint','Paint independently referenced tiles into a frame tilemap.',{...TARGET,tilesetId:'Tileset id; defaults to existing map.',columns:'Optional tile grid width',rows:'Optional tile grid height',points:'[{x,y,tileId:string|null,flipX?,flipY?,rotate?:0|90|180|270}]'}],
 ['tilemap.edit','Edit intrinsic tile pixels in manual, automatic reuse, or stack mode.',{...TARGET,x:'Tile column',y:'Tile row',pixels:'Complete tileWidth×tileHeight decoded color array.',mode:'manual edits the shared tile; auto reuses/adds tiles and removes the replaced tile when no frame/layer uses it; stack retains prior tiles. Auto transparent pixels clear the cell. Cell transforms are preserved.'}],
 ['clip.add','Create an animation tag/clip.',{clip:'{id?,name?,frameIds?,direction?:forward|reverse|pingpong|pingpong_reverse,loop?}'}],
 ['clip.update','Update an animation tag/clip.',{clipId:'Clip id',patch:'{name?,frameIds?,direction?,loop?,repeat?:0–65535,color?}'}],
 ['clip.remove','Remove an animation tag/clip.',{clipId:'Clip id'}],
 ['slice.add','Create an export slice with optional pivot and nine-patch.',{slice:'{id?,name?,bounds:{x,y,width,height},pivot?,ninePatch?}'}],
 ['slice.update','Update a slice.',{sliceId:'Slice id',patch:'{name?,bounds?,pivot?,ninePatch?,keys?}'}],
 ['slice.remove','Remove a slice.',{sliceId:'Slice id'}],
].map(([type,description,parameters])=>Object.freeze({type,description,parameters:Object.freeze(parameters)})));

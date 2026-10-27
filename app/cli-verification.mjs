/** Read-only decoded output evidence. Never interprets a checksum as proof of editability. */
import {createHash} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {readPng,readBmp,readTga,readAseprite,importGif} from './formats.mjs';
import {decodeProjectContainer} from './project-format.mjs';
import {normalizeDocument,renderFrame} from './editor-core.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyOutputFile(path) {
  const file=resolve(path),info=await stat(file);
  if(!info.isFile()||info.size>64*1024*1024)throw Error('Verification requires a regular file up to 64 MiB.');
  const bytes=new Uint8Array(await readFile(file)),extension=extname(file).toLowerCase();
  const result={format:'pixelwall-verification',version:1,file,bytes:bytes.length,sha256:digest(bytes)};
  let image,document;
  if(extension==='.png') image=readPng(bytes);
  else if(extension==='.bmp') image=readBmp(bytes);
  else if(extension==='.tga') image=readTga(bytes);
  else if(extension==='.gif')document=importGif(bytes).document;
  else if(['.ase','.aseprite'].includes(extension))document=readAseprite(bytes).document;
  else if(extension==='.zip')return {...result,valid:true,kind:'archive',verification:'checksum-only',decoded:false};
  else {
    const raw=decodeProjectContainer(bytes);
    if(extension==='.json'&&raw?.format!=='pixelwall-document')return {...result,valid:true,kind:'metadata',decoded:true};
    document=normalizeDocument(raw);
  }
  if(image) {
    const rgba=image.rgba??image.data;
    if(!rgba||rgba.length!==image.width*image.height*4)throw Error('Decoded image dimensions do not match its pixels.');
    return {...result,valid:true,decoded:true,kind:'image',width:image.width,height:image.height,frames:1,hasTransparency:rgba.some((value,index)=>index%4===3&&value<255),pixelSha256:digest(rgba)};
  }
  document=normalizeDocument(document);
  if(document.width*document.height*document.frames.length>64*1024*1024)throw Error('Decoded frame verification exceeds 64 million pixels; verify a smaller clip.');
  const frameEvidence=document.frames.map(frame=>{const rgba=renderFrame(document,frame.id);return {id:frame.id,durationMs:frame.durationMs,pixelSha256:digest(rgba),hasTransparency:rgba.some((value,index)=>index%4===3&&value<255)};});
  return {...result,valid:true,decoded:true,kind:extension==='.gif'?'animation':'project',documentId:document.id,width:document.width,height:document.height,frames:document.frames.length,layers:document.layers.length,clips:document.clips.map(clip=>({id:clip.id,name:clip.name,frameIds:clip.frameIds})),frameEvidence};
}

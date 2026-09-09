/** ICC color transforms. Pixel data stays in the document's working profile;
 * canvas/export callers explicitly request sRGB. LittleCMS owns the conversion. */
import { normalizeDocument, renderFrame, normalizeColor } from './editor-core.mjs';

const MAX_PROFILE_BYTES = 4 * 1024 * 1024;
const SRGB = Object.freeze({ type: 1, flags: 0, gamma: 0 });
const bytesOf = value => {
  if (!(value instanceof Uint8Array) && !Array.isArray(value)) throw Error('Choose an ICC profile file.');
  if (value.length < 132 || value.length > MAX_PROFILE_BYTES) throw Error('ICC profile must contain 132 bytes to 4 MB.');
  if (Array.isArray(value) && value.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw Error('Invalid ICC profile bytes.');
  const bytes = Uint8Array.from(value), view = new DataView(bytes.buffer);
  if (String.fromCharCode(...bytes.subarray(36, 40)) !== 'acsp' || view.getUint32(0) !== bytes.length) throw Error('Invalid ICC profile header or length.');
  const count = view.getUint32(128);
  if (count > 4096 || 132 + count * 12 > bytes.length) throw Error('Invalid ICC tag table.');
  for (let i = 0; i < count; i++) {
    const offset = view.getUint32(136 + i * 12), length = view.getUint32(140 + i * 12);
    if (offset < 128 || offset + length > bytes.length) throw Error('ICC tag extends beyond the profile.');
  }
  return bytes;
};
export function documentProfile(doc) { return doc.metadata?.aseprite?.colorProfile ?? SRGB; }
export function isSRGB(profile) { return !profile || profile === 'sRGB' || (profile.type !== 2 && !(profile.flags & 1)); }

/** Matrix/TRC profile with sRGB primaries and a fixed transfer exponent.
 * ICC v2 XYZ/curve tags, D50-adapted colorants; useful for Aseprite fixed gamma. */
export function createGammaProfile(gamma = 1) {
  if (!Number.isFinite(gamma) || gamma < 0.1 || gamma > 10) throw Error('Gamma must be between 0.1 and 10.');
  const enc = new TextEncoder(), tags = [], tag = (sig, data) => tags.push({sig,data});
  const xyz = values => { const b = new Uint8Array(20), v = new DataView(b.buffer); b.set(enc.encode('XYZ ')); values.forEach((n,i)=>v.setInt32(8+i*4,Math.round(n*65536))); return b; };
  const curve = new Uint8Array(16), cv = new DataView(curve.buffer); curve.set(enc.encode('curv')); cv.setUint32(8,1); cv.setUint16(12,Math.round(gamma*256));
  const label = enc.encode(`PixelWall sRGB primaries gamma ${gamma}\0`), description = new Uint8Array(12+label.length+78), dv=new DataView(description.buffer); description.set(enc.encode('desc')); dv.setUint32(8,label.length); description.set(label,12);
  tag('desc',description); tag('wtpt',xyz([0.9642,1,0.8249]));
  tag('rXYZ',xyz([0.4360747,0.2225045,0.0139322])); tag('gXYZ',xyz([0.3850649,0.7168786,0.0971045])); tag('bXYZ',xyz([0.1430804,0.0606169,0.7141733]));
  for(const sig of ['rTRC','gTRC','bTRC'])tag(sig,curve);
  const copyright=enc.encode('text\0\0\0\0PixelWall generated profile. CC0.\0'); tag('cprt',copyright);
  let offset=132+tags.length*12; for(const t of tags){t.offset=offset;offset+=Math.ceil(t.data.length/4)*4;}
  const bytes=new Uint8Array(offset), view=new DataView(bytes.buffer); view.setUint32(0,offset);view.setUint32(8,0x02100000);
  for(const [at,s]of [[12,'mntr'],[16,'RGB '],[20,'XYZ '],[36,'acsp'],[40,'APPL'],[80,'PWAL']])bytes.set(enc.encode(s),at);
  [2026,1,1,0,0,0].forEach((n,i)=>view.setUint16(24+i*2,n)); [0.9642,1,0.8249].forEach((n,i)=>view.setInt32(68+i*4,Math.round(n*65536))); view.setUint32(128,tags.length);
  tags.forEach((t,i)=>{const at=132+i*12;bytes.set(enc.encode(t.sig),at);view.setUint32(at+4,t.offset);view.setUint32(at+8,t.data.length);bytes.set(t.data,t.offset);});return bytes;
}

export function createColorManager(lcms, constants) {
  const profiles=new Map(), transforms=new Map(); let disposed=false, profileSequence=0;
  function clearTransforms() { for (const handle of transforms.values()) lcms.cmsDeleteTransform(handle); transforms.clear(); }
  function profileInfo(profile=SRGB) {
    if(disposed)throw Error('Color manager has been closed.');
    if(profile==='sRGB')profile=SRGB;
    let key='sRGB',bytes;
    if(profile?.type===2){bytes=bytesOf(profile.icc);const chunks=[];for(let at=0;at<bytes.length;at+=16384)chunks.push(String.fromCharCode(...bytes.subarray(at,at+16384)));key=chunks.join('');}
    else if(profile?.flags&1){bytes=createGammaProfile(profile.gamma);key=`gamma:${profile.gamma}`;}
    if(profiles.has(key)){const info=profiles.get(key);profiles.delete(key);profiles.set(key,info);return info;}
    const handle=bytes?lcms.cmsOpenProfileFromMem(bytes,bytes.length):lcms.cmsCreate_sRGBProfile();
    if(!handle)throw Error('LittleCMS could not read this ICC profile.');
    const space=lcms.cmsGetColorSpaceASCII(handle);
    if(!['RGB','GRAY'].includes(space)){lcms.cmsCloseProfile(handle);throw Error(`A ${space||'non-RGB'} profile cannot be used with this sprite.`);}
    const info={key,token:++profileSequence,handle,space,name:bytes?lcms.cmsGetProfileInfoASCII(handle,constants.cmsInfoDescription,'en','US')||'Embedded ICC profile':'sRGB'};
    if(profiles.size>=8){clearTransforms();const oldest=profiles.keys().next().value;lcms.cmsCloseProfile(profiles.get(oldest).handle);profiles.delete(oldest);}
    profiles.set(key,info);return info;
  }
  function transformRGBA(input, source=SRGB, destination=SRGB, {intent=1,blackPointCompensation=true}={}) {
    if(!ArrayBuffer.isView(input)||input.length%4)throw Error('Color conversion expects RGBA bytes.');
    if(!Number.isInteger(intent)||intent<0||intent>3)throw Error('Choose a valid rendering intent.');
    const src=profileInfo(source),dst=profileInfo(destination);
    if(src.key===dst.key)return Uint8ClampedArray.from(input);
    const key=`${src.token}>${dst.token}:${intent}:${blackPointCompensation}`;
    let handle=transforms.get(key);
    if(!handle){if(transforms.size>=128)clearTransforms();handle=lcms.cmsCreateTransform(src.handle,src.space==='GRAY'?constants.TYPE_GRAY_8:constants.TYPE_RGB_8,dst.handle,dst.space==='GRAY'?constants.TYPE_GRAY_8:constants.TYPE_RGB_8,intent,blackPointCompensation?constants.cmsFLAGS_BLACKPOINTCOMPENSATION:0);if(!handle)throw Error('This ICC profile does not support the requested conversion.');transforms.set(key,handle);}
    const channels=src.space==='GRAY'?1:3,count=input.length/4,packed=new Uint8Array(count*channels);
    for(let i=0;i<count;i++)for(let c=0;c<channels;c++)packed[i*channels+c]=input[i*4+c];
    const converted=lcms.cmsDoTransform(handle,packed,count),out=new Uint8ClampedArray(input.length),outChannels=dst.space==='GRAY'?1:3;
    for(let i=0;i<count;i++){for(let c=0;c<3;c++)out[i*4+c]=converted[i*outChannels+(outChannels===1?0:c)];out[i*4+3]=input[i*4+3];}return out;
  }
  function transformColors(colors,source,destination,options){
    const packed=new Uint8Array(colors.length*4);colors.forEach((color,i)=>{const s=normalizeColor(color);for(let c=0;c<4;c++)packed[i*4+c]=parseInt(s.slice(1+c*2,3+c*2),16);});
    const converted=transformRGBA(packed,source,destination,options);return colors.map((_,i)=>'#'+Array.from(converted.subarray(i*4,i*4+4),c=>c.toString(16).padStart(2,'0')).join(''));
  }
  function assignProfile(input,profile=SRGB){
    const doc=normalizeDocument(input),info=profileInfo(profile);
    if(info.space==='GRAY'&&doc.colorMode!=='grayscale')throw Error('A gray profile requires a grayscale document.');
    const cp=profile==='sRGB'?SRGB:profile;
    doc.metadata.aseprite={...doc.metadata.aseprite,colorProfile:structuredClone(cp)};
    return doc;
  }
  function convertDocument(input,profile=SRGB,options){
    const source=documentProfile(input),destination=profileInfo(profile),doc=assignProfile(input,profile);
    if(destination.space==='RGB'&&doc.colorMode==='grayscale'&&!isSRGB(profile))doc.colorMode='rgba';
    doc.palette=transformColors(doc.palette,source,profile,options);
    for(const frame of doc.frames)if(frame.palette)frame.palette=transformColors(frame.palette,source,profile,options);
    if(doc.colorMode!=='indexed')for(const image of Object.values(doc.images))if(!image.tilemap){const palette=[...new Set(image.pixels.filter(p=>p!==null))],converted=transformColors(palette,source,profile,options),lookup=new Map(palette.map((p,i)=>[p,converted[i]]));image.pixels=image.pixels.map(p=>p===null?null:lookup.get(p));}
    if(doc.colorMode==='grayscale'&&Object.values(doc.images).some(image=>!image.tilemap&&image.pixels.some(p=>p!==null&&(p.slice(1,3)!==p.slice(3,5)||p.slice(3,5)!==p.slice(5,7)))))doc.colorMode='rgba';
    return normalizeDocument(doc);
  }
  return Object.freeze({
    profileInfo:profile=>{const {space,name}=profileInfo(profile);return {space,name};},
    readProfile(bytes){const profile={type:2,flags:0,gamma:0,icc:Array.from(bytesOf(bytes))};profileInfo(profile);return profile;},
    transformRGBA,transformColors,assignProfile,convertDocument,
    displayFrame:(doc,frameId)=>transformRGBA(renderFrame(doc,frameId),documentProfile(doc)),
    displayColor:(doc,color)=>transformColors([color],documentProfile(doc),SRGB)[0],
    workingColor:(doc,color)=>transformColors([color],SRGB,documentProfile(doc))[0],
    close(){if(disposed)return;for(const handle of transforms.values())lcms.cmsDeleteTransform(handle);for(const {handle}of profiles.values())lcms.cmsCloseProfile(handle);transforms.clear();profiles.clear();disposed=true;},
  });
}

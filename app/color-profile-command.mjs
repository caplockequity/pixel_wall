/** Pure command validation. Color transforms are computed in a bounded worker;
 * the shared engine replays only profile/pixel/palette changes, never a snapshot. */
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw Error(`Color profile: ${message}`); };
function fields(value, allowed, label) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`Invalid ${label}.`);
}
export function normalizeColorProfile(input = {type:1,flags:0,gamma:0}) {
  if (input === 'sRGB') input = {type:1,flags:0,gamma:0};
  fields(input, ['type','flags','gamma','icc','name'], 'profile');
  const {type,flags=0,gamma=0} = input;
  if (![0,1,2].includes(type) || ![0,1].includes(flags) || flags && type !== 1 || !Number.isFinite(gamma) || gamma < 0 || gamma > 10 || flags && gamma < 0.1) fail('Unsupported profile type, flags or gamma.');
  const profile = {type,flags,gamma};
  if (own(input,'name')) {
    if (typeof input.name !== 'string' || input.name.includes('\0') || new TextEncoder().encode(input.name).length > 4096) fail('Profile names must be text of at most 4096 bytes.');
    profile.name = input.name;
  }
  if (type === 2) {
    const data=input.icc;
    if (!Array.isArray(data) || data.length < 132 || data.length > 4*1024*1024 || data.some(value=>!Number.isInteger(value)||value<0||value>255)) fail('ICC data must contain 132 bytes to 4 MB.');
    const bytes=Uint8Array.from(data),view=new DataView(bytes.buffer);
    if (view.getUint32(0)!==bytes.length || String.fromCharCode(...bytes.subarray(36,40))!=='acsp') fail('Invalid ICC header.');
    if(!['RGB ','GRAY'].includes(String.fromCharCode(...bytes.subarray(16,20))))fail('Only RGB and grayscale ICC profiles are supported.');
    const count=view.getUint32(128);if(count>4096||132+count*12>bytes.length)fail('Invalid ICC tag table.');
    for(let i=0;i<count;i++){const start=view.getUint32(136+i*12),length=view.getUint32(140+i*12);if(start<128||start+length>bytes.length)fail('ICC tag lies outside the profile.');}
    profile.icc=[...data];
  } else if (own(input,'icc')) fail('Only embedded ICC profiles can contain ICC data.');
  return profile;
}
function colors(value, length, mode, label) {
  if (!Array.isArray(value) || value.length!==length) fail(`${label} must keep its original length.`);
  return value.map(color=>{
    if(color===null && label==='Image pixels')return null;
    if(typeof color!=='string'||!/^#[\da-f]{8}$/i.test(color))fail(`${label} must contain RGBA colors.`);
    color=color.toLowerCase();
    if(mode==='grayscale'&&(color.slice(1,3)!==color.slice(3,5)||color.slice(3,5)!==color.slice(5,7)))fail('Grayscale conversion must keep equal RGB channels.');
    return color.slice(7)==='00'&&label==='Image pixels'?null:color;
  });
}
export function applyColorProfileCommand(document, command) {
  fields(command,['type','profile','replacements','frameId','layerId'],'profile command');
  const profile=normalizeColorProfile(command.profile);
  if(profile.type===2 && String.fromCharCode(...profile.icc.slice(16,20))==='GRAY' && document.colorMode!=='grayscale')fail('A gray profile requires a grayscale sprite.');
  if(document.layers.some(layer=>layer.locked))fail('Unlock every layer before changing the working color profile.');
  const changes=command.replacements;
  if(changes!==undefined){
    fields(changes,['images','palette','framePalettes'],'conversion changes');
    const raster=Object.entries(document.images).filter(([,image])=>!image.tilemap);
    if(document.colorMode==='indexed'){
      if(changes.images!==undefined && (!Array.isArray(changes.images)||changes.images.length))fail('Indexed conversion must preserve pixel indices.');
    }else{
      if(!Array.isArray(changes.images)||changes.images.length!==raster.length)fail('Conversion must include every existing raster image once.');
      const seen=new Set();
      for(const entry of changes.images){fields(entry,['id','pixels'],'image replacement');const image=document.images[entry.id];if(typeof entry.id!=='string'||!own(document.images,entry.id)||!image||image.tilemap||seen.has(entry.id))fail('Conversion contains an invalid or duplicate image ID.');seen.add(entry.id);document.images[entry.id]={...image,pixels:colors(entry.pixels,image.width*image.height,document.colorMode,'Image pixels')};}
    }
    if(document.colorMode==='grayscale'){
      if(own(changes,'palette')||own(changes,'framePalettes'))fail('Grayscale conversion must preserve palettes.');
    }else{
      document.palette=colors(changes.palette,document.palette.length,'rgba','Palette');
      const frames=document.frames.filter(frame=>frame.palette);
      if(!Array.isArray(changes.framePalettes)||changes.framePalettes.length!==frames.length)fail('Conversion must preserve every frame palette.');
      const seen=new Set();for(const entry of changes.framePalettes){fields(entry,['frameId','palette'],'frame palette replacement');const frame=frames.find(frame=>frame.id===entry.frameId);if(!frame||seen.has(entry.frameId))fail('Invalid or duplicate frame palette.');seen.add(entry.frameId);frame.palette=colors(entry.palette,frame.palette.length,'rgba','Frame palette');}
    }
  }
  document.metadata.aseprite={...document.metadata.aseprite,colorProfile:profile};
}

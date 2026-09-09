import { normalizeColorProfile } from './color-profile-command.mjs';

export const LUA_COLOR_SPACE_NOT_HANDLED = Symbol('not a color-space operation');
export function needsLuaColorManager(request) {
  const profile=request.document?.metadata?.aseprite?.colorProfile;
  return profile?.type===2 || !!(profile?.flags&1);
}
const same=(a,b)=>a.type===b.type&&(a.type===0||a.type===2? a.type===0||a.icc.length===b.icc.length&&a.icc.every((byte,index)=>byte===b.icc[index]) : a.flags===b.flags&&(!(a.flags&1)||Math.abs(a.gamma-b.gamma)<=1/2048));
const automaticName=profile=>profile.type===0?'None':profile.type===2?'Custom Profile':!(profile.flags&1)?'sRGB':profile.gamma===1?'Linear Transfer with sRGB Gamut':Math.abs(profile.gamma-2.2)<1/2048?'2.2 Transfer with sRGB Gamut':'Custom Profile';

/** Profile values remain detached in the worker. The Lua side receives opaque
 * handles, so ICC bytes never expand into editable Lua arrays or filesystem paths. */
export function createLuaColorSpaces({ref,getRef,doc,flush,mutate,retireRasterImages,colorManager}) {
  let count=0, profileBytes=0;
  const normalized=new WeakMap(), retained=new WeakSet(), defaultProfile={type:1,flags:0,gamma:0};
  function profileOf(document){
    const value=document.metadata?.aseprite?.colorProfile??defaultProfile;
    if(value&&typeof value==='object') {if(!normalized.has(value))normalized.set(value,normalizeColorProfile(value));return normalized.get(value);}
    return normalizeColorProfile(value);
  }
  function make(profile,name='') {
    if(++count>512)throw Error('Lua ColorSpace value limit exceeded.');
    if(!retained.has(profile)){profileBytes+=profile.icc?.length??0;if(profileBytes>8*1024*1024)throw Error('Lua ColorSpace profile byte budget exceeded.');retained.add(profile);}
    return ref('ColorSpace',{profile,name});
  }
  function checked(value){return getRef(value,'ColorSpace');}
  function validate(profile){
    if(profile.type===2 || profile.flags&1){if(!colorManager)throw Error('This script requires the bundled color-management runtime.');colorManager.profileInfo(profile);}
    return profile;
  }
  function change(sprite,target,convert){
    const destination=checked(target),id=getRef(sprite,'Sprite').docId;
    flush();const before=doc(id),source=profileOf(before),profile=normalizeColorProfile({...destination.profile,name:destination.name||automaticName(destination.profile)});
    validate(source);validate(profile);
    const command={type:'document.colorProfile',profile};
    if(convert && source.type!==0 && profile.type!==0 && !same(source,profile)){
      if(!colorManager)throw Error('This script requires the bundled color-management runtime.');
      // Match Sprite conversion without changing storage mode. Grayscale retains
      // its palette; indexed sprites retain every original index and image link.
      const transform=colors=>colorManager.transformColors(colors,source,profile);
      const changes={},celImages=new Set(before.frames.flatMap(frame=>Object.values(frame.cels).map(cel=>cel.imageId)));
      if(before.colorMode!=='indexed')changes.images=Object.entries(before.images).filter(([,image])=>!image.tilemap).map(([imageId,image])=>{
        if(!celImages.has(imageId))return {id:imageId,pixels:[...image.pixels]};
        const unique=[...new Set(image.pixels.filter(pixel=>pixel!==null))],converted=transform(unique),lookup=new Map(unique.map((pixel,index)=>[pixel,converted[index]]));
        return {id:imageId,pixels:image.pixels.map(pixel=>pixel===null?null:lookup.get(pixel))};
      });
      if(before.colorMode!=='grayscale'){
        changes.palette=transform(before.palette);
        changes.framePalettes=before.frames.filter(frame=>frame.palette).map(frame=>({frameId:frame.id,palette:transform(frame.palette)}));
      }
      command.replacements=changes;
    }
    mutate(id,command);if(convert&&before.colorMode!=='indexed')retireRasterImages(id);return target;
  }
  return {
    capture(value){const holder=checked(value);return {profile:holder.profile,name:holder.name};},
    fromValue(value){return make(value.profile,value.name);},
    sameValues(left,right){return same(left.profile,right.profile);},
    documentValue(document){const profile=validate(profileOf(document));return {profile,name:profile.name||automaticName(profile)};},
    create(options){
      if(options.source){const source=checked(options.source);return make(source.profile,source.name);}
      return make({type:options.srgb?1:0,flags:0,gamma:0});
    },
    equal(left,right){return same(checked(left).profile,checked(right).profile);},
    get(target,key){
      if(target.__kind==='ColorSpace') {if(key!=='name')throw Error(`Unsupported ColorSpace.${key}.`);return checked(target).name;}
      if(target.__kind==='Sprite'&&key==='colorSpace'){const profile=validate(profileOf(doc(getRef(target,'Sprite').docId)));return make(profile,profile.name||automaticName(profile));}
      return LUA_COLOR_SPACE_NOT_HANDLED;
    },
    set(target,key,value){
      if(target.__kind==='ColorSpace'){
        if(key!=='name')throw Error(`Unsupported ColorSpace.${key}.`);
        const holder=checked(target);if(typeof value==='string')holder.name=normalizeColorProfile({...holder.profile,name:value}).name;
        return;
      }
      if(target.__kind==='Sprite'&&key==='colorSpace')return change(target,value,false);
      return LUA_COLOR_SPACE_NOT_HANDLED;
    },
    method(target,name,args){
      if(target.__kind==='Sprite'&&['assignColorSpace','convertColorSpace'].includes(name)){
        if(args.length!==1)throw Error(`Sprite:${name} requires one ColorSpace.`);
        return change(target,args[0],name==='convertColorSpace');
      }
      return LUA_COLOR_SPACE_NOT_HANDLED;
    },
  };
}

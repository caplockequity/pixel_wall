/** Worker-local value semantics. Specs and per-image profile hints never grant
 * file access or change a document outside the ordinary command transaction. */
export const LUA_SPEC_NOT_HANDLED=Symbol('not an image specification operation');
const MODES={rgba:0,grayscale:1,indexed:2};
const modeNames=['rgba','grayscale','indexed'];
const NONE=Object.freeze({profile:Object.freeze({type:0,flags:0,gamma:0}),name:''});
const int=(value,label)=>{const n=typeof value==='number'||typeof value==='string'?Number(value):0;if(!Number.isFinite(n)||Math.floor(n)<-2147483648||Math.floor(n)>2147483647)throw Error(`${label} must fit a signed 32-bit integer.`);return Math.floor(n);};
const maskInt=value=>{const n=typeof value==='number'||typeof value==='string'?Number(value):0;if(!Number.isFinite(n)||Math.floor(n)<-2147483648||Math.floor(n)>4294967295)throw Error('Transparent color must fit a 32-bit pixel.');return Math.floor(n)>>>0;};
export function createLuaImageSpecs({ref,getRef,image,doc,colorSpaces,limits}){
  let values=0;let overrides=new Map();
  const key=(docId,imageId)=>JSON.stringify([docId,imageId]);
  function make(spec){if(++values>2048)throw Error('Lua ImageSpec value limit exceeded.');return ref('ImageSpec',{spec:{...spec}});}
  function checked(value){return getRef(value,'ImageSpec').spec;}
  function imageDescriptor(value){
    if(!value.docId)return {profile:value.specProfile??NONE,transparentColor:value.transparentColor??0};
    const override=overrides.get(key(value.docId,value.imageId));
    return {profile:value.tilesetId?NONE:override?.profile??colorSpaces.documentValue(doc(value.docId)),transparentColor:override?.transparentColor??doc(value.docId).metadata?.aseprite?.transparentIndex??0};
  }
  function fromImage(value){const descriptor=imageDescriptor(value);return {width:value.width,height:value.height,colorMode:MODES[value.colorMode],...descriptor};}
  function fromSprite(value){const d=doc(getRef(value,'Sprite').docId);return {width:d.width,height:d.height,colorMode:MODES[d.colorMode],transparentColor:d.metadata?.aseprite?.transparentIndex??0,profile:colorSpaces.documentValue(d)};}
  function create(options={}){
    if(options.source)return make(checked(options.source));
    // Table colorSpace is intentionally ignored. The explicit property setter
    // is the native API for attaching a profile to a newly constructed spec.
    const o=options.fields??{};
    return make({width:o.width==null?1:int(o.width,'Spec width'),height:o.height==null?1:int(o.height,'Spec height'),colorMode:o.colorMode==null?0:int(o.colorMode,'Spec color mode'),transparentColor:maskInt(o.transparentColor??0),profile:NONE});
  }
  function options(value,{sprite=false}={}){
    const s={...checked(value)};
    if(![0,1,2].includes(s.colorMode))throw Error('ImageSpec supports RGB, gray and indexed raster allocation; tilemap allocation is unavailable.');
    if(sprite&&s.profile.profile.type===2&&String.fromCharCode(...s.profile.profile.icc.slice(16,20))==='GRAY'&&s.colorMode!==1)throw Error('A gray profile requires a grayscale sprite.');
    if(!sprite){s.width=Math.max(1,s.width);s.height=Math.max(1,s.height);}
    if(s.width<1||s.height<1||s.width>2048||s.height>2048||s.width*s.height>limits.pixels)throw Error('ImageSpec dimensions exceed the raster allocation budget.');
    const maximum=s.colorMode===0?0xffffffff:s.colorMode===1?0xffff:0xff;
    if(s.transparentColor>maximum)throw Error('ImageSpec transparent color does not fit its color mode.');
    return {...s,colorMode:modeNames[s.colorMode]};
  }
  function attachedCopy(docId,imageId){overrides.set(key(docId,imageId),{profile:NONE,transparentColor:doc(docId).metadata?.aseprite?.transparentIndex??0});}
  return {
    create,options,none:NONE,imageDescriptor,fromSprite,
    mask:value=>imageDescriptor(value).transparentColor,
    renderedProfile:sprite=>fromSprite(sprite).profile,
    attachedCopy,
    resized(value){if(value.docId&&!value.tilesetId)attachedCopy(value.docId,value.imageId,value);},
    profileAssigned(docId){for(const [id,value] of overrides)if(JSON.parse(id)[0]===docId)overrides.set(id,{...value,profile:colorSpaces.documentValue(doc(docId))});},
    snapshot:()=>new Map(overrides),restore:snapshot=>{overrides=new Map(snapshot);},
    equal(left,right){const a=checked(left),b=checked(right);return ['width','height','colorMode','transparentColor'].every(k=>a[k]===b[k])&&colorSpaces.sameValues(a.profile,b.profile);},
    get(target,property){
      if(target.__kind==='ImageSpec'){
        const value=checked(target);if(property==='colorSpace')return colorSpaces.fromValue(value.profile);
        if(['width','height','colorMode','transparentColor'].includes(property))return value[property];
        throw Error(`Unsupported ImageSpec.${property}.`);
      }
      if(property==='spec'&&target.__kind==='Image')return make(fromImage(image(target)));
      if(property==='spec'&&target.__kind==='Sprite')return make(fromSprite(target));
      return LUA_SPEC_NOT_HANDLED;
    },
    set(target,property,value){
      if(target.__kind!=='ImageSpec')return LUA_SPEC_NOT_HANDLED;
      const spec=checked(target);
      if(property==='colorSpace')spec.profile=colorSpaces.capture(value);
      else if(property==='transparentColor')spec[property]=maskInt(value);
      else if(['width','height','colorMode'].includes(property))spec[property]=int(value,`Spec ${property}`);
      else throw Error(`Unsupported ImageSpec.${property}.`);
    },
  };
}

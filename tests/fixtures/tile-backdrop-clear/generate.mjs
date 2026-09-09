// Original CC0 test-art generator. Rendering expectations come from a separate native process.
import fs from 'node:fs';import {createDocument,normalizeDocument} from '../../../app/editor-core.mjs';import {writeAseprite} from '../../../app/formats.mjs';
const output=process.argv[2];if(!output)throw Error('Supply a temporary output directory.');fs.mkdirSync(output,{recursive:true});
const cases=['normal','cel-zero','layer-zero','half','multiply','screen','transparent-tile','hidden','clip-negative','clip-edge','group','group-half','group-zero','group-multiply','group-cel-zero','overlay'];
const manifest=[];
for(const mode of ['rgba','grayscale','indexed'])for(const [tw,th] of [[2,3],[3,2]])for(const name of cases){
 const width=4*tw+3,height=2*th+3,d=createDocument({width,height,colorMode:mode});d.name=`${mode}-${tw}x${th}-${name}`;
 const palette=['#00000000','#303030ff','#909090ff','#c0c0c0ff','#606060ff','#e0e0e0ff','#101010ff'];if(mode==='rgba'){palette[2]='#e04020ff';palette[3]='#40a060ff';palette[5]='#6050e0ff';}d.palette=palette;
 d.metadata.aseprite={transparentIndex:0};d.clips=[];
 const pixel=i=>mode==='indexed'?i:i===0?null:palette[i];const layer=(id,type='image',parentId=null)=>({id,name:id,type,parentId,visible:true,locked:false,opacity:1,blendMode:'normal'});
 d.layers=[layer('background')];d.images={back:{width,height,pixels:Array.from({length:width*height},(_,i)=>pixel((i+Math.floor(i/width))%3?1:4))}};const frame=d.frames[0];frame.cels={background:{imageId:'back',x:0,y:0,opacity:1}};
 const group=name.startsWith('group')?'group':null;if(group){d.layers.push({...layer(group,'group'),opacity:name==='group-zero'?0:name==='group-half'?128/255:1,blendMode:name==='group-multiply'?'multiply':'normal'},layer('inner','image',group));d.images.inner={width,height,pixels:Array(width*height).fill(pixel(5))};frame.cels.inner={imageId:'inner',x:0,y:0,opacity:1};}
 d.layers.push({...layer('tiles','tilemap',group),tilesetId:'set',opacity:name==='layer-zero'?0:name==='half'?128/255:1,visible:name!=='hidden',blendMode:['multiply','screen'].includes(name)?name:'normal'});
 const tile=Array.from({length:tw*th},(_,i)=>pixel(name==='transparent-tile'?0:i===0?0:2+i%4));d.images.atlas={width:tw,height:th*2,pixels:[...Array(tw*th).fill(pixel(0)),...tile]};
 d.images.map={width:4,height:2,pixels:[],tilemap:{bitsPerTile:32,idMask:0x1fffffff,xFlipMask:0x80000000,yFlipMask:0x40000000,diagonalFlipMask:0x20000000,tiles:Array.from({length:8},(_,i)=>(1|(i&1?0x80000000:0)|(i&2?0x40000000:0)|(i&4?0x20000000:0))>>>0)}};
 d.tilesets=[{id:'set',asepriteId:0,name:'rectangles',tileWidth:tw,tileHeight:th,tileCount:2,baseIndex:1,flags:6,imageId:'atlas'}];frame.cels.tiles={imageId:'map',x:name==='clip-negative'?-1:name==='clip-edge'?width-3:1,y:name==='clip-negative'?-1:name==='clip-edge'?height-2:1,opacity:['cel-zero','group-cel-zero'].includes(name)?0:name==='half'?128/255:1};
 if(name==='overlay'){d.layers.push(layer('overlay'));d.images.overlay={width:1,height,pixels:Array(height).fill(pixel(6))};frame.cels.overlay={imageId:'overlay',x:3,y:0,opacity:1};}
 const normalized=normalizeDocument(d),path=`${output}/${d.name}.aseprite`;fs.writeFileSync(path,writeAseprite(normalized));manifest.push({name:d.name,mode,tw,th,scenario:name,width,height,path});
}
fs.writeFileSync(`${output}/manifest.json`,JSON.stringify(manifest));

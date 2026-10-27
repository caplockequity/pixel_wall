import { writeFile } from 'node:fs/promises';
import { applyCommand, createDocument, renderFrame } from '../app/editor-core.mjs';
import { writePng } from '../app/formats.mjs';
import { encodeProjectContainer } from '../app/project-format.mjs';

// Hand-composed woodland crossing, built from editable shapes.
// The fixed seed makes the downloadable example reproducible.
const W = 600, H = 350;
const C = {
  forest:'#1c403aff',shade:'#285144ff',grass:'#51794dff',meadow:'#6f9255ff',
  sunGrass:'#88a760ff',grassLight:'#a7bb70ff',earth:'#645a42ff',sand:'#af9b65ff',
  sandLight:'#cfbc83ff',deep:'#245565ff',water:'#338b96ff',current:'#419da2ff',
  shallows:'#64b5acff',foam:'#b6ded0ff',rockDark:'#435c57ff',rock:'#78887aff',
  rockLight:'#aaba99ff',woodDark:'#4e4938ff',wood:'#947448ff',woodLight:'#c5a36aff',
  leafDark:'#285c42ff',leaf:'#3b7850ff',leafLight:'#609451ff',leafSun:'#8eb15fff',
  flower:'#dfbb6cff',flowerLight:'#f1dca0ff',
};
const commands=[];
let layer='layer-1',seed=9137;
const q=n=>Math.round(n/2)*2;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
const range=(a,b)=>a+random()*(b-a);
function addLayer(id,name){layer=id;commands.push({type:'layer.add',layer:{id,name}});}
function poly(points,color){
  commands.push({type:'draw.polygon',layerId:layer,frameId:'frame-1',filled:true,color,points:points.map(([x,y])=>({x:q(x),y:q(y)}))});
}
function rect(x,y,width,height,color){
  commands.push({type:'draw.rect',layerId:layer,frameId:'frame-1',filled:true,x:q(x),y:q(y),width:Math.max(2,q(width)),height:Math.max(2,q(height)),color});
}
function line(x,y,x2,y2,color,size=2){
  commands.push({type:'draw.line',layerId:layer,frameId:'frame-1',from:{x:q(x),y:q(y)},to:{x:q(x2),y:q(y2)},color,size});
}
function shape(points,x,y,scale,color){poly(points.map(([px,py])=>[x+px*scale,y+py*scale]),color);}

// Smooth bends with stepped pixel edges and unequal bank widths.
const centerKeys=[[0,408],[48,370],[100,284],[154,248],[208,290],[266,348],[350,304]];
const widthKeys=[[0,96],[100,106],[180,132],[260,118],[350,156]];
function curve(keys,y){
  let i=0;while(i<keys.length-2&&y>keys[i+1][0])i++;
  const [y0,x0]=keys[i],[y1,x1]=keys[i+1],t=Math.max(0,Math.min(1,(y-y0)/(y1-y0)));
  return x0+(x1-x0)*t*t*(3-2*t);
}
function bank(y,side,extra=0){
  return curve(centerKeys,y)+side*(curve(widthKeys,y)/2+extra)+Math.sin(y*.067+side)*3+Math.sin(y*.147)*1.5;
}
function band(left,right,color,start=0,end=H,extra=0){
  const rows=[];for(let y=start;y<=end;y+=4)rows.push(Math.min(y,end));if(rows.at(-1)!==end)rows.push(end);
  const edge=side=>rows.map(y=>[q(curve(centerKeys,y)+side*curve(widthKeys,y)/2+Math.sign(side)*extra+Math.sin(y*.067+Math.sign(side))*3),y]);
  const stepped=points=>points.flatMap((p,i)=>i?[[points[i-1][0],p[1]],p]:[p]);
  poly([...stepped(edge(left)),...stepped(edge(right).reverse())],color);
}
function reflection(start,end,offset,width,color){
  const left=[],right=[];
  for(let y=start;y<=end;y+=4){
    const t=(y-start)/(end-start),half=curve(widthKeys,y)/2;
    const center=curve(centerKeys,y)+offset*half,spread=Math.sin(Math.PI*t)*width*half;
    left.push([center-spread,y]);right.push([center+spread,y]);
  }
  poly([...left,...right.reverse()],color);
}
const tuftShape=[[-6,2],[-8,-2],[-4,0],[-4,-6],[0,-2],[2,-8],[4,0],[8,-2],[6,4],[-2,4]];
function tuft(x,y,scale=1,color=C.grassLight){shape(tuftShape,x,y,scale,color);}

commands.push({type:'layer.update',layerId:layer,patch:{name:'Meadow and riverbed'}});
rect(0,0,W,H,C.grass);
poly([[0,0],[316,0],[300,40],[246,70],[202,112],[128,118],[76,152],[0,142]],C.shade);
poly([[0,148],[64,126],[112,134],[170,116],[220,142],[204,224],[256,270],[238,350],[0,350]],C.meadow);
poly([[34,166],[104,148],[168,158],[176,196],[142,218],[104,214],[74,246],[24,228]],C.sunGrass);
poly([[424,0],[600,0],[600,350],[410,350],[422,264],[398,216],[430,164],[402,100]],C.shade);
poly([[448,168],[514,174],[532,216],[492,238],[428,224],[406,194]],C.meadow);
// A worn path crosses the stream at the bridge.
poly([[0,246],[58,236],[104,208],[134,180],[164,150],[186,140],[188,164],[166,174],[144,198],[110,226],[60,252],[0,266]],C.earth);
poly([[0,246],[58,240],[104,214],[140,180],[170,152],[190,146],[190,160],[172,166],[146,192],[108,220],[60,248],[0,258]],C.sand);
poly([[316,144],[354,138],[378,138],[402,142],[426,150],[470,178],[506,188],[542,194],[600,194],[600,206],[542,206],[502,200],[464,190],[420,160],[398,154],[378,150],[354,152],[316,164]],C.earth);
poly([[316,148],[354,142],[378,142],[400,146],[424,154],[468,182],[504,192],[542,198],[600,198],[600,202],[542,202],[504,196],[466,186],[422,158],[398,150],[378,148],[354,150],[316,160]],C.sand);
for(const[x,y]of[[20,250],[63,243],[110,214],[145,183],[381,145],[421,155],[475,187],[544,198],[575,198]]){
  rect(x,y,10,2,C.sandLight);rect(x+14,y+4,4,2,C.earth);
}

// Keep terrain and riverbed together; four raster layers leave room for Lua.
band(-1,1,C.forest,0,H,12);
band(-1,1,C.earth,0,H,7);
// Exposed earth is concentrated on the inside bends.
band(-1.15,-.8,C.sand,32,108);
band(.83,1.16,C.sand,174,248);
band(-1.14,-.84,C.sand,276,350);
addLayer('water','River and bank details');
band(-1,1,C.water);
band(-.98,-.68,C.deep);
band(.72,1,C.shallows,0,128);
band(.64,1,C.shallows,174,270);
band(-.94,-.58,C.shallows,280,H);
reflection(0,100,.05,.62,C.current);
reflection(30,86,.3,.18,C.shallows);
reflection(176,238,-.06,.48,C.current);
reflection(196,228,.2,.16,C.shallows);
reflection(268,350,-.08,.5,C.current);
reflection(304,344,-.36,.14,C.shallows);

// Stones and shoreline grasses stay on the river layer.
for(const[side,y]of[[-1,20],[-1,54],[-1,100],[-1,192],[-1,236],[-1,282],[-1,324],[1,24],[1,76],[1,112],[1,192],[1,240],[1,292],[1,332]]){
  const x=bank(y,side,9);
  poly([[x-14,y],[x-10,y-8],[x+6,y-10],[x+14,y-4],[x+18,y+6],[x+4,y+10],[x-12,y+8]],C.grass);
  tuft(x-2,y-4,1.1,C.sunGrass);tuft(x+side*14,y+8,.7,C.meadow);
}
function rock(x,y,s=1,moss=false){
  shape([[-14,2],[-10,-6],[8,-6],[16,0],[14,10],[4,14],[-10,10]],x+3,y+3,s,C.deep);
  shape([[-12,-4],[-6,-12],[6,-12],[14,-4],[12,8],[2,12],[-10,6]],x,y,s,C.rockDark);
  shape([[-10,-4],[-4,-10],[6,-10],[12,-4],[6,4],[-6,4]],x,y,s,C.rock);
  shape([[-8,-4],[-2,-10],[4,-10],[6,-6],[-2,-2]],x,y,s,C.rockLight);
  if(moss)shape([[-10,0],[-4,-2],[0,2],[-2,6],[-8,4]],x,y,s,C.meadow);
}
for(const[x,y,s,moss]of[[344,40,.65,true],[333,62,.45,false],[212,106,.75,true],[204,119,.4,false],[324,192,.9,true],[341,207,.5,false],[281,286,1.15,true],[265,303,.6,false],[374,322,.8,true],[380,337,.45,false]])rock(x,y,s,moss);
rock(292,80,.7);rock(318,264,1);rock(332,278,.45);

// Reflected light is another pass on the river layer.
for(const[y,f,length]of[[14,-.3,12],[38,.35,16],[94,.24,18],[112,-.25,12],[188,-.3,14],[226,.15,20],[304,.3,24],[342,-.2,18]]){
  const x=curve(centerKeys,y)+f*curve(widthKeys,y);
  line(x,y,x+length,y,C.shallows);line(x+6,y+7,x+length+2,y+7,C.shallows);
}
for(const[x,y,s]of[[292,80,.7],[318,264,1],[281,286,1.15],[374,322,.8],[324,192,.9]]){
  line(x-14*s,y+5*s,x-10*s,y+9*s,C.foam);line(x-10*s,y+12*s,x+4*s,y+12*s,C.foam);
  line(x+8*s,y+8*s,x+14*s,y+4*s,C.shallows);line(x-4,y+20*s,x+10*s,y+20*s,C.shallows);
}

addLayer('bridge','Woodland footbridge');
poly([[182,154],[316,154],[330,172],[314,184],[188,180],[178,170]],C.deep);
rect(168,136,164,34,C.woodDark);
for(let x=170,n=0;x<332;x+=10,n++){
  const y=n%4===0?140:138;
  rect(x,y,8,27,n%3===0?C.woodLight:C.wood);line(x,y,x+6,y,C.woodLight);
  if(n%3===1)line(x+4,147,x+4,158,C.woodDark);
}
rect(162,132,176,4,C.woodDark);rect(162,130,176,2,C.woodLight);
rect(162,164,176,6,C.woodDark);rect(162,164,176,2,C.woodLight);
for(const x of[164,204,290,330]){
  rect(x,124,6,18,C.woodDark);rect(x,122,6,4,C.woodLight);
  rect(x,158,6,20,C.woodDark);rect(x,156,6,4,C.woodLight);
}

addLayer('forest','Woodland and flowers');
const crown=[[-30,-10],[-26,-10],[-26,-22],[-18,-22],[-18,-30],[-6,-30],[-6,-34],[10,-34],[10,-30],[22,-30],[22,-24],[30,-24],[30,-12],[34,-12],[34,6],[28,6],[28,16],[16,16],[16,22],[-4,22],[-4,18],[-20,18],[-20,10],[-30,10]];
function tree(x,y,s=1,warm=false){
  shape([[-32,12],[-22,4],[14,2],[36,12],[40,26],[26,34],[-6,32],[-26,24]],x+5,y+5,s,C.forest);
  rect(x-4*s,y+10*s,10*s,28*s,C.woodDark);rect(x-2*s,y+14*s,4*s,20*s,C.wood);
  shape(crown,x,y,s,C.forest);shape(crown,x-2*s,y-4*s,s*.92,C.leafDark);
  shape([[-24,-14],[-18,-14],[-18,-24],[-4,-24],[-4,-28],[8,-28],[8,-24],[22,-24],[22,-12],[28,-12],[28,0],[18,0],[18,8],[0,8],[0,12],[-16,12],[-16,4],[-24,4]],x,y,s,warm?C.leafLight:C.leaf);
  shape([[-24,-14],[-18,-14],[-18,-24],[-4,-24],[-4,-28],[8,-28],[8,-22],[16,-22],[16,-16],[6,-16],[6,-8],[-4,-8],[-4,-2],[-16,-2],[-16,-8],[-24,-8]],x-2,y-2,s,warm?C.leafSun:C.leafLight);
  shape([[-16,-22],[-6,-22],[-6,-26],[4,-26],[4,-22],[-2,-22],[-2,-18],[-16,-18]],x-2,y-2,s,C.leafSun);
  shape([[4,-8],[14,-8],[14,-12],[22,-12],[22,-4],[16,-4],[16,2],[4,2]],x,y,s,C.leafLight);
  shape([[-18,10],[-10,10],[-10,6],[0,6],[0,12],[-8,12],[-8,16],[-18,16]],x,y,s,C.leafDark);
}
// Back-to-front placements frame open meadows.
for(const[x,y,s,warm]of[[8,-8,1.3,false],[76,-6,1.2,false],[140,-4,1.05,false],[210,-8,1,false],[546,-8,1.4,false],[602,20,1.2,false],[490,22,1,false],[38,48,1.2,false],[110,50,1.1,true],[166,40,.85,false],[550,66,1.25,true],[600,104,1.2,false],[482,98,.95,false],[12,120,1.25,false],[72,110,.82,false],[558,138,.95,false],[16,294,1.45,false],[92,338,1.3,true],[154,362,1.15,false],[468,312,1.25,true],[540,296,1.35,false],[598,260,1.2,false],[592,344,1.5,false]])tree(x,y,s,warm);

// Finish the woodland layer with flowers and reeds.
// Texture is sparse and clustered, rather than sprinkled evenly across the scene.
for(const[cx,cy,radius,count]of[[70,180,32,7],[134,248,36,7],[190,292,26,5],[64,280,22,4],[432,252,24,5],[482,226,26,5],[510,162,16,3],[208,50,20,4]]){
  for(let n=0;n<count;n++){
    const angle=range(0,Math.PI*2),distance=range(0,radius),x=cx+Math.cos(angle)*distance,y=cy+Math.sin(angle)*distance;
    tuft(x,y,range(.55,.9),n%3?C.sunGrass:C.grass);
  }
}
for(const[x,y]of[[365,140],[397,150],[430,158],[448,174],[482,190],[522,199],[559,203],[584,195]])tuft(x,y,.55,C.meadow);
for(const[x,y]of[[68,174],[82,182],[62,194],[130,250],[148,240],[154,256],[180,290],[196,296],[472,226],[484,216],[496,232]]){
  line(x,y,x,y+5,C.shade);rect(x-2,y-2,6,4,C.flower);rect(x,y-2,2,2,C.flowerLight);
}
for(const[x,y]of[[202,188],[218,224],[402,266],[386,298],[348,38]]){
  line(x-4,y,x-6,y-12,C.sunGrass);line(x,y+2,x,y-18,C.grassLight);line(x+4,y,x+8,y-10,C.sunGrass);rect(x-2,y-20,4,6,C.wood);
}

if(commands.length>2000||Buffer.byteLength(JSON.stringify(commands))>16*1024*1024)throw new Error('Keep the tutorial within one command batch.');
let document=createDocument({id:'river-tutorial',name:'Woodland crossing',width:W,height:H});
for(const command of commands)document=applyCommand(document,command);
const output=new URL('../public/examples/',import.meta.url);
await writeFile(new URL('agent-river-commands.json',output),JSON.stringify(commands,null,2)+'\n');
await writeFile(new URL('agent-river.pixelwall',output),encodeProjectContainer(document));
await writeFile(new URL('agent-river.png',output),writePng(W,H,renderFrame(document,document.frames[0].id)));
console.log('River tutorial: '+commands.length+' commands, '+document.layers.length+' named layers, '+W+' × '+H+' pixels.');

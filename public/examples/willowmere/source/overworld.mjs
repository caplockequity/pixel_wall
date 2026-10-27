import fs from 'node:fs';import {Art,P,rand,tree,fir,rock,house,tuft,lantern,wheel} from './artlib.mjs';
const a=new Art(),R=rand(61824);
const layers=[['ground','Meadow • warm light'],['paths','Journey • earthen paths'],['banks','Anchored riverbanks'],['water','Deep teal river'],['ripples','Flow • twelve phases'],['roots','Roots and shadows • anchored'],['structures','Lantern Ford & village'],['ruins','Mossgate ruins'],['canopy-a','Canopy • west breeze'],['canopy-b','Canopy • north breeze'],['canopy-c','Canopy • orchard breeze'],['details','Garden and bank details'],['lanterns','Lantern trail']];
const setup=[{type:'palette.update',palette:Object.values(P)},{type:'layer.update',layerId:'layer-1',patch:{name:'Valley foundation'}}];a.c.push(...setup);a.r(0,0,512,384,'grass');layers.forEach(([id,n])=>a.layerAdd(id,n));
const ctrl=[[0,352,13],[38,354,17],[73,337,21],[115,281,26],[153,250,29],[191,251,29],[231,290,32],[268,321,40],[306,294,55],[346,253,74],[384,244,103]];
export function river(y){let i=0;while(i<ctrl.length-2&&y>ctrl[i+1][0])i++;const [y0,x0,w0]=ctrl[i],[y1,x1,w1]=ctrl[i+1],t=(y-y0)/(y1-y0),s=t*t*(3-2*t);return [x0+(x1-x0)*s,w0+(w1-w0)*s];}
function riverPoly(extra){let left=[],right=[];for(let y=0;y<=384;y+=3){let [x,w]=river(y);left.push([x-w-extra,y]);right.unshift([x+w+extra,y]);}return [...left,...right];}
a.target('ground');
for(const [x,y,w,h] of [[47,88,142,115],[77,221,132,104],[348,213,118,106],[351,92,109,78]])a.p([[x,y+20],[x+22,y],[x+w-25,y+5],[x+w,y+37],[x+w-9,y+h-14],[x+35,y+h],[x-9,y+h-25]],'grassLight');
// Northern rock terraces establish the waterfall's height.
a.p([[285,0],[511,0],[512,81],[474,104],[432,92],[403,102],[380,77],[318,80],[291,51]],'stoneDark');
a.p([[291,0],[510,0],[511,63],[471,84],[437,74],[406,84],[379,56],[321,60],[301,37]],'stone');
a.p([[305,0],[511,0],[511,43],[466,61],[433,53],[404,63],[377,38],[330,40],[312,22]],'stoneLight');
a.p([[313,0],[511,0],[511,28],[472,36],[448,31],[409,43],[383,25],[333,26]],'leafShadow');
for(let k=0;k<12;k++){let x=305+k*17,y=50+Math.round(Math.sin(k)*11);a.l(x,y,x+10,y-2,'stoneDark',2);a.l(x+3,y+2,x+3,y+9,'stoneDark');}
// Broad, winding paths connect every place; their margins remain still.
a.target('paths');const paths=[[[20,218],[58,202],[81,174],[117,164],[147,176],[179,166],[204,180],[222,198],[305,198],[332,211],[361,208],[388,230],[417,267]],[[117,165],[106,191],[121,216],[110,244],[112,280],[147,303],[188,318],[215,345]],[[331,210],[364,178],[399,157],[411,121],[392,103]],[[139,175],[135,138],[113,111],[117,78]],[[418,266],[451,281],[471,311]]];
for(const p of paths){a.path(p,'ochre',12);a.path(p,'path',9);}
a.target('banks');a.p(riverPoly(5),'earth');a.p(riverPoly(3),'path');a.p(riverPoly(1),'moss');
a.target('water');a.p(riverPoly(0),'water');a.p(riverPoly(-4),'waterDeep');a.p(riverPoly(-9),'water');
// Blockout structure footprints, replaced in the next checkpoint.
a.target('structures');for(const [x,y,w,h] of [[90,95,43,41],[146,122,40,36],[65,148,35,32],[294,163,53,45]]){a.r(x,y,w,h,'woodDark');a.r(x,y,w,16,'coral');}a.r(219,188,84,22,'woodLight');a.target('ruins');a.r(72,252,70,45,'stone');
const block=[...a.c];fs.writeFileSync('source/overworld-02-blockout.json',JSON.stringify(block));
// Detailed authored architecture.
a.c=[];a.target('structures');a.add('cel.clear',{layerId:'structures',frameId:'frame-1'});
house(a,88,91,47,47);house(a,146,123,43,40,1);house(a,56,145,37,36);house(a,153,73,34,33);
// village well, stepping stones and planting beds
for(const [x,y] of [[101,154],[130,161],[168,177]]){a.r(x,y,9,4,'stoneDark');a.r(x+1,y-1,7,3,'stoneLight');}
a.p([[111,141],[117,136],[124,138],[128,144],[123,149],[115,149]],'stoneDark');a.r(113,140,12,6,'stone');a.r(116,139,7,3,'waterDeep');a.r(111,132,2,15,'wood');a.r(126,132,2,15,'wood');a.l(110,132,128,132,'woodDark',2);a.l(113,131,126,131,'woodLight');
// Lantern Ford: coral double roof, tall mill annex, waterwheel.
house(a,292,157,56,52);house(a,321,137,30,42,0);a.r(294,203,53,5,'stoneDark');for(let i=0;i<7;i++){a.r(295+i*7,201,6,4,i%2?'stone':'stoneLight');}wheel(a,291,197,13);
// Bridge is an anchored timber deck reaching both river banks.
a.r(216,188,89,26,'woodDark');a.r(217,190,87,20,'wood');for(let x=218;x<305;x+=5){a.r(x,190,3,19,'woodLight');a.r(x,191,1,16,'path');a.r(x,205,3,2,'wood');}
a.l(216,187,305,187,'woodDark',3);a.l(216,185,305,185,'path');a.l(216,211,305,211,'woodDark',3);a.l(216,210,305,210,'woodLight');for(let x of [217,238,282,304]){a.r(x-1,180,4,12,'woodDark');a.r(x,180,2,10,'woodLight');a.r(x-1,178,4,3,'path');a.r(x-1,207,4,11,'woodDark');a.r(x,208,2,9,'woodLight');}
// Ruin with broken arched doorway and carved masonry.
a.target('ruins');a.add('cel.clear',{layerId:'ruins',frameId:'frame-1'});a.p([[64,294],[77,250],[130,246],[150,286],[143,305],[76,306]],'leafShadow');
for(let row=0;row<5;row++)for(let col=0;col<5;col++){let x=75+col*13+(row%2?6:0),y=258+row*7;if((col===2||col===3)&&row>1)continue;if(row===0&&col===4)continue;a.r(x,y,12,6,'stoneDark');a.r(x,y,11,4,(col+row)%3?'stone':'stoneLight');}
a.p([[95,284],[95,265],[99,256],[105,252],[114,252],[121,257],[124,267],[124,284],[118,284],[118,265],[114,260],[105,260],[101,266],[101,284]],'stoneDark');
a.p([[94,280],[94,263],[98,254],[105,249],[115,249],[122,255],[125,265],[120,265],[117,257],[112,254],[106,254],[102,258],[99,266],[99,280]],'stoneLight');
a.r(106,271,10,11,'deep');a.r(109,270,4,6,'gold');a.r(110,271,2,3,'cream');for(const [x,y,w] of [[76,256,19],[95,248,13],[122,265,12],[72,288,24],[125,285,10]]){a.r(x,y,w,2,'leaf');a.r(x+2,y-1,w-4,1,'moss');}rock(a,62,288,17,10);rock(a,139,292,18,11);a.r(87,293,42,3,'stone');
// Landing and a quiet boat sheltered under reeds.
a.target('structures');a.r(199,336,15,35,'woodDark');for(let y=337;y<369;y+=4)a.r(200,y,16,3,'woodLight');a.r(195,333,4,9,'wood');a.r(213,337,3,35,'wood');a.p([[226,348],[233,354],[234,373],[230,380],[223,375],[220,355]],'woodDark');a.p([[225,352],[230,356],[231,371],[228,375],[224,371]],'ochre');a.l(224,362,232,362,'wood');a.l(220,351,238,369,'path');
// Orchard fences vary with the contour, no repeated geometric tree circles.
a.target('details');for(let x=381;x<463;x+=13){a.r(x,278,2,11,'wood');a.r(x,277,2,2,'path');}a.l(380,282,463,282,'woodLight');
// Foliage grouped by wind phase; silhouettes vary in height and width.
const trees=[[16,69,38,54],[49,61,37,49],[78,59,32,45],[111,49,33,44],[145,46,32,48],[183,53,37,51],[219,67,39,54],[259,67,35,49],[19,118,36,52],[48,109,29,45],[202,104,31,48],[240,109,36,50],[16,170,36,51],[26,265,42,59],[49,249,30,43],[178,240,37,53],[205,272,39,54],[28,317,41,57],[55,337,35,54],[94,346,32,44],[128,367,42,60],[169,367,35,52],[15,384,42,60],[476,162,40,58],[444,139,34,50],[479,211,41,59],[447,210,30,46],[385,170,30,43],[489,269,31,49],[457,350,40,59],[490,381,44,64],[404,373,36,55],[372,343,37,49],[344,373,34,50]];
trees.forEach(([x,y,w,h],i)=>tree(a,x,y,w,h,i,'canopy-'+['a','b','c'][i%3]));
for(let i=0;i<6;i++)fir(a,392+i*22,39+(i%3)*8,22+(i%2)*4,43+(i%3)*6,'canopy-b');
for(const [x,y,w,h] of [[393,254,23,32],[428,244,25,35],[456,263,24,34],[401,296,24,34]]){tree(a,x,y,w,h,12,'canopy-c');a.target('details');for(let k=0;k<3;k++){a.r(x-8+k*6,y-h+11+(k%2)*5,2,2,'coral');a.r(x-8+k*6,y-h+10+(k%2)*5,1,1,'gold');}}
a.target('details');for(const [x,y,w,h] of [[313,94,18,10],[286,111,13,9],[226,149,14,10],[295,237,13,8],[336,271,19,10],[188,327,14,8],[369,106,18,13],[408,93,24,15],[478,94,25,15]])rock(a,x,y,w,h);
const complete=[...a.c];fs.writeFileSync('source/overworld-03-complete.json',JSON.stringify(complete));
// First substantive refinement: material marks, bank foliage, waterfall, roof garden, garden patches.
a.c=[];a.target('details');
for(let y=100;y<377;y+=13){let [cx,w]=river(y);for(let side of [-1,1]){let x=cx+side*(w+6+R()*5);if(y>177&&y<219)continue;tuft(a,x,y,Math.floor(y)%5===0);if(y%2===0){a.r(x-side*4,y+4,4,2,'stone');a.r(x-side*4,y+3,3,1,'stoneLight');}}}
for(let i=0;i<170;i++){let x=8+R()*496,y=45+R()*331,[cx,w]=river(y);if(Math.abs(x-cx)<w+14)continue;if((x>48&&x<190&&y>80&&y<181)||(x>65&&x<149&&y>247&&y<308)||(x>285&&x<353&&y>133&&y<215))continue;let c=i%5===0?'pathLight':'grassLight';a.r(x,y,3,1,c);if(i%4===0)tuft(a,x,y+3,i%12===0);}
for(const [x,y] of [[74,185],[141,147],[154,113]]){a.r(x,y,17,8,'soil');for(let q=0;q<4;q++){a.r(x+q*4+1,y+2,2,4,'leaf');a.r(x+q*4+1,y+1,2,1,'moss');}}
a.target('lanterns');for(const [x,y] of [[205,177],[305,178],[185,314],[92,235],[80,184],[352,202],[404,296]])lantern(a,x,y);
// Waterfall locks its stone lip and banks; only internal streaks move.
a.target('banks');a.p([[323,53],[356,53],[355,63],[345,80],[325,94],[309,94],[319,77],[324,63]],'waterDeep');a.p([[326,55],[351,55],[350,65],[341,80],[323,93],[315,91],[324,73]],'waterLight');a.l(326,54,352,54,'foam',2);a.l(314,94,333,89,'foam',2);
a.target('details');a.r(348,165,2,10,'leaf');a.r(349,169,4,2,'leafLight');a.r(347,175,4,2,'moss');a.l(328,165,340,165,'coralLight');
const detail=[...a.c];fs.writeFileSync('source/overworld-04-detail.json',JSON.stringify(detail));
// Explicit environmental loop: every static layer linked, canopies move independently.
a.c=[];const frames=['frame-1',...Array.from({length:11},(_,i)=>'flow-'+(i+2))];a.add('frame.update',{frameId:'frame-1',patch:{durationMs:100}});for(let i=1;i<12;i++)a.add('frame.add',{id:frames[i],afterFrameId:frames[i-1],durationMs:100});
for(const id of ['layer-1',...layers.map(x=>x[0])])if(id!=='ripples')a.add('cel.link',{layerId:id,sourceFrameId:'frame-1',frameIds:frames.slice(1)});
a.add('clip.update',{clipId:'clip-1',patch:{name:'Lantern River • seamless 1.2s',frameIds:frames,loop:true}});
for(let f=0;f<12;f++){
 for(let c=0;c<3;c++){let dx=Math.round(Math.sin(f*Math.PI/6+c*1.4));a.add('cel.move',{layerId:'canopy-'+['a','b','c'][c],frameId:frames[f],x:dx,y:0});}
 a.target('ripples',frames[f]);
 for(let lane=0;lane<3;lane++)for(let j=0;j<16;j++){let yy=(j*24+lane*8+f*2)%384;let [cx,w]=river(yy);let xx=cx+[-.59,0,.58][lane]*w;if(yy>178&&yy<219)continue;if(yy>48&&yy<97)continue;a.l(xx-3,yy,xx+3,yy,'waterLight');if(lane===1)a.l(xx+2,yy+2,xx+4,yy+2,'foam');}
 for(let k=0;k<8;k++){let yy=58+((k*5+f*5/12)%35),xx=337-(yy-58)*.36;a.l(xx+(k%3)*4,yy,xx+(k%3)*4-2,yy+5,k%3?'foam':'cream');}
 for(let j=0;j<6;j++){let x=315+j*4+Math.round(Math.sin((f+j)*Math.PI/6));a.l(x,94+j%2,x+2,94+j%2,'foam');}
}
fs.writeFileSync('source/overworld-animation.json',JSON.stringify(a.c));
console.log('commands',block.length,complete.length,detail.length,a.c.length);

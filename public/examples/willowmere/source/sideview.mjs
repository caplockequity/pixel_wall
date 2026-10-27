import fs from 'node:fs';import {Art,P,rand,leafCluster,rock,tuft,lantern,wheel} from './artlib.mjs';
const a=new Art(),R=rand(1447),layers=[['distant','Distant • mist and highland'],['middle','Middle • forest silhouettes'],['water','River • teal undercurrent'],['ripples','River • moving light'],['roots','Anchored trunks and roots'],['mill','Lantern Ford • mill and stone'],['ground','Playable route • banks and bridge'],['canopy-a','Canopy • foreground willow'],['canopy-b','Canopy • orchard oak'],['detail','Garden and timber details'],['foreground','Foreground • reeds and stones']];
a.add('palette.update',{palette:Object.values(P)});a.add('layer.update',{layerId:'layer-1',patch:{name:'Sky • soft golden morning'}});a.r(0,0,768,256,'sky');a.r(0,0,768,38,'cream');a.r(0,38,768,25,'moss');a.r(0,63,768,36,'sky');layers.forEach(([id,n])=>a.layerAdd(id,n));
a.target('distant');
a.p([[0,126],[28,105],[57,109],[90,78],[117,90],[151,63],[183,79],[214,74],[255,103],[300,93],[326,105],[369,79],[410,97],[456,76],[492,88],[533,56],[569,68],[601,37],[638,47],[675,67],[705,49],[744,68],[768,63],[768,256],[0,256]],'stoneLight');
a.p([[0,145],[31,121],[79,133],[114,104],[163,119],[196,101],[245,136],[283,119],[325,140],[365,111],[409,124],[457,110],[502,124],[542,96],[588,104],[630,81],[672,107],[715,95],[768,109],[768,256],[0,256]],'grass');
// quiet horizontal cloud bands, stepped pixels at their tips
for(const [x,y,w] of [[55,33,70],[232,48,79],[393,26,94],[592,24,64]]){a.r(x,y,w,3,'glow');a.r(x+11,y-3,w-22,3,'glow');a.r(x-6,y+3,w+12,2,'cream');}
a.target('middle');for(let i=0;i<37;i++){let x=i*23-8,y=144+(i%4)*5,h=30+(i*17%25);a.r(x+8,y-h+16,3,h,'leafShadow');a.p([[x+9,y-h],[x-4,y-h+19],[x+1,y-h+18],[x-9,y-h+37],[x+27,y-h+37],[x+18,y-h+17],[x+23,y-h+19]],i%3?'leaf':'leafShadow');}
a.p([[0,160],[82,153],[163,161],[229,152],[282,162],[359,154],[409,164],[484,154],[571,147],[662,150],[768,140],[768,256],[0,256]],'leafShadow');
a.target('water');a.r(0,171,768,85,'waterDeep');a.r(0,183,768,73,'water');a.r(275,200,206,56,'waterDeep');
a.target('ground');a.p([[0,185],[54,184],[107,189],[168,181],[229,183],[269,180],[285,190],[278,205],[262,215],[246,256],[0,256]],'earth');a.p([[0,181],[54,181],[107,185],[168,177],[229,179],[269,176],[281,185],[269,194],[214,195],[166,195],[108,202],[47,198],[0,200]],'grass');
a.p([[474,182],[509,177],[561,180],[604,174],[666,180],[717,177],[768,180],[768,256],[491,256],[485,222],[474,210],[463,194]],'earth');a.p([[475,177],[508,173],[561,176],[604,170],[665,176],[718,173],[768,176],[768,195],[712,192],[669,198],[604,192],[559,198],[508,194],[475,195]],'grass');
a.r(265,182,217,12,'woodDark');a.r(265,182,217,4,'woodLight');a.target('mill');a.r(454,107,99,70,'cream');a.p([[440,108],[486,61],[528,61],[564,109]],'coral');
const block=[...a.c];fs.writeFileSync('source/sideview-02-blockout.json',JSON.stringify(block));
// First completed architecture, kept entirely separate from walkable ground.
a.c=[];a.target('mill');a.add('cel.clear',{layerId:'mill',frameId:'frame-1'});
a.p([[453,178],[557,178],[577,190],[469,191]],'deep');a.r(454,105,99,72,'woodDark');a.r(458,110,89,61,'cream');a.r(523,109,26,66,'ochre');
a.r(454,160,101,18,'stoneDark');for(let row=0;row<3;row++)for(let col=0;col<10;col++)a.r(456+col*10+(row%2?3:0),161+row*5,8,4,(row+col)%4?'stone':'stoneLight');
for(const x of [458,479,520,545])a.r(x,110,3,52,'wood');a.r(456,129,94,3,'wood');a.r(456,153,94,3,'wood');a.l(460,132,478,151,'wood',2);a.l(520,151,544,132,'wood',2);
a.p([[439,108],[484,59],[529,59],[565,109],[561,115],[443,115]],'woodDark');a.p([[442,107],[486,62],[528,62],[560,107]],'coral');a.p([[489,63],[528,63],[559,106],[520,106]],'coralDark');a.l(443,106,486,62,'coralLight',3);a.l(486,61,528,61,'pathLight',2);a.r(442,109,120,3,'coralLight');
for(let y=72;y<106;y+=7){let le=486-(y-62)*.96,ri=528+(y-62)*.72;a.l(le,y,ri,y,'woodDark');for(let x=le+8;x<ri;x+=14)a.l(x,y+1,x-4,y+5,'coralLight');}
// Round grain-window and gabled dormer create a unique mill silhouette.
a.p([[476,100],[476,87],[488,77],[501,87],[501,100]],'woodDark');a.p([[478,99],[478,88],[488,80],[499,88],[499,99]],'cream');a.r(483,87,11,12,'wood');a.r(485,89,7,7,'gold');a.r(488,89,1,7,'woodDark');a.r(485,92,7,1,'woodDark');a.l(474,87,488,75,'coralLight',2);a.l(488,75,503,87,'coralDark',2);
a.r(530,59,10,34,'stoneDark');a.r(532,60,7,28,'stone');a.r(528,57,14,5,'stoneLight');a.r(531,57,8,2,'earth');
a.r(489,136,17,26,'woodDark');a.r(492,138,11,22,'wood');a.r(494,140,7,14,'woodLight');a.r(501,149,1,2,'gold');a.r(487,161,24,3,'stoneLight');
for(const [x,y] of [[462,116],[528,116]]){a.r(x,y,13,12,'woodDark');a.r(x+2,y+2,9,8,'gold');a.r(x+6,y+1,1,10,'wood');a.r(x-1,y+12,15,3,'wood');a.r(x,y+12,4,2,'leaf');a.r(x+9,y+12,3,2,'coral');}
wheel(a,444,157,26);a.r(441,154,11,6,'woodDark');a.r(444,155,10,2,'woodLight');
// Upstream flume, visibly attached to wheel; mossy stone buttresses.
a.r(407,126,42,7,'woodDark');a.r(408,127,40,2,'woodLight');a.r(412,133,3,37,'wood');a.r(430,133,3,21,'wood');a.r(411,130,37,2,'waterLight');
// Timber bridge rail has openings at both ends and does not obstruct the route.
a.target('ground');for(let x=267;x<482;x+=7){a.r(x,182,5,3,'path');a.r(x+1,187,3,5,'wood');}
for(let x of [274,321,370,418,475]){a.r(x,163,4,34,'woodDark');a.r(x,163,2,29,'woodLight');a.r(x-1,161,6,3,'path');}
a.r(273,168,207,3,'woodDark');a.r(273,167,207,1,'woodLight');a.r(273,177,207,2,'wood');
for(let x of [285,467]){a.r(x,195,8,47,'woodDark');a.r(x,196,3,43,'wood');a.l(x,223,x+(x<350?37:-37),195,'wood',4);}
a.l(293,207,329,195,'woodLight',2);a.l(461,207,427,195,'woodLight',2);
// Distinct trees: wide willow left, curved old oak right.
function bigTree(x,y,w,h,canopy,variant){a.target('roots');a.p([[x-7,y-h+36],[x+6,y-h+36],[x+8,y-20],[x+19,y-3],[x+7,y],[x,y-5],[x-17,y],[x-6,y-18]],'woodDark');a.p([[x-4,y-h+40],[x+1,y-h+36],[x+1,y-19],[x+7,y-5],[x+1,y-8],[x-7,y-2],[x-2,y-19]],'wood');a.l(x-3,y-24,x-3,y-h+58,'woodLight',2);for(let k=0;k<4;k++){let side=k%2?1:-1,yy=y-h+58+k*14;a.l(x,yy, x+side*(w*.33),yy-20,'woodDark',5);a.l(x,yy-1,x+side*w*.33,yy-22,'wood',3);}a.target(canopy);for(const [dx,dy,s] of [[-.3,0,1],[-.65,.18,.9],[0,.16,.95],[-.35,.35,.9],[.25,.37,.7],[-.75,.42,.7]])leafCluster(a,x+dx*w,y-h+dy*h,w/39*s,variant);}
bigTree(112,186,80,151,'canopy-a',2);bigTree(647,180,73,136,'canopy-b',7);bigTree(26,182,55,115,'canopy-a',4);bigTree(743,179,49,109,'canopy-b',11);
a.target('detail');for(const [x,y,w,h] of [[207,181,32,17],[242,188,24,14],[571,187,27,15],[696,182,23,14]])rock(a,x,y,w,h);
a.target('foreground');a.p([[0,239],[38,229],[70,235],[115,225],[157,234],[190,229],[227,242],[246,256],[0,256]],'deep');a.p([[495,249],[532,232],[571,237],[621,228],[671,238],[724,230],[768,239],[768,256],[495,256]],'deep');
const complete=[...a.c];fs.writeFileSync('source/sideview-03-complete.json',JSON.stringify(complete));
// Refinement one: route highlights, organic ground and quiet material detail.
a.c=[];a.target('detail');
for(let x=0;x<768;x+=8){if(x>261&&x<487)continue;let y=x<265?185:180;let d=Math.round(Math.sin(x*.035)*3);a.r(x,y+d,5,2,'path');a.r(x+3,y+4+d,2,1,'pathLight');}
for(let i=0;i<65;i++){let x=R()*768;if(x>259&&x<490)continue;let y=195+R()*46;a.r(x,y,3+R()*6,2,'soil');if(i%3===0)a.r(x+1,y-1,3,1,'ochre');}
for(let x=8;x<768;x+=17){if(x>248&&x<494)continue;tuft(a,x,185+Math.round(Math.sin(x)*4),x%3===0);}
a.r(558,160,18,15,'woodDark');a.r(560,161,14,12,'wood');a.l(560,162,572,171,'woodLight');a.l(572,162,560,171,'woodLight');a.r(580,163,13,11,'woodDark');a.r(582,164,9,8,'woodLight');
a.r(533,145,2,14,'leaf');a.r(535,148,2,7,'leafLight');a.r(530,156,8,3,'leaf');
for(const [x,y] of [[249,160],[481,155],[166,163],[608,153]])lantern(a,x,y);
a.target('foreground');for(let i=0;i<38;i++){let x=i*21+R()*8,y=240+R()*16;if(x>238&&x<500)continue;a.l(x,y,x-3,y-16-R()*10,'leafShadow',2);a.l(x+2,y,x+8,y-12-R()*8,'leaf',2);a.l(x+6,y-20,x+7,y-28,'ochre',2);}rock(a,168,240,40,17);rock(a,550,240,34,18);
const detail=[...a.c];fs.writeFileSync('source/sideview-04-detail.json',JSON.stringify(detail));
// Environmental loop. Shared static images keep the project compact and editable.
a.c=[];const fids=['frame-1',...Array.from({length:11},(_,i)=>'flow-'+(i+2))];a.add('frame.update',{frameId:'frame-1',patch:{durationMs:100}});for(let i=1;i<12;i++)a.add('frame.add',{id:fids[i],afterFrameId:fids[i-1],durationMs:100});for(const id of ['layer-1',...layers.map(x=>x[0])])if(id!=='ripples')a.add('cel.link',{layerId:id,sourceFrameId:'frame-1',frameIds:fids.slice(1)});a.add('clip.update',{clipId:'clip-1',patch:{name:'Ford breeze • 1.2 seconds',frameIds:fids,loop:true}});
for(let f=0;f<12;f++){a.add('cel.move',{layerId:'canopy-a',frameId:fids[f],x:Math.round(Math.sin(f*Math.PI/6)),y:0});a.add('cel.move',{layerId:'canopy-b',frameId:fids[f],x:Math.round(Math.sin(f*Math.PI/6+2)),y:0});a.target('ripples',fids[f]);for(let row=0;row<5;row++)for(let col=0;col<5;col++){let x=250+((col*48+f*4+[3,27,11,38,19][row])%240),y=[199,213,228,242,252][row];a.r(x,y,[5,10,3,7,4][row],1,row===2?'foam':'waterLight');}for(let k=0;k<4;k++){let y=134+((k*6+f/2)%24);a.l(445,y,444,y+3,'foam');}}
fs.writeFileSync('source/sideview-animation.json',JSON.stringify(a.c));console.log('side commands',block.length,complete.length,detail.length,a.c.length);

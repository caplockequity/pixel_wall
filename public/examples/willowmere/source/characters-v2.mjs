import fs from 'node:fs';
import {P} from './artlib.mjs';
class Pixels {
 constructor(w,h){this.w=w;this.h=h;this.p=Array(w*h).fill(null);}
 px(x,y,c){x=Math.round(x);y=Math.round(y);if(x>=0&&x<this.w&&y>=0&&y<this.h)this.p[y*this.w+x]=P[c]??c;}
 r(x,y,w,h,c){for(let yy=Math.round(y);yy<Math.round(y+h);yy++)for(let xx=Math.round(x);xx<Math.round(x+w);xx++)this.px(xx,yy,c);}
 l(x,y,X,Y,c,n=1){const len=Math.max(Math.abs(X-x),Math.abs(Y-y));for(let k=0;k<=len;k++){const t=len?k/len:0;this.r(Math.round(x+(X-x)*t),Math.round(y+(Y-y)*t),n,n,c);}}
 poly(pts,c){let y0=Math.floor(Math.min(...pts.map(p=>p[1]))),y1=Math.ceil(Math.max(...pts.map(p=>p[1])));for(let y=y0;y<=y1;y++){let xs=[];for(let i=0,j=pts.length-1;i<pts.length;j=i++){let [x0,Y0]=pts[j],[x1,Y1]=pts[i];if((Y0>y)!==(Y1>y))xs.push(x0+(y-Y0)*(x1-x0)/(Y1-Y0));}xs.sort((a,b)=>a-b);for(let k=0;k+1<xs.length;k+=2)for(let x=Math.ceil(xs[k]);x<=Math.floor(xs[k+1]);x++)this.px(x,y,c);}}
}
function courier(f){
 const body=new Pixels(32,48),acc=new Pixels(32,48),face=new Pixels(32,48),idle=f<6,walk=f>=6&&f<14,jump=f>=14,k=walk?f-6:jump?f-14:f;
 let bob=idle?[0,0,1,1,1,0][k]:walk?[0,0,-1,0,0,0,-1,0][k]:[2,0,-2,-1,0,2][k],lean=walk?[0,0,1,1,0,0,1,1][k]:jump?[1,2,1,0,1,1][k]:0;
 const poly=(d,pts,c)=>d.poly(pts.map(([x,y])=>[x+lean,y+bob+(d===body&&jump&&(k===2||k===3)&&y>=27?-2:0)]),c),r=(d,x,y,w,h,c)=>d.r(x+lean,y+bob,w,h,c),l=(d,x,y,X,Y,c,n=1)=>d.l(x+lean,y+bob,X+lean,Y+bob,c,n);
 // Far leg behind the coat; a planted foot travels 3 pixels backward per100ms.
 let feet=walk?[[[22,43],[10,40]],[[19,43],[12,39]],[[16,43],[17,40]],[[13,43],[23,42]],[[10,40],[22,43]],[[12,39],[19,43]],[[17,40],[16,43]],[[23,42],[13,43]]][k]:jump?[[[12,43],[23,43]],[[10,42],[22,39]],[[11,39],[24,37]],[[14,38],[24,38]],[[10,42],[25,42]],[[12,43],[23,43]]][k]:[[12,43],[21,43]];
 function leg(hipX,foot,far){let [x,y]=foot;body.poly([[hipX-2,34+bob],[hipX+2,34+bob],[x+1,y-2],[x+2,y+1],[x-3,y+1],[x-3,y-2]],'ink');body.l(hipX-1,36+bob,x-1,y-1,far?'deep':'waterDeep',2);body.r(x-3,y,6,4,'woodDark');body.r(x-2,y,4,2,'wood');body.r(x+1,y+1,3,2,'soil');body.r(x-2,y+3,6,1,'ink');body.r(x+2,y+1,1,1,'woodLight');}
 leg(12,feet[1],true);leg(18,feet[0],false);
 // Split coat, visible under-tunic and diagonal folds.
 poly(body,[[10,22],[20,21],[24,27],[24,34],[21,39],[17,40],[15,37],[9,39],[6,36],[7,28]],'ink');
 poly(body,[[10,23],[18,23],[20,30],[18,37],[15,35],[10,37],[8,35],[9,28]],'leafShadow');
 poly(body,[[11,23],[16,23],[17,31],[14,35],[9,36],[10,28]],'leaf');
 poly(body,[[17,23],[21,24],[23,29],[22,34],[19,38],[18,36],[20,29]],'pine');
 l(body,11,25,10,31,'leafLight');l(body,11,34,14,33,'leafLight');l(body,18,27,19,32,'deep');
 r(body,16,33,3,5,'waterDeep');r(body,16,33,1,4,'waterLight');r(body,18,36,2,1,'woodLight');
 // Head: stepped hood with a projecting brim and an inset face.
 poly(body,[[8,9],[10,5],[15,2],[19,4],[23,6],[25,10],[25,15],[23,19],[19,22],[12,21],[8,18],[6,14]],'ink');
 poly(body,[[9,10],[11,6],[15,4],[20,6],[23,9],[23,14],[21,19],[17,20],[11,18],[8,14]],'pine');
 poly(body,[[10,10],[12,7],[16,5],[20,7],[22,9],[18,8],[13,11],[11,15],[9,14]],'leafShadow');
 l(body,12,7,16,5,'leaf');r(body,12,8,2,1,'leafLight');l(body,9,11,8,14,'leaf');
 poly(face,[[17,10],[22,10],[23,12],[25,13],[25,15],[23,15],[23,18],[19,19],[16,17],[16,13]],'ochre');
 poly(face,[[17,10],[21,10],[22,12],[24,13],[23,14],[22,14],[22,17],[19,18],[17,16]],'cream');
 if(idle&&k===4){r(face,20,13,2,1,'woodDark');}else{r(face,20,12,1,2,'ink');r(face,21,12,1,1,'woodDark');}r(face,23,13,1,1,'pathLight');r(face,21,16,2,1,'woodLight');
 l(face,15,10,21,9,'deep');r(face,15,10,2,3,'woodDark');r(face,16,11,1,2,'path');
 // Warm scarf with stitched edge and cloth trailing behind, never across the face.
 poly(acc,[[10,19],[17,20],[23,18],[24,21],[20,24],[13,23],[8,22]],'coralDark');
 l(acc,10,20,17,21,'coralLight');l(acc,17,21,22,20,'coral');
 let tail=idle?[0,0,1,1,0,-1][k]:walk?[0,1,1,0,-1,-1,0,0][k]:[-1,-2,-3,-2,1,0][k];
 poly(acc,[[10,21],[7,22],[3,21+tail],[1,23+tail],[4,25+tail],[8,25],[12,23]],'coralDark');l(acc,3,22+tail,7,23,'coral');r(acc,3,22+tail,2,1,'coralLight');
 // Small stitched satchel and a diagonal carrying strap.
 poly(acc,[[5,25],[9,24],[12,26],[12,33],[9,35],[5,34],[4,31],[4,27]],'woodDark');
 r(acc,5,27,6,6,'wood');l(acc,5,27,10,26,'woodLight');r(acc,6,28,4,2,'ochre');r(acc,8,29,1,2,'gold');r(acc,6,32,1,1,'woodLight');
 l(acc,21,23,11,30,'woodDark',2);l(acc,21,23,11,30,'ochre');r(acc,18,25,2,2,'gold');r(acc,18,25,1,1,'cream');
 // Forward sleeve, hand, wire handle, brass frame and luminous glass.
 poly(body,[[21,24],[24,25],[25,29],[24,31],[21,30],[20,27]],'ink');poly(body,[[21,25],[23,26],[24,29],[22,29],[21,27]],'leaf');r(face,23,29,3,2,'cream');r(face,24,30,2,1,'ochre');
 let swing=walk?[0,1,2,1,0,-1,-2,-1][k]:idle?[0,0,0,1,1,0][k]:[0,1,1,0,-1,0][k];
 const lx=26,ly=32+bob+swing;acc.l(24+lean,30+bob,28,31+bob,'woodDark');acc.r(lx+1,ly-2,3,1,'woodDark');acc.r(lx,ly-1,1,2,'woodDark');acc.r(lx+4,ly-1,1,2,'woodDark');acc.r(lx,ly+1,5,7,'ink');acc.r(lx+1,ly+2,3,5,'gold');acc.r(lx+1,ly+2,1,4,'glow');acc.r(lx+2,ly+2,1,2,'cream');acc.r(lx,ly,5,2,'ochre');acc.r(lx,ly+7,5,1,'woodLight');acc.r(lx+1,ly+8,3,1,'woodDark');
 return [body.p,acc.p,face.p];
}
function reedling(f){
 const b=new Pixels(40,32),a=new Pixels(40,32),d=new Pixels(40,32),idle=f<6,k=idle?f:f-6,bob=idle?[0,0,1,1,0,0][k]:[0,0,-1,0,0,0,-1,0][k];
 const poly=(pts,c)=>b.poly(pts.map(([x,y])=>[x,y+bob]),c);
 // A long curling tail and four paws make the animal readable before details.
 const ty=idle?[0,0,0,1,1,0][k]:[0,1,2,1,0,-1,-2,-1][k];
 b.poly([[12,23],[7,25],[3,23+ty],[1,20+ty],[1,15+ty],[3,12+ty],[6,13+ty],[6,16+ty],[4,17+ty],[4,19+ty],[7,20],[12,19]],'ink');b.l(3,16+ty,3,20+ty,'waterDeep',2);b.l(4,21+ty,9,23,'waterLight');
 const gait=idle?[0,0]:[[5,-5],[2,-2],[-2,2],[-5,5],[-5,5],[-2,2],[2,-2],[5,-5]][k];
 for(const [x,far] of [[12,true],[29,true],[9,false],[26,false]]){let xx=x+(far?gait[1]:gait[0]),yy=idle?27:((far&&k<4)||(!far&&k>=4)?25:27);b.poly([[x-1,22],[x+3,22],[xx+2,yy],[xx+4,yy+2],[xx+3,yy+3],[xx-2,yy+3],[xx-2,27]],'ink');b.r(xx-1,yy,4,3,far?'deep':'waterDeep');b.r(xx+1,yy+2,2,1,'waterLight');}
 poly([[8,17],[12,13],[19,12],[24,10],[29,9],[34,11],[37,15],[38,20],[34,25],[28,27],[16,27],[9,25],[7,21]],'ink');
 poly([[10,17],[14,14],[21,14],[26,11],[30,11],[34,13],[36,17],[35,22],[31,25],[19,25],[12,24],[9,20]],'waterDeep');
 poly([[11,17],[15,15],[21,15],[23,17],[20,20],[13,21],[10,20]],'waterLight');
 poly([[16,23],[22,21],[27,18],[33,18],[35,21],[31,25],[21,25]],'ochre');poly([[21,22],[26,20],[33,19],[33,22],[29,24],[22,24]],'cream');
 // Asymmetric reed-shaped ears and facial plane, not a circular head.
 poly([[25,12],[24,7],[26,4],[29,7],[30,11]],'ink');poly([[26,10],[26,6],[28,8],[28,11]],'leafLight');
 poly([[28,11],[33,10],[35,12],[36,15],[39,16],[39,19],[35,21],[31,20],[28,17]],'deep');
 poly([[30,12],[33,12],[34,14],[37,16],[37,18],[34,19],[31,18],[29,16]],'leaf');
 if(idle&&k===4){d.l(32,14+bob,34,14+bob,'ink');}else{d.r(32,13+bob,3,2,'ink');d.r(33,13+bob,1,1,'gold');d.r(34,14+bob,1,1,'glow');}d.r(37,16+bob,2,2,'ink');d.l(34,19+bob,37,19+bob,'woodDark');d.r(30,17+bob,2,1,'coral');d.r(32,18+bob,2,1,'cream');
 // Layered moss mantle, leaf tips and two warm spores.
 for(const [x,y] of [[10,15],[16,12],[22,11]]){a.poly([[x-3,y+3+bob],[x-1,y-3+bob],[x+2,y-5+bob],[x+5,y-1+bob],[x+4,y+4+bob],[x+1,y+6+bob]],'pine');a.poly([[x-1,y+1+bob],[x+1,y-3+bob],[x+3,y-1+bob],[x+2,y+3+bob]],'leafLight');a.l(x+1,y-2+bob,x,y+3+bob,'moss');}
 a.r(14,12+bob,2,2,'coral');a.r(19,15+bob,2,2,'gold');a.r(18,15+bob,1,1,'cream');
 // A lantern bud suspended from branching antlers is the creature's signature.
 a.l(24,10+bob,22,6+bob,'woodDark');a.l(22,6+bob,17,3+bob,'ochre');a.l(22,6+bob,26,3+bob,'ochre');a.l(18,4+bob,18,1+bob,'gold');a.l(25,4+bob,27,1+bob,'gold');
 a.r(20,2+bob,4,6,'ink');a.r(21,3+bob,2,4,'gold');a.r(21,3+bob,1,3,'glow');a.r(20,2+bob,4,1,'woodLight');a.r(21,8+bob,2,1,'ochre');
 return [b.p,a.p,d.p];
}
function manifest(name,w,h,n,make){const ids=Array.from({length:n},(_,i)=>'frame-'+(i+1)),commands=[{type:'document.update',patch:{name}},{type:'palette.update',palette:Object.values(P)},{type:'layer.update',layerId:'layer-1',patch:{name:'Body • silhouette and weight'}},{type:'layer.add',layer:{id:'accents',name:'Cloth, leather & lantern'}},{type:'layer.add',layer:{id:'face',name:'Face & small highlights'}}];for(let i=0;i<n;i++){if(i===0)commands.push({type:'frame.update',frameId:ids[i],patch:{durationMs:180}});else commands.push({type:'frame.add',id:ids[i],afterFrameId:ids[i-1],durationMs:i<6?180:100});make(i).forEach((pixels,k)=>commands.push({type:'cel.set',layerId:['layer-1','accents','face'][k],frameId:ids[i],width:w,height:h,pixels}));}
 commands.push({type:'clip.update',clipId:'clip-1',patch:{name:'All poses',frameIds:ids}});commands.push({type:'clip.add',clip:{id:'idle',name:'Idle',frameIds:ids.slice(0,6),loop:true}});commands.push({type:'clip.add',clip:{id:'walk',name:'Walk',frameIds:ids.slice(6,14),loop:true}});if(n===20)commands.push({type:'clip.add',clip:{id:'jump',name:'Jump',frameIds:ids.slice(14),loop:false}});return commands;}
fs.writeFileSync('source/character/courier-v2.json',JSON.stringify(manifest('Willowmere — Mira, River Courier',32,48,20,courier)));
fs.writeFileSync('source/character/reedling-v2.json',JSON.stringify(manifest('Willowmere — Mosslight Reedling',40,32,14,reedling)));
fs.writeFileSync('exports/characters.json',JSON.stringify({courier:{width:32,height:48,baseline:46,clips:{Idle:[0,1,2,3,4,5],Walk:[6,7,8,9,10,11,12,13],Jump:[14,15,16,17,18,19]},durations:{Idle:180,Walk:100,Jump:100}},reedling:{width:40,height:32,baseline:30,clips:{Idle:[0,1,2,3,4,5],Walk:[6,7,8,9,10,11,12,13]},durations:{Idle:180,Walk:100}}},null,2));
console.log('New characters:20 courier frames;14 reedling frames;3 painted layers each');

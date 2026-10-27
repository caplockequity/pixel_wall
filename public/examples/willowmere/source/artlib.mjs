import fs from 'node:fs';
export const P=JSON.parse(fs.readFileSync(new URL('./palette.json',import.meta.url)));
export class Art {
 constructor(){this.c=[];this.layer='layer-1';this.frame='frame-1';}
 add(type,o){this.c.push({type,...o});}
 target(l,f='frame-1'){this.layer=l;this.frame=f;return this;}
 layerAdd(id,name){this.add('layer.add',{layer:{id,name}});this.layer=id;return this;}
 r(x,y,w,h,c){if(w>0&&h>0)this.add('draw.rect',{layerId:this.layer,frameId:this.frame,x:Math.round(x),y:Math.round(y),width:Math.max(1,Math.round(w)),height:Math.max(1,Math.round(h)),color:P[c]??c,filled:true});}
 p(points,c){this.add('draw.polygon',{layerId:this.layer,frameId:this.frame,points:points.map(([x,y])=>({x:Math.round(x),y:Math.round(y)})),color:P[c]??c,filled:true});}
 l(x,y,X,Y,c,size=1){this.add('draw.line',{layerId:this.layer,frameId:this.frame,from:{x:Math.round(x),y:Math.round(y)},to:{x:Math.round(X),y:Math.round(Y)},color:P[c]??c,size});}
 path(points,c,size){this.add('draw.stroke',{layerId:this.layer,frameId:this.frame,points:points.map(([x,y])=>({x,y})),color:P[c]??c,size,brush:'circle'});}
 text(x,y,text,c,scale=1){this.add('draw.text',{layerId:this.layer,frameId:this.frame,x,y,text,color:P[c]??c,scale,spacing:1});}
}
export function rand(seed){let a=seed>>>0;return ()=>{a=(a*1664525+1013904223)>>>0;return a/4294967296;};}
export function leafCluster(a,x,y,s,variant=0){
 const pts=[[0,10],[3,10],[3,5],[7,5],[7,2],[13,2],[13,0],[18,1],[20,4],[24,4],[24,8],[28,9],[27,14],[30,16],[27,21],[23,21],[23,24],[17,24],[15,22],[9,24],[5,21],[1,22],[-1,17]];
 const poly=(ps,c,dx=0,dy=0)=>a.p(ps.map(([u,v])=>[x+(u+dx)*s,y+(v+dy)*s]),c);
 poly(pts,'deep');
 poly([[1,10],[4,10],[4,6],[9,6],[9,3],[16,2],[20,6],[24,6],[25,11],[24,16],[26,18],[21,21],[15,20],[12,22],[7,20],[2,19]],'leafShadow');
 poly([[1,10],[4,10],[4,6],[9,6],[9,3],[16,2],[20,6],[23,6],[23,10],[20,14],[16,14],[14,17],[8,16],[7,18],[3,15]],'leaf');
 poly([[4,9],[7,9],[7,6],[11,6],[11,4],[16,4],[17,6],[20,7],[18,10],[14,9],[12,12],[7,11],[6,13],[3,12]],'leafLight');
 poly([[7,7],[11,7],[11,5],[15,5],[16,6],[12,8],[9,8]],'sunLeaf');
 for(let k=0;k<5;k++){let u=(k*7+variant*3)%21+3,v=(k*5+variant)%13+7;a.r(x+u*s,y+v*s,2*s,s,k%2?'leafLight':'leafShadow');}
}
export function tree(a,x,y,w=38,h=48,seed=1,canopy='canopy-a',ground='roots'){
 // x/y is the planted ground point. Trunk, roots and shadow never animate.
 const keep=a.layer;let s=w/38;a.target(ground);
 a.p([[x-15*s,y-2],[x-8*s,y-5],[x+12*s,y-5],[x+20*s,y],[x+11*s,y+5],[x-10*s,y+4]],'leafShadow');
 a.p([[x-3*s,y-25],[x+4*s,y-25],[x+3*s,y-5],[x+9*s,y+1],[x+3*s,y],[x,y-3],[x-8*s,y+2],[x-3*s,y-6]],'woodDark');
 a.r(x-2*s,y-24,3*s,20,'wood');a.l(x,y-17,x-9*s,y-28,'wood',2);a.l(x+1,y-13,x+10*s,y-24,'wood',2);a.l(x-2,y-8,x-2,y-20,'woodLight');
 a.target(canopy);leafCluster(a,x-19*s,y-h,s,seed);leafCluster(a,x-24*s,y-h+14*s,s*.8,seed+1);leafCluster(a,x-3*s,y-h+10*s,s*.72,seed+2);a.target(keep);
}
export function fir(a,x,y,w=28,h=55,canopy='canopy-b',ground='roots'){
 let save=a.layer;a.target(ground);a.p([[x-12,y],[x+4,y-4],[x+18,y+2],[x+5,y+5]],'leafShadow');a.r(x-2,y-23,5,24,'wood');a.r(x-1,y-19,1,18,'woodLight');a.target(canopy);
 const p=[[x,y-h],[x-7,y-h+14],[x-3,y-h+13],[x-w*.43,y-h+28],[x-7,y-h+27],[x-w*.6,y-8],[x-7,y-10],[x-8,y-5],[x+3,y-5],[x+5,y-8],[x+w*.6,y-7],[x+8,y-h+27],[x+12,y-h+27],[x+4,y-h+13],[x+7,y-h+14]];a.p(p,'deep');a.p([[x,y-h+2],[x-6,y-h+15],[x-2,y-h+14],[x-10,y-h+29],[x-5,y-h+28],[x-13,y-10],[x-3,y-11],[x+2,y-8],[x+1,y-h+22]],'leaf');
 for(let i=0;i<4;i++){let yy=y-h+14+i*8;a.l(x-3-i*2,yy,x-1,yy-2,'leafLight');}a.target(save);
}
export function rock(a,x,y,w=20,h=14){a.p([[x,y+h-3],[x+3,y+4],[x+w*.4,y],[x+w-4,y+2],[x+w,y+h-4],[x+w-4,y+h],[x+5,y+h]],'stoneDark');a.p([[x+3,y+4],[x+w*.4,y],[x+w-4,y+2],[x+w-7,y+7],[x+6,y+8]],'stoneLight');a.p([[x+6,y+8],[x+w-7,y+7],[x+w,y+h-4],[x+w-4,y+h],[x+6,y+h-2]],'stone');a.l(x+3,y+4,x+w*.4,y,'moss');a.r(x+2,y+h-4,6,3,'leaf');}
export function tuft(a,x,y,flower=false){a.l(x,y,x-2,y-4,'leafShadow');a.l(x+1,y,x+3,y-6,'leaf');a.l(x+3,y,x+6,y-3,'leafLight');if(flower){a.r(x+2,y-7,2,2,'coral');a.r(x+3,y-8,1,1,'gold');}}
export function lantern(a,x,y){a.r(x,y,2,16,'woodDark');a.l(x,y,x+7,y,'woodDark');a.r(x+6,y+1,1,3,'woodDark');a.r(x+4,y+4,5,7,'woodDark');a.r(x+5,y+5,3,4,'gold');a.r(x+5,y+5,1,3,'glow');a.r(x+4,y+10,5,1,'woodLight');}
export function house(a,x,y,w=42,h=42,variant=0){
 const roof=variant===1?'wood':'coral', lit=variant===1?'woodLight':'coralLight';
 a.p([[x+4,y+h],[x+w+8,y+h-1],[x+w+13,y+h+6],[x+8,y+h+8]],'leafShadow');
 a.r(x+3,y+16,w-6,h-16,'woodDark');a.r(x+5,y+18,w-10,h-20,'cream');a.r(x+w-13,y+18,10,h-19,'ochre');
 a.r(x+6,y+h-8,w-12,5,'stone');for(let k=9;k<w-13;k+=10)a.r(x+k,y+h-8,1,5,'stoneDark');
 a.r(x+6,y+20,2,h-28,'wood');a.r(x+6,y+27,w-13,2,'wood');a.r(x+w/2-1,y+18,2,h-26,'wood');
 a.p([[x-3,y+17],[x+w*.42,y],[x+w*.62,y],[x+w+3,y+17],[x+w+1,y+21],[x-2,y+21]],'woodDark');
 a.p([[x-1,y+16],[x+w*.43,y+1],[x+w*.61,y+1],[x+w,y+16]],roof);a.l(x,y+15,x+w*.45,y+1,lit,2);a.l(x+1,y+18,x+w,y+18,roof,2);
 for(let yy=7;yy<=15;yy+=4){let k=(17-yy)*.9;a.l(x+k,y+yy,x+w-k,y+yy,'coralDark');for(let q=k+4;q<w-k;q+=9)a.l(x+q,y+yy,x+q-2,y+yy+3,lit);}
 a.r(x+w-12,y-1,5,13,'stoneDark');a.r(x+w-12,y-1,3,12,'stone');a.r(x+w-13,y-2,7,3,'stoneLight');
 a.r(x+12,y+h-18,9,15,'woodDark');a.r(x+14,y+h-16,5,11,'wood');a.r(x+18,y+h-10,1,1,'gold');
 a.r(x+w-18,y+24,8,8,'woodDark');a.r(x+w-17,y+25,6,5,'gold');a.r(x+w-14,y+25,1,5,'wood');a.r(x+w-19,y+32,10,2,'wood');
}
export function wheel(a,x,y,r=15,phase=0){const pt=(n,rad)=>[x+Math.cos(n)*rad,y+Math.sin(n)*rad];let outer=[],inner=[];for(let i=0;i<16;i++){outer.push(pt(i*Math.PI/8,r));inner.push(pt(i*Math.PI/8,r-3));}a.p(outer,'woodDark');a.p(inner,'waterDeep');for(let i=0;i<8;i++){let an=i*Math.PI/4+phase;a.l(...pt(an,3),...pt(an,r-2),'woodLight',2);let q=pt(an,r);a.r(q[0]-2,q[1]-2,4,3,'wood');}a.r(x-3,y-3,7,7,'woodDark');a.r(x-1,y-1,3,3,'gold');}

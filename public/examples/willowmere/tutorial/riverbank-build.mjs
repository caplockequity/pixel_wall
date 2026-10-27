import fs from 'node:fs';
import {Art, P} from './artlib.mjs';

// A deliberately small tutorial scene: one planted tree, a bank, and an animated river.
// All artwork is authored as PixelWall commands; no raster is imported.
const a = new Art();
const layers = [
  ['bank', 'Anchored riverbank'],
  ['roots', 'Anchored tree roots'],
  ['trunk', 'Tree trunk'],
  ['canopy', 'Swaying canopy'],
  ['water', 'River water'],
  ['ripples', 'Flowing ripples'],
  ['reeds', 'Bank accents']
];
a.add('palette.update', {palette: Object.values(P)});
a.add('layer.update', {layerId:'layer-1', patch:{name:'Riverbank sky'}});
a.r(0,0,128,96,'sky');
for (const [id,name] of layers) a.layerAdd(id,name);

// Static first frame: irregular bank, anchored roots, trunk and canopy.
a.target('bank');
a.p([[0,0],[128,0],[128,55],[116,57],[106,54],[94,58],[81,56],[68,59],[55,55],[43,59],[30,55],[18,58],[0,54]],'grass');
a.p([[0,55],[14,51],[29,56],[43,53],[58,57],[72,52],[87,56],[104,51],[128,55],[128,96],[0,96]],'soil');
a.p([[0,70],[17,66],[34,70],[49,66],[67,71],[82,66],[100,70],[128,66],[128,96],[0,96]],'earth');
a.p([[0,57],[13,53],[28,58],[43,55],[57,59],[73,54],[89,58],[105,53],[128,57],[128,61],[105,58],[89,63],[73,59],[57,64],[43,60],[28,63],[13,58],[0,62]],'moss');
// Anchored roots and trunk never receive cel.move.
a.target('roots');
a.p([[30,57],[38,55],[48,57],[54,62],[50,66],[43,64],[37,67],[29,64],[24,66],[21,63]],'woodDark');
a.target('trunk');
a.r(35,25,10,34,'woodDark'); a.r(38,26,5,31,'wood');
a.l(40,42,29,31,'wood',2); a.l(42,39,52,28,'woodLight',2); a.l(38,52,31,57,'woodLight');
// Layered canopy gives the tutorial a clear ±1 px animation target.
a.target('canopy');
a.p([[14,27],[18,16],[27,17],[30,9],[41,7],[47,14],[58,13],[65,23],[59,33],[45,30],[38,35],[28,31],[20,35]],'deep');
a.p([[18,25],[21,17],[29,18],[31,12],[40,10],[46,16],[56,15],[61,23],[55,29],[45,27],[38,32],[29,28],[21,31]],'leaf');
a.p([[25,20],[30,16],[37,15],[41,18],[48,17],[54,20],[49,23],[42,22],[38,26],[30,24]],'leafLight');
a.r(29,18,3,2,'sunLeaf'); a.r(44,17,3,2,'sunLeaf'); a.r(53,22,2,2,'sunLeaf');
// Small anchored reeds are static; the separate Lua pass adds a 16×16 editable detail.
a.target('reeds');
for (const [x,y] of [[8,64],[15,62],[112,61],[120,65]]) { a.l(x,y,x-2,y-8,'leafShadow'); a.l(x+1,y,x+4,y-10,'leaf'); a.l(x+2,y,x+7,y-6,'leafLight'); }

// Water base exists before links so every static layer has a real source cel.
for (const id of ['frame-1']) { a.target('water',id); a.p([[0,68],[16,64],[33,68],[49,64],[67,69],[83,64],[101,68],[128,64],[128,96],[0,96]],'waterDeep'); a.p([[0,73],[17,69],[33,73],[50,69],[67,74],[84,69],[101,73],[128,69],[128,96],[0,96]],'water'); }

// Build twelve frames at 100 ms. Static cels are linked; only canopy and ripples animate.
const frames = ['frame-1'];
for (let i=1;i<12;i++) { const id=`flow-${i+1}`; frames.push(id); a.add('frame.add',{id,afterFrameId:frames[i-1],durationMs:100}); }
a.add('frame.update',{frameId:'frame-1',patch:{durationMs:100}});
for (const id of ['layer-1','bank','roots','trunk','canopy','water','reeds']) a.add('cel.link',{layerId:id,sourceFrameId:'frame-1',frameIds:frames.slice(1)});
a.add('clip.update',{clipId:'clip-1',patch:{name:'Riverbank • 1.2s',frameIds:frames,loop:true}});
// Water base is linked into every frame; ripple highlights move downstream.
for (let f=0; f<12; f++) {
  const id=frames[f]; a.target('canopy',id); a.add('cel.move',{layerId:'canopy',frameId:id,x:Math.round(Math.sin(f*Math.PI/6)),y:0});
  a.target('ripples',id);
  for(let row=0;row<3;row++)for(let col=0;col<4;col++){const y=[75,83,92][row],x=(col*32+row*7+f*32/12)%128;a.l(x,y,x+[5,8,4][row],y,row===1?'foam':'waterLight');}
}
fs.writeFileSync(new URL('./riverbank-commands.json', import.meta.url), JSON.stringify(a.c,null,2));
console.log(`wrote ${a.c.length} PixelWall commands for ${frames.length} frames`);

/** Compact, deterministic selection encodings for regional edits. */
const integer = (v,label) => { if (!Number.isSafeInteger(v)) throw Error(`${label} must be an integer.`); return v; };
export function rectangleSelection({x=0,y=0,width,height}, canvasWidth, canvasHeight) {
  integer(x,'x'); integer(y,'y'); integer(width,'width'); integer(height,'height');
  if (width<1||height<1||x<0||y<0||x+width>canvasWidth||y+height>canvasHeight) throw Error('Rectangle selection is outside the canvas.');
  return {type:'rect',x,y,width,height};
}
export function polygonSelection(points, canvasWidth, canvasHeight) {
  if (!Array.isArray(points)||points.length<3||points.length>65536) throw Error('Polygon selection requires 3–65536 points.');
  const normalized=points.map((point,index)=>({x:integer(point?.x,`points[${index}].x`),y:integer(point?.y,`points[${index}].y`)}));
  if (normalized.some(({x,y})=>x<0||y<0||x>=canvasWidth||y>=canvasHeight)) throw Error('Polygon selection point is outside the canvas.');
  return {type:'polygon',points:normalized};
}
export function encodeSelectionMask(mask, width, height) {
  if (!Array.isArray(mask)||mask.length!==width*height) throw Error('Selection mask dimensions do not match the canvas.');
  const runs=[]; let start=0, value=Boolean(mask[0]);
  for(let i=1;i<=mask.length;i++){const next=i<mask.length&&Boolean(mask[i]);if(i===mask.length||next!==value){runs.push([start,i-start,value?1:0]);start=i;value=next;}}
  return {type:'rle',width,height,runs};
}
export function decodeSelection(selection, width, height) {
  const mask=new Uint8Array(width*height);
  if (selection?.type==='rect') { const rect=rectangleSelection(selection,width,height); for(let y=rect.y;y<rect.y+rect.height;y++) mask.fill(1,y*width+rect.x,y*width+rect.x+rect.width); return mask; }
  if (selection?.type==='rle') { if(selection.width!==width||selection.height!==height) throw Error('RLE selection dimensions do not match the canvas.'); let offset=0; for(const run of selection.runs||[]){if(!Array.isArray(run)||run.length!==3||!Number.isSafeInteger(run[1])||run[1]<1||![0,1].includes(run[2])||run[0]!==offset) throw Error('Invalid RLE selection run.'); offset+=run[1]; if(offset>mask.length) throw Error('RLE selection exceeds the canvas.'); if(run[2]) mask.fill(1,run[0],offset);} if(offset!==mask.length) throw Error('RLE selection does not cover the canvas.'); return mask; }
  if (selection?.type==='polygon') { const poly=polygonSelection(selection.points,width,height); for(let y=0;y<height;y++) for(let x=0;x<width;x++){let inside=false; for(let i=0,j=poly.points.length-1;i<poly.points.length;j=i++){const a=poly.points[i],b=poly.points[j]; if(((a.y>y)!==(b.y>y))&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x) inside=!inside;} if(inside) mask[y*width+x]=1;} return mask; }
  if(Array.isArray(selection)) { if(selection.length!==width*height) throw Error('Selection mask dimensions do not match the canvas.'); return Uint8Array.from(selection.map(value=>value?1:0)); }
  throw Error('Unsupported selection encoding.');
}
export function applyColorMapping(document, {selection, mapping, width=document.width, height=document.height} = {}) {
  const mask=decodeSelection(selection,width,height); if(!mapping||typeof mapping!=='object') throw Error('A color mapping is required.');
  const next=structuredClone(document); for(const image of Object.values(next.images)) for(let i=0;i<image.pixels.length;i++){const x=i%image.width,y=Math.floor(i/image.width); if(x>=width||y>=height||!mask[y*width+x]) continue; const pixel=image.pixels[i]; const replacement=Object.hasOwn(mapping,pixel??'null')?mapping[pixel??'null']:undefined; if(replacement!==undefined) image.pixels[i]=replacement;}
  return next;
}

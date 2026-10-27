/** Compact, deterministic selection encodings for regional edits. */
const dimensions = (width,height) => { if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>4194304)throw Error('Selection canvas must contain 1–4194304 pixels.'); };
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
  dimensions(width,height);
  const mask=new Uint8Array(width*height);
  if (selection?.type==='rect') { const rect=rectangleSelection(selection,width,height); for(let y=rect.y;y<rect.y+rect.height;y++) mask.fill(1,y*width+rect.x,y*width+rect.x+rect.width); return mask; }
  if (selection?.type==='rle') { if(selection.width!==width||selection.height!==height) throw Error('RLE selection dimensions do not match the canvas.'); let offset=0; for(const run of selection.runs||[]){if(!Array.isArray(run)||run.length!==3||!Number.isSafeInteger(run[1])||run[1]<1||![0,1].includes(run[2])||run[0]!==offset) throw Error('Invalid RLE selection run.'); offset+=run[1]; if(offset>mask.length) throw Error('RLE selection exceeds the canvas.'); if(run[2]) mask.fill(1,run[0],offset);} if(offset!==mask.length) throw Error('RLE selection does not cover the canvas.'); return mask; }
  if (selection?.type==='polygon') {
    const {points}=polygonSelection(selection.points,width,height);
    const top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
    if((bottom-top)*points.length>33554432)throw Error('Polygon selection exceeds the scanline work limit; simplify its boundary.');
    // Match the integer-coordinate even/odd rule without scanning every pixel against every edge.
    for(let y=top;y<bottom;y++) {
      const crossings=[];
      for(let i=0,j=points.length-1;i<points.length;j=i++) {
        const a=points[i],b=points[j];
        if((a.y>y)!==(b.y>y))crossings.push((b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x);
      }
      crossings.sort((a,b)=>a-b);
      for(let i=0;i+1<crossings.length;i+=2)mask.fill(1,y*width+Math.ceil(crossings[i]),y*width+Math.ceil(crossings[i+1]));
    }
    return mask;
  }
  if(Array.isArray(selection)) { if(selection.length!==width*height) throw Error('Selection mask dimensions do not match the canvas.'); return Uint8Array.from(selection.map(value=>value?1:0)); }
  throw Error('Unsupported selection encoding.');
}

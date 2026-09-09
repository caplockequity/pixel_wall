/** Original CC0 independent native-library conformance corpus. */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const path = fileURLToPath(new URL('.', import.meta.url)), executable = process.env.ROTATION_ORACLE;
if (!executable) throw Error('Set ROTATION_ORACLE to the locally compiled oracle adapter.');
let seed = 748192;
const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
const cases = [], formats = ['rgba', 'grayscale', 'indexed', 'bitmap'];
function pixelsFor(format, n, transparent) {
  if (format === 'rgba') return Array.from({ length: n }, () => ((random(256)) | (random(256) << 8) | (random(256) << 16) | ([0, 1, 64, 128, 192, 254, 255][random(7)] << 24)) >>> 0);
  if (format === 'grayscale') return Array.from({ length: n }, () => random(256) | ([0, 64, 128, 255][random(4)] << 8));
  if (format === 'indexed') return Array.from({ length: n }, () => random(4) === 0 ? transparent : random(256));
  return Array.from({ length: n }, () => random(2));
}
for (const [fi, format] of formats.entries()) for (let i = 0; i < 32; i++) {
 const w = 1 + random(11), h = 1 + random(9), dw = 24, dh = 23;
 const maskColor = format === 'indexed' ? [0, 7, 255][i % 3] : 0;
 const pixels = pixelsFor(format, w * h, maskColor), mask = i % 3 === 0 ? null : Array.from({ length: w * h }, (_, at) => i % 3 === 1 ? +(at % w === (at / w | 0) || at % w === 0) : random(2));
 const origin = [random(18) - 5, random(18) - 5], ax = random(15) - 7, ay = random(13) - 6, bx = random(13) - 6, by = random(15) - 7;
 const corners = [origin, [origin[0] + ax, origin[1] + ay], [origin[0] + ax + bx, origin[1] + ay + by], [origin[0] + bx, origin[1] + by]];
 for (const method of ['fast', 'rotsprite']) cases.push({ name: `${format}-${i}-${method}`, method, pixelFormat: format, nativeFormat: fi, width: w, height: h, destinationWidth: dw, destinationHeight: dh, maskColor, pixels, mask, corners });
}
// Exact one-pixel destinations, fully outside, flat degeneracy and half-open edges.
for (const [index, corners] of [[[0,0],[1,0],[1,1],[0,1]], [[-2,-2],[1,-2],[1,1],[-2,1]], [[30,30],[35,30],[35,35],[30,35]], [[0,0],[4,4],[8,8],[4,4]], [[0,0],[5,0],[5,1],[0,1]]].entries()) for (const method of ['fast','rotsprite']) cases.push({ name:`edge-${index}-${method}`,method,pixelFormat:'rgba',nativeFormat:0,width:2,height:2,destinationWidth:index===0?1:8,destinationHeight:index===0?1:8,maskColor:0,pixels:[0xff0000ff,0xff00ff00,0xffff0000,0xffffffff],mask:[1,1,0,1],corners });
const protocol = cases.map(c=>[c.method==='fast'?0:1,c.nativeFormat,c.width,c.height,c.destinationWidth,c.destinationHeight,c.maskColor,c.mask?1:0,...c.corners.flat(),...c.pixels,...(c.mask??[])].join(' ')).join('\n')+'\n';
const result=spawnSync(executable,{input:protocol,encoding:'utf8',maxBuffer:64*1024*1024});
if(result.status!==0)throw Error(result.stderr||`Oracle failed ${result.status}`);
const lines=result.stdout.trim().split('\n');if(lines.length!==cases.length)throw Error('Oracle output count mismatch.');
for(const [i,c]of cases.entries()) { c.expected=lines[i].trim().split(' ').map(Number); if(c.expected.length!==c.destinationWidth*c.destinationHeight)throw Error('Oracle dimensions mismatch.'); delete c.nativeFormat; }
writeFileSync(path+'extended-vectors.json',JSON.stringify({oracle:'Aseprite 1.3.18.5-dev MIT doc library; original CC0 adapter; deterministic seed 748192',cases})+'\n');
console.log(`Generated ${cases.length} independent output cases; original corpus retained separately.`);

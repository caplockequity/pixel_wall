import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { decodeProjectContainer } from '../app/project-format.mjs';
import { applyCommand, normalizeDocument, renderFrame } from '../app/editor-core.mjs';
import { readPng } from '../app/formats.mjs';
const run = promisify(execFile), root = dirname(fileURLToPath(import.meta.url));
const fixture = join(root, '../public/examples/reliable-workflow'), projectPath = join(fixture, 'build/reliable-riverbank.pixelwall');
const doc = normalizeDocument(decodeProjectContainer(await readFile(projectPath)));
assert.equal(doc.width, 96); assert.equal(doc.height, 64); assert.equal(doc.frames.length, 12);
assert.deepEqual(new Set(doc.layers.map(l => l.name)), new Set(['Ground','River','River bank','Tree trunk','Animated canopy']));
assert.equal(doc.clips.find(c => c.id === 'riverbank-loop')?.frameIds.length, 12);
const staticIds = ['ground','river','bank','trunk'].map(id => doc.frames.map(f => f.cels[id]?.imageId));
for (const ids of staticIds) assert.equal(new Set(ids).size, 1, 'static layers must stay linked');
const canopyOffsets = doc.frames.map(f => `${f.cels.canopy.x},${f.cels.canopy.y}`); assert.ok(new Set(canopyOffsets).size > 1, 'canopy should move');
const framesDir = join(fixture, 'build/verified-frames'); await mkdir(framesDir, {recursive:true});
for (let i=0;i<doc.frames.length;i++) {
  const expected = renderFrame(doc, doc.frames[i].id); const out = join(framesDir, `frame-${String(i+1).padStart(2,'0')}.png`);
  await run(process.execPath, [join(root, '../app/cli.mjs'), 'render', projectPath, '--frame', String(i), '--out', out], {cwd:join(root,'..')});
  const actual = readPng(await readFile(out)); assert.deepEqual([...actual.rgba], [...expected], `CLI render mismatch at frame ${i+1}`);
}
const firstFrameId = doc.frames[0].id;
const before = renderFrame(doc, firstFrameId);
const recolored = applyCommand(doc, {type:'selection.replaceColors', selection:{type:'rect',x:35,y:0,width:4,height:64}, mapping:{'#b59b62ff':'#d6b875ff'}, frameIds:[firstFrameId]});
const after = renderFrame(recolored, firstFrameId); let changed=0;
for(let p=0;p<before.length;p+=4){const x=(p/4)%doc.width; if(x<35||x>=39) assert.deepEqual([...after.slice(p,p+4)],[...before.slice(p,p+4)]); else if(before[p]!==after[p]||before[p+1]!==after[p+1]||before[p+2]!==after[p+2]) changed++;}
assert.ok(changed>0, 'late recolor should affect selected pixels');
console.log(JSON.stringify({project:projectPath,frames:12,cliRendered:12,lateRecolorChangedPixels:changed,checkpoint:'reopen-and-render manually in desktop/MCP'}));

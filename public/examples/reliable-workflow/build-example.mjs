import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDocument, applyCommand, normalizeDocument, renderFrame } from '../../../app/editor-core.mjs';
import { encodeProjectContainer } from '../../../app/project-format.mjs';
import { writePng } from '../../../app/formats.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const out = process.env.PIXELWALL_EXAMPLE_OUT || join(root, 'build');
await mkdir(join(out, 'frames'), { recursive: true });
let doc = createDocument({ id: 'reliable-riverbank', name: 'Reliable Riverbank', width: 96, height: 64 });
const add = (id, name) => { doc = applyCommand(doc, { type: 'layer.add', layer: { id, name, type: 'image' } }); };
add('ground', 'Ground'); add('river', 'River'); add('bank', 'River bank'); add('trunk', 'Tree trunk'); add('canopy', 'Animated canopy');
// createDocument includes a starter layer; remove it so the starter's layer list is intentional.
doc = applyCommand(doc, { type: 'layer.remove', layerId: 'layer-1' });
const rect = (layerId, x, y, width, height, color, frameId) => { doc = applyCommand(doc, { type: 'draw.rect', layerId, frameId, x, y, width, height, color, filled: true }); };
const f0 = doc.frames[0].id;
rect('ground', 0, 0, 96, 64, '#24433bff', f0);
rect('river', 39, 0, 18, 64, '#2d7f9bff', f0);
rect('bank', 35, 0, 4, 64, '#b59b62ff', f0); rect('bank', 57, 0, 4, 64, '#b59b62ff', f0);
rect('bank', 35, 0, 1, 64, '#d3be7cff', f0); rect('bank', 60, 0, 1, 64, '#836b4aff', f0);
for (const [x,y,w] of [[42,7,7],[45,16,5],[41,27,9],[47,39,6],[42,51,8]]) rect('river', x, y, w, 1, '#86c7c1ff', f0);
for (const [x,y,w] of [[4,51,10],[26,57,8],[70,12,12],[75,43,9]]) rect('ground', x, y, w, 2, '#2f6047ff', f0);
rect('trunk', 14, 15, 6, 35, '#6b432fff', f0); rect('trunk', 18, 19, 13, 4, '#6b432fff', f0);
rect('trunk', 74, 28, 4, 25, '#6b432fff', f0); rect('trunk', 70, 33, 8, 3, '#6b432fff', f0);
rect('canopy', 7, 8, 24, 14, '#3d7547ff', f0); rect('canopy', 11, 4, 15, 8, '#5b9950ff', f0); rect('canopy', 14, 7, 7, 4, '#a5c568ff', f0);
rect('canopy', 66, 18, 21, 14, '#3d7547ff', f0); rect('canopy', 70, 14, 14, 8, '#5b9950ff', f0); rect('canopy', 74, 18, 6, 4, '#a5c568ff', f0);
const frameIds = [f0];
for (let i = 1; i < 12; i++) { const id = `frame-${String(i + 1).padStart(2, '0')}`; doc = applyCommand(doc, { type: 'frame.add', id, durationMs: 125 }); frameIds.push(id); for (const layerId of ['ground', 'river', 'bank', 'trunk', 'canopy']) doc = applyCommand(doc, { type: 'cel.link', layerId, sourceFrameId: f0, frameId: id }); doc = applyCommand(doc, { type: 'cel.move', layerId: 'canopy', frameId: id, x: i % 3 === 0 ? 1 : i % 3 === 1 ? 0 : -1, y: i % 4 < 2 ? 0 : 1 }); }
doc = applyCommand(doc, { type: 'clip.add', clip: { id: 'riverbank-loop', name: 'Riverbank loop', frameIds, direction: 'forward', loop: true } });
doc.metadata = { ...doc.metadata, example: { workflow: 'reliable-workflow', artDirection: 'warm riverbank with restrained canopy sway', commands: 'build-example.mjs', linkedStaticLayers: ['ground', 'river', 'bank', 'trunk'], animatedLayers: ['canopy'] } };
doc = normalizeDocument(doc);
await writeFile(join(out, 'reliable-riverbank.pixelwall'), encodeProjectContainer(doc));
for (let i = 0; i < frameIds.length; i++) await writeFile(join(out, 'frames', `frame-${String(i + 1).padStart(2, '0')}.png`), writePng(doc.width, doc.height, renderFrame(doc, frameIds[i])));
await writeFile(join(out, 'manifest.json'), JSON.stringify({ name: doc.name, document: 'reliable-riverbank.pixelwall', width: doc.width, height: doc.height, frames: frameIds, clip: 'riverbank-loop', linkedStaticLayers: ['ground', 'river', 'bank', 'trunk'], animatedLayers: ['canopy'] }, null, 2));
console.log(JSON.stringify({ out, frames: frameIds.length, width: doc.width, height: doc.height }));

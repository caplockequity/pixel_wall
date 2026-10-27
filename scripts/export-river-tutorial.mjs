import { writeFile } from 'node:fs/promises';
import { applyCommand, createDocument, renderFrame } from '../app/editor-core.mjs';
import { writePng } from '../app/formats.mjs';
import { encodeProjectContainer } from '../app/project-format.mjs';

// A reproducible large canvas example: shapes for broad areas, small Lua detail later.
const target = { frameId: 'frame-1' };
const commands = [
  { type: 'layer.update', layerId: 'layer-1', patch: { name: 'Ground' } },
  { type: 'draw.rect', ...target, layerId: 'layer-1', x: 0, y: 0, width: 600, height: 350, filled: true, color: '#315b40ff' },
  { type: 'layer.add', layer: { id: 'river', name: 'River' } },
  { type: 'draw.polygon', ...target, layerId: 'river', filled: true, color: '#b4ad7dff', points: [{ x: 250, y: 0 }, { x: 455, y: 0 }, { x: 340, y: 140 }, { x: 430, y: 350 }, { x: 180, y: 350 }, { x: 225, y: 160 }] },
  { type: 'draw.polygon', ...target, layerId: 'river', filled: true, color: '#397b9aff', points: [{ x: 270, y: 0 }, { x: 435, y: 0 }, { x: 320, y: 140 }, { x: 410, y: 350 }, { x: 200, y: 350 }, { x: 245, y: 160 }] },
  { type: 'layer.add', layer: { id: 'details', name: 'Rocks and ripples' } },
];
for (let n = 0; n < 24; n++) {
  commands.push({ type: 'draw.line', ...target, layerId: 'details', from: { x: 272 + (n % 3) * 14, y: 12 + n * 14 }, to: { x: 285 + (n % 3) * 14, y: 12 + n * 14 }, size: 2, color: '#78bdcaff' });
}
for (const [x, y] of [[210, 45], [430, 80], [195, 210], [440, 270], [150, 305]]) {
  commands.push({ type: 'draw.ellipse', ...target, layerId: 'details', x, y, width: 26, height: 16, filled: true, color: '#6e7772ff' });
  commands.push({ type: 'draw.line', ...target, layerId: 'details', from: { x: x + 6, y: y + 4 }, to: { x: x + 16, y: y + 4 }, color: '#b1b7a7ff', size: 2 });
}
let document = createDocument({ id: 'river-tutorial', name: 'River workflow', width: 600, height: 350 });
for (const command of commands) document = applyCommand(document, command);
const output = new URL('../public/examples/', import.meta.url);
await writeFile(new URL('agent-river-commands.json', output), JSON.stringify(commands, null, 2) + '\n');
await writeFile(new URL('agent-river.pixelwall', output), encodeProjectContainer(document));
await writeFile(new URL('agent-river.png', output), writePng(document.width, document.height, renderFrame(document, document.frames[0].id)));
console.log(`River tutorial: ${commands.length} commands, ${document.layers.length} named layers, 600 × 350 pixels.`);

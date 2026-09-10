import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCommand, createDocument, renderFrame } from '../app/editor-core.mjs';
import { writePng } from '../app/formats.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/examples');
const black = '#171628ff', white = '#f8f0dfff', red = '#ef3340ff', gold = '#ffe66dff', wood = '#8b5a2bff';
const commands = [
  { type: 'frame.add', id: 'idle-2', afterFrameId: 'frame-1', durationMs: 180 },
  { type: 'frame.add', id: 'idle-3', afterFrameId: 'idle-2', durationMs: 180 },
  { type: 'clip.update', clipId: 'clip-1', patch: { name: 'Idle', frameIds: ['frame-1', 'idle-2', 'idle-3'], direction: 'pingpong', loop: true } },
];

function draw(frameId, offset, pose) {
  const target = { frameId, layerId: 'layer-1' };
  commands.push(
    { type: 'draw.ellipse', ...target, x: 3, y: 1 + offset, width: 6, height: 6, color: black, filled: true },
    { type: 'draw.ellipse', ...target, x: 15, y: 1 + offset, width: 6, height: 6, color: black, filled: true },
    { type: 'draw.ellipse', ...target, x: 5, y: 2 + offset, width: 14, height: 13, color: black, filled: true },
    { type: 'draw.ellipse', ...target, x: 7, y: 4 + offset, width: 10, height: 9, color: white, filled: true },
    { type: 'draw.rect', ...target, x: 5, y: 5 + offset, width: 14, height: 2, color: red, filled: true },
    { type: 'draw.line', ...target, from: { x: 18, y: 6 + offset }, to: { x: 22, y: 3 + offset + pose }, color: red, size: 2 },
    { type: 'draw.ellipse', ...target, x: 8, y: 7 + offset, width: 4, height: 3, color: black, filled: true },
    { type: 'draw.ellipse', ...target, x: 13, y: 7 + offset, width: 4, height: 3, color: black, filled: true },
    { type: 'draw.rect', ...target, x: 10, y: 8 + offset, width: 1, height: 1, color: white, filled: true },
    { type: 'draw.rect', ...target, x: 14, y: 8 + offset, width: 1, height: 1, color: white, filled: true },
    { type: 'draw.rect', ...target, x: 11, y: 10 + offset, width: 3, height: 2, color: black, filled: true },
    { type: 'draw.ellipse', ...target, x: 6, y: 13 + offset, width: 12, height: 9, color: black, filled: true },
    { type: 'draw.ellipse', ...target, x: 9, y: 15 + offset, width: 6, height: 6, color: white, filled: true },
    { type: 'draw.line', ...target, from: { x: 7, y: 15 + offset }, to: { x: 3, y: 18 + offset }, color: black, size: 3 },
    { type: 'draw.line', ...target, from: { x: 17, y: 15 + offset }, to: { x: 20, y: 12 + offset - pose }, color: black, size: 3 },
    { type: 'draw.ellipse', ...target, x: 5, y: 20 + offset, width: 6, height: 3, color: black, filled: true },
    { type: 'draw.ellipse', ...target, x: 14, y: 20 + offset, width: 6, height: 3, color: black, filled: true },
    { type: 'draw.line', ...target, from: { x: 19, y: 11 + offset - pose }, to: { x: 21, y: 8 + offset - pose }, color: wood, size: 2 },
    { type: 'draw.line', ...target, from: { x: 21, y: 7 + offset - pose }, to: { x: 22 - pose, y: 5 + offset }, color: gold, size: 1 },
    { type: 'draw.line', ...target, from: { x: 22 - pose, y: 4 + offset }, to: { x: 20 - pose * 2, y: 1 + offset }, color: wood, size: 2 },
  );
}

draw('frame-1', 0, 0);
draw('idle-2', 1, 1);
draw('idle-3', 0, -1);

let document = createDocument({ name: 'Ninja Panda Idle', width: 24, height: 24, palette: ['#00000000', black, white, red, gold, wood] });
for (const command of commands) document = applyCommand(document, command);
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'agent-ninja-panda-commands.json'), JSON.stringify(commands, null, 2) + '\n');
await writeFile(resolve(output, 'agent-ninja-panda.pixelwall'), JSON.stringify(document, null, 2) + '\n');
await writeFile(resolve(output, 'agent-ninja-panda.png'), writePng(document.width, document.height, renderFrame(document, document.frames[0].id)));
console.log(`Agent example: ${commands.length} commands, ${document.frames.length} frames`);

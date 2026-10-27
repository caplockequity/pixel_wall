import { mkdir, writeFile } from 'node:fs/promises';
import { applyCommand, renderFrame } from '../app/editor-core.mjs';
import { generateWaterScene } from '../app/water-generator.mjs';
import { encodeProjectContainer } from '../app/project-format.mjs';
import { writePng } from '../app/formats.mjs';

const base = { type: 'scene.water', scene: 'river', view: 'top-down', season: 'summer', seed: 17, waterSeed: 23, frames: 1, details: 2 };
const commands = [
  { type: 'scene.component', kind: 'bridge', style: 'summer', seed: 7, position: { x: 73, y: 65 }, size: { width: 110, height: 24 }, id: 'bridge' },
  { type: 'scene.component', kind: 'tree', style: 'summer', seed: 31, position: { x: 18, y: 12 }, size: { width: 34, height: 46 }, id: 'tree-northwest' },
  { type: 'scene.component', kind: 'tree', style: 'summer', seed: 32, position: { x: 204, y: 6 }, size: { width: 36, height: 50 }, id: 'tree-northeast' },
  { type: 'scene.component', kind: 'tree', style: 'summer', seed: 33, position: { x: 48, y: 0 }, size: { width: 28, height: 38 }, id: 'tree-north' },
  { type: 'scene.component', kind: 'tree', style: 'summer', seed: 34, position: { x: 216, y: 103 }, size: { width: 28, height: 40 }, id: 'tree-southeast' },
  { type: 'scene.component', kind: 'rock', style: 'summer', seed: 44, position: { x: 72, y: 103 }, size: { width: 22, height: 14 }, id: 'rock-west' },
  { type: 'scene.component', kind: 'rock', style: 'summer', seed: 45, position: { x: 173, y: 102 }, size: { width: 22, height: 14 }, id: 'rock-east' },
];
let document = generateWaterScene({ ...base, id: 'scene-component-example', width: 256, height: 160, name: 'Woodland Crossing Components' });
for (const command of commands) document = applyCommand(document, command);
const projectBytes = encodeProjectContainer(document), preview = writePng(document.width, document.height, renderFrame(document, document.frames[0].id));
const manifest = { name: document.name, width: document.width, height: document.height, base, commands };
await mkdir('/Volumes/DevStorage/Builds/pixelwall/agent-studio-050/preview', { recursive: true });
await mkdir(new URL('../public/examples/', import.meta.url), { recursive: true });
for (const path of ['/Volumes/DevStorage/Builds/pixelwall/agent-studio-050/preview/scene-components-woodland.pixelwall', new URL('../public/examples/scene-components-woodland.pixelwall', import.meta.url)]) await writeFile(path, projectBytes);
for (const path of ['/Volumes/DevStorage/Builds/pixelwall/agent-studio-050/preview/scene-components-woodland.png', new URL('../public/examples/scene-components-woodland.png', import.meta.url)]) await writeFile(path, preview);
await writeFile('/Volumes/DevStorage/Builds/pixelwall/agent-studio-050/preview/scene-components-commands.json', `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(new URL('../public/examples/scene-components-commands.json', import.meta.url), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ projectBytes: projectBytes.length, previewBytes: preview.length, layers: document.layers.length, images: Object.keys(document.images).length }));

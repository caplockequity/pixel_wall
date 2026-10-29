import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/examples');
const work = resolve(process.argv[2] ?? resolve(root, 'work/ninja-panda'));
const palette = { ink: '#171628ff', shadow: '#514b60ff', cream: '#f8f0dfff', light: '#fffaf0ff', gray: '#b5aabaFF', red: '#ef3340ff', rose: '#ff6b57ff', darkRed: '#a8294aff', gold: '#ffe66dff', wood: '#ad7046ff', darkWood: '#704332ff' };
const commands = [
  { type: 'frame.add', id: 'idle-2', afterFrameId: 'frame-1', durationMs: 180 },
  { type: 'frame.add', id: 'idle-3', afterFrameId: 'idle-2', durationMs: 180 },
  { type: 'clip.update', clipId: 'clip-1', patch: { name: 'Idle', frameIds: ['frame-1', 'idle-2', 'idle-3'], direction: 'pingpong', loop: true } },
];
function draw(frameId, pose) {
  const target = { frameId, layerId: 'layer-1' };
  const rect = (x, y, width, height, color) => commands.push({ type: 'draw.rect', ...target, x, y, width, height, color: palette[color], filled: true });
  const ellipse = (x, y, width, height, color) => commands.push({ type: 'draw.ellipse', ...target, x, y, width, height, color: palette[color], filled: true });
  // Feet, round torso, belly and two dark paws. Keep the head/torso connected.
  ellipse(6, 19, 5, 4, 'ink'); ellipse(13, 19, 5, 4, 'ink');
  rect(7, 20, 2, 1, 'shadow'); rect(14, 20, 2, 1, 'shadow');
  ellipse(6, 12, 12, 10, 'ink'); ellipse(8, 14, 8, 6, 'gray'); ellipse(9, 14, 7, 5, 'cream');
  rect(11, 15, 3, 1, 'light');
  ellipse(4, 13, 5, 6, 'ink'); rect(5, 14, 2, 2, 'shadow'); rect(5, 17, 2, 1, 'gray');
  ellipse(15, 13, 5, 5, 'ink'); rect(17, 14, 2, 1, 'shadow');
  // Rounded ears behind an outlined, shaded face.
  ellipse(4, 1, 5, 5, 'ink'); ellipse(14, 1, 5, 5, 'ink');
  rect(5, 2, 2, 1, 'shadow'); rect(16, 2, 1, 2, 'shadow');
  ellipse(4, 2, 15, 13, 'ink'); ellipse(5, 3, 13, 11, 'gray'); ellipse(5, 3, 12, 10, 'cream');
  rect(8, 3, 6, 1, 'light');
  // Headband sits above the eyes; two tails flick behind the right ear.
  rect(5, 4, 13, 2, 'red'); rect(7, 4, 8, 1, 'rose'); rect(17, 5, 2, 2, 'darkRed');
  rect(19, 4 + pose, 2, 1, 'red'); rect(21, 3 + pose, 1, 1, 'rose'); rect(19, 6 + pose, 2, 1, 'red');
  // Slanted eye patches with bright eyes, a tiny nose, and a soft muzzle.
  ellipse(6, 7, 4, 4, 'ink'); ellipse(13, 7, 4, 4, 'ink');
  rect(8, 8, 1, 1, 'light'); rect(14, 8, 1, 1, 'light');
  rect(7, 10, 1, 1, 'shadow'); rect(15, 10, 1, 1, 'shadow');
  rect(10, 10, 3, 1, 'ink'); rect(11, 11, 1, 1, 'ink');
  rect(10, 12, 1, 1, 'shadow'); rect(12, 12, 1, 1, 'shadow');
  rect(9, 11, 1, 1, 'light'); rect(13, 11, 1, 1, 'light');
  // Two wooden nunchuck handles connected by a small gold chain.
  const lift = pose === 1 ? 1 : 0;
  rect(19, 15 - lift, 2, 6, 'darkWood'); rect(19, 16 - lift, 1, 4, 'wood'); rect(19, 15 - lift, 2, 1, 'gold');
  rect(20, 14 - lift, 1, 1, 'gold'); rect(21, 13 - lift, 1, 1, 'gold'); rect(21, 12 - lift, 1, 1, 'gold');
  rect(21, 7 - lift, 2, 5, 'darkWood'); rect(21, 8 - lift, 1, 3, 'wood'); rect(21, 7 - lift, 2, 1, 'gold');
  // Paw crosses the near handle so the grip reads clearly.
  rect(18, 16 - lift, 2, 2, 'ink'); rect(18, 16 - lift, 2, 1, 'gray');
}
draw('frame-1', 0); draw('idle-2', 1); draw('idle-3', -1);
await mkdir(output, { recursive: true }); await mkdir(work, { recursive: true });
const batch = resolve(output, 'agent-ninja-panda-commands.json');
const project = resolve(output, 'agent-ninja-panda.pixelwall');
await writeFile(batch, JSON.stringify(commands, null, 2) + '\n');
const cli = (...args) => execFileSync(process.execPath, [resolve(root, 'app/cli.mjs'), ...args], { cwd: root, stdio: 'inherit' });
cli('new', '--width', '24', '--height', '24', '--duration', '180', '--name', 'Ninja Panda Idle', '--out', project);
cli('apply', project, '--commands', batch, '--out', project);
cli('render', project, '--frame', '0', '--out', resolve(output, 'agent-ninja-panda.png'));
cli('render', project, '--frame', '0', '--scale', '16', '--out', resolve(work, 'ninja-panda-final.png'));
// Separate review render on the homepage's cream background; the real sprite stays transparent.
const previewBatch = resolve(work, 'cream-preview.json');
await writeFile(previewBatch, JSON.stringify([{ type: 'draw.rect', frameId: 'frame-1', layerId: 'layer-1', x: 0, y: 0, width: 24, height: 24, color: palette.cream, filled: true }, ...commands]));
const previewProject = resolve(work, 'cream-preview.pixelwall');
cli('new', '--width', '24', '--height', '24', '--out', previewProject);
cli('apply', previewProject, '--commands', previewBatch, '--out', previewProject);
cli('render', previewProject, '--frame', '0', '--scale', '16', '--out', resolve(work, 'cream-preview.png'));
cli('verify', project);
console.log(`Agent example: ${commands.length} commands, 3 frames, drawn and exported by PixelWall CLI.`);

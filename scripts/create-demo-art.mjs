import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng } from '../app/formats.mjs';

// Author with PixelWall commands, then use its CLI renders as the shared starter.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = resolve(process.argv[2] ?? resolve(root, 'work/desert-signal'));
await mkdir(work, { recursive: true });
const cli = (...args) => execFileSync(process.execPath, [resolve(root, 'app/cli.mjs'), ...args], { cwd: root, stdio: 'inherit' });
const colors = { night: '#262447ff', dusk: '#3c315fff', purple: '#7059c7ff', coral: '#ff6b57ff', sand: '#ffb34bff', light: '#ffe66dff', mint: '#70d6b2ff', teal: '#218c89ff', ink: '#16152bff', white: '#f8f0dfff' };
const commands = [
  { type: 'frame.add', id: 'sunset-2', afterFrameId: 'frame-1', durationMs: 125 },
  { type: 'frame.add', id: 'sunset-3', afterFrameId: 'sunset-2', durationMs: 125 },
  { type: 'clip.update', clipId: 'clip-1', patch: { name: 'Sunset', frameIds: ['frame-1', 'sunset-2', 'sunset-3'], direction: 'forward', loop: true } },
];
for (const [frameIndex, frameId] of ['frame-1', 'sunset-2', 'sunset-3'].entries()) {
  const target = { frameId, layerId: 'layer-1' };
  const rect = (x, y, width, height, color) => commands.push({ type: 'draw.rect', ...target, x, y, width, height, color: colors[color], filled: true });
  const line = (x, y, x2, y2, color) => commands.push({ type: 'draw.line', ...target, from: { x, y }, to: { x: x2, y: y2 }, color: colors[color], size: 1 });
  // Dusk, a stepped sun, and distant mesas.
  rect(0, 0, 16, 16, 'night'); rect(0, 4, 16, 4, 'dusk'); rect(0, 8, 16, 4, 'coral');
  rect(10, 2, 4, 6, 'sand'); rect(9, 3, 6, 4, 'sand');
  rect(10, 3, 4, 4, 'light'); rect(11, 2, 2, 1, 'light');
  rect(0, 8, 2, 3, 'purple'); rect(1, 7, 3, 4, 'purple'); rect(3, 9, 4, 3, 'purple'); rect(6, 10, 4, 3, 'purple');
  rect(12, 8, 2, 3, 'dusk'); rect(14, 7, 2, 4, 'dusk');
  // Warm sand catches the light above a darker foreground ridge.
  rect(0, 12, 16, 4, 'sand'); rect(6, 11, 10, 1, 'sand'); rect(10, 10, 6, 1, 'sand');
  line(11, 10, 15, 10, 'light'); line(7, 11, 10, 11, 'light');
  rect(0, 14, 10, 2, 'coral'); rect(0, 13, 7, 1, 'coral'); rect(10, 15, 4, 1, 'coral');
  // Saguaro: dark left edge, arms, and a narrow sunlit edge.
  rect(4, 6, 2, 8, 'ink'); rect(5, 7, 1, 6, 'teal'); rect(2, 8, 1, 3, 'ink'); rect(3, 10, 1, 2, 'ink');
  rect(6, 9, 2, 2, 'ink'); rect(7, 7, 1, 3, 'ink'); rect(7, 7, 1, 2, 'teal'); rect(6, 9, 1, 1, 'teal');
  rect(5, 7, 1, 2, 'mint'); rect(3, 14, 5, 1, 'dusk');
  // Scrub and pebbles; subtle glimmers leave the landscape still.
  rect(11, 13, 2, 1, 'coral'); rect(12, 12, 1, 1, 'light');
  rect(14, 14, 1, 2, 'ink'); rect(13, 15, 3, 1, 'ink'); rect(15, 14, 1, 1, 'teal');
  rect(2, 2, 1, 1, frameIndex === 1 ? 'white' : 'sand');
  if (frameIndex === 1) { rect(2, 1, 1, 1, 'purple'); rect(1, 2, 1, 1, 'purple'); }
  rect(6, 1, 1, 1, frameIndex === 2 ? 'white' : 'purple'); rect(8 + frameIndex, 12, 1, 1, 'light');
}
const batch = resolve(root, 'public/examples/desert-signal-commands.json');
const project = resolve(work, 'desert-signal-source.pixelwall');
await writeFile(batch, JSON.stringify(commands, null, 2) + '\n');
cli('new', '--width', '16', '--height', '16', '--duration', '125', '--name', 'Desert Signal', '--out', project);
cli('apply', project, '--commands', batch, '--out', project);
const frames = [];
for (let frame = 0; frame < 3; frame++) {
  const output = resolve(work, `frame-${frame}.png`);
  cli('render', project, '--frame', String(frame), '--out', output);
  const { rgba } = readPng(new Uint8Array(await readFile(output)));
  frames.push(Array.from({ length: 256 }, (_, index) => '#' + Array.from(rgba.slice(index * 4, index * 4 + 3), value => value.toString(16).padStart(2, '0')).join('')));
}
await writeFile(resolve(root, 'app/demo-art-frames.json'), JSON.stringify(frames) + '\n');
cli('render', project, '--frame', '0', '--scale', '24', '--out', resolve(work, 'desert-signal-preview.png'));
cli('verify', project);
console.log(`Desert Signal: ${commands.length} PixelWall commands; shared browser pixels rendered by the CLI.`);

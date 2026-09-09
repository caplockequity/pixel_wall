/** Original CC0 test inputs and native oracle invocation. Run from the repo root:
 * ASEPRITE=/path/to/aseprite node tests/fixtures/cli-scopes/generate-oracle.mjs */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readPng } from '../../../app/formats.mjs';
const executable = process.env.ASEPRITE;
if (!executable) throw Error('Set ASEPRITE to the independent oracle binary.');
const directory = dirname(fileURLToPath(import.meta.url)), output = join(directory, 'native');
mkdirSync(output, { recursive: true });
execFileSync(executable, ['--batch', '--script-param', `directory=${directory}`, '--script', join(directory, 'generate.lua')]);
const A = 'alpha.aseprite', B = 'beta.aseprite';
const cases = {
  'layer-before-all': ['--layer', 'base', A, B],
  'layer-between': [A, '--layer', 'hat', B],
  'layer-after-all': [A, B, '--layer', 'hat'],
  'layer-accumulates': ['--layer', 'base', A, '--layer', 'hat', B],
  'repeated-layer-alias': ['--layer', 'base', '--import-layer', 'hat', A, B],
  'split-before-all': ['--split-layers', A, B],
  'split-between': [A, '--split-layers', B],
  'split-after-all': [A, B, '--split-layers'],
  'all-layers-before': ['--all-layers', A, B],
  'all-layers-between': [A, '--all-layers', B],
  'ignore-before': ['--ignore-layer', 'hat', A, B],
  'ignore-between': [A, '--ignore-layer', 'hat', B],
  'ignore-accumulates': ['--ignore-layer', 'hat', A, '--ignore-layer', 'base', B],
  'tag-before-all': ['--tag', 'early', A, B],
  'tag-between': [A, '--tag', 'late', B],
  'tag-replaces': ['--tag', 'early', A, '--frame-tag', 'late', B],
  'tag-after-all': [A, B, '--tag', 'late'],
  'range-before-all': ['--frame-range', '1,1', A, B],
  'range-between': [A, '--frame-range', '1,1', B],
  'range-replaces': ['--frame-range', '0,0', A, '--frame-range', '2,2', B],
  'range-after-all': [A, B, '--frame-range', '2,2'],
  'combined-scopes': ['--layer', 'base', '--tag', 'early', A, '--layer', 'hat', '--tag', 'late', '--all-layers', B],
};
const jobs = [];
for (const [name, args] of Object.entries(cases)) {
  const png = join(output, `${name}.png`), json = join(output, `${name}.json`);
  const nativeArgs = ['--batch', ...args.map(value => [A, B].includes(value) ? join(directory, value) : value), '--format', 'json-array', '--filename-format', '{title}|{layer}|{frame}', '--sheet-type', 'horizontal', '--sheet', png, '--data', json];
  execFileSync(executable, nativeArgs);
  const metadata = JSON.parse(readFileSync(json)), image = readPng(readFileSync(png));
  const expected = metadata.frames.map(frame => {
    const rgba = [];
    for (let y = frame.frame.y; y < frame.frame.y + frame.frame.h; y++) rgba.push(...image.rgba.subarray((y * image.width + frame.frame.x) * 4, (y * image.width + frame.frame.x + frame.frame.w) * 4));
    return { source: frame.filename.split('|')[0] + '.aseprite', nativeFilename: frame.filename, width: frame.frame.w, height: frame.frame.h, durationMs: frame.duration, rgba };
  });
  jobs.push({ name, argv: args, expected });
}
const hash = filename => createHash('sha256').update(readFileSync(join(directory, filename))).digest('hex');
const result = {
  provenance: { license: 'CC0-1.0', origin: 'Original numerical sprites and fixture scripts authored for PixelWall on 2026-09-09; no vendor code or sample art included.', oracle: String(execFileSync(executable, ['--version'])).trim(), officialSource: 'https://github.com/aseprite/aseprite/releases/download/v1.3.18.5/Aseprite-v1.3.18.5-Source.zip', reference: 'https://www.aseprite.org/docs/cli/', method: 'Run ordered command tokens against the native Aseprite executable, decode its PNG, and retain every RGBA byte, dimension, duration and source order. Native filenames are retained for inspection but not claimed identical.', sourceHashes: Object.fromEntries(['alpha.aseprite', 'beta.aseprite', 'generate.lua'].map(name => [name, hash(name)])) },
  jobs,
};
writeFileSync(join(directory, 'oracle.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Recorded ${jobs.length} native ordered-scope cases.`);

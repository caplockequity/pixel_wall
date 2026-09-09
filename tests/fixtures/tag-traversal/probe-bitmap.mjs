// Original CC0 bitmap sequence fixture generator. Run from repository root.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { readBmp, readTga } from '../../../app/formats.mjs';
const folder = 'tests/fixtures/tag-traversal', results = [];
for (const format of ['bmp', 'tga']) {
  const directory = `${folder}/exports/reverse-bitmap-${format}`;
  mkdirSync(directory, { recursive: true });
  const args = ['--batch', '--play-subtags', '--tag', 'clip', `${folder}/reverse-2.aseprite`, '--save-as', `${directory}/frame01.${format}`];
  execFileSync(process.env.ASEPRITE_BIN, args);
  const frames = readdirSync(directory).sort().map(file => ({ frame: (format === 'bmp' ? readBmp : readTga)(readFileSync(`${directory}/${file}`)).rgba[0] / 40 - 1 }));
  results.push({ fixture: 'reverse-2', format, subtags: true, tag: 'clip', args, frames });
}
writeFileSync(`${folder}/cli-bitmap-vectors.json`, JSON.stringify(results, null, 2) + '\n');

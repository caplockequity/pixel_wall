/** Original CC0 oracle driver; set ASEPRITE_ORACLE to an independently built binary. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const folder = fileURLToPath(new URL('.', import.meta.url));
const exe = process.env.ASEPRITE_ORACLE;
if (!exe) throw Error('Set ASEPRITE_ORACLE to an Aseprite executable.');
const run = args => execFileSync(exe, ['--batch', ...args], { cwd: folder, stdio: 'pipe' });
for (const script of ['geometry.lua', 'special.lua', 'linked.lua', 'flags.lua']) run(['--script-param', `directory=${folder}`, '--script', join(folder, script)]);
// Native Lua palette API exposes only frame-one palettes. Add one original
// palette-key chunk using the published file format, then let native Aseprite
// independently load/resize/render it. Expected pixels never use PixelWall codecs.
{
 const file = join(folder, 'linked-indexed.aseprite'), bytes = readFileSync(file);
 const frame2 = 128 + bytes.readUInt32LE(128), chunk = Buffer.alloc(32);
 chunk.writeUInt32LE(32, 0); chunk.writeUInt16LE(0x2019, 4);
 chunk.writeUInt32LE(4, 6); chunk.writeUInt32LE(1, 10); chunk.writeUInt32LE(1, 14);
 chunk.set([30, 220, 250, 255], 28);
 const output = Buffer.concat([bytes.subarray(0, frame2 + 16), chunk, bytes.subarray(frame2 + 16)]);
 output.writeUInt32LE(output.length, 0); output.writeUInt32LE(bytes.readUInt32LE(frame2) + chunk.length, frame2);
 output.writeUInt16LE(bytes.readUInt16LE(frame2 + 6) + 1, frame2 + 6);
 if (bytes.readUInt32LE(frame2 + 12)) output.writeUInt32LE(bytes.readUInt32LE(frame2 + 12) + 1, frame2 + 12);
 writeFileSync(file, output);
}
const scales = [.25, .5, .67, 1.25, 1.5, 1.75, 2, 2.2], cases = [];
for (const name of ['geometry', 'tilemap', 'slice', 'linked-rgba', 'linked-indexed', 'linked-grayscale', 'reference', 'linear', ...Array.from({length:8},(_,i)=>`flag-${i}`)]) {
 const source = name === 'linear' ? '../export-color/source.aseprite' : `${name}.aseprite`;
 for (const scale of scales) {
  const base = `${name}-${scale}`, native = `${base}.aseprite`;
  run([source, '--scale', String(scale), '--save-as', native]);
  if (name === 'linear') run([native, '--script-param', `prefix=${join(folder, base)}`, '--script', join(folder, 'render.lua')]);
  else run([source, '--scale', String(scale), '--filename-format', `${base}-{frame1}.png`, '--save-as', `${base}.png`]);
  const pngs = readdirSync(folder).filter(file => file.startsWith(`${base}-`) && file.endsWith('.png')).sort();
  cases.push({ name, scale, source, native, pngs });
 }
}
// Independent trimmed and selected-slice outputs after native fractional geometry.
for (const options of [{name:'trim', source:'linked-rgba', args:['--trim']}, {name:'slice', source:'slice', args:['--slice','detail']}]) {
 const base = `selection-${options.name}`;
 run([`${options.source}.aseprite`, '--scale', '1.5', ...options.args, '--filename-format', `${base}-{frame1}.png`, '--save-as', `${base}.png`]);
 cases.push({ name: base, scale: 1.5, source: `${options.source}.aseprite`, options: options.name==='trim'?{trim:true}:{slice:'detail'}, pngs: readdirSync(folder).filter(file=>file.startsWith(`${base}-`)&&file.endsWith('.png')).sort() });
}
writeFileSync(join(folder,'oracle.json'),JSON.stringify({version:run(['--version']).toString().trim(),scales,cases},null,2)+'\n');
const sha256=Object.fromEntries(readdirSync(folder).filter(name=>name!=='manifest.json').map(name=>[name,createHash('sha256').update(readFileSync(join(folder,name))).digest('hex')]));
writeFileSync(join(folder,'manifest.json'),JSON.stringify({license:'CC0-1.0',origin:'Original numerical geometry/tile/palette fixtures and oracle driver authored for PixelWall interoperability verification. Reference fixture and indexed second-frame palette key were constructed with the documented Aseprite binary format and accepted/re-saved/rendered by native Aseprite. Linear fixture is the adjacent original export-color CC0 fixture. No vendor artwork or implementation code included.',oracle:{version:'Aseprite 1.3.18.5-dev',apiVersion:41,officialSource:'https://github.com/aseprite/aseprite/releases/download/v1.3.18.5/Aseprite-v1.3.18.5-Source.zip',binaryRedistributed:false},primaryDocs:['https://www.aseprite.org/docs/cli/','https://github.com/aseprite/api/blob/main/api/sprite.md#spriteresize','https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md'],method:'Create source sprites with native Lua API; use native CLI --scale followed by native .aseprite and PNG exports. Geometry state and independent PNG bytes are both asserted. For custom ICC, native Lua composites the resized working-profile sprite then converts that flat image to sRGB. Integer reference inclusion is a PixelWall opt-in difference; default native reference-only PNG is transparent.',sha256},null,2)+'\n');

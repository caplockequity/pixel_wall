import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync } from 'fflate';
import { main, buildCliExportOutputs } from '../app/cli.mjs';
import { createDocument, normalizeDocument, applyCommand } from '../app/editor-core.mjs';
import { readPng, readBmp, readTga, importGif, readAseprite } from '../app/formats.mjs';
import { createGammaProfile } from '../app/color-management.mjs';
import { loadNodeColorManager } from '../app/color-runtime-node.mjs';

process.env.PIXELWALL_PRO_LICENSE = '';
function sprite(name = 'sprite') {
  const doc = createDocument({ width: 3, height: 2, name });
  doc.layers = [{ ...doc.layers[0], id: 'red', name: 'red' }, { ...doc.layers[0], id: 'blue', name: 'blue', visible: false }];
  doc.images = { r: { width: 1, height: 1, pixels: ['#ff0000ff'] }, b: { width: 1, height: 1, pixels: ['#0000ffff'] } };
  doc.frames = [{ id: 'f0', durationMs: 80, cels: { red: { imageId: 'r', x: 0, y: 0, opacity: 1 }, blue: { imageId: 'b', x: 2, y: 0, opacity: 1 } } }, { id: 'f1', durationMs: 120, cels: { red: { imageId: 'b', x: 1, y: 1, opacity: 1 } } }];
  doc.clips = [{ id: 'one', name: 'walk', frameIds: ['f0', 'f1'], direction: 'reverse' }, { id: 'two', name: 'idle', frameIds: ['f0'], direction: 'forward' }];
  return normalizeDocument(doc);
}
async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'pixelwall-cli-driver-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  async function source(name = 'hero', doc = sprite(name)) { const path = join(folder, `${name}.pixelwall`); await writeFile(path, JSON.stringify(doc)); return path; }
  return { folder, source };
}
const absent = async path => assert.rejects(access(path));
const pixels = (image, x, y) => [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

test('real main exports every input and frame into a sequence directory', async t => {
  const run = await fixture(t), first = await run.source('first'), second = await run.source('second'), out = join(run.folder, 'frames');
  await main(['export', first, second, '--format', 'png', '--out-dir', out]);
  assert.deepEqual((await readdir(out)).sort(), ['first 0.png', 'first 1.png', 'second 0.png', 'second 1.png']);
  assert.deepEqual(pixels(readPng(await readFile(join(out, 'first 0.png'))), 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixels(readPng(await readFile(join(out, 'second 1.png'))), 1, 1), [0, 0, 255, 255]);
});
test('known boolean flags do not consume following input filenames', async t => {
  const run = await fixture(t), source = await run.source(), out = join(run.folder, 'split');
  await main(['export', '--split-layers', source, '--all-layers', '--format', 'png', '--out-dir', out]);
  assert.equal((await readdir(out)).length, 4);
  const single = join(run.folder, 'one.png');
  await main(['export', '--all-layers=false', source, '--format', 'png', '--out', single]);
  assert.deepEqual(pixels(readPng(await readFile(single)), 2, 0), [0, 0, 0, 0]);
});
test('repeated layer aliases are unioned and exclusions override them in the real driver', async t => {
  const run = await fixture(t), source = await run.source(), out = join(run.folder, 'selected.png');
  await main(['export', source, '--layer', 'red', '--import-layer', 'blue', '--ignore-layer', 'red', '--format', 'png', '--out', out]);
  const image = readPng(await readFile(out));
  assert.deepEqual(pixels(image, 0, 0), [0, 0, 0, 0]); assert.deepEqual(pixels(image, 2, 0), [0, 0, 255, 255]);
});
test('single-file raster export keeps frame-zero behavior and never drops an explicit frame range', async t => {
  const run = await fixture(t), source = await run.source(), out = join(run.folder, 'one.png');
  await main(['export', source, '--format', 'png', '--out', out]); const previous = await readFile(out);
  await assert.rejects(main(['export', source, '--frame-range', '0,1', '--format', 'png', '--out', out]), /out-dir/);
  assert.deepEqual(await readFile(out), previous);
  await assert.rejects(main(['export', source, await run.source('second'), '--format', 'png', '--out', out]), /out-dir/);
  assert.deepEqual(await readFile(out), previous);
});
test('directory output rejects existing files before creating any other frame', async t => {
  const run = await fixture(t), source = await run.source(), out = join(run.folder, 'existing');
  await main(['export', source, '--frame', '1', '--format', 'png', '--out-dir', out, '--filename-format', '{title} {sourceframe}']);
  const previous = await readFile(join(out, 'hero 1.png'));
  await assert.rejects(main(['export', source, '--format', 'png', '--out-dir', out]), /already exists/);
  await absent(join(out, 'hero 0.png')); assert.deepEqual(await readFile(join(out, 'hero 1.png')), previous);
});
test('sanitized filename collisions are refused before creating the output directory', async t => {
  const run = await fixture(t), doc = sprite(); doc.layers[0].name = 'A/B'; doc.layers[1].name = 'A:B'; doc.layers[1].visible = true;
  const source = await run.source('collision', doc), out = join(run.folder, 'collide');
  await assert.rejects(main(['export', source, '--split-layers', '--format', 'png', '--out-dir', out]), /collide/); await absent(out);
});
test('frame range, crop, scale and templates produce all BMP/TGA sequence bytes without a second scale', async t => {
  const run = await fixture(t), source = await run.source();
  for (const [format, decode] of [['bmp', readBmp], ['tga', readTga]]) {
    const out = join(run.folder, format);
    await main(['export', source, '--format', format, '--out-dir', out, '--frame-range', '1,1', '--crop', '1,1,1,1', '--scale', '3', '--filename-format', '{title}-{sourceframe}']);
    const image = decode(await readFile(join(out, `hero-1.${format}`)));
    assert.equal(image.width, 3); assert.equal(image.height, 3); assert.deepEqual(pixels(image, 2, 2), [0, 0, 255, 255]);
  }
});
test('numeric filename placeholders after dots remain distinct sequence filenames', async t => {
  const run = await fixture(t), source = await run.source(), out = join(run.folder, 'numbered');
  await main(['export', source, '--format', 'png', '--out-dir', out, '--filename-format', '{title}.{frame001}']);
  assert.deepEqual((await readdir(out)).sort(), ['hero.001.png', 'hero.002.png']);
});
test('empty ignored selection creates no output and no directory', async t => {
  const run = await fixture(t), source = await run.source('empty', createDocument({ width: 2 })), out = join(run.folder, 'empty-output');
  await assert.rejects(main(['export', '--ignore-empty', source, '--format', 'png', '--out-dir', out]), /No frames matched/); await absent(out);
});
test('every paid multi-input/split export still requires real ownership before touching output', async t => {
  const run = await fixture(t), first = await run.source('first'), second = await run.source('second');
  for (const format of ['gif', 'sheet', 'atlas', 'zip']) {
    const path = join(run.folder, `${format}-output`), destination = format === 'gif' ? '--out-dir' : '--out';
    for (const proof of [[], ['--license', 'PW2.fake.forged']]) {
      await assert.rejects(main(['export', '--split-tags', first, second, '--format', format, destination, path, ...proof]), /valid PixelWall Pro license/); await absent(path);
    }
  }
});
test('native editable multi-input output requires a directory and preserves each whole project', async t => {
  const run = await fixture(t), first = await run.source('first'), second = await run.source('second'), out = join(run.folder, 'native');
  await assert.rejects(main(['export', first, second, '--format', 'aseprite', '--out', join(run.folder, 'lost.aseprite')]), /every input/);
  await main(['export', first, second, '--format', 'aseprite', '--out-dir', out]);
  assert.deepEqual((await readdir(out)).sort(), ['first.aseprite', 'second.aseprite']);
  assert.equal(readAseprite(await readFile(join(out, 'second.aseprite'))).document.frames.length, 2);
});
test('each input profile is converted to sRGB while original project bytes remain untouched', async t => {
  const run = await fixture(t), manager = await loadNodeColorManager();
  const base = applyCommand(createDocument({ width: 1, height: 1 }), { type: 'draw.stroke', points: [{ x: 0, y: 0 }], color: '#808080ff' });
  const linear = manager.assignProfile(base, manager.readProfile(createGammaProfile(1)));
  const first = await run.source('srgb', base), second = await run.source('linear', linear), out = join(run.folder, 'managed');
  const before = await readFile(second);
  await main(['export', first, second, '--format', 'png', '--out-dir', out]);
  assert.deepEqual(pixels(readPng(await readFile(join(out, 'srgb.png'))), 0, 0), [128, 128, 128, 255]);
  assert.deepEqual(pixels(readPng(await readFile(join(out, 'linear.png'))), 0, 0), [188, 188, 188, 255]);
  assert.deepEqual(await readFile(second), before);
});
test('real Lua CLI still runs a sandboxed script and saves its command results', async t => {
  const run = await fixture(t), source = await run.source(), script = join(run.folder, 'edit.lua'), out = join(run.folder, 'lua.pixelwall');
  await writeFile(script, 'app.activeSprite.filename = "Lua driver test"\napp.activeImage:drawPixel(0,0,Color{r=0,g=255,b=0,a=255})');
  await main(['script', source, '--script', script, '--out', out]);
  const saved = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(saved.images.r.pixels[0], '#00ff00ff');
});

test('Lua multi-project output preflights every path before writing and never replaces existing work', async t => {
  const run = await fixture(t), source = await run.source(), script = join(run.folder, 'multiple.lua'), out = join(run.folder, 'lua-results');
  await writeFile(script, 'app.activeSprite.filename = "First"\nlocal second = Sprite(2,2)\nsecond.filename = "Second"');
  await mkdir(out);
  const existing = join(out, '002-Second.pixelwall');
  await writeFile(existing, 'keep this artwork');
  await assert.rejects(main(['script', source, '--script', script, '--out-dir', out]), /already exists/);
  assert.deepEqual(await readdir(out), ['002-Second.pixelwall']);
  assert.equal(await readFile(existing, 'utf8'), 'keep this artwork');
  const clean = join(run.folder, 'complete');
  await main(['script', source, '--script', script, '--out-dir', clean]);
  assert.deepEqual((await readdir(clean)).sort(), ['001-First.pixelwall', '002-Second.pixelwall']);
  assert.equal(JSON.parse(await readFile(join(clean, '001-First.pixelwall'), 'utf8')).name, 'First');
  assert.equal(JSON.parse(await readFile(join(clean, '002-Second.pixelwall'), 'utf8')).width, 2);
});

// These pure-codec tests exercise output construction only, not licensed CLI access.
test('atlas/sheet builder uses source-aware planner metadata without retrimming or rescaling', () => {
  for (const format of ['atlas', 'sheet']) {
    const first = sprite('first'), second = sprite('second');
    const built = buildCliExportOutputs([{ document: first, filename: 'first.aseprite' }, { document: second, filename: 'second.aseprite' }], { format, out: 'sprites.png', scale: 2, trim: true, 'inner-padding': 1, 'metadata-format': 'json-array', 'shape-padding': 0, 'border-padding': 0 });
    const metadata = JSON.parse(new TextDecoder().decode(built.outputs.find(output => output.kind === 'metadata').data));
    assert.equal(metadata.frames.length, 4); assert.equal(metadata.meta.sources.length, 2);
    assert.deepEqual(metadata.frames[0].sourceSize, { w: 6, h: 4 });
    assert.equal(metadata.frames[0].frame.w, 4); // two colored pixels wide after scale + two padding pixels
    assert.equal(metadata.frames[0].innerPadding, 1);
    assert.equal(metadata.frames[2].source.inputIndex, 1);
    assert.equal(metadata.frames[2].source.frameId, 'f0');
  }
});
test('GIF builder emits independent tag jobs in native default timeline order and durations', () => {
  const built = buildCliExportOutputs([{ document: sprite(), filename: 'hero.aseprite' }], { format: 'gif', 'split-tags': true, 'out-dir': 'animations' });
  assert.deepEqual(built.outputs.map(output => output.name), ['hero (walk).gif', 'hero (idle).gif']);
  const walk = importGif(built.outputs[0].data).document;
  assert.deepEqual(walk.frames.map(frame => frame.durationMs), [80, 120]);
});
test('multi-input ZIP preserves every original project, scoped frame IDs, and separate source packages', () => {
  const first = sprite('first'), second = sprite('second'), original = structuredClone(second); original.metadata.custom = { keep: true };
  const built = buildCliExportOutputs([{ document: first, filename: 'first.aseprite', originalDocument: first }, { document: second, filename: 'second.aseprite', originalDocument: original }], { format: 'zip', 'frame-range': '1,1' });
  const files = unzipSync(built.outputs[0].data), json = name => JSON.parse(new TextDecoder().decode(files[name])), sourceMeta = json('sources.json'), atlas = json('sprites.json');
  assert.equal(sourceMeta.sources.length, 2); assert.equal(Object.keys(atlas.frames).length, 2);
  assert.equal(json(sourceMeta.sources[1].project).metadata.custom.keep, true);
  assert.deepEqual(sourceMeta.jobs.map(job => job.sourceFrameIds), [['f1'], ['f1']]);
  for (const source of sourceMeta.sources) {
    assert.ok(files[source.gamePackage]); const manifest = json(source.gamePackage);
    assert.deepEqual(manifest.frames.map(frame => frame.frameId), ['f1']);
  }
});
test('single-input ZIP keeps existing game-package manifest/project/frames plus source metadata', () => {
  const built = buildCliExportOutputs([{ document: sprite('single'), filename: 'single.aseprite' }], { format: 'zip' });
  const files = unzipSync(built.outputs[0].data), manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  assert.equal(manifest.version, 1); assert.ok(files[manifest.project]); assert.equal(manifest.frames.length, 2); assert.ok(files['sources.json']);
});

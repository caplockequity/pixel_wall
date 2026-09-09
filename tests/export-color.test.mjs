import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as constants from 'lcms-wasm';
import { unzipSync } from 'fflate';
import { createColorManager, documentProfile } from '../app/color-management.mjs';
import { renderExportFrame, toExportRGBA } from '../app/export-render.mjs';
import { createDocument, normalizeDocument, applyCommand, renderFrame } from '../app/editor-core.mjs';
import { readAseprite, writeAseprite, readPng, readBmp, readTga, importGif, makeGamePackage } from '../app/formats.mjs';
import { planExport } from '../app/cli-export-plan.mjs';
import { main, buildCliExportOutputs } from '../app/cli.mjs';

const folder = new URL('./fixtures/export-color/', import.meta.url);
const oracle = JSON.parse(await readFile(new URL('expected.json', folder), 'utf8'));
const source = normalizeDocument(readAseprite(await readFile(new URL(oracle.source, folder))).document);
const colorManager = createColorManager(await constants.instantiate(), constants);
const rendering = { colorManager, intent: 1 };
const json = bytes => JSON.parse(new TextDecoder().decode(bytes));
const allPixels = image => [...image.rgba];
const framePixels = (image, rect) => {
  const pixels = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) pixels.push(...image.rgba.subarray((y * image.width + rect.x) * 4, (y * image.width + rect.x + rect.w) * 4));
  return pixels;
};
test.after(() => colorManager.close());

test('Aseprite oracle: export composites in linear RGB before sRGB conversion and preserves alpha', async () => {
  const snapshot = structuredClone(source);
  assert.deepEqual([...renderFrame(source)], oracle.working);
  const actual = renderExportFrame(source, undefined, rendering);
  assert.deepEqual([...actual], oracle.srgb);
  assert.deepEqual([...actual], allPixels(readPng(await readFile(new URL(oracle.expected, folder)))));
  assert.deepEqual([...actual], [...colorManager.displayFrame(source)]);
  for (let at = 3; at < actual.length; at += 4) assert.equal(actual[at], oracle.working[at]);
  // This is the old ordering: it produces 128 instead of 188 at pixel two.
  assert.equal(renderFrame(colorManager.convertDocument(source, 'sRGB'))[8], 128);
  assert.equal(actual[8], 188);
  assert.deepEqual(source, snapshot);
});

test('sRGB exports need no runtime; custom profiles fail clearly without one', () => {
  const bytes = Uint8Array.of(12, 34, 56, 78), original = bytes.slice();
  const copy = toExportRGBA(bytes, createDocument());
  copy[0] = 0;
  assert.deepEqual(bytes, original);
  assert.throws(() => renderExportFrame(source), /color manager/);
  assert.throws(() => planExport([{ document: source }]), /color manager/);
  assert.throws(() => makeGamePackage(source), /color manager/);
  assert.throws(() => toExportRGBA(Uint8Array.of(1, 2, 3), source, rendering), /RGBA bytes/);
  assert.throws(() => toExportRGBA(new Float32Array(4), source, rendering), /RGBA bytes/);
});

for (const [format, decode] of [['png', readPng], ['bmp', readBmp], ['tga', readTga]]) test(`${format.toUpperCase()} export matches the independent composite including partial alpha`, () => {
  const { outputs } = buildCliExportOutputs([{ document: source }], { format }, rendering);
  assert.deepEqual(allPixels(decode(outputs[0].data)), oracle.srgb);
});

test('GIF conversion happens before encoding; opaque pixels match the oracle exactly', () => {
  // Restrict to the four opaque composites: GIF has binary alpha by design.
  const { outputs } = buildCliExportOutputs([{ document: source }], { format: 'gif', crop: '0,0,4,1' }, rendering);
  assert.deepEqual([...renderFrame(importGif(outputs[0].data).document)], oracle.srgb.slice(0, 16));
});

for (const format of ['sheet', 'atlas']) test(`${format} packs converted pixels without transforming the packed image twice`, () => {
  const { outputs } = buildCliExportOutputs([{ document: source }], { format, scale: 1, trim: false, padding: 2, border: 1, extrude: 1 }, rendering);
  const image = readPng(outputs.find(output => output.kind === 'image').data);
  const metadata = json(outputs.find(output => output.kind === 'metadata').data);
  assert.deepEqual(framePixels(image, Object.values(metadata.frames)[0].frame), oracle.srgb);
});

test('layer selection precedes compositing; crop and nearest-neighbor scale follow conversion', () => {
  const input = [{ document: source }];
  const selected = planExport(input, { layer: source.layers[1].id, crop: '2,0,1,1', scale: 2 }, rendering).entries[0];
  assert.deepEqual([...selected.rgba], Array(4).fill([255, 255, 255, 128]).flat());
  const composite = planExport(input, { crop: '2,0,1,1', scale: 2 }, rendering).entries[0];
  assert.deepEqual([...composite.rgba], Array(4).fill([188, 188, 188, 255]).flat());
});

test('game ZIP default renders, provided entries, and CLI package preserve appearance and native artwork', () => {
  const entry = { id: source.frames[0].id, name: 'frame', width: source.width, height: source.height, rgba: renderExportFrame(source, undefined, rendering), durationMs: 100 };
  const archives = [makeGamePackage(source, rendering), makeGamePackage(source, { ...rendering, entries: [entry] }), buildCliExportOutputs([{ document: source }], { format: 'zip' }, rendering).outputs[0].data];
  for (const archive of archives) {
    const files = unzipSync(archive), manifest = json(files['manifest.json']);
    const native = json(files[manifest.project]);
    assert.deepEqual(native, source);
    for (const frame of manifest.frames) assert.deepEqual(allPixels(readPng(files[frame.image])), oracle.srgb);
    const atlas = readPng(files['sprites.png']), metadata = json(files['sprites.json']);
    assert.deepEqual(framePixels(atlas, Object.values(metadata.frames)[0].frame), oracle.srgb);
  }
  const roundtrip = readAseprite(writeAseprite(source)).document;
  assert.deepEqual(documentProfile(roundtrip), documentProfile(source));
  assert.deepEqual([...renderFrame(roundtrip)], oracle.working);
  assert.equal(roundtrip.layers.length, 2);
});

test('a scoped game ZIP keeps the full source project when an original project is supplied', () => {
  const scope = { ...source, layers: source.layers.map((layer, index) => ({ ...layer, visible: index === 0 })) };
  const files = unzipSync(makeGamePackage(scope, { ...rendering, projectDocument: source }));
  const manifest = json(files['manifest.json']);
  assert.deepEqual(json(files[manifest.project]), source);
  assert.deepEqual(allPixels(readPng(files[manifest.frames[0].image])), [...renderExportFrame(scope, undefined, rendering)]);
});

function tiledSprite(indexed = false) {
  let doc = createDocument({ width: 1, height: 1, colorMode: indexed ? 'indexed' : 'rgba', palette: ['#00000000', '#80808080'] });
  doc = applyCommand(doc, { type: 'tileset.add', tileset: { id: 'tiles', name: 'Gray', tileWidth: 1, tileHeight: 1, tiles: [{ id: 't', pixels: [indexed ? 1 : '#80808080'] }] } });
  doc = applyCommand(doc, { type: 'layer.add', layer: { id: 'map', type: 'tilemap' } });
  doc = applyCommand(doc, { type: 'tilemap.paint', layerId: 'map', tilesetId: 'tiles', columns: 1, rows: 1, points: [{ x: 0, y: 0, tileId: 't' }] });
  if (indexed) {
    doc = applyCommand(doc, { type: 'frame.duplicate', frameIds: [doc.frames[0].id], linked: true });
    doc.frames[1].palette = ['#00000000', '#40404040'];
    doc.metadata.aseprite = { transparentIndex: 0 };
  }
  return colorManager.assignProfile(doc, documentProfile(source));
}

test('ZIP converts standalone RGBA and animated indexed tile assets, retaining their original native data', () => {
  for (const indexed of [false, true]) for (const nativeRoundtrip of [false, true]) {
    let doc = tiledSprite(indexed);
    if (nativeRoundtrip) doc = normalizeDocument(readAseprite(writeAseprite(doc)).document);
    const expected = doc.frames.map(frame => [...renderExportFrame(doc, frame.id, rendering)]);
    for (const archive of [makeGamePackage(doc, rendering), buildCliExportOutputs([{ document: doc }], { format: 'zip' }, rendering).outputs[0].data]) {
      const files = unzipSync(archive), manifest = json(files['manifest.json']);
      const actual = manifest.maps.map(mapEntry => {
        const map = json(files[mapEntry.source]), gid = map.layers[0].data[0] & 0x0fffffff;
        const reference = [...map.tilesets].reverse().find(set => set.firstgid <= gid);
        const path = reference.source.replace(/^\.\.\//, '');
        const set = json(files[path]), tile = set.tiles.find(item => item.id === gid - reference.firstgid);
        return allPixels(readPng(files[path.replace(/[^/]+$/, '') + tile.image]));
      });
      assert.deepEqual(actual, expected, JSON.stringify({indexed,nativeRoundtrip,tilesets:manifest.tilesets}));
      assert.deepEqual(json(files[manifest.project]), doc);
      assert.ok(manifest.warnings.some(message => /own color space/.test(message)));
      assert.deepEqual(actual[0], [188, 188, 188, 128]);
      if (indexed) assert.deepEqual(actual[1], [137, 137, 137, 64]);
    }
  }
});

test('indexed frame palettes and grayscale cels render in their working profile before conversion', () => {
  for (const mode of ['indexed', 'grayscale']) {
    let doc = createDocument({ width: 1, height: 1, colorMode: mode, palette: ['#00000000', '#000000ff', '#ffffff80'] });
    doc = applyCommand(doc, { type: 'cel.set', width: 1, height: 1, pixels: [mode === 'indexed' ? 1 : '#000000ff'] });
    doc = applyCommand(doc, { type: 'layer.add', layer: { id: 'white' } });
    doc = applyCommand(doc, { type: 'cel.set', layerId: 'white', width: 1, height: 1, pixels: [mode === 'indexed' ? 2 : '#ffffff80'] });
    doc = colorManager.assignProfile(doc, documentProfile(source));
    assert.deepEqual([...renderExportFrame(doc, undefined, rendering)], [188, 188, 188, 255]);
  }
});

test('real CLI render/export uses composite conversion and native exports retain profile and layers', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pixelwall-managed-export-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = join(directory, 'source.pixelwall');
  await writeFile(input, JSON.stringify(source));
  const before = await readFile(input);
  for (const command of ['render', 'export']) {
    const out = join(directory, `${command}.png`);
    await main([command, input, ...(command === 'export' ? ['--format', 'png'] : []), '--out', out]);
    assert.deepEqual(allPixels(readPng(await readFile(out))), oracle.srgb);
  }
  for (const format of ['pixelwall', 'aseprite']) {
    const out = join(directory, `native.${format}`);
    await main(['export', input, '--format', format, '--out', out]);
    const saved = format === 'pixelwall' ? json(await readFile(out)) : readAseprite(await readFile(out)).document;
    assert.deepEqual(documentProfile(saved), documentProfile(source));
    assert.deepEqual([...renderFrame(saved)], oracle.working);
    assert.equal(saved.layers.length, 2);
  }
  assert.deepEqual(await readFile(input), before);
});

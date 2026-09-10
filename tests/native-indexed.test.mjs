import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNativeRgbMap, mapNativeIndexedImage, quantizeNativePalette } from '../app/native-indexed.mjs';
import { indexedConversionOptions, mapIndexedImage, quantizePalette } from '../app/indexed-color.mjs';
import { applyCommand, createDocument, normalizeDocument, renderFrame, getCel } from '../app/editor-core.mjs';
import { readAseprite, writeAseprite } from '../app/formats.mjs';
const clear = '#00000000', red = '#ff0000ff', green = '#00ff00ff', blue = '#0000ffff', white = '#ffffffff';
const corpus = JSON.parse(readFileSync(new URL('./fixtures/native-indexed/corpus.json', import.meta.url)));
const visible = input => { const bytes = Buffer.from(input); for (let i = 0; i < bytes.length; i += 4) if (!bytes[i + 3]) bytes.fill(0, i, i + 3); return bytes; };
const command = job => ({ type: 'document.colorMode', colorMode: 'indexed', rgbmap: job.rgbmap, fitCriteria: job.fitCriteria, dithering: job.dithering === 'none' ? 'none' : `aseprite-${job.dithering}`, ditherMatrix: job.ditherMatrix, ...(job.quantization ? { paletteMode: 'generate', quantization: job.quantization, maxColors: job.maxColors, withAlpha: job.withAlpha } : {}) });

for (const job of corpus.jobs) test(`native indexed ${job.name}: ${job.kind}, ${job.quantization ?? 'existing'} ${job.maxColors ?? ''}, ${job.rgbmap}/${job.fitCriteria}/${job.dithering}/${job.ditherMatrix}`, () => {
 const source = normalizeDocument(readAseprite(Buffer.from(corpus.sources[job.source], 'base64')).document);
 const expected = normalizeDocument(readAseprite(Buffer.from(job.native, 'base64')).document);
 const before = JSON.stringify(source), actual = applyCommand(source, command(job));
 assert.equal(JSON.stringify(source), before);
 assert.deepEqual(actual.palette, expected.palette);
 for (let f = 0; f < actual.frames.length; f++) {
  assert.deepEqual(visible(renderFrame(actual, actual.frames[f].id)), visible(Buffer.from(job.rgba[f], 'base64')));
  for (const layer of actual.layers) {
   const cel = actual.frames[f].cels[layer.id], expectedCel = expected.frames[f].cels[layer.id];
   if (!cel) continue;
   if (layer.type === 'tilemap') { assert.deepEqual(actual.images[cel.imageId].tilemap, expected.images[expectedCel.imageId].tilemap); assert.equal(layer.tilemaps, undefined); continue; }
   const image = actual.images[cel.imageId], reference = expected.images[expectedCel.imageId];
   assert.equal(image.width, reference.width); assert.equal(image.height, reference.height);
   assert.deepEqual(image.pixels.map(p => p ?? actual.metadata.aseprite.transparentIndex), reference.pixels);
  }
 }
 for (let i = 0; i < actual.tilesets.length; i++) {
  const ts = actual.tilesets[i], reference = expected.tilesets[i];
  assert.equal(ts.tileWidth, reference.tileWidth); assert.equal(ts.tileHeight, reference.tileHeight);
  assert.deepEqual(ts.tileUserData, reference.tileUserData);
  assert.deepEqual(actual.images[ts.imageId].pixels.map(p => p ?? actual.metadata.aseprite.transparentIndex), expected.images[reference.imageId].pixels);
 }
 const reopened = normalizeDocument(readAseprite(writeAseprite(actual)).document);
 assert.deepEqual(reopened.palette, actual.palette);
 for (let f = 0; f < actual.frames.length; f++) assert.deepEqual(renderFrame(reopened, reopened.frames[f].id), renderFrame(actual, actual.frames[f].id));
 assert.deepEqual(actual.metadata.aseprite.colorProfile, source.metadata.aseprite.colorProfile);
});

test('legacy defaults and explicit algorithms remain distinct and reject mismatched modes', () => {
 assert.equal(indexedConversionOptions().rgbmap, 'pixelwall');
 assert.equal(indexedConversionOptions({ quantization: 'octree' }).rgbmap, 'octree');
 assert.equal(indexedConversionOptions({ dithering: 'aseprite-ordered' }).rgbmap, 'octree');
 assert.throws(() => indexedConversionOptions({ rgbmap: 'rgb5a3', dithering: 'ordered' }), /legacy dithering/);
 assert.throws(() => indexedConversionOptions({ rgbmap: 'pixelwall', dithering: 'aseprite-ordered' }), /native dithering/);
 assert.throws(() => indexedConversionOptions({ fitCriteria: 'rgb' }), /require a native/);
 assert.throws(() => indexedConversionOptions({ dithering: 'aseprite-ordered', ditherStrength: .5 }), /strength/);
 const image = { width: 2, height: 2, pixels: Array(4).fill('#808080ff') }, palette = [clear, '#000000ff', white];
 assert.notDeepEqual(mapIndexedImage(image, palette, { transparentIndex: 0, dithering: 'ordered', ditherMatrix: 'bayer2x2' }), mapIndexedImage(image, palette, { transparentIndex: 0, dithering: 'aseprite-ordered', ditherMatrix: 'bayer2x2' }));
});

test('native exact duplicate colors choose last octree entry while quantized search keeps first fit', () => {
 const palette = [clear, red, red];
 assert.equal(createNativeRgbMap(palette, { transparentIndex: 0, rgbmap: 'octree', fitCriteria: 'rgb' }).map([255, 0, 0, 255]), 2);
 assert.equal(createNativeRgbMap(palette, { transparentIndex: 0, rgbmap: 'rgb5a3', fitCriteria: 'rgb' }).map([255, 0, 0, 255]), 1);
});

test('native map quantizes alpha before fitting and retains non-mask alpha-zero indices', () => {
 const image = { width: 3, height: 1, pixels: ['#ff000007', '#ff00001f', '#ff000020'] }, palette = [clear, red, '#ff000000'];
 assert.deepEqual(mapNativeIndexedImage(image, palette, { rgbmap: 'rgb5a3', fitCriteria: 'rgb', transparentIndex: 0 }), [null, null, 2]);
 assert.deepEqual(mapNativeIndexedImage({ width: 1, height: 1, pixels: ['#ff000000'] }, palette, { transparentIndex: null }), [0]);
});

test('generated palette samples visible composite exposures, not hidden/off-canvas/unused artwork', () => {
 const job = corpus.jobs.find(j => j.kind === 'composite' && j.quantization === 'octree');
 const source = normalizeDocument(readAseprite(Buffer.from(corpus.sources[job.source], 'base64')).document), expected = applyCommand(source, command(job));
 const changed = structuredClone(source), hidden = changed.layers.find(l => !l.visible);
 for (const frame of changed.frames) { const cel = frame.cels[hidden.id]; changed.images[cel.imageId].pixels.fill('#12ef78ff'); }
 for (const ts of changed.tilesets) if (ts.imageId) changed.images[ts.imageId].pixels.fill('#f4f413ff');
 const actual = applyCommand(normalizeDocument(changed), command(job));
 assert.deepEqual(actual.palette, expected.palette);
 const legacy = applyCommand(source, { ...command(job), rgbmap: 'pixelwall', fitCriteria: 'default', quantization: 'median-cut' });
 assert.notDeepEqual(legacy.palette, expected.palette);
});

test('existing frame palettes split linked images only when native output indices differ', () => {
 let doc = createDocument({ width: 2, height: 1, palette: [clear, red, blue] });
 doc = applyCommand(doc, { type: 'cel.set', width: 2, height: 1, pixels: [red, blue] });
 doc = applyCommand(doc, { type: 'frame.duplicate', linked: true });
 doc = applyCommand(doc, { type: 'frame.duplicate', frameId: doc.frames[0].id, linked: true });
 doc.frames[1].palette = [clear, blue, red]; doc.frames[2].palette = [clear, red, blue];
 const actual = applyCommand(normalizeDocument(doc), { type: 'document.colorMode', colorMode: 'indexed', rgbmap: 'octree', fitCriteria: 'rgb' });
 assert.notEqual(getCel(actual, actual.frames[0].id).cel.imageId, getCel(actual, actual.frames[1].id).cel.imageId);
 assert.equal(getCel(actual, actual.frames[0].id).cel.imageId, getCel(actual, actual.frames[2].id).cel.imageId);
 assert.deepEqual(getCel(actual, actual.frames[1].id).image.pixels, [2, 1]);
});

test('native tile regions reset ordered origins and diffusion and keep atlas slots separate', () => {
 const tile = { width: 3, height: 3, pixels: Array(9).fill('#727272ff') }, atlas = { width: 3, height: 6, pixels: [...tile.pixels, ...tile.pixels] }, palette = [clear, '#000000ff', white];
 for (const dithering of ['aseprite-ordered', 'aseprite-old', 'aseprite-error-diffusion']) {
  const options = { dithering, transparentIndex: 0, rgbmap: 'octree', fitCriteria: 'rgb' };
  const expected = mapNativeIndexedImage(tile, palette, options);
  assert.deepEqual(mapNativeIndexedImage(atlas, palette, { ...options, tileWidth: 3, tileHeight: 3 }), [...expected, ...expected]);
 }
});

test('native quantizers preserve reserved-mask differences and exact-depth refinement', () => {
 assert.deepEqual(quantizeNativePalette([red, red, green], { maxColors: 8, quantization: 'octree', withAlpha: false }), [clear, red, green]);
 assert.deepEqual(quantizeNativePalette([red, green], { maxColors: 8, quantization: 'rgb5a3', withAlpha: false }), ['#000000ff', red, green]);
 assert.deepEqual(quantizeNativePalette([red], { maxColors: 8, transparentIndex: null }), [red]);
 assert.deepEqual(new Set(quantizeNativePalette(['#010203ff', '#010202ff'], { maxColors: 8 })), new Set([clear, '#010203ff', '#010202ff']));
});

test('nonzero generation masks work while malformed inputs and shared work exhaustion fail atomically', () => {
 for (const quantization of ['octree', 'rgb5a3']) {
  const palette = quantizeNativePalette([red], { transparentIndex: 3, maxColors: 8, quantization });
  assert.equal(palette[3], clear);
  assert.ok(palette.includes(red));
 }
 assert.throws(() => quantizeNativePalette([red], { budget: { remaining: 0 } }), /work limit/);
 assert.throws(() => quantizeNativePalette([red], { quantization: 'unknown' }), /quantizer/);
 assert.throws(() => mapNativeIndexedImage({ width: 2, height: 1, pixels: [red] }, [clear, red]), /raster/);
 assert.throws(() => mapNativeIndexedImage({ width: 1, height: 1, pixels: [red] }, [clear, red], { fitCriteria: 'lab' }), /criterion/);
 assert.throws(() => mapNativeIndexedImage({ width: 1, height: 1, pixels: [red] }, [clear, red], { budget: { remaining: 1 } }), /work limit/);
 assert.throws(() => mapNativeIndexedImage({ width: 1, height: 1, pixels: ['rgb(1,2,3)'] }, [clear, red]), /hex/);
 const doc = createDocument({ width: 1, height: 1, colorMode: 'indexed', palette: [red, green, blue, clear] }); doc.metadata.aseprite = { transparentIndex: 3 };
 const converted = applyCommand(doc, { type: 'document.colorMode', colorMode: 'indexed', paletteMode: 'generate', quantization: 'octree', maxColors: 8 });
 assert.equal(converted.metadata.aseprite.transparentIndex, 3);
 assert.equal(converted.palette[3], clear);
});

test('native diffusion uses integer strength and preserves zero-strength RGB-map behavior', () => {
 const image = { width: 3, height: 2, pixels: Array(6).fill('#777777ff') }, palette = [clear, '#000000ff', white];
 const options = { rgbmap: 'octree', fitCriteria: 'rgb', transparentIndex: 0 };
 assert.deepEqual(mapNativeIndexedImage(image, palette, { ...options, dithering: 'aseprite-error-diffusion', ditherStrength: .379 }), mapNativeIndexedImage(image, palette, { ...options, dithering: 'aseprite-error-diffusion', ditherStrength: .37 }));
 assert.deepEqual(mapNativeIndexedImage(image, palette, { ...options, dithering: 'aseprite-error-diffusion', ditherStrength: 0 }), mapNativeIndexedImage(image, palette, options));
 assert.deepEqual(quantizePalette([red, green], { quantization: 'octree' }), quantizeNativePalette([red, green]));
});

test('native words and links stay raw while palette context variants materialize only changed frames', () => {
 let doc = createDocument({ width: 2, height: 2, palette: [clear, red, blue] });
 for (const c of [
  { type: 'tileset.add', tileset: { id: 'tiles', tileWidth: 2, tileHeight: 2, tiles: [{ id: 'one', pixels: [red, blue, null, red] }] } },
  { type: 'layer.add', layer: { id: 'map', type: 'tilemap', tilesetId: 'tiles' } },
  { type: 'tilemap.paint', layerId: 'map', points: [{ x: 0, y: 0, tileId: 'one', flipX: true, rotate: 90 }] },
  { type: 'frame.duplicate', linked: true },
  { type: 'frame.duplicate', frameId: 'frame-1', linked: true },
 ]) doc = applyCommand(doc, c);
 doc.frames[1].palette = [clear, blue, red]; doc.frames[2].palette = [clear, red, blue];
 doc = normalizeDocument(readAseprite(writeAseprite(normalizeDocument(doc))).document);
 const layer = doc.layers.find(l => l.type === 'tilemap'), raw = doc.frames.map(f => structuredClone(doc.images[f.cels[layer.id].imageId].tilemap));
 const actual = applyCommand(doc, { type: 'document.colorMode', colorMode: 'indexed', rgbmap: 'octree', fitCriteria: 'rgb' }), changed = actual.layers.find(l => l.id === layer.id);
 assert.equal(changed.tilemaps?.[actual.frames[0].id], undefined);
 assert.ok(changed.tilemaps?.[actual.frames[1].id]);
 assert.equal(changed.tilemaps?.[actual.frames[2].id], undefined);
 for (let i = 0; i < actual.frames.length; i++) {
  assert.deepEqual(actual.images[actual.frames[i].cels[layer.id].imageId].tilemap, raw[i]);
  assert.equal(actual.frames[i].cels[layer.id].imageId, doc.frames[i].cels[layer.id].imageId);
  assert.deepEqual(renderFrame(actual, actual.frames[i].id), renderFrame(doc, doc.frames[i].id));
 }
 const reopened = normalizeDocument(readAseprite(writeAseprite(actual)).document);
 for (let i = 0; i < actual.frames.length; i++) assert.deepEqual(renderFrame(reopened, reopened.frames[i].id), renderFrame(actual, actual.frames[i].id));
});


test('native conversion preserves working ICC profile and document-wide locked-layer behavior', () => {
 const input = readFileSync(new URL('./fixtures/export-color/source.aseprite', import.meta.url));
 const doc = normalizeDocument(readAseprite(input).document);
 doc.layers[0].locked = true; const profile = structuredClone(doc.metadata.aseprite.colorProfile);
 const result = applyCommand(doc, { type: 'document.colorMode', colorMode: 'indexed', quantization: 'octree', paletteMode: 'generate', fitCriteria: 'rgb', maxColors: 32 });
 assert.equal(result.layers[0].locked, true); assert.deepEqual(result.metadata.aseprite.colorProfile, profile);
 assert.deepEqual(readAseprite(writeAseprite(result)).document.metadata.aseprite.colorProfile, profile);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { createDocument, normalizeDocument, applyCommand, renderFrame } from '../app/editor-core.mjs';
import { readAseprite, readPng, readBmp, readTga, importGif, packAtlas } from '../app/formats.mjs';
import { scaleExportDocument, validateExportScale } from '../app/export-scale.mjs';
import { renderScaledExportFrame, renderExportFrame } from '../app/export-render.mjs';
import { planExport, buildExportMetadata } from '../app/cli-export-plan.mjs';
import { buildCliExportOutputs, main } from '../app/cli.mjs';
import { loadNodeColorManager } from '../app/color-runtime-node.mjs';
import { parseCliArguments } from '../app/cli-arguments.mjs';

const folder = new URL('./fixtures/export-scale/', import.meta.url);
const oracle = JSON.parse(await readFile(new URL('oracle.json', folder), 'utf8'));
const readDoc = async name => normalizeDocument(readAseprite(await readFile(new URL(name, folder))).document);
const colorManager = await loadNodeColorManager();
test.after(() => colorManager.close());
const rendering = { colorManager };
function assertRaster(actual, expected) {
  assert.equal(actual.width, expected.width); assert.equal(actual.height, expected.height);
  // RGB under fully transparent pixels has no appearance; Aseprite PNG retains some values.
  const clean = pixels => [...pixels].map((value, i) => i % 4 !== 3 && !pixels[i - i % 4 + 3] ? 0 : value);
  assert.deepEqual(clean(actual.rgba), clean(expected.rgba));
}
for (const item of oracle.cases) test(`native fractional export: ${item.name} at ${item.scale}`, async () => {
  const source = await readDoc(item.source), snapshot = structuredClone(source);
  const plan = planExport([{ document: source }], { mode: 'sequence', scale: item.scale, ...item.options }, rendering);
  assert.equal(plan.entries.length, item.pngs.length);
  for (const [index, png] of item.pngs.entries()) assertRaster(plan.entries[index], readPng(await readFile(new URL(png, folder))));
  assert.deepEqual(source, snapshot);
  if (item.native && item.name !== 'reference') {
    const actual = scaleExportDocument(source, item.scale), expected = await readDoc(item.native);
    assert.equal(actual.width, expected.width); assert.equal(actual.height, expected.height);
    for (const [fi, frame] of expected.frames.entries()) for (const [li, layer] of expected.layers.entries()) {
      const cel = frame.cels[layer.id], ours = actual.frames[fi].cels[actual.layers[li].id];
      if (!cel) { assert.equal(ours, undefined); continue; }
      assert.equal(ours.x, cel.x, `cel x ${layer.name}`); assert.equal(ours.y, cel.y, `cel y ${layer.name}`);
      const image = actual.images[ours.imageId], native = expected.images[cel.imageId];
      assert.equal(image.width, native.width); assert.equal(image.height, native.height); assert.deepEqual(image.pixels, native.pixels); assert.deepEqual(image.tilemap, native.tilemap);
    }
    assert.deepEqual(actual.slices.filter(s => s.keys?.some(k => k.width && k.height) || s.bounds?.width), expected.slices);
    for (const [index, ts] of expected.tilesets.entries()) {
      assert.equal(actual.tilesets[index].tileWidth, ts.tileWidth); assert.equal(actual.tilesets[index].tileHeight, ts.tileHeight);
    }
  }
});

for (let bits = 0; bits < 8; bits++) test(`canonical tilemap orientation ${bits} matches independent native fractional output`, async () => {
  const doc = await readDoc(`flag-${bits}.aseprite`), layer = doc.layers.find(layer => layer.type === 'tilemap'), ts = doc.tilesets.find(ts => ts.id === layer.tilesetId);
  ts.tiles = Array.from({ length: ts.tileCount }, (_, index) => ({ id: `tile-${index}`, imageId: ts.imageId, sourceRect: { x: 0, y: index * ts.tileHeight, width: ts.tileWidth, height: ts.tileHeight } }));
  const frame = doc.frames[0], cel = frame.cels[layer.id];
  layer.tilemaps = { [frame.id]: { tilesetId: ts.id, columns: 1, rows: 1, x: cel.x, y: cel.y, opacity: cel.opacity, cells: [{ tileId: 'tile-1', flipX: bits & 4 ? !!(bits & 2) : !!(bits & 1), flipY: bits & 4 ? !(bits & 1) : !!(bits & 2), rotate: bits & 4 ? 90 : 0 }] } };
  for (const scale of [1.5, 2.2]) assertRaster(planExport([{ document: doc }], { scale }).entries[0], readPng(await readFile(new URL(`flag-${bits}-${scale}-1.png`, folder))));
});

test('reference opt-in retains original bitmap and native precise scaled geometry', async () => {
  const original = await readDoc('reference.aseprite');
  for (const scale of [.5, 1.5, 2]) {
    const actual = scaleExportDocument(original, scale), native = await readDoc(`reference-${scale}.aseprite`);
    const cel = actual.frames[0].cels[actual.layers[0].id], expected = native.frames[0].cels[native.layers[0].id];
    assert.deepEqual(actual.images[cel.imageId], original.images[original.frames[0].cels[original.layers[0].id].imageId]);
    for (const field of ['x', 'y', 'width', 'height']) assert(Math.abs(cel.preciseBounds[field] - expected.preciseBounds[field]) <= 1 / 65536);
  }
});

test('fractional scaling keeps linked images and frame palette/profile state without mutation', async () => {
  const d = await readDoc('linked-indexed.aseprite'), scaled = scaleExportDocument(d, 1.5);
  assert.equal(d.frames[0].cels[d.layers[0].id].imageId, d.frames[1].cels[d.layers[0].id].imageId);
  assert.notDeepEqual(d.frames[0].palette, d.frames[1].palette);
  for (const layer of d.layers) {
    const one = d.frames[0].cels[layer.id], two = d.frames[1].cels[layer.id];
    if (one.imageId === two.imageId) assert.equal(scaled.frames[0].cels[layer.id].imageId, scaled.frames[1].cels[layer.id].imageId);
  }
  assert.deepEqual(scaled.frames.map(f => f.palette), d.frames.map(f => f.palette));
  const linear = await readDoc('../export-color/source.aseprite');
  assert.deepEqual(scaleExportDocument(linear, 1.5).metadata.aseprite.colorProfile, linear.metadata.aseprite.colorProfile);
});

test('fractional crop and slice metadata use actual rounded canvas ratios and integer edge geometry', async () => {
  const doc = await readDoc('slice.aseprite');
  const plan = planExport([{ document: doc }], { scale: 1.5, slice: 'detail' });
  const metadata = buildExportMetadata(packAtlas(plan.entries, plan.atlasOptions), plan, 'json-array');
  assert.deepEqual(metadata.meta.slices[0].keys[0], { frame: 0, bounds: { x: 0, y: 0, w: 6, h: 7 }, pivot: { x: 4, y: 5 }, center: { x: 1, y: 2, w: 4, h: 3 } });
  assert.deepEqual(metadata.meta.sourceSlices[0], { ...doc.slices[0], inputIndex: 0 });
  const cropped = planExport([{ document: doc }], { scale: 1.5, crop: '1,1,3,3' }).entries[0];
  assert.deepEqual(cropped.crop, { x: 1, y: 1, width: 3, height: 3 });
  assert.deepEqual(cropped.scaledCrop, { x: 1, y: 1, width: 4, height: 4 });
});

test('reference layers are omitted by CLI defaults with an explicit opt-in; native project remains original', async () => {
  const doc = await readDoc('reference.aseprite'), snapshot = structuredClone(doc);
  const defaults = planExport([{ document: doc }], { scale: 1.5 });
  assert(defaults.entries[0].rgba.every(value => value === 0));
  const included = planExport([{ document: doc }], { scale: 1.5, 'include-reference-layers': true });
  assert(included.entries[0].rgba.some((value, index) => index % 4 === 3 && value));
  assert.deepEqual(defaults.sources[0].document, doc);
  assert.deepEqual(doc, snapshot);
  const parsed = parseCliArguments(['export', '--include-reference-layers', 'art.aseprite', '--scale', '.5']);
  assert.deepEqual(parsed.args._, ['export', 'art.aseprite']); assert.equal(parsed.args['include-reference-layers'], true);
});

for (const format of ['png', 'bmp', 'tga', 'gif', 'sheet', 'atlas', 'zip']) test(`${format} fractional export uses the shared per-cel geometry and retains native ZIP project`, async () => {
  const doc = await readDoc('linked-indexed.aseprite');
  const built = buildCliExportOutputs([{ filename: 'test.aseprite', document: doc }], { format, frame: '0', scale: 1.5, trim: false, padding: 0, border: 0 }, rendering);
  const expected = readPng(await readFile(new URL('linked-indexed-1.5-1.png', folder)));
  let actual;
  if (['png', 'bmp', 'tga'].includes(format)) actual = ({ png: readPng, bmp: readBmp, tga: readTga })[format](built.outputs[0].data);
  else if (format === 'gif') { const gif = importGif(built.outputs[0].data).document; actual = { width: gif.width, height: gif.height, rgba: renderFrame(gif) }; }
  else if (format === 'zip') {
    const files = unzipSync(built.outputs[0].data); actual = readPng(files['sprites.png']);
    const sources = JSON.parse(new TextDecoder().decode(files['sources.json']));
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files[sources.sources[0].project])), doc);
  } else actual = readPng(built.outputs.find(output => output.name.endsWith('.png')).data);
  assertRaster(actual, expected);
});

test('real CLI render and PNG export accept fractions and omit references; opt-in applies only to rendered output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pixelwall-scale-cli-'));
  try {
    for (const command of ['render', 'export']) {
      const output = join(dir, `${command}.png`);
      await main([command, new URL('linked-rgba.aseprite', folder).pathname, '--scale', '1.5', '--format', 'png', '--out', output]);
      assertRaster(readPng(await readFile(output)), readPng(await readFile(new URL('linked-rgba-1.5-1.png', folder))));
    }
    await main(['render', new URL('reference.aseprite', folder).pathname, '--scale', '1.5', '--out', join(dir, 'ref.png')]);
    assert(readPng(await readFile(join(dir, 'ref.png'))).rgba.every(value => value === 0));
    await main(['render', new URL('reference.aseprite', folder).pathname, '--include-reference-layers', '--scale', '1.5', '--out', join(dir, 'included.png')]);
    assert(readPng(await readFile(join(dir, 'included.png'))).rgba.some((value, index) => index % 4 === 3 && value));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('scale validation, minimum one pixel, stored-image budgets and oversized viewport rendering are bounded', () => {
  for (const scale of [0, -1, Infinity, NaN, 65, 'bad']) assert.throws(() => validateExportScale(scale), /Scale/);
  const tiny = createDocument({ width: 1, height: 1 });
  assert.equal(scaleExportDocument(tiny, .001).width, 1);
  const big = createDocument({ width: 1024, height: 1024 });
  assert.throws(() => scaleExportDocument(big, 8.1), /pixel limit/);
  const linked = applyCommand(tiny, { type: 'cel.set', width: 512, height: 512, pixels: Array(512*512).fill('#ff0000ff') });
  assert.throws(() => scaleExportDocument(linked, 63.9), /pixel limit/);
  const corner = applyCommand(tiny, { type: 'cel.set', x: 2048, y: 2048, width: 1, height: 1, pixels: ['#ff0000ff'] });
  const input = { ...corner, width: 2049, height: 2049 };
  const frame = renderExportFrame(input);
  assert.equal(frame.length, 2049 * 2049 * 4);
  assert.deepEqual([...frame.slice(-4)], [255, 0, 0, 255]);
  assert.equal(frame.reduce((sum, value, index) => sum + (index % 4 === 3 ? value : 0), 0), 255);
  const integer = renderScaledExportFrame(tiny, tiny.frames[0].id, 3);
  assert.equal(integer.width, 3); assert.equal(integer.height, 3);
});

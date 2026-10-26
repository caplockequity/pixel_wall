import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWaterScene } from '../app/water-generator.mjs';
import { applyCommand, createDocument, normalizeDocument, renderFrame } from '../app/editor-core.mjs';
import { readAseprite, writeAseprite, readPng, writePng } from '../app/formats.mjs';

test('water scenes are deterministic and use shared static cels', () => {
  const a = generateWaterScene({ scene: 'river', view: 'isometric', seed: 77, season: 'autumn', frames: 4, width: 24, height: 20 });
  const b = generateWaterScene({ scene: 'river', view: 'isometric', seed: 77, season: 'autumn', frames: 4, width: 24, height: 20 });
  assert.deepEqual(a, b);
  assert.equal(a.frames[0].cels.banks.imageId, a.frames.at(-1).cels.banks.imageId);
  assert.notEqual(a.frames[0].cels.water.imageId, a.frames[1].cels.water.imageId);
  assert.equal(a.metadata.seamless, true);
});

test('scene.water atomically replaces a blank document and preserves identity and size', () => {
  const original = createDocument({ id: 'keep-me', width: 20, height: 12 });
  const result = applyCommand(original, { type: 'scene.water', scene: 'waterfall', frames: 2, durationMs: 90 });
  assert.equal(result.id, 'keep-me');
  assert.deepEqual([result.width, result.height], [20, 12]);
  assert.equal(result.frames.length, 2);
  assert.throws(() => applyCommand(result, { type: 'scene.water', scene: 'pond' }), /blank document/);
  const replaced = applyCommand(result, { type: 'scene.water', scene: 'pond', replace: true });
  assert.equal(replaced.id, 'keep-me');
});

test('water generator bounds expensive requests and accepts palette roles', () => {
  assert.throws(() => generateWaterScene({ frames: 999, details: 999, width: 8, height: 8 }), /Frames must be an integer/);
  const scene = generateWaterScene({ frames: 32, details: 4, palette: { water: '#123456' }, width: 8, height: 8 });
  assert.equal(scene.frames.length, 32);
  assert.equal(scene.metadata.paletteRoles.water, '#123456ff');
  assert.ok(scene.images['water-image-1'].pixels.some(Boolean));
});

test('land mask is independent from water animation controls and phase wraps', () => {
  const base = generateWaterScene({ scene: 'pond', seed: 91, waterSeed: 1, frames: 6, width: 24, height: 24 });
  const changed = generateWaterScene({ scene: 'pond', seed: 91, waterSeed: 999, rippleDensity: 1, season: 'winter', palette: { water: '#112233' }, frames: 6, width: 24, height: 24 });
  for (const layer of ['banks', 'rocks', 'grass']) {
    const occupied = image => image.pixels.map(Boolean);
    assert.deepEqual(occupied(base.images[`${layer}-image`]), occupied(changed.images[`${layer}-image`]));
  }
  const shifted = generateWaterScene({ scene: 'pond', seed: 91, waterSeed: 1, frames: 6, phaseOffset: 7, width: 24, height: 24 });
  assert.deepEqual(shifted.images['water-image-1'].pixels, base.images['water-image-2'].pixels);
  assert.ok(base.frames.some((f) => f.cels.water.imageId && base.images[f.cels.water.imageId].pixels.some((p, j) => p !== base.images['water-image-1'].pixels[j])));
});

test('composited animation changes for every scene and view', () => {
  for (const scene of ['pond', 'river', 'stream', 'waterfall', 'shoreline']) for (const view of ['top-down', 'isometric']) {
    const doc = normalizeDocument(generateWaterScene({ scene, view, seed: 4, waterSeed: 8, frames: 4, width: 32, height: 24 }));
    const rendered = doc.frames.map(frame => [...renderFrame(doc, frame.id)]);
    assert.ok(rendered[0].some((v, i) => v !== rendered[1][i]), `${scene}/${view} should animate`);
    const d01 = rendered[0].reduce((n, v, i) => n + (v !== rendered[1][i] ? 1 : 0), 0);
    const d23 = rendered[2].reduce((n, v, i) => n + (v !== rendered[3][i] ? 1 : 0), 0);
    assert.ok(d01 > 0 && d23 > 0, `${scene}/${view} has no neighboring frame change`);
  }
});

test('public validation rejects malformed bounds, colors, and roles', () => {
  assert.throws(() => generateWaterScene({ width: 512 }), /Width/);
  assert.throws(() => generateWaterScene({ frames: 0 }), /Frames/);
  assert.throws(() => generateWaterScene({ seed: -1 }), /Seed/);
  assert.throws(() => generateWaterScene({ palette: { water: '#12345' } }), /palette color/i);
  assert.throws(() => generateWaterScene({ palette: { unknownRole: '#123456' } }), /palette role|unknown/i);
  assert.throws(() => generateWaterScene({ rippleDensity: 2 }), /rippleDensity/);
});

test('every scene geometry responds to its seed while land masks ignore water controls', () => {
  for (const scene of ['pond', 'river', 'stream', 'waterfall', 'shoreline']) {
    const a = generateWaterScene({ scene, seed: 3, waterSeed: 1, frames: 3, width: 32, height: 24 });
    const b = generateWaterScene({ scene, seed: 4, waterSeed: 1, frames: 3, width: 32, height: 24 });
    const different = ['banks', 'rocks', 'grass'].some(layer => a.images[`${layer}-image`].pixels.some((p, i) => Boolean(p) !== Boolean(b.images[`${layer}-image`].pixels[i])));
    assert.ok(different, `${scene} geometry should respond to seed`);
    const c = generateWaterScene({ scene, seed: 3, waterSeed: 999, season: 'winter', frames: 3, width: 32, height: 24 });
    for (const layer of ['banks', 'rocks', 'grass']) assert.deepEqual(a.images[`${layer}-image`].pixels.map(Boolean), c.images[`${layer}-image`].pixels.map(Boolean));
  }
});

test('ripple density zero removes interior foam and integer phase wraps exactly', () => {
  const calm = generateWaterScene({ scene: 'pond', seed: 2, waterSeed: 8, rippleDensity: 0, frames: 4, width: 32, height: 32 });
  const foam = calm.metadata.paletteRoles.foam;
  assert.equal(Object.values(calm.images).some(image => image.pixels.includes(foam)), false);
  const a = generateWaterScene({ scene: 'shoreline', seed: 2, waterSeed: 8, frames: 4, phaseOffset: 0, width: 24, height: 24 });
  const b = generateWaterScene({ scene: 'shoreline', seed: 2, waterSeed: 8, frames: 4, phaseOffset: 8, width: 24, height: 24 });
  assert.deepEqual(a.frames.map(frame => a.images[frame.cels.water.imageId].pixels), b.frames.map(frame => b.images[frame.cels.water.imageId].pixels));
});

test('scene.water refuses structured and tilemap-only documents without mutation', () => {
  const structured = applyCommand(createDocument({ id: 'structured', width: 16, height: 16 }), { type: 'layer.add', layer: { id: 'extra', type: 'group' } });
  const before = structuredClone(structured);
  assert.throws(() => applyCommand(structured, { type: 'scene.water', scene: 'pond' }), /blank document|replace/i);
  assert.deepEqual(structured, before);
  let tilemap = applyCommand(createDocument({ id: 'tilemap-only', width: 4, height: 4 }), { type: 'layer.add', layer: { id: 'map', type: 'tilemap' } });
  tilemap = applyCommand(tilemap, { type: 'tileset.add', tileset: { id: 'ts', tileWidth: 2, tileHeight: 2, tiles: [{ id: 'tile', pixels: [null, null, null, null] }] } });
  assert.throws(() => applyCommand(tilemap, { type: 'scene.water', scene: 'pond' }), /blank document|replace/i);
});

test('scene.water preserves documents with custom clips, slices, or layer configuration', () => {
  const cases = [
    applyCommand(createDocument({ id: 'clip-doc', width: 8, height: 8 }), { type: 'clip.add', clip: { id: 'custom', name: 'Custom', frameIds: ['frame-1'] } }),
    applyCommand(createDocument({ id: 'slice-doc', width: 8, height: 8 }), { type: 'slice.add', slice: { id: 'slice', bounds: { x: 0, y: 0, width: 2, height: 2 } } }),
    applyCommand(createDocument({ id: 'layer-doc', width: 8, height: 8 }), { type: 'layer.update', layerId: 'layer-1', patch: { name: 'Renamed' } }),
  ];
  for (const input of cases) {
    const before = structuredClone(input);
    assert.throws(() => applyCommand(input, { type: 'scene.water', scene: 'pond' }), /blank document|replace/i);
    assert.deepEqual(input, before);
  }
});

test('generated documents round-trip through Aseprite and PNG rendering', () => {
  const source = normalizeDocument(generateWaterScene({ scene: 'waterfall', view: 'isometric', seed: 12, waterSeed: 44, frames: 3, width: 16, height: 16 }));
  const ase = normalizeDocument(readAseprite(writeAseprite(source)).document);
  for (const frame of source.frames) assert.deepEqual(Array.from(renderFrame(ase, frame.id)), Array.from(renderFrame(source, frame.id)));
  const rgba = renderFrame(source, source.frames[0].id);
  assert.deepEqual(Array.from(readPng(writePng(source.width, source.height, rgba)).rgba), Array.from(rgba));
});

test('loop boundary is a normal adjacent transition and phase offsets are integral', () => {
  const doc = normalizeDocument(generateWaterScene({ scene: 'river', view: 'isometric', seed: 31, waterSeed: 19, frames: 12, width: 40, height: 32 }));
  const rendered = doc.frames.map(frame => renderFrame(doc, frame.id));
  const distance = (a, b) => a.reduce((n, value, i) => n + (value !== b[i] ? 1 : 0), 0);
  const firstStep = distance(rendered[0], rendered[1]), loopStep = distance(rendered[11], rendered[0]);
  assert.ok(firstStep > 0 && loopStep > 0);
  assert.ok(loopStep < firstStep * 4, `loop boundary jump ${loopStep} is disproportionate to ${firstStep}`);
  assert.throws(() => generateWaterScene({ phaseOffset: .5 }), /Phase offset/);
});

test('custom palette changes colors without changing the water occupancy mask', () => {
  const base = generateWaterScene({ scene: 'shoreline', seed: 7, waterSeed: 3, frames: 4, width: 32, height: 24 });
  const custom = generateWaterScene({ scene: 'shoreline', seed: 7, waterSeed: 3, palette: { water: '#112233', foam: '#fff0aa' }, frames: 4, width: 32, height: 24 });
  for (let i = 0; i < base.frames.length; i++) {
    const a = base.images[base.frames[i].cels.water.imageId].pixels;
    const b = custom.images[custom.frames[i].cels.water.imageId].pixels;
    assert.deepEqual(a.map(value => value !== null), b.map(value => value !== null));
  }
  assert.notDeepEqual(base.images[base.frames[0].cels.water.imageId].pixels, custom.images[custom.frames[0].cels.water.imageId].pixels);
});

test('maximum viable scene stays within the stored pixel budget', () => {
  const scene = generateWaterScene({ scene: 'pond', width: 256, height: 256, frames: 32, details: 0 });
  assert.equal(scene.frames.length, 32);
  assert.equal(Object.keys(scene.images).length, 35);
  assert.equal(scene.images['water-image-32'].pixels.length, 256 * 256);
});

test('oversized replacement fails atomically while preserving identity and dimensions', () => {
  const doc = createDocument({ id: 'large', width: 512, height: 512 });
  const before = structuredClone(doc);
  assert.throws(() => applyCommand(doc, { type: 'scene.water', scene: 'pond' }), /Width|canvas|bounds/i);
  assert.deepEqual(doc, before);
  assert.deepEqual([doc.id, doc.width, doc.height], ['large', 512, 512]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rolldown } from 'rolldown';
import { rasterizeRotation } from '../app/rotation-raster.mjs';
import { createDocument, applyCommand, buildSelection, renderFrame, getCel } from '../app/editor-core.mjs';
import { prepareRuntimes, RUNTIME_FILES } from '../scripts/prepare-runtimes.mjs';

const fixture = new URL('./fixtures/rotation-native/', import.meta.url);
const original = JSON.parse(await readFile(new URL('original-vectors.json', fixture), 'utf8'));
const extended = JSON.parse(await readFile(new URL('extended-vectors.json', fixture), 'utf8'));
for (const source of original.inputs) for (const method of ['fast', 'rotsprite']) test(`native original ${source.name} ${source.angle}: ${method}`, () => {
  const result = rasterizeRotation({ pixels: source.pixels, width: source.w, height: source.h, destinationWidth: source.dw, destinationHeight: source.dh, corners: source.points, method, mask: method === 'rotsprite' ? Array(source.w * source.h).fill(1) : null });
  assert.deepEqual([...result.pixels], source[method === 'fast' ? 'nearest' : 'rotsprite']);
});
for (const source of extended.cases) test(`native extended ${source.name}`, () => {
  const snapshot = structuredClone(source), result = rasterizeRotation(source);
  assert.deepEqual([...result.pixels], source.expected);
  assert.deepEqual(source, snapshot);
});
const rgba = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, value >>> 24];
const color = value => '#' + rgba(value).map(v => v.toString(16).padStart(2, '0')).join('');
const expectedRGBA = values => values.flatMap(value => value >>> 24 ? rgba(value) : [0, 0, 0, 0]);
for (const source of original.inputs) for (const method of ['fast', 'rotsprite']) test(`editor rotation contract ${source.name} ${source.angle}: ${method}`, () => {
  let doc = createDocument({ width: source.dw, height: source.dh });
  doc = applyCommand(doc, { type: 'cel.set', width: source.w, height: source.h, pixels: source.pixels.map(color) });
  const selection = buildSelection(doc, { shape: 'rect', x: 0, y: 0, width: source.w, height: source.h }), snapshot = structuredClone(doc);
  const result = applyCommand(doc, { type: 'selection.transform', selection, operation: 'rotate', angle: source.angle, dx: 16 - source.w / 2, dy: 16 - source.h / 2, method });
  assert.deepEqual([...renderFrame(result)], expectedRGBA(source[method === 'fast' ? 'nearest' : 'rotsprite']));
  assert.deepEqual(doc, snapshot);
});

test('aliases select exact Fast/RotSprite; nonrotation behavior and rejection remain explicit', () => {
  let doc = createDocument({ width: 8, height: 8 });
  doc = applyCommand(doc, { type: 'draw.line', from: { x: 1, y: 1 }, to: { x: 5, y: 5 }, color: '#ff0000ff' });
  const selection = buildSelection(doc, { shape: 'rect', x: 1, y: 1, width: 5, height: 5 });
  for (const [alias, method] of [['nearest', 'fast'], ['pixel-safe', 'rotsprite']]) assert.deepEqual(applyCommand(doc, { type: 'selection.transform', selection, operation: 'rotate', angle: 35, method: alias }), applyCommand(doc, { type: 'selection.transform', selection, operation: 'rotate', angle: 35, method }));
  for (const method of ['fast', 'rotsprite', 'pixel-safe']) assert.throws(() => applyCommand(doc, { type: 'selection.transform', selection, operation: 'move', method }), /rotation/);
  assert.throws(() => applyCommand(doc, { type: 'selection.transform', selection, operation: 'rotate', method: 'bilinear' }), /sampling/);
});

test('RGBA rotation copy composites partial alpha once and leaves transparent holes intact', () => {
  let doc = createDocument({ width: 4, height: 2 });
  doc = applyCommand(doc, { type: 'cel.set', width: 4, height: 2, pixels: ['#ff000080', null, '#0000ffff', '#00ff00ff', null, null, null, null] });
  const selection = buildSelection(doc, { shape: 'rect', x: 0, y: 0, width: 2, height: 1 });
  for (const method of ['fast', 'rotsprite']) {
    const result = applyCommand(doc, { type: 'selection.transform', selection, operation: 'rotate', angle: 0, dx: 2, copy: true, method });
    assert.deepEqual([...renderFrame(result).slice(8, 16)], [128, 0, 127, 255, 0, 255, 0, 255]);
    assert.deepEqual([...renderFrame(result).slice(0, 4)], [255, 0, 0, 128]);
  }
});

test('indexed rotations retain indices, duplicate-color slots and an unoccupied transparent sentinel', () => {
  let doc = createDocument({ width: 6, height: 6, colorMode: 'indexed', palette: ['#ff0000ff', '#ff0000ff', '#0000ffff'] });
  doc = applyCommand(doc, { type: 'cel.set', width: 2, height: 2, pixels: [0, 1, 2, null] });
  const selection = buildSelection(doc, { shape: 'rect', x: 0, y: 0, width: 2, height: 2 });
  for (const method of ['fast', 'rotsprite']) {
    const result = applyCommand(doc, { type: 'selection.transform', selection, operation: 'rotate', angle: 90, dx: 2, dy: 2, method });
    assert.deepEqual(result.palette, doc.palette);
    const values = getCel(result).image.pixels.filter(value => value != null).sort();
    assert.deepEqual(values, [0, 1, 2]);
  }
});

test('off-canvas editor rotation crops a complete transformed patch instead of shrinking into the canvas', () => {
  let doc = createDocument({ width: 4, height: 4 });
  doc = applyCommand(doc, { type: 'cel.set', width: 2, height: 2, pixels: ['#ff0000ff', '#00ff00ff', '#0000ffff', '#ffffffff'] });
  const selection = buildSelection(doc, { shape: 'rect', x: 0, y: 0, width: 2, height: 2 });
  for (const method of ['fast', 'rotsprite']) {
    const result = applyCommand(doc, { type: 'selection.transform', selection, operation: 'rotate', angle: 0, dx: -1, method });
    assert.deepEqual([...renderFrame(result).slice(0, 4)], [0, 255, 0, 255]);
    assert.deepEqual([...renderFrame(result).slice(16, 20)], [255, 255, 255, 255]);
  }
});

const tiny = { pixels: [0xff0000ff], width: 1, height: 1, destinationWidth: 1, destinationHeight: 1, corners: [[0, 0], [1, 0], [1, 1], [0, 1]] };
test('pure input validation and rotation resource limits reject before output allocation', () => {
  for (const patch of [{ width: 0 }, { width: 32768 }, { destinationWidth: Infinity }, { pixels: [] }, { pixels: [NaN] }, { pixelFormat: 'unknown' }, { mask: [2] }, { mask: [] }, { corners: [[0, 0], [1, 0], [2, 1], [0, 1]] }, { corners: [[0, 0], [1.1, 0], [1.1, 1], [0, 1]] }, { maskColor: 0xff000000 }]) assert.throws(() => rasterizeRotation({ ...tiny, ...patch }));
  assert.throws(() => rasterizeRotation({ ...tiny, destinationWidth: 32767, destinationHeight: 32767 }), /budget/);
  assert.throws(() => rasterizeRotation({ ...tiny, method: 'rotsprite', corners: [[0, 0], [4096, 0], [4096, 1], [0, 1]] }), /budget/);
  assert.throws(() => rasterizeRotation({ ...tiny, method: 'rotsprite', corners: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]] }), /budget/);
});

test('large rejected editor rotation rolls back the entire transaction and linked images', () => {
  let doc = createDocument({ width: 512, height: 512 });
  doc = applyCommand(doc, { type: 'draw.line', from: { x: 0, y: 0 }, to: { x: 511, y: 511 }, color: '#ff0000ff' });
  doc = applyCommand(doc, { type: 'frame.duplicate', linked: true });
  const before = structuredClone(doc), selection = Array(512 * 512).fill(1);
  assert.throws(() => applyCommand(doc, { type: 'batch', commands: [{ type: 'draw.stroke', points: [{ x: 1, y: 2 }], color: '#0000ffff' }, { type: 'selection.transform', selection, operation: 'rotate', angle: 45, method: 'rotsprite' }] }), /budget/);
  assert.deepEqual(doc, before);
});

test('all shared runtime bundles include the complete rotation notice asset', async () => {
  const target = await mkdtemp(join(tmpdir(), 'pixelwall-rotation-notices-'));
  try {
    await prepareRuntimes(target);
    assert(RUNTIME_FILES.includes('rotation-NOTICES.txt'));
    const expected = await readFile(new URL('../docs/rotation-NOTICES.txt', import.meta.url), 'utf8');
    assert.equal(await readFile(join(target, 'rotation-NOTICES.txt'), 'utf8'), expected);
    for (const value of ['Igara Studio S.A.', 'David Capello', 'Shawn Hargreaves', 'Andrew Geers', 'Sven Sandberg', 'Permission is hereby granted', 'Allegro is gift-ware']) assert(expected.includes(value));
  } finally { await rm(target, { recursive: true, force: true }); }
});

test('minified runtime code retains complete MIT permission and upstream attribution', async () => {
  const build = await rolldown({ input: new URL('../app/rotation-raster.mjs', import.meta.url).pathname, platform: 'browser' });
  try {
    const result = await build.generate({ format: 'es', minify: true });
    assert(result.output[0].code.includes('Permission is hereby granted'));
    assert(result.output[0].code.includes('Shawn Hargreaves'));
    assert(result.output[0].code.includes('THE SOFTWARE IS PROVIDED'));
  } finally { await build.close(); }
});

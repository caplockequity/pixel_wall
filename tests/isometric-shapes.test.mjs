import test from 'node:test';
import assert from 'node:assert/strict';
import { isometricFaces } from '../app/isometric-shapes.mjs';
import { createDocument, applyCommand, renderFrame, buildSelection, COMMANDS } from '../app/editor-core.mjs';
import { createHistory } from '../app/history.mjs';
import { writeAseprite, readAseprite } from '../app/formats.mjs';

const blank = () => createDocument({ width: 64, height: 64 });
const shape = (overrides = {}) => ({ type: 'draw.isometric', shape: 'block', x: 32, y: 24, width: 24, elevation: 12, color: '#99cc66', leftColor: '#335544', rightColor: '#557744', ...overrides });
const pixel = (doc, x, y) => [...renderFrame(doc).slice((y * doc.width + x) * 4, (y * doc.width + x) * 4 + 4)];

test('isometric geometry has a 2:1 ground footprint, separate elevated faces and mirrored ramps', () => {
  const tile = isometricFaces(shape({ shape: 'tile' }));
  assert.deepEqual(tile[0].points, [{ x: 32, y: 24 }, { x: 44, y: 30 }, { x: 32, y: 36 }, { x: 20, y: 30 }]);
  const block = isometricFaces(shape());
  assert.equal(block.length, 3);
  assert.deepEqual(block.at(-1).points[0], { x: 32, y: 12 });
  const left = isometricFaces(shape({ shape: 'ramp', direction: 'left' }));
  const right = isometricFaces(shape({ shape: 'ramp', direction: 'right' }));
  assert.equal(left[0].role, 'left');
  assert.equal(right[0].role, 'right');
  const coords = faces => faces.flatMap(f => f.points.map(p => `${p.x},${p.y}`)).sort();
  assert.deepEqual(coords(left), coords(right.map(f => ({ ...f, points: f.points.map(p => ({ x: 64 - p.x, y: p.y })) }))));
});

test('block raster exposes all three colors and undo/redo restores exact document state', () => {
  const original = blank(), drawn = applyCommand(original, shape());
  assert.deepEqual(pixel(drawn, 32, 19), [153, 204, 102, 255]);
  assert.deepEqual(pixel(drawn, 26, 28), [51, 85, 68, 255]);
  assert.deepEqual(pixel(drawn, 38, 28), [85, 119, 68, 255]);
  assert.equal(Object.keys(original.images).length, 0);
  const history = createHistory(original);
  history.commit(drawn, 'Isometric block');
  history.undo(); assert.deepEqual(history.present, original);
  history.redo(); assert.deepEqual(history.present, drawn);
  const roundtrip = readAseprite(writeAseprite(drawn)).document;
  assert.deepEqual(renderFrame(roundtrip), renderFrame(drawn));
});

test('shapes honor selection masks, locked layers, palette storage and independent frame targeting', () => {
  const original = blank();
  const selection = buildSelection(original, { shape: 'rect', x: 0, y: 0, width: 32, height: 64 });
  const masked = applyCommand(original, shape({ selection }));
  assert.equal(pixel(masked, 38, 28)[3], 0);
  assert.equal(pixel(masked, 26, 28)[3], 255);
  const locked = applyCommand(original, { type: 'layer.update', layerId: 'layer-1', patch: { locked: true } });
  assert.throws(() => applyCommand(locked, shape()), /locked/);
  const indexed = createDocument({ width: 64, height: 64, colorMode: 'indexed', palette: ['#99cc66', '#335544', '#557744'] });
  const painted = applyCommand(indexed, shape({ color: 0, leftColor: 1, rightColor: 2 }));
  assert.ok(Object.values(painted.images)[0].pixels.every(p => p === null || Number.isInteger(p)));
  const animated = applyCommand(original, { type: 'frame.add', id: 'second' });
  const secondOnly = applyCommand(animated, shape({ frameId: 'second' }));
  assert.ok(renderFrame(secondOnly).every(v => v === 0));
  assert.ok(renderFrame(secondOnly, 'second').some(v => v));
});

test('invalid geometry and late face-color failures preserve source; off-canvas shapes clip', () => {
  const original = blank(), snapshot = JSON.stringify(original);
  for (const overrides of [{ width: 15 }, { width: 516 }, { x: NaN }, { y: 0.2 }, { elevation: 513 }, { filled: 'true' }, { direction: 'up' }, { shape: 'sphere' }, { rightColor: 'bad' }]) {
    assert.throws(() => applyCommand(original, shape(overrides)));
    assert.equal(JSON.stringify(original), snapshot);
  }
  const clipped = applyCommand(original, shape({ x: -3, y: 0 }));
  assert.ok(renderFrame(clipped).some(v => v));
  assert.ok(COMMANDS.find(c => c.type === 'draw.isometric')?.parameters.direction);
});

test('ramp and outline output differs from a filled block while retaining its footprint', () => {
  const original = blank();
  const block = applyCommand(original, shape());
  for (const direction of ['left', 'right']) {
    const ramp = applyCommand(original, shape({ shape: 'ramp', direction }));
    assert.notDeepEqual(renderFrame(ramp), renderFrame(block));
    assert.equal(pixel(ramp, 32, 36)[3], 255);
  }
  const outline = applyCommand(original, shape({ shape: 'tile', filled: false }));
  assert.equal(pixel(outline, 32, 30)[3], 0);
  assert.equal(pixel(outline, 32, 24)[3], 255);
});

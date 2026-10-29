import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoPixels, DEMO_SIZE, paintDemoStroke, renderDemoPng } from '../app/homepage-demo-core.mjs';

test('tiny canvas interpolates a fast drag, preserves the original, and ignores no-op edits', () => {
  const original = Array(256).fill(null);
  const next = paintDemoStroke(original, { x: 0, y: 0 }, { x: 15, y: 15 }, '#ffe66d');
  assert.deepEqual(original, Array(256).fill(null));
  assert.equal(next.filter(Boolean).length, 16);
  for (let i = 0; i < 16; i++) assert.equal(next[i * 17], '#ffe66d');
  assert.equal(paintDemoStroke(next, { x: 0, y: 0 }, { x: 15, y: 15 }, '#ffe66d'), next);
  assert.equal(paintDemoStroke(next, { x: -1, y: 0 }, { x: 15, y: 15 }, '#ffe66d'), next);
  assert.deepEqual(paintDemoStroke(next, { x: 15, y: 15 }, { x: 0, y: 0 }, null), original);
});

test('PNG rendering uses native size, preserves transparency, and rejects encoding failures', async () => {
  const pixels = Array(256).fill(null); pixels[17] = '#ffe66d';
  const draws = [];
  const blob = new Blob(['png'], { type: 'image/png' });
  const context = { fillRect(...args) { draws.push([this.fillStyle, ...args]); } };
  const canvas = { getContext: () => context, toBlob(fn, type) { assert.equal(type, 'image/png'); fn(blob); } };
  assert.equal(await renderDemoPng(pixels, () => canvas), blob);
  assert.deepEqual(draws, [['#ffe66d', 1, 1, 1, 1]]);
  assert.equal(canvas.width, DEMO_SIZE); assert.equal(canvas.height, DEMO_SIZE);
  await assert.rejects(renderDemoPng(pixels, () => ({ ...canvas, toBlob: fn => fn(null) })), /encoding failed/);
  await assert.rejects(renderDemoPng(pixels, () => ({ ...canvas, getContext: () => null })), /Canvas unavailable/);
  await assert.rejects(renderDemoPng(pixels, () => { throw Error('unavailable'); }), /unavailable/);
});

test('starter pixels are independent for each demo instance', () => {
  const first = createDemoPixels(), second = createDemoPixels();
  assert.deepEqual(first, second);
  first[0] = null;
  assert.notEqual(first[0], second[0]);
});

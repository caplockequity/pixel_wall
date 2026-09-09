import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNodeColorManager } from '../app/color-runtime-node.mjs';
import { createGammaProfile } from '../app/color-management.mjs';
import { transferPixelColors } from '../app/color-transfer.mjs';

test('cross-project pixel and brush transfer preserves displayed color, alpha, and empty pixels', async () => {
  const manager = await loadNodeColorManager(), linear = manager.readProfile(createGammaProfile(1));
  const source = [null, '#80808080', '#80808080', '#ffffff00'];
  const output = transferPixelColors(source, linear, 'sRGB', manager);
  assert.deepEqual(output, [null, '#bcbcbc80', '#bcbcbc80', '#ffffff00']);
  assert.deepEqual(transferPixelColors(source, linear, linear, manager), source);
  assert.deepEqual(transferPixelColors(output, 'sRGB', linear, manager), source);
  assert.equal(source[1], '#80808080');
});

test('unmanaged sRGB transfer works before the runtime loads, while profile transfer fails explicitly', () => {
  const source = [null, '#ff0000ff'];
  assert.deepEqual(transferPixelColors(source), source);
  assert.throws(() => transferPixelColors(source, {type:1,flags:1,gamma:1}), /loading/);
});

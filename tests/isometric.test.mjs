import test from 'node:test';
import assert from 'node:assert/strict';
import { isoProject, isoUnproject, snapIso } from '../app/isometric.mjs';

test('2:1 projection round trips integer lattice points', () => {
  for (const point of [[0, 0], [3, 7], [-4, 2]]) {
    const screen = isoProject(point[0], point[1], 16, { x: 40, y: 20 });
    const world = isoUnproject(screen.x, screen.y, 16, { x: 40, y: 20 });
    assert.deepEqual(world, { x: point[0], y: point[1] });
  }
});

test('isometric snap is idempotent and stays on integer lattice', () => {
  const origin = { x: 32, y: 16 };
  const first = snapIso(39.2, 27.7, 12, origin);
  assert.deepEqual(snapIso(first.x, first.y, 12, origin), first);
  assert.equal(Number.isInteger(first.x), true);
  assert.equal(Number.isInteger(first.y), true);
});


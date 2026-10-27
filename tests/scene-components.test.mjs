import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, applyCommand, normalizeDocument, renderFrame, COMMANDS } from '../app/editor-core.mjs';
import { generateSceneComponent, listSceneComponentPresets, SCENE_COMPONENT_KINDS } from '../app/scene-components.mjs';

test('scene component presets are discoverable and deterministic', () => {
  assert.deepEqual(listSceneComponentPresets().map(value => value.kind), SCENE_COMPONENT_KINDS);
  for (const kind of SCENE_COMPONENT_KINDS) {
    const a = generateSceneComponent({ kind, seed: 42, position: { x: 3, y: 4 } });
    const b = generateSceneComponent({ kind, seed: 42, position: { x: 3, y: 4 } });
    assert.deepEqual(a, b);
    assert.ok(a.layers.length >= 2);
    assert.ok(a.layers.every(layer => layer.pixels.length === a.width * a.height));
    assert.ok(a.layers.some(layer => layer.pixels.some(Boolean)), `${kind} should contain visible pixels`);
  }
});

test('scene.component stamps named editable layers into every frame', () => {
  let doc = createDocument({ id: 'components', width: 64, height: 48 });
  doc = applyCommand(doc, { type: 'frame.add' });
  const result = applyCommand(doc, { type: 'scene.component', kind: 'bridge', style: 'woodland', seed: 9, position: { x: 12, y: 14 }, id: 'bridge-main' });
  assert.equal(result.id, 'components');
  assert.equal(result.layers.filter(layer => layer.id.startsWith('bridge-main-')).length, 3);
  for (const frame of result.frames) for (const layer of result.layers.filter(layer => layer.id.startsWith('bridge-main-'))) assert.ok(frame.cels[layer.id]);
  assert.equal(result.metadata.sceneComponents[0].kind, 'bridge');
  assert.ok(renderFrame(normalizeDocument(result), result.frames[0].id).some(value => value !== 0));
  assert.equal(result.frames[0].cels['bridge-main-component-bridge-1'].imageId, result.frames[1].cels['bridge-main-component-bridge-1'].imageId);
});

test('components clip safely at negative canvas positions and enforce layer limits atomically', () => {
  const clipped = applyCommand(createDocument({ width: 16, height: 16 }), { type: 'scene.component', kind: 'rock', position: { x: -8, y: -4 }, seed: 2 });
  assert.ok(renderFrame(clipped, clipped.frames[0].id).some(value => value !== 0));
  let full = createDocument({ width: 16, height: 16 });
  for (let i = 0; i < 127; i++) full = applyCommand(full, { type: 'scene.component', kind: 'rock', seed: i, id: `rock-${i}` });
  const before = structuredClone(full);
  assert.throws(() => applyCommand(full, { type: 'scene.component', kind: 'tree', id: 'over-limit' }), /layer|limit/i);
  assert.deepEqual(full, before);
});

test('components support palette overrides and reject unsafe bounds', () => {
  const base = generateSceneComponent({ kind: 'rock', seed: 4 });
  const custom = generateSceneComponent({ kind: 'rock', seed: 4, palette: { stone: '#112233' } });
  assert.notDeepEqual(base.layers, custom.layers);
  assert.throws(() => generateSceneComponent({ kind: 'tree', size: { width: 3, height: 8 } }), /width/i);
  assert.throws(() => generateSceneComponent({ kind: 'tree', position: { x: 1.5, y: 0 } }), /x/i);
  assert.throws(() => generateSceneComponent({ kind: 'nope' }), /Unknown scene component/);
  assert.throws(() => generateSceneComponent({ kind: 'constructor' }), /Unknown scene component/);
  assert.throws(() => generateSceneComponent({ kind: '__proto__' }), /Unknown scene component/);
});

test('scene.component is present in the executable command catalog', () => {
  assert.ok(COMMANDS.some(command => command.type === 'scene.component'));
});

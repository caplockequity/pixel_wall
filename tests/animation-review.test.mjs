import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, applyCommand, renderFrame, normalizeDocument } from '../app/editor-core.mjs';
import { diagnoseAnimation, bakeAnchoredMotion, compareAnimationWrap } from '../app/animation-review.mjs';
import { generateSceneComponent, regenerateSceneComponent, replaceSceneComponent } from '../app/scene-components.mjs';
import { generateWaterPatch, composeWaterPatch } from '../app/water-generator.mjs';

test('animation diagnostics report missing exposure and anchored drift with exclusions', () => {
  let doc = createDocument({ id: 'review', width: 8, height: 8 });
  doc = applyCommand(doc, { type: 'draw.rect', layerId: doc.layers[0].id, frameId: doc.frames[0].id, x: 1, y: 1, width: 2, height: 2, color: '#fff' });
  doc = applyCommand(doc, { type: 'frame.add' });
  const root = doc.layers[0].id;
  doc.frames[1].cels[root] = { ...doc.frames[0].cels[root], x: 1 };
  const report = diagnoseAnimation(doc, { anchoredLayers: [root], expectedFrameCount: 3 });
  assert.ok(report.warnings.some(value => value.code === 'anchored-drift'));
  assert.ok(report.warnings.some(value => value.code === 'frame-count'));
  assert.equal(diagnoseAnimation(doc, { anchoredLayers: [root], exclusions: [`missing-exposure:${root}`] }).ok, true);
});

test('anchored motion bakes ordinary editable cels and keeps pinned layers fixed', () => {
  let doc = createDocument({ id: 'motion', width: 12, height: 12 });
  doc = applyCommand(doc, { type: 'draw.rect', layerId: doc.layers[0].id, frameId: doc.frames[0].id, x: 2, y: 2, width: 3, height: 3, color: '#fff' });
  const layer = doc.layers[0].id;
  const baked = bakeAnchoredMotion(normalizeDocument(doc), { frames: 6, layers: [layer], pinnedLayers: [doc.layers[1]?.id ?? 'missing'], amplitudeX: 1 });
  assert.equal(baked.frames.length, 6);
  assert.equal(baked.metadata.animationBake.pinnedLayers.length, 1);
  assert.ok(Object.keys(baked.images).length > Object.keys(doc.images).length);
});

test('component recipes support art direction and protect manual layers', () => {
  const original = generateSceneComponent({ kind: 'tree', seed: 5, componentId: 'oak', artDirection: { crownAspectRatio: .7, asymmetry: .2 } });
  const variant = regenerateSceneComponent(original, { artDirection: { crownAspectRatio: 1.4, trunkBend: .2 } });
  assert.notDeepEqual(original.layers, variant.layers);
  const kept = replaceSceneComponent(original, variant, { preserveLayerIds: [original.layers[0].id] });
  assert.deepEqual(kept.layers.find(layer => layer.id === original.layers[0].id), original.layers[0]);
});

test('scene component replacement is editor-wired and preserves protected manual layers', () => {
  let doc = createDocument({ id: 'replace', width: 48, height: 48 });
  doc = applyCommand(doc, { type: 'scene.component', kind: 'tree', seed: 4, id: 'hero-tree', componentId: 'hero-tree' });
  const meta = doc.metadata.sceneComponents[0], protectedId = 'hero-tree-component-tree-1';
  const original = doc.images[doc.frames[0].cels[protectedId].imageId].pixels.slice();
  doc.metadata.sceneComponents[0].manualLayerIds = [protectedId];
  const changed = applyCommand(doc, { type: 'scene.component.replace', componentId: meta.componentId, recipe: { ...meta.recipe, artDirection: { crownAspectRatio: 1.5 } } });
  assert.deepEqual(changed.images[changed.frames[0].cels[protectedId].imageId].pixels, original);
  assert.ok(changed.metadata.sceneComponents[0].recipe.artDirection);
});

test('water patches compose only masked pixels and retain base dimensions', () => {
  const base = generateWaterPatch({ id: 'base', width: 32, height: 24, fieldWidth: 32, fieldHeight: 24, frames: 3, originX: 0, originY: 0 });
  const patch = generateWaterPatch({ id: 'patch', width: 8, height: 8, fieldWidth: 32, fieldHeight: 24, frames: 2, originX: 8, originY: 6 });
  const composed = composeWaterPatch(base, patch, { x: 8, y: 6, mask: (x, y) => x < 4 });
  assert.equal(composed.width, 32); assert.equal(composed.height, 24);
  assert.equal(composed.metadata.waterCompositions.length, 1);
  const monolithic = generateWaterPatch({ id: 'mono', width: 8, height: 8, fieldWidth: 32, fieldHeight: 24, frames: 2, originX: 8, originY: 6 });
  assert.deepEqual(composed.images[composed.frames[0].cels.water.imageId].pixels.slice(6 * 32 + 8, 6 * 32 + 16), monolithic.images[monolithic.frames[0].cels.water.imageId].pixels.slice(0, 8));
});

test('wrap comparison reports transition changes without requiring identical endpoints', () => {
  let doc = createDocument({ width: 4, height: 4 }); doc = applyCommand(doc, { type: 'frame.add' });
  const result = compareAnimationWrap(doc, { compareCount: 1, renderFrame });
  assert.equal(result.pairs.length, 1); assert.equal(typeof result.pairs[0].changedPixels, 'number');
});

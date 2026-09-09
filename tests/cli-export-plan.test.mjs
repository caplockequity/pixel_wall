import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDocument, normalizeDocument } from '../app/editor-core.mjs';
import { packAtlas } from '../app/formats.mjs';
import { planExport, buildExportMetadata, normalizeExportOptions, formatExportFilename, sliceBoundsAt } from '../app/cli-export-plan.mjs';

const oracle = JSON.parse(readFileSync(new URL('./fixtures/cli-export-oracle.json', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
for (const job of oracle.jobs) test(`Aseprite oracle: ${job.name}`, () => {
  const inputs = job.sources.map(name => ({ document: oracle.documents[name], filename: `${name}.aseprite` }));
  const plan = planExport(inputs, job.options);
  assert.equal(plan.entries.length, job.expected.length);
  plan.entries.forEach((entry, index) => {
    const expected = job.expected[index];
    for (const key of ['name', 'width', 'height', 'durationMs', 'sourceSize', 'spriteSourceSize', 'trimmed']) if (key in expected) assert.deepEqual(entry[key], expected[key], `${key}, frame ${index}`);
    assert.equal(hash(entry.rgba), expected.sha256, `all RGBA bytes, frame ${index}`);
  });
});

function sample() {
  const document = createDocument({ width: 4, height: 3, name: 'hero' });
  document.layers = [
    { ...document.layers[0], id: 'group', name: 'body', type: 'group', opacity: 0.5 },
    { ...document.layers[0], id: 'base', name: 'base', parentId: 'group' },
    { ...document.layers[0], id: 'hat', name: 'hat', parentId: 'group', visible: false },
    { ...document.layers[0], id: 'outside', name: 'outside' },
  ];
  document.images = {
    red: { width: 1, height: 1, pixels: ['#ff0000ff'] },
    green: { width: 1, height: 1, pixels: ['#00ff00ff'] },
    blue: { width: 1, height: 1, pixels: ['#0000ffff'] },
  };
  const cel = (imageId, x = 0) => ({ imageId, x, y: 1, opacity: 1 });
  document.frames = [
    { id: 'f0', durationMs: 75, cels: { base: cel('red'), hat: cel('green', 1), outside: cel('blue', 2) } },
    { id: 'f1', durationMs: 125, cels: {} },
    { id: 'f2', durationMs: 200, cels: { base: cel('green', 1) } },
  ];
  document.clips = [{ id: 'idle', name: 'idle', frameIds: ['f0', 'f1', 'f2'], direction: 'reverse' }];
  return normalizeDocument(document);
}
const input = document => [{ filename: '/sprites/hero.aseprite', document }];

test('layer filtering retains ancestors, opacity and visibility; exact selection can reveal a hidden layer', () => {
  const document = sample(), before = structuredClone(document);
  const plan = planExport(input(document), { layer: 'body/hat', frame: 0 });
  assert.deepEqual(plan.jobs[0].layerIds, ['hat']);
  assert.deepEqual(Array.from(plan.entries[0].rgba.slice(20, 24)), [0, 255, 0, 128]);
  assert.deepEqual(Array.from(plan.entries[0].rgba.slice(24, 28)), [0, 0, 0, 0]);
  assert.deepEqual(document, before);
});

test('split layers traverses visible leaves in hierarchy order, all-layers reveals hidden descendants', () => {
  const document = sample();
  const visible = planExport(input(document), { splitLayers: true, frame: 0 });
  assert.deepEqual(visible.jobs.map(job => job.layer.id), ['base', 'outside']);
  const all = planExport(input(document), { splitLayers: true, allLayers: true, frame: 0, ignoreLayer: ['outside'] });
  assert.deepEqual(all.jobs.map(job => job.layer.id), ['base', 'hat']);
  const group = planExport(input(document), { layer: 'body', frame: 0 });
  assert.deepEqual(group.jobs[0].layerIds, ['base']);
});

test('repeated layer includes form a union and ignored groups override included descendants', () => {
  const plan = planExport(input(sample()), { layer: ['body/base', 'body/hat'], 'ignore-layer': 'body', frame: 0 });
  assert.equal(plan.entries[0].empty, true);
  assert.deepEqual(plan.jobs[0].layerIds, []);
});

test('tag export stays in timeline order unless subtags are explicitly played; indices remain traceable', () => {
  const document = sample();
  assert.deepEqual(planExport(input(document), { tag: 'idle' }).entries.map(entry => entry.sourceFrameId), ['f0', 'f1', 'f2']);
  assert.deepEqual(planExport(input(document), { tag: 'idle', mode: 'animation' }).entries.map(entry => entry.sourceFrameId), ['f0', 'f1', 'f2']);
  document.clips[0].direction = 'pingpong';
  const plan = planExport(input(document), { clip: 'idle', mode: 'animation', playSubtags: true, filenameFormat: '{frame000}' });
  assert.deepEqual(plan.entries.map(entry => entry.sourceFrameId), ['f0', 'f1', 'f2', 'f1', 'f0']);
  assert.equal(new Set(plan.entries.map(entry => entry.id)).size, 5);
});

test('frame-range intersects tags; ignore-empty keeps original sequence numbering', () => {
  const plan = planExport(input(sample()), { tag: 'idle', frameRange: [1, 2], ignoreEmpty: true, filenameFormat: '{frame001}-{tagframe}-{sourceframe}-{duration}' });
  assert.equal(plan.entries.length, 1);
  assert.equal(plan.entries[0].name, '002-2-2-200');
  assert.equal(plan.entries[0].sourceFrameId, 'f2');
});

test('split tags retain independent document scopes and nested tag filename context', () => {
  const document = sample();
  document.clips.push({ id: 'blink', name: 'blink', frameIds: ['f2'], direction: 'forward' });
  const plan = planExport(input(document), { splitTags: true, filenameFormat: '{tag}-{frame}-{innertag}-{outertag}' });
  assert.deepEqual(plan.jobs.map(job => job.tag.id), ['idle', 'blink']);
  assert.equal(plan.entries.at(-1).name, 'blink-0-blink-idle');
  assert.equal(plan.jobs[1].document.frames.length, 3, 'source palette inheritance is retained');
});

test('moving slice keys are inherited, disabled by zero size, and preserve relative pivot', () => {
  const document = sample();
  document.slices = [{ id: 'face', name: 'face', keys: [
    { frameId: 'f0', x: -1, y: 0, width: 3, height: 3, pivot: { x: 1, y: 1 } },
    { frameId: 'f2', x: 0, y: 0, width: 0, height: 0 },
  ] }];
  assert.equal(sliceBoundsAt(document, document.slices[0], 1).x, -1);
  assert.equal(sliceBoundsAt(document, document.slices[0], 2), null);
  const plan = planExport(input(document), { splitSlices: true, scale: 2 });
  assert.equal(plan.entries.length, 2);
  assert.deepEqual(plan.entries[0].pivot, { x: 1 / 3, y: 1 / 3 });
  assert.deepEqual(plan.entries[0].crop, { x: -1, y: 0, width: 3, height: 3 });
  assert.equal(plan.entries[0].width, 6);
});

test('animated moving slices share a canvas while sequences retain per-frame dimensions', () => {
  const document = oracle.documents['slices-moving'];
  const sequence = planExport(input(document), { slice: 'square', mode: 'sequence' });
  assert.deepEqual(sequence.entries.map(entry => entry.width), [2, 4, 3, 4]);
  const animation = planExport(input(document), { slice: 'square', mode: 'animation' });
  assert.deepEqual(animation.entries.map(entry => [entry.width, entry.height]), [[4, 2], [4, 2], [4, 2], [4, 2]]);
});

test('trim-sprite uses a common bound; per-frame trim and inner padding retain source geometry', () => {
  const document = sample();
  const common = planExport(input(document), { trimSprite: true });
  assert.deepEqual(common.entries.map(entry => [entry.width, entry.height]), [[3, 1], [3, 1], [3, 1]]);
  assert.deepEqual(common.entries[0].spriteCrop, { x: 0, y: 1, width: 3, height: 1 });
  const plan = planExport(input(document), { trim: true, innerPadding: 2, scale: 2, ignoreEmpty: true });
  assert.deepEqual(plan.entries[0].sourceSize, { w: 8, h: 6 });
  assert.deepEqual(plan.entries[0].spriteSourceSize, { x: 0, y: 2, w: 6, h: 2 });
  assert.equal(plan.entries[0].width, 10);
  assert.equal(plan.atlasOptions.trim, false);
});

test('multi-input IDs, metadata tags and source paths cannot cross-contaminate matching frame IDs', () => {
  const document = sample(), other = sample(); other.name = 'enemy';
  const plan = planExport([{ document, filename: 'hero.aseprite' }, { document: other, filename: 'enemy.aseprite' }], { trim: true, ignoreEmpty: true, metadataFormat: 'json-array', tagnameFormat: '{title}/{tag}' });
  assert.equal(plan.entries.length, 4);
  assert.equal(new Set(plan.entries.map(entry => entry.id)).size, 4);
  const result = packAtlas(plan.entries, plan.atlasOptions), metadata = buildExportMetadata(result, plan);
  assert.deepEqual(metadata.meta.frameTags.map(tag => [tag.name, tag.frameIndices]), [['hero/idle', [0, 1]], ['enemy/idle', [2, 3]]]);
  assert.equal(metadata.frames[2].source.filename, 'enemy.aseprite');
  assert.deepEqual(metadata.frames[0].sourceSize, { w: 4, h: 3 });
  assert.deepEqual(metadata.frames[0].spriteSourceSize, { x: 0, y: 1, w: 3, h: 1 });
  const keyed = buildExportMetadata(result, plan, 'json-hash');
  assert.deepEqual(Object.keys(keyed.frames), plan.entries.map(entry => entry.name));
  assert.equal(keyed.frames[plan.entries[0].name].filename, undefined);
});

test('slice metadata follows exported frame order, crop origin, scale and original keys', () => {
  const document = oracle.documents['slices-moving'];
  const plan = planExport(input(document), { slice: 'square', frameRange: [1, 2], scale: 2 });
  const metadata = buildExportMetadata(packAtlas(plan.entries, plan.atlasOptions), plan);
  assert.deepEqual(metadata.meta.slices[0].keys.map(key => [key.frame, key.bounds]), [[0, { x: 0, y: 0, w: 8, h: 4 }], [1, { x: 0, y: 0, w: 6, h: 4 }]]);
  assert.equal(metadata.meta.sourceSlices[0].keys.length, 4);
});

test('filename placeholders use source path fields and numeric offsets with strict unknown-token errors', () => {
  const plan = planExport(input(sample()), { frame: 2, filenameFormat: '{fullname}|{path}|{name}|{title}|{extension}|{frame001}|{duration}' });
  assert.equal(plan.entries[0].name, '/sprites/hero.aseprite|/sprites|hero.aseprite|hero|aseprite|001|200');
  assert.equal(formatExportFilename('{frame010}/{tagframe001}', { frame: 3, tagframe: 4 }), '013/005');
  assert.throws(() => formatExportFilename('{typo}', {}), /Unknown filename placeholder/);
});

test('duplicate names fail before files can overwrite; metadata validates packer correspondence', () => {
  const document = sample();
  assert.throws(() => planExport(input(document), { filenameFormat: 'same.png' }), /Duplicate export filename/);
  assert.throws(() => planExport([{ document, filename: '/a/hero.aseprite' }, { document, filename: '/b/hero.aseprite' }]), /Duplicate export filename/);
  const plan = planExport(input(document));
  assert.throws(() => buildExportMetadata({ frames: [] }, plan), /frame count/);
});

test('invalid ranges and budget-expanding options fail explicitly; booleans handle false strings', () => {
  const document = sample();
  for (const options of [{ frameRange: '2,0' }, { frameRange: '0,9' }, { layer: 'missing' }, { tag: 'missing' }, { slice: 'missing' }, { scale: 0 }, { scale: -0.5 }, { padding: -1 }, { crop: '0,0,100000,100000' }, { innerPadding: 16384 }]) assert.throws(() => planExport(input(document), options));
  assert.equal(normalizeExportOptions({ trim: 'false', 'all-layers': 'false' }).trim, false);
  assert.equal(normalizeExportOptions({ 'shape-padding': 2, 'border-padding': 3, extrude: true }).extrude, 1);
});

test('per-input scopes select independently while atlas geometry stays global', () => {
  const document = sample();
  const plan = planExport([{ document, filename: 'body.aseprite', options: { layer: 'body', frame: 0 } }, { document, filename: 'outside.aseprite', options: { layer: 'outside', frame: 2 } }], { padding: 2, border: 1, layout: 'rows', columns: 2 });
  assert.equal(plan.entries.length, 2);
  assert.deepEqual(plan.jobs.map(job => job.layerIds), [['base'], ['outside']]);
  assert.equal(plan.atlasOptions.layout, 'grid');
  assert.equal(plan.atlasOptions.padding, 2);
  assert.throws(() => planExport([{ document, options: { padding: 8 } }]), /globally/);
});

test('a fully empty ignored export returns an explicit empty plan without fabricating a frame', () => {
  const plan = planExport(input(sample()), { frame: 1, ignoreEmpty: true });
  assert.equal(plan.entries.length, 0);
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].entryIds.length, 0);
});

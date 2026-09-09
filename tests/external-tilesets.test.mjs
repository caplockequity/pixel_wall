import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readAseprite, writeAseprite } from '../app/formats.mjs';
import { normalizeDocument, renderFrame, applyCommand } from '../app/editor-core.mjs';
import { resolveExternalTileset, listExternalTilesets } from '../app/external-tilesets.mjs';
import { loadNodeColorManager } from '../app/color-runtime-node.mjs';
import { createGammaProfile } from '../app/color-management.mjs';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/external-tileset-oracle.json', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
function sample(mode = 'rgba') { const data = fixture.modes[mode]; return { source: readAseprite(Buffer.from(data.source, 'base64')).document, target: readAseprite(Buffer.from(data.external, 'base64')).document, expected: data.frames }; }
const resolve = ({ source, target }, extra = {}) => resolveExternalTileset(target, { tilesetId: 'tileset-47', sourceDocument: source, ...extra });

for (const mode of ['rgba', 'indexed']) test(`Aseprite external/source fixture resolves exact ${mode} pixels and survives native re-export`, () => {
  const input = sample(mode), beforeSource = structuredClone(input.source), beforeTarget = structuredClone(input.target);
  const result = resolve(input), document = result.document;
  assert.deepEqual(input.source, beforeSource); assert.deepEqual(input.target, beforeTarget);
  assert.equal(result.resolution.sourceNativeTilesetId, 91);
  assert.equal(result.resolution.convertedColors, false);
  assert.equal(result.resolution.usesDestinationPalette, mode === 'indexed');
  const tileset = document.tilesets.find(value => value.id === 'tileset-47');
  assert.equal(tileset.asepriteId, 47); assert.equal(tileset.baseIndex, 7); assert.equal(tileset.flags, 6);
  assert.equal(tileset.externalFileId, undefined); assert.equal(tileset.externalTilesetId, undefined);
  assert.deepEqual(document.layers, beforeTarget.layers);
  assert.deepEqual(document.frames, beforeTarget.frames);
  for (const [index, frame] of document.frames.entries()) assert.equal(hash(renderFrame(document, frame.id)), input.expected[index]);
  const imported = normalizeDocument(readAseprite(writeAseprite(document)).document);
  for (const [index, frame] of imported.frames.entries()) assert.equal(hash(renderFrame(imported, frame.id)), input.expected[index]);
});

test('external listing exposes labels without interpreting or following filenames', () => {
  const { target } = sample(); target.metadata.aseprite.externalFiles[0].name = '../../private/source.aseprite';
  const values = listExternalTilesets(target);
  assert.equal(values.length, 1);
  assert.deepEqual(values[0], { tilesetId: 'tileset-47', name: 'terrain', externalFileId: 19, externalTilesetId: 91, sourceLabel: '../../private/source.aseprite', hasEmbeddedFallback: false, tileWidth: 2, tileHeight: 2, tileCount: 3 });
  assert.throws(() => resolveExternalTileset(target, { tilesetId: 'tileset-47', sourceDocument: '../../private/source.aseprite' }), /JSON|document/i);
});

test('exact native source ID is required, rather than file-order index or matching name', () => {
  const input = sample(); input.source.tilesets[1].asepriteId = 1;
  assert.throws(() => resolve(input), /ID 91/);
  input.source.tilesets[0].asepriteId = 91; input.source.tilesets[1].asepriteId = 91;
  assert.throws(() => resolve(input), /exactly one/);
});

test('all native map bits, linked cels, hidden layers and signed display base index remain intact', () => {
  const input = sample(), layer = input.target.layers[1], tileset = input.target.tilesets[1];
  layer.visible = false; tileset.baseIndex = -3; tileset.flags |= 8 | 16 | 32 | 0x80;
  const first = input.target.frames[0].cels[layer.id]; input.target.frames[1].cels[layer.id].imageId = first.imageId;
  const document = resolve(input).document;
  assert.deepEqual(document.frames, input.target.frames);
  assert.deepEqual(document.images[first.imageId], input.target.images[first.imageId]);
  assert.equal(document.layers[1].visible, false); assert.equal(document.tilesets[1].baseIndex, -3);
  assert.equal(document.tilesets[1].flags, 6 | 8 | 16 | 32 | 0x80);
});

test('missing referenced tile is detected in later hidden animation frames', () => {
  const input = sample(), layer = input.target.layers[1]; layer.visible = false;
  const cel = input.target.frames[1].cels[layer.id], image = input.target.images[cel.imageId];
  image.tilemap.tiles[0] = 5 | 0x40000000;
  assert.throws(() => resolve(input), /missing tile 5.*frame-2/);
});

test('dimensions, incomplete sources, nested links and missing registry entries fail explicitly', () => {
  let input = sample(); input.source.tilesets[1].tileWidth = 1;
  assert.throws(() => resolve(input), /grid/);
  input = sample(); input.target.tilesets[1].tileCount = 4;
  assert.throws(() => resolve(input), /fewer tiles/);
  input = sample(); input.source.tilesets[1].flags = 5; delete input.source.tilesets[1].imageId; delete input.source.tilesets[1].tiles;
  assert.throws(() => resolve(input), /no embedded pixels/);
  input = sample(); input.target.metadata.aseprite.externalFiles = [];
  assert.throws(() => resolve(input), /registry/);
});

test('locked referencing layers and inherited group locks prevent replacing shared artwork', () => {
  let input = sample(); input.target.layers[1].locked = true;
  assert.throws(() => resolve(input), /locked/);
  input = sample(); const group = { id: 'group', name: 'Locked group', type: 'group', parentId: null, visible: true, locked: true, opacity: 1, blendMode: 'normal' };
  input.target.layers.unshift(group); input.target.layers[2].parentId = group.id;
  assert.throws(() => resolve(input), /Locked group.*locked/);
});

test('indexed tile bytes use destination per-frame palettes without unnecessary color conversion', () => {
  const input = sample('indexed'); input.target.frames[1].palette = [...input.target.palette]; input.target.frames[1].palette[1] = '#0000ffff';
  let calls = 0;
  const result = resolve(input, { colorManager: { transformColors() { calls++; throw Error('must not convert indices'); } } });
  assert.equal(calls, 0);
  const p0 = renderFrame(result.document, result.document.frames[0].id), p1 = renderFrame(result.document, result.document.frames[1].id);
  assert.deepEqual([...p0.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...p1.slice((2 * 8) * 4, (2 * 8 + 1) * 4)], [0, 0, 255, 255]);
  assert.deepEqual(result.document.frames, input.target.frames);
});

test('indexed transparency or missing palette indices reject instead of repainting existing frames', () => {
  let input = sample('indexed'); input.target.metadata.aseprite.transparentIndex = 2;
  assert.throws(() => resolve(input), /transparent palette index/);
  input = sample('indexed'); input.target.palette = input.target.palette.slice(0, 2); for (const f of input.target.frames) if (f.palette) f.palette = f.palette.slice(0, 2);
  assert.throws(() => resolve(input), /missing palette index 2/);
});

test('equal working profiles preserve literal RGBA and alpha without invoking the manager', () => {
  const input = sample(), tile = input.source.tilesets[1], image = input.source.images[tile.imageId];
  image.pixels[0] = '#80402080';
  input.source.metadata.aseprite.colorProfile = { type: 1, flags: 1, gamma: 1.8 }; input.target.metadata.aseprite.colorProfile = { gamma: 1.8, flags: 1, type: 1 };
  let calls = 0; const result = resolve(input, { colorManager: { transformColors() { calls++; } } });
  assert.equal(calls, 0);
  assert.equal(result.document.images[result.document.tilesets[1].imageId].pixels[0], '#80402080');
});

test('different RGB profiles require and use LittleCMS once, retaining alpha and the destination profile', async () => {
  const input = sample(), manager = await loadNodeColorManager(), linear = manager.readProfile(createGammaProfile(1));
  input.source.metadata.aseprite.colorProfile = linear;
  input.source.images[input.source.tilesets[1].imageId].pixels[4] = '#80808080';
  assert.throws(() => resolve(input), /different color profiles/);
  let calls = 0;
  const result = resolve(input, { colorManager: { transformColors(...args) { calls++; return manager.transformColors(...args); } } });
  assert.equal(calls, 1); assert.equal(result.resolution.convertedColors, true);
  assert.equal(result.document.images[result.document.tilesets[1].imageId].pixels[4], '#bcbcbc80');
  assert.deepEqual(result.document.metadata.aseprite.colorProfile, input.target.metadata.aseprite.colorProfile);
});

test('invalid profile conversion outputs cannot corrupt or partially replace a document', () => {
  const input = sample(); input.source.metadata.aseprite.colorProfile = { type: 1, flags: 1, gamma: 1 };
  const before = structuredClone(input.target);
  assert.throws(() => resolve(input, { colorManager: { transformColors() { return []; } } }), /invalid conversion/);
  assert.throws(() => resolve(input, { colorManager: { transformColors(colors) { return colors.map(value => value.slice(0, 7) + '7f'); } } }), /changed alpha/);
  assert.deepEqual(input.target, before);
});

test('embedded fallback resolution preserves editable tile IDs and collects only replaced orphan atlas images', () => {
  const input = sample(), initial = resolve(input).document, target = initial.tilesets[1];
  target.flags |= 1; target.externalFileId = 19; target.externalTilesetId = 91;
  target.tiles[1].id = 'custom-tile'; const oldId = target.imageId;
  initial.layers[1].tilemaps = { [initial.frames[0].id]: { tilesetId: target.id, columns: 1, rows: 1, x: 0, y: 0, cells: [{ tileId: 'custom-tile', flipX: true, flipY: true, rotate: 90 }] } };
  const result = resolve({ target: initial, source: input.source }).document;
  assert.equal(result.tilesets[1].tiles[1].id, 'custom-tile');
  assert.deepEqual(result.layers[1].tilemaps, initial.layers[1].tilemaps);
  assert.equal(result.images[oldId], undefined);
  assert.ok(result.images['tileset-image-0'], 'unrelated embedded atlas survives');
});

test('replacement keeps a prior atlas image when another cel still uses it', () => {
  const input = sample(), initial = resolve(input).document, target = initial.tilesets[1];
  target.flags |= 1; target.externalFileId = 19; target.externalTilesetId = 91;
  const oldId = target.imageId;
  initial.frames[0].cels[initial.layers[0].id] = { imageId: oldId, x: 0, y: 0, opacity: 1 };
  const result = resolve({ target: initial, source: input.source }).document;
  assert.ok(result.images[oldId]);
});

test('mixed raster modes fail explicitly and already embedded documents cannot resolve twice', () => {
  const input = sample(), other = sample('indexed');
  assert.throws(() => resolve({ source: other.source, target: input.target }), /same color mode/);
  const result = resolve(input).document;
  assert.throws(() => resolve({ source: input.source, target: result }), /no unresolved external link/);
});

test('resolved tiles remain editable through existing tile commands without changing animation IDs', () => {
  const input = sample(), resolved = resolve(input).document;
  const next = applyCommand(resolved, { type: 'tilemap.edit', layerId: resolved.layers[1].id, frameId: resolved.frames[0].id, x: 0, y: 0, mode: 'manual', pixels: ['#0000ffff','#0000ffff','#0000ffff','#0000ffff'] });
  assert.deepEqual(next.frames.map(frame => frame.id), resolved.frames.map(frame => frame.id));
  assert.deepEqual([...renderFrame(next).slice(0, 4)], [0, 0, 255, 255]);
});


test('same-profile grayscale sources embed and export without altering gray or alpha channels', () => {
  const input = sample();
  for (const document of [input.source, input.target]) {
    document.colorMode = 'grayscale';
    for (const image of Object.values(document.images)) if (!image.tilemap) image.pixels = image.pixels.map(value => value === null ? null : '#80808080');
  }
  input.target.layers[0].visible = false;
  const result = resolve(input).document, imported = readAseprite(writeAseprite(result)).document;
  assert.equal(result.colorMode, 'grayscale');
  assert.deepEqual([...renderFrame(result).slice(0, 4)], [128, 128, 128, 128]);
  for (const frame of result.frames) assert.deepEqual(renderFrame(imported, frame.id), renderFrame(result, frame.id));
});

test('legacy empty tile sentinel is retained while native tile zero remains drawable', () => {
  const input = sample(), layer = input.target.layers[1];
  input.target.tilesets[1].flags &= ~4;
  const sourceAtlas = input.source.images[input.source.tilesets[1].imageId];
  sourceAtlas.pixels.splice(0, 4, ...Array(4).fill('#123456ff'));
  for (const frame of input.target.frames) input.target.images[frame.cels[layer.id].imageId].tilemap.tiles.fill(0xffffffff);
  input.target.images[input.target.frames[0].cels[layer.id].imageId].tilemap.tiles[0] = 0;
  const result = resolve(input).document, imported = readAseprite(writeAseprite(result)).document;
  assert.deepEqual([...renderFrame(result).slice(0, 4)], [18, 52, 86, 255]);
  assert.deepEqual([...renderFrame(result).slice(8, 12)], [0, 0, 0, 0]);
  assert.deepEqual(renderFrame(result), renderFrame(imported));
  assert.equal(result.tilesets[1].flags, 2);
});

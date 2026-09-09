import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { createDocument, normalizeDocument, applyCommand, renderFrame, getTile } from '../app/editor-core.mjs';
import { readAseprite, writeAseprite } from '../app/formats.mjs';
import { decodeAsepriteProperties } from '../app/aseprite-properties.mjs';
import { tilesetSlots } from '../app/tileset-access.mjs';
import { validateLuaResult } from '../app/lua-session.mjs';
const oracle = JSON.parse(readFileSync(new URL('./fixtures/lua-tileset-native.json', import.meta.url)));
const source = readFileSync(new URL('./fixtures/lua-tileset-oracle.lua', import.meta.url), 'utf8');
const read = data => normalizeDocument(readAseprite(Buffer.from(data, 'base64')).document);
const fixture = (mode = 'rgb') => read(oracle.cases.find(value => value.mode === mode).initialBase64);
const metadata = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'propertiesBytes' ? decodeAsepriteProperties(item) : item));
const tile = (document, index) => getTile(document, document.tilesets[0].id, tilesetSlots(document, document.tilesets[0]).entries.get(index).id);
const engine = () => applyCommand(createDocument({ width: 4, height: 2 }), { type: 'tileset.add', tileset: { id: 'terrain', tileWidth: 2, tileHeight: 2, tiles: [{ id: 'grass', pixels: Array(4).fill('#ff0000ff') }, { id: 'water', pixels: Array(4).fill('#0000ffff') }] } });

for (const native of oracle.cases) test(`${native.mode}: original native script, native metadata and both exact rendered frames survive authoring/export`, async () => {
  const document = read(native.initialBase64), before = structuredClone(document);
  const result = await runLuaScript({ document, source });
  assert.deepEqual(result.prints, ['native-tileset-contract-ok']);
  assert.deepEqual(document, before); validateLuaResult(result, document);
  const reopened = normalizeDocument(readAseprite(writeAseprite(result.document)).document), expected = read(native.expectedBase64);
  for (let index = 0; index < 2; index++) {
    const bytes = Buffer.from(native.framesRGBA[index], 'base64');
    assert.deepEqual(Buffer.from(renderFrame(result.document, result.document.frames[index].id)), bytes);
    assert.deepEqual(Buffer.from(renderFrame(reopened, reopened.frames[index].id)), bytes);
  }
  for (const property of ['name', 'baseIndex', 'tileCount', 'userData', 'tileUserData']) assert.deepEqual(metadata(reopened.tilesets[0][property]), metadata(expected.tilesets[0][property]));
  for (const frame of document.frames) for (const [layerId, cel] of Object.entries(frame.cels)) {
    assert.equal(result.document.frames.find(value => value.id === frame.id).cels[layerId].imageId, cel.imageId);
    if (document.images[cel.imageId].tilemap) assert.deepEqual(result.document.images[cel.imageId], document.images[cel.imageId]);
  }
  assert.equal(result.document.tilesets[0].tiles.length, 3);
});

test('every layer using a tileset, including hidden descendants, protects buffered and command edits', async () => {
  const document = fixture(); document.layers[2].locked = true;
  const result = await runLuaScript({ document, source: `
    local ts=app.sprite.tilesets[1];local tile=ts:tile(1);local image=tile.image;local before=image.bytes
    for _,edit in ipairs{
      function()image:drawPixel(0,0,1)end,function()image:clear()end,function()image.bytes=before end,
      function()image:flip()end,function()image:resize(2,2)end,function()tile.image=Image(image)end,
      function()ts.name='changed'end,function()ts.baseIndex=3 end,function()ts.data='changed'end,
      function()tile.color=Color{r=1,g=2,b=3}end,function()ts.properties.bad=true end,
      function()tile.properties('extra').bad=true end
    }do assert(not pcall(edit))end
    assert(image.bytes==before and ts.name=='Native tiles')
  ` });
  assert.equal(result.transactions.length, 0); assert.deepEqual(result.document, document);
  const group = { ...document.layers[0], id: 'locked-parent', type: 'group', locked: true }; document.layers.push(group); document.layers[2].locked = false; document.layers[2].parentId = group.id;
  await assert.rejects(runLuaScript({ document, source: `app.sprite.tilesets[1]:tile(1).image:clear()` }), /locked/);
});

test('failed transaction restores buffered tile bytes and native metadata then successful writes replay together', async () => {
  const document = fixture();
  const result = await runLuaScript({ document, source: `
    local ts=app.sprite.tilesets[1];local t=ts:tile(1);local i=t.image;local before=i.bytes
    assert(not pcall(function()app.transaction('failed',function()
      i:clear();ts.data='bad';t.properties.extra={1,2,3};ts.baseIndex=9;error('rollback')
    end)end))
    assert(i.bytes==before and ts.data=='original set' and t.properties.extra==nil and ts.baseIndex==1)
    app.transaction('paint tiles',function()i:clear(app.pixelColor.rgba(20,30,40,255));t.data='ok'end)
  ` });
  assert.deepEqual(tile(result.document, 1).pixels, Array(4).fill('#141e28ff'));
  assert.equal(result.transactions.length, 1); assert.equal(result.transactions[0].label, 'paint tiles'); validateLuaResult(result, document);
});

test('tile replacement invalidates previous images and preserves independent tile images', async () => {
  const result = await runLuaScript({ document: fixture(), source: `
    local ts=app.sprite.tilesets[1];local a=ts:tile(1);local b=ts:tile(2);local old=a.image;local bbytes=b.image.bytes
    a.image=b.image;assert(a.image.bytes==bbytes and b.image.bytes==bbytes)
    assert(not pcall(function()old:clear()end))
    a.image:clear();assert(b.image.bytes==bbytes)
  ` });
  assert.deepEqual(tile(result.document, 1).pixels, Array(4).fill(null));
  assert.deepEqual(tile(result.document, 2).pixels, Array(4).fill('#0000ffff'));
});

test('engine tile numbering reserves zero and metadata follows native export indices', async () => {
  const document = engine();
  const result = await runLuaScript({ document, source: `
    local ts=app.sprite.tilesets[1];assert(#ts==3 and ts:tile(0).image:isEmpty())
    assert(not pcall(function()ts:tile(0).image:clear(1)end))
    assert(not pcall(function()ts:tile(0).image=Image(2,2)end))
    ts:tile(0).data='reserved';ts:tile(1).data='grass';ts:tile(2).properties.name='water'
    ts:tile(2).image:clear(app.pixelColor.rgba(0,255,0,255))
  ` });
  const reopened = normalizeDocument(readAseprite(writeAseprite(result.document)).document), ts = reopened.tilesets[0];
  assert.equal(ts.tileCount, 3); assert.equal(ts.tileUserData[0].text, 'reserved'); assert.equal(ts.tileUserData[1].text, 'grass');
  assert.equal(decodeAsepriteProperties(ts.tileUserData[2].propertiesBytes)[0].name, 'water');
  assert.deepEqual(tile(reopened, 2).pixels, Array(4).fill('#00ff00ff'));
});

test('editing a tile does not mutate another tileset or raster cel that shares its underlying storage', async () => {
  const document = fixture(), ts = document.tilesets[0], atlas = ts.imageId;
  document.tilesets.push({ ...structuredClone(ts), id: 'second-tileset', asepriteId: 98 });
  const result = await runLuaScript({ document, source: `
    local a=app.sprite.tilesets[1];local b=app.sprite.tilesets[2];local before=b:tile(1).image.bytes
    a:tile(1).image:clear();assert(b:tile(1).image.bytes==before)
  ` });
  assert.notEqual(result.document.tilesets[0].imageId, atlas); assert.equal(result.document.tilesets[1].imageId, atlas);
  assert.deepEqual(result.document.images[atlas], document.images[atlas]);
  const editable = engine(); editable.tilesets[0].tiles[1].imageId = editable.tilesets[0].tiles[0].imageId;
  const next = await runLuaScript({ document: editable, source: `
    local ts=app.sprite.tilesets[1];local before=ts:tile(2).image.bytes;ts:tile(1).image:clear();assert(ts:tile(2).image.bytes==before)
  ` });
  assert.notEqual(next.document.tilesets[0].tiles[0].imageId, next.document.tilesets[0].tiles[1].imageId);
});

test('metadata edits validate signed baseIndex, names and property codec before changing state', async () => {
  const document = fixture();
  const result = await runLuaScript({ document, source: `
    local ts=app.sprite.tilesets[1];local t=ts:tile(1)
    assert(not pcall(function()ts.baseIndex=32768 end));assert(not pcall(function()ts.baseIndex=1.5 end))
    assert(not pcall(function()ts.name=string.rep('x',241)end));assert(not pcall(function()ts.name='bad\\0name'end))
    assert(not pcall(function()t.properties.bad=0/0 end));assert(not pcall(function()t.properties.bad=string.rep('x',70000)end))
    assert(ts.baseIndex==1 and ts.name=='Native tiles' and t.properties.bad==nil)
    ts.name='';assert(ts.name=='')
  ` });
  assert.equal(result.document.tilesets[0].name, '');
  assert.throws(() => applyCommand(document, { type: 'object.userData', target: 'tile', tilesetId: document.tilesets[0].id, tileIndex: 1, userData: { propertiesBytes: [0, 0] } }), /propert|truncat|invalid/i);
  assert.throws(() => applyCommand(document, { type: 'object.userData', target: 'tile', tilesetId: document.tilesets[0].id, tileIndex: -1, userData: {} }), /Tile index/);
});

test('incompatible tile dimensions and color modes reject before replacement or resize', async () => {
  const document = fixture();
  const result = await runLuaScript({ document, source: `
    local t=app.sprite.tilesets[1]:tile(1);local i=t.image;local before=i.bytes
    assert(not pcall(function()t.image=Image(1,1)end));assert(not pcall(function()i:resize(4,4)end))
    assert(not pcall(function()t.image=Image(2,2,ColorMode.INDEXED)end));assert(i.bytes==before)
    assert(not pcall(function()local unsupported=i.cel end))
    assert(not pcall(function()t.index=2 end));assert(not pcall(function()app.sprite.tilesets[1].grid=Grid()end))
  ` });
  assert.equal(result.stats.commands, 0);
});

test('delete-unused tileset returns stale-handle errors and referenced or foreign deletion remains blocked', async () => {
  const document = engine();
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local ts=s.tilesets[1];local t=ts:tile(1);local image=t.image
    s:deleteTileset(ts);assert(#s.tilesets==0)
    assert(not pcall(function()local n=ts.name end));assert(not pcall(function()local n=t.image end));assert(not pcall(function()image:clear()end))
  ` });
  assert.equal(result.document.tilesets.length, 0); assert.equal(Object.keys(result.document.images).length, 0);
  await assert.rejects(runLuaScript({ document: fixture(), source: `app.sprite:deleteTileset(1)` }), /used by a layer/);
  await assert.rejects(runLuaScript({ document: engine(), source: `local old=app.sprite.tilesets[1];local other=Sprite(2,2);other:deleteTileset(old)` }), /another sprite/);
});

test('invalid reindexing and unsupported methods are explicit and layer frame switches are not misreported', async () => {
  const document = fixture();
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local ts=s.tilesets[1]
    assert(not pcall(function()s:newTilemap()end));assert(not pcall(function()s:newTile(ts,0)end));assert(not pcall(function()s:deleteTile(ts,0)end))
    assert(not pcall(function()s.layers[2].tileset='invalid' end))
    assert(not pcall(function()ts:tile(1.5)end));assert(not pcall(function()ts:tile(1,2)end))
  ` });
  assert.equal(result.stats.commands, 0);
  const mixed = engine(); mixed.tilesets.push({ ...structuredClone(mixed.tilesets[0]), id: 'other' });
  mixed.layers[0].type = 'tilemap'; mixed.layers[0].tilesetId = 'terrain'; mixed.layers[0].tilemaps = { 'frame-1': { tilesetId: 'other', columns: 1, rows: 1, cells: [null] } };
  await assert.rejects(runLuaScript({ document: mixed, source: `local ts=app.layer.tileset` }), /changes tilesets between frames/);
});

test('external metadata remains readable but missing artwork requires an explicit embed first', async () => {
  const document = fixture(), ts = document.tilesets[0]; delete document.images[ts.imageId]; delete ts.imageId; delete ts.tiles; ts.flags = 5; ts.externalFileId = 1; ts.externalTilesetId = 2;
  const result = await runLuaScript({ document, source: `
    local ts=app.sprite.tilesets[1];assert(#ts==3 and ts:tile(1).data=='original tile')
    assert(not pcall(function()local image=ts:tile(1).image end));ts:tile(1).data='external metadata'
  ` });
  assert.equal(result.document.tilesets[0].tileUserData[1].text, 'external metadata');
});

test('indexed tile writes retain indices present in later frame palettes and linked placements use those palettes', async () => {
  const document = fixture('indexed'); document.palette = document.palette.slice(0, 2); document.frames[0].palette = document.palette;
  document.frames[1].palette = ['#00000000', '#ff0000ff', '#ffff00ff', '#00ffffff'];
  const result = await runLuaScript({ document, source: `
    local i=app.sprite.tilesets[1]:tile(1).image;i:drawPixel(0,0,3);i.bytes=string.char(3,3,3,3)
    local image=Image(app.sprite);assert(image:getPixel(0,0)==3)
  ` });
  assert.deepEqual(tile(result.document, 1).pixels, [3, 3, 3, 3]);
  assert.deepEqual([...renderFrame(result.document, result.document.frames[1].id).slice(0, 4)], [0, 255, 255, 255]);
});

test('native-to-engine conversion after Auto cleanup uses engine indices starting at one', async () => {
  let document = fixture(); document = applyCommand(document, { type: 'tilemap.edit', layerId: document.layers[1].id, frameId: document.frames[0].id, x: 0, y: 0, pixels: Array(4).fill('#abcdefFF'), mode: 'auto' });
  // A valid post-cleanup tileset retains its imported resource ID while its atlas is materialized.
  const ts = document.tilesets[0]; const plans = ts.tiles.filter(tile => tile.asepriteTileId !== 0).map(t => ({ ...t, raster: getTile(document, ts.id, t.id) }));
  delete ts.imageId; delete ts.tileCount; ts.tiles = plans.map((t, index) => { const imageId = `materialized-${index}`; document.images[imageId] = t.raster; return { id: t.id, imageId }; });
  document.layers = [document.layers[0]]; for (const frame of document.frames) frame.cels = {};
  const result = await runLuaScript({ document, source: `local ts=app.sprite.tilesets[1];assert(ts:tile(0).image:isEmpty());ts:tile(1).image:clear();assert(ts:tile(1).image:isEmpty())` });
  assert.equal(tilesetSlots(result.document, result.document.tilesets[0]).count, ts.tiles.length + 1);
});

test('oversized engine tile grids reject before allocating a raster image', async () => {
  const document = engine(); document.tilesets[0].tileWidth = 65535; document.tilesets[0].tileHeight = 65535;
  const result = await runLuaScript({ document, source: `
    local ts=app.sprite.tilesets[1];assert(ts.grid.tileSize.width==65535)
    local ok,err=pcall(function()local image=ts:tile(1).image end);assert(not ok and err:find('pixel budget'))
  ` });
  assert.equal(result.stats.commands, 0);
});

test('per-frame color conversion tile variants remain editable without overwriting the original native atlas', async () => {
  let document = fixture('indexed'); document.frames[1].palette = ['#00000000', '#ffff00ff', '#ff00ffff', '#00ffffff'];
  document = applyCommand(document, { type: 'document.colorMode', colorMode: 'rgba' });
  const slots = tilesetSlots(document, document.tilesets[0]); assert.ok(slots.count > 3);
  const target = [...slots.entries].find(([, tile]) => tile.asepriteTileId == null && tile.id === document.layers[1].tilemaps['frame-2'].cells[0].tileId)[0];
  const frameOne = renderFrame(document, 'frame-1');
  const result = await runLuaScript({ document, source: `local t=app.sprite.tilesets[1]:tile(${target});t.image:clear(app.pixelColor.rgba(20,30,40,255));t.data='variant'` });
  assert.deepEqual(renderFrame(result.document, 'frame-1'), frameOne);
  assert.deepEqual([...renderFrame(result.document, 'frame-2').slice(0, 4)], [20, 30, 40, 255]);
  const reopened = normalizeDocument(readAseprite(writeAseprite(result.document)).document);
  assert.deepEqual(renderFrame(reopened, 'frame-2'), renderFrame(result.document, 'frame-2'));
  assert.equal(reopened.tilesets[0].tileUserData[target].text, 'variant');
});

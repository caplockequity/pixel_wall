import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { applyCommand, createDocument, normalizeDocument, renderFrame } from '../app/editor-core.mjs';
import { readAseprite, writeAseprite } from '../app/formats.mjs';
import { decodeAsepriteProperties } from '../app/aseprite-properties.mjs';
import { validateLuaResult } from '../app/lua-session.mjs';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/lua-tile-structure-native.json', import.meta.url)));
const source = readFileSync(new URL('./fixtures/lua-tile-structure-oracle.lua', import.meta.url), 'utf8');
const read = data => normalizeDocument(readAseprite(Buffer.from(data, 'base64')).document);
const fixture = () => read(fixtures.cases[0].initialBase64);
const userData = value => ({ text: value?.text ?? '', color: value?.color ?? '#00000000', properties: decodeAsepriteProperties(value?.propertiesBytes) });
const engine = () => applyCommand(createDocument({ width: 6, height: 4 }), { type: 'tileset.add', tileset: { id: 'terrain', tileWidth: 2, tileHeight: 2, tiles: [{ id: 'red', pixels: Array(4).fill('#ff0000ff') }, { id: 'green', pixels: Array(4).fill('#00ff00ff') }] } });

for (const native of fixtures.cases) test(`${native.mode}: original native structure script preserves linked raw maps and matches native pixels/user metadata`, async () => {
  const document = read(native.initialBase64), before = structuredClone(document);
  const result = await runLuaScript({ document, source });
  assert.deepEqual(result.prints, ['native-tile-structure-contract-ok']); assert.deepEqual(document, before); validateLuaResult(result, document);
  const reopened = normalizeDocument(readAseprite(writeAseprite(result.document)).document), expected = read(native.expectedBase64);
  assert.equal(reopened.tilesets.length, expected.tilesets.length);
  for (let at = 0; at < expected.tilesets.length; at++) {
    const actual = reopened.tilesets[at], reference = expected.tilesets[at];
    for (const key of ['name', 'baseIndex', 'tileWidth', 'tileHeight', 'tileCount']) assert.equal(actual[key], reference[key]);
    assert.deepEqual(userData(actual.userData), userData(reference.userData));
    for (let tile = 0; tile < actual.tileCount; tile++) assert.deepEqual(userData(actual.tileUserData?.[tile]), userData(reference.tileUserData?.[tile]));
  }
  for (let at = 0; at < 2; at++) {
    const bytes = Buffer.from(native.framesRGBA[at], 'base64');
    assert.deepEqual(Buffer.from(renderFrame(result.document, result.document.frames[at].id)), bytes);
    assert.deepEqual(Buffer.from(renderFrame(reopened, reopened.frames[at].id)), bytes);
    for (const [layerId, cel] of Object.entries(document.frames[at].cels)) if (document.images[cel.imageId].tilemap) {
      assert.equal(result.document.frames[at].cels[layerId].imageId, cel.imageId);
      assert.deepEqual(result.document.images[cel.imageId], document.images[cel.imageId]);
    }
  }
  assert.equal(document.frames[0].cels['layer-2'].imageId, document.frames[1].cels['layer-2'].imageId, 'fixture has independently-created native linked cels');
});

test('creation overloads respect sprite grids, explicit zero-origin bounds, independent copy and native clone defaults', async () => {
  const result = await runLuaScript({ source: `
    local s=Sprite(4,4);s.gridBounds=Rectangle(-3,6,2,4)
    local a=s:newTileset();assert(#a==1 and a.grid.tileSize==Size(2,4) and a.grid.origin==Point(0,0))
    local b=s:newTileset(Rectangle(0,0,3,2),4);b.name='source';b.baseIndex=-8;b.data='copy';b.properties.x={1,true,'v'}
    b:tile(1).image:clear(app.pixelColor.rgba(30,40,50,255));b:tile(1).data='image';b:tile(1).properties.z=9
    local c=s:newTileset(b);assert(#c==4 and c.name=='source' and c.baseIndex==1 and c.data=='copy' and c.properties.x[2]==true)
    assert(c:tile(1).data=='image' and c:tile(1).properties.z==9 and c:tile(1).image.id~=b:tile(1).image.id)
    c:tile(1).image:clear();assert(not b:tile(1).image:isEmpty())
    local d=s:newTileset(Grid(),2);assert(d.grid.tileSize==Size(16,16) and #d==2)
  ` });
  assert.equal(result.document.tilesets.length, 4); validateLuaResult(result);
});

test('native insert/delete retain map words, allow dangling slots, then appended artwork fills the same numeric slot', async () => {
  const document = fixture(), ts = document.tilesets[0], originalMapId = document.frames[0].cels['layer-2'].imageId;
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local ts=s.tilesets[1];local at2=ts:tile(2);local image=at2.image
    s:deleteTile(at2);assert(at2.index==2 and at2.image==nil and not pcall(function()image:clear()end))
    assert(Image(s):getPixel(2,0)==0)
    local restored=s:newTile(ts);assert(restored.index==2 and at2.image.id==restored.image.id)
    restored.image:clear(app.pixelColor.rgba(70,80,90,255))
  ` });
  assert.deepEqual(result.document.images[originalMapId], document.images[originalMapId]);
  assert.equal(result.document.tilesets[0].tileCount, ts.tileCount);
  assert.deepEqual([...renderFrame(result.document).slice(8, 12)], [70, 80, 90, 255]);
});

test('engine maps encode all canonical rotations/flips before reindexing and keep cel positions/opacity', async () => {
  for (const rotate of [0, 90, 180, 270]) for (const flipX of [false, true]) for (const flipY of [false, true]) {
    let document = engine(); document = applyCommand(document, { type: 'layer.add', layer: { id: 'map', type: 'tilemap', tilesetId: 'terrain' } });
    document = applyCommand(document, { type: 'tilemap.paint', layerId: 'map', points: [{ x: 0, y: 0, tileId: 'green', rotate, flipX, flipY }] });
    document.layers[1].tilemaps['frame-1'].x = 1; document.layers[1].tilemaps['frame-1'].y = 1; document.layers[1].tilemaps['frame-1'].opacity = 128 / 255;
    const result = applyCommand(document, { type: 'tileset.tileInsert', tilesetId: 'terrain', tileIndex: 1 });
    const cel = result.frames[0].cels.map, bits = result.images[cel.imageId].tilemap.tiles[0];
    let x = flipX, y = flipY, diagonal = false;
    if (rotate === 90) { diagonal = true; [x, y] = [!flipY, flipX]; }
    if (rotate === 180) { x = !x; y = !y; }
    if (rotate === 270) { diagonal = true; [x, y] = [flipY, !flipX]; }
    assert.equal(bits, (2 | (x ? 0x80000000 : 0) | (y ? 0x40000000 : 0) | (diagonal ? 0x20000000 : 0)) >>> 0);
    assert.equal(result.layers[1].tilemaps, undefined); assert.equal(cel.x, 1); assert.equal(cel.y, 1); assert.equal(cel.opacity, 128 / 255);
    assert.deepEqual([...renderFrame(result).slice((1 * 6 + 1) * 4, (1 * 6 + 2) * 4)], [255, 0, 0, 128], 'numeric slot two now contains the old slot-one red tile');
    const reopened = normalizeDocument(readAseprite(writeAseprite(result)).document); assert.deepEqual(renderFrame(reopened), renderFrame(result));
  }
});

test('nested rollback restores moved/deleted/replaced image handles and removes new resources atomically', async () => {
  const document = fixture();
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local ts=s.tilesets[1];local image=ts:tile(1).image;local before=image.bytes
    assert(not pcall(function()app.transaction('outer failure',function()
      s:newTile(ts,1)
      app.transaction('inner success',function()s:deleteTile(ts,2);ts:tile(1).image=Image(2,2)end)
      s:newTileset(Rectangle(0,0,3,3));app.command.NewLayer{tilemap=true};error('rollback')
    end)end))
    assert(#s.tilesets==1 and #s.layers==3 and #ts==3 and image.bytes==before)
    app.transaction('survives',function()s:newTile(ts,1);image:clear(app.pixelColor.rgba(10,20,30,255))end)
    assert(ts:tile(2).image.id==image.id)
  ` });
  assert.equal(result.transactions.length, 1); assert.equal(result.transactions[0].label, 'survives'); validateLuaResult(result, document);
});

test('hidden and ancestor locks block structural mutation; copying locked artwork is allowed', async () => {
  const document = fixture(); document.layers[2].locked = true;
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local ts=s.tilesets[1]
    assert(not pcall(function()s:newTile(ts)end));assert(not pcall(function()s:deleteTile(ts,1)end))
    local duplicate=s:newTileset(ts);assert(#duplicate==#ts)
    s.layers[2].tileset=duplicate;assert(s.layers[2].tileset==duplicate)
    assert(not pcall(function()s.layers[3].tileset=duplicate end))
  ` });
  assert.equal(result.document.tilesets.length, 2);
  const group = { ...document.layers[0], id: 'locked-group', type: 'group', locked: true }; document.layers.push(group); document.layers[2].locked = false; document.layers[2].parentId = group.id;
  await assert.rejects(runLuaScript({ document, source: `app.sprite:newTile(app.sprite.tilesets[1])` }), /locked/);
});

test('NewLayer creates an empty tilemap atomically at the active group and failed parent creation leaves no orphan tileset', async () => {
  const result = await runLuaScript({ source: `
    local s=Sprite(4,4);s.gridBounds=Rectangle(5,6,2,4);local group=s:newGroup();app.layer=group
    app.command.NewLayer{tilemap=true};local layer=app.layer
    assert(layer.name=='Tilemap 1' and layer.parent==group and #layer.cels==0)
    assert(layer.tileset.grid.tileSize==Size(2,4) and layer.tileset.grid.origin==Point(1,2))
    app.layer=group;group.isEditable=false;local count=#s.tilesets
    assert(not pcall(function()app.command.NewLayer{tilemap=true,name='blocked'}end));assert(#s.tilesets==count and #group.layers==1)
    assert(not pcall(function()app.command.NewLayer{tilemap=true,group=true}end))
    assert(not pcall(function()app.command.NewLayer{tilemap=true,fromFile=true}end))
  ` });
  assert.equal(result.document.layers.filter(layer => layer.type === 'tilemap').length, 1);
});

test('assignment retains linked map image IDs and source-space positions when grids change, with explicit foreign/resource limits', async () => {
  const document = fixture(), rawId = document.frames[0].cels['layer-2'].imageId;
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local layer=s.layers[2];local ts=s:newTileset(Rectangle(0,0,1,2),3)
    ts:tile(1).image:clear(app.pixelColor.rgba(40,50,60,255));layer.tileset=ts
    local foreign=Sprite(2,2):newTileset();assert(not pcall(function()layer.tileset=foreign end))
    app.sprite=s;assert(layer.tileset==ts)
  ` });
  assert.equal(result.document.frames[0].cels['layer-2'].imageId, rawId); assert.equal(result.document.frames[1].cels['layer-2'].imageId, rawId);
  assert.deepEqual(result.document.images[rawId], document.images[rawId]); assert.equal(result.document.frames[0].cels['layer-2'].x, 0);
});

test('new indexed tile storage starts at raw zero even when the sprite mask is another palette index', async () => {
  const result = await runLuaScript({ source: `
    local s=Sprite(1,1,ColorMode.INDEXED);s.transparentColor=3
    local ts=s:newTileset(Rectangle(0,0,2,1),2)
    assert(ts:tile(0).image:getPixel(0,0)==0 and ts:tile(1).image.spec.transparentColor==3)
    local t=s:newTile(ts);assert(t.image:getPixel(0,0)==0 and not t.image:isEmpty())
  ` });
  assert.deepEqual(result.document.images[result.document.tilesets[0].imageId].pixels, [0, 0, 0, 0, 0, 0]);
});

test('zero/negative indices, invalid grids, over-budget creation and foreign copying fail without partial resources', async () => {
  const result = await runLuaScript({ document: fixture(), source: `
    local s=app.sprite;local ts=s.tilesets[1];local count=#s.tilesets
    for _,n in ipairs{-1,0,4,99}do assert(not pcall(function()s:newTile(ts,n)end))end
    for _,n in ipairs{-1,0,3,99}do assert(not pcall(function()s:deleteTile(ts,n)end))end
    assert(not pcall(function()s:newTileset(Rectangle(0,0,0,2))end));assert(not pcall(function()s:newTileset(Rectangle(1,0,2,2))end))
    assert(not pcall(function()s:newTileset(Rectangle(0,0,2,2),0)end));assert(not pcall(function()s:newTileset(Rectangle(0,0,2048,2048))end))
    assert(not pcall(function()s:newTileset(Rectangle(0,0,1,2),65536)end));assert(not pcall(function()s:newTileset(nil,3)end))
    assert(not pcall(function()s:newTileset(ts,2)end));assert(not pcall(function()s:newTilemap()end))
    local foreign=Sprite(1,1):newTileset();assert(not pcall(function()s:newTileset(foreign)end));app.sprite=s
    assert(#s.tilesets==count and #ts==3)
  ` });
  assert.equal(result.document.tilesets.length, 1);
  const invalid = fixture(); invalid.metadata.aseprite.grid = { x: 0, y: 0, width: -1, height: 2 };
  await assert.rejects(runLuaScript({ document: invalid, source: `app.sprite:newTileset()` }), /Tile width/);
});

test('external tilesets require explicit embedding before clone/reindex/assignment and remain untouched', async () => {
  const document = fixture(), ts = document.tilesets[0]; delete document.images[ts.imageId]; delete ts.imageId; delete ts.tiles; ts.flags = 5; ts.externalFileId = 1; ts.externalTilesetId = 2;
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local ts=s.tilesets[1]
    assert(not pcall(function()s:newTileset(ts)end));assert(not pcall(function()s:newTile(ts)end));assert(not pcall(function()s:deleteTile(ts,1)end))
    assert(not pcall(function()s.layers[2].tileset=ts end));assert(#s.tilesets==1 and #ts==3)
  ` });
  assert.deepEqual(result.document, document);
});

test('materializing editor tile zero and copying native matching flags obey native defaults', async () => {
  const document = engine(); document.tilesets[0].flags = 0;
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local ts=s.tilesets[1];local zero=ts:tile(0).image
    s:newTile(ts);zero:clear(app.pixelColor.rgba(3,4,5,255));assert(ts:tile(0).image.id==zero.id)
  ` });
  assert.equal(result.document.tilesets[0].flags, 6);
  const native = fixture(); native.tilesets[0].flags = 62;
  const cloned = await runLuaScript({ document: native, source: `app.sprite:newTileset(app.sprite.tilesets[1])` });
  assert.equal(cloned.document.tilesets[0].flags, 62); assert.equal(cloned.document.tilesets[1].flags, 6, 'independent native flag probe: matching flags reset in a clone');
});

test('handles first acquired inside rollback survive only when their original artwork is restored', async () => {
  const lifetime = readFileSync(new URL('./fixtures/lua-tile-lifetime-oracle.lua', import.meta.url), 'utf8');
  const result = await runLuaScript({ document: fixture(), source: lifetime + `held:clear(app.pixelColor.rgba(90,80,70,255))` });
  assert.deepEqual(result.prints, ['native-tile-lifetime-contract-ok']);
  assert.deepEqual([...renderFrame(result.document).slice(0, 4)], [90, 80, 70, 255]);
});

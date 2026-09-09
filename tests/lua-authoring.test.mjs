import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { createDocument, applyCommand, renderFrame } from '../app/editor-core.mjs';
import { writeAseprite, readAseprite } from '../app/formats.mjs';
import { decodeAsepriteProperties, encodeAsepriteProperties } from '../app/aseprite-properties.mjs';
import { validateLuaResult } from '../app/lua-session.mjs';
const script = readFileSync(new URL('./fixtures/lua-authoring-semantics.lua', import.meta.url), 'utf8');
const native = JSON.parse(readFileSync(new URL('./fixtures/lua-authoring-native.json', import.meta.url)));
const sample = () => applyCommand(createDocument({ id: 'authoring', width: 4, height: 4 }), { type: 'draw.rect', filled: true, x: 0, y: 0, width: 4, height: 4, color: '#ff0000ff' });
const pixel = (document, x, y, frameId) => [...renderFrame(document, frameId).slice((y * document.width + x) * 4, (y * document.width + x + 1) * 4)];

test('independent Aseprite authoring oracle fixture matches actual Lua output and commands replay', async () => {
  const result = await runLuaScript({ source: script });
  assert.deepEqual(result.prints, ['idle\t2\t3\t2\t2064320259', 'face\t2\t3\t1\t1', '11\textension\tbody\t2.5']);
  assert.equal(validateLuaResult(result).document.id, result.document.id);
  assert.equal(result.document.clips.length, 1);
  assert.equal(result.document.clips[0].repeat, 2);
  assert.equal(result.document.slices[0].keys[0].pivot.x, 1);
});

test('native property scalar/vector/map types and extension registry are available to scripts', async () => {
  const document = readAseprite(Buffer.from(native.asepriteBase64, 'base64')).document;
  const result = await runLuaScript({ document, source: `
    local s=app.sprite
    assert(s.properties.a==1)
    assert(s.properties.vec[1]==1 and s.properties.vec[2]=='x' and s.properties.vec[3]==true)
    assert(s.properties('pub/ext').hello=='yes')
    s.properties.number=-7.125
    assert(s.layers[1].data=='hi' and s.layers[1].color.alpha==123)
  ` });
  const decoded = decodeAsepriteProperties(result.document.userData.propertiesBytes);
  assert.equal(decoded[0].number, -7.125);
  assert.equal(decoded[1].hello, 'yes');
});

test('properties persist on their native object through export and first palette precedes layers', async () => {
  const result = await runLuaScript({ source: script });
  const bytes = writeAseprite(result.document), imported = readAseprite(bytes).document;
  const data = target => decodeAsepriteProperties(target.userData.propertiesBytes)[0];
  assert.equal(data(imported).count, 11);
  assert.equal(data(imported.layers[0]).role, 'body');
  assert.equal(data(imported.frames[0].cels[imported.layers[0].id]).cost, 2.5);
  assert.equal(data(imported.clips[0]).speed, 3);
  assert.equal(data(imported.slices[0]).note, 'face');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), types = [];
  let offset = 144; const end = 128 + view.getUint32(128, true);
  while (offset < end) { types.push(view.getUint16(offset + 4, true)); offset += view.getUint32(offset, true); }
  assert.ok(types.indexOf(0x2019) < types.indexOf(0x2004), 'native Aseprite binds sprite user data correctly only before layer objects');
});

test('selection operations copy assigned values, keep sprite references live and restrict tools', async () => {
  const document = sample(), before = structuredClone(document);
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local live=s.selection
    local a=Selection(Rectangle(0,0,3,3));a:subtract(Rectangle(1,1,1,1))
    s.selection=a;a:deselect();assert(not live.isEmpty)
    assert(not live:contains(1,1) and live:contains(Point(0,0)))
    app.useTool{tool='filled_rectangle',points={Point(0,0),Point(3,3)},color=Color{b=255}}
  ` });
  assert.deepEqual(document, before);
  assert.deepEqual(pixel(result.document, 0, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixel(result.document, 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(result.document, 3, 3), [255, 0, 0, 255]);
  assert.equal(result.selection.reduce((sum, value) => sum + value, 0), 8);
});

test('selection intersection, origin and off-canvas bounds use exact mask semantics', async () => {
  const result = await runLuaScript({ document: sample(), source: `
    local a=Selection(Rectangle(-1,-1,4,4))
    a:intersect(Rectangle(0,0,3,3));a.origin=Point(1,1)
    local b=Selection(Rectangle(3,3,1,1));a:add(b)
    assert(a.bounds.x==1 and a.bounds.width==3 and a:contains(3,3))
    app.sprite.selection=a
    app.command.Clear()
  ` });
  assert.deepEqual(pixel(result.document, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(result.document, 1, 1), [0, 0, 0, 0]);
});

test('select-all, invert and deselect operate on the active sprite; empty selection is unrestricted', async () => {
  const result = await runLuaScript({ document: sample(), source: `
    app.command.SelectAll();assert(app.sprite.selection.bounds.width==4)
    app.command.InvertMask();assert(app.sprite.selection.isEmpty)
    app.sprite.selection:select(Rectangle(0,0,1,1));app.command.Deselect()
    app.useTool{tool='pencil',points={Point(3,3)},color=Color{g=255}}
  ` });
  assert.equal(result.selection, null);
  assert.deepEqual(pixel(result.document, 3, 3), [0, 255, 0, 255]);
});

test('timeline ranges deduplicate linked images and expose only unlocked editable images', async () => {
  let document = sample();
  document = applyCommand(document, { type: 'frame.duplicate', frameId: document.frames[0].id, linked: true });
  const result = await runLuaScript({ document, source: `
    app.range.frames={2,1,2}
    assert(#app.range.frames==2 and #app.range.cels==2 and #app.range.images==1)
    assert(app.range:contains(app.sprite.frames[2]) and app.range:contains(app.cel))
    app.layer.isEditable=false
    assert(#app.range.editableImages==0 and #app.range.images==1)
    app.range.colors={3,1,3};assert(app.range:containsColor(3))
    app.range:clear();assert(app.range.isEmpty and #app.range.colors==0)
  ` });
  assert.equal(result.range.type, 0);
});

test('initial selection/range scopes are validated, applied, returned, and worker tampering rejected', async () => {
  const document = sample(), selection = Array(16).fill(0); selection[5] = 1;
  const result = await runLuaScript({ document, selection, range: { type: 2, frameIds: [document.frames[0].id], layerIds: [document.layers[0].id], colors: [], sliceIds: [] }, source: `assert(app.range.type==RangeType.FRAMES);app.command.Clear()` });
  assert.deepEqual(pixel(result.document, 1, 1), [0, 0, 0, 0]);
  assert.deepEqual(pixel(result.document, 0, 0), [255, 0, 0, 255]);
  const bad = structuredClone(result); bad.selection[0] = 2;
  assert.throws(() => validateLuaResult(bad, document), /selection/);
  assert.throws(() => runLuaScript({ document, selection: [1], source: '' }), /selection/);
});

test('transaction rollback restores attached selections, ranges and native property edits', async () => {
  const result = await runLuaScript({ document: sample(), source: `
    local s=app.sprite;s.selection:select(Rectangle(0,0,1,1));s.properties.original=true
    local ok=pcall(function() app.transaction(function()
      s.selection:selectAll();app.range.colors={1,2};s.properties.original=false;s:newTag(1,1);error('rollback')
    end) end)
    assert(not ok and s.properties.original and s.selection.bounds.width==1 and #app.range.colors==0)
  ` });
  assert.equal(result.document.clips.length, 1, 'original document clip survives');
  assert.equal(result.selection.reduce((a, b) => a + b), 1);
});

test('tags support range edits, directions/repeats and interior frame insertion stays contiguous', async () => {
  const result = await runLuaScript({ source: `
    local s=Sprite(2,2);s:newEmptyFrame();s:newEmptyFrame()
    local tag=s:newTag(1,3);tag.name='run';tag.aniDir=AniDir.REVERSE;tag.repeats=3
    s:newEmptyFrame(2)
    assert(tag.frames==4 and tag.toFrame.frameNumber==4)
    tag.fromFrame=s.frames[2];assert(tag.frames==3)
    s:deleteTag('run');assert(#s.tags==0)
  ` });
  assert.equal(result.document.frames.length, 4);
});

test('slices address first-frame keys, retain later moving keys, and support unset center/pivot', async () => {
  let document = sample(); document = applyCommand(document, { type: 'frame.add' });
  document = applyCommand(document, { type: 'slice.add', slice: { id: 'moving', name: 'face', keys: [{ frameId: document.frames[0].id, x: 0, y: 0, width: 2, height: 2 }, { frameId: document.frames[1].id, x: 2, y: 2, width: 1, height: 1 }] } });
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;app.frame=2;local slice=s.slices[1]
    assert(slice.bounds.x==0 and slice.bounds.width==2)
    slice.bounds=Rectangle(1,0,2,3);slice.pivot=Point(1,2);slice.center=Rectangle(0,0,1,1)
    slice.pivot=nil;slice.center=nil;assert(slice.pivot==nil and slice.center==nil)
    app.range.slices={slice};assert(app.range:contains(slice))
    local empty=s:newSlice();assert(empty.bounds==nil);s:deleteSlice(empty)
  ` });
  assert.equal(result.document.slices[0].keys[1].x, 2);
  assert.equal(result.document.slices[0].keys[0].x, 1);
});

test('user property assignment preserves extension namespaces, nil deletes, pairs snapshots values', async () => {
  const result = await runLuaScript({ document: sample(), source: `
    local s=app.sprite
    assert(s.properties('test/empty').missing==nil)
    s.properties('test/plugin',{one=true});s.properties={answer=42,label='hello'}
    local n=0;for k,v in pairs(s.properties) do n=n+1;assert(k=='answer' or k=='label') end;assert(n==2)
    s.properties.answer=nil;assert(s.properties.answer==nil and s.properties('test/plugin').one)
    s.properties('test/plugin').two={1,2,3}
    s.properties.payload={__kind='Tag',id='data',nested={__value='Color',note='plain'}}
    assert(s.properties.payload.__kind=='Tag' and s.properties.payload.nested.note=='plain')
  ` });
  assert.equal(result.document.metadata.aseprite.externalFiles.length, 1, 'read-only namespace access creates no native file record');
  const maps = decodeAsepriteProperties(result.document.userData.propertiesBytes);
  assert.equal(maps[0].answer, undefined);
  assert.deepEqual([...maps[1].two], [1, 2, 3]);
});

test('cel pixel flush and replacement preserve user data and independent metadata on linked cels', async () => {
  let document = sample(); document = applyCommand(document, { type: 'frame.duplicate', linked: true });
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;s.cels[1].data='first';s.cels[2].data='second'
    s.cels[1].image:drawPixel(0,0,Color{g=255})
    app.transaction(function() assert(s.cels[1].data=='first' and s.cels[2].data=='second') end)
  ` });
  const layerId = result.document.layers[0].id;
  assert.equal(result.document.frames[0].cels[layerId].userData.text, 'first');
  assert.equal(result.document.frames[1].cels[layerId].userData.text, 'second');
  assert.equal(result.document.frames[0].cels[layerId].imageId, result.document.frames[1].cels[layerId].imageId);
});

test('locked ancestor rejects Layer/Cel user data without committing partial namespace state', async () => {
  let document = sample(); document = applyCommand(document, { type: 'layer.update', layerId: document.layers[0].id, patch: { locked: true } });
  const result = await runLuaScript({ document, source: `
    local ok=pcall(function() app.layer.properties('test/plugin').value=1 end)
    assert(not ok and app.layer.properties('test/plugin').value==nil)
    assert(not pcall(function() app.cel.data='locked' end))
  ` });
  assert.equal(result.document.metadata.aseprite?.externalFiles, undefined);
  assert.deepEqual(result.document, document);
});

test('deleted and foreign handles fail explicitly, including foreign range and tag objects', async () => {
  await assert.rejects(runLuaScript({ source: `local a=Sprite(2,2);local tag=a:newTag(1,1);local b=Sprite(2,2);b:deleteTag(tag)` }), /another sprite/);
  await assert.rejects(runLuaScript({ source: `local s=Sprite(2,2);local tag=s:newTag(1,1);s:deleteTag(tag);print(tag.name)` }), /no longer exists/);
  await assert.rejects(runLuaScript({ source: `local a=Sprite(2,2);local l=a.layers[1];local b=Sprite(2,2);app.range.layers={l}` }), /another sprite/);
  await assert.rejects(runLuaScript({ document: sample(), source: `print(app.range.tiles)` }), /Unsupported/);
});

test('malformed native properties, unsafe integers and excessive nesting fail explicitly', () => {
  const bytes = encodeAsepriteProperties({ 0: { number: 1, vector: [true, 'hi', 1.25], map: { x: -2 } } });
  assert.equal(decodeAsepriteProperties(bytes)[0].map.x, -2);
  for (const bad of [bytes.slice(1), [...bytes, 0], [8, 0, 0, 0, 255, 255, 255, 255], [-1], Array(1024 * 1024 + 1).fill(0)]) assert.throws(() => decodeAsepriteProperties(bad));
  assert.throws(() => encodeAsepriteProperties({ 0: { bad: Number.NaN } }), /nonfinite/);
  assert.throws(() => encodeAsepriteProperties({ 0: { bad: Number.MAX_SAFE_INTEGER + 1 } }), /inexact/);
  let value = {}; for (let i = 0; i < 25; i++) value = { child: value };
  assert.throws(() => encodeAsepriteProperties({ 0: value }), /nesting/);
});

test('property map prototype keys are data and malformed setter bytes are rejected by the engine', () => {
  const values = JSON.parse('{"__proto__":{"safe":true},"constructor":"label"}');
  const decoded = decodeAsepriteProperties(encodeAsepriteProperties({ 0: values }));
  assert.equal(decoded[0].__proto__.safe, true);
  assert.equal(decoded[0].constructor, 'label');
  const document = sample();
  assert.throws(() => applyCommand(document, { type: 'object.userData', target: 'sprite', userData: { propertiesBytes: [0, 0, 0] } }), /truncated/);
  assert.throws(() => applyCommand(document, { type: 'object.userData', target: 'sprite', userData: { text: 'x'.repeat(65536) } }), /native limit/);
});

// Independently observed in Aseprite: insertion at the start shifts a tag, insertion after its end extends it.
test('Aseprite tag insertion boundaries distinguish start, interior and immediate end', async () => {
  const result = await runLuaScript({ source: `
    for _,at in ipairs({1,2,3,4,0}) do
      local s=Sprite(2,2);s:newEmptyFrame();s:newEmptyFrame();local tag=s:newTag(1,3)
      if at==0 then s:newEmptyFrame() else s:newEmptyFrame(at) end
      print(at,tag.fromFrame.frameNumber,tag.toFrame.frameNumber)
    end
  ` });
  assert.deepEqual(result.prints, ['1\t2\t4','2\t1\t4','3\t1\t4','4\t1\t4','0\t1\t4']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { createDocument, applyCommand, renderFrame } from '../app/editor-core.mjs';
import { validateLuaResult } from '../app/lua-session.mjs';

function sample() { return applyCommand(createDocument({ id: 'sample', width: 4, height: 4 }), { type: 'draw.stroke', points: [{ x: 1, y: 1 }], color: '#ff0000' }); }
const pixel = (d, x, y, frameId) => [...renderFrame(d, frameId).subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 4)];

test('executes actual Lua 5.4 syntax, bitwise math and a generated sprite', async () => {
  const r = await runLuaScript({ source: `
    assert(_VERSION == 'Lua 5.4')
    local s = Sprite(8, 8, ColorMode.RGB)
    local p = app.pixelColor.rgba(255, 64, 32, 128)
    assert((p >> 24) == 128)
    s.cels[1].image:drawPixel(2, 3, p)
    print(s.width, #s.layers, #s.frames)
  ` });
  assert.deepEqual(pixel(r.document, 2, 3), [255, 64, 32, 128]);
  assert.deepEqual(r.prints, ['8\t1\t1']);
});

test('active sprite/frame/layer aliases and a pixel iterator edit preserve the original input', async () => {
  const document = sample(), before = structuredClone(document);
  const r = await runLuaScript({ document, source: `
    assert(app.activeSprite == app.sprite)
    assert(app.activeFrame == app.frame and app.activeLayer == app.layer)
    assert(app.activeCel == app.cel and app.activeImage == app.image)
    app.transaction('Recolor red', function()
      for it in app.activeImage:pixels() do
        if app.pixelColor.rgbaR(it()) == 255 then it(Color{r=0,g=0,b=255}) end
      end
    end)
  ` });
  assert.deepEqual(document, before);
  assert.deepEqual(pixel(r.document, 1, 1), [0, 0, 255, 255]);
  assert.equal(r.transactions.length, 1);
  assert.equal(r.transactions[0].label, 'Recolor red');
});

test('clones images, creates layers/frames/cels and uses frame duration in seconds', async () => {
  const r = await runLuaScript({ document: sample(), source: `
    local s=app.sprite
    local img=app.image:clone()
    img:drawPixel(0,0,Color{h=120,s=1,v=1})
    local layer=s:newLayer(); layer.name='Glow'; layer.opacity=128
    local frame=s:newEmptyFrame(); frame.duration=0.2
    local cel=s:newCel(layer,frame,img,Point(1,0)); cel.opacity=200
    assert(layer:cel(frame) == cel and cel.frameNumber == 2)
    assert(cel.bounds.width == 4 and cel.position.x == 1)
    assert(s.frames[2].previous == s.frames[1])
    app.activeFrame=2; app.activeLayer=layer
    assert(app.activeCel==cel)
  ` });
  assert.equal(r.document.frames.length, 2); assert.equal(r.document.layers.length, 2);
  assert.equal(r.document.frames[1].durationMs, 200);
  assert.equal(r.document.layers[1].name, 'Glow');
  assert.deepEqual(pixel(r.document, 1, 0, r.document.frames[1].id).slice(0, 3), [0, 255, 0]);
});

test('transaction failure rolls back pixels, structure, and nested transactions but permits later work', async () => {
  const r = await runLuaScript({ document: sample(), source: `
    local s=app.sprite
    local img=app.image
    local ok=pcall(function()
      app.transaction('Failing outer',function()
        s:newLayer()
        app.transaction('Inner',function() img:drawPixel(0,0,Color{r=255}) end)
        error('cancel my edit')
      end)
    end)
    assert(not ok and #s.layers==1)
    assert(app.image:getPixel(0,0)==0)
    app.image:drawPixel(2,2,Color{b=255})
  ` });
  assert.equal(r.document.layers.length, 1);
  assert.deepEqual(pixel(r.document, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixel(r.document, 2, 2), [0, 0, 255, 255]);
  assert.ok(r.transactions.every(t => t.label !== 'Failing outer' && t.label !== 'Inner'));
});

test('rollback preserves preexisting linked image identities and edits linked cels together', async () => {
  let document = sample(); document = applyCommand(document, { type: 'frame.duplicate', frameId: 'frame-1', linked: true });
  const r = await runLuaScript({ document, source: `
    local s=app.sprite
    assert(s.cels[1].image == s.cels[2].image)
    app.transaction(function() s.cels[1].image:drawPixel(0,0,Color{r=10,g=20,b=30}) end)
  ` });
  assert.equal(r.document.frames[0].cels['layer-1'].imageId, r.document.frames[1].cels['layer-1'].imageId);
  assert.deepEqual(pixel(r.document, 0, 0, r.document.frames[1].id), [10, 20, 30, 255]);
});

test('indexed colors retain integer indices and palettes use zero-based indices', async () => {
  const r = await runLuaScript({ source: `
    local s=Sprite(2,2,ColorMode.INDEXED)
    local p=Palette(4); p:setColor(0,Color{a=0}); p:setColor(1,Color{r=255}); p:setColor(2,Color{g=255})
    s:setPalette(p)
    assert(#s.palettes[1]==4)
    app.image:drawPixel(0,0,2)
    assert(app.image:getPixel(0,0)==2)
    assert(Color{index=2}.green==255)
    app.image:drawPixel(1,0,Color{index=1})
  ` });
  assert.deepEqual(pixel(r.document, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(r.document, 1, 0), [255, 0, 0, 255]);
  assert.equal(Object.values(r.document.images)[0].pixels[0], 2);
});

test('gray pixels use Aseprite packed value/alpha and Sprite dimensions scale through engine', async () => {
  const r = await runLuaScript({ source: `
    local s=Sprite(2,2,ColorMode.GRAY)
    local p=app.pixelColor.graya(90,128)
    app.image:drawPixel(1,1,p)
    assert(Color(p).grayPixel==p)
    app.command.SpriteSize{width=4,height=4,method='nearest-neighbor',ui=false}
  ` });
  assert.deepEqual(pixel(r.document, 3, 3), [90, 90, 90, 128]);
});

test('app.command and useTool create validated drawing transactions', async () => {
  const r = await runLuaScript({ document: sample(), source: `
    app.transaction('Rectangle',function()
      app.command.NewLayer{name='Box'}
      app.fgColor=Color{r=255,g=128,b=0}
      app.useTool{tool='filled_rectangle',points={Point(0,0),Point(2,2)}}
      app.command.NewFrame{content='current'}
    end)
    assert(#app.sprite.frames==2)
  ` });
  assert.deepEqual(pixel(r.document, 0, 0), [255, 128, 0, 255]);
  assert.ok(r.transactions[0].commands.some(c => c.type === 'draw.rect'));
});

test('moving/deleting cels and deleting layers/frames updates the shared model', async () => {
  const r = await runLuaScript({ document: sample(), source: `
    local s=app.sprite; local c=app.cel
    s:newEmptyFrame(); c.frame=2
    assert(c.frameNumber==2 and s.layers[1]:cel(1)==nil)
    local l=s:newLayer(); s:deleteLayer(l)
    s:deleteFrame(1)
    assert(#s.frames==1 and s.cels[1].image:getPixel(1,1)~=0)
  ` });
  assert.equal(r.document.frames.length, 1); assert.deepEqual(pixel(r.document, 1, 1), [255, 0, 0, 255]);
});

test('detached image source-over compositing works without granting file access', async () => {
  const r = await runLuaScript({ source: `
    local s=Sprite(2,2)
    local a=Image(2,2); a:clear(Color{b=255})
    local b=Image(1,1); b:clear(Color{r=255,a=128})
    a:drawImage(b,Point(1,1))
    app.cel.image=a
    assert(not a:isEmpty() and a:isEqual(a:clone()))
  ` });
  assert.deepEqual(pixel(r.document, 1, 1), [128, 0, 127, 255]);
});

test('parameters and log strings safely round trip Unicode, quotes and newlines', async () => {
  const r = await runLuaScript({ params: { name: 'Panda 🐼 "hello"\nnext' }, source: `print(app.params.name); local p=Point{3,4}; local r=Rectangle(0,0,5,5); assert(r:contains(p))` });
  assert.deepEqual(r.prints, ['Panda 🐼 "hello"\nnext']);
});

for (const code of [
  `app.command.ExportSpriteSheet{filename='free.gif'}`,
  `app.command.SaveFileAs{filename='private.pixelwall'}`,
  `app.sprite:saveAs('/tmp/not-written')`,
  `Image{fromFile='/etc/passwd'}`,
  `app.fs.listFiles('/')`,
  `app.command.SpriteSize{width=8,height=8,method='rotsprite'}`,
  `app.useTool{tool='pencil',points={Point(0,0)},ink='replace'}`,
]) test(`unsupported capability fails explicitly: ${code.slice(0, 45)}`, async () => {
  await assert.rejects(runLuaScript({ document: sample(), source: code }), /Unsupported|unavailable|not supported|supports nearest/);
});

test('sandbox exposes no OS, network, process, filesystem, Lua loader, debugger or JS bridge', async () => {
  const r = await runLuaScript({ source: `
    for _,name in ipairs{'io','os','package','require','load','dofile','loadfile','debug','coroutine','process','js','fetch','__pixelwallRpc','__pixelwallSource','__pixelwallInstructions'} do assert(_G[name]==nil,name) end
    assert(string.dump==nil and getmetatable==nil and rawget==nil)
    assert(not pcall(setmetatable, app, {}))
    print('isolated')
  ` });
  assert.deepEqual(r.prints, ['isolated']);
});

test('instruction loops, memory exhaustion and swallowed errors cannot commit artwork', async () => {
  await assert.rejects(runLuaScript({ document: sample(), source: 'app.image:drawPixel(0,0,Color{r=255}); while true do end', instructionLimit: 10000 }), /instruction budget/);
  await assert.rejects(runLuaScript({ source: `local a=string.rep('x',100000000)` }), /memory|allocation|worker/);
  await assert.rejects(runLuaScript({ source: `while true do pcall(function() while true do end end) end`, timeoutMs: 100, instructionLimit: 50000000 }), /time limit|instruction budget/);
});

test('cancellation terminates the worker and does not affect subsequent runs', async () => {
  const controller = new AbortController();
  const waiting = runLuaScript({ source: 'while true do end', signal: controller.signal, instructionLimit: 50000000 });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(waiting, /cancelled/);
  const r = await runLuaScript({ source: 'print(6*7)' }); assert.deepEqual(r.prints, ['42']);
});

test('worker output is rejected if documents no longer match engine command replay', async () => {
  const document = sample();
  const r = await runLuaScript({ document, source: 'app.image:drawPixel(0,0,Color{g=255})' });
  const corrupt = structuredClone(r); corrupt.documents[0].name = 'Forged';
  assert.throws(() => validateLuaResult(corrupt, document), /does not match/);
});

test('caught inner transaction failure restores its pixels and outer transaction can commit', async () => {
  const r = await runLuaScript({ document: sample(), source: `
    local img=app.image
    app.transaction('Outer success',function()
      img:drawPixel(0,0,Color{r=0,g=255,b=0})
      local ok=pcall(function() app.transaction(function() img:drawPixel(0,0,Color{r=0,g=0,b=255}); error('inner') end) end)
      assert(not ok and img:getPixel(0,0)==app.pixelColor.rgba(0,255,0))
      img:drawPixel(3,3,Color{r=0,g=255,b=0})
    end)
  ` });
  assert.deepEqual(pixel(r.document, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(pixel(r.document, 3, 3), [0, 255, 0, 255]);
  assert.equal(r.transactions.length, 1); assert.equal(r.transactions[0].label, 'Outer success');
});

test('official Aseprite oracle constructor/frame/cel-copy semantics fixture matches', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./fixtures/lua-oracle-semantics.lua', import.meta.url), 'utf8');
  const r = await runLuaScript({ source });
  assert.deepEqual(r.prints.map(line => line.replace(/127\.0$/, '127')), [
    'initial\t1\t1\t1', 'noarg\t2', '10,10', 'explicit2\t2', '10,20,20',
    'explicit1\t1', '10,10,20,20', 'empty2\t2', '10,empty,10,20,20',
    'image\t0\t0', 'newCelcopies\t0', 'gray\t127',
  ]);
});

test('a typical 64-square generated sprite fits the default instruction and time budgets', async () => {
  const r = await runLuaScript({ source: `local s=Sprite(64,64); local img=app.image; for y=0,63 do for x=0,63 do img:drawPixel(x,y,Color{r=x*4,g=y*4,b=128}) end end` });
  assert.deepEqual(pixel(r.document, 63, 63), [252, 252, 128, 255]);
  assert.equal(r.transactions.length, 2);
});

test('new indexed sprites clear to transparent index zero even after an opaque palette edit', async () => {
  const r = await runLuaScript({ source: `
    Sprite(2,2,ColorMode.INDEXED)
    app.sprite.palettes[1]:setColor(0,Color{r=255,g=0,b=0})
    app.image:clear()
    assert(app.image:getPixel(0,0)==0)
  ` });
  assert.deepEqual(pixel(r.document, 0, 0), [0, 0, 0, 0]);
});

test('rerunning Lua never reuses an existing generated sprite or layer identifier', async () => {
  const first = await runLuaScript({ source: 'Sprite(2,2); app.sprite:newLayer()' });
  const second = await runLuaScript({ document: first.document, source: 'app.sprite:newLayer(); Sprite(3,3)' });
  assert.notEqual(second.document.id, first.document.id);
  assert.equal(second.documents.find(d => d.id === first.document.id).layers.length, 3);
});

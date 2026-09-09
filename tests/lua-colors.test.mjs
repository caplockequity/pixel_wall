import test from 'node:test';
import assert from 'node:assert/strict';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { runLuaScript as runBrowser } from '../app/lua-runner-browser.mjs';
import { luaRequest } from '../app/lua-request.mjs';
import { createLuaSession, validateLuaResult } from '../app/lua-session.mjs';
import { createDocument, renderFrame } from '../app/editor-core.mjs';
const document = () => createDocument({ id: 'colors', width: 2, height: 2 });
const fgColor = [12, 34, 56, 78], bgColor = [90, 123, 145, 0];
const rgba = (doc, x = 0, y = 0) => [...renderFrame(doc).slice((y * doc.width + x) * 4, (y * doc.width + x) * 4 + 4)];

test('the real Lua VM receives actual editor colors and returns unchanged colors without commands', async () => {
  const input = { document: document(), fgColor: [...fgColor], bgColor: [...bgColor], source: `
    assert(app.fgColor.rgbaPixel == app.pixelColor.rgba(12,34,56,78))
    assert(app.bgColor.rgbaPixel == app.pixelColor.rgba(90,123,145,0))
  ` }, before = structuredClone(input);
  const result = await runLuaScript(input);
  assert.deepEqual(result.fgColor, fgColor); assert.deepEqual(result.bgColor, bgColor);
  assert.equal(result.stats.commands, 0); assert.deepEqual(result.transactions, []);
  assert.deepEqual(result.document, input.document); assert.deepEqual(input, before);
});

test('color-only scripts return both changes without requiring an active document', async () => {
  const result = await runLuaScript({ fgColor, bgColor, source: `
    assert(app.sprite == nil)
    app.fgColor=Color{r=1,g=2,b=3,a=0}
    app.bgColor=Color{gray=99,alpha=111}
  ` });
  assert.deepEqual(result.fgColor, [1, 2, 3, 0]); assert.deepEqual(result.bgColor, [99, 99, 99, 111]);
  assert.equal(result.document, null); assert.deepEqual(result.documents, []); assert.equal(result.stats.commands, 0);
});

test('omitted inputs preserve the existing opaque black and white defaults', async () => {
  const result = await runLuaScript({ source: '' });
  assert.deepEqual(result.fgColor, [0, 0, 0, 255]); assert.deepEqual(result.bgColor, [255, 255, 255, 255]);
});

test('Aseprite Color getters return detached values; assigning the edited copy updates foreground', async () => {
  const result = await runLuaScript({ fgColor, bgColor, source: `
    local c=app.fgColor; c.red=200
    app.fgColor.green=201
    assert(app.fgColor.red==12 and app.fgColor.green==34)
    assert(app.fgColor ~= app.fgColor)
    app.fgColor=c
    local bg=app.bgColor; bg.alpha=255
    assert(app.bgColor.alpha==0)
    app.bgColor=bg
  ` });
  assert.deepEqual(result.fgColor, [200, 34, 56, 78]); assert.deepEqual(result.bgColor, [90, 123, 145, 255]);
});

test('useTool defaults to the supplied foreground and follows reassignment', async () => {
  const result = await runLuaScript({ document: document(), fgColor, bgColor, source: `
    app.useTool{tool='pencil',points={Point(0,0)}}
    app.fgColor=Color{r=101,g=102,b=103,a=104}
    app.useTool{tool='pencil',points={Point(1,0)}}
  ` });
  assert.deepEqual(rgba(result.document), fgColor); assert.deepEqual(rgba(result.document, 1), [101, 102, 103, 104]);
  assert.deepEqual(result.fgColor, [101, 102, 103, 104]); assert.deepEqual(result.bgColor, bgColor);
});

test('failed nested transactions restore colors and pixels, while a later successful change commits', async () => {
  const result = await runLuaScript({ document: document(), fgColor, bgColor, source: `
    local ok=pcall(function()
      app.transaction('failing outer',function()
        app.fgColor=Color{r=255}
        app.transaction('successful inner',function()
          app.bgColor=Color{b=255}
          app.useTool{tool='pencil',points={Point(0,0)}}
        end)
        error('undo all staged state')
      end)
    end)
    assert(not ok)
    assert(app.fgColor.rgbaPixel==app.pixelColor.rgba(12,34,56,78))
    assert(app.bgColor.rgbaPixel==app.pixelColor.rgba(90,123,145,0))
    app.transaction('successful outer',function()
      app.fgColor=Color{r=2,g=3,b=4,a=5}
      local inner=pcall(function() app.transaction(function()
        app.fgColor=Color{r=6}; app.bgColor=Color{r=7}; error('only inner')
      end) end)
      assert(not inner and app.fgColor.red==2 and app.bgColor.alpha==0)
      app.useTool{tool='pencil',points={Point(1,1)}}
    end)
  ` });
  assert.deepEqual(result.fgColor, [2, 3, 4, 5]); assert.deepEqual(result.bgColor, bgColor);
  assert.deepEqual(rgba(result.document), [0, 0, 0, 0]); assert.deepEqual(rgba(result.document, 1, 1), [2, 3, 4, 5]);
  assert.ok(result.transactions.every(entry => entry.label === 'successful outer'));
});

test('indexed assignment retains its index for drawing and returns resolved RGBA bytes', async () => {
  const result = await runLuaScript({ fgColor, bgColor, source: `
    local s=Sprite(2,2,ColorMode.INDEXED)
    local palette=Palette(3)
    palette:setColor(0,Color{a=0}); palette:setColor(1,Color{r=11,g=22,b=33,a=44}); palette:setColor(2,Color{r=55,g=66,b=77,a=88})
    s:setPalette(palette)
    app.fgColor=Color{index=1}; app.bgColor=Color(2)
    assert(app.fgColor.index==1 and app.bgColor.index==2)
    app.image:drawPixel(0,0,app.fgColor)
    local ok=pcall(function() app.transaction(function()
      app.fgColor=Color{index=2}; app.bgColor=Color{r=99}; error('restore index')
    end) end)
    assert(not ok and app.fgColor.index==1 and app.bgColor.index==2)
    app.image:drawPixel(1,0,app.bgColor)
  ` });
  assert.deepEqual(result.fgColor, [11, 22, 33, 44]); assert.deepEqual(result.bgColor, [55, 66, 77, 88]);
  assert.deepEqual(rgba(result.document), result.fgColor); assert.deepEqual(rgba(result.document, 1), result.bgColor);
});

test('grayscale packed Color keeps its gray and alpha through handoff and drawing', async () => {
  const result = await runLuaScript({ source: `
    Sprite(2,2,ColorMode.GRAY)
    app.fgColor=Color(app.pixelColor.graya(91,73))
    app.bgColor=Color{gray=33,alpha=0}
    assert(app.fgColor.gray==91 and app.fgColor.grayPixel==app.pixelColor.graya(91,73))
    app.image:drawPixel(0,0,app.fgColor)
  ` });
  assert.deepEqual(result.fgColor, [91, 91, 91, 73]); assert.deepEqual(result.bgColor, [33, 33, 33, 0]);
  assert.deepEqual(rgba(result.document), result.fgColor);
});

test('invalid initial arrays are rejected before worker creation and never aliased', () => {
  const invalid = [null, '#123456', {}, new Uint8Array([1, 2, 3, 4]), [], [1, 2, 3], [1, 2, 3, 4, 5], [1, 2, 3, -1], [1, 2, 3, 256], [1, 2, 3, 0.5], [1, 2, 3, NaN], [1, 2, 3, Infinity], [1, 2, 3, '4'], Array(4)];
  for (const key of ['fgColor', 'bgColor']) for (const value of invalid) assert.throws(() => runLuaScript({ source: '', [key]: value }), /RGBA array/);
  const input = { source: '', fgColor: [...fgColor], bgColor: [...bgColor] }, request = luaRequest(input);
  input.fgColor[0] = 255; request.bgColor[0] = 255;
  assert.equal(request.fgColor[0], 12); assert.equal(input.bgColor[0], 90);
  assert.throws(() => createLuaSession({ fgColor: null }), /RGBA array/);
});

test('receiver validates both result colors and copies their arrays independently', async () => {
  const result = await runLuaScript({ document: document(), fgColor, bgColor, source: '' });
  for (const key of ['fgColor', 'bgColor']) for (const value of [undefined, null, [], [1, 2, 3, 256], [1, 2, 3, '4'], Array(4)]) {
    assert.throws(() => validateLuaResult({ ...result, [key]: value }, document()), /RGBA array/);
  }
  const valid = validateLuaResult(result, document());
  result.fgColor[0] = 255; valid.bgColor[0] = 255;
  assert.equal(valid.fgColor[0], 12); assert.equal(result.bgColor[0], 90);
});

test('failure or instruction-budget termination cannot return partial color changes', async () => {
  const input = { source: `app.fgColor=Color{r=250}; error('reject whole run')`, fgColor: [...fgColor], bgColor: [...bgColor] };
  await assert.rejects(runLuaScript(input), /reject whole run/);
  await assert.rejects(runLuaScript({ ...input, source: 'app.bgColor=Color{r=251}; while true do end', instructionLimit: 10000 }), /instruction budget/);
  assert.deepEqual(input.fgColor, fgColor); assert.deepEqual(input.bgColor, bgColor);
});

test('browser runner passes color arrays to its worker and rejects malformed returned colors', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'pixelwall://app/editor' } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'location', previous) : delete globalThis.location);
  const input = { source: '', fgColor, bgColor }, result = await runLuaScript(input);
  let sent, terminated = 0;
  const worker = { terminate: () => terminated++, postMessage(message) { sent = message; queueMicrotask(() => this.onmessage({ data: { ok: true, result } })); } };
  const output = await runBrowser(input, { wasmUri: '/runtimes/lua.wasm', createWorker: () => worker });
  assert.deepEqual(sent.request.fgColor, fgColor); assert.deepEqual(sent.request.bgColor, bgColor); assert.deepEqual(output.fgColor, fgColor);
  result.bgColor = [1, 2, 3, 999];
  await assert.rejects(runBrowser(input, { wasmUri: '/runtimes/lua.wasm', createWorker: () => worker }), /background color result/);
  assert.equal(terminated, 2);
});

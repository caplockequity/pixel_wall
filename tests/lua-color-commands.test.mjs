import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { runLuaScript as runBrowser } from '../app/lua-runner-browser.mjs';
import { applyCommand, createDocument, getCel, normalizeDocument } from '../app/editor-core.mjs';
import { nativePaletteKeys } from '../app/native-color-commands.mjs';
import { validateLuaResult } from '../app/lua-session.mjs';

const clear = '#00000000', red = '#ff0000ff', green = '#00ff00ff', blue = '#0000ffff';
const run = (document, ...commands) => commands.reduce((value, command) => applyCommand(value, command), document);
function rgbaDocument() {
  return run(createDocument({ width: 2, height: 1, palette: [clear, red, blue] }), { type: 'cel.set', width: 2, height: 1, pixels: [red, blue], opacity: .4 });
}
function paletteAnimation() {
  let document = run(createDocument({ width: 2, height: 1, colorMode: 'indexed', palette: [clear, red, blue] }),
    { type: 'cel.set', width: 2, height: 1, pixels: [1, 2] },
    { type: 'frame.duplicate', linked: true },
    { type: 'frame.duplicate', frameId: 'frame-1', linked: true },
    { type: 'frame.duplicate', frameId: 'frame-1', linked: true });
  document.frames[3].palette = [clear, green, blue];
  return normalizeDocument(document);
}

test('Lua palette handles follow effective keys and retain identity through edits and rollback', async () => {
  const document = paletteAnimation(), originalPixels = [...getCel(document).image.pixels];
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;assert(#s.palettes==2)
    local first=s.palettes[1];local second=s.palettes[2]
    assert(first.frame.frameNumber==1 and second.frame.frameNumber==4)
    first:setColor(1,Color{r=9,g=8,b=7,a=255})
    assert(first:getColor(1).red==9 and second:getColor(1).green==255)
    local held=first:getColor(2).rgbaPixel
    assert(not pcall(function()app.transaction('rollback palette',function()
      first:setColor(2,Color{r=70,g=60,b=50,a=255});error('rollback intended')
    end)end))
    assert(first:getColor(2).rgbaPixel==held and #s.palettes==2)
  ` });
  assert.deepEqual(getCel(result.document).image.pixels, originalPixels);
  assert.equal(result.document.frames[0].palette[1], '#090807ff');
  assert.equal(result.document.frames[3].palette[1], green);
  assert.equal(result.transactions.length, 1);
  validateLuaResult(result, document);
});

test('Lua ColorQuantization changes the active palette key without rewriting RGBA artwork', async () => {
  let document = rgbaDocument();
  document = run(document, { type: 'frame.duplicate', linked: true });
  const imageId = getCel(document).cel.imageId, original = structuredClone(document.images[imageId]);
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local image=s.cels[1].image;local bytes=image.bytes
    assert(app.command.ColorQuantization{ui=false,algorithm='rgb5a3',maxColors=4,withAlpha=false})
    assert(#s.palettes==1 and image.bytes==bytes and image.id==s.cels[2].image.id)
  ` });
  assert.deepEqual(result.document.images[imageId], original);
  assert.ok(result.document.palette.length >= 2 && result.document.palette.length <= 4);
  assert.ok(result.transactions.some(entry => entry.commands.some(command => command.type === 'palette.nativeGenerate')));
  validateLuaResult(result, document);
});

test('Lua ChangePixelFormat converts shared artwork atomically and retires stale attached images', async () => {
  let document = rgbaDocument();
  document = run(document, { type: 'frame.duplicate', linked: true });
  const result = await runLuaScript({ document, source: `
    local s=app.sprite;local attached=s.cels[1].image;local detached=Image(attached)
    assert(app.command.ChangePixelFormat{ui=false,format='indexed',rgbmap='octree',fitCriteria='rgb'})
    assert(s.colorMode==ColorMode.INDEXED and s.cels[1].opacity==255 and s.cels[2].opacity==255)
    assert(not pcall(function()return attached.width end));assert(detached.colorMode==ColorMode.RGB)
    local indexed=s.cels[1].image
    assert(app.command.ChangePixelFormat{ui=false,format='gray',toGray='hsv'})
    assert(s.colorMode==ColorMode.GRAY and #s.palettes==1 and #s.palettes[1]==256)
    assert(not pcall(function()return indexed.width end))
  ` });
  assert.equal(result.document.colorMode, 'grayscale');
  assert.equal(result.document.frames[0].cels['layer-1'].imageId, result.document.frames[1].cels['layer-1'].imageId);
  assert.equal(result.document.palette.length, 256);
  validateLuaResult(result, document);
});

test('browser Lua worker exposes the same color commands', async t => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://pixelwall.example/editor', origin: 'https://pixelwall.example' } });
  t.after(() => prior ? Object.defineProperty(globalThis, 'location', prior) : delete globalThis.location);
  const createWorker = () => {
    const worker = new Worker(new URL('./fixtures/lua-dialog-browser-worker.mjs', import.meta.url), { execArgv: [] });
    const bridge = { postMessage: message => worker.postMessage(message), terminate: () => worker.terminate() };
    worker.on('message', data => bridge.onmessage?.({ data }));
    worker.on('error', error => bridge.onerror?.(error));
    return bridge;
  };
  const document = rgbaDocument();
  const result = await runBrowser({ document, source: `
    assert(app.command.ChangePixelFormat{ui=false,format='indexed'})
    assert(app.sprite.colorMode==ColorMode.INDEXED)
    assert(app.command.ColorQuantization{ui=false,algorithm='octree',maxColors=8})
  ` }, { wasmUri: '/runtimes/lua.wasm', createWorker });
  assert.equal(result.document.colorMode, 'indexed');
  validateLuaResult(result, document);
});

test('native palette commands validate key boundaries and reject unsafe indexed shrinking atomically', () => {
  const document = paletteAnimation(), before = structuredClone(document), keys = nativePaletteKeys(document);
  assert.deepEqual(keys.map(key => key.index), [0, 3]);
  const updated = applyCommand(document, { type: 'palette.nativeSet', frameId: document.frames[3].id, paletteFrameIds: keys.map(key => key.frameId), palette: [clear, blue, red] });
  assert.deepEqual(nativePaletteKeys(updated)[0].palette, nativePaletteKeys(document)[0].palette);
  assert.deepEqual(updated.frames[3].palette, [clear, blue, red]);
  assert.throws(() => applyCommand(document, { type: 'palette.nativeSet', frameId: document.frames[0].id, paletteFrameIds: keys.map(key => key.frameId), palette: [clear] }), /out-of-palette/);
  assert.deepEqual(document, before);
});

test('native palette generation supports a one-color range without replacing its transparent slot', () => {
  const document = rgbaDocument();
  const updated = applyCommand(document, { type: 'palette.nativeGenerate', frameId: document.frames[0].id, paletteFrameIds: [document.frames[0].id], algorithm: 'octree', maxColors: 8, withAlpha: true, colors: [1] });
  assert.equal(updated.palette[0], clear);
  assert.equal(updated.palette[2], blue);
  assert.notEqual(updated.palette[1], clear);
  assert.equal(updated.palette.length, document.palette.length);
});

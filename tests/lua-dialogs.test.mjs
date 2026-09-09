import test from 'node:test';
import assert from 'node:assert/strict';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { createDocument, applyCommand, renderFrame } from '../app/editor-core.mjs';
import { validateDialogSchema, validateDialogResponse } from '../app/lua-dialog-schema.mjs';
import { createLuaDialogChannel } from '../app/lua-dialog-channel.mjs';
import { createLuaWorkerController } from '../app/lua-worker-controller.mjs';
import { luaRequest } from '../app/lua-request.mjs';
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const document = () => createDocument({ width: 2, height: 2 });
const buttonResponse = (schema, id, values = {}) => ({ action: 'button', button: schema.controls.find(control => control.id === id).key, values: Object.fromEntries(Object.entries(values).map(([id, value]) => [schema.controls.find(control => control.id === id).key, value])) });
const simple = validateDialogSchema({ title: 'Prompt', controls: [{ type: 'entry', key: 'w1', id: 'name', value: 'start' }, { type: 'button', key: 'w2', id: 'ok' }] });

test('real worker Dialog accepts every supported field and keeps locals alive without replay', async () => {
  const input = document(), before = structuredClone(input); let requests = 0;
  const result = await runLuaScript({ document: input, source: `
    assert(app.isUIAvailable)
    assert(Promise==nil and __pixelwallDialog==nil and __pixelwallRpc==nil and debug==nil and coroutine==nil and io==nil and os==nil and package==nil)
    local count=0
    local sprite=app.sprite
    local added=sprite:newLayer()
    local d=Dialog{title='Eight controls',onclose=function() count=count+10 end}
    d:entry{id='name',label='Name',text='first'}:number{id='amount',text='2',decimals=2}
     :slider{id='size',min=1,max=10,value=4}:check{id='outline',selected=false}
     :combobox{id='choice',options={'A','B'},option='A'}:color{id='ink',color=Color{r=20,g=30,b=40,a=50}}
     :newrow():separator{text='Finish'}:label{id='note',text='Ready'}
    d:button{id='ok',text='Continue',onclick=function()
      count=count+1
      if count==1 then d.data={name='second'} else d:close() end
    end}
    d:show()
    local data=d.data
    assert(count==12 and data.ok and data.name=='done' and data.amount==3.14)
    assert(data.size==9 and data.outline and data.choice=='B')
    assert(data.ink.rgbaPixel==app.pixelColor.rgba(1,2,3,4))
    local copy=d.data; copy.ink.red=255; assert(d.data.ink.red==1)
    assert(#sprite.layers==2 and sprite.layers[2]==added)
    app.fgColor=data.ink
    print(count,data.name)
  ` }, { onDialog: async schema => {
    requests++; assert.deepEqual(input, before);
    assert.equal(schema.controls.find(control => control.id === 'name').value, requests === 1 ? 'first' : 'second');
    assert.equal(schema.controls.length, 10); await pause(15);
    return buttonResponse(schema, 'ok', { name: requests === 1 ? 'first answer' : 'done', amount: 3.14159, size: 9, outline: true, choice: 'B', ink: [1, 2, 3, 4] });
  } });
  assert.equal(requests, 2); assert.equal(result.document.layers.length, 2); assert.deepEqual(result.prints, ['12\tdone']);
  assert.deepEqual(result.fgColor, [1, 2, 3, 4]); assert.deepEqual(input, before);
});

test('dialog callbacks and app.transaction remain atomic across suspension and failure', async () => {
  const input = applyCommand(document(), { type: 'cel.set', width: 2, height: 2, pixels: Array(4).fill(null) });
  const result = await runLuaScript({ document: input, fgColor: [10, 20, 30, 40], source: `
    local image=app.image
    local ok,err=pcall(function()
      app.transaction('rollback across dialog',function()
        app.sprite:newLayer()
        local d=Dialog():button{id='fail',onclick=function()
          image:drawPixel(0,0,Color{r=255})
          app.fgColor=Color{r=99}
          error('callback failed')
        end}
        d:show()
      end)
    end)
    assert(not ok and type(err)=='string' and #app.sprite.layers==1)
    assert(app.fgColor.red==10 and app.image:getPixel(0,0)==0)
    app.image:drawPixel(1,1,Color{g=255})
  ` }, { onDialog: async schema => { await pause(10); return buttonResponse(schema, 'fail'); } });
  assert.equal(result.document.layers.length, 1); assert.deepEqual(result.fgColor, [10, 20, 30, 40]);
  assert.equal(renderFrame(result.document)[1], 0); assert.equal(renderFrame(result.document)[13], 255);
  assert.ok(result.transactions.every(transaction => transaction.label !== 'rollback across dialog'));
});

test('window close resumes the script with no selected button and calls onclose once', async () => {
  const result = await runLuaScript({ source: `local n=0;local d=Dialog{onclose=function()n=n+1 end}:entry{id='name',text='original'}:button{id='ok'};d:show();assert(not d.data.ok and d.data.name=='kept' and n==1); print('closed')` }, { onDialog: schema => ({ action: 'close', values: { [schema.controls[0].key]: 'kept' } }) });
  assert.deepEqual(result.prints, ['closed']);
});

test('headless execution explicitly rejects Dialog and caller input cannot enable UI access', async () => {
  assert.deepEqual((await runLuaScript({ source: 'assert(not app.isUIAvailable)' })).transactions, []);
  await assert.rejects(runLuaScript({ source: 'Dialog()', dialogs: true, onDialog: () => ({ action: 'close' }) }), /interactive UI host/);
  for (const source of ["Dialog():entry{onchange=function()end}", "Dialog():check{onclick=function()end}", 'Dialog():show{wait=false}', 'Dialog():show{hand=true}', 'Dialog{parent={}}', 'Dialog():canvas{}']) {
    await assert.rejects(runLuaScript({ source }, { onDialog: () => { throw Error('must not show unsupported widgets'); } }), /Unsupported Dialog|Only blocking/);
  }
});

test('cancellation during a real dialog wait aborts UI and returns no staged artwork', async () => {
  const input = document(), before = structuredClone(input), abort = new AbortController(); let dialogSignal, answer;
  const run = runLuaScript({ document: input, signal: abort.signal, source: 'app.sprite:newLayer();Dialog():button{id="ok"}:show();app.sprite:newLayer()' }, { onDialog: (schema, context) => { dialogSignal = context.signal; return new Promise(resolve => { answer = () => resolve(buttonResponse(schema, 'ok')); }); } });
  while (!answer) await pause(5);
  abort.abort(); await assert.rejects(run, /cancelled/); assert.equal(dialogSignal.aborted, true);
  answer(); await pause(15); assert.deepEqual(input, before);
});

test('stale editor state after a dialog response rejects the whole staged result', async () => {
  const input = document(), before = structuredClone(input); let revision = 1;
  await assert.rejects(runLuaScript({ document: input, source: 'app.sprite:newLayer();Dialog():button{id="ok"}:show();app.sprite:newLayer()' }, { isCurrent: () => revision === 1, onDialog: async schema => { revision++; return buttonResponse(schema, 'ok'); } }), /editor changed/);
  assert.deepEqual(input, before);
});

test('only actual dialog wait pauses the execution budget and the wait itself is capped', async () => {
  const result = await runLuaScript({ source: 'Dialog():button{id="ok"}:show();print("finished")', timeoutMs: 1000 }, { dialogWaitMs: 2000, onDialog: async schema => { await pause(1100); return buttonResponse(schema, 'ok'); } });
  assert.deepEqual(result.prints, ['finished']);
  let aborted;
  await assert.rejects(runLuaScript({ source: 'Dialog():show()', timeoutMs: 1000 }, { dialogWaitMs: 50, onDialog: (_, { signal }) => { aborted = signal; return new Promise(() => {}); } }), /waiting limit/);
  assert.equal(aborted.aborted, true);
  await assert.rejects(runLuaScript({ source: 'Dialog():show();while true do end', timeoutMs: 150, instructionLimit: 500000000 }, { onDialog: () => ({ action: 'close' }) }), /execution time|instruction budget/);
});

test('instruction hook remains active after Promise resume, even through pcall', async () => {
  await assert.rejects(runLuaScript({ source: 'Dialog():show();pcall(function()while true do end end)', instructionLimit: 10000 }, { onDialog: () => ({ action: 'close' }) }), /instruction budget/);
});

test('worker rendezvous ignores stale responses and never resumes two requests', async () => {
  const messages = [], channel = createLuaDialogChannel(message => messages.push(message));
  const first = channel.requestDialog(simple); let resumed = false; first.then(() => { resumed = true; });
  assert.equal(channel.receive({ type: 'dialog-response', id: 0, response: { action: 'close' } }), false);
  await pause(5); assert.equal(resumed, false); await assert.rejects(channel.requestDialog(simple), /already pending/);
  assert.equal(channel.receive({ type: 'dialog-response', id: 1, response: { action: 'close' } }), true); await first;
  const second = channel.requestDialog(simple);
  assert.equal(channel.receive({ type: 'dialog-response', id: 1, response: { action: 'close' } }), false);
  assert.equal(channel.receive({ type: 'dialog-response', id: 2, response: { action: 'close' } }), true); await second;
  assert.deepEqual(messages.map(message => message.id), [1, 2]);
});

test('schema/response validation rejects executable shapes, unknown fields, and invalid controls', () => {
  for (const bad of [{ title: 'x', controls: [{ type: 'file', key: 'w1' }] }, { ...simple, controls: Array(65).fill(simple.controls[0]) }, { ...simple, controls: [{ type: 'entry', key: 'w1', id: '__proto__' }] }, { ...simple, controls: [{ type: 'entry', key: 'w1', value: 'x'.repeat(17000) }] }, { ...simple, title: 'x'.repeat(70000) }, { ...simple, controls: [{ type: 'button', key: 'w1', onclick: () => {} }] }]) assert.throws(() => validateDialogSchema(bad), /Lua Dialog/);
  for (const response of [{ action: 'button', button: 'missing' }, { action: 'close', values: { missing: 1 } }, { action: 'close', values: { w2: true } }, { action: 'close', values: { w1: {} } }, { action: 'close', onclick: 'code' }]) assert.throws(() => validateDialogResponse(response, simple), /Lua Dialog/);
  const hidden = validateDialogSchema({ controls: [{ type: 'entry', key: 'w1', visible: false }, { type: 'button', key: 'w2', enabled: false }] });
  assert.throws(() => validateDialogResponse({ action: 'button', button: 'w2' }, hidden), /unavailable/);
  assert.throws(() => validateDialogResponse({ action: 'close', values: { w1: 'hidden' } }, hidden), /hidden/);
});

test('host controller rejects unsolicited/replayed requests and output while waiting', async () => {
  for (const mode of ['headless', 'replay', 'early-result']) {
    let terminated = 0;
    const controller = createLuaWorkerController(luaRequest({ source: '' }), { terminate: () => terminated++, postMessage: () => {}, ...(mode === 'headless' ? {} : { onDialog: () => new Promise(() => {}) }) });
    controller.message({ type: 'dialog-request', id: 1, dialog: simple });
    if (mode === 'replay') controller.message({ type: 'dialog-request', id: 1, dialog: simple });
    if (mode === 'early-result') controller.message({ ok: true, result: {} });
    await assert.rejects(controller.promise, /headless|out-of-order|while a dialog/); assert.equal(terminated, 1);
  }
});

test('the real browser worker module resumes the same VM through the browser runner hook', async t => {
  const { Worker } = await import('node:worker_threads');
  const { runLuaScript: runBrowser } = await import('../app/lua-runner-browser.mjs');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: 'https://pixelwall.example/editor' } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'location', descriptor) : delete globalThis.location);
  let terminated = 0;
  const createWorker = () => {
    const worker = new Worker(new URL('./fixtures/lua-dialog-browser-worker.mjs', import.meta.url), { execArgv: [] });
    const adapter = { postMessage: value => worker.postMessage(value), terminate: () => { terminated++; void worker.terminate(); } };
    worker.on('message', data => adapter.onmessage({ data })); worker.on('error', error => adapter.onerror(error)); return adapter;
  };
  const result = await runBrowser({ source: 'local n=9;local d=Dialog():entry{id="word"}:button{id="ok"};d:show();print(n,d.data.word,d.data.ok)' }, { wasmUri: '/runtimes/lua.wasm', createWorker, isCurrent: () => true, onDialog: async schema => { await pause(10); return buttonResponse(schema, 'ok', { word: 'browser' }); } });
  assert.deepEqual(result.prints, ['9\tbrowser\ttrue']); assert.equal(terminated, 1);
  await assert.rejects(runBrowser({ source: 'Dialog()' }, { wasmUri: '/runtimes/lua.wasm', createWorker }), /interactive UI host/);
  assert.equal(terminated, 2);
});

test('real CLI remains headless and does not write partial changes before a dialog', async t => {
  const { mkdtemp, writeFile, readFile, access, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { main } = await import('../app/cli.mjs');
  const folder = await mkdtemp(join(tmpdir(), 'pixelwall-dialog-cli-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const input = join(folder, 'input.pixelwall'), script = join(folder, 'dialog.lua'), output = join(folder, 'output.pixelwall');
  await writeFile(input, JSON.stringify(document())); await writeFile(script, 'app.sprite:newLayer();Dialog():show()');
  const before = await readFile(input);
  await assert.rejects(main(['script', input, '--script', script, '--out', output]), /interactive UI host/);
  await assert.rejects(access(output)); assert.deepEqual(await readFile(input), before);
});

test('failed host response and over-budget dialog loops cannot publish staged artwork', async () => {
  const input = document(), before = structuredClone(input);
  await assert.rejects(runLuaScript({ document: input, source: 'app.sprite:newLayer();Dialog():button{id="ok"}:show()' }, { onDialog: () => ({ action: 'button', button: 'missing' }) }), /unavailable/);
  let count = 0;
  await assert.rejects(runLuaScript({ document: input, source: 'app.sprite:newLayer();for i=1,40 do pcall(function()Dialog():show()end) end' }, { onDialog: () => { count++; return { action: 'close' }; } }), /request limit/);
  assert.equal(count, 32); assert.deepEqual(input, before);
});

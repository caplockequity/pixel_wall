import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../app/editor-core.mjs';
import { runLuaScript } from '../app/lua-runner-node.mjs';
import { luaRequest } from '../app/lua-request.mjs';
import { createLuaWorkerController } from '../app/lua-worker-controller.mjs';
import { createLuaPluginSession } from '../app/lua-plugin-session.mjs';
import { createLuaPluginChannel } from '../app/lua-plugin-channel.mjs';
import { validatePluginOptions, validatePluginPreferences, validatePluginCatalog, validatePluginChoice, validatePluginResult } from '../app/lua-plugin-schema.mjs';

const plugin = preferences => validatePluginOptions({ name: 'example-tools', displayName: 'Example Tools', version: '1.2.3', preferences });
const document = () => createDocument({ width: 2, height: 2 });
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const choose = catalog => ({ action: 'run', commandId: catalog.commands.find(command => command.enabled).id });
const command = body => `function init(plugin) plugin:newCommand{id='Draw',title='Draw',onclick=function() ${body} end} end`;
const catalog = (configuration = plugin()) => ({ name: configuration.name, displayName: configuration.displayName, version: configuration.version, commands: [{ id: 'Draw', title: 'Draw', group: '', enabled: true }] });

test('real package VM retains init locals through command choice, Dialog callbacks, and exit', async () => {
  const input = document(), before = structuredClone(input), preferences = { count: 4 }; let choices = 0, dialogs = 0;
  const result = await runLuaScript({ document: input, source: `
    local state=7
    local registered
    function init(plugin)
      assert(plugin.name=='example-tools' and plugin.displayName=='Example Tools' and plugin.version=='1.2.3')
      assert(__pixelwallPluginChoice==nil and __pixelwallPluginDone==nil and __pixelwallPluginConfig==nil)
      registered=plugin
      plugin:newCommand{id='Disabled',title='Unavailable',onenabled=function()return false end,onclick=function()error('disabled ran')end}
      plugin:newCommand{id='Draw',title='Draw a mark',group='cel_popup_properties',onchecked=function()return true end,onclick=function()
        state=state+1
        app.transaction('Package command',function()
          app.sprite:newLayer()
          local dialog
          dialog=Dialog():number{id='amount',text='2'}:button{id='ok',onclick=function()state=state+10;dialog:close() end}
          dialog:show()
          assert(dialog.data.ok and dialog.data.amount==3 and state==18)
          plugin.preferences.count=plugin.preferences.count+dialog.data.amount
        end)
      end}
    end
    function exit(plugin) assert(plugin==registered and state==18);plugin.preferences.last='exit'; print(state,plugin.preferences.count) end
  ` }, { plugin: plugin(preferences), onCommand: async (data, { signal, requestId }) => {
    choices++; assert.equal(requestId, 1); assert.equal(signal.aborted, false); assert.deepEqual(input, before);
    assert.deepEqual(data.commands, [{ id: 'Disabled', title: 'Unavailable', group: '', enabled: false }, { id: 'Draw', title: 'Draw a mark', group: 'cel_popup_properties', enabled: true, checked: true }]);
    await pause(10); return choose(data);
  }, onDialog: async schema => {
    dialogs++; return { action: 'button', button: schema.controls[1].key, values: { [schema.controls[0].key]: 3 } };
  } });
  assert.equal(choices, 1); assert.equal(dialogs, 1); assert.equal(result.document.layers.length, 2);
  assert.ok(result.transactions.some(transaction => transaction.label === 'Package command'));
  assert.deepEqual(result.prints, ['18\t7']);
  assert.deepEqual(result.plugin, { name: 'example-tools', version: '1.2.3', commandId: 'Draw', preferences: { count: 7, last: 'exit' }, preferencesChanged: true });
  assert.deepEqual(input, before); assert.deepEqual(preferences, { count: 4 });
});

test('official Plugin example stages count preferences; repeated runs receive only host-committed preferences', async () => {
  const source = `function init(plugin)
    if plugin.preferences.count == nil then plugin.preferences.count = 0 end
    plugin:newCommand{id='MyFirstCommand',title='My First Command',group='cel_popup_properties',onclick=function()plugin.preferences.count=plugin.preferences.count+1 end}
  end
  function exit(plugin) print('MyFirstCommand was called '..plugin.preferences.count..' times') end`;
  const first = await runLuaScript({ source }, { plugin: plugin(), onCommand: choose });
  const second = await runLuaScript({ source }, { plugin: plugin(first.plugin.preferences), onCommand: choose });
  assert.equal(first.plugin.preferences.count, 1); assert.equal(second.plugin.preferences.count, 2);
  const unchanged = await runLuaScript({ source: command('assert(plugin.preferences.items[1]==true)') }, { plugin: plugin({ z: {}, items: [true, 0.25] }), onCommand: choose });
  assert.equal(unchanged.plugin.preferencesChanged, false);
});

test('package activation requires trusted second-argument options and an explicit host', async () => {
  let calls = 0;
  const result = await runLuaScript({ source: "function init(plugin)error('must not initialize')end;assert(io==nil and os==nil and package==nil and require==nil)", plugin: plugin(), params: { plugin: plugin() } }, { onCommand: () => { calls++; } });
  assert.equal(calls, 0); assert.equal(result.plugin, undefined);
  await assert.rejects(runLuaScript({ source: command('') }, { plugin: plugin() }), /explicit interactive host/);
  await assert.rejects(runLuaScript({ document: document(), source: 'app.sprite:newLayer()' }, { plugin: plugin(), onCommand: choose }), /define init/);
});

test('cancelled picker and failed callbacks return no artwork or preferences, including init changes', async () => {
  const input = document(), before = structuredClone(input), preferences = { count: 1 };
  for (const mode of ['cancel', 'callback', 'exit', 'picker']) {
    const source = `function init(plugin)
      app.sprite:newLayer(); plugin.preferences.count=3
      plugin:newCommand{id='Draw',onclick=function()app.sprite:newLayer();plugin.preferences.count=4;${mode === 'callback' ? "error('callback failed')" : ''} end}
    end
    function exit(plugin) plugin.preferences.count=5;${mode === 'exit' ? "error('exit failed')" : ''} end`;
    await assert.rejects(runLuaScript({ document: input, source }, { plugin: plugin(preferences), onCommand: data => {
      if (mode === 'picker') throw Error('picker failed');
      return mode === 'cancel' ? { action: 'cancel' } : choose(data);
    } }), /cancelled|callback failed|exit failed|picker failed/);
    assert.deepEqual(input, before); assert.deepEqual(preferences, { count: 1 });
  }
});

test('abort revokes the live command picker and ignores its late response', async () => {
  const input = document(), before = structuredClone(input), abort = new AbortController(); let answer, pickerSignal;
  const running = runLuaScript({ document: input, source: command('app.sprite:newLayer()'), signal: abort.signal }, { plugin: plugin(), onCommand: (data, { signal }) => { pickerSignal = signal; return new Promise(resolve => { answer = () => resolve(choose(data)); }); } });
  while (!answer) await pause(5);
  abort.abort(); await assert.rejects(running, /cancelled/); assert.equal(pickerSignal.aborted, true);
  answer(); await pause(10); assert.deepEqual(input, before);
});

test('package and editor staleness are checked around picker and subsequent Dialog handoffs', async () => {
  const input = document(), before = structuredClone(input);
  for (const mode of ['picker', 'dialog']) {
    let revision = 1;
    await assert.rejects(runLuaScript({ document: input, source: command('app.sprite:newLayer();Dialog():show()') }, { plugin: plugin(), isCurrent: () => revision === 1, onCommand: data => { if (mode === 'picker') revision++; return choose(data); }, onDialog: () => { revision++; return { action: 'close' }; } }), /editor changed/);
    assert.deepEqual(input, before);
  }
});

test('selection rechecks enabled state and registration is confined to init', async () => {
  for (const source of [
    `local count=0;function init(plugin)plugin:newCommand{id='Draw',onenabled=function()count=count+1;return count==1 end,onclick=function()error('must not run')end}end`,
    command(`plugin:newCommand{id='Late',onclick=function()end}`),
    `function init(plugin)for i=1,33 do plugin:newCommand{id='C'..i,onclick=function()end}end end`,
    `function init(plugin)for i=1,2 do plugin:newCommand{id='Repeated',onclick=function()end}end end`,
    `function init(plugin)plugin:newCommand{id='Draw',onenabled=function()return 1 end,onclick=function()end}end`,
    `function init(plugin)plugin:newCommand{id='Draw',onclick='source'}end`,
    `function init(plugin)end`,
  ]) await assert.rejects(runLuaScript({ source }, { plugin: plugin(), onCommand: choose }), /no longer enabled|only during init|at most 32|unique safe|must return a boolean|onclick callback|1–32/);
});

test('plugin identity, filesystem access, menu/file registries and non-JSON preferences fail explicitly', async () => {
  const bad = [
    "plugin.name='changed'", "plugin.preferences={}", 'print(plugin.path)', 'plugin:newMenuGroup{}', 'plugin:newFileFormat{}',
    'plugin.preferences.sprite=Sprite(1,1)', 'plugin.preferences.point=Point(1,1)', 'plugin.preferences.fn=function()end',
    'plugin.preferences.self=plugin.preferences', 'plugin.preferences.list={[1]=1,[3]=3}', 'plugin.preferences.mixed={[1]=1,name=2}',
    'plugin.preferences.bad=setmetatable({},{})', 'plugin.preferences.bad=math.huge', 'plugin.preferences.bad=9007199254740992',
    "plugin.preferences['__proto__']='bad'", "plugin.preferences.bad=string.char(255)",
    "plugin.preferences.bad=string.rep('a',16385)",
  ];
  for (const source of bad) await assert.rejects(runLuaScript({ source: command(source) }, { plugin: plugin(), onCommand: choose }), /read-only|Unsupported Plugin|preferences|preference/);
});

test('preference schema returns an immutable JSON snapshot and rejects getters without invoking them', () => {
  const source = { z: [1, true, { label: '🐼' }], a: [] }, normalized = validatePluginPreferences(source);
  assert.deepEqual(normalized, { a: {}, z: [1, true, { label: '🐼' }] }); normalized.z[2].label = 'edited'; assert.equal(source.z[2].label, '🐼');
  let accessed = 0; const accessor = {}; Object.defineProperty(accessor, 'data', { enumerable: true, get() { accessed++; return 'bad'; } });
  const array = []; Object.defineProperty(array, 0, { enumerable: true, get() { accessed++; return 'bad'; } });
  const circular = {}; circular.self = circular;
  const hidden = {}; Object.defineProperty(hidden, 'hidden', { value: 1 });
  for (const value of [{ value: null }, { value: undefined }, { value: Infinity }, { value: Number.MAX_SAFE_INTEGER + 1 }, { value: () => {} }, accessor, { array }, circular, hidden, { [Symbol('hidden')]: 1 }, { sparse: Array(2) }, JSON.parse('{"constructor":1}'), { bad: '\ud800' }, { bad: 'x'.repeat(16385) }, { value: new Date() }]) assert.throws(() => validatePluginPreferences(value), /Lua package/);
  assert.equal(accessed, 0);
  let deep = {}; for (let i = 0; i < 13; i++) deep = { child: deep }; assert.throws(() => validatePluginPreferences(deep), /depth/);
  assert.throws(() => validatePluginPreferences({ array: Array(4096).fill(1) }), /value-count/);
});

test('a full 64 KiB preference object fits beside the result identity envelope', async () => {
  const preferences = { a: 'x'.repeat(16384), b: 'x'.repeat(16384), c: 'x'.repeat(16384), d: '' };
  preferences.d = 'x'.repeat(65536 - new TextEncoder().encode(JSON.stringify(preferences)).length);
  assert.equal(new TextEncoder().encode(JSON.stringify(preferences)).length, 65536);
  assert.deepEqual(validatePluginPreferences(preferences), preferences);
  const result = await runLuaScript({ source: command('assert(#plugin.preferences.a==16384)') }, { plugin: plugin(preferences), onCommand: choose });
  assert.equal(result.plugin.preferencesChanged, false);
  assert.throws(() => validatePluginPreferences({ ...preferences, e: true }), /64 KiB/);
});

test('catalog and choice boundaries reject foreign identities, disabled IDs and executable metadata', () => {
  const configuration = plugin(), valid = catalog(configuration);
  for (const value of [{ ...valid, name: 'other' }, { ...valid, commands: Array(33).fill(valid.commands[0]) }, { ...valid, commands: [valid.commands[0], valid.commands[0]] }, { ...valid, commands: [{ ...valid.commands[0], onclick: 'code' }] }, { ...valid, commands: [{ ...valid.commands[0], id: '__proto__' }] }]) assert.throws(() => validatePluginCatalog(value, configuration), /Lua package/);
  for (const value of [{ action: 'run', commandId: 'missing' }, { action: 'cancel', commandId: 'Draw' }, { action: 'run', commandId: 'Draw', source: 'code' }]) assert.throws(() => validatePluginChoice(value, valid), /Lua package/);
  assert.throws(() => validatePluginChoice({ action: 'run', commandId: 'Draw' }, { ...valid, commands: [{ ...valid.commands[0], enabled: false }] }), /disabled/);
  assert.equal(validatePluginResult({ name: configuration.name, version: configuration.version, commandId: 'Draw', preferences: {}, preferencesChanged: true }, configuration, 'Draw').preferencesChanged, false);
});

test('worker-local session and transport require one selected callback before final output', async () => {
  const configuration = plugin(), valid = catalog(configuration), messages = [];
  const channel = createLuaPluginChannel(message => messages.push(message), configuration);
  const session = createLuaPluginSession(configuration, channel.requestCommand);
  assert.throws(() => session.finish(), /did not complete/);
  const choosing = session.choose(JSON.stringify(valid));
  assert.equal(channel.receive({ type: 'plugin-command-response', id: 0, response: choose(valid) }), false);
  assert.equal(channel.receive({ type: 'plugin-command-response', id: 1, response: choose(valid) }), true);
  assert.equal(JSON.parse(await choosing).ok, true);
  assert.equal(channel.receive({ type: 'plugin-command-response', id: 1, response: choose(valid) }), false);
  await assert.rejects(channel.requestCommand(valid), /Only one/);
  assert.throws(() => session.complete(JSON.stringify({ name: 'other' })), /does not match/);
  session.complete(JSON.stringify({ name: configuration.name, version: configuration.version, commandId: 'Draw', preferences: { count: 1 } }));
  assert.equal(session.finish().preferences.count, 1); assert.throws(() => session.complete('{}'), /Invalid package/);
  assert.equal(JSON.parse(await session.choose(JSON.stringify(valid))).ok, false);
  assert.throws(() => session.finish(), /did not complete/); assert.equal(messages.length, 1);
});

test('controller rejects unsolicited, duplicate and early package output and forged results', async () => {
  const configuration = plugin(), valid = catalog(configuration), source = command('');
  const successful = await runLuaScript({ source }, { plugin: configuration, onCommand: choose });
  for (const mode of ['headless', 'duplicate', 'early', 'foreign-catalog', 'forged-result', 'standalone-result']) {
    const request = luaRequest({ source }); let terminated = 0;
    if (!['headless', 'standalone-result'].includes(mode)) request.plugin = configuration;
    const controller = createLuaWorkerController(request, { terminate: () => terminated++, postMessage: () => {}, onCommand: mode === 'forged-result' ? choose : () => new Promise(() => {}) });
    if (mode === 'standalone-result') controller.message({ ok: true, result: successful });
    else controller.message({ type: 'plugin-command-request', id: 1, catalog: mode === 'foreign-catalog' ? { ...valid, name: 'other' } : valid });
    if (mode === 'duplicate') controller.message({ type: 'plugin-command-request', id: 1, catalog: valid });
    if (mode === 'early') controller.message({ ok: true, result: successful });
    if (mode === 'forged-result') { await pause(5); controller.message({ ok: true, result: { ...successful, plugin: { ...successful.plugin, commandId: 'Other' } } }); }
    await assert.rejects(controller.promise, /interactive host|out-of-order|pending|does not match|Unsolicited/); assert.equal(terminated, 1);
  }
});

test('command picker pauses active execution budget but has a finite cancellable wait', async () => {
  const result = await runLuaScript({ source: command("print('finished')"), timeoutMs: 1000 }, { plugin: plugin(), dialogWaitMs: 2000, onCommand: async data => { await pause(1100); return choose(data); } });
  assert.deepEqual(result.prints, ['finished']);
  let pickerSignal;
  await assert.rejects(runLuaScript({ source: command('') }, { plugin: plugin(), dialogWaitMs: 50, onCommand: (_, { signal }) => { pickerSignal = signal; return new Promise(() => {}); } }), /waiting limit/);
  assert.equal(pickerSignal.aborted, true);
  for (const source of ['function init(plugin)while true do end end', command('pcall(function()while true do end end)'), `${command('')} function exit(plugin)while true do end end`]) {
    await assert.rejects(runLuaScript({ source, instructionLimit: 20000 }, { plugin: plugin(), onCommand: choose }), /instruction budget/);
  }
});

test('real browser worker supports package choice and Dialog through the same staged session', async t => {
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
  const result = await runBrowser({ source: `local count=2;${command("count=count+1;Dialog():show();plugin.preferences.count=count")}` }, { plugin: plugin(), onCommand: choose, onDialog: () => ({ action: 'close' }), wasmUri: '/runtimes/lua.wasm', createWorker });
  assert.equal(result.plugin.preferences.count, 3); assert.equal(terminated, 1);
  await assert.rejects(runBrowser({ source: command('') }, { plugin: plugin(), wasmUri: '/runtimes/lua.wasm', createWorker }), /explicit interactive host/);
  assert.equal(terminated, 1);
});

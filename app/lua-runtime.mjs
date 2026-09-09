import { createLuaPluginSession } from './lua-plugin-session.mjs';
import { LuaFactory } from 'wasmoon';
import { validateDialogSchema, validateDialogResponse, LUA_DIALOG_LIMITS } from './lua-dialog-schema.mjs';
import { LUA_BOOTSTRAP } from './lua-bootstrap.mjs';
import { createLuaSession, LUA_LIMITS } from './lua-session.mjs';

/** Worker-internal only: never execute untrusted scripts on the editor/main thread. */
export async function executeLuaInWorker(request, wasmUri, { requestDialog, requestCommand, colorManager } = {}) {
  const session = createLuaSession(request, {colorManager});
  const plugin = createLuaPluginSession(request.plugin, requestCommand);
  const factory = new LuaFactory(wasmUri, {});
  const lua = await factory.createEngine({ injectObjects: false, enableProxy: false, traceAllocations: true });
  try {
    lua.global.setMemoryMax(LUA_LIMITS.memoryBytes);
    lua.global.set('__pixelwallRpc', (op, json) => session.rpc(op, json));
    let dialogCount = 0;
    lua.global.set('__pixelwallDialogEnabled', typeof requestDialog === 'function');
    lua.global.set('__pixelwallDialog', async json => {
      try {
        if (typeof requestDialog !== 'function') throw Error('Dialog requires an interactive UI host.');
        if (++dialogCount > LUA_DIALOG_LIMITS.requests) throw Error('Lua Dialog request limit exceeded.');
        if (typeof json !== 'string' || new TextEncoder().encode(json).length > LUA_DIALOG_LIMITS.bytes) throw Error('Lua Dialog data exceeds 64 KiB.');
        const schema = validateDialogSchema(JSON.parse(json));
        const response = validateDialogResponse(await requestDialog(schema), schema);
        return JSON.stringify({ ok: true, value: response });
      } catch (error) { return JSON.stringify({ ok: false, error: String(error?.message ?? error).slice(0, 4096) }); }
    });
    lua.global.set('__pixelwallPluginConfig', plugin?.configuration ?? '');
    lua.global.set('__pixelwallPluginChoice', plugin?.choose ?? (() => { throw Error('No package session.'); }));
    lua.global.set('__pixelwallPluginDone', plugin?.complete ?? (() => { throw Error('No package session.'); }));
    lua.global.set('__pixelwallSource', request.source);
    lua.global.set('__pixelwallInstructions', request.instructionLimit);
    await lua.doString(LUA_BOOTSTRAP);
    if (dialogCount > LUA_DIALOG_LIMITS.requests) throw Error('Lua Dialog request limit exceeded.');
    return { ...session.finish(), ...(plugin ? { plugin: plugin.finish() } : {}) };
  } finally { lua.global.close(); }
}

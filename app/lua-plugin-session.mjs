import { LUA_PLUGIN_LIMITS, validatePluginOptions, validatePluginCatalog, validatePluginChoice, validatePluginResult } from './lua-plugin-schema.mjs';

/** Worker-local package state. Preferences are returned as staged data only. */
export function createLuaPluginSession(options, requestCommand) {
  if (options == null) return null;
  const plugin = validatePluginOptions(options);
  if (typeof requestCommand !== 'function') throw Error('Package commands require an explicit interactive host.');
  let catalog, selected, result, requests = 0;
  const parse = (json, limit = LUA_PLUGIN_LIMITS.bytes) => {
    if (typeof json !== 'string' || new TextEncoder().encode(json).length > limit) throw Error('Lua package data exceeds its byte limit.');
    return JSON.parse(json);
  };
  return {
    configuration: JSON.stringify(plugin),
    async choose(json) {
      try {
        if (++requests !== 1) throw Error('Only one command choice is allowed per package session.');
        catalog = validatePluginCatalog(parse(json), plugin);
        const choice = validatePluginChoice(await requestCommand(catalog), catalog);
        if (choice.action === 'cancel') throw Error('Package command session cancelled. No edits were committed.');
        selected = choice.commandId;
        return JSON.stringify({ ok: true, value: choice });
      } catch (error) { return JSON.stringify({ ok: false, error: String(error?.message ?? error).slice(0, 4096) }); }
    },
    complete(json) {
      if (!selected || result) throw Error('Invalid package command completion.');
      // Allow the bounded identity envelope in addition to the full preference budget.
      result = validatePluginResult(parse(json, LUA_PLUGIN_LIMITS.bytes + 1024), plugin, selected);
      return true;
    },
    finish() { if (requests !== 1 || !selected || !result) throw Error('The package command did not complete.'); return structuredClone(result); },
  };
}

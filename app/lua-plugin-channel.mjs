import { validatePluginCatalog, validatePluginChoice } from './lua-plugin-schema.mjs';

/** One user choice per live package worker; callback functions stay in Lua. */
export function createLuaPluginChannel(postMessage, plugin) {
  let pending = null, requested = false;
  return {
    requestCommand(input) {
      if (requested) return Promise.reject(Error('Only one package command selection is allowed.'));
      const catalog = validatePluginCatalog(input, plugin); requested = true;
      return new Promise((resolve, reject) => {
        pending = { catalog, resolve, reject };
        try { postMessage({ type: 'plugin-command-request', id: 1, catalog }); }
        catch (error) { pending = null; reject(error); }
      });
    },
    receive(message) {
      if (message?.type !== 'plugin-command-response' || !pending || message.id !== 1) return false;
      const current = pending; pending = null;
      try { current.resolve(validatePluginChoice(message.response, current.catalog)); }
      catch (error) { current.reject(error); }
      return true;
    },
  };
}

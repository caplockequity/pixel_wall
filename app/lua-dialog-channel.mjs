import { LUA_DIALOG_LIMITS, validateDialogSchema, validateDialogResponse } from './lua-dialog-schema.mjs';

/** Worker-local rendezvous: one live VM, one outstanding request, monotonic IDs. */
export function createLuaDialogChannel(postMessage) {
  let serial = 0, pending = null;
  return {
    requestDialog(schema) {
      if (pending) return Promise.reject(Error('A Lua dialog response is already pending.'));
      if (++serial > LUA_DIALOG_LIMITS.requests) return Promise.reject(Error('Lua Dialog request limit exceeded.'));
      schema = validateDialogSchema(schema);
      return new Promise((resolve, reject) => {
        pending = { id: serial, schema, resolve, reject };
        try { postMessage({ type: 'dialog-request', id: serial, dialog: schema }); }
        catch (error) { pending = null; reject(error); }
      });
    },
    receive(message) {
      if (message?.type !== 'dialog-response' || !pending || message.id !== pending.id) return false;
      const current = pending; pending = null;
      try { current.resolve(validateDialogResponse(message.response, current.schema)); }
      catch (error) { current.reject(error); }
      return true;
    },
  };
}

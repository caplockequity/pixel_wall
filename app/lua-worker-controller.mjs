import { validatePluginOptions, validatePluginCatalog, validatePluginChoice, validatePluginResult } from './lua-plugin-schema.mjs';
import { validateLuaResult } from './lua-request.mjs';
import { LUA_DIALOG_LIMITS, validateDialogSchema, validateDialogResponse } from './lua-dialog-schema.mjs';

/** Host-side lifecycle shared by browser and Node. Results remain staged until
 * completion; isCurrent additionally rejects stale editor context at every handoff. */
export function createLuaWorkerController(request, { postMessage, terminate, signal, onDialog, onCommand, isCurrent, dialogWaitMs = LUA_DIALOG_LIMITS.waitMs } = {}) {
  if (!Number.isSafeInteger(dialogWaitMs) || dialogWaitMs < 50 || dialogWaitMs > LUA_DIALOG_LIMITS.totalWaitMs) throw Error('Lua dialog wait limit must be 50–300000 milliseconds.');
  const plugin = request.plugin == null ? null : validatePluginOptions(request.plugin);
  if (plugin && typeof onCommand !== 'function') throw Error('Package commands require an explicit interactive host.');
  let packageRequested = false, chosenCommand;
  let settled = false, remaining = request.timeoutMs, activeStarted, timer, waitTimer, pending = null, serial = 0, waited = 0;
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  const now = () => globalThis.performance?.now() ?? Date.now();
  const current = () => { if (isCurrent && isCurrent() !== true) throw Error('The editor changed while Lua was running. No edits were committed.'); };
  function finish(error, result) {
    if (settled) return;
    settled = true; clearTimeout(timer); clearTimeout(waitTimer); pending?.abort.abort(); pending = null;
    signal?.removeEventListener('abort', abort);
    terminate();
    if (error) reject(error);
    else { try {
      current(); const validated = validateLuaResult(result, request.document);
      if (plugin) { if (!chosenCommand) throw Error('The package returned before a command was chosen.'); validated.plugin = validatePluginResult(result.plugin, plugin, chosenCommand); }
      else if (result.plugin !== undefined) throw Error('Unsolicited package result from a standalone script.');
      resolve(validated);
    } catch (error) { reject(error); } }
  }
  const abort = () => finish(Error('Lua script cancelled.'));
  function arm() {
    activeStarted = now();
    timer = setTimeout(() => finish(Error('Lua execution time limit exceeded. No edits were committed.')), Math.max(0, remaining));
  }
  function show(message) {
    const packageChoice = message.type === 'plugin-command-request';
    if (packageChoice) {
      if (!plugin || typeof onCommand !== 'function') throw Error('Package commands require an explicit interactive host.');
      if (pending || packageRequested || message.id !== 1) throw Error('Invalid or out-of-order package command request.');
    } else {
      if (typeof onDialog !== 'function') throw Error('Dialog requires an interactive UI host; it is unavailable in headless Lua execution.');
      if (pending || message.id !== serial + 1 || serial >= LUA_DIALOG_LIMITS.requests) throw Error('Invalid or out-of-order Lua dialog request.');
    }
    const schema = packageChoice ? validatePluginCatalog(message.catalog, plugin) : validateDialogSchema(message.dialog); current();
    remaining -= now() - activeStarted; clearTimeout(timer);
    if (remaining <= 0) throw Error('Lua execution time limit exceeded. No edits were committed.');
    const available = Math.min(dialogWaitMs, LUA_DIALOG_LIMITS.totalWaitMs - waited);
    if (available <= 0) throw Error('Lua dialog waiting limit exceeded. No edits were committed.');
    if (packageChoice) packageRequested = true; else serial = message.id;
    const waiting = { id: message.id, kind: packageChoice ? 'package-command' : 'dialog', started: now(), allowed: available, abort: new AbortController() }; pending = waiting;
    waitTimer = setTimeout(() => finish(Error('Lua dialog waiting limit exceeded. No edits were committed.')), available);
    Promise.resolve().then(() => {
      if (settled || pending !== waiting) return;
      current(); return (packageChoice ? onCommand : onDialog)(structuredClone(schema), { signal: waiting.abort.signal, requestId: waiting.id });
    }).then(response => {
      if (settled || pending !== waiting) return;
      current(); const data = packageChoice ? validatePluginChoice(response, schema) : validateDialogResponse(response, schema);
      if (packageChoice && data.action === 'cancel') { finish(Error('Package command session cancelled. No edits were committed.')); return; }
      if (now() - waiting.started >= waiting.allowed) throw Error('Lua dialog waiting limit exceeded. No edits were committed.');
      if (packageChoice) chosenCommand = data.commandId;
      waited += now() - waiting.started; clearTimeout(waitTimer); pending = null; waiting.abort.abort();
      arm(); postMessage({ type: packageChoice ? 'plugin-command-response' : 'dialog-response', id: waiting.id, response: data });
    }).catch(error => finish(error instanceof Error ? error : Error(String(error))));
  }
  function message(value) {
    if (settled) return;
    try {
      if (value?.type === 'dialog-request' || value?.type === 'plugin-command-request') { show(value); return; }
      if (pending) throw Error('Lua worker returned output while a dialog or package response was pending.');
      if (value?.ok === true) { if (now() - activeStarted >= remaining) throw Error('Lua execution time limit exceeded. No edits were committed.'); finish(null, value.result); }
      else finish(Error(value?.error || 'Lua execution failed.'));
    } catch (error) { finish(error); }
  }
  arm(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return { promise, message, error: error => finish(error instanceof Error ? error : Error(String(error))), exit: code => finish(Error(`Lua worker exited before returning a result (${code}).`)) };
}

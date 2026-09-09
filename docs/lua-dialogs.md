# Lua blocking dialogs

The worker keeps the same Lua VM alive while `Dialog:show()` waits for a bounded host response. Locals, object handles, callbacks and active transactions remain in that VM. Scripts are never rerun to simulate a response, and no artwork is published before the entire script successfully finishes.

The existing Wasmoon 1.16.0 engine supports this through asynchronous `doString()` and a Promise `:await()` call. The Promise and bridge stay in bootstrap locals; the user environment still excludes JavaScript objects, Promise, coroutines, debugger, loaders, OS, files and network. A host response is validated JSON data. Button callbacks execute directly in Lua after the response, avoiding Wasmoon's restriction on yielding inside callbacks entered from JavaScript.

Supported: `Dialog()` / `Dialog(title)` / `Dialog{title,onclose}`, chainable `entry`, `number`, `slider`, `check`, `combobox`, `color`, `button`, `label`, `newrow`, `separator`, blocking `show`, `data` get/set, and `close`. Common widget fields are `id`, `label`, `enabled`, `visible`, `focus`, `hexpand`, and `vexpand`. Buttons support `onclick`; callbacks keep the dialog open until they call `close`. A button without a callback closes automatically. Window close runs `onclose` and continues the script without selecting a button. `data` and its Color values are detached copies.

Explicitly unsupported: `show{wait=false}`, `hand`, bounds/positioning, parents, custom chrome, resize options, `modify`, `onchange`, checkbox `onclick`, slider `onrelease`, radio/tabs/shades/file/canvas widgets, and event-loop-driven modeless behavior. Unsupported options fail rather than disappearing. Number fields support 0–6 decimal places and finite values within ±1 billion; submitted values are rounded to the selected precision. Slider values and limits are integers within the same bound.

Without an explicit trusted host callback, `app.isUIAvailable` is false and `Dialog()` throws a clear headless-execution error. This deliberately gives a clearer failure than Aseprite's documented nil return in headless mode. The CLI never installs a host callback. Script input, Lua params, and extension data cannot enable UI access.

## Browser UI integration

The Workbench installs these trusted hooks and renders bounded accessible form controls through `lua-dialog-view.jsx`:

```js
const result = await runLuaScript(input, {
  wasmUri,
  isCurrent: () => sameDocumentRevisionAndEditorContext(),
  onDialog: (schema, { signal, requestId }) => showScriptDialog(schema, { signal, requestId }),
});
```

`isCurrent` is checked before each dialog, after every answer, and again before releasing the final validated result. Keep the Workbench's existing final revision/context checks as well. The editor should block other document interaction during the run and offer its existing Cancel action. The script-dialog container must participate in that UI's allowed-control mechanism. No intermediate dialog message contains a document mutation to commit.

`onDialog` receives a data-only schema:

```js
{
  title: 'Resize sprite',
  controls: [
    { key: 'w1', id: 'size', type: 'slider', label: 'Size', text: '',
      value: 16, min: 1, max: 64, enabled: true, visible: true,
      focus: false, hexpand: true, vexpand: false },
    { key: 'w2', id: 'ok', type: 'button', label: '', text: 'Apply',
      value: false, callback: false, enabled: true, visible: true,
      focus: false, hexpand: true, vexpand: false }
  ]
}
```

Every control has a stable internal `key` (`w1`, `w2`, etc.). Script `id` is optional and is only the Lua `data` property name. Input values are strings for entry/label/combobox, numbers for number/slider, booleans for checkbox/button, and `[r,g,b,a]` byte arrays for color. Combobox adds `options: string[]`; number adds `decimals`; button adds `callback`; newrow adds `always`. Colors are raw document-working-profile values, so a managed color picker should use the existing display/working-color conversion for its appearance.

Render all titles, labels, text and options as plain text nodes. Do not interpret them as HTML, Markdown, URLs, styles, code, or component names. The renderer handles only the finite control-type list. Respect visibility/enabled state and focus; arrange rows/separators with normal accessible form elements. Entry text can be 16 KiB, other text 512 bytes, IDs 128 bytes, and combo boxes contain at most 128 options.

Resolve a button click with its internal key and only changed editable fields:

```js
{ action: 'button', button: 'w2', values: { w1: 32 } }
```

Resolve Escape/window close with `{action:'close', values:{...}}`; do not include `button`. Never include button, label, separator, newrow, disabled, or hidden field values. Unknown keys, invalid values or unavailable buttons reject the run rather than allowing unvalidated changes. Button submission validates form input and keeps the form open to correct incomplete values. Escape/window close retains prior values for invalid unfinished fields and closes normally.

The hook's `signal` aborts when its view should be removed: after response, cancellation, timeout, stale-context rejection, or worker failure. Clean up every abort listener and reject/abandon pending UI promises on abort. A callback button can cause a fresh request after Lua updates `data`; each request gets an increasing `requestId`. Update/reopen the dialog from its new schema, retaining layout by stable widget keys if useful. Only one response may be pending per worker.

## Budgets and atomicity

The existing instruction, memory, image, command, output and active-execution time limits stay in force. Execution time is cumulative across every callback and excludes only time spent awaiting a validated dialog response. The default wait for one response is 120 seconds, bounded by 300 seconds total waiting per run. A trusted host may set `dialogWaitMs` from 50 to 300000 milliseconds; this never raises the 300-second total cap. There are at most 32 requests, 64 controls per dialog, and 64 KiB per schema/response. Pausing the execution timer begins only after validating the request and checking the current editor context. Waiting itself has a separate timer and deadline check.

Cancellation, stale editor state, malformed response, callback failure escaping the script, or any budget violation terminates the worker and returns no staged artwork. Existing `app.transaction` rollback also works across a successful dialog wait and a later callback error. As in ordinary Lua, a caught transaction failure may be followed by new successful work; dialog presentation state itself is not part of document undo.

## Evidence

`tests/lua-dialogs.test.mjs` runs the real VM in workers and verifies persistent locals/handles, repeated button callbacks, all supported fields, partial-alpha Color handoff, transaction rollback across suspension, cancellation, stale context, wait/CPU/instruction limits, headless CLI/browser behavior, invalid/replayed protocol messages, and bounded request loops. The browser-worker test uses the production module with a test-only Node transport and locally installed Wasmoon asset; it does not itself establish rendered UI coverage. Separate actual Electron checks verified two callbacks in one VM, retained decimal input, a single native Undo for the completed script, and cancellation without committing a staged layer.

Primary references: [Aseprite Dialog API](https://github.com/aseprite/api/blob/main/api/dialog.md), [Wasmoon Promise/async behavior](https://github.com/ceifa/wasmoon#promises). Aseprite API documentation inspected from commit `662b12efe00fd374909bc3a0e9cce5d0d0d35d63`; runtime feasibility verified against the installed Wasmoon 1.16.0 implementation and an actual async round trip with object injection/proxies disabled.

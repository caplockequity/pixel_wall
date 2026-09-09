# Explicit package command sessions

PixelWall can run one command from an installed Lua contribution in an isolated Lua 5.4 worker. This is a bounded subset of the [Aseprite Plugin API](https://github.com/aseprite/api/blob/662b12efe00fd374909bc3a0e9cce5d0d0d35d63/api/plugin.md), not full installed-plugin compatibility.

Importing, listing, enabling or selecting a package does not execute its script. In **Scripts & commands → Aseprite extension packages**, choose **Run package commands** on an enabled Lua contribution, then choose one enabled command. **Open Lua source** opens the source for review without initializing its package. Source size, instruction, memory, pixel, transaction, output and export restrictions remain those of the existing Lua adapter.

## Integrated editor behavior

`capturePackageRun` in `app/aseprite-package-session.mjs` reads the package registry and that package's preferences in one IndexedDB snapshot. It reparses the saved archive and captures the exact selected source contribution, package identity and setting revisions. A document or selection change while this snapshot loads rejects the run. The worker boundary validates saved preferences before starting the VM.

Workbench locks editing while the worker runs and stops animation playback. `LuaCommandView` displays the registered command titles, checked states and disabled states as ordinary UI text. The chosen callback can open existing `LuaDialogView` controls while retaining its locals. Closing the command picker cancels the whole package run. Closing a script's Dialog resumes that Lua script with no selected button; what happens next depends on its code. **Cancel script** aborts the whole run, including when a Dialog is open.

Before and after each picker or Dialog handoff, Workbench checks both captured setting revisions. It separately checks the current document, edit revision and selection/color context. Another window's package disable/replacement or preference change rejects the pending run on the next handoff or final commit; the idle picker is not proactively closed by a storage listener.

After successful worker validation, `store.saveDocuments` performs one atomic transaction for all returned documents plus changed package preferences, guarded by the captured document and setting revisions. A conflict or failed save leaves both prior artwork and preferences intact. The final save phase disables cancellation while that atomic transaction completes. Workbench installs results only after the save succeeds, with one artwork/selection history entry per affected project. **Undo restores the current project's artwork and selection; successful package preferences remain saved.** Repeating a command starts a fresh VM with those saved preferences.

A native close request during the final save remains blocked until the user resolves the close prompt. An already tracked durable Lua commit may finish installing its result and Undo history underneath that prompt, so the canvas stays consistent with the saved documents and preferences. New edits and script runs remain blocked. Keeping the window open releases the close lock; a subsequent close validates the updated document revision.

## Host API

```js
import { runLuaScript } from './lua-runner-browser.mjs';
import { validatePluginPreferences } from './lua-plugin-schema.mjs';

const result = await runLuaScript({
  source: capturedEntry.source,
  document: capturedDocument,
  selection, range, fgColor, bgColor,
  signal: abortController.signal,
}, {
  wasmUri: '/runtimes/lua.wasm',
  plugin: {
    name: capturedPackage.name,
    displayName: capturedPackage.displayName,
    version: capturedPackage.version,
    preferences: validatePluginPreferences(capturedPreferences),
  },
  onCommand: async (catalog, { signal, requestId }) => {
    // Display data as text. No callback or source is supplied by the worker.
    // Resolve once with { action: 'run', commandId: '<enabled id>' }
    // or { action: 'cancel' }. Remove the chooser when signal aborts.
    return showPackageCommandPicker(catalog, { signal, requestId });
  },
  onDialog: showLuaDialog,
  isCurrent: () => editorAndPackageSnapshotStillMatches(),
});

// Atomically compare captured document + registry + preference revisions,
// then persist result documents and result.plugin.preferences together.
// Only after that succeeds install the result in the editor and history.
```

`plugin` and `onCommand` are trusted second-argument options. Adding them to script input or Lua `app.params` does not activate a package. A plugin option without an interactive command host is rejected before worker creation. The Node runner offers the same trusted options for tests/embedding; the CLI does not provide them and remains headless.

The command catalog has this data-only shape:

```js
{
  name, displayName, version,
  commands: [{ id, title, group, enabled, checked? }]
}
```

The picker is called exactly once per run with request ID `1`. Only a known, enabled command ID can resume the worker. The optional `group` is a display hint; this API does not insert native menu entries. The command catalog is capped at 32 commands and 64 KiB; command IDs are unique safe identifiers of at most 128 bytes, titles 512 bytes and group strings 256 bytes.

Successful results preserve the usual Lua document/transaction/selection/range/color result and add:

```js
plugin: {
  name, version, commandId,
  preferences,          // cloned, canonical, validated data
  preferencesChanged,  // recomputed by the host-side boundary
}
```

The worker never persists preferences or writes files. Embedders must compare the selected source entry and package identity plus document, package registry and preference revisions before starting, around interactive handoffs, and inside their final atomic persistence transaction. Workbench supplies synchronous `isCurrent` checks for editor state and wraps both UI callbacks with asynchronous `assertPackageRunCurrent` checks for stored package/preferences revisions. A cancelled, failed or stale run before the atomic commit leaves settings and artwork untouched. After the durable commit succeeds, the tracked editor installation finishes even if a native close prompt is pending.

## Supported Lua surface

The chosen contribution's top-level source runs, then `init(plugin)`. During init, `plugin:newCommand{...}` registers callbacks. After the host chooses a command, its `onclick()` runs in that same VM, retaining init locals and closures. `exit(plugin)` is called once after successful callback completion. Existing blocking Dialogs and `app.transaction` work in init, enabled/checked callbacks, the chosen callback and exit. Their waits share the existing per-wait and cumulative UI time budgets; active computation and all Lua hooks remain bounded.

Supported members:

- Read-only `plugin.name`, `plugin.displayName`, `plugin.version`.
- A mutable `plugin.preferences` table. Edit values in the table; replacing the table binding is unsupported.
- `plugin:newCommand{ id, title?, group?, onclick, onenabled?, onchecked? }`, only during init. `onclick` is required. Optional state callbacks must return booleans. Enabled/checked states are evaluated when constructing the catalog; the selected command's enabled state is checked again immediately before execution.
- An optional `exit(plugin)` function. It runs only after a successful chosen callback, before preferences are validated and returned.

Preferences are deliberately narrower than arbitrary Lua values: a top-level string-keyed table with nested plain objects or dense arrays, booleans, UTF-8 strings and finite numbers whose absolute values do not exceed JavaScript's maximum safe integer. Fractional numbers are allowed. Empty arrays normalize to empty objects because an empty Lua table has no distinct array kind. Assigning `nil` removes a preference key. `null`/undefined, functions, userdata, metatables, cycles, sparse/mixed-key arrays, invalid UTF-8/NUL strings, accessors, hidden/symbol properties and `__proto__`/`constructor`/`prototype` keys are rejected. Limits are 64 KiB serialized JSON, 4,096 values, depth 12, strings 16 KiB and keys 128 UTF-8 bytes. The exported validator makes an independent canonical copy suitable for validating stored preferences before worker creation.

Preferences are staged for the whole package run. `app.transaction` retains its existing document/selection/range/color rollback semantics; it does not separately roll back mutations to ordinary Lua tables such as preferences when a script catches an inner error. An uncaught error anywhere in the complete run discards all staged preferences and artwork together.

## Deliberate limits

This is an explicit single-command session, not Aseprite's application-long plugin lifecycle. It does not keep command callbacks or locals alive between runs, merge all contributions into one VM, run scripts on package import/startup, or call exit after cancellation/timeout/error. Aborting terminates the worker and no result is delivered. Preferences can persist between successful sessions only through the host's atomic commit.

`Plugin.path`, `newMenuGroup`, `newMenuSeparator`, `newFileFormat`, native menu insertion, keyboard shortcut registration, application events, modeless dialogs, timers, filesystem/network/process access, module loaders and arbitrary file exports remain unavailable. `app.command` and all artwork changes still use the existing validated shared engine; package scripts gain no export entitlement or Pro-gate bypass. An explicit unsupported-member error helps distinguish missing APIs from accepted behavior.

## Validation

`tests/lua-plugin-session.test.mjs` exercises the real Node Lua VM and the actual browser worker module through a worker-thread browser transport fixture. It checks same-VM closures and Dialog callbacks, the official Plugin count example, staged preferences across separate runs, cancellation and late replies, stale editor/package snapshots, command replays/forgeries, disabled callbacks, full preference byte limits, invalid Lua data, active instruction limits before/after suspension and standalone capability isolation. The official Plugin example was executed in PixelWall, not used as a claim of full native lifecycle equivalence. Existing Lua sandbox and export/file rejection tests remain in force.

`tests/aseprite-package-host.test.mjs` runs the actual Workbench package/installation functions with real Lua, IndexedDB and history, substituting React setters and the browser worker transport. It covers atomic document/preferences storage, different-window disable/replacement and preference conflicts, picker/Dialog cancellation, busy ownership and Undo. It also reproduces close requests during Lua, recovery and native-file durable installation, checks that existing operations complete consistently, and verifies that pending close prompts still reject new operations.

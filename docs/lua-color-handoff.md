# Lua foreground and background handoff

`runLuaScript` accepts optional `fgColor` and `bgColor` fields. Each must be a plain four-element array of integers from 0 to 255, in `[red, green, blue, alpha]` order. Omission keeps the prior opaque black/white defaults. Explicit `null`, CSS strings, packed integers, typed arrays, sparse arrays, fractional values and out-of-range channels are rejected before starting a worker. Inputs are copied.

A successful validated result always includes `fgColor` and `bgColor` in that same format. This includes a script with no document, no editing commands, or only color assignments. Alpha-zero RGB bytes are retained. Results are validated again and copied on the receiving side; worker colors cannot bypass the editor's result checks.

The worker initializes genuine Lua `Color` values from the supplied RGBA channels. `app.useTool` continues to use the current foreground when `color` is omitted. The getters return detached copies: edit a local `Color`, then assign it back to `app.fgColor` or `app.bgColor`. Explicit indexed Color assignments retain their palette index for drawing during the script; their final returned value is resolved RGBA. Grayscale packed constructors retain their existing gray/alpha semantics. The Color API also supports nearest palette lookup; arbitrary native tie breaking is not claimed identical. The RGBA-only UI contract does not preserve a palette-index selection across runs.

The script cannot publish color changes incrementally. Uncaught errors, timeouts, cancellation, validation failures and exhausted budgets produce no successful result. A caught failed `app.transaction` also restores staged foreground/background state along with document/selection/range state; nested transactions retain the correct outer values.

## Workbench integration

The Workbench captures the actual foreground and separate background colors in working-space RGBA alongside selection/range. It blocks other editing during Lua execution and validates the captured UI context before applying results. Colors become visible only after validation, atomic multi-document storage and the history commit succeed. Even a zero-command script records selection/color changes in history, and native Undo/Redo restores both colors and selection. The gradient endpoint remains a separate value.

Actual rebuilt Electron checks used a zero-command script setting foreground `#12345680`, background `#d2b48cff` and a 2×2 selection. One native Undo restored both prior colors and no selection, with unchanged artwork pixels.

## Independent Aseprite evidence and compatibility boundary

Official API sources: [app colors and transactions](https://www.aseprite.org/api/app), [Color constructors](https://www.aseprite.org/api/color).

`tests/fixtures/lua-ui-color-oracle.lua` is an original black-box probe, run against the self-built official Aseprite 1.3.18.5 source release (reported binary version `1.3.18.5-dev`, Lua 5.4.6). `lua-ui-color-oracle.json` contains the exact observed output and source checksum. No Aseprite implementation was copied.

The oracle confirms detached getter values and the indexed/grayscale channel values. It also shows that Aseprite leaves UI colors changed after a failed transaction. PixelWall deliberately rolls those staged colors back as part of the requested atomic UI handoff; this is a documented stronger rollback guarantee, not a claim of identical Aseprite behavior in that case.

Validation: 60 tests across the existing Lua adapter, authoring and browser-runner suites plus 12 new color-handoff tests. The added tests exercise the real Lua VM, color-only scripts, transparent colors, getter copies, tools, nested rollback, indexed/grayscale colors, malformed inputs/results, failure isolation and browser-boundary validation. Targeted ESLint passes.

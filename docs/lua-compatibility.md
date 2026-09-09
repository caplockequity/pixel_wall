# PixelWall Lua scripting compatibility

This adapter runs **real Lua 5.4.5**, embedded in pinned MIT-licensed `wasmoon@1.16.0`, in a fresh worker. It implements a documented subset of Aseprite's scripting objects using PixelWall's existing command engine. It is not full Aseprite scripting or extension compatibility.

## Integration

Browser:

```js
import { runLuaScript } from './lua-runner-browser.mjs';
const result = await runLuaScript({
  source, document, activeFrameId, activeLayerId,
  selection: null,      // optional canvas-size 0/1 mask
  range: null,          // optional {type,layerIds,frameIds,colors,sliceIds}
  params: {}, signal,
}, { wasmUri: new URL('/runtimes/lua.wasm', location.href).href });
```

Desktop uses its local `pixelwall://app/runtimes/lua.wasm` address. Browser WASM URLs must match the editor's scheme and host; no CDN fallback is used. The optional `createWorker` integration hook can supply a separately bundled module worker. Browser worker code must be bundled with Wasmoon and its dependencies; the bundler must avoid Node polyfills as described in [Wasmoon's primary documentation](https://github.com/ceifa/wasmoon#fixing-common-errors-on-web-environment).

Node:

```js
import { runLuaScript } from './lua-runner-node.mjs';
const result = await runLuaScript({ source, document, params: {}, signal });
```

For a distributed CLI bundle, the second argument can provide trusted `{workerUrl, wasmUri}` paths. `workerUrl` is a URL to the separately bundled Node worker entry; `wasmUri` points to the bundled `lua.wasm`. The source checkout uses installed Wasmoon's WASM automatically. A single-file CLI bundle alone does not include the worker automatically. These runtime paths are host configuration, never Lua script parameters.

The result is data only:

```js
{
  format: 'pixelwall-lua-result', version: 1,
  document,             // active output document, or null
  documents,            // original plus any newly created sprites
  created,              // engine-created starting documents for new sprites
  transactions: [{ documentId, label, commands }],
  active: { documentId, frameId, layerId },
  selection: null,      // final canvas-size 0/1 mask, or null
  range: { type: 0, layerIds: [], frameIds: [], colors: [], sliceIds: [] },
  fgColor: [0, 0, 0, 255], bgColor: [255, 255, 255, 255], // working RGBA
  prints: ['captured output'],
  stats: { calls, commands }
}
```

Both runners replay the returned command transactions through the shared engine and verify they produce the returned documents. **Before applying a result, the UI/CLI host must verify the original document/revision still matches the snapshot passed to the runner**, then install/commit the result atomically through the normal editor history path. A failed/cancelled run returns no editable result and never mutates its input. Do not blindly replace current artwork if it changed while the worker ran. Scripts may create up to eight sprites; a one-document UI must explicitly preserve/select those documents or reject multi-document output.

The Workbench commits initial and final selection/range/foreground/background state alongside the document in the same history action. It checks the original document, revision and UI context before dialogs, after responses and before committing, saves all output documents atomically, and retains session Undo when changing project tabs. Selection-only scripts can have an empty document command log; their selection result still needs to be applied and made undoable. Attached selection and range state rolls back when `app.transaction` fails. Detached `Selection` objects remain independent temporary values.

No export occurs in the worker. `saveAs`, `SaveFileAs`, `ExportSpriteSheet`, file loading and other export commands fail explicitly. Export the accepted result through PixelWall's existing entitlement-checked interface; GIF, atlas and game-package exports still require Pro.

## Implemented API

| Surface | Supported subset |
| --- | --- |
| Lua | Lua 5.4 syntax, bitwise operators, functions, loops, tables, protected calls; selected base, math, string, table and UTF-8 libraries |
| `app` | `sprite/frame/layer/cel/image` and legacy `activeSprite/activeFrame/activeLayer/activeCel/activeImage`; setting active sprite/frame/layer; `sprites`, `params`, `fgColor`, `bgColor`, `isUIAvailable` (true only with the interactive editor host), `refresh`, `transaction`, `useTool`, `command`; `range`; adapter-specific `pixelwallApiVersion=1` |
| `Sprite` | `Sprite(width,height[,ColorMode])`, `Sprite(spec)`; width/height/bounds/spec/colorMode, frames/layers/cels/palettes, identity/validity, filename as the portable document label; new/delete raster layers and groups, new/copy/delete frames, new/delete cels, setPalette, nearest-neighbor resize; indexed transparentColor; selection, tags/slices collections and new/delete Tag/Slice operations; native data/color/properties |
| `Layer` | name, opacity (0–255), visibility/editability, blend mode, parent, sibling stack index, image/group/reference/tilemap flags, child layers and cels, `cel(frame)`; native data/color/properties |
| `Selection` | Empty/rectangle construction, bounds/origin/isEmpty, contains, select/selectAll/deselect, union/add, subtract, intersection; off-canvas bounds, assignment copies, live sprite selection reference; selection restricts app.useTool and Clear |
| `Range` | type/isEmpty/sprite, frames/layers read/write, cels/images/editableImages, colors/slices read/write, contains/containsColor/clear; linked images deduplicated; images in locked ancestor layers excluded from editableImages |
| `Tag` | sprite, fromFrame/toFrame (read/write), frames count, name, aniDir, repeats, data/color/properties; insertion inside tag boundaries keeps frame ranges contiguous |
| `Slice` | sprite/name, bounds, center/pivot or nil, data/color/properties; default slice has no bounds. As in Aseprite 1.3.18.5, these properties address the first-frame key, regardless of app.frame, and preserve later moving keys |
| `Properties` | User table and extension namespace getters/setters, replacing a namespace, nil deletion, pairs iteration; native maps store booleans, exact finite numbers, UTF-8 strings, vectors and nested maps; Sprite/Layer/Cel/Tag/Slice/Tileset/Tile |
| `Frame` | 1-based frameNumber; seconds-based duration; sprite, previous/next. Frame handles follow frame numbers across insertion, matching the documented Aseprite behavior. |
| `Cel` | sprite/layer/frame/frameNumber/image/position/bounds/opacity/zIndex; image replacement, position/opacity/drawing-order edits and moving to another frame; native data/color/properties retained across pixel flush/replacement |
| `Image` | `Image(width,height[,mode])`, `Image(spec)`, image-spec table, image copy/crop, rendered first frame of Sprite; clone, clipped clear, getPixel/drawPixel/putPixel, callable `pixels()` iterator, packed bytes, nearest resize, flip, drawSprite, drawImage/putImage with opacity and supported blends, shrinkBounds, isEmpty/isPlain/isEqual, dimensions/spec/color mode/numeric ID/version/rowStride/cel. See [Image and Color details](lua-image-color.md). Attached image writes preserve existing linked cels. |
| `Color` | RGB, grayscale, indexed and HSV/HSL constructor tables; packed-pixel constructor follows active sprite mode; mutable RGBA, gray/index and retained HSV/HSL components; packed pixel reads and active-frame palette lookup. RGB-to-gray follows Aseprite HSL lightness. Arbitrary nearest-index tie breaking is not claimed identical. |
| `app.pixelColor` | rgba, rgbaR/G/B/A, graya, grayaV/A with Aseprite packed channel order |
| `Point`, `Size`, `Rectangle` | Positional, table and copy constructors; aliases, arithmetic/equality; Rectangle origin/size, contains, intersection/union and isEmpty |
| `Dialog` | Blocking editor dialogs with entry/number/slider/check/combobox/color/button/label/row/separator controls; Lua button callbacks and data/close. The same VM waits and resumes. See [dialog support and limits](lua-dialogs.md). |
| `Plugin` | Explicit installed-package command sessions: `init(plugin)`, `newCommand`, enabled/checked callbacks, one selected command and successful `exit(plugin)` in the same VM; bounded preferences committed atomically with artwork. Package import remains inert. See [package sessions](lua-package-sessions.md). |
| `Tileset`, `Tile`, `Grid` | Sprite tileset collection/creation/copy, native tile insertion/deletion, layer tileset assignment, zero-based tile access, live tile image editing/replacement, tileset name/base index, tile/tileset data/color/properties, grid bounds and unused-tileset deletion. See [tile scripting](lua-tileset-compatibility.md). |
| `ImageSpec` | Detached dimension/mode/mask/profile values and equality; Image and Sprite allocation, owner spec copies and transient image profiles. See [image specifications](lua-image-specs.md). |
| `ColorSpace` | Detached None/sRGB/copy values, names and equality; sprite profile assignment and ICC conversion through validated commands. See [color spaces](lua-color-spaces.md). |
| `Palette` | Sized and copy construction, `#palette`, resize, zero-based getColor/setColor; attached palette edits map to shared-engine palette updates |
| `app.transaction` | Optional label, nested transactions, command grouping, document rollback on Lua errors; detached temporary image edits remain standalone, as documented by Aseprite |

Supported `app.command` names are **NewLayer, NewFrame, NewEmptyFrame, RemoveFrame, RemoveLayer, MergeDownLayer/MergeDown, DuplicateLayer, ClearCel, UnlinkCel, SpriteSize, CanvasSize, ChangePixelFormat, SelectAll, Deselect, InvertMask, Clear**. Supported parameters are deliberately narrow and unknown parameters fail instead of being silently ignored. `SpriteSize` supports nearest-neighbor only. `ChangePixelFormat` uses PixelWall's shared converter; it does not claim every Aseprite quantization/dither mode.

`app.useTool` supports **pencil, eraser, line, rectangle, filled_rectangle, ellipse, filled_ellipse and paint_bucket**, with explicit points, color, layer/frame, opacity and applicable tolerance/contiguous parameters. The shared engine determines rasterization; this is not a claim of pixel-identical rendering for every Aseprite tool variant.

## Missing APIs and limits

Not implemented: persistent plugin/event registration, native menu integration, modeless/advanced Dialog widgets, timers, application preferences, clipboard, file access, sockets/network, process/environment access, Lua package loading, `app.open`, `app.exit`, arbitrary commands, tools beyond the listed subset, application undo/redo history, range.tiles, tilemap Image pixel APIs and tilemap newCel authoring, Image graphics context/saveAs/non-nearest resize/nonzero pivots and unsupported cross-mode fitting, sprite copy constructors, Sprite crop/close, advanced palette operations, arbitrary ColorSpace file loading and direct image-level profile mutation/conversion, typed property Point/Size/Rectangle/UUID values and integers outside the exact JavaScript range, background-layer special editing semantics, and the remaining Aseprite APIs. Unsupported property/method access produces an explicit compatibility error. Existing unsupported native property bytes remain untouched until access/edit is requested, which fails explicitly rather than reinterpreting the value. Property maps are bounded to 1 MiB, 16,384 values, 24 nested levels and native 65,535-byte strings. Fractional export scaling and advanced Aseprite animation/subtag traversal are separate engine/export concerns; scripting parity is not implied for those.

The adapter reports its own `app.pixelwallApiVersion`; it does not spoof Aseprite's `app.apiVersion` or application version.

Default per-run bounds:

- Selection areas are bounded to 1,048,576 pixels and cumulative mask allocations to sixteen times that count. Sparse masks whose bounding rectangle exceeds this budget are rejected.
- 256 KiB Lua source; 16 KiB JSON params.
- 3 seconds cumulative active execution time, configurable 50–10,000 ms; the owning thread forcibly terminates a hung worker. Validated dialog waits have a separate 120-second per-response / 300-second total budget.
- 100,000,000 Lua instructions, configurable 1,000–500,000,000; an inaccessible VM hook enforces the count.
- 32 MiB Lua allocation cap; Node worker additionally has 128 MiB old-generation / 16 MiB young-generation limits.
- 1,048,576 stored pixels per sprite; cumulative temporary allocations are bounded to four times that count; eight sprites; 250,000 API calls; 4,096 commands; 32 MiB output and command payload; 32 KiB captured logs; nesting limits for transactions and serialized values.

A 256×256 loop that writes every pixel completed in about two seconds on the development Mac. Slower machines may need a larger user-selected wall-time allowance. These bounds intentionally reject some large Aseprite scripts.

The Lua environment omits `io`, `os`, `package`, `require`, `load`, `dofile`, `loadfile`, `debug`, `coroutine`, dynamic JS/proxy objects and host globals. Scripts receive pure Lua objects; the hidden bridge accepts/returns JSON strings and dispatches a fixed set of operations. The VM's allocator and worker termination provide separate memory/time controls. This is a constrained scripting surface, not a claim of an independently audited general-purpose hostile-code service.

## Verification and provenance

`node --test tests/lua-adapter.test.mjs tests/lua-authoring.test.mjs tests/lua-browser-runner.test.mjs` exercises the real Wasmoon VM in Node workers: language syntax, active aliases, drawing/pixel iteration, frame/layer/cel operations, linked images, palette/indexed transparency, transaction/nested rollback, source-over compositing, capability denial, resource limits, cancellation, repeat-run IDs and receiving-side command replay. Browser-wrapper tests use a controlled worker double and the production browser worker through a Node transport. Actual rebuilt Electron checks additionally passed ordinary scripts, selection/range/color handoff, two interactive dialog callbacks retaining local variables and decimal input, cancellation with no commit, and native Undo of the complete script. Explicit package command selection, disabled-command handling, same-VM Dialog/exit, preference persistence across Undo and another run, and cancellation also passed in the rebuilt desktop. Signed release/installer coverage remains separate.

The fixture `tests/fixtures/lua-oracle-semantics.lua` was run through the locally built official Aseprite **1.3.18.5-dev** executable and through this adapter. Initial image/cel creation, explicit and default newFrame insertion, newEmptyFrame insertion, image defaults, independent newCel copies and gray conversion agree for those cases. This is narrow differential evidence, not general API parity.

The original `lua-authoring-semantics.lua` fixture also produces identical printed results in Wasmoon and the official Aseprite oracle for selection references/copies, range types, tags, slice first-key semantics and native property maps. Aseprite independently reopened the adapter's exported Sprite/Layer/Cel/Tag/Slice user properties and extension namespace. Native source-fixture property decoding, malformed input, locking, transaction rollback, scope handoff and all preceding tests pass (48 Lua tests at this revision). The bundled engine is Lua **5.4.5**; the oracle embeds **5.4.6** and reports API 41. This is API-behavior comparison, not an exact runtime patch-version claim.

See [Lua API coverage inventory](lua-api-coverage.md) for the remaining surface areas.

Primary references:

- [Wasmoon README/API](https://github.com/ceifa/wasmoon), [Wasmoon MIT license](https://github.com/ceifa/wasmoon/blob/main/LICENSE).
- [Official Aseprite scripting API](https://github.com/aseprite/api) at locally pinned API docs revision `662b12efe00fd374909bc3a0e9cce5d0d0d35d63` (MIT documentation): Sprite, Image, Color, Point, Rectangle, Palette, Layer, Frame, Cel, app and pixelColor pages.
- Official Aseprite source oracle **1.3.18.5-dev**; source was consulted to resolve RGB-to-gray lightness semantics. No Aseprite application source was copied into this adapter.

Distribution must include the required third-party Wasmoon/Lua notices alongside the bundled WebAssembly asset. Package/dependency and runtime-copy integration are owned by the host build and are intentionally outside this patch.

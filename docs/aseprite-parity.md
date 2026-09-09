# Aseprite replacement work

Target: a broad replacement for Aseprite, including scripting and color management. This is an implementation and verification ledger, not a claim of complete compatibility. The independent reference is the locally compiled official Aseprite 1.3.18.5 release. PixelWall does not ship the Aseprite application. Its rotation and playback components adapt the separately MIT-licensed Document Library algorithms, with required notices included.

## Confirmed defects fixed

- Desktop close requires a successful recovery save and a stable document revision. Native files additionally require successful writes for every bound document, including inactive documents. Cancelled, failed, timed-out and stale saves keep the window open unless the user explicitly chooses Close without saving.
- Native macOS Undo and Redo call the editor history for artwork and the text editor's history for text fields. Command batches and Lua runs are single artwork transactions.
- Indexed conversion uses each frame's effective palette and transparent index, preserves background colors, and separates linked images when palette changes require different colors. Drawing, fills, sampling, tiles and remapping use the same contextual colors.

Actual macOS checks used a rebuilt development app and a separate test profile. New/repeated Save, native Open, Aseprite Save As, external-change protection, Cancel/Keep editing, native menu Undo after Lua, and four-frame indexed-to-RGBA pixel preservation passed. Unit tests additionally exercise disk errors, missing storage, close timeouts and revision races. These checks do not establish installer/file-association behavior for an unreleased signed build.

## Implemented and independently checked

| Area | Current behavior | Evidence and limits |
|---|---|---|
| Native rendering | Indexed/grayscale/RGBA, linked cels, groups, opacity, blend modes, tilemaps, slices/tags and z-order | 41 native fixtures render exactly; 9,728 captured color/opacity probes plus 2,299 gray endpoint probes match Aseprite. This is a defined corpus, not exhaustive equivalence. |
| Color profiles | ICC assignment/conversion, fixed gamma, RGB/gray profiles, alpha retention, managed canvas/thumbnails/swatches/tile preview, PNG import and rendered export to sRGB; Lua ColorSpace assignment and conversion | LittleCMS 2.16 through pinned lcms-wasm; all 17 independently generated ICC color samples exactly match Aseprite. The raw codec returns working values and profile metadata; callers explicitly convert. CMYK workflows and application-level soft proofing are not provided. |
| Palettes and tiles | Effective frame palettes, palette scopes, indexed shading ramps, Manual/Auto/Stack editing, linked variants, cleanup of newly unused Auto tiles; user-selected external source resolution and embedding | Core color-context/layer/tile suites and independent native tileset fixtures; all eight rectangular native orientations match through import, edit, native reopen and interpreted Tiled game export. Actual desktop embedding and Undo passed. External paths are never followed automatically; grid/mode/profile restrictions are explicit. |
| Indexed conversion options | Existing palettes or generated global median-cut/Octree/RGB5A3 palettes; two mapping families, five fitting criteria, ordered variants, diffusion, strength and alpha controls | 118 native algorithm jobs match palette and stored indices; 134 independently reopened native-file frames match. Document-wide remap semantics deliberately preserve contexts and opacity. See [algorithm contract](native-indexed-conversion.md). Original desktop conversion/Undo passed. |
| Rotation | Fast and RotSprite algorithms, explicit UI choice, indexed slot identity, alpha, masks and clipping | 338 native integer-corner outputs match; bounded memory and atomic rejection. Aseprite UI angle/pivot rounding remains unverified. |
| Layers | Merge down across supported sibling types, rasterize groups/tilemaps, flatten visible content while retaining hidden roots | Rendering and locked-layer regression coverage. Backdrop-dependent blend behavior follows the defined merge model. |
| CLI exports | Multiple inputs, nested layer filters and splits, tags/ranges/slices, filename templates, trim/padding/scale, sequences and JSON array/hash metadata | 13 Aseprite reference jobs / 37 frame entries match pixels and applicable names/timing/crop metadata. PixelWall's atlas packing coordinates differ. Explicit `--ordered-inputs` adds persistent selector scopes verified against 22 native cases while preserving the existing global default. Fractional UI/CLI scaling now matches 130 independent native cases, including cel/tile geometry and default reference-layer omission. Explicit --play-subtags now follows verified native directions/repeats/nested tags, with bounded output. Grid sheet/atlas/ZIP export is implemented with saved/explicit grids, safe cell names, scope selectors and source metadata; see [grid export](cli-grid-export.md). Ordered scale operations and final crop regions are implemented; see [ordered transforms](cli-ordered-transforms.md) for explicit scope and tilemap limits. |
| Animation traversal | Stateful native tag playback, finite directions/repeats/subtags, editor Repeats control and explicit CLI --play-subtags | 1,220 independent native state-machine cases plus native CLI frame/timing vectors. Selected CLI tag scopes crossed by another tag are rejected; UI uses contained subtags. |
| Native desktop files | Narrow sandbox bridge, Open/Save/Save As, editable project/Aseprite formats, durable file bindings, atomic writes and external-file checks | Main/renderer/IPC regression suites and actual macOS checks. Existing-file replacement has the platform's unavoidable final check/rename race against another process. |
| Lua | Real Lua 5.4.5 worker; authoring through supported Aseprite objects and commands; transactions, cancellation, time/memory bounds; browser/desktop/CLI/agent entry points | See [Lua compatibility](lua-compatibility.md). Reference Aseprite embeds Lua 5.4.6. Missing APIs fail explicitly. Full API version 41 compatibility is not claimed. |
| Extension packages | ZIP import, palette use, Lua source access, explicit package command sessions with preferences, original asset downloads, replace/disable/remove | See [package compatibility](aseprite-extensions.md). The same VM runs init, one chosen command, blocking dialogs and successful exit; preferences commit atomically with artwork. Persistent plugins, native menus, themes/languages and shortcut activation remain incomplete. |
| Script persistence | All modified browser documents saved in one IndexedDB transaction; batch CLI output preflight, staging and rollback for newly written files | Storage budget/conflict regressions and CLI overwrite/collision tests. Unexpected process/power failure during multi-file CLI installation is not a filesystem-wide transaction. |
| Script UI and history | Blocking dialogs retain the same Lua VM; common controls and button callbacks; selection/range/foreground/background handoff and session history across project tabs | Actual Electron tests: two callbacks retain locals and decimal input, one native Undo reverses the completed script, Cancel discards staged edits. Modeless dialogs and advanced widgets remain open. |
| System image clipboard | Desktop/browser Copy/Cut/Paste with explicit internal-copy action, working-profile conversion and stale-context checks; text fields retain native text behavior | Bounded image bridge and trusted one-use write reservation; failed or revoked Cut never removes pixels. Native cross-application/profile/platform checks remain limited; see [clipboard details](native-image-clipboard.md). |

## Remaining acceptance work

Broad replacement remains open. Major gaps include Aseprite UI angle/pivot rounding, the complete Lua object/command and UI plug-in API, automatic external-file workflows beyond explicit source embedding, additional native quantization edge cases and extension matrices, advanced typography, clipboard interoperability beyond bounded image transfer, movable/saved workspace equivalence, additional format variants, and the remaining CLI cases above. Fast/RotSprite now match 338 independent native integer-corner outputs; another 72 checks cover the editor angle-to-corner contract. This does not establish identical Aseprite UI drag geometry. See [rotation scope and limits](rotation.md).

The full domain checklist and pinned 634-entry API inventory are retained in the dated audit output. Each remaining claim needs an independent import → edit → save/export → reopen check, with rollback/history where applicable. Public documentation must distinguish supported workflows from complete parity.

## Verification commands

- `node --test tests/*.test.mjs`
- `npm run lint`
- `npm run build` (Sites)
- `npm run build:vercel` (Next/Vercel)
- `npm run build:standalone` and `npm run package:downloads`
- Rebuilt desktop smoke tests and isolated CLI/Lua runtime checks

Runtime source versions and required notices are packaged with every downloadable runtime. See [engine notices](runtime-engine-notices.txt). Public release/deployment is a separate step after the integrated builds pass.

## Release presentation

Customer-facing pages, editor labels, release notes and announcements describe PixelWall on its own merits. Do not use competitor names or comparison positioning. Keep technical file identifiers and required third-party license notices intact. The file guide is `/guides/file-compatibility`; the former URL redirects there.

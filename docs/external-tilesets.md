# Resolve an external Aseprite tileset

`app/external-tilesets.mjs` embeds a tileset from a source document explicitly chosen by the user. It is a pure operation over two documents already in memory. It performs no file, URL, network, or host access and never interprets the external resource filename as a path.

## Host integration

1. Call `listExternalTilesets(document)` to show unresolved links, including those with an embedded fallback. Treat `sourceLabel` as plain informational text. Offer **Choose source file and embed** for the selected tileset.
2. Open the host's local file picker. Read only the file the user selected and parse its Aseprite bytes with `readAseprite(bytes).document`. Keep its original color mode and native working profile. Do not search neighboring folders, automatically follow the resource label, or recursively resolve another external link.
3. Resolve against the current destination document with `resolveExternalTileset(document, { tilesetId, sourceDocument, colorManager })`. Pass the existing synchronous color manager; `intent` defaults to 1 (relative colorimetric). A stale document revision or closed document should cancel the host operation before applying its result.
4. Commit `result.document` as one undoable history action. Preserve active frame, layer, selection, and timeline selection because their IDs and geometry are unchanged. Repaint all frames using the shared tileset. There is no new engine command or automatic save/export. Existing export licensing remains at the caller.

The returned `resolution` contains the destination ID, chosen source editor/native ID, external registry ID, informational source label, final tile count, `convertedColors`, and `usesDestinationPalette`. Show helper errors as the operation's failure; the inputs remain unchanged.

## Preserved behavior

The helper selects exactly the declared **native tileset ID**, regardless of its name, order, destination ID, or external registry ID. It validates every referencing animation frame, including linked cels and hidden layers. Native map values and transform masks remain untouched. Destination names, native IDs, base index, zero/legacy-empty semantics, matching flags, layer properties, frame palettes, durations, links, and user metadata remain attached to the destination.

It clears the external-link flag and sets the embedded flag. Replaced atlas images are collected only when no other cel/tileset still references them. External registry records remain for other references and opaque metadata. Existing editable tile IDs are retained by native index, so edited map cells continue working. Any referencing layer or ancestor group lock blocks the replacement.

RGB and grayscale samples keep their values when the working profiles match; otherwise the supplied color manager converts source samples into the destination working profile once per unique color while preserving alpha. Fully transparent samples retain the engine's canonical `null` representation. The destination working profile stays unchanged.

Indexed tiles retain their literal indices and intentionally use the **destination's effective per-frame palettes**, as native tilemaps do. Source palette colors and profiles do not repaint the destination palette. Source and destination must agree on the transparent index; every destination frame must contain all used indices.

## Explicit limits

- Source and destination must use the same raster color mode and tile grid. Convert/save the source explicitly before resolving an incompatible pair.
- The selected source must contain the declared native tileset with complete embedded pixels and native IDs. Another unresolved external resource is not followed; an existing embedded fallback in the source is usable.
- A source may contain extra tiles, but cannot omit any destination-declared or referenced native tile. Edited tiles without native IDs must be saved/re-imported before resolution.
- The source atlas and resulting document must fit existing image dimensions and stored-pixel limits. The helper uses the native vertical atlas layout.
- A differing RGB/gray profile requires the existing color manager. A conversion producing colored samples for a grayscale document is rejected; convert that document to RGBA first.
- This is an explicit **embed** operation, not a continuously linked external asset or automatic resource watcher.

## Independent validation

Original RGB and indexed fixtures were authored with the official Aseprite 1.3.18.5-dev Lua API. Each has two tilesets, a signed-capable display base index, asymmetric artwork, all three native map transforms, and two animation frames. The original Python fixture transformer follows the [published native file specification](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md) to create the external-only pair and deliberately different source/destination/registry IDs (91/47/19). Both fixtures and expected native render hashes are checked in as base64 data.

All four resolved frame renders matched the original embedded Aseprite reference byte for byte. The helper's embedded exports were also independently reopened and rendered by Aseprite with the same results. The tested Aseprite batch build opened the external-only fixture but left its tiles blank even with the named source alongside it, so automatic external-resource resolution by Aseprite is **not** claimed. The comparison reference is the original Aseprite-generated embedded artwork.

The focused tests also cover same-profile grayscale native roundtrip, real LittleCMS conversion with partial alpha, per-frame indexed palettes, zero/legacy-empty semantics, all-frame missing references, locks, malformed manager results, mismatched modes/dimensions/IDs, embedded fallback replacement, shared-image retention, and subsequent tile editing.

To recreate fixtures, run `external-tileset-source.lua` through Aseprite batch with `mode=rgba` then `mode=indexed`, saving `<mode>-source.aseprite` into a temporary directory. Run `python3 tests/fixtures/external-tileset-fixture.py <directory>`. Aseprite's Lua `Image:drawSprite` with `ColorMode.RGB` can then capture original and embedded-result pixels. The committed automated suite does not need an Aseprite installation.

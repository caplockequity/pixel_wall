# Rendered export color

Rendered exports composite the selected layers using the document's working profile, convert the completed straight-alpha RGBA frame to sRGB, then crop, scale, quantize or pack. Converting each editable cel first changes translucent overlaps: in the linear RGB fixture, half-transparent white over black becomes sRGB188, while converting cels before compositing produces sRGB128.

`app/export-render.mjs` is a pure helper. It loads no runtime, does no I/O and changes no document data:

```js
const rendering = { colorManager, intent: renderingIntent };
const rgba = renderExportFrame(document, frameId, rendering);
const standaloneTileRGBA = toExportRGBA(tileRGBA, document, rendering);
```

An sRGB document needs no color manager. A custom-profile export throws a clear error without one. Alpha is retained exactly. An optional `blackPointCompensation` defaults to true, matching the existing display manager.

`planExport(inputs, options, rendering)` and `buildCliExportOutputs(inputs, args, rendering)` accept the same dependency object as their third argument. The CLI loads LittleCMS once when any input requires it, after the paid-export license check. The `render` command follows the same composite-first route. Explicit `profile --convert` remains an editable-cel operation; `.pixelwall`, JSON, and `.aseprite` output retain the original profiles, layers and pixels.

`makeGamePackage(document, { ...rendering, entries, atlas, projectDocument })` treats supplied entries/atlas as already-converted sRGB assets and does not transform them twice. It converts default rendered frames and every standalone tile PNG, including frame-palette variants. `projectDocument` is optional and defaults to `document`; supply the original project when `document` is a temporary visibility-filtered scope. That keeps native artwork and visibility intact while rendered assets use the selected layers.

Tiled maps keep editable tile references and blend/opacity metadata. Tile PNGs are sRGB. An external renderer can composite overlapping translucent tiles in a different color space, so the manifest explicitly directs users to the rendered frames or atlas when they need the exact original composite. This is a representation limit of separate tile images; the native project retains all original data. GIF retains its existing binary-alpha and palette limitations.

## Workbench integration

The patch intentionally leaves `app/workbench.jsx` to its owner. In `generateArtwork`:

1. Keep `source` as the original immutable project and keep the current layer/reference visibility filtering in `current`.
2. After the access check, replace the `convertDocument(current, 'sRGB')` block with a rendering dependency: load the browser color manager only for a non-sRGB rendered format; set `{colorManager: manager, intent: renderingIntent}`.
3. Replace each `renderFrame(current, frameId)` in the PNG, BMP, TGA, GIF, sheet and ZIP branches with `renderExportFrame(current, frameId, rendering)`. Retain resizing and packing after that call. Import the helper from `./export-render.mjs`.
4. Call `makeGamePackage(current, { ...rendering, entries, atlas, projectDocument: source })`. This also converts raw tile assets and preserves the complete native project.
5. Keep project/Aseprite exports and the explicit Convert colors command on their existing native-document paths. No imported-image conversion or color-cache changes are needed.

## Independent reference

`tests/fixtures/export-color` contains original CC0 input pixels, an independently generated ICC profile, the Lua fixture script, and expected Aseprite-produced output. Eight black/white alpha combinations cover both opaque and translucent composites. The test compares every byte of source-space compositing and final sRGB pixels, checks the old ordering's known failure, and exercises PNG/BMP/TGA/GIF/sheet/atlas/ZIP plus real CLI/native output. Tile tests include native Aseprite round-trips and animated indexed palettes.

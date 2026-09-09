# Rectangular tile backdrop clearing

Diagonal flags on a rectangular tile transpose the coordinates within the existing tile grid. Pixels that fall outside the resulting source bounds replace the destination RGBA with zero. They do not behave like ordinary transparent tile pixels, which leave underlying artwork visible. Clockwise quarter-turn mapping remains unchanged.

The renderer now applies this rule to raw native maps and editable canonical maps. Clearing occurs even with zero cel or tile-layer opacity and fully transparent tile artwork. Hidden layers remain hidden. Clearing stays within the clipped destination tile rectangle. Isolated groups clear their own intermediate image and then composite that group over its parent normally; group opacity and blending remain intact.

Export scaling previously baked oriented tiles into plain raster pixels. That discarded the distinction between a transparent source pixel and a pixel that erases the backdrop. Temporary export tiles now carry a private symbol-keyed byte mask, used only during rendering. It survives the existing bounded strip renderer but is excluded from serialized project data. Editable native exports continue to use the original document and flags. Do not serialize a temporary scaled render document as an editable project.

The game package's tile images and flip flags cannot represent this backdrop erasure. Packages containing diagonal rectangular cells report that limitation. Their rendered frames/atlas include the correct composite, and the original editable project retains the source tile data. This conclusion follows the [global tile-ID representation](https://doc.mapeditor.org/en/stable/reference/global-tile-ids/) and [JSON layer representation](https://doc.mapeditor.org/en/stable/reference/json-map-format/); it is a limitation of this tile-image/GID export, not a claim about custom renderer extensions.

## Validation

The original seven-pixel 32×17 reproduction now matches its native RGBA reference exactly. The dedicated fixture contains 96 original source sprites and 192 independent native RGBA captures. It covers RGB, grayscale and indexed storage; 2×3 and 3×2 tiles; all eight flip combinations; normal, zero and partial cel/layer/group opacity; multiply/screen blending; transparent tiles; hidden layers; negative/edge clipping; isolated groups; overlay artwork; and fractional scales 0.5, 0.75, 1.5 and 2.25.

The native batch fixture explicitly enables isolated group composition. Native default pass-through group behavior is not changed or claimed by this patch. Tests compare raw and canonical rendering, editable export roundtrips, temporary scaled tiles, and packaged rendered frames. The renderer's source input remains unchanged.

## Reproducing the fixture

Use the verified native 1.3.18.5 batch build (API 41), with a temporary output directory. The helper files live under `tests/fixtures/tile-backdrop-clear/`.

1. Run `generate.mjs` with the absolute temporary output directory.
2. Run the native app in batch mode with `--script-param manifest=/absolute/temp/manifest.json --script /absolute/project/tests/fixtures/tile-backdrop-clear/capture.lua`.
3. Repeat the batch call with `scaled.lua`.
4. Run `pack.mjs` with the captured manifest path and an explicit output JSON path; compare it with `cases.json`.

All generated artwork and fixture scripts are original CC0 test material. Renderer source was consulted to understand behavior; no upstream implementation was copied into the patch.

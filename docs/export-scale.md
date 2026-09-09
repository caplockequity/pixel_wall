# Export scale and geometry

CLI rendered exports accept any finite positive `--scale` up to 64, including `0.5`, `0.67`, `1.5`, and `2.2`. Scale 1 is the default. Canvas dimensions are truncated after multiplication and stay at least one pixel. Existing integer raster magnification remains nearest-neighbor pixel replication.

```
pixelwall render hero.aseprite --scale 1.5 --out hero.png
pixelwall export hero.aseprite --format png --scale 0.5 --out hero-small.png
pixelwall export hero.aseprite --format atlas --scale 1.5 --out hero.png --license license.txt
pixelwall export hero.aseprite --slice hitbox --scale 1.5 --format png --out hitbox.png
```

Fractional export resizes cel geometry before compositing. The actual horizontal and vertical ratios are the rounded output dimensions divided by the original dimensions. Cel positions truncate toward zero; each ordinary cel image truncates its dimensions (minimum one pixel) and resamples locally with nearest-neighbor. Linked cel images stay linked in the temporary render document. Indexed values, frame palettes, grayscale values, layer opacity, and embedded profiles remain in their working representation until composition. The composite converts to sRGB afterward.

Native tile spacing truncates, but its tile bitmap dimensions round before nearest-neighbor resampling. Temporary tile variants preserve that distinction and apply the native flip rules. Rectangular diagonal flips transpose integer pixel positions and clip outside the bitmap, rather than stretching the tile. The same correction applies to CLI integer tile exports. The temporary variants do not replace original tiles or tilemap data in the saved project.

Slice rectangles resize their two endpoints; pivot coordinates truncate and center rectangles resize their endpoints. A slice collapsing to zero size yields no output for that frame. Crop coordinates remain in original source coordinates (the established PixelWall CLI convention), and fractional cropping uses their resized endpoints. Metadata includes the original `source.crop`, requested `source.scale`, and fractional `source.scaledCrop`, with transformed slice metadata and original `meta.sourceSlices`. This crop convention is not Aseprite's immediate, order-sensitive `--crop` operation. `--scale` remains an output-wide PixelWall option even under `--ordered-inputs`; it does not emulate Aseprite's immediate mutation of already-open documents.

Reference layers are omitted from CLI rendered output by default, matching native Aseprite exports. `--include-reference-layers` explicitly includes them. The flag is global and applies to both `render` and planned exports. The temporary fractional representation preserves their bitmap resolution and scales their precise display bounds.

```
pixelwall render reference-study.aseprite --include-reference-layers --scale 1.5 --out study.png
```

Native `.aseprite` and PixelWall project exports remain the original editable document. Game ZIP projects and standalone tilemap assets also retain original native geometry; only their rendered frame/atlas assets use the requested frame scale. Existing ZIP `frameScale`/`tilemapScale` metadata records that distinction.

Limits: requested scale must be greater than zero and no larger than 64; rendered output and newly allocated cel/tile pixels each have a 64-million-pixel budget. Existing aggregate export frame/padding limits remain in force. Oversized export surfaces render in bounded viewport tiles without relaxing editor canvas limits. Excessive geometry fails before allocating the rejected image.

## Independent verification

`tests/fixtures/export-scale/manifest.json` records original CC0 origins, native version, official source URL, method, and SHA-256 hashes. No Aseprite implementation or executable is distributed. `generate.mjs` requires an independently available Aseprite binary through `ASEPRITE_ORACLE`.

The corpus has 130 native output cases at eight scales. It includes 432 independently positioned/resized raster cel cases, negative/off-canvas offsets, genuine linked cels, indexed palette changes, grayscale, partial alpha, an original linear ICC profile, moving positions, slices with center/pivot, trimming, reference omission, tile placement, and all eight tile flip combinations. PNG expectations are produced directly by native `--scale` followed by export. This matters for fractional tilemaps: saving and reopening a native file can crop in-memory rounded tile bitmaps to the truncated tile grid, so that roundtrip is not used as the pixel oracle. Serialized files independently verify the durable cel/slice/grid geometry. The custom-profile expected PNG uses native composition in the working profile followed by sRGB conversion, matching PixelWall's explicit rendered-export convention.

Tests also cover canonical PixelWall tilemaps against those independent native pixels, formats PNG/BMP/TGA/GIF/sheet/atlas/ZIP, source-project preservation, actual CLI calls, reference opt-in, metadata, and allocation boundaries. The fixture's indexed second-frame palette key and reference extra chunk use the published file specification because native Lua's palette API exposes the first palette only.

## Workbench integration

The export dialog accepts fractional scales and shows the rounded output dimensions. PNG, BMP, TGA, GIF, atlas and game-package frames use `renderScaledExportFrame`; atlas slice metadata uses the same rounded canvas ratios and retains original source slices. Editable project/Aseprite output and packaged source projects keep their original dimensions. Reference layers remain an explicit checkbox.

`tests/workbench-export.test.mjs` executes the actual Workbench export functions against native PNG expectations for geometry, indexed/grayscale, ICC and rectangular tile cases across five formats. It also verifies invalid-scale rejection, the existing Pro gate, preservation of native projects and the animation snapshot while the Pro decision is pending. This host check supplements the lower-level CLI corpus.

Actual rebuilt Electron validation exported the original 54-layer 7×5 geometry fixture at 0.67×. The saved 4×3 PNG matched the independent native PNG pixel for pixel.

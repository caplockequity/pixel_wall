# PixelWall portable formats and offline CLI

The shared `formats.mjs` works in browsers and Node. It imports `fflate` and `omggif`; both must be production dependencies. No DOM, server, filesystem, or AI access is required by the format module. The CLI requires Node 22.13 or later.

## Integration contracts

- `readAseprite(Uint8Array | ArrayBuffer)` returns `{document, warnings}`. The document is the version 4 editor document. The caller must show warnings before/alongside imported artwork and pass the result through `normalizeDocument` for editor limits.
- `writeAseprite(document)` returns `Uint8Array`. Aseprite `.ase` and `.aseprite` extensions use identical data.
- `readPng(bytes)` returns `{width, height, rgba:Uint8Array, warnings}`. `writePng(width,height,rgba)` returns bytes. RGBA is straight/unpremultiplied.
- `importGif(bytes, {name?})` returns `{document,warnings}` with composited full-frame cels, disposal applied, and centisecond durations converted to milliseconds.
- `importSequence([{width,height,rgba,durationMs?,x?,y?}], {name?,durationMs?,width?,height?})` returns a document. Input order determines frame order. The caller owns sorting file names.
- `importSheet({width,height,rgba}, {frameWidth,frameHeight,margin?,spacing?,count?,order?:'row'|'column',name?,durationMs?})` returns a document. `cellWidth/cellHeight` are accepted aliases. The caller should preview the grid; incomplete cells outside the computed grid are omitted.
- `packAtlas(entries, {trim=true,padding=1,extrude=0,border=padding,powerOfTwo=false,maxSize=8192,width?,height?,imageName?,clips?,slices?})` returns `{width,height,rgba,frames,meta}`. Entries are `{id?,name?,width,height,rgba,durationMs?,pivot?}`. Names must be unique. Uses deterministic MaxRects placement without rotation; metadata records bounds in the source image, trimmed and empty flags, source size, duration, pivot, frame tags and slices. Padding separates the extruded frame regions. Both fixed width and height must be supplied together. Without power-of-two, the packed result is cropped to occupied bounds. Failure to fit is explicit.
- `makeSpriteSheet(entries,{columns=entries.length,padding=0})` returns `{width,height,rgba,frames,meta}`.
- `encodeGif(entries,{loop=0})` returns GIF bytes. Entries must share dimensions. Exact palettes up to 255 opaque colors are preserved. More colors use a 216-color cube. Alpha uses a threshold of 128; timing rounds to 10 ms. Show these format limitations in the export UI.
- `makeSequenceZip(entries,{clips?,slices?})` returns a ZIP of real PNG images and metadata.json.

All codec functions throw descriptive errors for malformed data. The module itself is a low-level codec; the editor export action and CLI **must verify Pro before invoking GIF, sheet, atlas, or ZIP export**. Free outputs are PNG, native project JSON, and Aseprite interoperability.

## Aseprite compatibility

Reference: [official Aseprite file specification](https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md).

Preserves RGBA, grayscale/value-alpha and indexed pixel data; transparent index and background-layer flags; layer order/hierarchy, visibility, locks, references, UUIDs, blend modes and opacity; raw/compressed/linked cels; integer positions, cel opacity and z-index; precise cel bounds; per-frame duration and palette changes; tag direction/repetition; slices, pivots and nine-patch centers; palette names; text/color user data and opaque property bytes; external-file references; embedded tilesets and tilemap bits; color-profile metadata including exact embedded ICC bytes.

Aseprite extensions are kept as additional JSON keys rather than flattened. Important shapes:

```
metadata.aseprite = {
  transparentIndex, pixelRatio:{width,height}, grid,
  colorProfile:{type,flags,gamma,icc?:number[]},
  externalFiles:[{id,type,name}], paletteNames,
  opaqueChunks:[{frameIndex,type,data:number[]}], warnings
}
frame.palette = ['#rrggbbaa', ...] // change at this frame; inherited until next change
cel.preciseBounds = {flags,x,y,width,height}
image.tilemap = {bitsPerTile,idMask,xFlipMask,yFlipMask,diagonalFlipMask,tiles:number[]}
layer.tilesetId = 'tileset-id'
tileset = {id,asepriteId,name,flags,tileWidth,tileHeight,tileCount,baseIndex,imageId?,externalFileId?,externalTilesetId?}
slice.keys = [{frameId,x,y,width,height,pivot?:{x,y},center?:{x,y,width,height}}]
```

Aseprite tilemap images use width/height in **tiles** and `pixels:[]`. A tileset image is the original vertical atlas: `tileWidth × (tileHeight × tileCount)`. The `baseIndex` field is a display label, not an offset in tile data. The engine also supports its own editable `layer.tilemaps[frameId]` and `tileset.tiles` representation; native export converts it to a stacked atlas with tile zero reserved as empty.

Explicit limitations:

- ICC/fixed-gamma profiles are preserved, but the editor previews/edits sRGB channel values without ICC conversion. The import result warns about this; callers must display it. This is not a color-managed parity claim.
- External tilesets are preserved as links but are not fetched automatically; the import warns. A preview needs the external image to show their pixels.
- Unknown chunk types remain in project metadata; native export is blocked while any are present, because relocating unknown chunks could change their meaning. Save project JSON to preserve them.
- Native tags require contiguous frame ranges. Noncontiguous/reordered clip sequences must use rendered animation exports or be rearranged first. Native writing rejects lossy conversion.
- Aseprite extension properties are opaque and preserved; the editor does not expose their custom fields.
- Edited tilemap layers cannot switch tilesets between frames in Aseprite. Export fails explicitly for this case.
- PNG decoding supports all standard color types, 1/2/4/8/16-bit depths where legal, PNG filters, palette transparency and Adam7. Sixteen-bit channels are reduced to eight-bit with a warning. ICC/gamma metadata is not converted, with a warning. APNG is explicitly rejected; use PNG frames or GIF.

## CLI

Ship `cli.mjs`, `editor-core.mjs`, `formats.mjs`, `offline-license.mjs`, and `license-public-keys.mjs` together; add a package bin mapping such as `"pixelwall":"./lib/cli.mjs"` for their final location. The executable uses only local files and the same editing command registry as the browser.

```
node lib/cli.mjs new --width 32 --height 32 --out hero.pixelwall
node lib/cli.mjs commands
node lib/cli.mjs apply hero.pixelwall --commands edits.json --out edited.pixelwall
node lib/cli.mjs script hero.pixelwall --script ./draw.mjs --out drawn.pixelwall
node lib/cli.mjs inspect hero.pixelwall
node lib/cli.mjs render hero.pixelwall --frame 0 --scale 4 --out hero.png
node lib/cli.mjs import art.aseprite --out imported.pixelwall
node lib/cli.mjs import sheet.png --frame-width 32 --frame-height 32 --out imported.pixelwall
node lib/cli.mjs import-sequence 01.png 02.png 03.png --duration 100 --out animated.pixelwall
node lib/cli.mjs export hero.pixelwall --format aseprite --out hero.aseprite
node lib/cli.mjs export hero.pixelwall --format gif --out hero.gif --license license.txt
node lib/cli.mjs export hero.pixelwall --format atlas --padding 2 --extrude 1 --power-of-two --out atlas.png --license license.txt
```

JSON command files accept an array or `{commands:[...]}`. `commands` prints the editor's complete command catalog. Trusted script modules export a default function receiving `{document,apply,commands}`. `document` is a defensive copy; `apply(command)` validates and executes a shared editor command. Returning a document is optional; returned documents are normalized. The explicit `script` command executes user-owned local code with normal Node privileges, without an AI runtime or server.

Pro exports verify a signed, nonexpiring PW2 production license offline. A token may be supplied through `--license license.txt`, a direct `--license PW2...` value, or `PIXELWALL_PRO_LICENSE`. Private keys never ship. `license-public-keys.mjs` must be populated during release packaging with the production public JWK map; the staged empty map fails closed. User-supplied public keys and a `--pro` switch are deliberately unsupported. File outputs are written using temporary files and atomic rename.

## Validation

`node --test formats.test.mjs` exercises the native header, linked cels and hierarchy, palette animation, grayscale rejection, ICC and user properties, precise bounds, embedded flipped tilemaps, malformed/unsupported data, independent PNG fixtures for packed/indexed/16-bit/filter/interlaced data, PNG corruption detection, GIF disposal/timing, sheet round-trip, atlas extrusion/metadata and real PNG ZIP output.

## Additional image codecs and game packages

`readBmp(bytes)` and `readTga(bytes)` return `{width,height,rgba,warnings}`, matching `readPng`. `writeBmp(width,height,rgba)` writes a Windows V5 bitmap with explicit RGBA masks, top-down rows, and sRGB. `writeTga(width,height,rgba,{rle=true})` writes a Truevision v2 image with top-left origin and explicit straight alpha; either raw or RLE output is available.

BMP imports support Windows/OS2 headers, indexed 1/4/8-bit, RGB 16/24/32-bit, bitfields, top-down/bottom-up rasters, and RLE4/RLE8. Embedded JPEG/PNG BMPs are rejected. TGA imports support indexed, truecolor, grayscale, raw/RLE, origin direction, palette offsets and v2 alpha semantics. Interleaved TGA is rejected. Unsupported image metadata and color profiles produce warnings. The CLI imports these files and exports them with `--format bmp` / `--format tga` as free single-frame outputs.

Sources: [Microsoft BITMAPV5HEADER documentation](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapv5header) and the [original Truevision TGA v2 specification (preserved PDF)](https://github.com/DEAKSoftware/Truevision-TGA/blob/master/truevision-tga.pdf).

`packAtlas` now also accepts `layout:'packed'|'horizontal'|'vertical'|'grid'` and `columns` for grid layout. All layouts preserve trim/extrude/padding/POT settings. `importSheet` accepts `padding` as an alias for outer `margin`, and a positive `columns` limit (zero means all columns available).

`makeGamePackage(document,{entries?,atlas?,...atlasOptions})` returns ZIP bytes. Pro authorization is required at its call site. Omitting entries renders document frames through the shared engine; supplied entries can be clip-filtered or scaled by the caller. Omitting atlas packs entries. The ZIP contains:

- `sprites.png`, `sprites.json`, and the native `.pixelwall` project.
- Actual PNGs for every supplied frame, with duration in `manifest.json`.
- Actual PNG files for every tileset tile, Tiled image-collection `.tsj` files and original tileset metadata with exported PNG paths.
- Per-frame Tiled `.tmj` maps with unsigned global tile IDs, correct rotation/flip flags and cell offsets. Mixed tile dimensions produce separate maps per grid size. Indexed palette changes produce distinct tileset PNG variants for each palette.
- A manifest mapping all assets, animations, slices, timings and interoperability notes.

Tilemaps exported to Tiled include tile layers; rendered PNGs and the native project retain all artwork. Tiled cannot express every Aseprite blend/compositing mode; notes and original properties are retained in the manifest/project. Missing external tileset images cause an explicit error. Tiled map coordinates and tiles remain at source resolution even when supplied sprite-frame entries were scaled; asset dimensions are recorded independently.

Source: [Tiled JSON map format](https://doc.mapeditor.org/en/stable/reference/json-map-format/) and [global tile IDs and transformation order](https://doc.mapeditor.org/en/stable/reference/global-tile-ids/).

Additional validation: `extra-formats.test.mjs` includes independently assembled BMP/TGA fixtures, alpha and orientation round-trips, alternate atlas layouts, actual game-package PNGs, indexed palette variants, and pixel-for-pixel Tiled reconstruction for all 16 combinations of 0/90/180/270 rotation and X/Y flips for both native engine and Aseprite tilemaps. `cli.test.mjs` covers offline editing/scripts and denies all Pro formats without a valid signature, then verifies successful exports using a test release with a fixture-pinned public key.

Final integration notes: `packAtlas(...,{scale})` records the rendered sprite scale, scales exported slice bounds/pivots/centers, and retains original `sourceSlices`. Tags include their actual exported frame indices, source frame IDs, and a partial flag when the selected export omits frames. Game-package maps are limited to frame IDs represented by supplied entries; the project backup remains complete. The manifest explicitly distinguishes sprite-frame scale from the source-resolution tilemaps. `encodeGif(...,{loop:-1})` emits a non-looping GIF without a Netscape loop extension.

The CLI accepts the exact `pixelwall-pro-license.txt` ownership download, including its explanatory heading and instructions. File parsing extracts a single bounded PW2 code and rejects malformed, oversized or ambiguous files; direct tokens and environment tokens are unchanged. Signature verification remains mandatory after extraction. The test suite exercises the actual ownership-download text format with a signed fixture token.

Native Aseprite tile editing now uses `sourceRect` tile descriptors with stable `asepriteTileId` values. Round-trip tests cover editing only one imported frame, manual edits to a shared atlas tile, rotation/flip preservation, and unchanged original tile IDs/counts. New indexed Aseprite exports reserve a transparent palette entry without converting opaque palette index zero to transparency; a full palette without an available transparent slot fails explicitly.

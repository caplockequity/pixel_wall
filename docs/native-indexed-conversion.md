# Native indexed color algorithms — technical contract

The new `app/native-indexed.mjs` implements separately licensed native Octree and RGB5A3 palette generation/mapping, native ordered and old ordered dithering, and integer serpentine error diffusion. The existing independently implemented PixelWall median cut, nearest mapping, ordered Bayer, and Floyd–Steinberg options retain their previous results and defaults. Customer-facing labels should be **Octree**, **RGB5A3**, **Ordered**, **Ordered (legacy)**, and **Error diffusion**. Internal IDs below distinguish existing modes without public competitor comparisons.

```js
{
  type: 'document.colorMode',
  colorMode: 'indexed',
  paletteMode: 'generate', // existing | generate
  quantization: 'octree', // median-cut | octree | rgb5a3
  maxColors: 32,          // 2–256; mask included when needed
  withAlpha: true,
  rgbmap: 'octree',       // pixelwall | octree | rgb5a3
  fitCriteria: 'rgb',     // default | rgb | linearizedRGB | ciexyz | cielab
  dithering: 'aseprite-ordered',
  ditherMatrix: 'bayer4x4', // bayer2x2 | bayer4x4 | bayer8x8
  ditherStrength: 1
}
```

`rgbmap` defaults to `pixelwall`, except explicitly selecting native quantization or a native dithering ID defaults it to `octree`. `fitCriteria` defaults to `default`, the native five-bit weighted fitting rule when a native map is selected. Native `rgb` uses unpremultiplied RGB squared distance plus alpha difference divided by 128 before squaring. The other fitting criteria use the native formulae; these are fitting-coordinate transforms, not ICC profile conversions. Work remains in the existing document working space, and profile metadata is preserved.

Native dithering IDs are `aseprite-ordered`, `aseprite-old`, and `aseprite-error-diffusion`; `none` works with either mapping family. Existing `ordered` and `floyd-steinberg` require the `pixelwall` mapper. Mixing a legacy dithering algorithm with a native map, a native dithering algorithm with the legacy map, or a nondefault fit with the legacy map fails explicitly. Native ordered modes have no strength control and require `ditherStrength:1`. Native diffusion uses integer percentage strength, truncated toward zero, and alternating row direction. Native grayscale input skips dithering, matching its non-RGB conversion path.

## Sampling and document semantics

Native palette generation samples every visible composited full-canvas frame once per exposure, including repeated linked exposures, layer blending, cel positions, and clipping. Frame durations do not change sampling weight. Hidden layers and unused tile artwork do not contribute to the generated palette, but they are still remapped so the entire document remains editable. This differs intentionally from the existing median-cut option, which samples distinct stored artwork contexts including hidden and unused resources. A sprite consisting solely of one background layer uses all requested slots; otherwise a reserved mask is included.

The document command remains a global, transactional conversion/remap: one generated palette is installed throughout the animation, opacity is preserved, and each effective frame palette is respected when converting stored images. Links are preserved where mapped indices agree and split only where they differ. This is algorithm compatibility, not a claim that `document.colorMode` reproduces every side effect of Aseprite's commands: native `ColorQuantization` installs its result at the active palette, native `ChangePixelFormat` does nothing when the source is already indexed, resets cel opacity during conversion, and converts shared cels/tilesets using their first exposure/frame. PixelWall retains its existing global workflow and context-safe behavior instead of reproducing those side effects.

Global color-mode conversion continues to include locked layers, as an existing document-wide operation; Lua/host document-writability gates remain in their existing callers. No new I/O, permission, execution, licensing, or export authority is added. Failure occurs before returning a changed document.

Native Octree mapping preserves the last exact duplicate palette entry. RGB5A3 mapping first expands five-bit RGB and three-bit alpha, then searches, so low nonzero alpha can map to the mask. Default fitting similarly truncates alpha to five bits before testing transparency. Non-mask palette entries with alpha zero retain their numeric indices and hidden RGB; they are not collapsed into the mask. Palette generation with a nonzero source transparent index currently rejects explicitly because the native Octree mask-as-color behavior needs a separate supported contract. Existing-palette mapping supports nonzero mask indices. Native-generated RGB5A3 palettes with `withAlpha:false` reserve opaque black; Octree reserves transparent black.

Each tile resets the ordered origin and diffusion state. Raw native map words, flags, positions, and image links stay intact when the converted artwork retains the original numeric tile slots. Frames requiring additional palette-context variants materialize maps referring to the new tiles; other frames can keep their original native maps. External tilesets must be explicitly embedded before conversion. Profiles, tile user data, and embedded resources remain represented by existing document fields.

## Evidence and bounded differences

The original Lua generator and self-contained corpus are in `tests/fixtures/native-indexed/`. The reference is the official Aseprite 1.3.18.5-dev source build, API 41. The corpus has 118 jobs and 134 frames: both quantizers at 2/8/16/32/256 colors with and without alpha; both mappers; all five fitting criteria; ordered/old/diffusion; three Bayer sizes; RGB and grayscale; nonzero masks and duplicate palette colors; composited linked animation with hidden layers and unused tiles; a background-only sprite; and all eight transforms of rectangular tilemaps.

All 118 jobs match native palette entries and indexed raster/atlas bytes. All 134 PixelWall-generated native-file frames were independently opened and rendered by the reference executable and matched the corresponding native conversion frame byte for byte. `generate.lua`, `collect.mjs`, and `reopen.lua` retain the explicit input/command/capture procedure; fixtures do not execute native code during normal tests.

Rendering retains one invisible-channel distinction from indexed conversion correctness. PixelWall's canvas canonicalizes RGB beneath alpha zero to black, while native captures can retain hidden RGB from alpha-zero palette entries. Tests normalize only those invisible channels for visible comparison. Rectangular diagonal tile clearing is now preserved in raw/editable maps and fractional exports; these tile jobs compare directly with their independent native captures. See [tile clearing](tile-backdrop-clearing.md). The corpus retains the original native RGBA captures unchanged.

The document representation already canonicalizes fully transparent source raster pixels to `null`; hidden RGB that was discarded on import cannot be reconstructed. Pure helper inputs may preserve such RGBA values, but document-level conversion makes no hidden-source-RGB recovery claim. Similarly, the global context-safe pipeline is not the native first-frame-only tileset behavior for changing frame palettes.

Work shares the existing 67,108,864-operation budget. Raster and sample counts are capped at 16,777,216 pixels; native octrees and exact distinct-color histograms cap at 1,048,576 entries/nodes. No lossy fallback is substituted when a native limit is reached. Octree channel accumulators reject beyond the verified signed 32-bit rounding range. A native empty palette that cannot be represented by the document is rejected. Palette limits remain 2–256, and unsupported extension matrices or unknown options fail explicitly.

## Provenance

The helper is a modified JavaScript adaptation of separately MIT-licensed Document/Render library files. Full upstream copyright and permission texts, source paths, and modification notices are in `docs/indexed-NOTICES.txt` and the helper's retained legal comment. `prepareRuntimes` copies the full notice into browser, desktop, and CLI runtime bundles and includes the component in provenance metadata. No native application code, executable, UI, or EULA-licensed command implementation is bundled.

Official interface references: [ColorQuantization](https://www.aseprite.org/api/command/ColorQuantization), [ChangePixelFormat](https://www.aseprite.org/api/command/ChangePixelFormat).

The editor now exposes Palette method, Color matching and Color distance controls. Changing matching families translates an existing dither choice to the compatible family and resets unsupported distance settings. Ordered native modes require full strength and hide that control. Generation copy distinguishes stored-art sampling from composited-frame sampling.

Actual browser UI verification selected Octree, eight colors and RGB fitting on corpus job038. All eight palette entries matched the native reference, and the 544 indexed bytes matched its CRC32. One toolbar Undo restored the original RGBA byte CRC32. Switching mapping families also correctly reset incompatible distance/strength options.

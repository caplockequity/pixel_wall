# Indexed palette generation and dithering

PixelWall can generate one palette for an animated document and remap its raster images with nearest mapping, ordered Bayer dithering, or Floyd–Steinberg error diffusion. This page describes the original algorithms. Additional Octree/RGB5A3 generation and mapping, fitting criteria, ordered variants and serpentine error diffusion are covered by the [native algorithm contract](native-indexed-conversion.md). The shared entry point is `app/indexed-color.mjs`; `document.colorMode` integrates it with the existing transactional conversion logic.

## Command options

```js
{
  type: 'document.colorMode',
  colorMode: 'indexed',
  paletteMode: 'generate', // existing | generate
  maxColors: 32,           // 2–256, including reserved transparent entry
  quantization: 'median-cut',
  withAlpha: true,
  dithering: 'ordered',    // none | ordered | floyd-steinberg
  ditherMatrix: 'bayer4x4', // bayer2x2 | bayer4x4 | bayer8x8
  ditherStrength: 1        // 0–1; zero is nearest mapping
}
```

The existing command without new options keeps its existing behavior. Supplying any new indexed option invokes explicit remapping, including when the document is already indexed. These options reject for a non-indexed destination. Defaults are existing palette, 256 colors, median cut, alpha entries enabled, no dither, 4×4 Bayer matrix, and full strength.

The original UI labels are **Existing frame palettes / Generate palette**, **Color limit**, **Keep partial alpha in palette**, and **No dithering / Bayer ordered / Floyd–Steinberg**. Show Bayer size only for ordered mode. Do not label PixelWall median cut as Aseprite Octree, or its dither modes as exact native compatibility settings. The result commits as one ordinary undoable command; existing mode conversion/export controls retain ownership of UI and licensing.

## What the algorithms do

- **Median cut** is independently implemented weighted reduction in premultiplied RGBA. It selects boxes by weighted component spread and population, divides them at a population median, and averages their samples. Alpha has twice the squared-distance weight of each color component. Palette order and ties are deterministic. For inputs exceeding 65,536 distinct colors, histogram keys switch to four bits per channel while preserving population and channel sums; this bounds memory without discarding their average contribution.
- **Nearest** uses squared premultiplied RGBA distance with the same alpha weight. Opaque samples cannot select the reserved transparent entry or a fully transparent palette color.
- **Bayer ordered** projects each sample onto its two closest palette colors and compares its mixture fraction with a standard recursively constructed 2×2, 4×4, or 8×8 Bayer threshold. Pair order follows palette indices, making the matrix phase stable. Strength moves the sample between its nearest palette color and its full mixture.
- **Floyd–Steinberg** scans left to right, carrying premultiplied RGBA error to the next pixel/row with weights 7/16, 3/16, 5/16, and 1/16. It clamps adjusted samples into valid premultiplied channel ranges. Transparent source pixels remain transparent and discard received error. This is a raster scan, not serpentine scanning.

These operate in the document's current working color space. They do not change or reinterpret its ICC profile and do not perform a color-managed linear-light/Lab distance search. Choosing a smaller palette can approximate both colors and partial alpha. `withAlpha:false` makes generated visible palette entries opaque; full transparency remains available. It does not promise exact alpha retention when the chosen palette lacks the source alpha values.

## Animation, transparency, and tiles

Generated palettes sample all referenced raster images in every effective source frame palette, including hidden layers and unused embedded tilesets. Each distinct image/color context contributes once; linked duplicate exposures do not overweight the same stored artwork. Images are sampled individually rather than compositing layer blends or weighting cel/frame duration. Generation produces one shared palette across all frames, preventing independent per-frame palette drift.

Existing-palette remapping retains each effective frame palette. Linked images keep sharing when the resulting indexed pixels agree and split when those results differ. Indexed source pixels resolve through their effective frame palette and transparent/background-layer semantics before either operation. The destination transparent index is the existing native index, or zero when absent. Generated palettes reserve that slot; it counts toward the color limit. A transparent index outside the requested limit rejects explicitly.

Full transparency uses the engine's canonical `null` representation. Generated palette entries contain unique visible averages, while unused slots before a high reserved index may be transparent fillers. Background layers can use their actual palette entry at the native transparent index; transparent layers mask that entry. With an existing palette, its native transparent slot is unavailable to opaque pixels on transparent layers, matching that storage constraint.

Dithering is anchored to each stored image, preserving linked animation cels at different canvas offsets. Native atlas tile grids reset matrix origin and diffusion per tile so error does not bleed into adjacent tiles. Individual engine tile images reset independently. Native tilemaps retain transform semantics and remain editable/exportable through the existing context conversion. Unresolved external tilesets must be embedded first.

## Resource and compatibility limits

New explicit indexed mapping supports 1–256 existing palette entries, matching native indexed pixel storage; generation offers limits of 2–256 including transparency. Wider PixelWall palettes remain available to the legacy conversion path, but are not accepted by these native-oriented options. Existing pixel, dimension, image-link, and tile-count limits still apply. Palette construction and remapping share the engine work budget and fail atomically when it is exhausted. Diffusion on large images and large palettes costs more than cached nearest/ordered mapping; reduce image, frame, or palette size if needed.

The helper itself is host-independent and does no I/O. `quantizePalette(samples, options)` accepts RGBA/null samples and returns a palette. `mapIndexedImage(image, palette, options)` returns an indexed/null pixel array. It supports optional `transparentIndex`, native `tileWidth`/`tileHeight`, and a shared bounded `{remaining}` work budget. A null transparent index is a background context. Malformed algorithms, colors, geometry, indices, and budgets reject explicitly.

## Historical comparison evidence for the original algorithms

Aseprite's [ColorQuantization API](https://www.aseprite.org/api/command/ColorQuantization) documents `octree` and `rgb5a3` palette generation. Its [ChangePixelFormat API](https://www.aseprite.org/api/command/ChangePixelFormat) documents ordered, old, and error-diffusion choices plus RGB-map and fitting criteria. The [CLI documentation](https://www.aseprite.org/docs/cli/) describes Bayer matrices and indexed conversion flags. PixelWall's median cut and fitting/dithering implementation are distinct; the new native octree/rgb5a3, ordered variants and fitting criteria use distinct explicit options. Extension matrices remain unsupported.

Original 16×8 grayscale and color/partial-alpha gradients were generated by the official Aseprite 1.3.18.5-dev Lua API. Seven chosen native jobs and seven PixelWall outputs were independently reopened and captured by Aseprite as raw RGBA. Five native CLI conversions also matched the corresponding native API commands exactly. Fixtures include original Lua, native files, captures, command options, and measured comparisons.

| Fixture | PixelWall / native algorithm | Identical rendered pixels |
| --- | --- | ---: |
| Grayscale, no dither | nearest / native octree mapping | 128/128 |
| Grayscale, Bayer 2×2 | PixelWall ordered / native ordered | 92/128 |
| Grayscale, Bayer 4×4 | PixelWall ordered / native ordered | 104/128 |
| Grayscale, Bayer 8×8 | PixelWall ordered / native ordered | 103/128 |
| Grayscale, diffusion | Floyd–Steinberg / native error-diffusion | 91/128 |
| Color, eight entries | median cut / native octree | 0/128 |
| Color, eight entries | median cut / native rgb5a3 | 0/128 |

All seven PixelWall native exports reopened with exactly the pixels PixelWall predicted. The differing patterns/averages above are documented algorithm differences, not claims of visual equivalence or broader quality superiority. Raw pixel MSE is recorded in the fixture for inspection, but does not rank dither quality: dithering intentionally redistributes error spatially. Tests additionally verify tone coverage, mean tone, alpha, deterministic weighted reduction, histogram bounds, all-frame palette contexts, links, backgrounds, transformed native tiles, and atomic failures.

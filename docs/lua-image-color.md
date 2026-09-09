# Lua Image, Color, and geometry authoring

This extension runs in the existing isolated Lua 5.4 VM, with the same instruction, time, memory, image, and command budgets. It adds no file, network, loader, or save/export authority. Native behavior was checked using original scripts against the official Aseprite 1.3.18.5-dev build (Lua 5.4.6/API 41). PixelWall's bundled VM remains Lua 5.4.5; matching tested API behavior does not claim identical runtime patch versions.

## Image operations

Supported constructors are `Image(width,height[,mode])`, the supported image-spec fields, `Image(otherImage)`, `Image(otherImage,Rectangle)`, and `Image(sprite)`. A crop keeps the requested dimensions and pads outside pixels with the image's transparent mask. An empty crop returns nil. Crops/clones are detached images. `Image(sprite)` renders its first frame in the sprite's own RGB, grayscale, or indexed mode.

Images expose numeric IDs, versions, width/height, bounds, color mode, bytes-per-pixel, row stride, a supported spec, and `cel` when attached. Numeric IDs are local to a VM run and change when resize replaces image storage. Linked cel aliases keep referencing the same buffered image.

`image.bytes` reads/writes native packed byte strings: RGBA bytes in R,G,B,A order, grayscale value/alpha pairs, and one byte per indexed pixel. Rows are tightly packed. Transfers use bounded numeric chunks so NUL, non-UTF-8 bytes, and values above 127 never pass through UTF-8 string conversion. A setter validates total length and stages the complete transfer before changing pixels. Detached byte images can retain all 256 indexed values; an attached indexed image rejects values missing from its sprite palette.

The added methods are:

- `resize(width,height)`, `resize{width,height,method='nearest'}`, or `resize{size=Size(...)}`. Nearest sampling uses floor-based source coordinates. The image and attached linked cels update together.
- `flip()` / `flip(FlipType.HORIZONTAL)` / `flip(FlipType.VERTICAL)`.
- `drawSprite(sprite,frameNumberOrFrame[,position])` and its `putSprite` alias. The selected frame is flattened within its sprite canvas, then drawn at the destination position. It accepts matching modes and any supported source mode into RGB.
- `drawImage` / `putImage` support matching modes, clipping, opacity, the engine's 19 blend modes, and `BlendMode.SRC`. Native SRC copies literal pixels, including transparency, and ignores opacity.
- `clear([bounds,]color)` supports clipped rectangular clears as well as whole-image clearing.
- `shrinkBounds([referenceColor])`, alongside existing clone/getPixel/drawPixel/pixels/isEmpty/isPlain/isEqual methods. Invisible RGB channels do not make an otherwise transparent image nonempty or unequal.

For indexed-to-indexed sprite rendering, native Aseprite copies index values and ignores layer/cel opacity and blending; PixelWall preserves this distinction from RGB rendering. It retains duplicate palette indices, hidden-layer visibility, tile geometry/transforms, and the background layer's ability to draw the otherwise transparent index. `drawImage(Image(sprite))` still applies the resulting image's mask index normally. These semantics were separately observed in native probes.

Attached writes check every layer/group lock referencing the shared image. They remain buffered and flush through the existing engine commands, including linked-image edits and transaction rollback. Detached changes create no document commands until attached.

## Color and geometry values

Color supports RGB, gray, indexed, HSV, HSL, copy, and active-mode packed-pixel construction. It exposes editable red/green/blue/alpha, gray, index, HSV hue/saturation/value, HSL hue/saturation/lightness, generic hue/saturation/value/lightness aliases, and packed RGBA/gray getters.

HSV/HSL objects retain their declared components instead of recomputing them from rounded RGB bytes. Setting alpha retains the color kind. Setting an RGB channel changes it to RGB; setting an explicit HSV/HSL component changes it to that color kind. A gray assignment sets equal RGB channels. Hue 360 is retained as 360 while representing red. Generic hue/saturation follow the current HSV/HSL kind. Foreground/background getters remain detached copies and preserve the kind.

An indexed Color resolves against the effective active-frame palette. Its selected index remains stable across frame changes; an explicit alpha override remains until the index changes. RGB/HSV/HSL `.index` returns the closest active palette entry using squared RGBA distance with extra alpha weight. Exact-color/native representative cases are verified; native octree tie-breaking and all arbitrary color-distance choices are not claimed bit-identical.

Point and Size support their documented constructors, mutable components, equality, and arithmetic. Size provides width/height and w/h aliases and union. Rectangle supports x/y/width/height, w/h, copied origin/size values, emptiness, point/rectangle containment, intersection, intersects, and union. Fractional geometric inputs floor to integers, including negative values. Empty intersections are `(0,0,0,0)`, and an empty rectangle is not contained.

## Explicit boundaries

- File constructors, saveAs, graphics contexts, tilemap Image storage, and arbitrary ImageSpec fields remain unsupported. `ColorMode.TILEMAP` is exposed so asking for it rejects explicitly rather than silently becoming RGB.
- Resize supports nearest neighbor with a zero/default pivot. Bilinear, RotSprite, and nonzero pivots reject explicitly.
- drawSprite from RGB into grayscale/indexed, or other cross-mode fitting besides an RGB destination, rejects rather than guessing a palette/color conversion.
- The engine canonicalizes fully transparent raster pixels to null when committing documents. Detached/in-VM byte buffers preserve hidden RGB/gray bytes; compositing and document persistence do not promise hidden-color byte preservation. Visible RGBA and packed buffer layout are verified separately.
- Packed indexed byte access and Color index setters are limited to native 8-bit indices. Active palette lookup requires an available sprite and a valid palette entry.
- HSV/HSL hue inputs are restricted to 0–360 and saturation/value/lightness to 0–1. Out-of-range native hue behavior can produce negative RGB channels; PixelWall rejects it explicitly. Legacy partial RGB tables such as `Color{g=255}` remain a PixelWall convenience; native dispatch of incomplete RGB tables can differ.
- Image:drawPixel edits remain transactional in PixelWall's worker handoff even though native Aseprite warns that some direct Image pixel methods do not independently create undo information.

The checked-in original `tests/fixtures/lua-image-color-oracle.lua` runs unchanged under both VMs and checks crop padding, resize, flips, bytes, blending/SRC, image rendering, indexed opacity/background behavior, Color components/assignments, and geometry. Additional worker tests cover all byte values across chunks, malformed transfers, linked rollback, every referencing lock, palette animation, and resource exhaustion. The entire Dialog suite also passes with these value objects and image APIs.

Primary references: [Image API](https://www.aseprite.org/api/image), [Color API](https://www.aseprite.org/api/color), [Rectangle API](https://www.aseprite.org/api/rectangle), [Point API](https://www.aseprite.org/api/point), [Size API](https://www.aseprite.org/api/size), and [BlendMode API](https://www.aseprite.org/api/blendmode).

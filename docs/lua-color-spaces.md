# Lua color spaces

This is a bounded Aseprite scripting adapter. It supports the following values and sprite operations in the existing isolated Lua 5.4 session:

- `ColorSpace()` creates a None profile; `ColorSpace{ sRGB=true }` creates sRGB; `ColorSpace(other)` makes a detached value copy.
- `ColorSpace.name` gets or sets the detached name. New constructor values start unnamed. Numbers become text; unsupported name value types are ignored, matching the native probe. Equality compares profile identity and ignores names.
- `Sprite.colorSpace` returns a detached value. Assigning the property or calling `sprite:assignColorSpace(value)` changes the working profile without changing pixel bytes. The supplied profile is copied; later changes to its name do not change the sprite.
- `sprite:convertColorSpace(value)` converts cel pixels and palettes in the worker and records a validated `document.colorProfile` command. The returned value is the supplied `ColorSpace` argument. RGB and grayscale storage mode, alpha, linked cel image IDs, and frame palette boundaries are preserved. Indexed conversion changes palettes while retaining pixel indices. Grayscale conversion retains palettes.

An embedded RGB/gray ICC or fixed-gamma source profile comes from the document supplied by the host. A script can retain its `sprite.colorSpace`, assign that value to another sprite in the same run, and convert between it and sRGB. None-to-profile and profile-to-None conversions preserve bytes, matching the native Aseprite probe. Like the native sprite conversion, tilemap cell words and tileset artwork are not converted; tile Image handles remain usable. Cached raster cel Image handles are invalid after conversion, even when the conversion preserves bytes. Obtain `cel.image` again. Assignment leaves those handles valid. Transaction rollback restores the original image generation; handles created for discarded conversions remain invalid.

## Execution and validation

The trusted Node/browser worker startup loads the existing bundled LittleCMS runtime only when the initial document contains ICC or fixed-gamma data. The browser derives `lcms.wasm` beside the same-origin Lua asset selected by the host. Lua cannot select an asset URL, access the color manager, or request arbitrary files or network resources. No Workbench or CLI call signature changes are required; rebuild the existing runtime assets when packaging this change.

The shared engine command validates the target profile, exact existing image IDs and pixel counts, every required palette, unchanged indexed pixels, grayscale channels, and layer locks. It cannot introduce layers, cels, image dimensions, or arbitrary document fields. The host replays the ordinary command log and verifies the returned documents before the existing atomic install. Cancel, timeout, failed conversion, failed transaction, or stale host revision cannot publish a partial profile/pixel change. This adds no export permission or license bypass.

Existing Lua instruction/time/memory, one-million-pixel and 32 MiB output limits remain in force. ColorSpace values additionally allow at most 512 handles, 8 MiB of retained unique profile data, a 4 MiB individual ICC, and a 4096-byte name. ICC header/tag bounds and RGB/gray color space are validated before use; LittleCMS validates the actual profile when invoked.

## Explicit limits

- `ColorSpace{ fromFile=... }` is unsupported because scripts have no authorized file capability. Load a profile through the editor and pass that document into the script. Raw ICC constructors, arbitrary primaries/transfer curves, CMYK/Lab profiles, and filesystem/export commands are not exposed.
- Use `image.spec.colorSpace` to inspect an image profile through the [ImageSpec adapter](lua-image-specs.md). `Image.colorSpace` is not a native property. Direct image-level conversion and display/monitor configuration remain unavailable.
- Standard names are provided for None, sRGB and fixed gamma 1/2.2. Unnamed ICC profiles use `Custom Profile`; Aseprite can recognize and name some ICC matrix/curve combinations more specifically. Explicit names are preserved in the PixelWall working document. The Aseprite file color-profile chunk does not store these display names.
- A gray document conversion that produces unequal RGB channels is rejected, preserving the document. It does not silently change storage mode. LittleCMS and Aseprite's Skia transform engine can differ for untested profiles, intents and rounding; the verified vectors do not establish universal byte-for-byte color-engine parity.
- Every locked layer blocks profile assignment and conversion. This follows the editor's edit protection rules and is deliberately stricter than native Aseprite's scripting behavior.

## Verification and provenance

The constructor/name/equality/assignment fixture is an original script run against the official Aseprite 1.3.18.5 source self-build (API 41), then against the real Wasmoon worker. Native conversion probes verify RGB, gray, indexed palette and generated gray-ICC samples, alpha, None behavior, tile handle survival, and raster handle replacement. The existing CC0 synthetic RGB ICC and the new CC0 generated gray ICC are test data; no Aseprite application implementation source is included.

Primary API references: [ColorSpace](https://www.aseprite.org/api/colorspace), [Sprite colorSpace](https://www.aseprite.org/api/sprite#spritecolorspace), [assignColorSpace](https://www.aseprite.org/api/sprite#spriteassigncolorspace), [convertColorSpace](https://www.aseprite.org/api/sprite#spriteconvertcolorspace). The native API checkout was pinned at `662b12efe00fd374909bc3a0e9cce5d0d0d35d63`. Wasmoon and LittleCMS keep their existing MIT runtime notices.

The rebuilt standalone browser also passed an actual exposed-tool run through the editor: a synthetic ICC pixel converted to the native packed value, followed by tile and animation authoring. One toolbar Undo restored the original profile, pixel and document structure. This is browser-host verification; native desktop profile scripting was not re-established in that UI session.

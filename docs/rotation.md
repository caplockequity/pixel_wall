# Fast and RotSprite rotation

PixelWall's portable rotation helper adapts the separately MIT-licensed Aseprite Document Library's scanline parallelogram and RotSprite algorithms from v1.3.18.5. Fast uses the native fixed-point scanline rules. RotSprite uses three Scale2x passes (8× enlargement), the same native scanline mapping, and native endpoint downsampling. It replaces the former 4× majority-vote approximation.

`selection.transform` accepts `method: "fast"` or `method: "rotsprite"` when `operation` is `"rotate"`. The existing `nearest` value selects Fast for rotation and remains nearest-neighbor for other transforms. The existing `pixel-safe` value is a compatibility alias for RotSprite. Move, scale, and flip behavior is unchanged. The Transform selection dialog offers RotSprite and Fast, with RotSprite selected by default. Rejected transforms keep the dialog and selection available for correction.

The pure `rasterizeRotation` API accepts a source image, destination dimensions, four integer outer corners in TL/TR/BR/BL source-corner order, an optional source-sized binary mask, and a method. Corners must form a parallelogram. It returns owned packed pixels and source-mask coverage without modifying input or holding global scratch state. Formats are RGBA (red in the low byte), gray+alpha, indexed, bitmap, and an internal uint32-values mode with a reserved transparent sentinel. RGBA and grayscale require a zero-alpha mask color. Values mode lets the editor preserve indexed slot identity, including duplicate-color slots and palettes with no free transparent entry.

RGBA/grayscale pixels retain their working color values and alpha. The editor composes the rotated patch once over the remaining cel, leaves transparent holes intact, and clears the original selected pixels only for a move/cut. Palette indices are transferred directly. Profile conversion is not part of rotation. Existing immutable command/batch handling gives one atomic edit; a rejected rotation leaves the source and linked images unchanged.

## Geometry scope

The helper's native conformance claim concerns exact corner inputs. PixelWall computes three outer corners from the requested clockwise angle, translation and pivot, rounds those corners to integer coordinates, and derives the fourth to maintain a parallelogram. This is PixelWall's angle-to-corner contract. Aseprite's UI drag/angle/pivot rounding has not been independently verified, so this patch does not claim every UI angle produces identical corners in the two applications.

Native low-level RotSprite has unusual clipping behavior: it downsamples the complete intermediate bitmap into its clipped destination extent. The helper preserves this primitive behavior for conformance. The editor instead rotates a complete local bounding rectangle and then crops while placing it on the document; a shape crossing a canvas edge does not shrink to fit. Fully off-canvas edits avoid unnecessary raster buffers while still honoring cut/copy semantics.

## Limits and distribution

Fast source/destination dimensions and corner spans are at most 32,767, the supported 16.16 range. RotSprite source dimensions and rotated spans are at most 4,095 before 8× expansion. Numerical source/output/scratch buffers have a conservative aggregate 64 MiB limit; oversized operations fail before allocating rejected output or high-resolution intermediates. Existing editor document/image/operation budgets also remain in force. The limit is deliberately stricter than the native library's unbounded allocations. Choose Fast or reduce the selection if RotSprite exceeds it.

Full MIT permission text and original Allegro contributor attribution are retained in the helper's legal comment, including in a verified minified bundle. `docs/rotation-NOTICES.txt` additionally preserves the full upstream MIT license and Allegro giftware notice. `prepareRuntimes` copies that asset and its provenance into hosted/browser, standalone, desktop, and CLI runtime directories; the existing package manifest includes the new file. No Aseprite executable or application/UI code is distributed.

## Verification

The original 36 synthetic corner cases retain both native Fast and RotSprite output (72 comparisons). An independent CC0 adapter extends the native library oracle with 266 deterministic cases covering irregular/empty/full masks, RGBA partial and zero alpha, grayscale, indexed transparent slots 0/7/255, bitmap pixels, negative/clipped/off-canvas corners, mirrored/sheared transforms, single-pixel destinations and degenerate parallelograms. All 338 library outputs match byte-for-byte.

The editor has another 72 tests applying its angle/translation contract to the original patterns and comparing rendered results to those native outputs. Additional tests cover method aliases, source immutability, blending once, transparent holes, indexed slot identity, off-canvas placement, resource rejection and transaction rollback, the shipped notice asset, and notice preservation in a minified runtime. Fixture origins, source URLs, hashes, reproduction adapter and build instructions are in `tests/fixtures/rotation-native/`.

Actual rebuilt Electron verification selected RotSprite, applied 35° to the original 8×8 test artwork, and exported at 1×. Every output pixel matched the tested command renderer. Native Cmd-Z followed by another export restored all 64 original pixels. This verifies UI dispatch/history; it does not expand the Aseprite gesture-rounding claim.

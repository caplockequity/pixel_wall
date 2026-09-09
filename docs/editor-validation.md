# PixelWall 2D workbench validation

Validated 2026-09-09. The default editor is the new workbench; the projector workspace remains at `/editor/classic`. No 3D or embedded AI service is included.

## Coverage

- 176 automated checks pass across document commands, selections/brushes/color, linked cels, animation, tilemaps, formats, billing, storage, recovery, extension/API behavior, public pages and distributions.
- Production website and standalone browser/CLI builds complete. ESLint passes. Next route generation followed by TypeScript checking passes; regenerate route types when switching between the Vite and Next toolchains.
- Browser WebMCP changed the visible document, with atomic undo/redo, duplicate-linked frames joining the active clip, editing after frame deletion, single-click selection and recovery restoration.
- Recovery saves current changes before restoration, serializes storage writes and blocks overlapping editing during restoration. Existing legacy browser data remains intact.
- The downloaded browser app saved a new rectangular drawing, then reloaded it successfully with its local HTTP server stopped. Its service worker supplied the app shell; IndexedDB retained the artwork.
- The user's existing live PW1 recovery proof was checked against the existing purchase and converted to a signed PW2 ownership license. No new purchase was created. The shipped public key verified it.
- The actual bundled CLI exported PNG, native Aseprite, two-frame GIF, atlas and game ZIP. GIF frames, atlas pixels and ZIP assets were decoded for validation. Premium exports used the live ownership license; forged or absent proofs are separately rejected by tests.
- The macOS arm64 desktop app builds successfully. Earlier desktop validation exercised drawing, persistence and reopening. The release is unsigned; no signing/notarization credentials are present.
- Timeline redraw comparison: on a local 64-frame 128×128 fixture, full thumbnail rendering took about 264 ms; comparison plus the changed thumbnail took about 4.1 ms. This is a specific local measurement, not a performance guarantee at the document limits.

## Compatibility boundaries

- Native Aseprite interchange covers raster/linked cels, indexed/grayscale, groups/blends, palettes, tags, slices, precise bounds, ICC metadata and supported native tilemaps. Unsupported features fail or produce compatibility notes; retain source originals. This is not a full-parity claim.
- Working values use sRGB; retained ICC profiles are not color-converted. The rotation helper uses pixel-safe supersampling rather than RotSprite. Aseprite Lua scripts are not supported.
- GIF has binary transparency and color quantization. PNG and editable project files retain full alpha. APNG imports are rejected; use individual PNG frames or GIF.
- Tiled cannot represent all artwork blend modes. Packages retain native sources and record interoperability notes. Tilemaps keep source-resolution grids even when sprite frames are scaled.
- Desktop packaging is configured for multiple platforms, but this validation produced macOS arm64 only. Signed installers and cross-platform certification remain release work.
- Offline proofs have no expiry. Online checks can observe refunds; a disconnected perpetual proof cannot be revoked immediately.

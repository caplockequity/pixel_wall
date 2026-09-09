# Per-cel drawing order

Lua `Cel.zIndex` reads and writes a signed 32-bit drawing-order offset through the existing undoable `cel.move` command. The default is zero. Offsets affect that frame's compositing order without changing layer order or shared image identity. Pixel flushes, image replacement, frame links, transaction rollback and final host Undo preserve each cel's offset.

The command also accepts optional `zIndex` with a frame or frame range. Values must be integers; implicit Lua string/boolean/fraction coercions are not implemented. The editable project supports signed 32-bit values. Binary sprite export requires signed 16-bit values and explicitly rejects an out-of-range offset instead of truncating it.

Tilemap cel metadata (position, pixel bounds, opacity, drawing order, layer and frame) is accessible without constructing a raster Image. Raw tilemap bounds are measured in pixels using its tileset grid. Tilemap `Cel.image` remains unsupported until the tile-word Image API is implemented.

An original CC0 fixture in `tests/fixtures/cel-z-order-oracle.lua` was run on the official native 1.3.18.5 batch build. Ten overlapping-layer orders produce the same packed composited pixels in the real Lua worker. The tilemap metadata vector was independently captured from the existing 2×2 tilemap fixture: position (1,1), bounds (1,1,4,4), opacity 255 and zIndex 0. Regression tests cover shared-image links, rollback, locks, malformed values and portable-file bounds. No upstream application implementation is included.

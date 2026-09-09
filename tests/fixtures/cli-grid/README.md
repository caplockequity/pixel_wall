# Independent grid-export oracle (internal validation)

Generated on 2026-09-09 with a local macOS arm64 build of the official Aseprite v1.3.18.5 source distribution. The executable reports `1.3.18.5-dev`. No upstream application implementation is copied into PixelWall.

Primary sources:

- Official CLI documentation: https://www.aseprite.org/docs/cli/#split-grid
- Official source distribution: https://github.com/aseprite/aseprite/releases/download/v1.3.18.5/Aseprite-v1.3.18.5-Source.zip
- Official sprite grid API: https://github.com/aseprite/api/blob/main/api/sprite.md#spritegridbounds

`create.lua` and `more.lua` draw deterministic original fixtures. The linked-indexed and rectangular diagonal tile inputs reuse original CC0 fixtures from `../export-scale` and then change their grid/position through the native Lua API. Native `.ase`, PNG, GIF and JSON outputs are retained under `native/`; `probes.json` records exact invocation arguments, output messages, metadata and unpacked RGBA cells. `invalid-grid.json` records the native rejection of `--grid` (the native tool returns status zero despite this error). `manifest.json` records SHA-256 values for the original source and resulting evidence files.

Reproduce from the repository root, supplying a separately obtained, appropriately licensed executable:

```sh
node tests/fixtures/cli-grid/generate.mjs /path/to/aseprite
node --test tests/cli-grid.test.mjs
```

The generator uses the native executable to create inputs and exports. PixelWall's PNG reader only decodes the resulting PNG for recorded RGBA comparison; neither the grid planner nor editor renderer generates the expected pixels. Tests consume the checked-in evidence and never launch the native application. The separate ICC regression reuses original native outputs from `../export-color` with its existing provenance.

## Verified behavior and deliberate differences

- Native `--split-grid` applies to following inputs for sheet extraction. Placing it after an input does not split that input. PNG/GIF save-as operations remain whole-frame exports. Native `--grid` is not a recognized option.
- Native extraction is frame-major and row-major. Cells repeat back to an origin at or before zero. Incomplete right/bottom cells are omitted. Leading cells can include pixels from cels outside the sprite's canvas, with transparency wherever there is no artwork.
- Grid dimensions do not scale with the sprite. Integer/fractional scaling, linked frame palettes, transparency, ordinary and canonical rectangular diagonal tilemaps are tested independently.
- Native split-grid keeps full cell dimensions with `--trim`; `--ignore-empty` also keeps empty cells. PixelWall intentionally honors `--ignore-empty`, preserving cell numbering.
- Native crop and slice options are ignored for these grid sheet probes, while trim-sprite changes the sampled extent. PixelWall explicitly rejects these mixed geometry options instead of silently ignoring them.
- Native metadata repeats one filename for every cell of a frame, which produces duplicate keys in JSON-hash output. PixelWall uses unique cell names and adds `{cell}`, `{row}`, `{column}` placeholders. Native `spriteSourceSize` offsets refer to the full sprite even though `sourceSize` is a cell; PixelWall uses cell-relative `spriteSourceSize` and explicit `source.grid`/`source.scaledCrop` for source geometry. No identical packing/name/metadata claim is made.
- Native tag selection may add `#tag` to a default filename. PixelWall keeps its existing tag naming convention and includes unique cell suffixes.
- PixelWall's explicit `--grid` override, boolean reset, global-default selectors, sheet/atlas/ZIP routing, safer unsupported-target errors, entry limits and ownership checks are product behavior, not native aliases.

## Fixture license

All original scripts, generator code, fixture artwork and recorded data in this directory are dedicated to the public domain under CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/ . This dedication does not cover the upstream application, its trademarks, or the licensed executable used to generate these outputs. No executable or upstream application source is redistributed here.

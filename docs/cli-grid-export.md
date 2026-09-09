# Exporting grid cells with the CLI

Use `--split-grid` to turn each selected frame into grid cells in a sheet, atlas or ZIP export. These formats require Pro.

```sh
pixelwall export tiles.ase --split-grid --format sheet --out tiles-sheet.png --license license.txt
pixelwall export tiles.png --split-grid --grid 0,0,16,16 --format atlas --out tiles-atlas.png --license license.txt
pixelwall export tiles.ase --split-grid --frame-range 1,3 --format zip --out tiles.zip --license license.txt
```

The saved sprite grid supplies the origin and cell size. Files without a saved grid use `0,0,16,16`. PixelWall's `--grid x,y,width,height` option overrides that definition for this export and requires `--split-grid`.

Frames stay in timeline order. Within a frame, cells go left to right, then top to bottom. Each cell retains its source frame's duration and palette. Layer selection, split layers, tags, split tags and frame ranges work with grid extraction. Reference layers stay hidden unless `--include-reference-layers` is enabled.

The grid repeats back to the cell containing the canvas origin. This can create cells starting at negative coordinates; any artwork stored there is included, and the rest is transparent. A cell is included only if its right and bottom edges fit inside the canvas. Incomplete trailing cells are omitted. If no cells fit, the command fails without writing output.

`--scale` resizes the sprite before extraction, including each cel's position and pixels. The grid definition itself remains fixed in output pixel units. For example, doubling a sprite with a 16×16 grid creates more 16×16 cells. `--trim` retains full cell dimensions. `--ignore-empty` removes fully transparent cells while preserving their original cell numbers. Packing padding and extrusion work normally.

Grid extraction does not support `--crop`, `--slice`, `--split-slices` or `--trim-sprite`. It also does not support PNG/BMP/TGA sequences, GIF or editable-project export targets. These combinations produce explicit errors. ZIP exports preserve the complete original editable project alongside the extracted assets.

## Multiple inputs

Flags apply to every input by default. With `--ordered-inputs`, grid and selection flags affect only the following input files. Grid definitions persist until replaced. `--split-grid=false` disables extraction and clears the preceding grid override.

```sh
pixelwall export --ordered-inputs \
  --split-grid --grid 0,0,16,16 terrain.png \
  --grid 0,0,8,8 items.png \
  --split-grid=false hero.ase \
  --format sheet --out assets.png --license license.txt
```

Scale, packing, filename templates and output paths remain global.

## Names and metadata

Default names include a unique cell number, such as `terrain 0 (cell 3).ase`. A single selected frame omits its frame suffix. Filename templates support `{cell}`, `{column}` and `{row}`, all zero-based, along with existing file/frame/layer/tag placeholders. Numeric suffixes control the offset and padding: `{cell001}` starts at `001`, while `{cell000}` starts at `000`. Include the frame, input name and relevant selectors when naming combined exports so every entry remains unique.

```sh
pixelwall export terrain.ase --split-grid --format sheet \
  --filename-format '{title}-{frame001}-{cell000}' \
  --out terrain-sheet.png --license license.txt
```

Each metadata frame has `source.grid` containing its index, row, column, grid dimensions, original grid definition, and cell bounds on the scaled sprite. `source.scaledCrop` gives those same bounds; after scaling, `source.crop` identifies the complete original canvas. Without scaling, `source.crop` is the cell rectangle. `spriteSourceSize` stays relative to the exported cell. ZIP source manifests also include each cell's grid information and unique entry ID.

Existing limits apply: at most 32,768 output entries and 64 Mi pixels across cells before empty-cell filtering, plus the padded-output and atlas limits. Grid cell dimensions must be positive integers no larger than 65,535; total cell area is bounded. Invalid options, duplicate entry names and licensing failures stop the command before output writes. Explicit `--out` retains its existing replacement behavior; combined grid outputs do not use `--out-dir`.

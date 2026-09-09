# Ordered CLI scale and crop

The default CLI keeps global export options. Use `--ordered-inputs` to apply selectors to subsequent inputs and each `--scale` to the inputs already listed:

```sh
pixelwall export --ordered-inputs hero.ase --scale 2 enemy.ase --scale .5 --format png --out-dir frames
```

Here hero is enlarged then reduced, while enemy is reduced once. Intermediate dimension rounding and sampling are retained; multiplying the factors is not equivalent. A leading scale with no inputs has no effect. Up to 32 scale operations are accepted, with cumulative work and image-size limits. Tilemap documents currently support one effective scale; repeated tilemap scaling fails explicitly.

The last `--crop x,y,w,h` is a final region in the scaled document's coordinates, including off-canvas cel pixels. Ordered crop works for PNG, BMP, TGA and GIF, and is rejected for sheet/atlas/ZIP output. Slice and layer selectors retain their documented input scope; a scoped slice determines the output region. Intermediate save-as actions are not emulated.

Editable exports preserve the original document and reject ordered transformations. Atlas/ZIP metadata records each scale and its before/after dimensions. Included source projects retain their original pixels and dimensions. Paid export formats retain their normal license requirements.

Original native captures in `tests/fixtures/cli-transform-order` verify scale placement, repeated rounding, linked indexed images, references, layer filtering, grid extraction and final crop pixels. Unsupported repeated tilemap sequences are retained as rejection fixtures. The reference sheet exporter ignores slice selection, whereas PixelWall keeps its explicit scoped slice selection.

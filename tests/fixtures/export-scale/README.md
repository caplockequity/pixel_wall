Original CC0 numerical fixtures for native Aseprite fractional export verification.

Run `ASEPRITE_ORACLE=/absolute/path/to/aseprite node tests/fixtures/export-scale/generate.mjs` to regenerate native files and expected PNGs. The original binary `reference.aseprite` is retained as a source fixture and contains a 3×2 raster with a documented cel-extra rectangle `{x:1.25,y:-0.5,width:3.5,height:2.25}` and a reference-layer flag. Source pixels encode x in red and y in green. Native Aseprite accepts it, preserves its precise bounds, and omits it from rendered PNGs.

The neighboring `export-color` directory supplies the original CC0 linear ICC source. See `manifest.json` for origins, primary documentation, hashes, and oracle method. Expected pixels come from the independent native executable; PixelWall code does not generate them. No vendor art, implementation code, or executable is included.

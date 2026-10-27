# Willowmere — art direction edition

This immutable release contains the revised PixelWall-authored artwork, editable projects, replacement marketing media, and the exact command batches used for the art-direction pass. No image generator or external drawing library produced the artwork. Pillow was used only for crops and comparisons; FFmpeg encoded the supplied PNG sequences into MP4 review loops.

## Open the revised projects

Use PixelWall 0.5.0 or a compatible later release and open:

- `projects/overworld.pixelwall` — 512×384, 15 layers, 12 frames at 100 ms.
- `projects/sideview.pixelwall` — 768×256, 13 layers, 12 frames at 100 ms.
- `projects/lantern-ford-showcase.pixelwall` — 768×256, 20 layers, including independently editable courier and reedling layers.
- `projects/courier.pixelwall` and `projects/reedling.pixelwall` — the revised transparent character projects, preserved from the prior release.

The complete frame set is included under `showcase/exports/` in the download. On the website, these files live under the immutable `art-direction-20261027-v1` release. The viewer preloads every animation and parallax frame before showing the artwork.

## Reproduce the revised environments

Install Node.js 22.13 or newer and download the official CLI separately from [pixelwall.dev/downloads](https://www.pixelwall.dev/downloads/pixelwall-cli.zip). Extract its files into `tools/cli/` beside this README. The package intentionally does not bundle the CLI executable. Run from this package root:

```sh
mkdir -p reproduced
node tools/cli/pixelwall.mjs inspect projects/overworld.pixelwall
node tools/cli/pixelwall.mjs inspect projects/sideview.pixelwall
node source/apply-bounded.mjs base/overworld.pixelwall source/overworld-final.json reproduced/overworld.pixelwall
node source/apply-bounded.mjs base/sideview.pixelwall source/sideview-final.json reproduced/sideview.pixelwall
node source/apply-bounded.mjs reproduced/sideview.pixelwall source/showcase-final.json reproduced/lantern-ford-showcase.pixelwall
node tools/cli/pixelwall.mjs inspect reproduced/overworld.pixelwall
node tools/cli/pixelwall.mjs inspect reproduced/sideview.pixelwall
node tools/cli/pixelwall.mjs inspect reproduced/lantern-ford-showcase.pixelwall
node tools/cli/pixelwall.mjs render reproduced/overworld.pixelwall --frame 0 --out reproduced/overworld-00.png
node tools/cli/pixelwall.mjs render reproduced/sideview.pixelwall --frame 11 --out reproduced/sideview-11.png
```

The final manifests are applied in batches of at most 100 commands and approximately 8 MB. A multi-batch run commits each completed batch separately; it is not one atomic application. The final manifests retain all commands needed to reproduce this edition from the included base projects. The showcase project is a separate editable composition containing the characters; it is not a flattened marketing image.

## Tutorial and media

`tutorial/` contains the verified 128×96 riverbank exercise and bounded Lua reed detail from the original guide. Run its commands from this root, substituting the current `tools/cli/` path. `source/character/` contains exact courier and reedling manifests plus blank-project commands. `media/` contains the revised hero stills, before/after comparisons, and the 12-second Lantern Ford review loop. In the completed release tree, `showcase/exports/` is the immutable frame set and `showcase/viewer/` and `showcase/publication/` are the local viewer and gallery. From the package root, serve with `python3 -m http.server 38472 --bind 127.0.0.1`, then open `http://127.0.0.1:38472/showcase/viewer/index.html` or `http://127.0.0.1:38472/showcase/publication/index.html`.

## Verification and limitations

The revised overworld and side view each have twelve verified frames; the side-view full-frame and near/background layers decode identically for all twelve corresponding frames before camera transforms. The current release also retains the original character projects and their prior frame verification.

The desktop MCP pass is BLOCKED by recorded ECONNRESET and EPIPE connection errors. No new desktop artwork edit, library save, artifact checkpoint, or cross-interface reopen is claimed for this edition. The original desktop library-save failure remains FAIL. CLI creation, rendering, reopening, and file delivery continued to work. Updated desktop Pro GIF/sheet export is BLOCKED; individual PNGs and externally encoded MP4 review loops are supplied. “AAA” remains a marketing target, not a measured product claim; final art approval is still recommended.

Private transcripts, machine paths, credentials, raw token accounting, and old desktop checkpoints are excluded. The `verification/` summaries contain only release-level facts and decoded-pixel evidence.

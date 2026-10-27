# Willowmere: The Lantern River

This is the public, reproducible handoff for the Willowmere showcase. It includes four editable PixelWall projects, the deterministic command manifests used to build them, a small starter tutorial, and publication media.

## Open the finished work

Open these files in PixelWall 0.5.0 or a compatible later release:

- `projects/overworld.pixelwall` — 512×384, 14 layers, 12 frames, 100 ms/frame.
- `projects/sideview.pixelwall` — 768×256, 12 layers, 12 frames, 100 ms/frame.
- `projects/courier.pixelwall` — 32×48, 3 painted layers, 20 poses: idle 0–5, walk 6–13, jump 14–19.
- `projects/reedling.pixelwall` — 40×32, 3 painted layers, 14 poses: idle 0–5, walk 6–13.

The environment scenes use linked static cels and animated canopy or water details. Both characters retain transparency and three editable paint layers.

## Reproduce the projects

Use Node.js 22.13 or newer. Download the official PixelWall CLI from [pixelwall.dev/downloads](https://www.pixelwall.dev/downloads/pixelwall-cli.zip), unpack it as `tools/cli/`, and run these commands from this folder. No npm install is required.

```sh
mkdir -p reproduced
node tools/cli/pixelwall.mjs new --width 512 --height 384 --name Willowmere-Reproduction --out reproduced/ow-0.pixelwall
node source/build-cli.mjs reproduced/ow-0.pixelwall source/overworld-02-blockout.json reproduced/ow-1.pixelwall
node source/build-cli.mjs reproduced/ow-1.pixelwall source/overworld-03-complete.json reproduced/ow-2.pixelwall
node source/build-cli.mjs reproduced/ow-2.pixelwall source/overworld-04-detail.json reproduced/ow-3.pixelwall
node source/build-cli.mjs reproduced/ow-3.pixelwall source/overworld-05-polish.json reproduced/ow-4.pixelwall
node source/build-cli.mjs reproduced/ow-4.pixelwall source/overworld-animation.json reproduced/overworld.pixelwall
node tools/cli/pixelwall.mjs render reproduced/overworld.pixelwall --frame 11 --out reproduced/overworld-frame11.png

node tools/cli/pixelwall.mjs new --width 768 --height 256 --name Lantern-Ford-Reproduction --out reproduced/sv-0.pixelwall
node source/build-cli.mjs reproduced/sv-0.pixelwall source/sideview-02-blockout.json reproduced/sv-1.pixelwall
node source/build-cli.mjs reproduced/sv-1.pixelwall source/sideview-03-complete.json reproduced/sv-2.pixelwall
node source/build-cli.mjs reproduced/sv-2.pixelwall source/sideview-04-detail.json reproduced/sv-3.pixelwall
node source/build-cli.mjs reproduced/sv-3.pixelwall source/sideview-05-polish.json reproduced/sv-4.pixelwall
node source/build-cli.mjs reproduced/sv-4.pixelwall source/sideview-animation.json reproduced/sideview.pixelwall
node tools/cli/pixelwall.mjs render reproduced/sideview.pixelwall --frame 11 --out reproduced/sideview-frame11.png

node tools/cli/pixelwall.mjs new --width 32 --height 48 --name Mira --out reproduced/courier-empty.pixelwall
node source/characters-v2.mjs
node source/build-cli.mjs reproduced/courier-empty.pixelwall source/character/courier-v2.json reproduced/courier.pixelwall
node tools/cli/pixelwall.mjs render reproduced/courier.pixelwall --frame 16 --scale 4 --out reproduced/courier-jump.png

node tools/cli/pixelwall.mjs new --width 40 --height 32 --name Mosslight-Reedling --out reproduced/reedling-empty.pixelwall
node source/build-cli.mjs reproduced/reedling-empty.pixelwall source/character/reedling-v2.json reproduced/reedling.pixelwall
node tools/cli/pixelwall.mjs render reproduced/reedling.pixelwall --frame 10 --scale 4 --out reproduced/reedling-walk.png
```

`source/characters-v2.mjs` regenerates the two character manifests from the shared palette and pixel buffers. The final project files in `projects/` are the handoff checkpoints; the commands above establish that the public manifests can rebuild equivalent editable projects in a new folder.

## Starter exercise

The `tutorial/` folder is a small 128×96 riverbank lesson. It demonstrates named layers, linked cels, one-pixel canopy motion, twelve ripple phases, and a bounded Lua detail pass:

```sh
mkdir -p reproduced/tutorial
node tools/cli/pixelwall.mjs new --width 128 --height 96 --name Riverbank --out reproduced/tutorial/empty.pixelwall
node tools/cli/pixelwall.mjs apply reproduced/tutorial/empty.pixelwall --commands tutorial/riverbank-commands.json --out reproduced/tutorial/riverbank.pixelwall
node tools/cli/pixelwall.mjs script reproduced/tutorial/riverbank.pixelwall --script tutorial/reeds.lua --timeout 10000 --out reproduced/tutorial/finished.pixelwall
node tools/cli/pixelwall.mjs render reproduced/tutorial/finished.pixelwall --frame 11 --scale 4 --out reproduced/tutorial/frame11.png
```

The Lua step only draws a detached 16×16 reed detail and exposes it on each frame. It has no file or network access. See `tutorial/README.md` for the suggested canopy-sway modification.

## Media

`media/` contains editorial crops, character details, and `overworld-showcase.mp4`. These are exported previews for review; they are not native project files. The external animated viewer used during review was a separate local JavaScript viewer, so viewer movement, camera, parallax, and reduced-motion behavior should not be attributed to PixelWall itself.

Open the [online viewer](https://www.pixelwall.dev/showcase/willowmere/viewer/index.html) or use the included `viewer/` and `exports/` folders. To view the extracted package locally, run `python3 -m http.server 38472 --bind 127.0.0.1` from its root, then open `http://127.0.0.1:38472/viewer/`. Stop the server with Ctrl-C.

See [`VALIDATION.md`](VALIDATION.md) for the evidence boundary and the fresh extraction check.

## Reproduction boundaries

The public bundle intentionally omits desktop MCP transcripts, local-library records, machine paths, credentials, and raw token-accounting logs. The original evaluation found all 58 environment and character frames matching after CLI reopening of desktop checkpoints. Large desktop library saves remained FAIL because the existing library reached its storage budget; large imports remained BLOCKED by that same budget. Successful file delivery does not change those outcomes. Desktop Pro produced the original GIFs and sheets; standalone CLI premium export was blocked without a portable Pro license. Individual PNG rendering and the editable project handoff are available here.

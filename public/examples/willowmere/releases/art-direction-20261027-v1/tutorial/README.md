# A tiny animated riverbank

Start with a blank 128×96 RGBA document. This exercise uses a small shared palette, polygon banks, an irregular tree crown, linked static cels, one-pixel canopy sway and twelve explicitly drawn ripple phases. Every image is authored with supported PixelWall commands.

From the delivery folder, with Node.js 22.13 or newer:

```sh
mkdir -p reproduced/tutorial
node tools/cli/pixelwall.mjs new --width 128 --height 96 --name Riverbank --out reproduced/tutorial/empty.pixelwall
node tools/cli/pixelwall.mjs apply reproduced/tutorial/empty.pixelwall --commands tutorial/riverbank-commands.json --out reproduced/tutorial/riverbank.pixelwall
node tools/cli/pixelwall.mjs script reproduced/tutorial/riverbank.pixelwall --script tutorial/reeds.lua --timeout 10000 --out reproduced/tutorial/finished.pixelwall
node tools/cli/pixelwall.mjs render reproduced/tutorial/finished.pixelwall --frame 11 --scale 4 --out reproduced/tutorial/frame11.png
```

Open `reproduced/tutorial/finished.pixelwall` and play **Riverbank • 1.2s**. You should see nine named layers and twelve 100 ms frames. The banks and roots stay fixed; the crown moves gently and the teal water carries pale streaks. `riverbank-preview.png` and `frames/frame-00.png` through `frame-11.png` are expected results.

The Lua script draws a detached 16×16 reed clump and attaches it to all twelve frames. It does not loop over the whole scene. Each call is bounded and local; no file or network access is used inside Lua.

Try changing the canopy's `Math.round(Math.sin(f*Math.PI/6))` to `Math.round(2*Math.sin(f*Math.PI/6))` in `riverbank-build.mjs`. Run `node tutorial/riverbank-build.mjs` to regenerate the manifest, then repeat the sequence in a new output folder. Compare whether two-pixel movement feels too windy.

To render every frame at once, use `export finished.pixelwall --format png --frame-range 0,11 --out-dir NEW_EMPTY_FOLDER`. A plain PNG export defaults to frame zero. GIF/sheet exports require Pro; individual PNG frames are sufficient for this lesson.

The final tutorial was independently rebuilt and checked for a real canopy cel and a Lua reed cel in every frame. An earlier draft omitted those exposures; that authoring mistake was corrected before delivery.

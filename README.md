# PixelWall

A tactile pixel-art studio built around a simple metaphor: project a reference
onto a wall, mount a crisp pixel frame over it, and draw frame by frame.

## Features

- Pencil, eraser, contiguous fill, and color picker
- 8×8 through 256×256 bitmap canvases with centered resize
- Projected image references with adjustable opacity, scale, position, and 1:1 pixel locking
- Automatic square-sprite-sheet detection with exact previous/next sprite alignment
- One-click import of detected sprite sheets into editable animation frames
- Integer workspace pixel sizing and a transparency checker locked to canvas cells
- Named animation clips, frame reordering, per-frame timing, looping modes, and onion skin
- Four-layer cel workflow with visibility, locking, opacity, naming, and reordering
- Rectangular selection with move, copy/paste, clear, and horizontal/vertical flips
- Per-frame export pivots, named selection slices, seamless 3×3 preview, and linked-edge drawing
- A compact tilemap lab that paints animation frames as reusable level tiles
- Stroke-level undo and redo
- Compact local autosave and portable `.pixelwall` project save/open files
- Native transparent frame PNGs and configurable sprite packages with horizontal, vertical, or grid sheets, padding, transparent-edge trimming, individual PNGs, and Phaser/Pixi/Aseprite-style JSON
- Mouse, touch, and keyboard drawing

## Run locally

```bash
npm install
npm run dev
```

Use `npm run build`, `npm run lint`, and `npm test` to validate the project.

## GitHub and Vercel

PixelWall stores projects in the browser and portable files; it does not depend
on a hosted database, account system, or provider-specific API. The repository
also includes a standard Next.js/Vercel build alongside the current Sites build.
After pushing it to GitHub, import the repository in Vercel; `vercel.json` selects
`npm run build:vercel` automatically.

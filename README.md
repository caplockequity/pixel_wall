# PixelWall

A tactile pixel-art studio built around a simple metaphor: project a reference
onto a wall, mount a crisp pixel frame over it, and draw frame by frame.

## Features

- Pencil, eraser, contiguous fill, and color picker
- 8×8 through 256×256 bitmap canvases with centered resize
- Projected image references with adjustable opacity, scale, position, and 1:1 pixel locking
- Automatic square-sprite-sheet detection with exact previous/next sprite alignment
- Integer workspace pixel sizing and a transparency checker locked to canvas cells
- Animation frames, playback speed, duplication, deletion, and onion skin
- Stroke-level undo and redo
- Compact local autosave, native transparent frame PNGs, and sprite-sheet ZIP packages with JSON timing metadata
- Mouse, touch, and keyboard drawing

## Run locally

```bash
npm install
npm run dev
```

Use `npm run build`, `npm run lint`, and `npm test` to validate the project.

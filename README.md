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
- A compact tilemap lab that paints frames as reusable level tiles and exports a dedicated Tiled-compatible map package with a tileset, flattened preview, and stable frame mapping
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

## PostHog analytics (optional)

PixelWall works normally without analytics configuration. To enable PostHog,
copy `.env.example` to `.env.local` and set the two public variables:

```bash
cp .env.example .env.local
```

- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` is the **project token** from the PostHog
  project settings. It is intentionally public; do not use a personal API key.
- `NEXT_PUBLIC_POSTHOG_HOST` must match the project's region: use
  `https://us.i.posthog.com` for US Cloud or `https://eu.i.posthog.com` for EU
  Cloud.

Browser events use the first-party `/beam` relay in
`app/beam/[...path]/route.ts`; the host variable still selects the US or EU
upstream. The relay strips cookies, authorization, referrer, and other app
headers before forwarding. It improves delivery but does not bypass consent,
Do Not Track, or Global Privacy Control.

Restart the development server after changing `.env.local`. For an OpenAI Sites
or Vercel deployment, add both variables in that project's environment-variable
settings for each environment where analytics should run, then redeploy. Leaving
the token unset is supported and keeps PostHog disabled.

Analytics and session replay require an explicit visitor opt-in. A saved opt-out,
Do Not Track, or Global Privacy Control keeps capture disabled. Pixel artwork,
uploaded references, project and layer names, animation and slice names, and
notices are excluded from replay/autocapture. Custom event properties use strict
per-event allowlists containing only coarse counts, dimensions, timings,
booleans, and operation/result enums—never names, filenames, colors, pixels, or
uploaded content.

The custom event taxonomy is intentionally small:

- Lifecycle and guidance: `editor_loaded`, `quick_guide_viewed`,
  `quick_guide_dismissed`
- Editing: `canvas_edit_committed`, `project_structure_changed`,
  `feature_toggled`, `animation_playback_changed`, `tilemap_edit_committed`
- References: `reference_loaded`, `reference_load_failed`, `reference_action`,
  `sprite_sheet_imported`
- Storage and recovery: `project_file_operation`, `autosave_failed`,
  `autosave_recovered`
- Export funnel: `export_started`, `export_completed`, `export_failed`,
  `export_blocked`
- Privacy choice: `analytics_consent_updated`

## GitHub and Vercel

PixelWall stores projects in the browser and portable files; it does not depend
on a hosted database, account system, or provider-specific API. The repository
also includes a standard Next.js/Vercel build alongside the current Sites build.
After pushing it to GitHub, import the repository in Vercel; `vercel.json` selects
`npm run build:vercel` automatically.

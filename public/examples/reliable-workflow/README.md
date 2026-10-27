# Reliable Riverbank workflow starter

This small, deliberately bounded example is a reusable PixelWall workflow: a 96×64 riverbank scene, five named layers, four linked static layers, an explicitly animated canopy, and a named 12-frame clip. It is intended to make the reliable editing workflow easy to inspect and reproduce, not to benchmark a large scene.

## Inspect and reproduce

From the repository root:

```sh
node public/examples/reliable-workflow/build-example.mjs
node app/cli.mjs inspect public/examples/reliable-workflow/build/reliable-riverbank.pixelwall
node scripts/verify-workflow-example.mjs
```

The generated project, manifest, Lua pass, PNG frames, and this playback-only viewer are all safe to download as a starter. The project is the editable source of truth; PNGs are review renders.

The included `reedpass.lua` demonstrates a small bounded native/Lua pass. Keep broad areas as rectangle/shape commands and reserve pixel-by-pixel Lua for compact accents. Run it only in an approved output folder, then inspect and reopen the resulting project before continuing.

## Reliable agent sequence

1. Read the project and record its revision before editing.
2. Apply a small batch of named commands; validate the response and revision after each batch.
3. Save a checkpoint/export into an approved folder. Treat “file generated” and “download started/completed” as separate events.
4. Reopen the checkpoint and render each frame. If a request times out, retry the same idempotency key only when the receipt says it is safe; otherwise read the current revision first.
5. For cancellation, report only the server receipt and final revision. This starter does not claim a cancellation test was performed.
6. For a late change, operate on a COPY. The compact recolor example below changes only the left river bank; pixels outside that rectangle must remain byte-for-byte unchanged.

## Late compact recolor on a copy

The public command shape is:

```json
{"type":"selection.replaceColors","selection":{"type":"rect","x":35,"y":0,"width":4,"height":64},"mapping":{"#b59b62ff":"#d6b875ff"},"frameIds":["frame-1"]}
```

Apply it to a copied document, render before/after, and compare decoded RGBA pixels. Only the selected bank may change. Keep the original checkpoint untouched so a late revision can be discarded safely.

## MCP / desktop handoff

Use the same sequence through the MCP or desktop bridge: read → validate → apply → checkpoint → reopen → render. Include the document revision and checkpoint path in the handoff. The viewer is intentionally playback-only, with pause and reduced-motion controls; it is not an editor or a substitute for reopening the editable project.

# PixelWall 0.6.0 — reliable agent workflows

PixelWall 0.6.0 makes long, agent-driven artwork sessions easier to observe,
recover, and verify. This release is source-ready documentation; it is not a
claim that the web or desktop packages have been published.

Highlights:

- Long command batches report validation, staging, committing, and completion
  phases with processed counts, revisions, and phase timings.
- Operation receipts survive reconnects and distinguish completed, failed,
  cancelled, and unknown outcomes. A closed MCP connection is still an
  upcoming hardening item: EPIPE must be handled without turning a completed
  editor operation into a transport crash.
- Local library persistence, generated artifacts, verified disk checkpoints,
  and temporary/file-backed documents are separate states. A full library does
  not prevent a verified project checkpoint or a bound-file save.
- Checkpoints carry document/revision identity, byte count, SHA-256, disk
  delivery status, and optional reopen verification.
- Generated export artifacts can be listed, read in bounded chunks, saved to
  the approved desktop folder, and removed independently of editable projects.
- Animation review provides frame playback, contact-sheet previews, anchored
  layer diagnostics, wrap comparisons, and bounded review output.
- Water-scene and recipe workflows remain editable and preserve named layers.
- Export planning reports the actual frame selection, dimensions, timings,
  memory estimate, entitlement, predicted files, and output conflicts before
  writing. PNG/current-frame, GIF/clip, and whole-project plans are distinct.
- Project image records use bounded lossless compression with legacy reads,
  content-hash deduplication, logical-versus-encoded usage, and a persisted
  16 MiB–1 GiB user budget.

Release gate: run the full web build and tests, the desktop packaging checks,
the native MCP smoke test, and the signed/notarized macOS workflow before
calling 0.6.0 released.

# PixelWall 0.6.0 — reliable agent workflows

PixelWall 0.6.0 makes long, agent-driven artwork sessions easier to observe,
recover, and verify. The following is the proposed final changelog; package
publication is tracked separately by the release checklist.

Highlights:

- Long command batches report validation, staging, committing, and completion
  phases with processed counts, revisions, and phase timings.
- Operation receipts survive reconnects and distinguish completed, failed,
  cancelled, and unknown outcomes. Closed MCP connections now have explicit
  EPIPE handling; assembled transport validation remains part of the release
  checklist.
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

## Release checklist

- [ ] Full web lint, tests, and `npm run build:vercel`.
- [ ] Desktop build, native MCP smoke, and production export/reopen checks.
- [ ] Closed-connection/EPIPE assembled transport validation.
- [ ] Signed/notarized macOS arm64 and x64 packages, plus SHA-256 verification.
- [ ] Vercel production deployment and public-route audit.
- [ ] GitHub release assets and provenance reviewed before publication.

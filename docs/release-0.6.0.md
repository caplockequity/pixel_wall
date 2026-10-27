# PixelWall 0.6.0 — reliable agent workflows

PixelWall 0.6.0 makes long, agent-driven artwork sessions easier to observe,
recover, and verify.

Highlights:

- Long command batches report validation, staging, committing, and completion
  phases with processed counts, revisions, and phase timings.
- Operation receipts survive reconnects and distinguish completed, failed,
  cancelled, and unknown outcomes. Closed MCP connections no longer crash the
  desktop with EPIPE, and disconnect cleanup cancels each owned operation once.
- Temporary projects show their actual persistence state, remain available
  when switching tabs, and warn before browser close when any retained work
  still needs a checkpoint.
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

## Validation

- Full suite: 3,380 passing tests, followed by passing targeted coverage for retained-tab close guards and release metadata.
- Lint: zero errors; two existing warnings.
- Production Next/Vercel build, standalone/CLI packaging, public-route audit, desktop-MCP/CLI checkpoint/reopen flow, and browser temporary-project switching/restoration passed.
- Closed-connection/EPIPE tests passed under Node and Electron's embedded runtime.
- All four desktop candidates passed package validation. Mac arm64 and x64 passed Developer ID signature, Apple notarization, stapling, and local Gatekeeper checks. Uploaded package, checksum, updater, and validation files matched local SHA-256 digests.
- The signed arm64 app process launched without logged errors. Its final visual check was unavailable because the Mac was locked. Windows/Linux installer execution was not tested locally.

Desktop packages were built from `cc9321455e993f525329bfc9636424f474f06515`.
The website also includes the separately published Willowmere art-direction update and final download metadata.

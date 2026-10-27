# 0.6.0 workflow acceptance matrix

This matrix records the current implementation boundary. “Implemented” means
covered by source and focused tests; it does not mean the production web or
desktop release has been published.

| Feedback / acceptance item | Current state | Evidence or limit |
| --- | --- | --- |
| Progress for large edits | Implemented | Phase callbacks report validation, staging, committing, completed, counts, revision, and timings. |
| Durable operation receipts | Implemented | Request-key receipts and wait/poll APIs distinguish unknown outcomes. |
| Closed MCP connection handling | Upcoming | EPIPE/closed-connection behavior still needs final transport hardening and smoke coverage. |
| Agent/Lua workflow guidance | Implemented in workflow materials | Bulk commands, bounded Lua, temporary mode, and checkpoint boundaries are documented. |
| Export handoff truthfulness | Implemented | Generated, persisted, requested, and verified disk states are separate; browser download completion is never asserted. |
| Persistent generated artifacts | Implemented | Metadata, bounded reads, SHA-256, expiry, save/remove operations, and reload-safe storage. |
| Compressed editable backups | Implemented | Lossless tagged wire format, zlib-v1 records, legacy reads, deduplication, bounded decode, and logical/encoded accounting. |
| Configurable library budget | Implemented | Persisted 16 MiB–1 GiB setting; reductions below protected usage reject without deletion. |
| Full-library recovery | Implemented with close guards | Verified checkpoints, temporary documents, file-backed documents, retained-document limits, and rollback on bind failure. |
| Animation review | Implemented | Playback, frame/contact-sheet review, anchored diagnostics, wrap comparisons, and render callbacks. |
| Recipes / water scenes | Implemented | Generated scenes remain editable and use named layers; performance claims are intentionally absent. |
| Native and web export planning | Implemented, release verification pending | Plans validate selectors, frame counts, dimensions, filenames, conflicts, entitlement, and output mode. |

Before release, verify the assembled web build, desktop build, native MCP
smoke, production export/reopen flows, and signed/notarized artifacts. A green
focused test suite alone is not a release claim.

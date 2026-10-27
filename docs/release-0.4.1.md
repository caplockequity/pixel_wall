# PixelWall 0.4.1 — Observable agent edits and compact backups

- Start long command batches without holding a client request open. Poll commands processed, total commands, revision, completion, and errors; recover the latest operation after a caller timeout. Edits commit once or roll back as a whole.
- Keep the editor responsive between command chunks and show progress in the editor. Pointer activity cannot interfere with an in-progress command transaction.
- Generate exports without requesting a browser download. Retrieve page-local file URLs and metadata, with separate generation and per-file download-request status. Browser download completion is explicitly unobservable.
- Save losslessly compressed `.pixelwall` backups in the web editor, desktop app, and CLI. Existing JSON projects still open. Update older installations before opening the new compact format; CLI JSON export remains available.
- Follow a tested 600 × 350 river tutorial: 40 shape commands, named layers, a small Lua detail, progress recovery, export handoff, and editable backups.

The shared editor changes apply to the website, standalone browser download, and desktop app. The CLI download includes the compact format. Existing desktop users can choose **Check for Updates**, download 0.4.1, and choose **Restart to update**.

These improvements make longer agent-assisted edits easier to observe, recover, and validate while keeping projects editable across the web editor, desktop app, and CLI.

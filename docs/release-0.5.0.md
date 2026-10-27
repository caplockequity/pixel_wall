# PixelWall 0.5.0 — Local agent workflows and editable scene components

- Added an opt-in local MCP launcher for a running desktop window. Agents can inspect projects, validate and apply bounded command batches, poll progress, cancel work, capture review previews, export files, and read or save verified generated artifacts through the user-selected export folder.
- Added retry-safe browser and desktop automation with request keys, bounded operation retention, explicit progress reporting, cancellation at command boundaries, and preflight validation that leaves the live document unchanged.
- Added deterministic editable scene components for trees, rocks, river banks, bridges, and terrain accents. Components use named layers, shared palette roles, bounded sizes, and reproducible seeds; the woodland crossing example is included as an editable project, command manifest, and PNG preview.
- Added before/after preview review and durable generated-file handoff metadata with checksums, bounded reads, expiry, and local storage limits. Browser exports continue to distinguish file generation from an unobservable browser download completion.
- Updated the web editor, standalone browser bundle, CLI, and desktop app guidance for compact project backups, legacy JSON reopening, local MCP setup, scene components, and agent recovery.

The local MCP connection requires Node.js 22.13 or newer, the downloaded CLI bundle, a running PixelWall desktop window, the Help-menu local-agent opt-in, and a user-selected export folder. It has no cloud or remote endpoint. Release artifacts and checksums are published separately in the desktop release feed after platform validation.

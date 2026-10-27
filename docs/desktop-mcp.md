# Local desktop MCP

PixelWall 0.5.0 includes an MCP launcher for a running PixelWall desktop window. The connection is local to the computer and is closed by default. It does not provide a cloud API or send artwork to PixelWall servers. Desktop MCP usage reporting is a separate Help-menu preference, disabled by default; opting in sends only anonymous operation totals and fixed result categories to PixelWall.

Open the desktop app’s Help menu and enable **Allow local agent connection**. Choose the export folder when prompted. PixelWall shows the approved folder and the launcher command:

```sh
node pixelwall-mcp.mjs
```

Configure your MCP client to run that command from the unpacked CLI download. The launcher reads the authenticated session file created by PixelWall and speaks the official MCP stdio transport. The session is limited to the open editor window and one controller at a time. Disable the same Help-menu option, close the window, or stop the MCP client to disconnect.

The server discovers the current `window.pixelwall` tool metadata at runtime. It supports document inspection, project selection and import, command validation and application, progress polling and cancellation, preview capture, undo and redo, saving, export handoff, and durable artifact listing and reading. `pixelwall_save_artifact` writes a verified artifact into the folder selected in PixelWall; an MCP client cannot choose an arbitrary filesystem directory. Generated files are temporary local handoff records: they expire after 24 hours and the store retains at most 64 files or 128 MiB total, with a 64 MiB per-file limit. `pixelwall_read_artifact` returns at most a 1 MiB chunk and includes checksum metadata for verification.

For large edits, use `wait: false`, poll the returned operation with `pixelwall_operation`, and use `pixelwall_cancel` when needed. A completed operation reports its revision and command count. Cancellation is checked between commands; it is not a promise about the runtime of an individual command. A failed or disconnected operation does not commit partial artwork. Use a unique `requestKey` when a caller may retry the same apply call: an identical retry reuses the retained result in that editor session, while a mismatched or expired key is rejected so an agent can inspect before deciding whether to start a new edit.

The launcher requires Node.js 22.13 or newer. This integration controls a running local desktop window only. It is unavailable to hosted browser sessions and does not accept remote connections.

The Help menu's **Share anonymous MCP usage** setting is independent from **Allow local agent connection**. Before enabling it, PixelWall explains that reports contain only the operation, result, app version, and limited preview or artifact-persistence categories. Reports never contain artwork, file paths, file contents, IDs, agent names, or error text. Turning the setting off cancels pending reports; the app keeps no offline queue and does not backfill earlier activity. The local CLI, standalone editor, and hosted browser telemetry use separate reporting paths.

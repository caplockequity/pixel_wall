# PixelWall 0.5.1 — Anonymous MCP operation reporting

PixelWall 0.5.1 adds the optional measurement layer for the local desktop MCP
workflow. It is disabled by default and is separate from permission to allow a
local agent connection.

- Choose **Help → Share anonymous MCP usage** to opt in, or turn it off from the
  same menu. Disabling stops reporting and cancels pending requests.
- Reports contain fixed operation and outcome categories, with changed-edit,
  preview-kind, and artifact-persistence fields where applicable. They contain
  no artwork, scripts, filenames, paths, agent names, model names, raw errors,
  or persistent identifiers.
- Reports have no offline queue, retry, or backfill. CLI and standalone use
  remain untracked, and PixelWall 0.5.0 and earlier do not have this control.
- The web editor now separates validation, previews, project operations,
  artifact actions, failures, cancellations, generated exports, and retrieval
  storage outcomes in its anonymous aggregate measurement. Verified disk saves
  are reported only by the desktop MCP artifact-saving tool.

This release keeps the local MCP editor behavior and existing 0.5.0 projects
compatible while making optional workflow coverage visible in the operations
dashboard.

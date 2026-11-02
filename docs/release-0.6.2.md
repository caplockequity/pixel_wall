# PixelWall 0.6.2 — anonymous CLI and MCP usage reporting

PixelWall 0.6.2 adds bounded, anonymous usage reporting for the packaged CLI and
desktop MCP connection so we can understand which automation operations are being
used.

Highlights:

- Packaged CLI and desktop MCP reporting is enabled by default with a clear first-use explanation and independent opt-outs.
- Existing desktop opt-outs remain off; unreadable or corrupt preferences fail closed.
- Reports contain fixed operation and outcome categories, app version, platform, architecture, duration bucket, output format where applicable, changed/file-written/verified flags, and approximate first-or-returning reporting-day labels.
- Reports never include artwork, file names, paths, arguments, scripts, agent names, email addresses, persistent identifiers, or raw errors. Delivery is best effort with no offline queue or backfill.
- The agent analytics dashboard now separates CLI operation totals, outcomes, changed edits, written and verified outputs, reporting days, versions, formats, and desktop MCP reporting days.

The CLI can disable one command with `--no-telemetry`, persist the choice with
`telemetry disable`, or use `PIXELWALL_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`.
Desktop MCP reporting can be changed from Help → Share anonymous MCP usage.

## Validation

- Full test suite: 3,445 passing tests with concurrency limited to two.
- Focused reporting and ingestion tests: 31 passing tests.
- Production preview build passed, including the CLI download and native reporting route.
- Packaged CLI 0.6.2 smoke testing captured expected new, changed-edit, and verified-export reports locally; saved opt-out stopped later reports. No synthetic production events were sent.

Windows and Linux packages passed structural and architecture validation. Both Mac signing jobs passed Developer ID signature verification, Apple notarization, stapling, and Gatekeeper checks. Final downloaded packages and updater metadata are verified before publication. Windows and Linux installers remain unsigned; native installation testing on those systems was not performed.

Desktop packages were built from `24b56295ae327c847304c5dde30bf135aedeaff0`.

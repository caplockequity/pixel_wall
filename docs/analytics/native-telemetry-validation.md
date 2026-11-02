# Native reporting validation

Live validation is an explicit operator action. Routine tests keep reporting disabled. The live harnesses run real edits and PNG exports against disposable projects, then verify the corresponding PostHog events. They do not manufacture analytics successes.

## Separation

`PIXELWALL_TELEMETRY_TEST_RUN` must contain a new canonical lowercase UUIDv4 for each validation run. Supported reporters attach this value as `test_run`; the native collector validates it and assigns `environment=test`. A missing marker retains ordinary production behavior. A present but invalid marker disables client reporting and is rejected by the collector. Existing opt-outs still apply. No caller-supplied `environment` is accepted.

The production dashboards and weekly review require both `analytics_schema_version=2` and `environment=production`. Validation events are visible only in the [private Internal telemetry validation dashboard](https://us.posthog.com/project/333211/dashboard/2294250) or an explicit `environment=test` query. Unfiltered PostHog event lists still contain both categories. Never count test runs as agents, customers, installations, or retention.

The UUID identifies a disposable operator run, not a user or device. Do not persist it in a normal client preference or reuse it for customer activity. Historical unmarked testing cannot be separated retroactively by this change.

## Local checks

First verify DevStorage is mounted and writable. Use fresh artifact directories under `/Volumes/DevStorage/Builds/pixelart/` and the existing external dependency caches. Do not run the live checks against personal artwork or the normal desktop profile.

- `scripts/test-cli-live-telemetry.mjs` runs a packaged CLI: new project, changed drawing command, PNG export with verification, and output verification. Supply `--run-id`, `--artifacts`, and `--cli`. Dry mode disables network reporting. `--live` requires a client that advertises test-reporting support before executing any reportable command.
- `scripts/test-mcp-live-telemetry.mjs` starts an isolated Electron fixture with the released renderer assets, the actual MCP bridge and stdio server, and the test-aware telemetry reporter. Supply `--run-id`, `--artifacts`, `--asar`, and `--electron`. It performs a changed edit, generates a PNG, saves the artifact, and checks the result. Dry mode uses a local collector; `--live` forwards only correctly marked telemetry to the production collector. The fixture cleans up its own process and profile.

The desktop 0.6.4 binary predates test-mode support. Do not set this variable on that installed binary and assume its events are isolated. The MCP validation fixture uses the real 0.6.4 editor and operation path with the new reporting label; it is not a new signed desktop release or a test of the user's installed app's settings.

## Evidence required for a pass

1. The drawing command actually changed the document and the generated PNG contains the expected pixels.
2. The native collector accepted the actual operation reports. A 204 alone does not prove PostHog ingestion.
3. PostHog contains the run's `apply` event with `changed=true` and a successful `export`. CLI output additionally reports `wrote_files=true` and `verified=true`; MCP artifact save reports success after checking file bytes/hash.
4. Every event for the run has `environment=test`; the same run has zero events under `environment=production`.
5. Production native counts remain unchanged by the test. Keep the dated aggregate receipts outside the repository; retain only definitions and tooling here.

Do not retry a live run automatically after an ambiguous network response. Inspect PostHog first; a lost response may still have delivered the event. If another run is needed, use a fresh UUID and artifact directory.

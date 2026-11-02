# PixelWall analytics metric definitions

This is the reference for interpreting the PixelWall analytics dashboards. It is deliberately narrower than a product-usage database: the public site is consent-based, native clients send anonymous aggregate events, and no event is a person, account, or verified AI agent.

## Scope and evidence

- Last known PostHog project: **333211** (from the prior authenticated workspace review; re-check before treating this registry as a live inventory).
- Last known dashboard: [Agents & AI referrals](https://us.posthog.com/project/333211/dashboard/2262819). The URL and ID are retained for traceability, not as proof of current access. Other dashboard IDs in `posthog-dashboards.json` are query/catalog keys until they are checked in the authenticated workspace.
- Real-usage queries require both `analytics_schema_version=2` and `environment=production`. Explicit native validation runs use schema 2 with `environment=test`; never combine them with production totals.
- Workflow attribution was implemented in commit `9509c87072571c39aea2405a2803062727290596` (2026-10-29). The exact first production-serving timestamp is not recorded here, so `cutover_date` remains unset until a deployment log confirms it. Never backfill earlier events.
- Packaged CLI/MCP reporting was implemented in commit `24b56295ae327c847304c5dde30bf135aedeff0` (2026-11-02) and only exists in updated clients. A missing event can mean an old client, a disabled preference, offline delivery, or no use. These commit dates establish implementation availability, not the first production-serving timestamp.

## Definitions

| Metric | Count as | Do not infer |
| --- | --- | --- |
| **Activated** | A consenting browser editor reaches its first meaningful changed command after `editor_loaded`; metadata-only changes do not count. Native automation activation is counted only through its explicit operation events. | A unique person, completed project, or successful export. Browser activation is not available when consent is declined. |
| **Exported** | `export_completed` / an aggregate export outcome after output generation succeeds. The event means PixelWall produced an output. | A download, file save, import into another app, or paid purchase. A blocked/failed export is a separate outcome. |
| **Downloaded** | A download CTA click is a click. A release asset request is an asset request. A completed installation or first successful launch requires client-side/update-health evidence. | That a clicked file reached disk, was installed, or was opened. GitHub/Vercel asset totals are not the same as site CTA totals. |
| **Returning** | A native client reports `usage_day: returning` when its local marker contains an earlier UTC calendar day and it reports again on a later UTC day. This is a local reporting-day label, not a stable identity. | Retention, DAU, a returning person, or a CLI-to-MCP user journey. Fresh native event IDs intentionally prevent person-level joins. |
| **Automation edit** | A successful changed automation operation (`automation_edit_completed` or native equivalent) with a counted operation. | A unique agent, an AI-generated edit, or a human-free session. Hosted and native surfaces remain separate. |
| **Successful export** | The export outcome is `completed`/`success` and output generation passed. `persisted` means artifact retrieval storage received it; it does not prove a disk save or browser download. | A verified customer deliverable or a paid entitlement. |

## Source and coverage rules

Browser PostHog events require the applicable consent. Aggregate website and native events use fresh identifiers and are suitable for totals and outcome breakdowns only. Referrals are immediate fixed categories, not persistent campaign attribution. `workflow_page` is one of `tracing`, `tileset`, `animation`, or `sprite_sheet`; it is not a URL.

Native CLI and MCP events carry platform, architecture, app version, operation, outcome, duration bucket, and reporting-day label. CLI `wrote_files` means the command reported a file write; it is not a server-side proof of disk state. They do not carry artwork, paths, command arguments, email addresses, agent IDs, or a cross-client identifier. Native HTTP 204 means the endpoint accepted the request shape; it does not prove that PostHog was configured or that an event was ultimately delivered.

Desktop health launch events use `launch_kind` values `first`, `same_version`, `version_changed`, and `after_update`. `after_update` is reserved for a launch matching the pending install target; `version_changed` describes a manual or otherwise observed version change. A bounded semantic `target_version` may accompany non-launch updater operations. Neither field proves that a download completed or that an installation succeeded unless the corresponding updater outcome is also present.

All reviews must exclude local tests, CI fixtures, preview deployments, internal dogfooding, and events before the relevant production cutover. Native test runs must set `PIXELWALL_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`); browser tests must use a non-production host or decline analytics. Because anonymous native events have no stable identity, later dogfooding cannot be reliably removed from an aggregate total; record the test window and suppress it at source. Keep exclusions documented with the dashboard query or review note rather than deleting raw data.

An explicit live reporting validation is the exception to suppressing native test reports: use the guarded harnesses described in [native telemetry validation](native-telemetry-validation.md). Supported clients attach `test_run` only when `PIXELWALL_TELEMETRY_TEST_RUN` contains a fresh canonical UUIDv4. The collector validates that marker and assigns `environment=test`; clients cannot supply an environment directly. Invalid markers fail closed. Test IDs identify disposable validation runs only and must never be used as customer or installation identifiers. The released desktop 0.6.4 binary predates this test mode; do not assume that setting this variable on an older client isolates its traffic.

## Weekly review contract

Review the live registry and confirmed dashboard once per week using seven complete UTC calendar days compared with the preceding seven complete UTC days. Notify only on a meaningful change: a new operation/outcome category; an absolute change of at least 5 events and at least 25% in a count; an edit-to-export conversion change of at least 10 percentage points with at least 20 activated sessions/events in both periods; a blocked/failed export rate change of at least 10 percentage points with at least 20 attempts in both periods; a change in native reporting-day coverage of at least 5 reporting days; or a verified payment/refund change. Desktop update failures are reported as categorized counts; do not derive a reliable failure rate from them because download/install attempts can be unmatched. For low counts, report the counts and qualify the percentage rather than calling a large percentage dramatic. If there is no meaningful change, leave the review quiet.

For every reported number, record the date range, event family, surface (`browser`, `hosted automation`, `desktop MCP`, or `CLI`), consent/coverage qualifier, and whether it is a total, outcome count, or verified business amount. Never present a native reporting day as a user count. Never join usage events to customer email, Stripe customer IDs, or support records.

The business scorecard should use verified payment/refund records and report gross purchases, refunds, and net revenue by currency and period. Checkout starts, dialog views, and entitlement claims are intent/ownership signals and must remain separate from payment proof. Desktop update-health metrics should similarly distinguish download, install attempt, failure category, and successful post-update launch.

Desktop health starts with 0.6.4. A first reported launch is not a new installation. An upgrade from an older uninstrumented client cannot report its earlier download/install attempt; matching post-update launches become observable for update attempts initiated by 0.6.4 or newer. Neither missing reports nor an unmatched attempt prove a failed restart.

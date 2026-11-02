# PixelWall weekly analytics review

Run this review against the authenticated dashboards and the local scorecard. It is read-only except for one explicitly identified write: refresh the Stripe snapshot text tile recorded in `docs/analytics/posthog-live-registry.json` on the private Business scorecard. Do not edit production dashboards, alter queries, deploy code, or notify other people from the review.

## Window and quality gate

Use seven complete UTC calendar days, compared with the preceding seven complete UTC calendar days. Do not include the current partial day. Record both ISO date ranges in the result.

Before comparing numbers, record:

1. The PostHog project and dashboard IDs from `docs/analytics/posthog-live-registry.json`.
2. Whether each dashboard loaded and whether its query was actually validated/rendered.
3. The event surface (browser, hosted automation, desktop MCP, CLI, desktop health) and consent/coverage qualifier.
4. Any release, test, dogfooding, outage, or instrumentation change that overlaps the window. Native tests must have telemetry disabled at source; anonymous native dogfooding cannot be removed after ingest.

If a dashboard or source is inaccessible, record that once as `blocked` with the exact missing access and stop retrying it during this run. Do not turn an access gap into a zero and do not repeat the same notification every week without a state change.

## Review order

Check the confirmed PostHog dashboards first. Review activated → export movement, export blocked/failed outcomes, workflow-page signals, hosted automation edits/exports, CLI and MCP operation outcomes, and the desktop health operations (`launch`, `update_download`, `update_install_attempt`, `update_failure`). For health, separate update failure categories, exclude cancelled outcomes, and inspect `launch_kind=after_update` as the post-update launch signal. Treat `version_changed` as a manual/observed version change; `after_update` requires the pending target match. `target_version` is optional and bounded to a semantic version on non-launch operations.

Use the Vercel Observability notebook only for server-side traffic and request/error context: [PixelWall observability notebook](https://vercel.com/caplock/pixel-wall/observability/notebooks/d19d3cca-91ac-468c-8d17-a17609679bb5). It cannot identify a person or prove that a bot was an AI agent.

Use the verified Stripe scorecard for business numbers. Use the connected Stripe definitions in `stripe-scorecard.md`. Query each review-window checkout cohort separately. Refresh a fixed historical cohort (partition into intervals of at most 366 days for the local API tool) to catch changes to old orders, and query successful refunds by refund-created date for each review window. Do not treat current cumulative refunds on a checkout-created cohort as refunds issued that week. Report paid orders, complimentary orders, refunds, gross amount, refunded amount, and net amount by currency. Checkout starts, dialog views, and entitlement claims remain intent/ownership signals; never call them revenue. Preserve the source currency and mode (live/test). After the aggregate result is verified, update only the identified Business scorecard text tile with the new dated snapshot, cohort bounds, as-of UTC time, and source caveats. Preserve the two copied product-intent insight tiles, dashboard privacy, and all managed markers.

The current baseline artifact is stored outside the repository at `/Volumes/DevStorage/Builds/pixelart/scorecard-health-20261102.json`. Keep the next dated aggregate report beside it; do not put customer email, Stripe IDs, payment intents, or raw checkout payloads in the artifact.

## Meaningful-change gate

Notify only when one of these gates is met:

- A count changes by at least 5 events and at least 25% from the preceding period.
- A conversion rate changes by at least 10 percentage points with at least 20 events in each denominator.
- A failure rate changes by at least 10 percentage points with at least 20 attempts in each denominator.
- Native reporting-day coverage changes by at least 5 reporting days.
- A verified purchase, refund, or receipts-after-refunds amount changes.

For a denominator below the minimum, show the counts and label the percentage as low-volume; do not describe a large percentage as a dramatic trend. If no gate is met, leave the review quiet.

## Output

Save a concise dated result with: the two UTC windows, source availability, qualified counts/rates, verified business totals by currency, meaningful-change decisions, and one sentence on instrumentation coverage. Keep it aggregate and anonymous. Do not join usage to email, customer, support, or account records.

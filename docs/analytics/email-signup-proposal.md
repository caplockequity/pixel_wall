# Email interest signup proposal

PixelWall currently has no newsletter, waitlist, CRM, or hosted account system.
Stripe collects an address for checkout and support, but a purchase address is not
marketing permission and must remain a purchase/support record.

## Small first experiment

Add one optional signup near the agent guide/download area, with a second placement
below the homepage demo only after a meaningful edit or export. Do not gate editing,
downloads, MCP, CLI use, or exports.

Suggested copy:

> Get occasional PixelWall updates: new CLI/MCP releases, agent examples, and
> useful pixel-art workflow notes. Unsubscribe anytime.

Use an unchecked marketing-consent action and collect only the email address. If we
later offer separate product and agent updates, make them separate choices rather
than assuming one grants the other.

## Privacy and operations

- Use double opt-in, unsubscribe, deletion/export handling, and basic abuse
  protection before publishing the form.
- Keep the email only in the selected email provider; never send it to PostHog or
  attach it to analytics IDs, downloads, purchases, or artwork events.
- Update the privacy notice with provider, purpose, retention, and processor details.
- Start with one provider-backed list and a simple success/failure state. Avoid a
  custom customer database until signup demand justifies it.

The first useful metric is completed opt-in subscriptions by placement, not raw form
opens. That metric should be kept separate from anonymous usage and purchase data.

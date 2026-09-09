# PixelWall

A local pixel-art and animation studio. `/editor` is the new workbench;
`/editor/classic` preserves the original projector and tracing workspace.
PixelWall contains no AI model, prompting service, or image-generation backend.
External agents use the same deterministic commands as the editor.

## Features

- Rectangular documents up to 2048×2048, 256 layers and 2048 frames, bounded by 16,777,216 stored pixels.
- RGBA, indexed and grayscale color, per-pixel alpha, palettes and remapping.
- Brushes, custom masks, pressure, stabilizer, symmetry, wrapping, shapes, gradients, bitmap text and pixel-perfect strokes.
- Rectangle, ellipse, lasso, polygon and wand selections; combined masks, translation, scale, rotation and flips.
- Groups, blend modes, reference layers, positioned and linked cels, a layer-by-frame timeline and configurable onion skin.
- Deterministic tween and particle baking, independent tilesets, tilemap layers and Manual/Auto/Stack tile-pixel editing.
- Native Aseprite files, editable PNG/BMP/TGA/GIF imports, image sequences and padded sprite sheets.
- Free frame PNG/BMP/TGA and portable PixelWall/Aseprite exports. Pro GIF, packed atlas PNG+JSON and game ZIP with real Tiled assets.
- Named slices, pivots, nine-patch metadata, layer/clip export scope, padding, extrusion, scale and power-of-two packing.
- Local document library, bounded recoverable revisions, sparse undo, workspace preferences and custom tool shortcuts.
- Public JavaScript API, WebMCP, portable command extensions and a dependency-free bundled CLI. No embedded AI or Lua interpreter.
- Offline browser and desktop builds with signed, perpetual Pro ownership licenses.

See [format and CLI reference](docs/formats-cli.md) and [storage and ownership](docs/ownership-storage.md).
Native compatibility is deliberately bounded: ICC data is retained without color conversion;
Aseprite Lua extensions are not supported; pixel-safe rotation is not RotSprite.
GIF uses binary transparency and quantizes larger palettes. PNG and project files retain full alpha.
3D is deferred.

## Download builds

`npm run build:standalone` builds the local browser app, bundled CLI and Electron app assets.
All browser and desktop downloads use https://www.pixelwall.dev for checkout, ownership-license conversion and documentation. Private preview addresses are never used in distributed copies.
`npm run package:downloads` prepares the browser and CLI ZIP files for the website.
The desktop wrapper has separate packaging scripts in `desktop/package.json`.
Distribution signing and notarization require release credentials; local macOS builds are unsigned.

## Run locally

```bash
npm install
npm run dev
```

Use `npm run build`, `npm run lint`, and `npm test` to validate the project.

## PostHog analytics (optional)

PixelWall works normally without analytics configuration. To enable PostHog on
production, set these two public variables in Vercel and rebuild:

- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`: the intentionally public project token
  from PostHog project settings, never a personal API key.
- `NEXT_PUBLIC_POSTHOG_HOST`: `https://us.i.posthog.com` for US Cloud or
  `https://eu.i.posthog.com` for EU Cloud, matching the project region.

Optional collection runs only on `pixelwall.dev` and `www.pixelwall.dev`.
Local development, Vercel aliases, private Sites previews, desktop apps, the
standalone browser bundle and the CLI are excluded. Leaving the token unset is
supported and keeps PostHog disabled.

Browser events use the first-party `/beam` relay. It strips cookies,
authorization, referrer and other app headers before forwarding to the configured
PostHog region. The relay does not bypass privacy preferences, Do Not Track or
Global Privacy Control.

A shared, nonmodal prompt and Privacy preferences control cover public pages and
both hosted editors. **Required only** is the default and does not download or
initialize the SDK. **Usage analytics** enables explicit page, navigation,
download and product events. **Enhanced diagnostics** adds scrubbed error reports
and performance measurements. Session recording, automatic interaction capture,
heatmaps, surveys and person profiles are disabled at every level. Optional modes
use a stored browser identifier for repeat visits; do not describe it as anonymous.

The v2 preference preserves refusals and maps legacy permission to Usage only.
Permission is checked again after asynchronous SDK loading. Changes apply
immediately and synchronize across tabs. Activity before permission is discarded,
never backfilled. A grant records only the current page, not previously visited
pages. If saving a choice fails, optional collection stops for the visit.

The final payload sanitizer permits only reviewed event properties and coarse SDK
metadata. Artwork, uploaded references, project/layer/animation/slice names,
filenames, license and purchase identifiers, scripts, raw error messages, full
URLs and campaign parameters are excluded. Document content is never attached to
an event. Immediate referral classification uses fixed categories and does not
reconstruct attribution across earlier page visits.

The event inventory covers:

- Public navigation: `site_page_viewed`, `site_cta_clicked`,
  `desktop_download_clicked`. Download clicks match the four current release
  assets; they indicate a click, not a completed download or installation.
- Hosted Workbench: document and command use, imports, storage/recovery, exports,
  and Pro interactions through explicit events and fixed operation categories.
- Classic editor: lifecycle/guidance, committed edits, structure, playback,
  references, file operations, autosave and export outcomes.
- Privacy grants: `analytics_consent_updated`. Refusals and withdrawals do not
  send a tracking event.

`app/site-analytics-core.mjs` contains the recognized public page/link vocabulary;
update it when adding public routes. `app/analytics.ts` owns consent, the event
catalog and final payload filtering. Test with an isolated SDK or intercepted
requests so validation traffic is not mistaken for real visitors.

The versioned dashboard definitions are in `docs/analytics/posthog-dashboards.json`.
They cover website/downloads, editor/exports, and Pro/reliability (28 insights).
Only schema 2 production events are included; no historical activity is backfilled.
To manage them, use a personal API key with project/read, dashboard/read,
insight/read and query/read access; applying also needs dashboard/write and
insight/write. Keep the key in a private local text file. Run
`node scripts/sync-posthog-dashboards.mjs --key-file /absolute/private-key.txt --project PROJECT_ID`
for a read/query validation pass, then repeat with `--apply`. The tool verifies
that the selected project matches the site's public capture token, preserves
unrelated dashboards and memberships, and saves resulting links under `outputs/`.
Never put a personal key in a `NEXT_PUBLIC_` variable or commit it.

Enhanced performance reports describe the current page's lifetime. Withdrawing
permission blocks new analytics events; previously consented requests already
queued by the SDK may finish sending. Performance observers may remain in memory
until navigation, while the send boundary continues enforcing the current choice.

## GitHub and Vercel

PixelWall stores projects in the browser and portable files; it does not depend
on a hosted database, account system, or provider-specific API. The repository
also includes a standard Next.js/Vercel build alongside the current Sites build.
After pushing it to GitHub, import the repository in Vercel; `vercel.json` selects
`npm run build:vercel` automatically.

## PixelWall Pro / Stripe

The free studio includes all drawing, layers, references, animation and tilemap
editing, individual frame PNGs, browser autosave, and portable project files.
Generated exports and project backups keep a visible Download File link until
dismissed or replaced, so they can be saved when a browser blocks the automatic
download. Recovery codes use a direct download link.

Pro is **$15 USD for lifetime access, paid once**, for animated GIFs, sprite-sheet PNGs,
sprite and Tiled tilemap ZIP packages, and named export presets. Existing presets
are retained. Listed exports work offline with your ownership license and downloaded app. There are no
ads or recurring charges.

### Connection

1. In Stripe **test mode**, create a PixelWall Pro product and an active one-time
   price for USD 15.00. Put its `price_…` ID in `STRIPE_PRICE_ID`.
2. Set the server-only variables in `.env.example` in `.env.local` for local work
   and in the chosen host's secret settings for deployment. Keep `STRIPE_MODE=test`
   until the complete checkout and recovery flow passes with Stripe test payments.
   `STRIPE_SECRET_KEY` must be a matching test/live secret or restricted API key.
   Restricted keys need Prices read, Checkout Sessions write/read, Payment Intents
   read, Charges read, and Disputes read. Never put keys in browser code or Git.
3. Set `PIXELWALL_SITE_URL` to the exact canonical origin used by visitors (no path),
   such as `http://localhost:3000` or the site's HTTPS address. Checkout return URLs
   and request-origin checks use this value. If the same deployment also serves
   other storefront domains, list their exact HTTPS origins in
   `PIXELWALL_ADDITIONAL_ORIGINS`, separated by commas. Checkout returns to the
   approved origin where it started, preserving the buyer's private claim cookie
   and browser artwork. Unlisted origins remain blocked. Use separate test/live
   configurations.
4. Generate `PIXELWALL_LICENSE_SECRET` as at least 32 random characters. **Back up
   this secret and keep it stable** across redeploys. Changing it invalidates all
   issued recovery codes. Use separate secrets for test and live.
5. Restart the local server or redeploy after changing configuration. GET
   `/api/billing/status` reports readiness without revealing any secrets. The
   upgrade button remains unavailable if the required configuration is missing.
6. Optionally register `/api/billing/webhook` as an HTTPS event destination for
   `checkout.session.completed`, `charge.refunded`, and dispute events. Set its
   endpoint-specific `whsec_…` signing secret in `STRIPE_WEBHOOK_SECRET`. For local
   delivery use Stripe CLI forwarding. Raw-body signatures, timestamps, and mode
   are checked. Duplicate and reordered events cannot grant access.

Payment verification reads current Stripe records on claim, restore, and every
paid export/preset operation, including full refunds and unresolved/lost disputes.
The webhook is an authenticated acknowledgement; there is no entitlement database
or cache for it to update. A temporary Stripe outage blocks paid operations while
preserving the purchase cookie. Partial refunds retain access. Full refunds revoke
it. A won dispute restores eligibility.

### Recovery and privacy

After a paid or fully discounted checkout, returning to PixelWall issues a signed recovery code and an
HttpOnly, SameSite cookie. A separate private checkout cookie ties the return to
the browser that started the purchase; a Checkout Session ID alone cannot claim
someone else's payment. An unfinished checkout can be resumed; completed or
expired sessions are replaced when the buyer starts a new purchase. Buyers
download the code and can paste it into **Pro →
Restore Pro** on another device. It is a bearer license: anyone given a
valid code can restore it. Codes do not restore artwork and are never included
in project or artwork exports. The app has no automatic email login/recovery.

For a lost code, verify ownership by replying to the email on the completed
Stripe checkout. Do not treat a receipt number alone as proof of ownership. The
owner can retrieve the Checkout Session ID in Stripe and run:

```bash
node --env-file=.env.local scripts/recover-pro.mjs cs_test_EXAMPLE /private/path/pro-recovery.txt
```

The tool verifies the completed order and writes a new copy of the same code to a private
file, refusing to overwrite an existing file. Deliver it only to the verified
checkout email. Do not commit recovery files or include them in public logs.
Support and refund requests go to `contact@caplock.ai`; refunds are performed in
Stripe, and subsequent paid actions check their current status.

Artwork remains on the device. Immediately before redirecting to checkout, the
latest project including its reference is saved to browser storage. Checkout is
stopped if that backup fails. Closing the tab, clearing browser data, or changing
devices still requires a portable Save Project backup to preserve artwork.

This is product licensing, not DRM: the editor and export algorithms run in the
browser, so someone deliberately modifying the open source code can bypass its
UI. Stripe keys and recovery-code signing stay on the server. No client-side
`isPro` flag or unverified redirect can unlock the normal product flow.

### Complimentary lifetime access through Stripe

In the live Stripe Dashboard, open **Product catalog → Coupons → PixelWall Pro
lifetime gift**. This reusable coupon gives 100% off and is restricted to the
PixelWall Pro product. Create a promotion code beneath it for each recipient,
set **maximum redemptions to 1**, and optionally add a redemption deadline.
Use the separate test-mode coupon when testing.

Give the recipient their promotion code and the PixelWall website address.
They open **Pro → Get Lifetime Pro**, choose **Add promotion code** in Stripe,
apply the code, and complete the $0 checkout without entering a card. They must
start checkout from PixelWall, so the app can securely claim the order when they
return. A generic Stripe Payment Link does not replace this app checkout flow.
After returning, they save the private recovery code for restoring Pro on their
own devices. The gift code is redeemed once; the recovery code can be reused.

The coupon's “once” duration describes the discount, not the length of access.
Deactivating a promotion code prevents future redemptions; it does not revoke
lifetime access that was already redeemed. Stripe remains the order record.
Fully discounted checkout verification requires a completed session for the
correct product, a zero total, a discount equal to the positive subtotal, and no
PaymentIntent. An open checkout or an unpaid balance never grants access.

### Launch checks

- Finish one Stripe test checkout, cancel another, retry the return page, restore
  the code in a different browser, and confirm free PNG/project exports work.
- Refund the test purchase and confirm its next paid action is blocked. Automated
  billing tests also cover forged codes, cross-site requests, pending payments,
  wrong prices, outages, disputes, and webhook tampering.
- Redeem a single-use 100% promotion code in test mode, verify the $0 order grants
  Pro, restore its recovery code, and confirm the gift code cannot be used again.
- Before live launch, finish any Stripe account activation/payout requirements,
  confirm the final host/domain, support/refund terms, and applicable tax setup.
  Set `STRIPE_AUTOMATIC_TAX=true` only after configuring the intended Stripe Tax
  settings/registrations. Test checkout does not establish tax obligations.
- Create the corresponding **live** USD 15.00 one-time price, then configure live
  server keys, a separate license secret, and any live webhook destination.
  Explicitly set `STRIPE_MODE=live`. Test purchases do not unlock the live store.

Stripe reference: [hosted Checkout](https://docs.stripe.com/payments/checkout),
[webhook signatures](https://docs.stripe.com/webhooks/signature), and
[test payments](https://docs.stripe.com/testing).

## Public pages and search

The public production domain is **https://www.pixelwall.dev** on Vercel. The
OpenAI Sites copy is private. The homepage and guides are static server components;
public links do not prefetch the editor. The studio lives at `/editor`, retains
its existing browser storage keys, and opens help pages in another tab so a live
reference is not discarded. Old checkout return URLs continue to work.

Public pages include a small shared privacy and event component without loading
the editor. The PostHog SDK downloads only after optional consent on the public
production domain. Page views use fixed page groups rather than URLs; public links
and current desktop downloads use a known destination list. The current page is
counted on permission, and earlier activity is not recovered. Referral categories
describe the immediate source only. Private previews and downloadable apps remain
outside this site analytics integration.

See [the search launch notes](docs/search-launch.md) for verification, production
checks, and the remaining account setup. Regenerate the downloadable starter
example with `node scripts/export-demo.mjs`. After a production build, audit a
running server with `node scripts/audit-search.mjs http://localhost:3100`.

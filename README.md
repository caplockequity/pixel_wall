# PixelWall

A tactile pixel-art studio built around a simple metaphor: project a reference
onto a wall, mount a crisp pixel frame over it, and draw frame by frame.

## Features

- Pencil, eraser, contiguous fill, and color picker
- 8×8 through 256×256 bitmap canvases with centered resize
- Projected image references with adjustable opacity, scale, position, and 1:1 pixel locking
- Automatic square-sprite-sheet detection with exact previous/next sprite alignment
- One-click import of detected sprite sheets into editable animation frames
- Integer workspace pixel sizing and a transparency checker locked to canvas cells
- Named animation clips, frame reordering, per-frame timing, looping modes, and onion skin
- Four-layer cel workflow with visibility, locking, opacity, naming, and reordering
- Rectangular selection with move, copy/paste, clear, and horizontal/vertical flips
- Per-frame export pivots, named selection slices, seamless 3×3 preview, and linked-edge drawing
- A compact tilemap lab that paints frames as reusable level tiles and exports a dedicated Tiled-compatible map package with a tileset, flattened preview, and stable frame mapping
- Stroke-level undo and redo
- Compact local autosave and portable `.pixelwall` project save/open files
- A blank-project dialog with a backup download selected by default and in-session Undo recovery of the previous project
- Persistent navigation to drawing, layers, animation, tilemaps, and reference tools, plus a practical guide with direct links to each workflow
- Native transparent frame PNGs and configurable sprite packages with horizontal, vertical, or grid sheets, padding, transparent-edge trimming, individual PNGs, and Phaser/Pixi/Aseprite-style JSON
- Standalone sprite-sheet PNG downloads using the selected frames, layout, and padding, with full untrimmed canvas cells
- Animated GIF downloads of the active clip at 1×, 2×, 4×, or 8× nearest-neighbor scale, preserving playback direction, timing, and looping
- Up to eight named export presets saved in this browser for layout, padding, trimming, individual PNGs, and GIF scale
- Mouse, touch, and keyboard drawing

GIF uses a maximum of 256 colors per frame and binary transparency: alpha below
128 becomes transparent; other pixels become opaque. Small pixel-art palettes
retain exact RGB colors. Frame timing is rounded to GIF centiseconds with a
20 ms minimum; rounding is balanced across the animation. Exports are limited
to 64 million output pixels across the full playback sequence and processed a
frame at a time. PNG and project files retain the original artwork.

Export presets contain no artwork or project-specific clip identifiers. They
stay in local browser storage and are not included in portable project files.

## Run locally

```bash
npm install
npm run dev
```

Use `npm run build`, `npm run lint`, and `npm test` to validate the project.

## PostHog analytics (optional)

PixelWall works normally without analytics configuration. To enable PostHog,
copy `.env.example` to `.env.local` and set the two public variables:

```bash
cp .env.example .env.local
```

- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` is the **project token** from the PostHog
  project settings. It is intentionally public; do not use a personal API key.
- `NEXT_PUBLIC_POSTHOG_HOST` must match the project's region: use
  `https://us.i.posthog.com` for US Cloud or `https://eu.i.posthog.com` for EU
  Cloud.

Browser events use the first-party `/beam` relay in
`app/beam/[...path]/route.ts`; the host variable still selects the US or EU
upstream. The relay strips cookies, authorization, referrer, and other app
headers before forwarding. It improves delivery but does not bypass consent,
Do Not Track, or Global Privacy Control.

Restart the development server after changing `.env.local`. For an OpenAI Sites
or Vercel deployment, add both variables in that project's environment-variable
settings for each environment where analytics should run, then redeploy. Leaving
the token unset is supported and keeps PostHog disabled.

Privacy preferences offer three levels. **Required only** is the default and uses
browser storage for the editor and preferences without initializing PostHog.
**Usage analytics** opts into page visits and the allowlisted product events below;
automatic interaction tracking, recordings, and performance/error diagnostics stay
disabled. **Enhanced diagnostics** also opts into those masked diagnostics and
session replay, subject to the project's recording settings. Optional modes use
a stored browser identifier; they are not described as fully anonymous.

The v2 preference preserves existing refusals and maps legacy analytics permission
to usage only. Enhanced diagnostics need a new explicit choice. Changes apply
immediately and synchronize across tabs; withdrawal stops recording and capture.
Events before a choice are discarded, never replayed after permission. If saving
fails, optional analytics stay disabled for the current visit and the UI explains
the failure. Do Not Track or Global Privacy Control overrides optional choices.

Pixel artwork,
uploaded references, project and layer names, animation and slice names, and
notices are excluded from replay/autocapture. Custom event properties use strict
per-event allowlists containing only coarse counts, dimensions, timings,
booleans, and operation/result enums—never names, filenames, colors, pixels, or
uploaded content.

The custom event taxonomy is intentionally small:

- Lifecycle and guidance: `editor_loaded`, `quick_guide_viewed`,
  `quick_guide_dismissed`
- Editing: `canvas_edit_committed`, `project_structure_changed`,
  `feature_toggled`, `animation_playback_changed`, `tilemap_edit_committed`
- References: `reference_loaded`, `reference_load_failed`, `reference_action`,
  `sprite_sheet_imported`
- Storage and recovery: `project_file_operation`, `autosave_failed`,
  `autosave_recovered`
- Export funnel: `export_started`, `export_completed`, `export_failed`,
  `export_blocked`
- Privacy choice: `analytics_consent_updated`

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

Pro is a **$19 USD one-time purchase** for animated GIFs, sprite-sheet PNGs,
sprite and Tiled tilemap ZIP packages, and named export presets. Existing presets
are retained. There are no ads or recurring charges.

### Connection

1. In Stripe **test mode**, create a PixelWall Pro product and an active one-time
   price for USD 19.00. Put its `price_…` ID in `STRIPE_PRICE_ID`.
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

After payment, returning to PixelWall issues a signed recovery code and an
HttpOnly, SameSite cookie. A separate private checkout cookie ties the return to
the browser that started the purchase; a Checkout Session ID alone cannot claim
someone else's payment. An unfinished checkout can be resumed; completed or
expired sessions are replaced when the buyer starts a new purchase. Buyers
download the code and can paste it into **Pro →
Restore purchase** on another device. It is a bearer license: anyone given a
valid code can restore it. Codes do not restore artwork and are never included
in project or artwork exports. The app has no automatic email login/recovery.

For a lost code, verify ownership by replying to the email on the successful
Stripe payment. Do not treat a receipt number alone as proof of ownership. The
owner can retrieve the Checkout Session ID in Stripe and run:

```bash
node --env-file=.env.local scripts/recover-pro.mjs cs_test_EXAMPLE /private/path/pro-recovery.txt
```

The tool verifies the payment and writes a new copy of the same code to a private
file, refusing to overwrite an existing file. Deliver it only to the verified
purchase email. Do not commit recovery files or include them in public logs.
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

### Launch checks

- Finish one Stripe test checkout, cancel another, retry the return page, restore
  the code in a different browser, and confirm free PNG/project exports work.
- Refund the test purchase and confirm its next paid action is blocked. Automated
  billing tests also cover forged codes, cross-site requests, pending payments,
  wrong prices, outages, disputes, and webhook tampering.
- Before live launch, finish any Stripe account activation/payout requirements,
  confirm the final host/domain, support/refund terms, and applicable tax setup.
  Set `STRIPE_AUTOMATIC_TAX=true` only after configuring the intended Stripe Tax
  settings/registrations. Test checkout does not establish tax obligations.
- Create the corresponding **live** USD 19.00 one-time price, then configure live
  server keys, a separate license secret, and any live webhook destination.
  Explicitly set `STRIPE_MODE=live`. Test purchases do not unlock the live store.

Stripe reference: [hosted Checkout](https://docs.stripe.com/payments/checkout),
[webhook signatures](https://docs.stripe.com/webhooks/signature), and
[test payments](https://docs.stripe.com/testing).

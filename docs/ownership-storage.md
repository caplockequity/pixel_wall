# Durable documents and owned Pro integration

All files here were authored outside the Site checkout. Copy the selected modules into the app; `billing.patch` and `pro-access.patch` contain precise replacements for the originals. The billing route already passes `process.env`, so no route change is needed.

## Browser library

`const store = await openStore()` provides the API described in `storage.mjs`. `saveDocument(doc, { expectedRevision, label, pinned, changedImageIds })` returns `{document, revision, savedAt, imagesWritten, bytesUsed, prunedRevisions}`. `loadDocument(id)` returns `{document, revision, savedAt}` or `null`. Pass the last loaded/saved revision to stop simultaneous windows overwriting each other. Display `DocumentStorageError.message` beside an unsaved indicator and retain the current in-memory document. Never display Saved before the promise resolves. Provide Save Project when storage fails.

Documents must be `pixelwall-document` v4 with string ID, width/height, layers/frames, and `images`. Cel references use `frame.cels[layerId].imageId`. Images may be arrays, objects, typed arrays or ArrayBuffers. Replace changed image values; unchanged objects retain identity and their content hash is cached. Optional `changedImageIds` explicitly invalidates any reused mutable image object. Metadata and image hashes are saved separately; image content records are written only when new. The whole save/revision/garbage-collection change is one IndexedDB transaction.

Default recovery policy: 40 revisions per document, 96 MiB total estimated library budget, at least two latest revisions per document, never evict a current document or pinned revision. Automatic old recovery pruning is returned explicitly in `prunedRevisions`. If even current heads plus two recoverable versions do not fit, reject the new save atomically instead of deleting work. Browser quota failures preserve the prior committed head too. The estimate uses conservative serialized byte size, not an exact browser quota; request persistent storage and offer project-file backups. Store `preferences`, `customShortcuts`, and `exportPresets` with `getSetting`/`setSetting`.

`importLegacy({convert})` processes all three original localStorage draft keys independently and reports failures. Its converter must return the v4 document for each parsed legacy object. It never modifies or deletes legacy source strings; deterministic import IDs and markers make repeated imports safe. Preserve failed originals and show an actionable recovery note.

`createHistory(initial)` uses immutable values, structural sharing and sparse pixel spans. `begin(label) → update(next) … → end()` makes a gesture one undo entry. Updates perform no diff or snapshot copy. `commit(next,label)` handles a one-step edit. Undo/redo apply patches and clone only changed branches. Budget defaults to 32 MiB / 100 entries; `lastChange` and optional `onPrune` make oversized/lost history explicit.

## Ownership, compatibility and price

Use `offline-license.mjs` in browsers and CLI. `verifyOfflineLicense(token,{publicKeys,mode})` validates ECDSA P-256/SHA-256 against compiled trusted public keys and returns claims or null. Server-only `offline-license-server.mjs` signs. Never import the server signing module into client or CLI bundles. The client token is `PW2.payload.signature`, product `pixelwall-pro`, contains a purchase ID and key ID, and explicitly has no expiry. It grants durable listed exports in an installed/downloaded app even when the store disappears. Treat the token as a private bearer recovery file.

Required configuration:

- `PIXELWALL_LICENSE_KEY_ID`: ID of the active signing key.
- `PIXELWALL_OFFLINE_PRIVATE_JWK`: private P-256 JWK, a server secret only.
- `PIXELWALL_LICENSE_PUBLIC_KEYS`: JSON object mapping trusted key IDs to PUBLIC JWKs (server verification).
- `NEXT_PUBLIC_PIXELWALL_LICENSE_PUBLIC_KEYS`: identical public-key map compiled into browser and desktop builds.
- `NEXT_PUBLIC_PIXELWALL_LICENSE_MODE`: `live` for production, `test` for test builds. Default is live. Build mode is pinned; local flags cannot turn a test license into live ownership.
- `STRIPE_PRICE_ID`: NEW active one-time USD 1500-cent price.
- `STRIPE_HISTORICAL_PRICE_IDS`: comma-separated prior valid PixelWall price IDs, including the original 1900-cent price. These restore old purchases but are never used for new checkout.
- Keep `PIXELWALL_LICENSE_SECRET` unchanged; it verifies all existing PW1 codes.

`create-license-key.mjs` safely writes private/public key files without printing credentials and refuses to overwrite an existing private key. Keep its directory ignored. Provision private JWK only through the hosting secret mechanism. Preserve old public keys indefinitely so perpetual licenses survive key rotation. Bundle the public key map with CLI too; never allow users to supply their own trusted public keys through export flags.

Existing PW1 codes and purchase cookies convert during status, restore, authorization or recovery. New claims return both `recoveryCode` and `offlineLicense`; they set the signed token as the private cookie. All online checks still read Stripe product/payment/refund/dispute status. Checkout is deliberately unavailable until consistent ownership signing keys are configured, so an advertised offline purchase cannot be sold without the capability. Existing online licenses remain verifiable during that setup.

The store can observe and revoke local cached ownership on a later online refund/dispute check. A non-expiring offline bearer license cannot be instantly revoked on a disconnected computer; that is an explicit ownership tradeoff, not a secret expiry. A downloaded license can remain usable offline after refund. Do not promise both perpetual disconnected ownership and immediate universal revocation.

All marketing/pricing copy must change from $19 to $15 and remove "for as long as PixelWall is available" for owned features. `pro-access.tsx` is already updated; root should update public-content/pricing/terms consistently. Keep actual historical-price acceptance and original signing secret to protect existing buyers.

## Offline app and desktop

Copy `sw.js` into public and `offline-client.mjs` into app; call `registerOffline({onStatus})` once from the editor and display ready/preparing/unavailable truthfully. Copy `prepare-offline.mjs` to scripts and run it after `vinext build`. It inventories complete `dist/client` JS/CSS/fonts/images and creates a deterministic worker version. Service workers never cache `/api`, analytics, checkout returns or artwork. Normal app updates wait for old windows to close; only call `activateSavedUpdate` after saving and explicit user update action.

A PWA cache requires one successful online install before reopening offline. Browser storage and installed caches can still be removed by the user or OS. Project files, the downloaded ownership license and a standalone app copy provide durable independent backups.

`desktop/` contains a minimal Electron wrapper with local secure custom-protocol serving, no Node access in renderer, context isolation, sandboxing and external-link handling. It needs a standalone client build in `desktop/app`. An SSR client asset directory alone is not that build. OS-signed distributed installers additionally need platform signing/notarization credentials. Do not describe the wrapper source as an already shipped signed desktop release.

## Verification performed

42 tests pass: six storage/history tests, four ownership tests, and 32 original billing regression tests adapted only for signing-key test configuration, $15 expected active price, and PW2 code format. Storage tests use fake-indexeddb; cryptographic tests use newly generated local test keys, never production keys. TypeScript check of pro-access succeeds; ESLint of all authored modules and substantive tests succeeds. Browser/PWA install and packaged desktop smoke testing are still integration work for the assembled app.

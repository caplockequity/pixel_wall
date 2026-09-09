# PixelWall desktop wrapper

This is a runnable Electron wrapper for a standalone browser build. It serves only packaged files from `desktop/app` under a stable secure `pixelwall://app` origin, so IndexedDB documents and signed Pro ownership licenses persist between launches. No application server, account or subscription is needed for the packaged editor. Checkout opens the hosted store in the system browser; import the downloaded PW2 license to unlock the local build.

Build the standalone editor with relative asset URLs, copy that output into `desktop/app`, then run `npm install` and `npm start` from this directory. `npm run package` creates an unpacked local app; `npm run dist` produces platform installers. The editor must work without Next/React server routes (a normal server-rendered `dist/client` alone is not a complete standalone build). Use the same document/renderer modules in its client entry point. Bundle the public license keys into that build. Never bundle signing keys, Stripe credentials or project files.

The wrapper disables Node access, uses context isolation and Chromium sandboxing, rejects external app navigation and denies unexpected permissions. Downloaded project/export files use the operating system's normal save/download flow. OS signing and notarization require the owner's distribution certificates and release account; unsigned local builds remain runnable but are not represented as public signed releases. Test persisted documents, offline license restoration, all exports, and close/reopen before distributing an installer.

## Desktop releases and updates

Version 0.2.0 adds a delayed background update check, no more than once per day,
and a **Check for Updates…** menu item. macOS places it in the PixelWall menu;
Windows and Linux place it in Help. Automatic checks can be disabled in that menu.
Network failures remain silent during background checks and never block editing.
The app opens a download or release-notes page when requested; it never installs
an update, restarts, or edits artwork. Existing 0.1.0 users must install this build
once to acquire the checker.

The feed is `https://www.pixelwall.dev/desktop/latest.json`. Only canonical public
PixelWall release URLs are accepted. Update preferences are stored separately in
`userData/update-checker.json`; preserve the app ID, app name, user-data location,
and `pixelwall://app` origin across releases to preserve the document library and
Pro ownership licenses.

To publish the next desktop release:

1. Bump the version in `desktop/package.json` and its lockfile. Build the same
   reviewed commit for every architecture. The Desktop build candidates workflow
   produces Windows x64 and Linux x64 artifacts without publishing them.
2. Run the protected Mac signing job against that exact commit. It uses the
   existing Apple credentials, signs both Mac architectures, submits each to
   Apple, staples the accepted tickets, and validates the resulting bundles.
   Apple credentials and certificates never enter this repository or its artifacts.
3. Validate the packages with `scripts/verify-desktop-release.mjs`, retaining
   separate native launch, installation, and signature evidence. Upload the four
   reviewed files to the immutable GitHub release tag `desktop-v<VERSION>`.
4. Add the file sizes, SHA-256 hashes, signing status, and release notes to
   `public/desktop/latest.json`. Publish the website only after all downloads are
   available. Keep old release assets available; do not replace an existing version.

The website's `/downloads/desktop/<version>/<filename>` routes point only to those
PixelWall release assets. Public pages, desktop menus, update feeds, and downloaded
licenses use `pixelwall.dev`. The separate Sites preview remains private.

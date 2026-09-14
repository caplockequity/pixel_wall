# PixelWall desktop wrapper

This is a runnable Electron wrapper for a standalone browser build. It serves only packaged files from `desktop/app` under a stable secure `pixelwall://app` origin, so IndexedDB documents and signed Pro ownership licenses persist between launches. No application server, account or subscription is needed for the packaged editor. Checkout opens the hosted store in the system browser; import the downloaded PW2 license to unlock the local build.

Build the standalone editor with relative asset URLs, copy that output into `desktop/app`, then run `npm install` and `npm start` from this directory. `npm run package` creates an unpacked local app; `npm run dist` produces platform installers. The editor must work without Next/React server routes (a normal server-rendered `dist/client` alone is not a complete standalone build). Use the same document/renderer modules in its client entry point. Bundle the public license keys into that build. Never bundle signing keys, Stripe credentials or project files.

The wrapper disables Node access, uses context isolation and Chromium sandboxing, rejects external app navigation and denies unexpected permissions. Downloaded project/export files use the operating system's normal save/download flow. OS signing and notarization require the owner's distribution certificates and release account; unsigned local builds remain runnable but are not represented as public signed releases. Test persisted documents, offline license restoration, all exports, and close/reopen before distributing an installer.

## Desktop releases and updates

Version 0.3.2 adds in-app downloading and **Restart to update**, using the pinned
`electron-updater` 6.8.9 runtime with electron-builder 26.15.3. The update window
shows release notes, progress, cancellation, retry, and a Later action. Closing
the update window allows a download to continue. Reopen it through **Check for
Updates…** (PixelWall menu on macOS, Help on Windows/Linux).

Checks remain delayed at startup and run at most once per day automatically.
Automatic checks can be disabled in the menu; background network failures stay
silent. Downloads require a user action. Installation requires a separate restart
action: ordinary quit does not install a downloaded update. The existing editor
close controller must lock edits and confirm a durable save before installation.
A save failure or installation-preparation error keeps the editor open and releases the edit lock;
updater-driven restarts never offer to discard artwork.

Existing users need one last manual installation to acquire this capability.
Older clients continue using the unchanged public `latest.json` schema. Local
development builds cannot install updates. Linux updates require a writable
AppImage and its containing directory. OS permissions may still require a prompt.

The discovery feed is `https://www.pixelwall.dev/desktop/latest.json`. Only canonical public
PixelWall release URLs are accepted. After the user chooses Download, the installer
reads an architecture-specific metadata file from the exact approved GitHub tag
`caplockequity/pixel_wall/releases/download/desktop-v<VERSION>/`. Metadata must name
exactly the expected artifact, version, and size. The library verifies SHA-512;
PixelWall also verifies the website's SHA-256 after downloading and before installing.
macOS stages and checks the signature only after the save acknowledgement; a failed
or timed-out staging attempt never registers a delayed forced restart callback.
Windows signature verification follows the publisher recorded by electron-builder
in `app-update.yml`; existing unsigned builds have no publisher to verify. Public
Windows signing still requires the owner's distribution credentials.

Full downloads are used for the first rollout; differential downloads and web
installers are disabled. Update preferences are stored separately in
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
3. Validate the **final** packages with `scripts/verify-desktop-release.mjs`, retaining
   separate native launch, installation, and signature evidence. After signing,
   stapling, re-zipping, and any filename normalization, generate update metadata:

   ```sh
   node scripts/prepare-desktop-update.mjs --platform mac --arch arm64 --version <VERSION>
   node scripts/prepare-desktop-update.mjs --platform mac --arch x64 --version <VERSION>
   node scripts/prepare-desktop-update.mjs --platform windows --arch x64 --version <VERSION>
   node scripts/prepare-desktop-update.mjs --platform linux --arch x64 --version <VERSION>
   ```

   Run each command beside its matching validated artifact. The script refuses
   an artifact changed since validation. The Windows/Linux workflow does this
   automatically after Linux filename normalization.
4. Upload the four reviewed artifacts **and** `latest-arm64-mac.yml`,
   `latest-x64-mac.yml`, `latest-x64.yml`, `latest-x64-linux.yml` to the immutable
   GitHub release tag `desktop-v<VERSION>`. These files are JSON-formatted YAML,
   consumed directly by electron-updater. Separate Mac architecture files avoid
   one build overwriting the other's metadata. Builder's default `latest*.yml`
   files and blockmaps are not used by this flow.
5. Add the file sizes, SHA-256 hashes, signing status, and release notes to
   `public/desktop/latest.json`. Publish the website only after all downloads are
   available. Keep old release assets available; do not replace an existing version.

The website's `/downloads/desktop/<version>/<filename>` routes point only to those
PixelWall release assets. Public pages, desktop menus, update feeds, and downloaded
licenses use `pixelwall.dev`. The separate Sites preview remains private.

Before shipping a changed updater connection, run the real Electron transport
regression from the repository root:

```sh
desktop/node_modules/.bin/electron --headless scripts/verify-desktop-transport.mjs
desktop/node_modules/.bin/electron scripts/verify-desktop-updater.mjs
```

The first opens no editor window and sends requests only to a temporary loopback server.
It verifies the discovery fetch wiring, response URL, streaming body, redirect
rejection, omitted credentials, and cancellation. Discovery uses Node's native
HTTPS client; it does not inherit Chromium's system/PAC proxy configuration.
Artifact downloads use electron-updater's Electron transport.

The second uses the real pinned updater and a temporary loopback server to test
metadata resolution, full downloads, cached downloads, and checksum rejection.
It also renders the sandboxed update window and verifies progress, ready state,
and IPC sender/action restrictions. It never installs an update or uses the real
document library. A screenshot is written to `outputs/desktop-updater/`.

Before public rollout, test two signed/notarized Mac versions on both CPU
architectures, NSIS installation on Windows, and AppImage replacement on Linux.
Include save cancellation, read-only locations, offline retries, signature/hash
failure, and artwork/license persistence after relaunch. Packaged structural
checks and the loopback smoke test do not replace those native installation tests.

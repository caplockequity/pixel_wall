# Remaining work after the 0.3.1 checkpoint

This is a substantial working release, not a claim of complete compatibility.

## Release status

Version 0.3.1 is published on the public site, GitHub, Vercel and the owner-only Sites mirror. The public release includes Apple-silicon Mac, Intel Mac, Windows x64 and Linux x64 builds, plus refreshed standalone-browser and CLI downloads. Both Mac packages are Developer ID signed, notarized, stapled and architecture-verified. Windows and Linux packages passed structural, version, architecture and checksum validation. The final local and live checks passed 3,151 tests and audited all 24 public routes, the release feed, agent documents, examples and download redirects.

## Next implementation priorities

1. **Scripting objects and commands:** tilemap Image storage, tilemap cel creation, tile selections, Sprite copy/crop/close, background conversion, typed properties, additional tools and the remaining API inventory.
2. **Persistent extensions:** menus, events, timers, application preferences, modeless dialogs and advanced widgets. Current extensions run explicit bounded command sessions.
3. **Advanced color:** soft proofing, broader profile interoperability and remaining quantization/dithering matrix edge cases.
4. **Editing:** gesture/pivot rounding for rotation, additional layer/background semantics, typography and movable/saved workspace equivalence.
5. **Files and exports:** remaining format variants, additional external-resource workflows and intermediate CLI actions. Repeated ordered scaling of tilemap documents is explicitly rejected until each stage preserves the full native bitmap representation. Ordered slice selectors retain PixelWall's documented input scope.
6. **Desktop acceptance:** cross-application clipboard/profile transfer, installer/file-association tests and native launch testing on Intel Mac, Windows and Linux. Structural package validation is separate from installation testing.
7. **Desktop update experience:** redesign the in-app update flow so update checks, available-version messaging, release notes, download progress, installation, relaunch, failures and retry states are clear and dependable. Verify the experience on macOS, Windows and Linux, and protect unsaved work before any updater-driven relaunch.
8. **Refunded Pro licenses:** add license-status checks in both desktop and browser versions so a previously issued or redeemed code no longer unlocks Pro after its purchase is refunded. Cover existing activations and cached entitlements, define offline/recheck behavior, and preserve users' artwork when Pro access is revoked. This requires a server-backed entitlement and recheck design because an already-held offline lifetime code cannot be remotely revoked.
9. **Search monitoring:** monitor Google and Bing coverage and a fixed assistant-prompt sample while Bing processes the submitted sitemap and indexing requests. Recheck the homepage description warning after Bing recrawls the deployed metadata. Crawlable pages and metadata do not guarantee indexing or citations.
10. **Optional agent connectors:** evaluate a standalone MCP server, installable agent skill or language SDK only after choosing the supported security, versioning and distribution model. The current official guide accurately documents the interfaces that exist now.

## Completed at this checkpoint

The three priority defects are fixed: save/close protection, indexed-color conversion and native macOS Undo. Completed additions include color profiles, expanded Lua/image/tileset APIs, extension command sessions, exact tested rotation/rendering behaviors, animation repeats, fractional scaling, grid export and ordered CLI transforms. Release notes describe the supported feature set without competitor comparisons.

Version 0.3.1 completes effective palette-key handles, script-driven `ColorQuantization` and expanded `ChangePixelFormat`, including nonzero transparent-index generation. It also adds crawlable agent documentation, an accurate machine-readable interface statement, a reproducible three-frame command/CLI example, and guide links in both editor surfaces.

Actual local ARM64 packaged checks cover scripting, native Undo/Redo, external-save conflict cancellation and preservation of the edited document. All 0.3.1 publication steps are complete; installation and everyday integration checks on Intel Mac, Windows and Linux remain in priority 6 above.

Search-console setup is complete. Google confirms domain ownership, a successful 24-page sitemap, valid robots rules, indexed homepage and agent guide, valid HTTPS and breadcrumbs, and no manual-action or security issues. Bing ownership is imported from Google, its sitemap is accepted for processing, and indexing requests for the homepage and agent guide were accepted. Bing's robots tester now reports zero errors and zero warnings after removing the unsupported host directive; the homepage description was shortened to 152 characters and deployed for the next crawl.

## Resume references

- Detailed scripting scope: `lua-api-coverage.md`, `lua-compatibility.md`.
- Color/rendering boundaries: `native-indexed-conversion.md`, `lua-color-spaces.md`, `tile-backdrop-clearing.md`.
- Export boundaries: `cli-grid-export.md`, `cli-ordered-transforms.md`, `rotation.md`, `frame-traversal.md`.
- Internal engineering comparison and audit evidence remain in the existing engineering ledger and dated audit outputs. They are not customer-facing release copy.

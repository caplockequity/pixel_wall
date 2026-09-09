# Remaining work after the 0.3.0 checkpoint

Feature development paused at the user's request on September 9, 2026. Release verification and publication are the only active work. This is a substantial working release, not a claim of complete compatibility.

## Next implementation priorities

1. **Script palette commands:** finish and independently test palette-key handles, ColorQuantization and full ChangePixelFormat semantics. The partial implementation remains outside this checkout and is excluded from 0.3.0.
2. **Scripting objects and commands:** tilemap Image storage, tilemap cel creation, tile selections, Sprite copy/crop/close, background conversion, typed properties, additional tools and the remaining API inventory.
3. **Persistent extensions:** menus, events, timers, application preferences, modeless dialogs and advanced widgets. Current extensions run explicit bounded command sessions.
4. **Advanced color:** soft proofing, broader profile interoperability, nonzero-mask palette generation and remaining quantization/dithering matrix edge cases.
5. **Editing:** gesture/pivot rounding for rotation, additional layer/background semantics, typography and movable/saved workspace equivalence.
6. **Files and exports:** remaining format variants, additional external-resource workflows and intermediate CLI actions. Repeated ordered scaling of tilemap documents is explicitly rejected until each stage preserves the full native bitmap representation. Ordered slice selectors retain PixelWall's documented input scope.
7. **Desktop acceptance:** cross-application clipboard/profile transfer, installer/file-association tests and native launch testing on Intel Mac, Windows and Linux. Structural package validation is separate from installation testing.

## Completed at this checkpoint

The three priority defects are fixed: save/close protection, indexed-color conversion and native macOS Undo. Completed additions include color profiles, expanded Lua/image/tileset APIs, extension command sessions, exact tested rotation/rendering behaviors, animation repeats, fractional scaling, grid export and ordered CLI transforms. Release notes describe the supported feature set without competitor comparisons.

Actual local ARM64 packaged checks cover scripting, native Undo/Redo, external-save conflict cancellation and preservation of the edited document. Additional release checks and final publication results are recorded in the release handoff.

## Resume references

- Detailed scripting scope: `lua-api-coverage.md`, `lua-compatibility.md`.
- Color/rendering boundaries: `native-indexed-conversion.md`, `lua-color-spaces.md`, `tile-backdrop-clearing.md`.
- Export boundaries: `cli-grid-export.md`, `cli-ordered-transforms.md`, `rotation.md`, `frame-traversal.md`.
- Internal engineering comparison and audit evidence remain in the existing engineering ledger and dated audit outputs. They are not customer-facing release copy.

# 0.6.0 feedback comparison matrix

This compares Dottie’s twelve recommendations with the current source. It is
not a claim that 0.6.0 has been published.

1. **P0 — Recover a full local library.** Implemented: storage panel and
   read-only usage/estimate API, separate library/recovery/artifact states,
   bounded temporary documents, file-backed mode, verified checkpoints, and
   close guards. Limits: eight retained documents; a checkpoint is not a
   library save, and browser download completion is not observable. Evidence:
   `app/storage.mjs`, `app/workbench.jsx`, `app/native-document-session.mjs`,
   `tests/storage-history.test.mjs`, `tests/lua-native-finalize.test.mjs`.

2. **P0 — Explicit persistence and checkpoints.** Implemented: separate edit,
   library, artifact, disk-delivery, and reopen-verification states; checkpoints
   carry document/revision, bytes, filename, SHA-256, and verification data.
   Final assembled browser/desktop acceptance remains release work. Evidence:
   `app/workbench.jsx`, `desktop/mcp-bridge.mjs`, `tests/mcp-bridge.test.mjs`.

3. **P1 — Machine-readable capability contract.** Implemented: capabilities,
   command schemas, structured errors, receipts, wait APIs, and CLI doctor
   checks. Limits: export options remain interface-specific. Evidence:
   `app/editor-automation.mjs`, `app/command-contract.mjs`, `app/cli.mjs`.

4. **P1 — Compact regional edits.** Implemented: `selection-spec.mjs`
   supports rectangle, polygon, and RLE encodings; `selection-registry.mjs`
   provides bounded reusable IDs scoped to the exact document revision; and
   `selection.replaceColors` applies one-pass multi-color mappings with frame,
   layer, linked-cel, and offset handling. Full masks remain supported as a
   compatibility path. Evidence: `app/selection-spec.mjs`,
   `app/selection-registry.mjs`, `app/editor-automation.mjs`,
   `tests/selection-acceptance.test.mjs`.

5. **P1 — Operation phases and durable receipts.** Implemented: validation,
   staging, committing, completion/rollback progress, request keys, durable
   receipts, unknown outcomes, and wait APIs. Receipts do not resume edits.
   Closed MCP EPIPE handling is covered for synchronous throws, write
   callbacks, asynchronous socket errors, late responses, and owned-operation
   cancellation. Evidence: `app/editor-automation.mjs`,
   `app/operation-receipts.mjs`, `tests/mcp-disconnect-errors.test.mjs`.

6. **P1 — Animation diagnostics/review.** Implemented: playback, native and
   enlarged views, baseline comparison, contact sheets, missing-exposure,
   linked-image, duration, anchored-drift, exclusions, and wrap-transition
   diagnostics. It does not judge artistic quality or require identical loop
   endpoints. Evidence: `app/AnimationReviewPanel.jsx`,
   `app/animation-review.mjs`.

7. **P1 — Art-directed reusable components.** Implemented: deterministic
   editable components retain a stable component identity and recipe, expose
   art-direction controls, and regenerate through a guarded committed command
   that detects manual edits and preserves declared manual layers. Evidence:
   `app/scene-components.mjs`, `app/editor-core.mjs`,
   `app/scene-components-panel.jsx`, `tests/animation-review.test.mjs`.

8. **P1/P2 — Anchored looping environmental motion.** Implemented: the baked
   motion helper supports pinned layers and regions, periodic layer curves,
   amplitudes, phase offsets, and bounded frame/period validation while
   preserving the original layer references where appropriate. Evidence:
   `app/animation-export.mjs`, `app/editor-core.mjs`,
   `tests/animation-review.test.mjs`.

9. **P2 — Compose water into larger scenes.** Implemented: bounded water
   patches carry global origin, field dimensions, flow direction, independent
   water seed, foam regions, compact masks, and phase offsets; composition is
   region-scoped, preserves destination dimensions, and supports explicit
   frame phase maps for adjacent patches. Existing generator limits remain
   enforced. Evidence: `app/water-generator.mjs`, `app/editor-core.mjs`,
   `tests/animation-review.test.mjs`, `tests/water-generator.test.mjs`.

10. **P1 — Predictable export/licensing/verification.** Implemented: web and
    CLI plans report selection, frames, durations, dimensions, memory,
    entitlement, filenames, conflicts, and expected-frame mismatches; free PNG
    alternatives are reported. Limits: sheet/atlas packing derives dimensions
    and may produce multiple files; planning does not prove browser download
    completion. Evidence: `app/workbench.jsx`, `app/cli.mjs`,
    `app/cli-export-plan.mjs`.

11. **P2 — Profile real workloads.** Implemented as a maintained diagnostic
    profile: fixed fixtures record phase timing, sampled memory, serialization,
    reopen, export, and cancellation-boundary observations in published JSON.
    These are not universal performance benchmarks or architecture claims and
    should be repeated before making performance statements. Evidence:
    `scripts/profile-workflows.mjs`, `docs/workflow-profile.md`,
    `docs/benchmarks/workflow-before.json`,
    `docs/benchmarks/workflow-after.json`.

12. **P2 — Maintained end-to-end example.** Implemented: the checked-in
    reliable riverbank project includes a reproducible build script, named
    layers, linked static cels, animated canopy, 12-frame clip, bounded Lua
    pass, playback-only viewer, and verification coverage across desktop MCP
    and CLI checkpoint/reopen/render flows. Evidence:
    `public/examples/reliable-workflow/README.md`,
    `public/examples/reliable-workflow/build-example.mjs`,
    `public/examples/reliable-workflow/reedpass.lua`,
    `public/examples/reliable-workflow/viewer.html`,
    `tests/workflow-example.test.mjs`,
    `tests/workflow-desktop-cli.test.mjs`.

Before publication: run the full web build/tests, desktop build and native MCP
smoke, production export/reopen checks, assembled closed-connection tests, and
signed/notarized package verification.

## Desktop 0.6.1 storage regression

Save and Save As establish a file-backed document only after the native write
confirms the captured document and its per-document revision. Closing saves
native bindings before checking library capacity; checkpoint receipts still use
the separate global editor revision. Startup restores bound files without
overwriting older library snapshots. Unavailable native recovery blocks writes
from stale library copies. Closing a tab continues to retain library artwork.

Regression coverage includes failed and cancelled saves, different global and
per-document revisions, retained tabs, full-library Save As, file-backed project
switching, and startup recovery. After `npm run build:standalone`, run the actual
Electron renderer round trip with:

```sh
desktop/node_modules/.bin/electron scripts/verify-native-storage-roundtrip.mjs --output /path/to/disposable/build-output
```

The harness creates an isolated library and native binding registry, injects a
protected storage-budget fixture, saves changed pixels through Save As, verifies
both renderer and native close acknowledgements, reopens the renderer, and checks
the restored file pixels while the older library snapshot remains unchanged.
Its test windows close in `finally`; the output directory retains the report.

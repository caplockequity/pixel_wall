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

4. **P1 — Compact regional edits.** Partial: bulk commands, image deduplication,
   and selection registries exist. Rectangle/polygon/RLE transport and
   multi-color replacement are not yet a complete public contract; full masks
   remain supported.

5. **P1 — Operation phases and durable receipts.** Implemented: validation,
   staging, committing, completion/rollback progress, request keys, durable
   receipts, unknown outcomes, and wait APIs. Receipts do not resume edits.
   Closed MCP EPIPE handling is implemented but needs final assembled transport
   validation. Evidence: `app/editor-automation.mjs`,
   `app/operation-receipts.mjs`.

6. **P1 — Animation diagnostics/review.** Implemented: playback, native and
   enlarged views, baseline comparison, contact sheets, missing-exposure,
   linked-image, duration, anchored-drift, exclusions, and wrap-transition
   diagnostics. It does not judge artistic quality or require identical loop
   endpoints. Evidence: `app/AnimationReviewPanel.jsx`,
   `app/animation-review.mjs`.

7. **P1 — Art-directed reusable components.** Partial: deterministic editable
   scene components and named layers exist. Component identity, protected
   regeneration boundaries, and full art-direction controls remain future work.
   Evidence: `app/scene-components-panel.jsx`.

8. **P1/P2 — Anchored looping environmental motion.** Partial: anchored-layer
   diagnostics and editable baked motion exist. Pinned-region deformation and
   richer per-component periodic controls remain limited. Evidence:
   `app/animation-review.mjs`.

9. **P2 — Compose water into larger scenes.** Partial: water generation and
   replacement safeguards exist. Region-scoped compositing, flow fields,
   adjacent-patch synchronization, and large-scene water composition remain
   incomplete. Existing generator limits remain enforced. Evidence:
   `app/water-generator.mjs`, `app/workbench.jsx`.

10. **P1 — Predictable export/licensing/verification.** Implemented: web and
    CLI plans report selection, frames, durations, dimensions, memory,
    entitlement, filenames, conflicts, and expected-frame mismatches; free PNG
    alternatives are reported. Limits: sheet/atlas packing derives dimensions
    and may produce multiple files; planning does not prove browser download
    completion. Evidence: `app/workbench.jsx`, `app/cli.mjs`,
    `app/cli-export-plan.mjs`.

11. **P2 — Profile real workloads.** Partial: asynchronous operations expose
    phase timing and processed counts. No universal performance benchmark or
    architecture claim is made; fixed-fixture benchmark publication remains.

12. **P2 — Maintained end-to-end example.** Partial: CLI, Lua, project export,
    checkpoint, artifact, animation review, and water-scene pieces exist. A
    single maintained reference project plus playback-only HTML review page is
    not yet a release gate.

Before publication: run the full web build/tests, desktop build and native MCP
smoke, production export/reopen checks, assembled closed-connection tests, and
signed/notarized package verification.

# Workflow reliability implementation

The Willowmere test used desktop 0.5.0. This work starts from 0.5.1 and preserves its newer consent and telemetry behavior. The original storage proposals overlap feedback items 1–2; efficient storage, visible usage, and independent file workflows are one persistence workstream.

| Feedback | Implementation and acceptance |
| --- | --- |
| 1. Library recovery | Storage accounting/required space, explicit temporary and file modes, preserve every project at capacity. |
| 2. Checkpoints | Guard document/revision, separate edit/library/artifact/disk/reopen outcomes, refuse overwrites. |
| 3. Contracts | Accurate command schemas, local manifest validation, capabilities, structured errors, doctor. |
| 4. Regional edits | Compact rectangles/polygons/RLE, scoped reusable selections, one-pass palette mapping with no outside changes. |
| 5. Operation recovery | Explicit phases, staged versus committed counts, bounded durable retry receipts, restart outcome and polling guidance. |
| 6. Animation review | Anchors/exposures/clips/timing/bounds diagnostics, baseline/wrap playback and annotated contact sheets. |
| 7. Components | Shape controls, retained identity/recipe, preview and guarded regeneration protecting manual edits. |
| 8. Environmental motion | Pinned regions, periodic curves and phase, editable baked frames, unchanged roots/trunk. |
| 9. Water composition | Masked dedicated layers, global spatial/temporal coordinates, continuous adjacent patches and intact land. |
| 10. Export plans | Explicit selections/frame counts, dimensions/timing/files/licensing/conflicts, decoded output verification. |
| 11. Profiling | Fixed representative workloads, phase timings/memory/cancellation, measured findings before architecture changes. |
| 12. Maintained example | Small end-to-end project, MCP/CLI validation, checkpoint/reopen/render, modest viewer and copy revision. |

No existing project is deleted automatically. Correctness includes atomic commands, stale-revision checks, retry keys, undo, cancellation, linked cels and artifact checksums. Visual diagnostics identify changes for review, not artistic mistakes. First and last loop frames need not match.

Source and all build/test output stay on the mounted DevStorage volume. Existing Willowmere showcase files in the primary checkout are outside this task's edits.

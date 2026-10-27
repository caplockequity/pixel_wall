# Willowmere art-direction validation

Release: `art-direction-20261027-v1`.

The revised overworld was inspected as 512×384 with 15 layers and 12 frames. The revised side view was inspected as 768×256 with 13 layers and 12 frames. The Lantern Ford showcase project was inspected as 768×256 with 20 layers. The unchanged courier and reedling projects remain transparent editable PixelWall projects.

Fresh-package reproduction (2026-10-27): the staged ZIP was extracted into a new folder, and the official CLI rebuilt the overworld from `base/overworld.pixelwall` + `source/overworld-final.json`, the side view from `base/sideview.pixelwall` + `source/sideview-final.json`, and the showcase from the rebuilt side view + `source/showcase-final.json`. Each canonical/rebuilt project was rendered frame-by-frame and compared as decoded RGBA: **36/36 frames match exactly** (12 overworld, 12 side view, 12 Lantern Ford showcase). The same helper rebuilt both character manifests from blank projects: Mira 32×48, 3 layers, 20 frames; Mosslight reedling 40×32, 3 layers, 14 frames.

The original recorded canonical comparison also reports decoded RGBA equality for the revised environment frames, and the viewer-release record reports decoded equality between each side-view full frame and its near/background composites for frames 0–11. Those records are retained as supplementary evidence, not as a substitute for the fresh extraction above.

The revised desktop MCP test is BLOCKED by ECONNRESET and EPIPE connection errors. It produced no new desktop edit, library save, artifact checkpoint, or cross-interface reopen. The existing library-save failure remains FAIL. CLI inspect, apply, render, and native project delivery remain the supported verification path for this edition. Desktop Pro GIF/sheet export is BLOCKED; free individual PNGs and externally encoded MP4 loops are included.

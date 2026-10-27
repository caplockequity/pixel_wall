# Willowmere validation

This file records what the public handoff establishes. It is intentionally separate from the private evaluation logs.

## Fresh extraction check

The package was extracted into a new folder and rebuilt with the official PixelWall CLI bundle downloaded separately. The four canonical projects were inspected after extraction, and the public source manifests rebuilt equivalent projects:

| Project | Canvas | Layers | Frames | Result |
| --- | ---: | ---: | ---: | --- |
| Overworld | 512×384 | 14 | 12 | PASS |
| Lantern Ford | 768×256 | 12 | 12 | PASS |
| Mira courier | 32×48 | 3 | 20 | PASS |
| Mosslight reedling | 40×32 | 3 | 14 | PASS |

The tutorial command batch and bounded Lua pass also rebuilt and rendered successfully from the extracted package. Fresh-frame comparisons were performed against the canonical project renders for all 58 environment and character frames using decoded RGBA pixels. All 58 comparisons passed with zero mismatches. This public-package check was completed on October 27, 2026.

## Original evidence and limits

The original desktop and CLI evaluation found all 58 environment and character frames matching after CLI reopening of desktop checkpoints. The redesigned courier has 20 poses and the reedling has 14 poses; both retain three editable paint layers.

Large desktop local-library saves remained FAIL after the existing library reached its storage budget. Large desktop imports remained BLOCKED by the same budget. Successful file delivery and fresh-folder rebuilds do not convert those library operations into passes. The final redesigned characters were exported from the live editor; desktop reimport of those final character checkpoints is not claimed.

Desktop Pro produced the original GIFs and sprite sheets. Standalone CLI premium export remained BLOCKED without a portable Pro license. Individual PNG rendering and editable project files are available without that license. Hard-reload recovery of an unsaved environment was not tested.

The viewer is review code outside PixelWall. Its keyboard movement, jump, camera follow, parallax, tour, and reduced-motion behavior are not PixelWall features. No collision-aware gameplay or production-game readiness is claimed. No screen recording is included.

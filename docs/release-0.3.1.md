# PixelWall 0.3.1

This release completes script-driven palette and pixel-format operations and makes PixelWall's supported agent workflows easier to find and run across the web and desktop editors.

- Lua palette handles now follow effective per-frame palette keys and expose their key frame. Palette edits retain stable handles across frame changes and restore correctly when a transaction rolls back.
- Added the bounded `ColorQuantization` script command for Octree and RGB5A3 generation, including selected palette-color ranges and nonzero transparent indices.
- Expanded `ChangePixelFormat` to convert between RGBA, indexed and grayscale artwork with supported color fitting, grayscale methods and dithering controls.
- Pixel-format conversion preserves linked artwork where appropriate, resets indexed cel opacity, converts tile artwork and invalidates stale attached image handles safely.
- Added a public AI-agent guide, a machine-readable capability statement and an `llms.txt` discovery file. The guide distinguishes the CLI, browser command API, Lua, computer control and unavailable interfaces.
- Added a reproducible 63-command example that creates a three-frame ninja-panda idle animation, with downloadable commands, editable project and rendered PNG.
- Added direct links to the agent guide from the web editor's Scripts panel and the desktop Help menu.

Keep an editable project backup before replacing a desktop app. Updates do not install automatically. Existing local projects and Pro access remain on your device.

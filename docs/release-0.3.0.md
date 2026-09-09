# PixelWall 0.3.0

This release improves project safety, pixel rendering, color workflows and automation across the web editor, local browser bundle, CLI and desktop app.

- Closing the desktop app now requires successful saves for all bound projects. Failed, cancelled, timed-out or outdated saves keep artwork open unless you explicitly discard it.
- Native macOS Undo and Redo correctly handle artwork command batches and Lua transactions while retaining normal text-field history.
- Fixed a desktop shutdown error in clipboard cleanup and false file-conflict warnings after metadata-only file changes.
- Improved indexed conversion, frame palettes, transparent colors, linked cels and tile rendering. Added Octree and RGB5A3 palette generation, color matching options and additional dithering choices.
- Added working color-profile assignment and conversion, with managed canvas previews and rendered exports.
- Added bounded Lua scripting with transactions, blocking dialogs, image/color operations, image specifications, cel ordering, tileset editing and explicit extension command sessions with saved preferences.
- Improved pixel rotation, fractional export scaling and animation direction/repeat handling.
- Expanded CLI exports with input-scoped selections, grid extraction, finite tag playback and ordered scale/crop operations. Originals remain available in editable exports and game packages.
- Updated compatibility, scripting and export documentation.

Save portable project backups and quit PixelWall before replacing a desktop app. Updates do not install automatically. Existing local projects and Pro ownership licenses remain on your device.

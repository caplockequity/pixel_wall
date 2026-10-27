# PixelWall 0.4.2 — Reliable compact-project reopening

- Fixed reopening compressed `.pixelwall` backups in the web editor and standalone desktop app. Compact projects now use the byte-based project decoder instead of being parsed as text JSON.
- Existing legacy JSON `.pixelwall` backups remain supported, and existing compact backups do not need conversion.

The fix is included in the website, standalone browser download, and desktop app.

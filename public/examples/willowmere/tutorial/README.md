# Riverbank tutorial

Start with a blank 128×96 RGBA document. The command manifest builds the scene with named layers, anchored roots, a swaying canopy, and twelve water phases. The optional `reeds.lua` pass adds one bounded 16×16 reed detail to every frame.

Run the commands in the parent README from the example root. Open `reproduced/tutorial/finished.pixelwall` in PixelWall and play its 1.2-second clip. `riverbank-preview.png` is the expected first-frame reference.

To try a different motion profile, edit `riverbank-build.mjs`, regenerate `riverbank-commands.json`, and repeat in a fresh output folder. Keep the original files intact while comparing revisions.

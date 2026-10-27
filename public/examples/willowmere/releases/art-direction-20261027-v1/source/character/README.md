# Willowmere character manifests

`courier-v2.json` describes Mira, a 32×48 character with 20 poses (idle 0–5, walk 6–13, jump 14–19). `reedling-v2.json` describes the 40×32 Mosslight reedling with 14 poses (idle 0–5, walk 6–13). Each project has three painted layers and transparent backgrounds.

To rebuild from blank projects, run these commands from the package root (after installing the official CLI in `tools/cli/`):

```sh
mkdir -p reproduced
node tools/cli/pixelwall.mjs new --width 32 --height 48 --name "Mira" --out reproduced/courier-base.pixelwall
node source/apply-bounded.mjs reproduced/courier-base.pixelwall source/character/courier-v2.json reproduced/courier-from-manifest.pixelwall
node tools/cli/pixelwall.mjs new --width 40 --height 32 --name "Mosslight reedling" --out reproduced/reedling-base.pixelwall
node source/apply-bounded.mjs reproduced/reedling-base.pixelwall source/character/reedling-v2.json reproduced/reedling-from-manifest.pixelwall
```

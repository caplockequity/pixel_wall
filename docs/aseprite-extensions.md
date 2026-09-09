# Aseprite package import

`app/aseprite-extensions.mjs` imports `.aseprite-extension` and ZIP packages as local data. It does not execute scripts, call `init`/`exit`, register commands, write package paths to disk, make network requests, or apply shortcuts/themes. The original ZIP remains the durable source, and every load revalidates it.

The format and contribution names follow the official [extensions guide](https://www.aseprite.org/docs/extensions/), [palettes](https://www.aseprite.org/docs/extensions/palettes/), [dithering matrices](https://www.aseprite.org/docs/extensions/dithering-matrices/), [keys](https://www.aseprite.org/docs/extensions/keys/), [languages](https://www.aseprite.org/docs/extensions/languages/), [themes](https://www.aseprite.org/docs/extensions/themes/), and [Plugin API](https://www.aseprite.org/api/plugin). ZIP structural validation follows [PKWARE APPNOTE](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT); bounded decompression uses the existing [fflate streaming API](https://github.com/101arrowz/fflate#streaming).

## Supported data and explicit limits

| Contribution | Imported result | Activation |
|---|---|---|
| Lua scripts | `source`, original path and metadata; `status: "source-ready"` | Open/review source or explicitly run a package command through the separate session host. Importing never executes it. |
| GPL, JASC PAL, HEX/text palettes | `colors` in file order; `status: "ready"` | Caller can apply through `palette.update`. |
| Aseprite native palette files | First-frame palette chunks without decoding cels | Caller can apply the palette. |
| Indexed PNG palettes | PLTE order, unused entries and tRNS alpha retained | Caller can apply the palette. |
| RGB/RGBA PNG palettes | At most 255 distinct visible colors plus transparent entry; independently verified Aseprite octree ordering | Larger color sets requiring Aseprite quantization are reported as unsupported. Grayscale PNG palette interpretation is also explicitly unsupported. |
| Keyboard shortcut files | Raw UTF-8 XML; `status: "data-only"` | Preserved for review, never bound automatically. External XML declarations are rejected. |
| PNG dithering matrices | Width/height and decoded RGBA pixels; `status: "data-only"` | Preserved for later matrix selection; no conversion into a guessed threshold convention. Other image formats are retained with an unsupported diagnostic. |
| Themes and languages | Original files and contribution metadata | Explicitly unsupported for PixelWall's interface. |
| Unknown contributions | Metadata and all package assets retained | Explicitly unsupported, including future types without paths. |

Official plug-in scripts normally define `init(plugin)` and register commands using `plugin:newCommand`. **Run package commands** opens an explicit session in the Workbench, evaluates the available commands, runs one chosen callback and successful exit in the same VM, and commits bounded preferences atomically with artwork. See [package sessions](lua-package-sessions.md) for supported APIs and limits. **Open Lua source** retains the standalone review/run flow. Packages are never automatically activated or labeled fully compatible.

All safe files, including sibling Lua modules, images, licenses and README files, remain available through `readExtensionAsset`. This does not imply that the current Lua sandbox can resolve file dependencies or load native modules. Unsupported contributions are never silently dropped.

## Integration with the workbench

The existing command extension importer in `workbench.jsx` handles JSON via `validateExtension` and stores it under the `extensions` setting. Keep that flow. Create one Aseprite registry after opening the existing durable store:

```js
import {
  createAsepriteExtensionRegistry,
  readAsepriteExtension,
  readExtensionAsset,
} from './aseprite-extensions.mjs';

const registry = createAsepriteExtensionRegistry(store);
const archiveBytes = new Uint8Array(await file.arrayBuffer());
const preview = readAsepriteExtension(archiveBytes);
// Display preview.displayName, version, contributions and warnings.
const installed = await registry.install(archiveBytes);
const summaries = await registry.list();
const fullPackage = await registry.get(installed.id);
const source = fullPackage.contributions.find(c => c.kind === 'scripts').source;
const asset = readExtensionAsset(fullPackage, 'tools/helper.lua');
```

`list()` returns compact contribution metadata without script source, palette arrays or image pixels. `get(id)` returns the full validated package and enables asset access. `install(bytes, {replace: true})` explicitly replaces the same package name, preserving `installedAt` and enabled state while updating its version/time. `setEnabled(id, boolean)` records availability; the UI must honor that value before offering apply/run actions. `remove(id)` deletes the stored package and all its contributed data. Neither action runs lifecycle callbacks. Removing an extension does not undo palettes already applied to artwork or other document edits.

The registry uses the existing asynchronous `getSetting`/`setSetting` adapter, with a separate `aseprite-extension-packages-v1` setting. It serializes operations within one registry instance, stores complete raw archives atomically through `setSetting`, and surfaces storage/quota failures without mutating the previous saved package list. Construct one registry per workbench store. Concurrent independent windows should use the application's existing coordination strategy; this module does not provide cross-window compare-and-swap.

The Workbench offers Run package commands, Open Lua source, Apply palette, Inspect/download asset, Enable/disable, Replace package, and Remove. Include `.aseprite-extension,.zip` in the file input. Do not interpolate descriptions, authors, XML or Lua into HTML; these are untrusted display data. No code execution, external application write, or permission prompt is added by the importer.

## Resource boundaries

Archives allow stored/deflated, single-disk ZIP files with UTF-8 filenames and CRC verification. A root package.json or one consistent wrapper directory is accepted. Encryption, symbolic/special files, unsafe or ambiguous paths, overlapping entries, and inconsistent local/central headers are rejected. Descriptor-style streaming archives are supported. ZIP64 sizes, other compression schemes, and self-extracting archives are unsupported.

Limits: 16 MB compressed per package, 32 MB expanded per package, 8 MB per file, 1 MB per Lua source, 256 KB manifest, 1,024 ZIP entries, 512 contributions, 32 metadata nesting levels, and 16,384 metadata nodes. Parsed contribution data has a separate 32 MB budget. PNG contribution images are limited to 65,536 pixels and 1,024 pixels on either edge. Registry limits are 64 packages, 32 MB total compressed archives, and 64 MB total declared expansion. Inflation is checked in small streaming chunks, so a forged small output size cannot force allocation of the whole expanded payload.

## Validation

Run `node --test tests/aseprite-extensions.test.mjs` (31 tests) and lint the new module/test. Tests cover real ZIP encoding and descriptors, GPL/native/indexed-PNG/RGBA-PNG palettes, assets, unsupported contributions, malicious paths, corruption, malformed manifests, declared-small compressed expansion, registry reload/replacement/disable/removal, concurrent installs in one registry, and failed persistence. PNG ordering/alpha fixtures were independently captured from the local official Aseprite 1.3.18.5 source build; no Aseprite implementation was copied.

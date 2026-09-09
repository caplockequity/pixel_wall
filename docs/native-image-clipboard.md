# Native image clipboard bridge

This image-only desktop capability supplies the system clipboard boundary. Workbench owns selection compositing, ICC conversion, and action UI. It does not claim full Aseprite clipboard parity or change export licensing.

## Renderer contract

`window.pixelwallNativeClipboard` exposes only:

- `readImage()` resolves `{status:'image',format:'png',width,height,bytes,source,profilePreserved}`, `{status:'empty'}`, or `{status:'error',reason}`.
- `beginWrite()` consumes the current Copy/Cut gesture and resolves `{status:'reserved',token}`. Call it before expensive rendering, color conversion, or encoding.
- `cancelWrite({token})` resolves `{status:'cancelled'}` only for that pending reservation, otherwise `{status:'missing'}`; old cancellation never affects a newer operation.
- `writeImage({token,format:'png',bytes})` resolves `{status:'written',width,height}` or `{status:'error',reason}`.

An untrusted frame, missing/wrong/expired initial gesture, revoked reservation, or repeated operation rejects the promise. The legacy `writeImage({format,bytes})` path without a token still requires the original short-lived gesture; it is intended only for already-encoded immediate writes. No filesystem path, text, file list, clipboard type, arbitrary format, generic IPC method, or grant method is exposed to page scripts. The new capability uses distinct clipboard channels and does not use native file tokens.

Import `encodeClipboardImage` and `decodeClipboardImage` from `app/native-clipboard-payload.mjs`. The encoder accepts `{width,height,rgba,mask?}` with byte RGBA, including `Uint8ClampedArray`, and an optional one-byte-per-pixel binary mask. The host must crop/composite the selected region and transform its RGBA from the document's working profile to sRGB first. The helper writes explicit sRGB PNG, preserving alpha and clearing all channels outside the selection. It does not modify inputs. The native write rejects ICC-bearing or untagged PNG to catch missing color conversion.

The decoder returns `{width,height,rgba,colorProfile?,warnings,source,profilePreserved}`. The host transforms that source color profile into the current document's working profile before creating/pasting pixels. Original OS PNG bytes preserve embedded ICC/fixed-gamma information for the existing PNG decoder. If no raw PNG is available, Electron's `nativeImage` supplies PNG and `profilePreserved:false` identifies the conversion; the original profile may be unavailable. The host must explicitly apply its untagged-sRGB policy in that case. An empty/error clipboard must not silently paste stale internal pixels; any fallback should be a deliberate UI choice.

## User gestures and menu handoff

The sandboxed isolated preload captures real (`isTrusted`) Ctrl/Cmd+C, X, or V keydown events outside text/editable controls, and real primary clicks on `data-pixelwall-clipboard="copy|cut|paste"`. It sends a private grant message; no page-facing function can mint a grant. Synthetic clicks/keyboard events, repeats, modified alternate shortcuts, and text fields do not grant image access. Real text Copy/Cut/Paste privately revokes any pending image write, so delayed image work cannot overwrite the newer text clipboard. The listener never prevents the default action. Button markup must include the corresponding data attribute.

Main stores one matching initial gesture grant for four seconds. `beginWrite()` consumes that grant immediately and creates one small main-owned reservation pinned to the exact owner and frame. The reservation has no computation timeout: expensive rendering/ICC encoding can complete without losing the accepted gesture. It authorizes one bounded PNG write only, and is consumed even if decoding/writing fails. Main stores no image bytes while the renderer computes. A newer clipboard gesture, matching cancellation, blur, full main-frame navigation, renderer termination, owner closure/destruction, or attachment replacement revokes it. Arbitrary UI events do not revoke it.

The main-only `revoke(owner)` hook revokes previous clipboard work and returns an intent generation. Native menu callbacks call it before their asynchronous canvas-vs-text focus probe, including text Copy/Cut/Paste. After the probe, `authorize(owner, action, {generation})` may grant the canvas operation only if no newer clipboard intent intervened. This prevents a slow older focus probe from authorizing an image write after a newer text operation. The included `desktop/main.mjs` integration captures/passes this generation. Do not automatically retry rejected reservations or fall back to an unreserved write.

`desktop/update-checker.mjs` uses custom canvas-aware actions through `desktop/editor-controls.mjs`, preserving `webContents.cut()`, `.copy()`, and `.paste()` for focused input/textarea/contenteditable controls. `desktop/editor-controls.mjs` is intentionally unchanged in this patch. Toolbar and keyboard handlers call the same workbench actions, without intercepting text editing. Cut must remove artwork only after the system write returns `status:'written'`, and commit that removal in one Undo transaction. Pasting should capture the active document/revision before awaiting clipboard/color work and discard/reconfirm the result if the document changes.

The Workbench uses this reservation flow before rendering, releases it in `finally`, transforms copied colors to sRGB and pasted colors into the active document profile, and checks the captured document/revision/selection before Cut or Paste commits. Toolbar, native menu and keyboard actions share these handlers. A separate **Paste copied pixels** action explicitly accesses the internal copy; an empty/error system clipboard never silently falls back to stale internal pixels. Browser Copy starts a promised-PNG-Blob permission request within the user action.

## Limits and verification

The shared pure PNG inspector limits images to 4,194,304 pixels, encoded bytes to 32 MiB, and PNG chunks to 4,096. It rejects shared buffers, animation chunks, malformed headers/chunks/checksums, dimensions outside the budget, unsupported critical chunks, and trailing data. Dimensions are checked before native PNG decoding or renderer inflation. The existing decoder additionally validates compression, palettes, and profiles. Color profile validation/conversion remains the host color manager's responsibility.

The non-PNG `nativeImage` fallback is an explicit limitation: Electron/the OS has already decoded that representation before `getSize(1)` can enforce our dimension limit. Its dimensions are checked before PNG encoding and transfer. The OS may also normalize representations or round partially transparent channels. This patch has unit/integration tests with injected Electron APIs, including maximum-size data, malformed payloads, ICC bytes, gesture isolation, and permission lifetimes; rebuilt macOS desktop checks also passed Copy → Cut → system Paste → two native Undos on a 64×64 test image. Cross-application and high-DPI behavior still need broader native UI verification on supported platforms.

API signatures were checked against installed Electron 40.10.6 declarations and its pinned [clipboard documentation](https://github.com/electron/electron/blob/v40.10.6/docs/api/clipboard.md) and [nativeImage documentation](https://github.com/electron/electron/blob/v40.10.6/docs/api/native-image.md). This uses the Electron 40 main-process clipboard API, rather than the newer redesigned clipboard API.

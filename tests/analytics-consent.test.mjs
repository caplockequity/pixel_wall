import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as acquisition from "../app/acquisition.mjs";

const source = await readFile(new URL("../app/analytics.ts", import.meta.url), "utf8");
// Replace only the SDK import boundary so tests can control chunk delivery/failure.
// All consent, queueing, initialization, and capture logic runs unchanged.
const testSource = source.replace('sdkLoading = import("posthog-js")', 'sdkLoading = globalThis.__loadPostHog()');
assert.notEqual(testSource, source);
const compiled = ts.transpileModule(testSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const preferenceKey = "pixelwall-analytics-consent-v2";
const legacyKey = "pixelwall-analytics-consent-v1";

// Run the real consent module against an isolated SDK boundary. No telemetry is sent.
function setup({ stored = {}, privacy = {}, deferLoaded = false, deferImport = false, importFails = false, readFails = false, configured = true, referrer } = {}) {
  const storage = new Map(Object.entries(stored));
  const window = new EventTarget();
  let writeFails = false;
  window.localStorage = {
    getItem(key) { if (readFails) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
    setItem(key, value) { if (writeFails) throw new Error("Storage full"); storage.set(key, value); },
  };
  window.location = { protocol: "https:", origin: "https://www.pixelwall.dev" };
  const navigator = { ...privacy };
  const calls = { imports: 0, init: 0, stop: 0, optOut: 0, referrerReads: 0, events: [] };
  const sdk = {
    config: {}, capturing: false, recording: false,
    init(_token, config) {
      calls.init++;
      this.config = config;
      if (!deferLoaded) config.loaded(this);
    },
    set_config(config) {
      this.config = { ...this.config, ...config };
      this.recording = this.capturing && !this.config.disable_session_recording;
    },
    is_capturing() { return this.capturing; },
    opt_in_capturing() { this.capturing = true; this.recording = !this.config.disable_session_recording; },
    opt_out_capturing() { calls.optOut++; this.capturing = false; this.recording = false; },
    stopSessionRecording() { calls.stop++; this.recording = false; this.config.disable_session_recording = true; },
    capture(event, properties = {}) {
      if (!this.capturing) return;
      const result = this.config.before_send({ event, properties });
      if (result) calls.events.push(JSON.parse(JSON.stringify(result)));
    },
  };
  let releaseImport;
  let shouldFailImport = importFails;
  const exports = {};
  const context = vm.createContext({
    exports, window, navigator, Event,
    ...(referrer === undefined ? {} : { document: { get referrer() { calls.referrerReads++; return referrer; } } }),
    process: { env: { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: configured ? "test-project" : "", NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com" } },
    URL,
    require(name) { assert.equal(name, "./acquisition.mjs", `Unexpected eager dependency: ${name}`); return acquisition; },
    __loadPostHog() {
      calls.imports++;
      if (shouldFailImport) return Promise.reject(new Error("SDK chunk unavailable"));
      if (deferImport) return new Promise((resolve) => { releaseImport = () => resolve({ default: sdk }); });
      return Promise.resolve({ default: sdk });
    },
  });
  vm.runInContext(compiled, context, { filename: "analytics.js" });
  function updateFromOtherTab(level) {
    if (level === null) storage.clear();
    else storage.set(preferenceKey, level);
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: level === null ? null : preferenceKey });
    window.dispatchEvent(event);
  }
  return {
    api: exports, sdk, calls, storage, window, navigator, updateFromOtherTab,
    failWrites() { writeFails = true; },
    deliverImport() { assert.ok(releaseImport, "SDK import is pending"); releaseImport(); },
    allowImport() { shouldFailImport = false; },
  };
}

const edited = { tool: "pencil", edit_type: "stroke", input_method: "pointer", linked_edges: false };
const settleSdk = () => new Promise((resolve) => setImmediate(resolve));

test("required-only and undecided visitors never download analytics or backfill pre-consent events", async () => {
  const { api, calls, storage } = setup();
  assert.equal(api.getAnalyticsConsentStatus(), "pending");
  api.initializeAnalytics();
  api.captureAnalyticsEvent("canvas_edit_committed", edited);
  await settleSdk();
  assert.equal(calls.imports, 0);
  assert.equal(calls.init, 0);
  assert.equal(api.setAnalyticsLevel("required"), true);
  assert.equal(api.getAnalyticsConsentStatus(), "denied");
  api.captureAnalyticsEvent("canvas_edit_committed", edited);
  await settleSdk();
  assert.equal(calls.imports, 0);
  assert.equal(calls.init, 0);
  assert.equal(storage.get(preferenceKey), "required");
  api.setAnalyticsLevel("usage");
  await settleSdk();
  assert.equal(calls.imports, 1);
  assert.equal(calls.init, 1);
  assert.equal(calls.events.length, 0, "earlier edits were discarded");
});

test("usage permits sanitized product events and page visits without replay or automatic diagnostics", async () => {
  const { api, sdk, calls } = setup();
  api.setAnalyticsLevel("usage");
  await settleSdk();
  assert.equal(api.getAnalyticsLevel(), "usage");
  assert.equal(sdk.config.autocapture, false);
  assert.equal(sdk.config.capture_exceptions, false);
  assert.equal(sdk.config.capture_performance, false);
  assert.equal(sdk.config.capture_heatmaps, false);
  assert.equal(sdk.config.capture_dead_clicks, false);
  assert.equal(sdk.config.rageclick, false);
  assert.equal(sdk.config.disable_session_recording, true);
  assert.equal(sdk.recording, false);
  api.captureAnalyticsEvent("canvas_edit_committed", { ...edited, pixels: "secret", project_name: "private-project", changed_cells: Infinity });
  assert.deepEqual(calls.events[0].properties, edited);
  sdk.capture("$pageview", { $current_url: "https://pixelwall.example/?private=1#secret" });
  assert.equal(calls.events[1].properties.$current_url, "https://pixelwall.example/");
  for (const event of ["$snapshot", "$autocapture", "$exception", "$web_vitals", "$rageclick", "unexpected_event"]) sdk.capture(event);
  assert.equal(calls.events.length, 2);
});

test("enhanced diagnostics enable masked replay and redact error contents; downgrades stop them immediately", async () => {
  const { api, sdk, calls } = setup();
  api.setAnalyticsLevel("enhanced");
  await settleSdk();
  assert.equal(sdk.recording, true);
  assert.equal(sdk.config.capture_exceptions.capture_unhandled_errors, true);
  assert.equal(sdk.config.session_recording.maskAllInputs, true);
  assert.equal(sdk.config.session_recording.captureCanvas.recordCanvas, false);
  assert.equal(sdk.config.session_recording.blockClass, "ph-no-capture");
  assert.equal(sdk.config.session_recording.recordBody, false);
  sdk.capture("$exception", { $exception_message: "private-project", $exception_list: [{ type: "Error", value: "private-project", stacktrace: { frames: [{ filename: "blob:private-image" }] } }] });
  assert.equal(JSON.stringify(calls.events).includes("private-project"), false);
  assert.equal(JSON.stringify(calls.events).includes("private-image"), false);
  api.setAnalyticsLevel("usage");
  assert.equal(sdk.recording, false);
  assert.equal(sdk.config.disable_session_recording, true);
  assert.equal(sdk.config.autocapture, false);
  sdk.capture("$snapshot");
  assert.equal(calls.events.length, 1);
  api.captureAnalyticsEvent("canvas_edit_committed", edited);
  assert.equal(calls.events.length, 2);
  api.setAnalyticsLevel("required");
  assert.equal(sdk.capturing, false);
  api.captureAnalyticsEvent("canvas_edit_committed", edited);
  sdk.capture("$snapshot");
  assert.equal(calls.events.length, 2);
  api.setAnalyticsLevel("enhanced");
  assert.equal(sdk.recording, true, "an explicit new opt-in can enable replay again");
});

test("legacy permission migrates to usage only and malformed new preferences cannot resurrect it", async () => {
  for (const [legacy, expected] of [["granted", "usage"], ["denied", "required"]]) {
    const { api, sdk, calls } = setup({ stored: { [legacyKey]: legacy } });
    api.initializeAnalytics();
    await settleSdk();
    assert.equal(api.getAnalyticsLevel(), expected);
    assert.equal(sdk.recording, false);
    assert.equal(calls.imports, expected === "usage" ? 1 : 0);
  }
  const invalid = setup({ stored: { [preferenceKey]: "anything", [legacyKey]: "granted" } });
  assert.equal(invalid.api.getAnalyticsConsentStatus(), "pending");
  await settleSdk();
  assert.equal(invalid.calls.imports, 0);
  assert.equal(invalid.calls.init, 0);
});

test("a failed preference write disables analytics for the visit even over a previously saved opt-in", async () => {
  const { api, sdk, storage, failWrites, calls } = setup();
  api.setAnalyticsLevel("enhanced");
  await settleSdk();
  failWrites();
  assert.equal(api.setAnalyticsLevel("required"), false);
  assert.equal(storage.get(preferenceKey), "enhanced");
  assert.equal(api.getAnalyticsLevel(), "required");
  assert.equal(sdk.recording, false);
  assert.equal(sdk.capturing, false);
  api.captureAnalyticsEvent("canvas_edit_committed", edited);
  assert.equal(calls.events.length, 0);
  assert.equal(api.setAnalyticsLevel("usage"), false);
  assert.equal(sdk.capturing, false);
  const unavailable = setup({ readFails: true });
  assert.equal(unavailable.api.getAnalyticsConsentStatus(), "unavailable");
  unavailable.api.initializeAnalytics();
  await settleSdk();
  assert.equal(unavailable.calls.imports, 0);
  assert.equal(unavailable.calls.init, 0);
});

test("browser privacy signals override saved and newly requested optional levels", async () => {
  for (const privacy of [{ doNotTrack: "1" }, { globalPrivacyControl: true }]) {
    const { api, calls } = setup({ privacy, stored: { [preferenceKey]: "enhanced" } });
    api.initializeAnalytics();
    assert.equal(api.getAnalyticsConsentStatus(), "blocked");
    assert.equal(api.getAnalyticsLevel(), "required");
    assert.equal(api.setAnalyticsLevel("enhanced"), false);
    await settleSdk();
    assert.equal(calls.imports, 0);
    assert.equal(calls.init, 0);
  }
  const live = setup();
  live.api.setAnalyticsLevel("enhanced");
  await settleSdk();
  live.navigator.globalPrivacyControl = true;
  live.window.dispatchEvent(new Event("focus"));
  assert.equal(live.sdk.recording, false);
  assert.equal(live.sdk.capturing, false);
});

test("preferences synchronize across tabs and clearing stored consent stops an active recorder", async () => {
  const { api, sdk, updateFromOtherTab, storage } = setup();
  api.initializeAnalytics();
  updateFromOtherTab("enhanced");
  await settleSdk();
  assert.equal(sdk.recording, true);
  updateFromOtherTab("usage");
  assert.equal(sdk.recording, false);
  assert.equal(sdk.capturing, true);
  updateFromOtherTab("required");
  assert.equal(sdk.capturing, false);
  api.setAnalyticsLevel("enhanced");
  assert.equal(storage.get(legacyKey), "denied", "old tabs must also stop their broad tracking");
  updateFromOtherTab(null);
  assert.equal(api.getAnalyticsConsentStatus(), "pending");
  assert.equal(sdk.capturing, false);
  assert.equal(sdk.recording, false);
});

test("a delayed SDK loaded callback cannot re-enable capture after withdrawal", async () => {
  const { api, sdk } = setup({ deferLoaded: true });
  api.setAnalyticsLevel("enhanced");
  await settleSdk();
  api.setAnalyticsLevel("required");
  sdk.config.loaded(sdk);
  assert.equal(sdk.capturing, false);
  assert.equal(sdk.recording, false);
});

test("concurrent granted events share one SDK download and retain only sanitized properties", async () => {
  const { api, calls, deliverImport } = setup({ deferImport: true });
  api.setAnalyticsLevel("usage");
  for (let index = 0; index < 3; index++) {
    api.initializeAnalytics();
    api.captureAnalyticsEvent("canvas_edit_committed", { ...edited, pixels: "private-artwork" });
  }
  assert.equal(calls.imports, 1);
  assert.equal(calls.init, 0);
  assert.equal(calls.events.length, 0);
  deliverImport();
  await settleSdk();
  assert.equal(calls.init, 1);
  assert.equal(calls.events.length, 3);
  for (const event of calls.events) assert.deepEqual(event.properties, edited);
  api.initializeAnalytics();
  assert.equal(calls.imports, 1);
  assert.equal(calls.init, 1);
});

test("withdrawing consent during SDK download prevents initialization and discards queued events", async () => {
  const { api, sdk, calls, deliverImport } = setup({ deferImport: true });
  api.setAnalyticsLevel("enhanced");
  api.captureAnalyticsEvent("canvas_edit_committed", edited);
  api.setAnalyticsLevel("required");
  deliverImport();
  await settleSdk();
  assert.equal(calls.init, 0);
  assert.equal(calls.events.length, 0);
  assert.equal(sdk.capturing, false);
  assert.equal(sdk.recording, false);
  api.setAnalyticsLevel("usage");
  assert.equal(calls.init, 1, "a later explicit grant may use the already downloaded SDK");
  assert.equal(calls.imports, 1);
  assert.equal(calls.events.length, 0, "withdrawn events must not return on a later grant");
});

test("a browser privacy signal arriving during SDK download prevents initialization", async () => {
  const { api, sdk, calls, navigator, deliverImport } = setup({ deferImport: true });
  api.setAnalyticsLevel("enhanced");
  api.captureAnalyticsEvent("canvas_edit_committed", edited);
  navigator.globalPrivacyControl = true;
  deliverImport();
  await settleSdk();
  assert.equal(calls.init, 0);
  assert.equal(calls.events.length, 0);
  assert.equal(sdk.capturing, false);
  assert.equal(sdk.recording, false);
  navigator.globalPrivacyControl = false;
  api.initializeAnalytics();
  assert.equal(calls.init, 1);
  assert.equal(calls.events.length, 0, "events interrupted by a privacy signal are discarded");
});

test("a failed SDK download is contained and a later eligible attempt can recover", async () => {
  const { api, calls, allowImport } = setup({ importFails: true });
  assert.doesNotThrow(() => {
    api.setAnalyticsLevel("usage");
    api.captureAnalyticsEvent("canvas_edit_committed", edited);
  });
  await settleSdk();
  assert.equal(calls.imports, 1);
  assert.equal(calls.init, 0);
  assert.equal(calls.events.length, 0);
  allowImport();
  api.initializeAnalytics();
  await settleSdk();
  assert.equal(calls.imports, 2);
  assert.equal(calls.init, 1);
  assert.equal(calls.events.length, 0, "events from a failed download are discarded");
  api.captureAnalyticsEvent("canvas_edit_committed", edited);
  assert.equal(calls.events.length, 1);
});

test("unconfigured analytics never downloads the SDK even with stored consent", async () => {
  const { api, calls } = setup({ configured: false, stored: { [preferenceKey]: "enhanced" } });
  api.initializeAnalytics();
  api.captureAnalyticsEvent("canvas_edit_committed", edited);
  await settleSdk();
  assert.equal(api.getAnalyticsConsentStatus(), "unavailable");
  assert.equal(calls.imports, 0);
  assert.equal(calls.init, 0);
});

test("referral classification reads the browser only after consent and stops immediately on refusal", async () => {
  const { api, sdk, calls, storage, navigator } = setup({ referrer: "https://chatgpt.com/c/private?utm_source=secret" });
  api.initializeAnalytics();
  api.captureAnalyticsEvent("canvas_edit_committed", edited);
  api.setAnalyticsLevel("required");
  await settleSdk();
  assert.equal(calls.referrerReads, 0);
  api.setAnalyticsLevel("usage");
  await settleSdk();
  sdk.capture("$pageview", { $referrer: "https://private.example/path", $initial_referrer: "private", $referring_domain: "private.example", utm_source: "secret", $initial_utm_campaign: "secret", gclid: "secret", entry_page: "private-path" });
  assert.deepEqual(calls.events[0].properties, { referral_source: "chatgpt" });
  assert.equal(calls.referrerReads, 1);
  assert.equal(JSON.stringify([...storage]).includes("private"), false);
  api.setAnalyticsLevel("required");
  assert.equal(sdk.config.before_send({ event: "$pageview", properties: {} }), null);
  assert.equal(calls.referrerReads, 1);
  api.setAnalyticsLevel("usage");
  navigator.globalPrivacyControl = true;
  assert.equal(sdk.config.before_send({ event: "$pageview", properties: {} }), null);
  assert.equal(calls.referrerReads, 1);
});

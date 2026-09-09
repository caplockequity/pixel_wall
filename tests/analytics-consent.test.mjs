import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import * as acquisition from "../app/acquisition.mjs";
import { createWorkbenchAnalytics } from "../app/workbench-analytics.mjs";

// Exercise the real installed SDK transport validation without creating an instance
// or allowing any network calls. The app consent module still uses the isolated SDK.
const { PostHog } = createRequire(import.meta.url)("../node_modules/posthog-js/lib/src/posthog-core.js");

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
function setup({ stored = {}, privacy = {}, deferLoaded = false, deferImport = false, importFails = false, readFails = false, configured = true, referrer, origin = "https://www.pixelwall.dev", standalone = false } = {}) {
  const storage = new Map(Object.entries(stored));
  const window = new EventTarget();
  let writeFails = false;
  window.localStorage = {
    getItem(key) { if (readFails) throw new Error("Storage blocked"); return storage.get(key) ?? null; },
    setItem(key, value) { if (writeFails) throw new Error("Storage full"); storage.set(key, value); },
  };
  window.location = { protocol: "https:", origin, pathname: "/editor" };
  const navigator = { ...privacy };
  const calls = { imports: 0, init: 0, stop: 0, optOut: 0, referrerReads: 0, vitalsStarts: 0, events: [] };
  const sdk = {
    config: {}, capturing: false, recording: false,
    webVitalsAutocapture: { startIfEnabled() { calls.vitalsStarts++; } },
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
    exports, window, navigator, Event, Date,
    ...(referrer === undefined ? {} : { document: { get referrer() { calls.referrerReads++; return referrer; } } }),
    process: { env: { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: configured ? "test-project" : "", NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com", NEXT_PUBLIC_PIXELWALL_STANDALONE: String(standalone) } },
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

const common = { token: "test-project", $process_person_profile: false, $geoip_disable: true, $is_identified: false, analytics_schema_version: 2, environment: "production", page_group: "editor", editor_variant: "workbench" };
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
  assert.deepEqual(calls.events[0].properties, { ...edited, ...common });
  sdk.capture("site_page_viewed", { page_group: "editor", $current_url: "https://pixelwall.example/?private=1#secret" });
  assert.equal(calls.events[1].properties.$current_url, undefined);
  for (const event of ["$snapshot", "$autocapture", "$exception", "$web_vitals", "$rageclick", "unexpected_event"]) sdk.capture(event);
  assert.equal(calls.events.length, 2);
});

test("enhanced diagnostics never record sessions and redact error contents; downgrades stop them immediately", async () => {
  const { api, sdk, calls } = setup();
  api.setAnalyticsLevel("enhanced");
  await settleSdk();
  assert.equal(sdk.recording, false);
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
  assert.equal(sdk.recording, false, "replay stays disabled at every consent level");
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
  assert.equal(sdk.recording, false);
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
  for (const event of calls.events) assert.deepEqual(event.properties, { ...edited, ...common });
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
  sdk.capture("site_page_viewed", { $referrer: "https://private.example/path", $initial_referrer: "private", $referring_domain: "private.example", utm_source: "secret", $initial_utm_campaign: "secret", gclid: "secret", entry_page: "private-path" });
  assert.deepEqual(calls.events[0].properties, { ...common, referral_source: "chatgpt" });
  assert.equal(calls.referrerReads, 1);
  assert.equal(JSON.stringify([...storage]).includes("private"), false);
  api.setAnalyticsLevel("required");
  assert.equal(sdk.config.before_send({ event: "site_page_viewed", properties: {} }), null);
  assert.equal(calls.referrerReads, 1);
  api.setAnalyticsLevel("usage");
  navigator.globalPrivacyControl = true;
  assert.equal(sdk.config.before_send({ event: "site_page_viewed", properties: {} }), null);
  assert.equal(calls.referrerReads, 1);
});

test("private previews, development and downloadable apps never import the SDK", async () => {
  for (const options of [
    { origin: "https://pixelwall-maker.ben-zavadil.chatgpt.site" },
    { origin: "https://preview.vercel.app" },
    { origin: "http://localhost:5173" },
    { origin: "file://" },
    { standalone: true },
  ]) {
    const { api, calls } = setup({ ...options, stored: { [preferenceKey]: "enhanced" } });
    api.initializeAnalytics();
    api.captureAnalyticsEvent("site_page_viewed", { page_group: "home" });
    await settleSdk();
    assert.equal(api.isAnalyticsConfigured(), false);
    assert.equal(calls.imports, 0);
    assert.equal(calls.events.length, 0);
  }
});

test("the final payload boundary rejects enrichment, private identifiers and unknown events at every level", async () => {
  const { api, sdk, calls } = setup();
  api.setAnalyticsLevel("enhanced");
  await settleSdk();
  const id = "019a0000-1111-7777-aaaa-123456789abc";
  const result = sdk.config.before_send({
    event: "export_failed", uuid: id, $set: { email: "secret@example.com" }, $set_once: { name: "secret" }, $unset: ["secret"],
    properties: { export_type: "gif", reason: "secret-token", project_name: "secret", distinct_id: id, $session_id: id,
      $device_id: "secret@example.com", $browser: "Chrome", $os: "Mac OS X", $device_type: "Desktop", $process_person_profile: true,
      $current_url: "https://secret.example/private", $pathname: "/secret", $referrer: "https://secret.example",
      nested: { a: { b: { c: { d: { e: { f: { private: "secret" } } } } } } },
      $set: { email: "secret" }, $geoip_city_name: "secret", $initial_utm_source: "secret", $raw_user_agent: "secret" },
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(result.uuid, id);
  assert.equal(result.properties.distinct_id, id);
  assert.equal(result.properties.$session_id, id);
  assert.equal(result.properties.$browser, "Chrome");
  assert.equal(result.properties.$process_person_profile, false);
  assert.equal(result.$set, undefined);
  for (const name of ["$snapshot", "$autocapture", "$pageview", "$pageleave", "$identify", "$groupidentify", "private-event", "__proto__"]) {
    assert.equal(sdk.config.before_send({ event: name, properties: {} }), null);
    assert.doesNotThrow(() => api.captureAnalyticsEvent(name, { reason: "secret" }));
  }
  assert.equal(calls.events.length, 0);
  assert.equal(sdk.config.capture_pageview, false);
  assert.equal(sdk.config.capture_pageleave, false);
  assert.equal(sdk.config.disable_surveys, true);
  assert.equal(sdk.config.disable_conversations, true);
  assert.equal(sdk.config.disable_product_tours, true);
  assert.equal(sdk.config.logs.beforeSend({ body: "secret" }), null);
  assert.equal(sdk.config.session_recording.maskCapturedNetworkRequestFn({ name: "https://secret.example" }), null);
});

test("diagnostics keep only finite performance measures and known error types", async () => {
  const { api, sdk, calls } = setup();
  api.setAnalyticsLevel("enhanced");
  await settleSdk();
  sdk.capture("$web_vitals", { $web_vitals_LCP_value: 1234.5, $web_vitals_INP_value: Infinity, $web_vitals_CLS_value: 0.1,
    $web_vitals_LCP_event: { entries: [{ url: "https://secret.example", name: "secret" }] } });
  sdk.capture("$exception", { $exception_list: [{ type: "secret", value: "secret", mechanism: { type: "secret" },
    stacktrace: { frames: [{ filename: "https://secret.example/private", function: "secret" }] } }] });
  assert.equal(calls.events[0].properties.$web_vitals_LCP_value, 1234.5);
  assert.equal(calls.events[0].properties.$web_vitals_INP_value, undefined);
  assert.equal(calls.events[1].properties.$exception_list[0].type, "Error");
  assert.equal(JSON.stringify(calls.events).includes("secret"), false);
});


test("real PostHog transport validation accepts the scrubbed SDK envelope", async () => {
  const { api, sdk } = setup();
  api.setAnalyticsLevel("enhanced");
  await settleSdk();
  const id = "019a0000-1111-7777-aaaa-123456789abc";
  const timestamp = new Date();
  const original = {
    event: "desktop_download_clicked", uuid: id, timestamp,
    $set: { email: "private@example.invalid" },
    properties: {
      token: "caller-must-not-control-project", distinct_id: `$device:${id}`,
      $device_id: id, $session_id: id, $window_id: id, $pageview_id: id,
      $browser: "Chrome", $browser_version: 145, $os: "Mac OS X",
      $device_type: "Desktop", $lib: "web", $lib_version: "1.420.0",
      $screen_width: 1728, $screen_height: 1117,
      $current_url: "https://www.pixelwall.dev/downloads?private=secret",
      $pathname: "/downloads", $referrer: "https://example.invalid/private",
      platform: "darwin-arm64", version: "0.2.1", package_type: "zip",
      $process_person_profile: false, $is_identified: false,
    },
  };
  // Installed PostHog rejects events when before_send removes required fields.
  const result = PostHog.prototype._runBeforeSend.call({ config: { before_send: sdk.config.before_send } }, original);
  assert.ok(result, "the installed SDK must accept the final envelope");
  assert.equal(result.properties.token, "test-project", "retain the trusted configured project token");
  assert.equal(result.uuid, id);
  assert.equal(result.timestamp, timestamp);
  assert.equal(result.properties.distinct_id, `$device:${id}`);
  assert.equal(result.properties.$session_id, id);
  assert.equal(result.properties.platform, "darwin-arm64");
  assert.equal(result.properties.version, "0.2.1");
  assert.equal(result.$set, undefined);
  assert.equal(result.properties.$current_url, undefined);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("upgrading Usage to Enhanced starts the existing SDK's web vitals collector", async () => {
  const { api, sdk, calls } = setup();
  api.setAnalyticsLevel("usage");
  await settleSdk();
  assert.equal(calls.vitalsStarts, 0);
  api.setAnalyticsLevel("enhanced");
  assert.equal(calls.init, 1, "upgrade uses the existing SDK instance");
  assert.equal(calls.vitalsStarts, 1, "set_config alone does not start the installed SDK collector");
  api.initializeAnalytics();
  assert.equal(calls.vitalsStarts, 1, "repeated events do not restart the collector");
  api.setAnalyticsLevel("usage");
  assert.equal(sdk.config.capture_performance, false);
  assert.equal(sdk.config.before_send({ event: "$web_vitals", properties: { $web_vitals_LCP_value: 10 } }), null);
});


test("workbench milestones survive the final event catalog without losing their operation categories", async () => {
  const { api, calls } = setup();
  api.setAnalyticsLevel("usage");
  await settleSdk();
  const analytics = createWorkbenchAnalytics({ capture: api.captureAnalyticsEvent, consented: () => true,
    getDocument: () => ({ width: 64, height: 32, frames: [], layers: [], colorMode: "indexed" }), now: () => 0 });
  analytics.committed({ type: "draw.gradient" }, true);
  analytics.project("new", "completed");
  analytics.imported("extension", "json", 1);
  analytics.exportFinished(analytics.exportStarted("zip", "automation"));
  analytics.recovery("view", "completed");
  analytics.automation("apply", 2000);
  const event = name => calls.events.find(item => item.event === name).properties;
  assert.equal(event("editor_activated").activation_type, "gradient");
  assert.equal(event("editor_tool_used").tool_family, "gradient");
  assert.equal(event("project_file_operation").outcome, "success");
  assert.equal(event("import_completed").import_kind, "extension");
  assert.equal(event("export_completed").export_type, "zip");
  assert.equal(event("export_completed").source, "automation");
  assert.equal(event("recovery_action").action, "view");
  assert.equal(event("automation_used").operation, "apply");
});

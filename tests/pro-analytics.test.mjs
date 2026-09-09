import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../app/pro-access.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const ownedCode = "PW2.private-test-license";
const privateSession = "cs_private-test-checkout";
const privateRecovery = "PW1.private-test-recovery";

// Isolate the hook's real operation callbacks from React rendering and all network/storage.
function harness({ href = "https://www.pixelwall.dev/editor", respond = () => ({ pro: false, checkoutAvailable: true, mode: "live" }), online = true } = {}) {
  const events = [], requests = [], effects = [], timers = [], redirects = [], settings = new Map();
  const context = vm.createContext({
    exports: {}, URL, Error, TypeError, AbortSignal,
    process: { env: { NEXT_PUBLIC_PIXELWALL_LICENSE_MODE: "live" } },
    navigator: { onLine: online },
    window: {
      location: { href, assign: (url) => redirects.push(url) },
      history: { replaceState() {} },
      localStorage: { getItem: (key) => settings.get(key) ?? null, setItem: (key, value) => settings.set(key, value), removeItem: (key) => settings.delete(key) },
      setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout() {}, addEventListener() {}, removeEventListener() {},
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const response = await respond(String(url).split("/").pop(), options);
      return { ok: !response.status || response.status < 400, status: response.status ?? 200, json: async () => response.body ?? response };
    },
    require(name) {
      if (name === "react") return { useCallback: (callback) => callback, useEffect: (effect) => effects.push(effect), useRef: (current) => ({ current }), useState: (initial) => { let value = initial; return [value, (next) => { value = typeof next === "function" ? next(value) : next; }]; } };
      if (name === "./analytics") return { captureAnalyticsEvent: (event, properties) => events.push(JSON.parse(JSON.stringify({ event, properties }))) };
      if (name === "./offline-license.mjs") return { verifyOfflineLicense: async (code) => code === ownedCode };
      if (name === "./license-public-keys.mjs") return { PINNED_PUBLIC_KEYS: {} };
      if (name === "./storage.mjs") return { openStore: async () => ({ getSetting: async (key, fallback) => settings.get(key) ?? fallback, setSetting: async (key, value) => settings.set(key, value), close() {} }) };
      if (name === "react/jsx-runtime" || name === "lucide-react") return {};
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  vm.runInContext(compiled, context, { filename: "pro-access.js" });
  const access = context.exports.useProAccess();
  return { access, events, requests, redirects, async mount() { effects.forEach((effect) => effect()); timers.splice(0).forEach((timer) => timer()); await new Promise(setImmediate); } };
}
function onlyEvent(result, name) { return result.events.filter((entry) => entry.event === name); }
function assertNoPrivateData(result) {
  const captured = JSON.stringify(result.events);
  for (const privateValue of [ownedCode, privateSession, privateRecovery, "secret server error"]) assert.ok(!captured.includes(privateValue));
}

test("checkout return is separate from a verified ownership claim and never includes the payment or license values", async () => {
  const result = harness({ href: `https://www.pixelwall.dev/editor?checkout=success&session_id=${privateSession}`, respond: (action) => action === "claim" ? { pro: true, offlineLicense: ownedCode, recoveryCode: privateRecovery } : { pro: true } });
  await result.mount();
  assert.deepEqual(onlyEvent(result, "checkout_returned"), [{ event: "checkout_returned", properties: { outcome: "success" } }]);
  assert.deepEqual(onlyEvent(result, "entitlement_claimed"), [{ event: "entitlement_claimed", properties: { outcome: "success", reason: "none", billing_mode: "live" } }]);
  assertNoPrivateData(result);
});

test("a successful return URL without a session or a verified license never records a successful entitlement", async () => {
  const noSession = harness({ href: "https://www.pixelwall.dev/editor?checkout=success" });
  await noSession.mount();
  assert.equal(onlyEvent(noSession, "entitlement_claimed").length, 0);
  const legacy = harness({ href: `https://www.pixelwall.dev/editor?checkout=success&session_id=${privateSession}`, respond: () => ({ pro: true, recoveryCode: privateRecovery }) });
  await legacy.mount();
  assert.deepEqual(onlyEvent(legacy, "entitlement_claimed")[0].properties, { outcome: "online_only", reason: "ownership_license_unavailable", billing_mode: "live" });
  assertNoPrivateData(legacy);
});

test("claim errors report a finite failure reason and keep server messages private", async () => {
  const result = harness({ href: `https://www.pixelwall.dev/editor?checkout=success&session_id=${privateSession}`, respond: () => ({ status: 409, body: { error: "secret server error" } }) });
  await result.mount();
  assert.deepEqual(onlyEvent(result, "entitlement_claimed")[0].properties, { outcome: "failure", reason: "payment_pending", billing_mode: "live" });
  assertNoPrivateData(result);
});

test("restoration success requires a verified ownership license and revoked access is a failure", async () => {
  const restored = harness({ online: false });
  await restored.access.restore(ownedCode);
  assert.deepEqual(onlyEvent(restored, "entitlement_restored")[0].properties, { outcome: "success", reason: "none", billing_mode: "live" });
  assert.equal(restored.requests.length, 0);
  const revoked = harness({ respond: () => ({ status: 403, body: { error: "secret server error" } }) });
  await revoked.access.restore(ownedCode);
  assert.deepEqual(onlyEvent(revoked, "entitlement_restored")[0].properties, { outcome: "failure", reason: "verification_failed", billing_mode: "live" });
  const invalid = harness();
  await invalid.access.restore("PW2.invalid-private-license");
  assert.equal(onlyEvent(invalid, "entitlement_restored")[0].properties.outcome, "failure");
  assertNoPrivateData(restored); assertNoPrivateData(revoked); assertNoPrivateData(invalid);
});

test("checkout redirects only after project persistence succeeds and busy clicks are not counted again", async () => {
  let resolveCheckout;
  const result = harness({ respond: () => new Promise((resolve) => { resolveCheckout = resolve; }) });
  const first = result.access.checkout(() => {});
  await result.access.checkout(() => {});
  assert.equal(onlyEvent(result, "checkout_started").length, 1);
  resolveCheckout({ url: "https://checkout.stripe.com/c/pay/private-session" });
  await first;
  assert.equal(onlyEvent(result, "checkout_redirected").length, 1);
  assert.equal(result.redirects.length, 1);
  const failedSave = harness({ respond: () => ({ url: "https://checkout.stripe.com/c/pay/private-session" }) });
  await failedSave.access.checkout(() => { const error = new Error("private project name"); error.name = "ProjectSaveError"; throw error; });
  assert.equal(onlyEvent(failedSave, "checkout_redirected").length, 0);
  assert.deepEqual(onlyEvent(failedSave, "checkout_failed")[0].properties, { reason: "save_failed", billing_mode: "live" });
  assert.equal(failedSave.redirects.length, 0);
  assert.ok(!JSON.stringify(failedSave.events).includes("private project name"));
});

test("opening the already-visible Pro dialog does not duplicate views", () => {
  const result = harness();
  result.access.show(); result.access.show();
  assert.equal(onlyEvent(result, "pro_dialog_viewed").length, 1);
  result.access.close(); result.access.show();
  assert.equal(onlyEvent(result, "pro_dialog_viewed").length, 2);
});

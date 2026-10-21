import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as siteAnalytics from "../app/site-analytics-core.mjs";

const source = await readFile(new URL("../app/analytics-surface.tsx", import.meta.url), "utf8");
const release = JSON.parse(await readFile(new URL("../public/desktop/latest.json", import.meta.url), "utf8"));
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));

function setup({ pathname = "/", status = "denied", anonymous = true, configured = true } = {}) {
  const window = new EventTarget();
  window.location = { origin: "https://www.pixelwall.dev" };
  const document = new EventTarget();
  const calls = [];
  const state = { pathname, status, anonymous, configured };
  const hooks = { cursor: 0, refs: [], effects: [] };
  const React = {
    useRef(initial) {
      const index = hooks.cursor++;
      hooks.refs[index] ??= { current: initial };
      return hooks.refs[index];
    },
    useEffect(effect, deps) {
      hooks.effects.push({ effect, deps, cleanup: undefined });
    },
  };
  const exports = {};
  class FakeElement {
    constructor(href, { publicSite = true, blocked = false, placement = "content" } = {}) {
      this.href = href; this.publicSite = publicSite; this.blocked = blocked; this.placement = placement;
    }
    getAttribute(name) { return name === "href" ? this.href : null; }
    closest(selector) {
      if (selector === "a[href]") return this;
      if (selector === ".public-site") return this.publicSite ? this : null;
      if (selector.includes(".ph-no-capture")) return this.blocked ? this : null;
      if (selector === ".site-header") return this.placement === "header" ? this : null;
      if (selector === ".site-footer") return this.placement === "footer" ? this : null;
      return null;
    }
  }
  const context = vm.createContext({
    exports,
    window,
    document,
    Event,
    Element: FakeElement,
    URL,
    require(name) {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null, Fragment: Symbol("Fragment") };
      if (name === "next/navigation") return { usePathname: () => state.pathname };
      if (name === "./analytics") return {
        ANALYTICS_CONSENT_CHANGED_EVENT: "pixelwall:analytics-consent-changed",
        captureAnalyticsEvent: (event, properties) => { if (state.status === "granted") calls.push({ channel: "optional", event, properties }); },
        captureAnonymousPageView: (page) => { if (state.anonymous) calls.push({ channel: "anonymous", event: "site_traffic_counted", page }); },
        captureAnonymousSiteEvent: (event, properties) => { if (state.anonymous) calls.push({ channel: "anonymous", event, properties }); },
        getAnalyticsConsentStatus: () => state.status,
        isAnalyticsConfigured: () => state.configured,
        isAnonymousTrafficEnabled: () => state.anonymous,
      };
      if (name === "./analytics-consent") return { AnalyticsConsent: () => null };
      if (name === "./site-analytics-core.mjs") return siteAnalytics;
      if (name === "../public/desktop/latest.json") return release;
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  vm.runInContext(compiled, context, { filename: "analytics-surface.tsx" });

  function render() {
    hooks.cursor = 0;
    hooks.effects = [];
    exports.AnalyticsSurface();
    return hooks.effects;
  }
  function mount({ strict = false } = {}) {
    const effects = render();
    for (const hook of effects) {
      hook.cleanup = hook.effect();
      if (strict) {
        hook.cleanup?.();
        hook.cleanup = hook.effect();
      }
    }
  }
  function navigate(nextPathname) {
    const previous = hooks.effects;
    for (const hook of previous) hook.cleanup?.();
    state.pathname = nextPathname;
    mount();
  }
  function consent(nextStatus) {
    state.status = nextStatus;
    window.dispatchEvent(new Event("pixelwall:analytics-consent-changed"));
  }
  function click(href, options) {
    const link = new FakeElement(href, options);
    const event = new Event("click");
    Object.defineProperties(event, { target: { value: link }, button: { value: 0 }, defaultPrevented: { value: false } });
    document.dispatchEvent(event);
  }
  return { calls, state, mount, navigate, consent, click };
}

test("initial required load and navigation count anonymous pages once without optional events", () => {
  const app = setup({ pathname: "/", status: "denied" });
  app.mount();
  assert.deepEqual(plain(app.calls), [{ channel: "anonymous", event: "site_traffic_counted", page: "/" }]);

  app.navigate("/editor");
  assert.deepEqual(plain(app.calls), [
    { channel: "anonymous", event: "site_traffic_counted", page: "/" },
    { channel: "anonymous", event: "site_traffic_counted", page: "/editor" },
  ]);
});

test("strict effect replay and refocus do not duplicate either page event", () => {
  const app = setup({ pathname: "/guides", status: "granted" });
  app.mount({ strict: true });
  assert.deepEqual(plain(app.calls), [
    { channel: "anonymous", event: "site_traffic_counted", page: "/guides" },
    { channel: "optional", event: "site_page_viewed", properties: { page_group: "guides" } },
  ]);

  app.mount({ strict: true });
  assert.equal(app.calls.length, 2);
});

test("upgrading consent preserves the anonymous count and adds one optional pageview", () => {
  const app = setup({ pathname: "/pricing", status: "denied" });
  app.mount();
  app.consent("granted");
  assert.deepEqual(plain(app.calls), [
    { channel: "anonymous", event: "site_traffic_counted", page: "/pricing" },
    { channel: "optional", event: "site_page_viewed", properties: { page_group: "pricing" } },
  ]);
  app.consent("granted");
  assert.equal(app.calls.length, 2);
});

test("denial resets only optional page state; later grant does not duplicate anonymous traffic", () => {
  const app = setup({ pathname: "/editor", status: "granted" });
  app.mount();
  app.consent("denied");
  app.consent("granted");
  assert.deepEqual(plain(app.calls), [
    { channel: "anonymous", event: "site_traffic_counted", page: "/editor" },
    { channel: "optional", event: "site_page_viewed", properties: { page_group: "editor" } },
    { channel: "optional", event: "site_page_viewed", properties: { page_group: "editor" } },
  ]);
});

test("legacy refusal state stays dark until an explicit new choice, while DNT blocks both channels", () => {
  const refused = setup({ pathname: "/privacy", status: "denied" });
  refused.state.anonymous = false;
  refused.mount();
  assert.deepEqual(plain(refused.calls), []);

  const blocked = setup({ pathname: "/privacy", status: "denied", anonymous: false });
  blocked.mount();
  assert.deepEqual(plain(blocked.calls), []);
});

test("Essential-only public clicks count recognized navigation and every download target", () => {
  const app = setup({ status: "denied" });
  app.mount();
  app.calls.length = 0;
  app.click("/guides/getting-started", { placement: "header" });
  app.click("/downloads/pixelwall-standalone.zip");
  app.click("/downloads/pixelwall-cli.zip");
  for (const platform of ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"]) {
    const filename = release.downloads[platform].filename;
    app.click(`/downloads/desktop/${release.version}/${filename}`);
  }
  const anonymous = app.calls.filter(call => call.channel === "anonymous");
  assert.equal(anonymous.length, 7);
  assert.deepEqual(plain(anonymous[0]), { channel: "anonymous", event: "site_cta_clicked", properties: { destination: "guides", placement: "header" } });
  assert.deepEqual(plain(anonymous.slice(1).map(call => call.event)), [
    "site_cta_clicked", "site_cta_clicked",
    "desktop_download_clicked", "desktop_download_clicked", "desktop_download_clicked", "desktop_download_clicked",
  ]);
  assert.equal(app.calls.some(call => call.channel === "optional"), false);
});

test("Essential-only click capture rejects private URLs and nonpublic DOM", () => {
  const app = setup({ status: "denied" });
  app.mount();
  app.calls.length = 0;
  app.click("/guides/getting-started?secret=1#private");
  app.click("https://other.example/guides/getting-started");
  app.click("/guides/getting-started", { publicSite: false });
  app.click("/guides/getting-started", { blocked: true });
  assert.deepEqual(plain(app.calls), []);
});

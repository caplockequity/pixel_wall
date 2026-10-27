import assert from "node:assert/strict";
import test from "node:test";
import { handleTrafficCountRequest, MAX_BODY_BYTES } from "../app/traffic-count-core.mjs";

const env = {
  NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_public_test_token",
  NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
};
const request = (body, options = {}) => new Request(options.url ?? "https://pixelwall.dev/api/traffic", {
  method: options.method ?? "POST",
  body: body === undefined ? undefined : JSON.stringify(body),
  headers: { origin: "https://pixelwall.dev", "content-type": "application/json", ...options.headers },
});

function fakeFetch(status = 204) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(null, { status });
  };
  return { calls, fetchImpl };
}

test("valid aggregate count sends only fixed, day-rounded data", async () => {
  const fake = fakeFetch();
  const response = await handleTrafficCountRequest(request({ event: "site_page_viewed", page_group: "home" }), {
    env, fetchImpl: fake.fetchImpl, now: () => new Date("2026-10-21T19:22:33Z"), randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-00000000000${++n}`; })(),
  });
  assert.equal(response.status, 204);
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.url, "https://us.i.posthog.com/capture/");
  assert.equal(call.options.redirect, "error");
  assert.deepEqual(call.options.headers, { "content-type": "application/json" });
  assert.equal(call.body.event, "site_traffic_counted");
  assert.equal(call.body.timestamp, "2026-10-21T00:00:00.000Z");
  assert.equal(call.body.properties.page_group, "home");
  assert.equal(call.body.properties.action, "page_view");
  assert.equal(call.body.properties.measurement_mode, "aggregate");
  assert.equal(call.body.properties.$ip, null);
  assert.equal(call.body.properties.$geoip_disable, true);
  assert.equal(call.body.properties.$process_person_profile, false);
  assert.equal(call.body.properties.token, env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);
  assert.equal(Object.hasOwn(call.body.properties, "$session_id"), false);
  assert.equal(Object.hasOwn(call.body.properties, "$current_url"), false);
});

test("each count receives fresh IDs and no incoming identifiers are forwarded", async () => {
  const fake = fakeFetch();
  let n = 0;
  const randomUUID = () => `00000000-0000-4000-8000-00000000000${++n}`;
  for (let i = 0; i < 2; i++) {
    const response = await handleTrafficCountRequest(new Request("https://www.pixelwall.dev/api/traffic", {
      method: "POST", body: JSON.stringify({ event: "site_page_viewed", page_group: "guides", distinct_id: "attacker", $session_id: "attacker" }),
      headers: { origin: "https://www.pixelwall.dev", "content-type": "application/json" },
    }), { env, fetchImpl: fake.fetchImpl, randomUUID });
    assert.equal(response.status, 400);
  }
  const first = await handleTrafficCountRequest(request({ event: "site_page_viewed", page_group: "guides" }), { env, fetchImpl: fake.fetchImpl, randomUUID });
  const second = await handleTrafficCountRequest(request({ event: "site_page_viewed", page_group: "guides" }), { env, fetchImpl: fake.fetchImpl, randomUUID });
  assert.equal(first.status, 204); assert.equal(second.status, 204);
  assert.notEqual(fake.calls.at(-1).body.properties.distinct_id, fake.calls.at(-2).body.properties.distinct_id);
  assert.notEqual(fake.calls.at(-1).body.uuid, fake.calls.at(-2).body.uuid);
});

test("rejects non-production origins, missing/forged origins, wrong content types, malformed bodies, and unknown fields", async () => {
  const fake = fakeFetch();
  for (const invalid of [
    request({ event: "site_page_viewed", page_group: "home" }, { url: "https://preview.pixelwall.dev/api/traffic" }),
    new Request("https://pixelwall.dev/api/traffic", { method: "POST", body: "not-json", headers: { "content-type": "application/json", origin: "https://pixelwall.dev" } }),
    request({ event: "site_page_viewed", page_group: "home", extra: true }),
    request({ event: "site_page_viewed", page_group: "unknown" }),
    request({ event: "site_page_viewed", page_group: "home" }, { headers: { origin: "https://evil.example" } }),
    request({ event: "site_page_viewed", page_group: "home" }, { headers: { "content-type": "text/plain" } }),
    new Request("https://pixelwall.dev/api/traffic", { method: "POST", body: JSON.stringify({ page_group: "home" }), headers: { "content-type": "application/json", origin: "https://pixelwall.dev" } }),
  ]) {
    assert.equal((await handleTrafficCountRequest(invalid, { env, fetchImpl: fake.fetchImpl })).status >= 400, true);
  }
  const oversized = new Request("https://pixelwall.dev/api/traffic", { method: "POST", body: `{"event":"site_page_viewed","page_group":"home","x":"${"a".repeat(MAX_BODY_BYTES)}"}`, headers: { origin: "https://pixelwall.dev", "content-type": "application/json", "content-length": "1" } });
  assert.equal((await handleTrafficCountRequest(oversized, { env, fetchImpl: fake.fetchImpl })).status, 400);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`{"event":"site_page_viewed","page_group":"home","x":"${"a".repeat(MAX_BODY_BYTES)}"}`)); controller.close(); } });
  const streamed = new Request("https://pixelwall.dev/api/traffic", { method: "POST", body: stream, duplex: "half", headers: { origin: "https://pixelwall.dev", "content-type": "application/json", "content-length": "1" } });
  assert.equal((await handleTrafficCountRequest(streamed, { env, fetchImpl: fake.fetchImpl })).status, 400);
  assert.equal(fake.calls.length, 0);
});

test("missing configuration makes no upstream call and upstream failures are contained", async () => {
  const fake = fakeFetch();
  assert.equal((await handleTrafficCountRequest(request({ event: "site_page_viewed", page_group: "home" }), { env: {}, fetchImpl: fake.fetchImpl })).status, 204);
  assert.equal(fake.calls.length, 0);
  assert.equal((await handleTrafficCountRequest(request({ event: "site_page_viewed", page_group: "home" }), { env, fetchImpl: fakeFetch(500).fetchImpl })).status, 502);
  const throwing = await handleTrafficCountRequest(request({ event: "site_page_viewed", page_group: "home" }), { env, fetchImpl: async () => { throw new Error("upstream"); } });
  assert.equal(throwing.status, 502);
});

test("accepts fixed navigation and download schemas while rejecting malformed package data", async () => {
  const fake = fakeFetch();
  for (const payload of [
    { event: "site_cta_clicked", page_group: "home", destination: "guides", placement: "content" },
    { event: "site_cta_clicked", page_group: "home", destination: "browser_download", placement: "header" },
    { event: "desktop_download_clicked", page_group: "downloads", platform: "darwin-arm64", version: "1.2.3", package_type: "zip" },
  ]) assert.equal((await handleTrafficCountRequest(request(payload), { env, fetchImpl: fake.fetchImpl })).status, 204);
  assert.equal(fake.calls[0].body.properties.action, "navigation_click");
  assert.equal(fake.calls[1].body.properties.action, "download_click");
  assert.equal(fake.calls[1].body.properties.platform, "browser");
  assert.equal(fake.calls[2].body.properties.action, "download_click");
  for (const payload of [
    { event: "desktop_download_clicked", page_group: "downloads", platform: "darwin-arm64", version: "1.2.3456", package_type: "zip" },
    { event: "desktop_download_clicked", page_group: "downloads", platform: "darwin-arm64", version: "1.2.3", package_type: "exe" },
    { event: "site_cta_clicked", page_group: "home", destination: "https://evil.example", placement: "content" },
  ]) assert.equal((await handleTrafficCountRequest(request(payload), { env, fetchImpl: fake.fetchImpl })).status, 400);
});

test("accepts reviewed export outcomes and excludes document metadata", async () => {
  const fake = fakeFetch();
  const response = await handleTrafficCountRequest(request({ event: "export_outcome", page_group: "editor", export_type: "sprite_sheet_png", outcome: "success" }), { env, fetchImpl: fake.fetchImpl });
  assert.equal(response.status, 204);
  assert.equal(fake.calls[0].body.properties.action, "export");
  assert.equal(fake.calls[0].body.properties.export_type, "sprite_sheet_png");
  assert.equal(fake.calls[0].body.properties.outcome, "success");
  assert.equal(Object.hasOwn(fake.calls[0].body.properties, "project_name"), false);
  for (const payload of [
    { event: "export_outcome", page_group: "editor", export_type: "private_format", outcome: "success" },
    { event: "export_outcome", page_group: "editor", export_type: "png", outcome: "cancelled" },
    { event: "export_outcome", page_group: "editor", export_type: "png", outcome: "success", project_name: "secret" },
  ]) assert.equal((await handleTrafficCountRequest(request(payload), { env, fetchImpl: fake.fetchImpl })).status, 400);
});

test("accepts legacy and sourced export outcomes, plus automation edit completions", async () => {
  const fake = fakeFetch();
  for (const payload of [
    { event: "export_outcome", page_group: "editor", export_type: "png", outcome: "success" },
    { event: "export_outcome", page_group: "editor", export_type: "png", outcome: "success", source: "ui" },
    { event: "export_outcome", page_group: "editor", export_type: "png", outcome: "success", source: "automation" },
    { event: "automation_edit_completed", page_group: "editor", operation: "lua" },
    { event: "automation_edit_completed", page_group: "editor", operation: "color_profile" },
  ]) assert.equal((await handleTrafficCountRequest(request(payload), { env, fetchImpl: fake.fetchImpl })).status, 204);
  assert.equal(fake.calls[0].body.properties.source, undefined);
  assert.equal(fake.calls[1].body.properties.source, "ui");
  assert.equal(fake.calls[2].body.properties.source, "automation");
  assert.equal(fake.calls[3].body.properties.action, "automation_edit");
  assert.equal(fake.calls[3].body.properties.source, "automation");
  assert.equal(fake.calls[3].body.properties.operation, "lua");
  for (const payload of [
    { event: "export_outcome", page_group: "editor", export_type: "png", outcome: "success", source: "agent" },
    { event: "export_outcome", page_group: "editor", export_type: "png", outcome: "success", project_name: "secret" },
    { event: "automation_edit_completed", page_group: "editor", operation: "inspect" },
    { event: "automation_edit_completed", page_group: "home", operation: "lua" },
    { event: "automation_edit_completed", page_group: "editor", operation: "lua", command_count: 2 },
    { event: "automation_edit_completed", page_group: "editor", operation: "lua", script: "secret" },
  ]) assert.equal((await handleTrafficCountRequest(request(payload), { env, fetchImpl: fake.fetchImpl })).status, 400);
});

test("accepts anonymous creation and live checkout counts only", async () => {
  const fake = fakeFetch();
  for (const payload of [
    { event: "editor_activated", page_group: "editor" },
    { event: "checkout_started", page_group: "pricing", billing_mode: "live" },
  ]) assert.equal((await handleTrafficCountRequest(request(payload), { env, fetchImpl: fake.fetchImpl })).status, 204);
  assert.equal(fake.calls[0].body.properties.action, "creation");
  assert.equal(fake.calls[1].body.properties.action, "checkout_start");
  assert.equal(fake.calls[1].body.properties.billing_mode, "live");
  for (const payload of [
    { event: "editor_activated", page_group: "editor", activation_type: "drawing" },
    { event: "checkout_started", page_group: "pricing", billing_mode: "test" },
  ]) assert.equal((await handleTrafficCountRequest(request(payload), { env, fetchImpl: fake.fetchImpl })).status, 400);
});

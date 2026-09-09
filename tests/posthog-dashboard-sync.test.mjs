import test from "node:test";
import assert from "node:assert/strict";
import { syncDashboards, parseArguments } from "../scripts/sync-posthog-dashboards.mjs";

const personalKey = "phx_private_test_personal_key_never_print";
const captureToken = "phc_public_test_capture_token";
const base = "https://us.posthog.com/api/projects/42/";
const query = { kind: "InsightVizNode", source: { kind: "TrendsQuery", properties: [
  { type: "event", key: "analytics_schema_version", operator: "exact", value: ["2"] },
  { type: "event", key: "environment", operator: "exact", value: ["production"] },
], series: [{ kind: "EventsNode", event: "site_page_viewed", math: "dau" }] } };
const manifest = { schema_version: 2, api_host: "https://us.posthog.com", dashboards: [{ key: "website", name: "PixelWall — Website", description: "Consented public traffic.", tags: ["pixelwall", "analytics-v2"], insights: [{ key: "visits", name: "Consented visits", description: "Visits after consent.", tags: ["pixelwall", "analytics-v2"], query }] }] };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function mockServer({ dashboard = null, insight = null, projectToken = captureToken, override } = {}) {
  const calls = [], output = [], logs = [];
  const dashboards = dashboard ? [structuredClone(dashboard)] : [];
  const insights = insight ? [structuredClone(insight)] : [];
  async function fetchImpl(url, options) {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : undefined, redirect: options.redirect });
    assert.equal(options.headers.Authorization, `Bearer ${personalKey}`);
    const custom = await override?.({ url, options, calls, dashboards, insights });
    if (custom) return custom;
    const path = new URL(url).pathname;
    if (path === "/api/projects/42/") return response({ id: 42, api_token: projectToken });
    if (path === "/api/projects/42/query/") return response({ results: [] });
    for (const [name, values] of [["dashboards", dashboards], ["insights", insights]]) {
      const collection = `/api/projects/42/${name}/`;
      if (path === collection && options.method === "GET") return response({ results: values, next: null });
      if (path === collection && options.method === "POST") {
        const created = { id: name === "dashboards" ? 101 : 201, ...JSON.parse(options.body) };
        values.push(created); return response(created, 201);
      }
      if (path.startsWith(collection)) {
        const id = Number(path.slice(collection.length).split("/")[0]);
        const current = values.find((item) => item.id === id);
        assert.ok(current, "the request must address an existing record");
        if (options.method === "PATCH") Object.assign(current, JSON.parse(options.body));
        return response(current);
      }
    }
    throw new Error("Unexpected mock request");
  }
  return { calls, output, logs, dashboards, insights, run: (options = {}) => syncDashboards({ manifest, project: "42", key: personalKey, projectToken: captureToken, fetchImpl, sleep: async () => {}, log: (message) => logs.push(message), onProgress: async (artifact) => output.push(artifact), ...options }) };
}
const writes = (server) => server.calls.filter((call) => call.method !== "GET" && !call.url.includes("/query/"));

test("project identity must match the site's capture token before any inventory, queries, or writes", async () => {
  const server = mockServer({ projectToken: "phc_some_other_project" });
  await assert.rejects(server.run({ apply: true }), /does not match this site's capture token/);
  assert.equal(server.calls.length, 1);
  assert.equal(writes(server).length, 0);
  assert.equal(server.output.length, 0);
});

test("default dry run validates queries without writing dashboards, insights, or artifacts", async () => {
  const server = mockServer();
  const result = await server.run();
  assert.equal(result.applied, false);
  assert.equal(server.calls.filter((call) => call.url === `${base}query/`).length, 1);
  assert.equal(writes(server).length, 0);
  assert.equal(server.output.length, 0);
  assert.ok(server.logs.some((line) => line.includes("Create dashboard")));
  assert.ok(!JSON.stringify(server.logs).includes(personalKey));
});

test("updating managed charts retains unrelated dashboard tiles, memberships, tags, and sharing settings", async () => {
  const server = mockServer({
    dashboard: { id: 10, name: manifest.dashboards[0].name, description: "Previous description", tags: ["personal-note"], tiles: [{ id: 909, text: "Keep this unrelated tile" }], is_shared: true },
    insight: { id: 20, name: "Consented visits", description: "Previous description", tags: ["old-custom-tag"], dashboards: [10, 99], query: {} },
  });
  await server.run({ apply: true });
  assert.equal(writes(server).filter((call) => call.method === "POST").length, 0);
  const dashboardWrite = writes(server).find((call) => call.url.endsWith("dashboards/10/"));
  assert.deepEqual(Object.keys(dashboardWrite.body).sort(), ["description", "name", "tags"]);
  assert.deepEqual(server.dashboards[0].tiles, [{ id: 909, text: "Keep this unrelated tile" }]);
  assert.equal(server.dashboards[0].is_shared, true);
  assert.deepEqual(server.insights[0].dashboards, [10, 99]);
  assert.ok(server.insights[0].tags.includes("old-custom-tag"));
  assert.ok(server.insights[0].description.includes("pixelwall-analytics:v2:insight:website/visits"));
  assert.equal(server.output.at(-1).status, "complete");
  assert.ok(!JSON.stringify(server.output).includes(personalKey));
  const initialWriteCount = writes(server).length;
  await server.run({ apply: true });
  assert.equal(writes(server).length, initialWriteCount, "a second run should reuse the stable records and avoid unchanged writes");
});

test("pagination cannot send credentials to another origin or another project's collection", async () => {
  for (const next of ["https://evil.example/api/projects/42/dashboards/", "https://us.posthog.com/api/projects/43/dashboards/", "https://us.posthog.com/api/projects/42/insights/"]) {
    const server = mockServer({ override: ({ url }) => url === `${base}dashboards/?limit=100` ? response({ results: [], next }) : null });
    await assert.rejects(server.run({ apply: true }), /Blocked a PostHog URL/);
    assert.ok(server.calls.every((call) => call.url.startsWith(base)));
    assert.equal(writes(server).length, 0);
  }
});

test("valid pagination is fully read before a matching later-page dashboard is updated", async () => {
  let firstPage = true;
  const existing = { id: 10, name: manifest.dashboards[0].name, description: "Old", tags: [] };
  const server = mockServer({ dashboard: existing, override: ({ url }) => {
    if (firstPage && url === `${base}dashboards/?limit=100`) { firstPage = false; return response({ results: [], next: `${base}dashboards/?limit=100&offset=100` }); }
    return null;
  } });
  await server.run({ apply: true });
  assert.ok(server.calls.some((call) => call.url.includes("offset=100")));
  assert.ok(writes(server).some((call) => call.method === "PATCH" && call.url.endsWith("dashboards/10/")));
  assert.ok(!writes(server).some((call) => call.method === "POST" && call.url === `${base}dashboards/`));
});

test("uncertain writes are not retried and a later run recovers the managed key", async () => {
  let rejectFirstCreate = true;
  const server = mockServer({ override: ({ url, options, dashboards }) => {
    if (url === `${base}dashboards/` && options.method === "POST" && rejectFirstCreate) {
      rejectFirstCreate = false;
      dashboards.push({ id: 101, ...JSON.parse(options.body) }); // Server committed; response was lost.
      throw new Error(`${personalKey}: private upstream failure`);
    }
    return null;
  } });
  await assert.rejects(server.run({ apply: true }), (error) => error.message.includes("No automatic retry") && !error.message.includes(personalKey));
  assert.equal(writes(server).filter((call) => call.url === `${base}dashboards/`).length, 1);
  await server.run({ apply: true });
  assert.equal(writes(server).filter((call) => call.url === `${base}dashboards/`).length, 1);
  assert.equal(server.dashboards.length, 1);
  assert.equal(server.insights.length, 1);
});

test("query validation errors stop all dashboard writes without exposing server error bodies", async () => {
  const server = mockServer({ override: ({ url }) => url === `${base}query/` ? response({ detail: `${personalKey} private query text` }, 400) : null });
  await assert.rejects(server.run({ apply: true }), (error) => error.message.includes("HTTP 400") && !error.message.includes(personalKey));
  assert.equal(writes(server).length, 0);
  assert.equal(server.output.length, 0);
});

test("CLI requires a key file rather than a credential string or relative path", () => {
  assert.deepEqual(parseArguments(["--key-file", "/private/tmp/key.txt", "--project", "42"]), { apply: false, keyFile: "/private/tmp/key.txt", project: "42" });
  assert.throws(() => parseArguments(["--key", personalKey, "--project", "42"]), /Usage/);
  assert.throws(() => parseArguments(["--key-file", "relative.txt", "--project", "42"]), /absolute/);
});

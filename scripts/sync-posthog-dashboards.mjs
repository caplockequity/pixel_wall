#!/usr/bin/env node
// Administrator utility. The personal key stays in memory and is never sent to the website.
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const HOSTS = new Set(["https://us.posthog.com", "https://eu.posthog.com"]);
const MANAGED_TAG = "pixelwall-analytics-managed";
const MARKER_PREFIX = "<!-- pixelwall-analytics:v2:";
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
class SyncError extends Error {}
const fail = (message) => { throw new SyncError(message); };
const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
const marker = (kind, key) => `${MARKER_PREFIX}${kind}:${key} -->`;
const idOf = (value) => {
  const id = typeof value === "object" && value ? value.id : value;
  if (!/^[1-9][0-9]*$/.test(String(id)) || !Number.isSafeInteger(Number(id))) fail("PostHog returned an invalid object ID; no automatic retry was attempted.");
  return Number(id);
};
const tagsOf = (record) => Array.isArray(record.tags) ? record.tags.filter((tag) => typeof tag === "string") : [];
const memberships = (record) => {
  if (!Array.isArray(record.dashboards)) fail("The existing insight's dashboard memberships are unavailable; stopping to preserve its other dashboards.");
  return [...new Set(record.dashboards.map(idOf))];
};

export function validateManifest(manifest) {
  if (manifest?.schema_version !== 2 || !HOSTS.has(manifest.api_host) || !Array.isArray(manifest.dashboards) || !manifest.dashboards.length) fail("Use the checked-in schema 2 PostHog dashboard manifest and an approved PostHog host.");
  const dashboardKeys = new Set(), insightKeys = new Set();
  for (const dashboard of manifest.dashboards) {
    if (!KEY.test(dashboard.key) || dashboardKeys.has(dashboard.key)) fail("Dashboard keys must be unique, stable identifiers.");
    dashboardKeys.add(dashboard.key);
    if (typeof dashboard.name !== "string" || !dashboard.name.trim() || !Array.isArray(dashboard.insights) || !dashboard.insights.length) fail("Each dashboard needs a name and insights.");
    for (const insight of dashboard.insights) {
      const stableKey = `${dashboard.key}/${insight.key}`;
      if (!KEY.test(insight.key) || insightKeys.has(stableKey) || typeof insight.name !== "string" || !insight.name.trim()) fail("Insight keys must be unique within each dashboard and every insight needs a name.");
      insightKeys.add(stableKey);
      const query = insight.query?.source;
      if (insight.query?.kind !== "InsightVizNode" || !["TrendsQuery", "FunnelsQuery"].includes(query?.kind) || !Array.isArray(query.series) || !query.series.length) fail("Only the checked-in Trends and Funnels query shapes are supported.");
      for (const [key, value] of [["analytics_schema_version", "2"], ["environment", "production"]]) {
        if (!query.properties?.some((property) => property.type === "event" && property.key === key && property.operator === "exact" && Array.isArray(property.value) && property.value.length === 1 && String(property.value[0]) === value)) fail("Every insight must filter schema 2 and production traffic.");
      }
      if (query.series.some((series) => series.kind !== "EventsNode" || !/^[a-z][a-z0-9_]{0,95}$/.test(series.event) && !["$web_vitals", "$exception"].includes(series.event))) fail("Use explicit product event series in the dashboard manifest.");
    }
  }
  return manifest;
}

function createClient({ apiHost, project, key, fetchImpl, sleep }) {
  const base = `/api/projects/${project}/`;
  function scopedUrl(input, collectionPath) {
    let url;
    try { url = new URL(input, apiHost); } catch { fail("PostHog returned an invalid pagination URL."); }
    if (url.origin !== apiHost || url.username || url.password || url.hash || !url.pathname.startsWith(base) || collectionPath && url.pathname !== collectionPath) fail("Blocked a PostHog URL outside the selected project or collection.");
    return url;
  }
  async function request(method, input, body) {
    const url = scopedUrl(input);
    const canRetry = method === "GET";
    for (let attempt = 0; attempt < (canRetry ? 3 : 1); attempt++) {
      let response;
      try {
        response = await fetchImpl(url.href, { method, redirect: "error", signal: AbortSignal.timeout(45000), headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      } catch {
        if (canRetry && attempt < 2) { await sleep(500 * (attempt + 1)); continue; }
        fail(method === "GET" ? "PostHog could not be reached after bounded read retries." : "PostHog did not confirm the request. No automatic retry was attempted; re-run a dry run to inspect any partial changes.");
      }
      if (!response.ok) {
        if (canRetry && attempt < 2 && [429, 500, 502, 503, 504].includes(response.status)) {
          const retryAfter = Number(response.headers?.get("retry-after"));
          await response.body?.cancel?.();
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 2000) : 500 * (attempt + 1));
          continue;
        }
        // Error bodies can contain query text, account details, or credentials. Never print them.
        await response.body?.cancel?.();
        fail(`PostHog rejected ${method} with HTTP ${response.status}. Check the project, key scopes, and query definitions. Writes are never automatically retried.`);
      }
      let result;
      try { result = await response.json(); } catch { fail("PostHog returned unreadable JSON. No automatic retry was attempted; inspect a dry run before retrying writes."); }
      if (!result || typeof result !== "object") fail("PostHog returned an unexpected response shape.");
      return result;
    }
  }
  async function list(resource) {
    const path = `${base}${resource}/`, records = [], seen = new Set();
    let next = `${path}?limit=100${resource === "insights" ? "&include_dashboards=true" : ""}`;
    while (next) {
      const url = scopedUrl(next, path);
      if (seen.has(url.href) || seen.size >= 100) fail("PostHog pagination repeated or exceeded the safe page limit.");
      seen.add(url.href);
      const page = await request("GET", url.href);
      if (!Array.isArray(page.results)) fail("PostHog returned an unexpected inventory response.");
      records.push(...page.results.filter((item) => item && !item.deleted));
      if (page.next !== null && page.next !== undefined && typeof page.next !== "string") fail("PostHog returned an invalid next-page link.");
      next = page.next;
    }
    return records;
  }
  async function validateQuery(insight) {
    let result = await request("POST", `${base}query/`, { query: insight.query.source, name: `PixelWall analytics v2 validation: ${insight.key}`, refresh: "blocking", async: false });
    for (let poll = 0; result.query_status?.complete === false; poll++) {
      if (result.query_status.error || poll >= 15) fail("A dashboard query failed or did not finish in time. No dashboards have been changed.");
      const queryId = result.query_status.id;
      if (typeof queryId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(queryId)) fail("PostHog did not return a safe query status ID.");
      await sleep(1000);
      result = await request("GET", `${base}query/${queryId}/`);
    }
    if (result.error || result.query_status?.error) fail("A dashboard query failed validation. No dashboards have been changed.");
  }
  return { base, request, list, validateQuery };
}

function matchRecord(records, definition, kind, stableKey, dashboardId) {
  const expectedMarker = marker(kind, stableKey);
  const byMarker = records.filter((record) => typeof record.description === "string" && record.description.includes(expectedMarker));
  if (byMarker.length > 1) fail(`More than one object has the managed ${kind} key ${stableKey}; resolve the duplicate before syncing.`);
  if (byMarker.length) return byMarker[0];
  const byName = records.filter((record) => {
    if (record.name !== definition.name) return false;
    if (record.description?.includes(MARKER_PREFIX)) return false;
    if (kind === "dashboard") return true;
    const tags = tagsOf(record);
    return tags.includes("pixelwall") && tags.includes("analytics-v2") || dashboardId && Array.isArray(record.dashboards) && memberships(record).includes(dashboardId);
  });
  if (byName.length > 1) fail(`More than one eligible object has the exact ${kind} name for ${stableKey}; resolve the duplicate before syncing.`);
  return byName[0] ?? null;
}
function desiredBody(definition, existing, kind, stableKey, dashboardId) {
  const body = { name: definition.name, description: `${definition.description ?? ""}\n\n${marker(kind, stableKey)}`, tags: [...new Set([...tagsOf(existing ?? {}), ...tagsOf(definition), MANAGED_TAG])].sort() };
  if (kind === "insight") {
    body.query = definition.query;
    body.dashboards = [...new Set([...(existing ? memberships(existing) : []), dashboardId])].sort((a, b) => a - b);
  }
  return body;
}
function sameControlledFields(existing, body) {
  return Boolean(existing) && Object.entries(body).every(([key, value]) => {
    const current = key === "tags" ? [...tagsOf(existing)].sort() : key === "dashboards" ? memberships(existing).sort((a, b) => a - b) : existing[key];
    return isDeepStrictEqual(current, value);
  });
}

export async function syncDashboards({ manifest, project, key, projectToken, apply = false, fetchImpl = fetch, sleep = delay, log = console.log, onProgress = async () => {} }) {
  validateManifest(manifest);
  if (!/^[1-9][0-9]*$/.test(String(project))) fail("Provide the numeric PostHog project ID with --project.");
  if (typeof key !== "string" || key.length < 24 || key.length > 1024 || /\s/.test(key) || key.startsWith("phc_") || key === projectToken) fail("Use a personal PostHog API key file, not the public capture token.");
  if (typeof projectToken !== "string" || !projectToken.trim()) fail("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is required to verify the selected project.");
  const client = createClient({ apiHost: manifest.api_host, project: String(project), key, fetchImpl, sleep });
  const selectedProject = await client.request("GET", client.base);
  if (String(selectedProject.id) !== String(project) || typeof selectedProject.api_token !== "string" || selectedProject.api_token !== projectToken) fail("The selected PostHog project does not match this site's capture token. Nothing was changed.");
  log("Verified the site's PostHog project. Reading dashboards and insights.");
  // Complete both inventories and all matching/detail reads before any mutation.
  const dashboards = await client.list("dashboards");
  const insights = await client.list("insights");
  const plan = [], matchedDashboards = new Set(), matchedInsights = new Set();
  for (const definition of manifest.dashboards) {
    let existing = matchRecord(dashboards, definition, "dashboard", definition.key);
    if (existing) existing = await client.request("GET", `${client.base}dashboards/${idOf(existing)}/`);
    const dashboardId = existing ? idOf(existing) : null;
    if (dashboardId && matchedDashboards.has(dashboardId)) fail("Two dashboard definitions resolve to the same existing dashboard; resolve the manifest ambiguity first.");
    if (dashboardId) matchedDashboards.add(dashboardId);
    const children = [];
    for (const insight of definition.insights) {
      const stableKey = `${definition.key}/${insight.key}`;
      let current = matchRecord(insights, insight, "insight", stableKey, dashboardId);
      if (current) {
        const matchedId = idOf(current);
        if (matchedInsights.has(matchedId)) fail("Two insight definitions resolve to the same existing insight; resolve the manifest ambiguity first.");
        matchedInsights.add(matchedId);
        current = await client.request("GET", `${client.base}insights/${idOf(current)}/?include_dashboards=true`);
        memberships(current); // Refuse incomplete API data rather than removing other memberships.
      }
      children.push({ definition: insight, existing: current, stableKey });
    }
    plan.push({ definition, existing, children });
  }
  log("Validating every dashboard query before making changes.");
  for (const entry of plan) for (const child of entry.children) await client.validateQuery(child.definition);
  for (const entry of plan) {
    log(`${entry.existing ? "Update" : "Create"} dashboard: ${entry.definition.name}`);
    for (const child of entry.children) log(`  ${child.existing ? "Update" : "Create"} insight: ${child.definition.name}`);
  }
  if (!apply) { log("Dry run complete. Queries validated; no dashboard or insight was written. Add --apply to perform this plan."); return { applied: false, dashboards: plan.length, insights: plan.reduce((count, entry) => count + entry.children.length, 0) }; }
  const artifact = { schema_version: 2, project_id: Number(project), api_host: manifest.api_host, status: "in_progress", updated_at: new Date().toISOString(), dashboards: [] };
  for (const entry of plan) {
    const dashboardBody = desiredBody(entry.definition, entry.existing, "dashboard", entry.definition.key);
    const dashboard = sameControlledFields(entry.existing, dashboardBody) ? entry.existing : await client.request(entry.existing ? "PATCH" : "POST", `${client.base}dashboards/${entry.existing ? `${idOf(entry.existing)}/` : ""}`, dashboardBody);
    const dashboardId = idOf(dashboard);
    const result = { key: entry.definition.key, id: dashboardId, url: `${manifest.api_host}/project/${project}/dashboard/${dashboardId}`, insights: [] };
    artifact.dashboards.push(result);
    await onProgress(structuredClone(artifact));
    for (const child of entry.children) {
      // Re-read before updating memberships to retain changes made since the inventory.
      const current = child.existing ? await client.request("GET", `${client.base}insights/${idOf(child.existing)}/?include_dashboards=true`) : null;
      const body = desiredBody(child.definition, current, "insight", child.stableKey, dashboardId);
      const insight = sameControlledFields(current, body) ? current : await client.request(current ? "PATCH" : "POST", `${client.base}insights/${current ? `${idOf(current)}/` : ""}`, body);
      result.insights.push({ key: child.definition.key, id: idOf(insight) });
      await onProgress(structuredClone(artifact));
    }
  }
  artifact.status = "complete";
  artifact.updated_at = new Date().toISOString();
  await onProgress(structuredClone(artifact));
  for (const dashboard of artifact.dashboards) log(`Updated dashboard: ${dashboard.url}`);
  return artifact;
}

export function parseArguments(args) {
  const options = { apply: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") return { help: true };
    if (arg === "--apply") { options.apply = true; continue; }
    if (!["--key-file", "--project"].includes(arg) || !args[index + 1] || args[index + 1].startsWith("--")) fail("Usage: node scripts/sync-posthog-dashboards.mjs --key-file /absolute/private-key.txt --project PROJECT_ID [--apply]");
    const field = arg === "--key-file" ? "keyFile" : "project";
    if (options[field]) fail("Each command-line option may be supplied only once.");
    options[field] = args[++index];
  }
  if (!options.keyFile || !isAbsolute(options.keyFile) || !/^[1-9][0-9]*$/.test(options.project ?? "")) fail("Provide an absolute --key-file path and the numeric --project ID. Keys must never be passed on the command line.");
  return options;
}
async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { console.log("Usage: node scripts/sync-posthog-dashboards.mjs --key-file /absolute/private-key.txt --project PROJECT_ID [--apply]\nDefaults to a dry run that validates queries. Required scopes: project:read, dashboard:read, insight:read, query:read; --apply also needs dashboard:write and insight:write."); return; }
  const root = fileURLToPath(new URL("../", import.meta.url));
  if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
    try { process.loadEnvFile(join(root, ".env.local")); } catch { fail("Set NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN or provide it in the project's .env.local file."); }
  }
  let key, manifest;
  try { key = (await readFile(options.keyFile, "utf8")).trim(); } catch { fail("The personal API key file could not be read."); }
  try { manifest = JSON.parse(await readFile(join(root, "docs/analytics/posthog-dashboards.json"), "utf8")); } catch { fail("The checked-in dashboard manifest could not be read."); }
  const outputDirectory = join(root, "outputs");
  const artifactPath = join(outputDirectory, `posthog-dashboards-${options.project}.json`);
  await syncDashboards({ ...options, key, manifest, projectToken: process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, onProgress: async (artifact) => {
    await mkdir(outputDirectory, { recursive: true });
    const temporary = `${artifactPath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, artifactPath);
  } });
  if (options.apply) console.log(`Dashboard IDs and links saved in outputs/posthog-dashboards-${options.project}.json`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error instanceof SyncError ? error.message : "Dashboard sync stopped unexpectedly. No credential or server payload was printed. Inspect a dry run before retrying."); process.exitCode = 1; });
}

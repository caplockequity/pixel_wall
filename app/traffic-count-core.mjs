const PRODUCTION_ORIGINS = new Set([
  "https://pixelwall.dev",
  "https://www.pixelwall.dev",
]);
const POSTHOG_HOSTS = new Map([
  ["us.i.posthog.com", "https://us.i.posthog.com/capture/"],
  ["eu.i.posthog.com", "https://eu.i.posthog.com/capture/"],
]);
const PAGE_GROUPS = new Set([
  "home", "editor", "classic_editor", "downloads", "guides", "workflow",
  "pricing", "support", "about", "privacy", "terms", "other",
]);
const DESTINATIONS = new Set([...PAGE_GROUPS, "browser_download", "cli_download"]);
const PLACEMENTS = new Set(["header", "footer", "content"]);
const EXPORT_TYPES = new Set([
  "png", "frame_png", "sprite_sheet_png", "sheet", "sprite_package", "tilemap_package",
  "animated_gif", "gif", "jpeg", "webp", "avif", "bmp", "tga", "aseprite", "project",
  "pixelwall", "zip", "json", "image", "other",
]);
const EXPORT_OUTCOMES = new Set(["success", "failure", "blocked"]);
const AUTOMATION_EDIT_OPERATIONS = new Set(["apply", "lua", "color_profile", "undo", "redo"]);
const EXPORT_SOURCES = new Set(["ui", "automation"]);
const DOWNLOADS = new Map([
  ["darwin-arm64", "zip"],
  ["darwin-x64", "zip"],
  ["win32-x64", "exe"],
  ["linux-x64", "appimage"],
]);
const MAX_BODY_BYTES = 2048;
const REQUEST_TIMEOUT_MS = 5000;

function response(status) {
  return new Response(null, { status });
}

function posthogCaptureUrl(configuredHost) {
  if (typeof configuredHost !== "string") return null;
  try {
    const url = new URL(configuredHost);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return POSTHOG_HOSTS.get(url.hostname) ?? null;
  } catch {
    return null;
  }
}

function randomUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  throw new Error("UUID generation is unavailable");
}

function roundedUtcTimestamp(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid clock");
  return `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

async function readPayload(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    try { await reader.cancel(); } catch { /* Request body is already closed. */ }
    return null;
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (typeof parsed.event !== "string" || typeof parsed.page_group !== "string" || !PAGE_GROUPS.has(parsed.page_group)) return null;
    const keys = Object.keys(parsed).sort();
    if (parsed.event === "site_page_viewed") {
      if (keys.join(",") !== "event,page_group") return null;
      return { ...parsed, action: "page_view" };
    }
    if (parsed.event === "editor_activated") {
      if (keys.join(",") !== "event,page_group") return null;
      return { ...parsed, action: "creation" };
    }
    if (parsed.event === "checkout_started") {
      if (keys.join(",") !== "billing_mode,event,page_group" || parsed.billing_mode !== "live") return null;
      return { ...parsed, action: "checkout_start" };
    }
    if (parsed.event === "site_cta_clicked") {
      if (keys.join(",") !== "destination,event,page_group,placement"
        || typeof parsed.destination !== "string" || !DESTINATIONS.has(parsed.destination)
        || typeof parsed.placement !== "string" || !PLACEMENTS.has(parsed.placement)) return null;
      return { ...parsed, action: parsed.destination === "browser_download" || parsed.destination === "cli_download" ? "download_click" : "navigation_click" };
    }
    if (parsed.event === "desktop_download_clicked") {
      if (keys.join(",") !== "event,package_type,page_group,platform,version"
        || typeof parsed.platform !== "string" || typeof parsed.package_type !== "string"
        || DOWNLOADS.get(parsed.platform) !== parsed.package_type
        || typeof parsed.version !== "string" || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.version)) return null;
      return { ...parsed, action: "download_click" };
    }
    if (parsed.event === "export_outcome") {
      if (!(keys.join(",") === "event,export_type,outcome,page_group"
        || keys.join(",") === "event,export_type,outcome,page_group,source")
        || typeof parsed.export_type !== "string" || !EXPORT_TYPES.has(parsed.export_type)
        || typeof parsed.outcome !== "string" || !EXPORT_OUTCOMES.has(parsed.outcome)
        || (Object.hasOwn(parsed, "source") && (typeof parsed.source !== "string" || !EXPORT_SOURCES.has(parsed.source)))) return null;
      return { ...parsed, action: "export" };
    }
    if (parsed.event === "automation_edit_completed") {
      if (keys.join(",") !== "event,operation,page_group"
        || parsed.page_group !== "editor"
        || typeof parsed.operation !== "string" || !AUTOMATION_EDIT_OPERATIONS.has(parsed.operation)
      ) return null;
      return { ...parsed, action: "automation_edit" };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Handle the aggregate count request without retaining browser identifiers or
 * forwarding request metadata. The dependency arguments make this testable
 * without a network call.
 */
export async function handleTrafficCountRequest(request, {
  env = {},
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  randomUUID = randomUuid,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (request.method !== "POST") return response(405);
  let requestUrl;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return response(400);
  }
  if (!PRODUCTION_ORIGINS.has(requestUrl.origin)) return response(403);
  if (request.headers.get("origin") !== requestUrl.origin) return response(403);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) return response(415);

  let payload;
  try {
    payload = await readPayload(request);
  } catch {
    return response(400);
  }
  if (!payload) return response(400);

  const token = typeof env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN === "string"
    ? env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN.trim() : "";
  const upstreamUrl = posthogCaptureUrl(env.NEXT_PUBLIC_POSTHOG_HOST);
  // A missing analytics configuration keeps the endpoint inert and harmless.
  if (!token || !upstreamUrl || typeof fetchImpl !== "function") return response(204);

  let timestamp;
  let distinctId;
  let uuid;
  try {
    timestamp = roundedUtcTimestamp(now);
    distinctId = randomUUID();
    uuid = randomUUID();
  } catch {
    return response(503);
  }
  const event = {
    api_key: token,
    event: "site_traffic_counted",
    uuid,
    timestamp,
    properties: {
      distinct_id: distinctId,
      token,
      analytics_schema_version: 2,
      environment: "production",
      page_group: payload.page_group,
      action: payload.action,
      measurement_mode: "aggregate",
      $process_person_profile: false,
      $geoip_disable: true,
      $ip: null,
    },
  };
  if (payload.event === "site_cta_clicked") {
    event.properties.destination = payload.destination;
    event.properties.placement = payload.placement;
    if (payload.action === "download_click") {
      event.properties.platform = payload.destination === "browser_download" ? "browser" : "cli";
    }
  } else if (payload.event === "desktop_download_clicked") {
    event.properties.platform = payload.platform;
    event.properties.version = payload.version;
    event.properties.package_type = payload.package_type;
  } else if (payload.event === "export_outcome") {
    event.properties.export_type = payload.export_type;
    event.properties.outcome = payload.outcome;
    if (Object.hasOwn(payload, "source")) event.properties.source = payload.source;
  } else if (payload.event === "automation_edit_completed") {
    event.properties.source = "automation";
    event.properties.operation = payload.operation;
  } else if (payload.event === "checkout_started") {
    event.properties.billing_mode = payload.billing_mode;
  }
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  if (request.signal?.aborted) return response(499);
  request.signal?.addEventListener("abort", abortRequest, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetchImpl(upstreamUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      redirect: "error",
      signal: controller.signal,
    });
    const successful = upstream && upstream.status >= 200 && upstream.status < 300;
    try { await upstream?.body?.cancel(); } catch { /* Ignore response cleanup failures. */ }
    return successful ? response(204) : response(502);
  } catch {
    return response(502);
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abortRequest);
  }
}

export { MAX_BODY_BYTES, PAGE_GROUPS, PRODUCTION_ORIGINS, posthogCaptureUrl };

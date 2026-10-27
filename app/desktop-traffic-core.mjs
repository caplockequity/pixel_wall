const PRODUCTION_ORIGINS = new Set(["https://pixelwall.dev", "https://www.pixelwall.dev"]);
const POSTHOG_HOSTS = new Map([
  ["us.i.posthog.com", "https://us.i.posthog.com/capture/"],
  ["eu.i.posthog.com", "https://eu.i.posthog.com/capture/"],
]);
const MAX_BODY_BYTES = 2048;
const REQUEST_TIMEOUT_MS = 5000;
const OPERATIONS = new Set(["connect", "apply", "lua", "color_profile", "undo", "redo", "new_document", "open_project", "import_project", "save", "export", "validate", "capture_preview", "preview", "read_artifact", "download_artifact", "remove_artifact", "save_artifact"]);
const OUTCOMES = new Set(["success", "failure", "cancelled", "blocked", "missing"]);
const CHANGED_OPERATIONS = new Set(["apply", "lua", "color_profile", "undo", "redo"]);
const PREVIEW_KINDS = new Set(["frame", "contact-sheet", "comparison"]);
const ARTIFACT_PERSISTENCE = new Set(["persisted", "failed", "not_requested"]);
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const empty = status => new Response(null, { status });
function randomUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  throw new Error("UUID generation is unavailable");
}
function posthogCaptureUrl(host) {
  if (typeof host !== "string") return null;
  try {
    const url = new URL(host);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return POSTHOG_HOSTS.get(url.hostname) ?? null;
  } catch { return null; }
}
async function readBody(request) {
  if (!request.body) return null;
  const reader = request.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength; if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } catch { try { await reader.cancel(); } catch { /* Request body is already closed. */ } return null; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed).sort();
  const allowed = ["event", "operation", "outcome", "version", "changed", "preview_kind", "artifact_persistence"];
  if (keys.some(key => !allowed.includes(key)) || parsed.event !== "desktop_automation_operation") return null;
  if (!OPERATIONS.has(parsed.operation) || !OUTCOMES.has(parsed.outcome) || typeof parsed.version !== "string" || !VERSION.test(parsed.version)) return null;
  if (Object.hasOwn(parsed, "changed") && (typeof parsed.changed !== "boolean" || !CHANGED_OPERATIONS.has(parsed.operation) || parsed.outcome !== "success")) return null;
  if (Object.hasOwn(parsed, "preview_kind") && (typeof parsed.preview_kind !== "string" || !PREVIEW_KINDS.has(parsed.preview_kind))) return null;
  if (Object.hasOwn(parsed, "artifact_persistence") && (typeof parsed.artifact_persistence !== "string" || !ARTIFACT_PERSISTENCE.has(parsed.artifact_persistence))) return null;
  return parsed;
}

export async function handleDesktopTrafficRequest(request, {
  env = {}, fetchImpl = globalThis.fetch, now = () => new Date(), randomUUID: uuidFactory = randomUuid, timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (request.method !== "POST") return empty(405);
  let requestUrl; try { requestUrl = new URL(request.url); } catch { return empty(400); }
  if (!PRODUCTION_ORIGINS.has(requestUrl.origin)) return empty(403);
  const origin = request.headers.get("origin");
  // The desktop launcher is the only caller. A browser always supplies an
  // Origin for this JSON POST, so reject same-origin and foreign browser posts
  // alike; native clients omit it.
  if (origin) return empty(403);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) return empty(415);
  const payload = await readBody(request); if (!payload) return empty(400);
  const token = typeof env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN === "string" ? env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN.trim() : "";
  const upstreamUrl = posthogCaptureUrl(env.NEXT_PUBLIC_POSTHOG_HOST);
  if (!token || !upstreamUrl || typeof fetchImpl !== "function") return empty(204);
  let timestamp, uuid, distinctId;
  try {
    const value = now instanceof Function ? now() : now;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw Error("Invalid clock");
    timestamp = `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
    uuid = uuidFactory(); distinctId = uuidFactory();
  } catch { return empty(503); }
  const properties = {
    distinct_id: distinctId, token, analytics_schema_version: 2, environment: "production", app_version: payload.version,
    surface: "desktop_mcp", measurement_mode: "aggregate", operation: payload.operation,
    outcome: payload.outcome, $process_person_profile: false, $geoip_disable: true, $ip: null,
  };
  if (Object.hasOwn(payload, "changed")) properties.changed = payload.changed;
  if (Object.hasOwn(payload, "preview_kind")) properties.preview_kind = payload.preview_kind;
  if (Object.hasOwn(payload, "artifact_persistence")) properties.artifact_persistence = payload.artifact_persistence;
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetchImpl(upstreamUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: token, event: "desktop_automation_counted", uuid, timestamp, properties }), redirect: "error", signal: controller.signal });
    try { await upstream?.body?.cancel(); } catch { /* Ignore response cleanup failures. */ }
    return upstream?.status >= 200 && upstream?.status < 300 ? empty(204) : empty(502);
  } catch { return empty(502); } finally { clearTimeout(timer); }
}

export { MAX_BODY_BYTES, OPERATIONS, OUTCOMES, PRODUCTION_ORIGINS, posthogCaptureUrl };

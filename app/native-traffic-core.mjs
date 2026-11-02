/** Strict, content-free ingestion for downloadable CLI and desktop MCP reports. */
const PRODUCTION_ORIGINS = new Set(['https://pixelwall.dev', 'https://www.pixelwall.dev']);
const POSTHOG_HOSTS = new Map([
  ['us.i.posthog.com', 'https://us.i.posthog.com/capture/'],
  ['eu.i.posthog.com', 'https://eu.i.posthog.com/capture/'],
]);
const MAX_BODY_BYTES = 2048;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const OUTCOMES = new Set(['success', 'failure', 'cancelled', 'blocked', 'missing']);
const FORMATS = new Set(['png', 'bmp', 'tga', 'gif', 'sheet', 'atlas', 'zip', 'ase', 'aseprite', 'pixelwall', 'project', 'json']);
const ENUMS = {
  platform: new Set(['darwin', 'win32', 'linux', 'other']),
  arch: new Set(['arm64', 'x64', 'ia32', 'other']),
  duration_bucket: new Set(['under_100ms', '100ms_1s', '1s_10s', 'over_10s']),
  usage_day: new Set(['first', 'returning']),
};
const CONTRACTS = {
  desktop_mcp: {
    inputEvent: 'desktop_automation_operation', outputEvent: 'desktop_automation_counted',
    operations: new Set(['connect', 'apply', 'lua', 'color_profile', 'undo', 'redo', 'new_document', 'open_project', 'import_project', 'save', 'export', 'validate', 'capture_preview', 'preview', 'read_artifact', 'download_artifact', 'remove_artifact', 'save_artifact']),
    changed: new Set(['apply', 'lua', 'color_profile', 'undo', 'redo']),
    extras: ['preview_kind', 'artifact_persistence'],
  },
  cli: {
    inputEvent: 'cli_usage_operation', outputEvent: 'cli_usage_counted',
    operations: new Set(['new', 'inspect', 'commands', 'capabilities', 'doctor', 'plan', 'verify', 'apply', 'script', 'profile', 'render', 'export', 'import', 'import_sequence']),
    changed: new Set(['apply', 'script', 'profile']),
    writes: new Set(['new', 'apply', 'script', 'profile', 'render', 'export', 'import', 'import_sequence']),
    extras: ['wrote_files', 'verified'],
  },
};
const empty = status => new Response(null, { status });

function posthogCaptureUrl(host) {
  if (typeof host !== 'string') return null;
  try {
    const url = new URL(host);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
    return POSTHOG_HOSTS.get(url.hostname) ?? null;
  } catch { return null; }
}

async function readPayload(request, contract) {
  if (!request.body) return null;
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
  } catch { try { await reader.cancel(); } catch { /* Disconnected request. */ } return null; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return null; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const allowed = new Set(['event', 'operation', 'outcome', 'version', 'changed', 'format', ...Object.keys(ENUMS), ...contract.extras]);
  if (Object.keys(payload).some(key => !allowed.has(key))) return null;
  if (payload.event !== contract.inputEvent || !contract.operations.has(payload.operation) || !OUTCOMES.has(payload.outcome) || typeof payload.version !== 'string' || !VERSION.test(payload.version)) return null;
  for (const [key, values] of Object.entries(ENUMS)) if (Object.hasOwn(payload, key) && !values.has(payload[key])) return null;
  if (Object.hasOwn(payload, 'changed') && (typeof payload.changed !== 'boolean' || !contract.changed.has(payload.operation) || payload.outcome !== 'success')) return null;
  if (Object.hasOwn(payload, 'format') && (!FORMATS.has(payload.format) || !['export', 'render', 'plan'].includes(payload.operation))) return null;
  if (Object.hasOwn(payload, 'preview_kind') && !['frame', 'contact-sheet', 'comparison'].includes(payload.preview_kind)) return null;
  if (Object.hasOwn(payload, 'artifact_persistence') && !['persisted', 'failed', 'not_requested'].includes(payload.artifact_persistence)) return null;
  if (Object.hasOwn(payload, 'wrote_files') && (typeof payload.wrote_files !== 'boolean' || !contract.writes?.has(payload.operation) || payload.outcome !== 'success')) return null;
  if (Object.hasOwn(payload, 'verified') && (typeof payload.verified !== 'boolean' || !['verify', 'render', 'export'].includes(payload.operation) || payload.outcome !== 'success')) return null;
  return payload;
}

export async function handleNativeTrafficRequest(request, surface, {
  env = {}, fetchImpl = globalThis.fetch, now = () => new Date(), randomUUID = () => globalThis.crypto.randomUUID(), timeoutMs = 5000,
} = {}) {
  const contract = CONTRACTS[surface];
  if (!contract) return empty(400);
  if (request.method !== 'POST') return empty(405);
  let url; try { url = new URL(request.url); } catch { return empty(400); }
  if (!PRODUCTION_ORIGINS.has(url.origin) || request.headers.get('origin')) return empty(403);
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) return empty(415);
  const payload = await readPayload(request, contract); if (!payload) return empty(400);
  const token = typeof env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN === 'string' ? env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN.trim() : '';
  const upstreamUrl = posthogCaptureUrl(env.NEXT_PUBLIC_POSTHOG_HOST);
  if (!token || !upstreamUrl || typeof fetchImpl !== 'function') return empty(204);
  let timestamp, uuid, distinctId;
  try {
    const value = typeof now === 'function' ? now() : now;
    const date = value instanceof Date ? value : new Date(value);
    timestamp = `${date.toISOString().slice(0, 10)}T00:00:00.000Z`;
    uuid = randomUUID(); distinctId = randomUUID();
  } catch { return empty(503); }
  const properties = {
    distinct_id: distinctId, token, analytics_schema_version: 2, environment: 'production', app_version: payload.version,
    surface, measurement_mode: 'aggregate', operation: payload.operation, outcome: payload.outcome,
    $process_person_profile: false, $geoip_disable: true, $ip: null,
  };
  for (const key of ['changed', 'format', ...Object.keys(ENUMS), ...contract.extras]) if (Object.hasOwn(payload, key)) properties[key] = payload[key];
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetchImpl(upstreamUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: token, event: contract.outputEvent, uuid, timestamp, properties }),
      redirect: 'error', signal: controller.signal,
    });
    try { await upstream?.body?.cancel(); } catch { /* Ignore response cleanup failures. */ }
    return upstream?.status >= 200 && upstream?.status < 300 ? empty(204) : empty(502);
  } catch { return empty(502); } finally { clearTimeout(timer); }
}

export { CONTRACTS, MAX_BODY_BYTES, OUTCOMES, PRODUCTION_ORIGINS, posthogCaptureUrl };

"use client";

import { classifyAcquisition } from "./acquisition.mjs";
import type {
  CaptureResult,
  PostHogConfig,
} from "posthog-js";

type AnalyticsPrimitive = string | number | boolean;

type CommonProductProperties = {
  canvas_width?: number;
  canvas_height?: number;
  color_mode?: string;
  canvas_size?: number;
  frame_count?: number;
  layer_count?: number;
  clip_count?: number;
  slice_count?: number;
  has_reference?: boolean;
  tilemap_width?: number;
  tilemap_height?: number;
  tilemap_placed_cells?: number;
};

type ExportProperties = {
  export_type: string;
  source?: string;
  duration_ms?: number;
  reason?: string;
  clip_scope?: string;
  layout?: string;
  padding?: number;
  trim?: boolean;
  include_individual_frames?: boolean;
  exported_frame_count?: number;
  map_width?: number;
  map_height?: number;
  placed_cells?: number;
  tile_types?: number;
};

export type AnalyticsEventMap = {
  site_page_viewed: { page_group: string };
  site_cta_clicked: { destination: string; placement: string };
  desktop_download_clicked: { platform: string; version: string; package_type: string };
  editor_activated: CommonProductProperties & { activation_type: string };
  editor_tool_used: CommonProductProperties & { tool_family: string };
  import_completed: CommonProductProperties & { import_kind: string; format: string; file_count?: number; warning_count?: number };
  import_failed: CommonProductProperties & { import_kind: string; format: string; file_count?: number; reason: string };
  recovery_action: CommonProductProperties & { action: string; outcome: string; reason?: string };
  automation_used: CommonProductProperties & { operation: string; command_count?: number };
  pro_dialog_viewed: { source: string };
  checkout_started: { billing_mode: string };
  checkout_redirected: { billing_mode: string };
  checkout_returned: { outcome: string };
  checkout_failed: { reason: string; billing_mode?: string };
  entitlement_claimed: { outcome: string; reason?: string; billing_mode?: string };
  entitlement_restored: { outcome: string; reason?: string; billing_mode?: string };
  editor_loaded: CommonProductProperties & {
    project_source: string;
  };
  quick_guide_viewed: CommonProductProperties & {
    source: string;
  };
  quick_guide_dismissed: CommonProductProperties & {
    source: string;
    method: string;
  };
  canvas_edit_committed: CommonProductProperties & {
    edit_type: string;
    tool: string;
    input_method: string;
    linked_edges: boolean;
    changed_cells?: number;
  };
  project_structure_changed: CommonProductProperties & {
    resource: string;
    action: string;
    from_value?: string | number | boolean;
    to_value?: string | number | boolean;
  };
  feature_toggled: CommonProductProperties & {
    feature: string;
    enabled: boolean;
    source: string;
  };
  animation_playback_changed: CommonProductProperties & {
    action: string;
    clip_frame_count: number;
    direction: string;
    loop: boolean;
  };
  reference_loaded: CommonProductProperties & {
    mime_type: string;
    file_size_bucket: string;
    image_width: number;
    image_height: number;
    sprite_sheet_detected: boolean;
    sheet_direction?: string;
    sheet_frame_count?: number;
    sheet_frame_size?: number;
    pixel_fit_auto: boolean;
  };
  reference_load_failed: CommonProductProperties & {
    reason: string;
    mime_type?: string;
    file_size_bucket?: string;
  };
  reference_action: CommonProductProperties & {
    action: string;
    sheet_frame_count?: number;
    sheet_frame_size?: number;
    sheet_direction?: string;
  };
  sprite_sheet_imported: CommonProductProperties & {
    outcome: string;
    reason?: string;
    sheet_frame_count: number;
    sheet_frame_size: number;
    sheet_direction: string;
    partial_alpha_flattened?: boolean;
  };
  tilemap_edit_committed: CommonProductProperties & {
    action: string;
    input_method: string;
    changed_cells?: number;
    map_width: number;
    map_height: number;
    placed_cells: number;
    tile_types: number;
  };
  project_file_operation: CommonProductProperties & {
    operation: string;
    outcome: string;
    reason?: string;
  };
  autosave_failed: CommonProductProperties & {
    reason: string;
  };
  autosave_recovered: CommonProductProperties;
  export_started: CommonProductProperties & ExportProperties;
  export_completed: CommonProductProperties & ExportProperties;
  export_failed: CommonProductProperties & ExportProperties;
  export_blocked: CommonProductProperties & ExportProperties;
  analytics_consent_updated: {
    choice: string;
    source: string;
  };
};

export type AnalyticsEventName = keyof AnalyticsEventMap;
export type AnalyticsProperties<E extends AnalyticsEventName = AnalyticsEventName> = AnalyticsEventMap[E];

const COMMON_PRODUCT_PROPERTY_KEYS = [
  "canvas_width", "canvas_height", "color_mode",
  "canvas_size",
  "frame_count",
  "layer_count",
  "clip_count",
  "slice_count",
  "has_reference",
  "tilemap_width",
  "tilemap_height",
  "tilemap_placed_cells",
] as const;

export const EVENT_PROPERTY_ALLOWLIST = {
  site_page_viewed: ["page_group"],
  site_cta_clicked: ["destination", "placement"],
  desktop_download_clicked: ["platform", "version", "package_type"],
  editor_activated: [...COMMON_PRODUCT_PROPERTY_KEYS, "activation_type"],
  editor_tool_used: [...COMMON_PRODUCT_PROPERTY_KEYS, "tool_family"],
  import_completed: [...COMMON_PRODUCT_PROPERTY_KEYS, "import_kind", "format", "file_count", "warning_count"],
  import_failed: [...COMMON_PRODUCT_PROPERTY_KEYS, "import_kind", "format", "file_count", "reason"],
  recovery_action: [...COMMON_PRODUCT_PROPERTY_KEYS, "action", "outcome", "reason"],
  automation_used: [...COMMON_PRODUCT_PROPERTY_KEYS, "operation", "command_count"],
  pro_dialog_viewed: ["source"],
  checkout_started: ["billing_mode"],
  checkout_redirected: ["billing_mode"],
  checkout_returned: ["outcome"],
  checkout_failed: ["reason", "billing_mode"],
  entitlement_claimed: ["outcome", "reason", "billing_mode"],
  entitlement_restored: ["outcome", "reason", "billing_mode"],
  editor_loaded: [...COMMON_PRODUCT_PROPERTY_KEYS, "project_source"],
  quick_guide_viewed: [...COMMON_PRODUCT_PROPERTY_KEYS, "source"],
  quick_guide_dismissed: [...COMMON_PRODUCT_PROPERTY_KEYS, "source", "method"],
  canvas_edit_committed: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "edit_type",
    "tool",
    "input_method",
    "linked_edges",
    "changed_cells",
  ],
  project_structure_changed: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "resource",
    "action",
    "from_value",
    "to_value",
  ],
  feature_toggled: [...COMMON_PRODUCT_PROPERTY_KEYS, "feature", "enabled", "source"],
  animation_playback_changed: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "action",
    "clip_frame_count",
    "direction",
    "loop",
  ],
  reference_loaded: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "mime_type",
    "file_size_bucket",
    "image_width",
    "image_height",
    "sprite_sheet_detected",
    "sheet_direction",
    "sheet_frame_count",
    "sheet_frame_size",
    "pixel_fit_auto",
  ],
  reference_load_failed: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "reason",
    "mime_type",
    "file_size_bucket",
  ],
  reference_action: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "action",
    "sheet_frame_count",
    "sheet_frame_size",
    "sheet_direction",
  ],
  sprite_sheet_imported: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "outcome",
    "reason",
    "sheet_frame_count",
    "sheet_frame_size",
    "sheet_direction",
    "partial_alpha_flattened",
  ],
  tilemap_edit_committed: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "action",
    "input_method",
    "changed_cells",
    "map_width",
    "map_height",
    "placed_cells",
    "tile_types",
  ],
  project_file_operation: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "operation",
    "outcome",
    "reason",
  ],
  autosave_failed: [...COMMON_PRODUCT_PROPERTY_KEYS, "reason"],
  autosave_recovered: [...COMMON_PRODUCT_PROPERTY_KEYS],
  export_started: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "export_type",
    "source",
    "duration_ms",
    "reason",
    "clip_scope",
    "layout",
    "padding",
    "trim",
    "include_individual_frames",
    "exported_frame_count",
    "map_width",
    "map_height",
    "placed_cells",
    "tile_types",
  ],
  export_completed: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "export_type",
    "source",
    "duration_ms",
    "reason",
    "clip_scope",
    "layout",
    "padding",
    "trim",
    "include_individual_frames",
    "exported_frame_count",
    "map_width",
    "map_height",
    "placed_cells",
    "tile_types",
  ],
  export_failed: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "export_type",
    "source",
    "duration_ms",
    "reason",
    "clip_scope",
    "layout",
    "padding",
    "trim",
    "include_individual_frames",
    "exported_frame_count",
    "map_width",
    "map_height",
    "placed_cells",
    "tile_types",
  ],
  export_blocked: [
    ...COMMON_PRODUCT_PROPERTY_KEYS,
    "export_type",
    "source",
    "duration_ms",
    "reason",
    "clip_scope",
    "layout",
    "padding",
    "trim",
    "include_individual_frames",
    "exported_frame_count",
    "map_width",
    "map_height",
    "placed_cells",
    "tile_types",
  ],
  analytics_consent_updated: ["choice", "source"],
} as const satisfies Record<AnalyticsEventName, readonly string[]>;

export type AnalyticsConsentStatus = "pending" | "granted" | "denied" | "blocked" | "unavailable";
export type AnalyticsLevel = "required" | "usage" | "enhanced";
export const ANALYTICS_CONSENT_CHANGED_EVENT = "pixelwall:analytics-consent-changed";

const POSTHOG_PROJECT_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim() ?? "";
const STANDALONE = process.env.NEXT_PUBLIC_PIXELWALL_STANDALONE === "true";
const POSTHOG_CONFIGURED_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() ?? "";
const POSTHOG_PROXY_PATH = "/beam";
const ANALYTICS_CONSENT_STORAGE_KEY = "pixelwall-analytics-consent-v2";
const LEGACY_ANALYTICS_CONSENT_STORAGE_KEY = "pixelwall-analytics-consent-v1";
const MAX_PENDING_EVENTS = 50;
const MAX_ANALYTICS_STRING_LENGTH = 96;
const SAFE_ANALYTICS_STRING = /^[a-z0-9]+(?:[._:+/-][a-z0-9]+)*$/i;
const ANALYTICS_INITIALIZED_KEY = "__pixelwallPostHogInitialized";

type QueuedAnalyticsEvent = {
  event: AnalyticsEventName;
  properties: Record<string, AnalyticsPrimitive>;
};

type PostHogSdk = typeof import("posthog-js")["default"];

const pendingEvents: QueuedAnalyticsEvent[] = [];
let posthog: PostHogSdk | null = null;
let sdkLoading: Promise<void> | null = null;
let sessionLevel: AnalyticsLevel | null = null;
let appliedLevel: AnalyticsLevel | null = null;
let consentListenersRegistered = false;

function browserGlobal() {
  return globalThis as typeof globalThis & {
    [ANALYTICS_INITIALIZED_KEY]?: boolean;
  };
}

function configuredPostHogUiHost() {
  if (!POSTHOG_CONFIGURED_HOST) return null;
  try {
    const host = new URL(POSTHOG_CONFIGURED_HOST);
    if (host.protocol !== "https:") return null;
    if (host.hostname === "us.i.posthog.com") return "https://us.posthog.com";
    if (host.hostname === "eu.i.posthog.com") return "https://eu.posthog.com";
    return null;
  } catch {
    return null;
  }
}

export function isAnalyticsConfigured() {
  if (STANDALONE || !POSTHOG_PROJECT_TOKEN || !configuredPostHogUiHost()) return false;
  // Private Sites, preview deployments, development, and downloaded apps are excluded.
  if (typeof window === "undefined") return false;
  return ["https://pixelwall.dev", "https://www.pixelwall.dev"].includes(window.location.origin);
}

function hasBrowserEnvironment() {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

export function isAnalyticsBlockedByBrowserPrivacySignal() {
  if (!hasBrowserEnvironment()) return false;
  const privacyNavigator = navigator as Navigator & {
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string | null;
  };
  const privacyWindow = window as Window & { doNotTrack?: string | null };
  const doNotTrack = privacyNavigator.doNotTrack
    ?? privacyNavigator.msDoNotTrack
    ?? privacyWindow.doNotTrack;
  return privacyNavigator.globalPrivacyControl === true
    || doNotTrack === "1"
    || doNotTrack?.toLowerCase() === "yes";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PAGE_GROUPS = "home editor classic_editor downloads guides workflow pricing support about privacy terms other".split(" ");
const REFERRAL_SOURCES = "direct_or_unknown internal chatgpt claude perplexity copilot bing google reddit github other".split(" ");
const CONTEXT_VALUES = {
  page_group: PAGE_GROUPS,
  editor_variant: ["workbench", "classic", "none"],
  referral_source: REFERRAL_SOURCES,
  entry_page: PAGE_GROUPS,
};
const STRING_VALUES: Record<string, readonly string[]> = Object.fromEntries(Object.entries({
  page_group: PAGE_GROUPS.join(" "),
  destination: [...PAGE_GROUPS, "browser_download", "cli_download"].join(" "),
  placement: "header footer content",
  platform: "darwin-arm64 darwin-x64 win32-x64 mac-arm64 mac-x64 windows-x64 linux-x64 macos-arm64 macos-x64 windows linux",
  package_type: "zip exe appimage AppImage",
  color_mode: "rgba indexed grayscale rgb",
  project_source: "new library legacy_migration storage_unavailable fresh_demo restored_v3 upgraded_v2 upgraded_v1",
  activation_type: "drawing erase fill gradient text shapes layers animation cels paste selection canvas palette effects slices tilemap structure import automation stroke edit",
  tool_family: "erase gradient cels paste canvas slices drawing shapes fill selection transform layers frames animation palette tilemap tiles effects text import reference structure automation other",
  import_kind: "document extension native aseprite image animation sprite_sheet palette reference sequence project gif sheet raster",
  format: "other project image tga zip sheet pixelwall aseprite ase png jpeg jpg webp gif bmp avif svg json gpl pal hex aseprite_palette unknown",
  source: "initial_prompt privacy_settings automatic keyboard toolbar footer menu export checkout_return restore ui automation banner settings",
  method: "got_it close backdrop escape start_drawing button",
  edit_type: "stroke erase fill selection_paste selection_move selection_flip_horizontal selection_flip_vertical selection_clear pivot_set frame_clear",
  tool: "pencil eraser fill picker select pivot hand",
  input_method: "pointer keyboard toolbar",
  resource: "canvas frame layer clip slice tilemap pivot",
  action: "match_pixels use_detected_grid next_sprite previous_sprite add_trace_frame view add delete duplicate reorder resize clear_layer range_change visibility_toggle lock_toggle timing_change direction_change loop_toggle use_default set_default bottom_center started paused completed clear paint erase center fit pixel_fit reset remove tile_previous tile_next import viewed restore",
  feature: "grid seam_preview linked_edges onion_skin reference_visible reference_pixel_fit",
  direction: "forward reverse pingpong ping-pong",
  mime_type: "image/png image/jpeg image/gif image/webp image/avif image/bmp unknown",
  file_size_bucket: "under_256kb 256kb_to_1mb 1mb_to_5mb 5mb_to_20mb 20mb_plus",
  sheet_direction: "horizontal vertical grid",
  operation: "apply new_document new create open save backup undo redo batch export import restore load",
  outcome: "success failure cancelled unknown online_only",
  reason: "missing_image project_operation_failed none ownership_license_unavailable verification_failed payment_pending rate_limited unavailable network save_failed unknown storage_failed browser_storage_unavailable too_large unsupported_type decode_error read_error frame_limit processing_error serialization_error invalid_or_unsupported render_or_download_error render_or_encode_error render_or_package_error empty_tilemap pro_required pro_unavailable export_failed import_failed cancelled unavailable budget_exceeded conflict corrupt_record not_found invalid_document invalid_revision quota_exceeded storage_unavailable encoding_failed invalid_format",
  export_type: "project zip tga other frame_png animated_gif sprite_sheet_png sprite_package tilemap_package png jpeg webp gif sheet atlas game_zip pixelwall aseprite svg bmp",
  clip_scope: "single all",
  layout: "horizontal vertical grid packed",
  choice: "usage enhanced",
  billing_mode: "live test unknown",
}).map(([key, values]) => [key, values.split(" ")]));

function isApprovedString(key: string, value: string) {
  if (key === "version") return /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
  if (key === "from_value" || key === "to_value") return ["forward", "reverse", "pingpong", "ping-pong"].includes(value) || /^\d{1,4}x\d{1,4}$/.test(value);
  return STRING_VALUES[key]?.includes(value) ?? false;
}
export function analyticsPageGroup(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "home";
  if (path === "/editor/classic") return "classic_editor";
  if (path === "/editor") return "editor";
  if (path === "/guides" || path.startsWith("/guides/")) return "guides";
  if (["/sprite-sheet-maker", "/pixel-art-animation", "/pixel-art-tracing", "/tileset-maker"].includes(path)) return "workflow";
  return PAGE_GROUPS.includes(path.slice(1)) ? path.slice(1) : "other";
}

function analyticsContext() {
  const page = analyticsPageGroup(window.location.pathname ?? "/");
  return {
    analytics_schema_version: 2,
    environment: "production",
    page_group: page,
    editor_variant: page === "editor" ? "workbench" : page === "classic_editor" ? "classic" : "none",
    ...(typeof document === "undefined" ? {} : classifyAcquisition(document.referrer, window.location.origin)),
  };
}

const SDK_IDS = ["distinct_id", "$device_id", "$session_id", "$window_id", "$pageview_id"];
const RANDOM_ID = /^(?:\$device:)?[a-f0-9-]{16,64}$/i;
const SDK_ENUMS: Record<string, readonly string[]> = {
  $browser: ["Chrome", "Chrome iOS", "Safari", "Mobile Safari", "Firefox", "Firefox iOS", "Microsoft Edge", "Opera", "Samsung Internet", "Internet Explorer", "Other"],
  $os: ["Windows", "Mac OS X", "macOS", "Linux", "Android", "iOS", "Chrome OS", "Other"],
  $device_type: ["Desktop", "Mobile", "Tablet"],
  $lib: ["web"],
};

// The final send boundary rejects SDK enrichment and unknown events too. It never
// recursively passes through caller objects, DOM text, URLs, or person properties.
function sanitizeBeforeSend(capture: CaptureResult | null): CaptureResult | null {
  if (!capture || !isAnalyticsConfigured() || storedAnalyticsConsent() !== "granted" || isAnalyticsBlockedByBrowserPrivacySignal()) return null;
  const custom = Object.hasOwn(EVENT_PROPERTY_ALLOWLIST, capture.event);
  const diagnostic = capture.event === "$exception" || capture.event === "$web_vitals";
  if (!custom && !(diagnostic && getAnalyticsLevel() === "enhanced")) return null;
  const source = isRecord(capture.properties) ? capture.properties : {};
  const properties: Record<string, unknown> = custom
    ? sanitizeEventProperties(capture.event as AnalyticsEventName, source as AnalyticsProperties)
    : {};
  // The SDK requires the public project token after before_send. Never reuse a
  // caller-provided token or allow events to be redirected to another project.
  properties.token = POSTHOG_PROJECT_TOKEN;
  for (const key of SDK_IDS) {
    if (typeof source[key] === "string" && RANDOM_ID.test(source[key])) properties[key] = source[key];
  }
  for (const [key, values] of Object.entries(SDK_ENUMS)) {
    if (typeof source[key] === "string" && values.includes(source[key])) properties[key] = source[key];
  }
  for (const key of ["$screen_width", "$screen_height", "$viewport_width", "$viewport_height", "$browser_version"]) {
    if (typeof source[key] === "number" && Number.isFinite(source[key]) && source[key] >= 0 && source[key] <= 100000) properties[key] = source[key];
  }
  // Disable person processing and IP enrichment even when a remote SDK default changes.
  properties.$process_person_profile = false;
  properties.$geoip_disable = true;
  properties.$is_identified = false;
  const current = analyticsContext();
  for (const key of ["page_group", "editor_variant", "referral_source", "entry_page"] as const) {
    const value = source[key];
    if (typeof value === "string" && CONTEXT_VALUES[key].includes(value)) (current as Record<string, unknown>)[key] = value;
  }
  Object.assign(properties, current);
  if (capture.event === "$exception") {
    const exceptions = Array.isArray(source.$exception_list) ? source.$exception_list.slice(0, 5) : [];
    properties.$exception_list = exceptions.filter(isRecord).map((exception) => ({
      type: ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "DOMException", "URIError", "EvalError"].includes(String(exception.type)) ? exception.type : "Error",
      value: "[redacted]",
      mechanism: { type: "generic", handled: isRecord(exception.mechanism) && exception.mechanism.handled === true },
    }));
  }
  if (capture.event === "$web_vitals") {
    for (const name of ["LCP", "CLS", "INP", "FCP", "TTFB"]) {
      const key = `$web_vitals_${name}_value`;
      if (typeof source[key] === "number" && Number.isFinite(source[key]) && source[key] >= 0) properties[key] = source[key];
    }
  }
  return {
    event: capture.event,
    uuid: typeof capture.uuid === "string" && RANDOM_ID.test(capture.uuid) ? capture.uuid : "",
    ...(capture.timestamp instanceof Date ? { timestamp: capture.timestamp } : {}),
    properties,
  };
}

// Network data is unnecessary for diagnostics; no request names, bodies or headers.
function sanitizeCapturedNetworkRequest() { return null; }

function clearPendingEvents() {
  pendingEvents.length = 0;
}

function storedAnalyticsLevel(): AnalyticsLevel | "pending" | "unavailable" {
  if (!hasBrowserEnvironment()) return "unavailable";
  if (sessionLevel) return sessionLevel;
  try {
    const stored = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY);
    if (stored === "required" || stored === "usage" || stored === "enhanced") return stored;
    if (stored !== null) return "pending";
    const legacy = window.localStorage.getItem(LEGACY_ANALYTICS_CONSENT_STORAGE_KEY);
    // Existing permission allows usage only; recordings need an explicit enhanced choice.
    if (legacy === "granted") return "usage";
    if (legacy === "denied") return "required";
    return "pending";
  } catch {
    return "unavailable";
  }
}

function storedAnalyticsConsent(): "granted" | "denied" | "pending" | "unavailable" {
  const level = storedAnalyticsLevel();
  if (level === "usage" || level === "enhanced") return "granted";
  return level === "required" ? "denied" : level;
}

export function getAnalyticsLevel(): AnalyticsLevel {
  if (isAnalyticsBlockedByBrowserPrivacySignal()) return "required";
  const level = storedAnalyticsLevel();
  return level === "usage" || level === "enhanced" ? level : "required";
}

function persistAnalyticsConsent(choice: AnalyticsLevel) {
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, choice);
  } catch {
    // A failed withdrawal must not fall back to an older, more permissive choice.
    sessionLevel = "required";
    return false;
  }
  sessionLevel = null;
  try {
    // Also stop any still-open tab running the old all-or-nothing consent code.
    window.localStorage.setItem(LEGACY_ANALYTICS_CONSENT_STORAGE_KEY, "denied");
  } catch { /* The new preference is already saved. */ }
  return true;
}

function analyticsIsInitialized() {
  return Boolean(posthog && browserGlobal()[ANALYTICS_INITIALIZED_KEY]);
}

function flushPendingEvents() {
  if (
    !posthog
    || storedAnalyticsConsent() !== "granted"
    || isAnalyticsBlockedByBrowserPrivacySignal()
    || !analyticsIsInitialized()
    || !posthog.is_capturing()
  ) return;
  const queued = pendingEvents.splice(0, pendingEvents.length);
  for (const item of queued) posthog.capture(item.event, item.properties);
}

function optInInitializedAnalytics() {
  if (!posthog) return;
  applyAnalyticsLevel();
  posthog.opt_in_capturing({ captureEventName: false });
  flushPendingEvents();
}

function analyticsFeatureConfig(level: AnalyticsLevel): Partial<PostHogConfig> {
  const enhanced = level === "enhanced";
  return {
    autocapture: false,
    rageclick: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_exceptions: enhanced ? {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    } : false,
    capture_performance: enhanced ? { network_timing: false, web_vitals: true, web_vitals_attribution: false } : false,
    disable_session_recording: true,
  };
}

function applyAnalyticsLevel() {
  if (!posthog) return;
  const level = getAnalyticsLevel();
  if (level === appliedLevel) return;
  if (level !== "enhanced") posthog.stopSessionRecording();
  posthog.set_config({ ...analyticsFeatureConfig(level), before_send: sanitizeBeforeSend });
  if (level === "enhanced") posthog.webVitalsAutocapture?.startIfEnabled();
  appliedLevel = level;
}

function stopAnalytics() {
  clearPendingEvents();
  if (!posthog || !analyticsIsInitialized()) return;
  appliedLevel = null;
  try {
    posthog.stopSessionRecording();
  } catch { /* Consent checks also block capture if the recorder is unavailable. */ }
  try {
    posthog.opt_out_capturing();
  } catch { /* Wrapper-level consent remains authoritative. */ }
}

function registerConsentListeners() {
  if (!hasBrowserEnvironment() || consentListenersRegistered) return;
  consentListenersRegistered = true;
  const sync = () => {
    getAnalyticsConsentStatus();
    window.dispatchEvent(new Event(ANALYTICS_CONSENT_CHANGED_EVENT));
  };
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== ANALYTICS_CONSENT_STORAGE_KEY && event.key !== LEGACY_ANALYTICS_CONSENT_STORAGE_KEY) return;
    sessionLevel = null;
    sync();
  });
  window.addEventListener("focus", sync);
}

export function initializeAnalytics() {
  registerConsentListeners();
  if (
    !isAnalyticsConfigured()
    || !hasBrowserEnvironment()
    || storedAnalyticsConsent() !== "granted"
    || isAnalyticsBlockedByBrowserPrivacySignal()
  ) {
    clearPendingEvents();
    return;
  }
  if (!posthog) {
    if (!sdkLoading) {
      sdkLoading = import("posthog-js")
        .then(({ default: sdk }) => {
          posthog = sdk;
          // Consent or browser privacy signals may change while the chunk loads.
          initializeAnalytics();
        })
        .catch(() => {
          // An unavailable analytics chunk must never interrupt the studio.
          clearPendingEvents();
        })
        .finally(() => { sdkLoading = null; });
    }
    return;
  }
  const global = browserGlobal();
  if (global[ANALYTICS_INITIALIZED_KEY]) {
    try {
      applyAnalyticsLevel();
      if (!posthog.is_capturing()) optInInitializedAnalytics();
    } catch {
      // A stale or unavailable SDK instance stays safely disabled.
    }
    return;
  }
  global[ANALYTICS_INITIALIZED_KEY] = true;

  try {
    posthog.init(POSTHOG_PROJECT_TOKEN, {
      api_host: POSTHOG_PROXY_PATH,
      ui_host: configuredPostHogUiHost(),
      defaults: "2026-05-30",
      person_profiles: "never",
      persistence: "localStorage+cookie",
      cross_subdomain_cookie: false,
      secure_cookie: window.location.protocol === "https:",
      opt_out_capturing_by_default: true,
      opt_out_persistence_by_default: true,
      opt_out_capturing_persistence_type: "localStorage",
      respect_dnt: true,
      ...analyticsFeatureConfig(getAnalyticsLevel()),
      capture_pageview: false,
      capture_pageleave: false,
      ip: false,
      disable_surveys: true,
      disable_conversations: true,
      disable_product_tours: true,
      advanced_disable_feature_flags: true,
      advanced_disable_flags: true,
      logs: { captureConsoleLogs: false, beforeSend: () => null },
      disable_capture_url_hashes: true,
      save_referrer: false,
      save_campaign_params: false,
      mask_personal_data_properties: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      error_tracking: {
        captureExtensionExceptions: false,
        exception_steps: { enabled: false },
      },
      enable_recording_console_log: false,
      session_recording: {
        blockClass: "ph-no-capture",
        blockSelector: ".ph-no-capture, [data-ph-no-capture]",
        maskTextSelector: "*",
        maskAllInputs: true,
        maskAllElementAttributes: true,
        recordCrossOriginIframes: false,
        recordHeaders: false,
        recordBody: false,
        captureJsonLd: false,
        captureCanvas: { recordCanvas: false },
        maskCapturedNetworkRequestFn: sanitizeCapturedNetworkRequest,
      },
      before_send: sanitizeBeforeSend,
      loaded: (instance) => {
        if (
          storedAnalyticsConsent() !== "granted"
          || isAnalyticsBlockedByBrowserPrivacySignal()
        ) {
          clearPendingEvents();
          instance.stopSessionRecording();
          instance.opt_out_capturing();
          return;
        }
        optInInitializedAnalytics();
      },
    });
  } catch {
    global[ANALYTICS_INITIALIZED_KEY] = false;
    appliedLevel = null;
  }
}

export function getAnalyticsConsentStatus(): AnalyticsConsentStatus {
  if (!isAnalyticsConfigured() || !hasBrowserEnvironment()) return "unavailable";
  registerConsentListeners();
  if (isAnalyticsBlockedByBrowserPrivacySignal()) {
    stopAnalytics();
    return "blocked";
  }
  const status = storedAnalyticsConsent();
  if (status === "granted") initializeAnalytics();
  if (status !== "granted") {
    stopAnalytics();
  }
  return status;
}

function isSafeAnalyticsValue(value: unknown): value is AnalyticsPrimitive {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && Number.isSafeInteger(value);
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_ANALYTICS_STRING_LENGTH
    && SAFE_ANALYTICS_STRING.test(value);
}

export function sanitizeEventProperties<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsProperties<E>,
) {
  const source: Record<string, unknown> = isRecord(properties) ? properties : {};
  const sanitized: Record<string, AnalyticsPrimitive> = {};
  for (const key of EVENT_PROPERTY_ALLOWLIST[event] ?? []) {
    const value = source[key];
    if (isSafeAnalyticsValue(value) && (typeof value !== "string" || isApprovedString(key, value))) sanitized[key] = value;
  }
  return sanitized;
}

export function setAnalyticsLevel(level: AnalyticsLevel) {
  clearPendingEvents();
  if (!isAnalyticsConfigured() || !hasBrowserEnvironment()) return false;
  if (isAnalyticsBlockedByBrowserPrivacySignal() && level !== "required") {
    stopAnalytics();
    return false;
  }
  const saved = persistAnalyticsConsent(level);
  if (!saved || level === "required") stopAnalytics();
  else initializeAnalytics();
  window.dispatchEvent(new Event(ANALYTICS_CONSENT_CHANGED_EVENT));
  return saved;
}

export function captureAnalyticsEvent<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsProperties<E>,
) {
  if (!isAnalyticsConfigured() || !hasBrowserEnvironment()) return;
  if (!Object.hasOwn(EVENT_PROPERTY_ALLOWLIST, event)) return;
  const sanitizedProperties = sanitizeEventProperties(event, properties);
  const consentStatus = getAnalyticsConsentStatus();
  if (consentStatus !== "granted") {
    clearPendingEvents();
    return;
  }
  Object.assign(sanitizedProperties, analyticsContext());
  initializeAnalytics();
  if (!posthog || !analyticsIsInitialized() || !posthog.is_capturing()) {
    if (pendingEvents.length < MAX_PENDING_EVENTS) {
      pendingEvents.push({ event, properties: sanitizedProperties });
    }
    return;
  }
  try {
    posthog.capture(event, sanitizedProperties);
  } catch {
    // Product behavior must never depend on analytics availability.
  }
}

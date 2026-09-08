"use client";

import { classifyAcquisition } from "./acquisition.mjs";
import type {
  CapturedNetworkRequest,
  CaptureResult,
  PostHogConfig,
} from "posthog-js";

type AnalyticsPrimitive = string | number | boolean;

type CommonProductProperties = {
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
  return Boolean(POSTHOG_PROJECT_TOKEN && configuredPostHogUiHost());
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

function stripUrlQueryAndHash(value: string) {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const indexes = [queryIndex, hashIndex].filter((index) => index >= 0);
  return indexes.length ? value.slice(0, Math.min(...indexes)) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeNestedUrls(value: unknown, key = "", depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === "string" && /(?:url|href|referrer)$/i.test(key)) {
    return stripUrlQueryAndHash(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNestedUrls(item, key, depth + 1));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([nestedKey, nestedValue]) => [
      nestedKey,
      sanitizeNestedUrls(nestedValue, nestedKey, depth + 1),
    ]),
  );
}

function safeExceptionToken(value: unknown, fallback: string) {
  if (typeof value !== "string" || value.length > MAX_ANALYTICS_STRING_LENGTH) return fallback;
  return /^[a-z0-9_$.[\]<>:/-]+$/i.test(value) ? value : fallback;
}

function sanitizeExceptionFrame(value: unknown) {
  if (!isRecord(value)) return null;
  const frame: Record<string, string | number | boolean> = {};
  if (typeof value.filename === "string") {
    frame.filename = /^(?:data|blob):/i.test(value.filename)
      ? "[redacted]"
      : stripUrlQueryAndHash(value.filename).slice(0, 512);
  }
  if (typeof value.lineno === "number" && Number.isFinite(value.lineno)) frame.lineno = value.lineno;
  if (typeof value.colno === "number" && Number.isFinite(value.colno)) frame.colno = value.colno;
  if (typeof value.in_app === "boolean") frame.in_app = value.in_app;
  return frame;
}

function sanitizeException(value: unknown) {
  if (!isRecord(value)) return null;
  const sanitized: Record<string, unknown> = {
    type: safeExceptionToken(value.type, "Error"),
    value: "[redacted]",
  };
  if (isRecord(value.mechanism)) {
    sanitized.mechanism = {
      type: safeExceptionToken(value.mechanism.type, "generic"),
      handled: typeof value.mechanism.handled === "boolean" ? value.mechanism.handled : false,
      synthetic: typeof value.mechanism.synthetic === "boolean" ? value.mechanism.synthetic : false,
    };
  }
  if (isRecord(value.stacktrace) && Array.isArray(value.stacktrace.frames)) {
    sanitized.stacktrace = {
      frames: value.stacktrace.frames
        .slice(-100)
        .map(sanitizeExceptionFrame)
        .filter((frame) => frame !== null),
    };
  }
  return sanitized;
}

function sanitizeBeforeSend(capture: CaptureResult | null) {
  if (!capture) return null;
  if (storedAnalyticsConsent() !== "granted" || isAnalyticsBlockedByBrowserPrivacySignal()) return null;
  if (
    getAnalyticsLevel() !== "enhanced"
    && !Object.hasOwn(EVENT_PROPERTY_ALLOWLIST, capture.event)
    && capture.event !== "$pageview"
    && capture.event !== "$pageleave"
  ) return null;
  const properties = sanitizeNestedUrls(capture.properties) as CaptureResult["properties"];
  // Keep attribution coarse even if the SDK supplies automatic referral fields.
  for (const key of Object.keys(properties)) {
    if (/referrer|referring_domain|campaign/i.test(key) || /^(?:\$initial_)?(?:utm_|gclid$|dclid$|fbclid$|msclkid$|ttclid$|twclid$)/i.test(key)) delete properties[key];
  }
  delete properties.referral_source;
  delete properties.entry_page;
  if (typeof document !== "undefined") {
    Object.assign(properties, classifyAcquisition(document.referrer, window.location.origin));
  }
  if (capture.event !== "$exception") return { ...capture, properties };

  const exceptionProperties = { ...properties };
  for (const key of Object.keys(exceptionProperties)) {
    if (/exception/i.test(key) && /(message|stack_trace_raw|source|value|error)/i.test(key)) {
      delete exceptionProperties[key];
    }
  }
  const exceptionList = properties.$exception_list;
  exceptionProperties.$exception_list = Array.isArray(exceptionList)
    ? exceptionList.map(sanitizeException).filter((exception) => exception !== null)
    : [];
  return { ...capture, properties: exceptionProperties };
}

function sanitizeCapturedNetworkRequest(data: CapturedNetworkRequest) {
  if (/^(?:data|blob):/i.test(data.name)) return null;
  return {
    ...data,
    name: stripUrlQueryAndHash(data.name),
    requestHeaders: undefined,
    requestBody: undefined,
    responseHeaders: undefined,
    responseBody: undefined,
  };
}

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
    autocapture: enhanced ? {
      capture_copied_text: false,
      css_selector_ignorelist: [".ph-no-capture", "[data-ph-no-capture]", ".ph-no-autocapture", "[data-ph-no-autocapture]"],
    } : false,
    rageclick: enhanced,
    capture_dead_clicks: enhanced ? {
      css_selector_ignorelist: [".ph-no-capture", "[data-ph-no-capture]", ".ph-no-deadclick"],
    } : false,
    capture_heatmaps: enhanced,
    capture_exceptions: enhanced ? {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    } : false,
    capture_performance: enhanced ? {
      network_timing: false,
      web_vitals: true,
      web_vitals_attribution: false,
    } : false,
    disable_session_recording: !enhanced,
  };
}

function applyAnalyticsLevel() {
  if (!posthog) return;
  const level = getAnalyticsLevel();
  if (level === appliedLevel) return;
  if (level !== "enhanced") posthog.stopSessionRecording();
  posthog.set_config({ ...analyticsFeatureConfig(level), before_send: sanitizeBeforeSend });
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
      capture_pageview: { path: true, search: false, hash: false },
      capture_pageleave: true,
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
  for (const key of EVENT_PROPERTY_ALLOWLIST[event]) {
    const value = source[key];
    if (isSafeAnalyticsValue(value)) sanitized[key] = value;
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
  const sanitizedProperties = sanitizeEventProperties(event, properties);
  const consentStatus = getAnalyticsConsentStatus();
  if (consentStatus !== "granted") {
    clearPendingEvents();
    return;
  }
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

// Downloaded editors have no telemetry SDK, identifiers, or consent UI.
export const captureAnalyticsEvent = () => {};
export const getAnalyticsConsentStatus = () => "unavailable";
export const isAnalyticsConfigured = () => false;
export const initializeAnalytics = () => {};
export const ANALYTICS_CONSENT_CHANGED_EVENT = "pixelwall:analytics-consent-changed";

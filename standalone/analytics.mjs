// Downloaded editors have no telemetry SDK, identifiers, or consent UI.
export const captureAnalyticsEvent = () => {};
export const captureAnonymousExportOutcome = () => {};
export const captureAnonymousCreation = () => {};
export const captureAnonymousAutomationEdit = () => {};
export const captureAnonymousAutomationOperation = () => {};
export const captureAnonymousCheckoutStart = () => {};
export const isAnonymousTrafficEnabled = () => false;
export const getAnalyticsConsentStatus = () => "unavailable";
export const isAnalyticsConfigured = () => false;
export const initializeAnalytics = () => {};
export const ANALYTICS_CONSENT_CHANGED_EVENT = "pixelwall:analytics-consent-changed";

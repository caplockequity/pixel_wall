import { initializeAnalytics, isAnalyticsConfigured } from "./app/analytics";

if (isAnalyticsConfigured()) {
  initializeAnalytics();
}

"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import release from "../public/desktop/latest.json";
import {
  ANALYTICS_CONSENT_CHANGED_EVENT,
  captureAnalyticsEvent,
  getAnalyticsConsentStatus,
  isAnalyticsConfigured,
} from "./analytics";
import { AnalyticsConsent } from "./analytics-consent";
import { publicLinkEvent, sitePageGroup } from "./site-analytics-core.mjs";

export function AnalyticsSurface() {
  const pathname = usePathname();
  const lastPage = useRef<string | null>(null);

  useEffect(() => {
    if (!isAnalyticsConfigured()) return;
    function captureCurrentPage() {
      if (getAnalyticsConsentStatus() !== "granted") {
        lastPage.current = null;
        return;
      }
      if (!pathname || lastPage.current === pathname) return;
      lastPage.current = pathname;
      captureAnalyticsEvent("site_page_viewed", { page_group: sitePageGroup(pathname) });
    }
    captureCurrentPage();
    window.addEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, captureCurrentPage);
    return () => window.removeEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, captureCurrentPage);
  }, [pathname]);

  useEffect(() => {
    if (!isAnalyticsConfigured()) return;
    function capturePublicLink(event: MouseEvent) {
      if (event.defaultPrevented || event.button > 0 || getAnalyticsConsentStatus() !== "granted") return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link?.closest(".public-site") || link.closest(".ph-no-capture, [data-ph-no-capture]")) return;
      const match = publicLinkEvent(link.getAttribute("href"), window.location.origin, release);
      if (!match) return;
      if (match.event === "desktop_download_clicked") {
        captureAnalyticsEvent("desktop_download_clicked", match.properties);
      } else {
        const placement = link.closest(".site-header") ? "header"
          : link.closest(".site-footer") ? "footer" : "content";
        captureAnalyticsEvent("site_cta_clicked", { ...match.properties, placement });
      }
    }
    document.addEventListener("click", capturePublicLink);
    return () => document.removeEventListener("click", capturePublicLink);
  }, []);

  return <AnalyticsConsent />;
}

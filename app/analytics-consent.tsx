"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  captureAnalyticsEvent,
  denyAnalyticsConsent,
  getAnalyticsConsentStatus,
  grantAnalyticsConsent,
  isAnalyticsBlockedByBrowserPrivacySignal,
  isAnalyticsConfigured,
  type AnalyticsConsentStatus,
} from "./analytics";

const settingsButtonStyle: CSSProperties = {
  position: "fixed",
  right: 12,
  bottom: 12,
  zIndex: 900,
  border: "2px solid #171628",
  borderRadius: 6,
  background: "#f8f0df",
  color: "#171628",
  boxShadow: "3px 3px 0 #171628",
  cursor: "pointer",
  font: "700 11px/1.2 var(--font-geist-mono), monospace",
  letterSpacing: "0.04em",
  padding: "8px 10px",
};

const dialogStyle: CSSProperties = {
  width: "min(420px, calc(100vw - 32px))",
  maxWidth: "calc(100vw - 32px)",
  margin: "auto",
  border: "3px solid #171628",
  borderRadius: 8,
  background: "#f8f0df",
  color: "#171628",
  boxShadow: "7px 7px 0 #171628",
  padding: 0,
};

const actionStyle: CSSProperties = {
  border: "2px solid #171628",
  borderRadius: 5,
  background: "#ffe66d",
  color: "#171628",
  cursor: "pointer",
  font: "800 12px/1.2 var(--font-geist-mono), monospace",
  padding: "9px 12px",
};

type AnalyticsConsentProps = {
  onInitialPromptClosed?: () => void;
};

function consentLabel(status: AnalyticsConsentStatus) {
  if (status === "granted") return "Analytics: on";
  if (status === "blocked") return "Analytics: browser blocked";
  if (status === "pending") return "Analytics: choose";
  return "Analytics: off";
}

export function AnalyticsConsent({ onInitialPromptClosed }: AnalyticsConsentProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const sourceRef = useRef("initial_prompt");
  const initialPromptClosed = useRef(false);
  const [status, setStatus] = useState<AnalyticsConsentStatus>("unavailable");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const syncStatus = () => {
      const nextStatus = getAnalyticsConsentStatus();
      setStatus(nextStatus);
      if (nextStatus === "pending") {
        sourceRef.current = "initial_prompt";
        setOpen(true);
      }
    };
    syncStatus();
    window.addEventListener("storage", syncStatus);
    return () => window.removeEventListener("storage", syncStatus);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => firstActionRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  if (!isAnalyticsConfigured()) return null;

  const privacySignalEnabled = status === "blocked" || isAnalyticsBlockedByBrowserPrivacySignal();

  function closeDialog() {
    const shouldNotify = sourceRef.current === "initial_prompt" && !initialPromptClosed.current;
    if (shouldNotify) initialPromptClosed.current = true;
    setOpen(false);
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
    if (shouldNotify) window.setTimeout(() => onInitialPromptClosed?.(), 0);
  }

  function allowAnalytics() {
    grantAnalyticsConsent();
    const nextStatus = getAnalyticsConsentStatus();
    setStatus(nextStatus);
    if (nextStatus === "granted") {
      captureAnalyticsEvent("analytics_consent_updated", {
        choice: "granted",
        source: sourceRef.current,
      });
    }
    closeDialog();
  }

  function turnOffAnalytics() {
    denyAnalyticsConsent();
    setStatus(getAnalyticsConsentStatus());
    closeDialog();
  }

  return (
    <div className="analytics-consent ph-no-capture">
      <button
        ref={settingsButtonRef}
        type="button"
        className="analytics-consent-settings"
        style={settingsButtonStyle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="analytics-consent-dialog"
        onClick={() => {
          sourceRef.current = "privacy_settings";
          setStatus(getAnalyticsConsentStatus());
          setOpen(true);
        }}
      >
        {consentLabel(status)}
      </button>

      <dialog
        ref={dialogRef}
        id="analytics-consent-dialog"
        className="analytics-consent-dialog ph-no-capture"
        style={dialogStyle}
        aria-labelledby="analytics-consent-title"
        aria-describedby="analytics-consent-description"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClose={() => setOpen(false)}
      >
        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <span style={{ font: "800 10px/1.2 var(--font-geist-mono), monospace", letterSpacing: "0.12em" }}>
                PRIVACY
              </span>
              <h2 id="analytics-consent-title" style={{ fontSize: 22, margin: "4px 0 10px" }}>
                Anonymous analytics
              </h2>
            </div>
            <button type="button" style={{ ...actionStyle, background: "transparent", padding: "4px 8px" }} aria-label="Close analytics settings" onClick={closeDialog}>
              ×
            </button>
          </div>

          <p id="analytics-consent-description" style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 14px" }}>
            {privacySignalEnabled
              ? "Your browser’s Global Privacy Control or Do Not Track setting is blocking analytics. PixelWall will honor that choice."
              : "Allow anonymous product usage, performance, error, heatmap, and replay data to help improve PixelWall. Artwork, names, file contents, input values, and replay text are excluded."}
          </p>
          <p style={{ fontSize: 12, lineHeight: 1.45, margin: "0 0 18px", opacity: 0.8 }}>
            PostHog stores an anonymous device and session identifier only after you allow it. PixelWall never creates analytics person profiles. You can change this setting anytime.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
            {status === "granted" ? (
              <button ref={firstActionRef} type="button" style={{ ...actionStyle, background: "#ff8b78" }} onClick={turnOffAnalytics}>
                Turn off analytics
              </button>
            ) : privacySignalEnabled ? (
              <button ref={firstActionRef} type="button" style={actionStyle} onClick={closeDialog}>
                Done
              </button>
            ) : (
              <>
                <button ref={firstActionRef} type="button" style={actionStyle} onClick={allowAnalytics}>
                  Allow analytics
                </button>
                <button type="button" style={{ ...actionStyle, background: "transparent" }} onClick={turnOffAnalytics}>
                  Keep analytics off
                </button>
              </>
            )}
            {status === "granted" ? (
              <button type="button" style={{ ...actionStyle, background: "transparent" }} onClick={closeDialog}>
                Keep analytics on
              </button>
            ) : null}
          </div>
        </div>
      </dialog>
    </div>
  );
}

export default AnalyticsConsent;

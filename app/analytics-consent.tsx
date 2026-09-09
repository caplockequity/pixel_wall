"use client";

import Link from "next/link";

import { useEffect, useRef, useState } from "react";
import {
  ANALYTICS_CONSENT_CHANGED_EVENT,
  captureAnalyticsEvent,
  getAnalyticsConsentStatus,
  getAnalyticsLevel,
  isAnalyticsConfigured,
  setAnalyticsLevel,
  type AnalyticsConsentStatus,
  type AnalyticsLevel,
} from "./analytics";

const PRIVACY_CHOICES = [
  {
    value: "required",
    title: "Required only",
    badge: "DEFAULT",
    description: "Keep artwork, preferences and your privacy choice on this device. No optional analytics.",
  },
  {
    value: "usage",
    title: "Usage analytics",
    badge: "OPTIONAL",
    description: "Share page categories, features used, download clicks, export and Pro results, and basic browser/device details with PostHog.",
  },
  {
    value: "enhanced",
    title: "Enhanced diagnostics",
    badge: "OPTIONAL",
    description: "Include usage analytics plus performance measurements and scrubbed error reports to help us fix problems.",
  },
] as const;

export function AnalyticsConsent() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const sourceRef = useRef("initial_prompt");
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<AnalyticsConsentStatus>("unavailable");
  const [level, setLevel] = useState<AnalyticsLevel>("required");
  const [selection, setSelection] = useState<AnalyticsLevel>("required");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const syncStatus = () => {
      setStatus(getAnalyticsConsentStatus());
      const nextLevel = getAnalyticsLevel();
      setLevel(nextLevel);
      setSelection(nextLevel);
      setReady(true);
    };
    syncStatus();
    window.addEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, syncStatus);
    return () => window.removeEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, syncStatus);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => headingRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Keep the server and first client render identical; runtime configuration
  // excludes private previews, local development and downloaded builds.
  if (!ready || !isAnalyticsConfigured()) return null;

  const browserBlocked = status === "blocked";
  const showBanner = status === "pending";

  function closeDialog() {
    setOpen(false);
    window.requestAnimationFrame(() => {
      const target = returnFocusRef.current;
      if (target?.isConnected) target.focus();
      else settingsButtonRef.current?.focus();
    });
  }

  function openPreferences(source: string) {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sourceRef.current = source;
    setStatus(getAnalyticsConsentStatus());
    setSelection(getAnalyticsLevel());
    setError("");
    setOpen(true);
  }

  function saveChoice(choice: AnalyticsLevel) {
    if (!setAnalyticsLevel(choice)) {
      const nextStatus = getAnalyticsConsentStatus();
      setStatus(nextStatus);
      setLevel(getAnalyticsLevel());
      setError(nextStatus === "blocked"
        ? "Your browser’s privacy signal keeps optional analytics disabled. You can use Required only."
        : "We couldn’t save your choice. Optional analytics are disabled for this visit. Check your browser’s storage settings and try again.");
      if (!open) setOpen(true);
      return;
    }
    if (choice !== "required") {
      captureAnalyticsEvent("analytics_consent_updated", { choice, source: sourceRef.current });
    }
    setError("");
    closeDialog();
  }

  return (
    <div className="analytics-consent ph-no-capture">
      {showBanner ? <aside className="privacy-banner" aria-label="Privacy choices">
        <div><strong>Your privacy</strong><p>Optional analytics are off. You can share usage to help improve PixelWall. Your artwork stays on your device.</p></div>
        <div className="privacy-banner-actions">
          <button type="button" onClick={() => { sourceRef.current = "initial_prompt"; saveChoice("required"); }}>Required only</button>
          <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-controls="analytics-consent-dialog" onClick={() => openPreferences("initial_prompt")}>Choose what to share</button>
        </div>
        {error && !open && <p className="privacy-message" role="alert">{error}</p>}
      </aside> : <button
        ref={settingsButtonRef}
        type="button"
        className="analytics-consent-settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="analytics-consent-dialog"
        aria-label={`Privacy preferences: ${level === "enhanced" ? "Enhanced diagnostics" : level === "usage" ? "Usage analytics" : "Required only"}`}
        onClick={() => openPreferences("privacy_settings")}
      >Privacy preferences</button>}
      <dialog
        ref={dialogRef}
        id="analytics-consent-dialog"
        className="analytics-consent-dialog ph-no-capture"
        aria-labelledby="analytics-consent-title"
        aria-describedby="analytics-consent-description"
        onCancel={(event) => { event.preventDefault(); closeDialog(); }}
        onClose={() => setOpen(false)}
      >
        <div className="privacy-card">
          <div className="privacy-heading">
            <div>
              <span className="privacy-kicker">YOUR CHOICE</span>
              <h2 ref={headingRef} tabIndex={-1} id="analytics-consent-title">Privacy preferences</h2>
            </div>
            <button type="button" className="privacy-close" aria-label="Close privacy preferences" onClick={closeDialog}>×</button>
          </div>
          <p id="analytics-consent-description">Drawing, autosave and exports work with every choice. Choose how much optional information you share to help improve PixelWall.</p>
          {browserBlocked && <p className="privacy-message" role="status">Your browser’s Do Not Track or Global Privacy Control signal keeps optional analytics disabled.</p>}
          <fieldset className="privacy-choices">
            <legend className="visually-hidden">Choose a privacy level</legend>
            {PRIVACY_CHOICES.map((choice) => (
              <label key={choice.value} htmlFor={`privacy-level-${choice.value}`} aria-label={choice.title} className={`privacy-choice ${selection === choice.value ? "selected" : ""}`}>
                <input
                  id={`privacy-level-${choice.value}`}
                  type="radio"
                  name="privacy-level"
                  value={choice.value}
                  checked={selection === choice.value}
                  disabled={browserBlocked && choice.value !== "required"}
                  aria-describedby={`privacy-description-${choice.value}`}
                  onChange={() => { setSelection(choice.value); setError(""); }}
                />
                <span>
                  <span className="privacy-choice-heading"><strong>{choice.title}</strong><small>{choice.badge}</small></span>
                  <span id={`privacy-description-${choice.value}`} className="privacy-choice-description">{choice.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="privacy-detail">Optional analytics use a stored browser ID for repeat visits. No session recordings. Artwork, files, names, license codes, scripts and full URLs are excluded. Change your choice anytime. <Link href="/privacy" target="_blank" rel="noopener noreferrer" prefetch={false}>Read our privacy policy</Link>.</p>
          {error && <p className="privacy-message" role="alert">{error}</p>}
          <div className="privacy-actions">
            <button type="button" onClick={() => saveChoice("required")}>Use required only</button>
            <button type="button" onClick={() => saveChoice(selection)}>Save preferences</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

export default AnalyticsConsent;

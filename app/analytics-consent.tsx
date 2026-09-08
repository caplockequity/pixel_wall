"use client";

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
    description: "Keep artwork, preferences and your privacy choice in this browser. No optional analytics or session recordings.",
  },
  {
    value: "usage",
    title: "Usage analytics",
    badge: "OPTIONAL",
    description: "Also share which features are used, export results, and browser/device details with PostHog. No session recordings.",
  },
  {
    value: "enhanced",
    title: "Enhanced diagnostics",
    badge: "OPTIONAL",
    description: "Include usage analytics plus masked session recordings, interaction patterns, and performance and error reports to help us fix problems.",
  },
] as const;

type AnalyticsConsentProps = {
  onInitialPromptClosed?: () => void;
};

export function AnalyticsConsent({ onInitialPromptClosed }: AnalyticsConsentProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sourceRef = useRef("initial_prompt");
  const initialPromptClosed = useRef(false);
  const initialPromptShown = useRef(false);
  const [status, setStatus] = useState<AnalyticsConsentStatus>("unavailable");
  const [level, setLevel] = useState<AnalyticsLevel>("required");
  const [selection, setSelection] = useState<AnalyticsLevel>("required");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const syncStatus = () => {
      const nextStatus = getAnalyticsConsentStatus();
      const nextLevel = getAnalyticsLevel();
      setStatus(nextStatus);
      setLevel(nextLevel);
      setSelection(nextLevel);
      if (nextStatus === "pending" && !initialPromptShown.current) {
        initialPromptShown.current = true;
        sourceRef.current = "initial_prompt";
        setOpen(true);
      }
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

  if (!isAnalyticsConfigured()) return null;

  const browserBlocked = status === "blocked";
  const currentLabel = status === "pending" ? "Privacy choices"
    : level === "enhanced" ? "Privacy: Enhanced"
      : level === "usage" ? "Privacy: Usage"
        : "Privacy: Required only";

  function closeDialog() {
    const shouldNotify = sourceRef.current === "initial_prompt" && !initialPromptClosed.current;
    if (shouldNotify) initialPromptClosed.current = true;
    setOpen(false);
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
    if (shouldNotify) window.setTimeout(() => onInitialPromptClosed?.(), 0);
  }

  function saveChoice(choice: AnalyticsLevel) {
    if (!setAnalyticsLevel(choice)) {
      const nextStatus = getAnalyticsConsentStatus();
      setStatus(nextStatus);
      setLevel(getAnalyticsLevel());
      setError(nextStatus === "blocked"
        ? "Your browser’s privacy signal keeps optional analytics disabled. You can use Required only."
        : "We couldn’t save your choice. Optional analytics are disabled for this visit. Check your browser’s storage settings and try again.");
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
      <button
        ref={settingsButtonRef}
        type="button"
        className="analytics-consent-settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="analytics-consent-dialog"
        onClick={() => {
          sourceRef.current = "privacy_settings";
          setStatus(getAnalyticsConsentStatus());
          setSelection(getAnalyticsLevel());
          setError("");
          setOpen(true);
        }}
      >
        {currentLabel}
      </button>
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
          <p className="privacy-detail">Optional analytics use a stored browser ID to recognize repeat visits. Artwork and imported files are excluded; names, text and input values are masked. Change your choice here anytime.</p>
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

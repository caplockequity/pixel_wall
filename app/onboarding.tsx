"use client";

import { useEffect, useRef, useState } from "react";

const GUIDE_ITEMS = [
  ["CANVAS", "Pick a tool. Draw."],
  ["LAYERS", "Top covers bottom."],
  ["FRAMES", "One picture each. Press play."],
  ["TILEMAP", "Pick a frame. Paint."],
  ["FILES", "Autosaves in this browser. Save Project downloads a full .pixelwall file. Open Project loads it."],
  ["EXPORT", "PNG or ZIP."],
] as const;

type HelpTipProps = {
  id: string;
  label: string;
  text: string;
};

export function HelpTip({ id, label, text }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnOutsideFocus(event: FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("focusin", closeOnOutsideFocus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("focusin", closeOnOutsideFocus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="help-tip">
      <button
        ref={buttonRef}
        type="button"
        className="help-tip-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">?</span>
      </button>
      <span id={id} className="help-tip-popover" role="tooltip" hidden={!open}>
        {text}
      </span>
    </span>
  );
}

type OnboardingGuideProps = {
  open: boolean;
  onDismiss: (method: "got_it" | "escape") => void;
};

export function OnboardingGuide({ open, onDismiss }: OnboardingGuideProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

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

  return (
    <dialog
      ref={dialogRef}
      className="quick-guide"
      aria-labelledby="quick-guide-title"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss("escape");
      }}
    >
      <div className="quick-guide-card">
        <span className="quick-guide-kicker">PIXELWALL</span>
        <h2 ref={headingRef} id="quick-guide-title" tabIndex={-1}>QUICK START</h2>
        <ul className="quick-guide-list">
          {GUIDE_ITEMS.map(([title, text]) => (
            <li key={title}>
              <strong>{title}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="quick-guide-done" onClick={() => onDismiss("got_it")}>GOT IT</button>
      </div>
    </dialog>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

const GUIDE_ITEMS = [
  { target: "draw", title: "01 · Draw a sprite", text: "Choose a color and draw on the canvas. P selects the pencil, E erases, and F fills an area. Undo lets you try things freely.", action: "Show canvas" },
  { target: "reference", title: "02 · Trace a reference", text: "Open Reference and upload an image. Adjust its opacity, then draw over it. The reference stays out of your exported artwork.", action: "Open reference" },
  { target: "animate", title: "03 · Make it move", text: "Duplicate a frame, change a few pixels, and turn on Onion to see the previous frame. Press Play. Name clips to organize movements such as idle and walk.", action: "Show animation" },
  { target: "tilemap", title: "04 · Build a level", text: "Each frame can be a tile. Choose one in the timeline, then paint with it in Tilemap Lab. Seam Check helps you spot gaps between repeating tiles.", action: "Show tilemap" },
  { target: "export", title: "05 · Share or use in a game", text: "Download a PNG for one sprite, a GIF for an animation, or a sprite sheet. Game packages include the images and data your engine needs.", action: "Show exports" },
] as const;

export type GuideTarget = typeof GUIDE_ITEMS[number]["target"] | "layers";

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
  onExplore: (target: GuideTarget) => void;
};

export function OnboardingGuide({ open, onDismiss, onExplore }: OnboardingGuideProps) {
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
        <button className="guide-close" type="button" aria-label="Close quick guide" onClick={() => onDismiss("got_it")}>×</button>
        <span className="quick-guide-kicker">PIXELWALL</span>
        <h2 ref={headingRef} id="quick-guide-title" tabIndex={-1}>QUICK START</h2>
        <p className="guide-intro">From your first pixel to a playable sprite. Try any step, then reopen Guide whenever you need it.</p>
        <ul className="quick-guide-list">
          {GUIDE_ITEMS.map(({ target, title, text, action }) => (
            <li key={target}>
              <strong>{title}</strong>
              <span>{text}</span>
              <button type="button" onClick={() => onExplore(target)}>{action} <span aria-hidden="true">↗</span></button>
            </li>
          ))}
        </ul>
        <p className="guide-save-note"><strong>Keep a backup.</strong> Autosave lives in this browser. Save Project downloads a complete .pixelwall file, including your reference, that you can open again on another device.</p>
        <button type="button" className="quick-guide-done" onClick={() => onDismiss("got_it")}>GOT IT</button>
      </div>
    </dialog>
  );
}

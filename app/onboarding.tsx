"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GUIDE_ITEMS = [
  { target: "draw", title: "01 · Draw a sprite", text: "Choose a color and draw. P selects the pencil, E erases, and F fills. Use + / − to zoom, Hand (H) to drag the view, and Fit (0) to see the whole canvas. Undo lets you try things freely.", action: "Show canvas" },
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
  const popoverRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!button || !popover) return;
    const viewport = window.visualViewport;

    function placeTip() {
      if (!button || !popover) return;
      const margin = 12;
      const gap = 7;
      const leftEdge = (viewport?.offsetLeft ?? 0) + margin;
      const topEdge = (viewport?.offsetTop ?? 0) + margin;
      const rightEdge = leftEdge + (viewport?.width ?? document.documentElement.clientWidth) - margin * 2;
      const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - margin * 2;
      const anchor = button.getBoundingClientRect();

      // The portal escapes the studio's clipped containers; these bounds also
      // keep it inside the visible viewport during scrolling and pinch zoom.
      popover.style.maxWidth = `${Math.max(1, rightEdge - leftEdge)}px`;
      const below = Math.max(0, bottomEdge - anchor.bottom - gap);
      const above = Math.max(0, anchor.top - gap - topEdge);
      const fullHeight = popover.scrollHeight + popover.offsetHeight - popover.clientHeight;
      const openAbove = fullHeight > below && above > below;
      popover.style.maxHeight = `${Math.max(1, openAbove ? above : below)}px`;
      const tip = popover.getBoundingClientRect();
      const left = Math.max(leftEdge, Math.min(anchor.left, rightEdge - tip.width));
      const preferredTop = openAbove ? anchor.top - gap - tip.height : anchor.bottom + gap;
      const top = Math.max(topEdge, Math.min(preferredTop, bottomEdge - tip.height));
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.style.visibility = anchor.bottom < topEdge || anchor.top > bottomEdge || anchor.right < leftEdge || anchor.left > rightEdge ? "hidden" : "visible";
    }

    placeTip();
    const observer = new ResizeObserver(placeTip);
    observer.observe(button);
    observer.observe(popover);
    window.addEventListener("resize", placeTip);
    window.addEventListener("scroll", placeTip, true);
    viewport?.addEventListener("resize", placeTip);
    viewport?.addEventListener("scroll", placeTip);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", placeTip);
      window.removeEventListener("scroll", placeTip, true);
      viewport?.removeEventListener("resize", placeTip);
      viewport?.removeEventListener("scroll", placeTip);
    };
  }, [open, text]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node) && !popoverRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnOutsideFocus(event: FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node) && !popoverRef.current?.contains(event.target as Node)) setOpen(false);
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
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && createPortal(
        <span ref={popoverRef} id={id} className="help-tip-popover" role="tooltip">
          {text}
        </span>,
        document.body,
      )}
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
        <div className="guide-save-note">
          <strong>How saving works</strong>
          <p><strong>Autosave</strong> keeps your edits in this browser as you work. Clearing browser data can remove them.</p>
          <p><strong>Save Project</strong> downloads an editable .pixelwall backup, including your reference image. Open it again here or on another device.</p>
          <p><strong>Export</strong> downloads your artwork as PNG, GIF, or a game package.</p>
        </div>
        <button type="button" className="quick-guide-done" onClick={() => onDismiss("got_it")}>GOT IT</button>
      </div>
    </dialog>
  );
}

"use client";

import { useState, type ComponentType } from "react";
import { captureHomepageDemoEvent } from "./analytics";

export function HomepageDemo() {
  const [Editor, setEditor] = useState<ComponentType | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function openDemo() {
    setLoading(true); setFailed(false);
    try {
      const editorModule = await import("./homepage-demo-editor");
      setEditor(() => editorModule.default);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }

  return <section className="hero-art homepage-demo" aria-label="Try the tiny pixel editor">
    <div className="art-label"><span>{Editor ? "TINY EDITOR · CLASSIC TOOLS" : "DESERT SIGNAL"}</span><span>16 × 16 PX</span></div>
    {Editor ? <Editor /> : <>
      {/* Shared starter artwork; editing code loads only after the visitor clicks. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/examples/desert-signal.png" width="16" height="16" alt="Pixel-art sunset over coral, violet, and teal mountains, ready for you to edit" fetchPriority="high" />
      <div className="demo-invitation">
        <button className="site-button small" type="button" onClick={openDemo} disabled={loading}>{loading ? "Opening…" : failed ? "Try loading the editor again" : "Try the tiny editor"}<span aria-hidden="true">✎</span></button>
        <p>Change a few pixels. Make it yours.</p>
        {failed && <p role="alert">The editor couldn’t load. Try again, or open the full editor below.</p>}
      </div>
    </>}
    <div className="demo-full-editor"><p>This is just a small taste of PixelWall.</p><a href="/editor" target="_blank" rel="noopener" onClick={() => captureHomepageDemoEvent("full_editor_clicked")}>Open the full editor ↗</a><p>For layers, animation, tracing, and more. Opens in a new tab.</p></div>
  </section>;
}

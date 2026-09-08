"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Sparkles, Check, Download } from "lucide-react";

type BillingReply = { pro?: boolean; checkoutAvailable?: boolean; mode?: "test" | "live"; url?: string; recoveryCode?: string; reason?: string };
class PurchaseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function billing(action: string, payload?: object): Promise<BillingReply> {
  const result = await fetch(`/api/billing/${action}`, {
    method: action === "status" ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await result.json();
  if (!result.ok) throw new PurchaseError(data.error || "We couldn’t verify your purchase. Please try again.", result.status);
  return data;
}
function clearCheckoutReturn() {
  const url = new URL(window.location.href);
  url.searchParams.delete("checkout"); url.searchParams.delete("session_id");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export function useProAccess() {
  const [status, setStatus] = useState<BillingReply>({ pro: false, checkoutAvailable: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [sessionId, setSessionId] = useState("");
  const working = useRef(false);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    const version = revision.current;
    try {
      const next = await billing("status");
      if (version === revision.current) {
        setStatus(next);
        if (next.reason) setRecoveryCode("");
        if (next.reason === "refunded") setMessage("This purchase was refunded. Pro access is no longer active.");
        if (next.reason === "disputed") setMessage("Pro access is paused while the payment dispute is reviewed.");
      }
    } catch { /* A temporary outage never silently removes an existing purchase. */ }
  }, []);

  const run = useCallback(async (operation: () => Promise<void>) => {
    if (working.current) return false;
    working.current = true;
    revision.current++;
    setBusy(true); setMessage("");
    try { await operation(); return true; }
    catch (error) {
      setMessage(error instanceof PurchaseError || error instanceof Error && error.name === "ProjectSaveError"
        ? error.message : "We couldn’t connect. Please try again; don’t start another payment if you already paid.");
      if (error instanceof PurchaseError && [402, 403, 404].includes(error.status)) {
        setStatus((current) => ({ ...current, pro: false })); setRecoveryCode("");
      }
      return false;
    } finally { working.current = false; setBusy(false); }
  }, []);

  const claim = useCallback(async (id: string) => run(async () => {
    const data = await billing("claim", { sessionId: id });
    setStatus((current) => ({ ...current, pro: true }));
    setRecoveryCode(data.recoveryCode ?? ""); setSessionId("");
    clearCheckoutReturn();
    setMessage("Pro is ready. Save your recovery code before closing this window.");
  }), [run]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      const outcome = url.searchParams.get("checkout");
      const id = url.searchParams.get("session_id");
      if (outcome) {
        setOpen(true);
        if (outcome === "success" && id) { setSessionId(id); void claim(id).then(refresh); }
        else { clearCheckoutReturn(); setMessage("Checkout closed. Your free tools are ready whenever you are."); void refresh(); }
      } else void refresh();
    }, 0);
    const onFocus = () => { if (!working.current) void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", onFocus); };
  }, [claim, refresh]);

  function show() { setOpen(true); void refresh(); }
  async function requestAccess() {
    const allowed = await run(async () => { await billing("authorize"); setStatus((current) => ({ ...current, pro: true })); });
    if (!allowed) setOpen(true);
    return allowed;
  }
  async function checkout(beforeLeave: () => void) {
    await run(async () => {
      const data = await billing("checkout");
      if (data.pro) { setStatus((current) => ({ ...current, pro: true })); return; }
      if (!data.url || new URL(data.url).origin !== "https://checkout.stripe.com") throw new Error("Invalid checkout URL");
      beforeLeave();
      window.location.assign(data.url);
    });
  }
  async function restore(code: string) {
    await run(async () => {
      await billing("restore", { code });
      setStatus((current) => ({ ...current, pro: true })); setSessionId(""); clearCheckoutReturn(); setMessage("Pro restored in this browser.");
    });
  }
  async function getRecovery() {
    await run(async () => { const data = await billing("recovery"); setRecoveryCode(data.recoveryCode ?? ""); });
  }
  return { ...status, open, busy, message, recoveryCode, sessionId, show, close: () => setOpen(false), requestAccess, checkout, restore, getRecovery, retryClaim: () => claim(sessionId) };
}

type ProAccess = ReturnType<typeof useProAccess>;
export function ProDialog({ access, beforeCheckout }: { access: ProAccess; beforeCheckout: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    if (access.open && !dialog.current?.open) { dialog.current?.showModal(); heading.current?.focus(); }
    else if (!access.open && dialog.current?.open) dialog.current.close();
  }, [access.open]);
  function downloadRecovery() {
    const content = `PixelWall Pro — private recovery code\n\n${access.recoveryCode}\n\nKeep this file private. Anyone with this code can use your purchase.\nTo restore: open PixelWall, choose Pro, then Restore purchase.\nStore: ${window.location.origin}\nMode: ${access.mode ?? "unknown"}\nSupport: contact@caplock.ai\nThis code restores Pro access, not your artwork. Use Save Project to back up artwork.\n`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const link = document.createElement("a"); link.href = url; link.download = "pixelwall-pro-recovery.txt"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <dialog ref={dialog} className="pro-dialog ph-no-capture" aria-labelledby="pro-title" onCancel={access.close} onClose={access.close}>
    <button type="button" className="pro-close" aria-label="Close Pro details" onClick={access.close}><X size={20} /></button>
    <p className="pro-eyebrow"><Sparkles size={15} /> PIXELWALL PRO</p>
    <h2 id="pro-title" ref={heading} tabIndex={-1}>{access.pro ? "Your next frame is ready." : "Make art. Ship the whole thing."}</h2>
    {access.mode === "test" && <p className="pro-test">TEST MODE · Purchases here don’t unlock the live store. No real payment is collected.</p>}
    {access.pro ? <>
      <p className="pro-active"><Check size={18} /> Pro is active in this browser</p>
      <p>GIFs, sprite sheets, game packages, and saved export presets are unlocked.</p>
      {!access.recoveryCode && <button type="button" className="pro-primary" disabled={access.busy} onClick={access.getRecovery}>GET MY RECOVERY CODE</button>}
    </> : <>
      <p>Keep the studio free. Pay once for the exports that take your work further.</p>
      <div className="pro-plans">
        <section><h3>Free, always</h3><ul><li>Drawing, layers &amp; reference images</li><li>Animation editing &amp; Tilemap Lab</li><li>Individual frame PNG exports</li><li>Browser autosave &amp; Save/Open Project</li></ul></section>
        <section className="pro-plan-paid"><h3>Pro <span>$19 <small>USD once</small></span></h3><ul><li>Animated GIF exports</li><li>Sprite-sheet PNG exports</li><li>Sprite &amp; Tiled tilemap ZIP packages</li><li>Named export presets</li></ul></section>
      </div>
      <p className="pro-fine">One payment. No subscription. Permanent access to the Pro features listed here while PixelWall is available. Taxes may apply.</p>
      <button type="button" className="pro-primary" disabled={access.busy || !access.checkoutAvailable || Boolean(access.sessionId)} onClick={() => access.checkout(beforeCheckout)}>{access.busy ? "CONNECTING…" : access.checkoutAvailable ? "GET PRO — $19 ONCE" : "CHECKOUT COMING SOON"}</button>
      <p className="pro-fine">{access.checkoutAvailable ? "Secure checkout with Stripe. Your project stays in this browser during checkout." : "The free studio is ready. Pro checkout is still being connected."}</p>
    </>}
    {access.message && <p className="pro-message" role="status">{access.message}</p>}
    {access.sessionId && <button type="button" className="pro-secondary" disabled={access.busy} onClick={access.retryClaim}>CHECK MY PAYMENT AGAIN</button>}
    {access.recoveryCode && <div className="pro-recovery"><h3>Keep your Pro recovery code</h3><p>Use it on another browser or device. This private code restores your purchase; save your artwork separately.</p><textarea aria-label="Private Pro recovery code" readOnly value={access.recoveryCode} rows={3} /><button type="button" className="pro-primary" onClick={downloadRecovery}><Download size={16} /> SAVE RECOVERY CODE</button></div>}
    {!access.pro && <details className="pro-restore"><summary>Already paid? Restore purchase</summary><form onSubmit={(event) => { event.preventDefault(); void access.restore(code); }}><label>Private recovery code<textarea value={code} onChange={(event) => setCode(event.target.value)} placeholder="PW1.…" autoComplete="off" spellCheck={false} rows={3} maxLength={400} required /></label><button type="submit" className="pro-secondary" disabled={access.busy || !code.trim()}>RESTORE PRO</button></form></details>}
    <p className="pro-fine">Need help with a purchase or refund? <a href="mailto:contact@caplock.ai">contact@caplock.ai</a>. If you lost your code, include your Stripe receipt number. Never send card details.</p>
  </dialog>;
}

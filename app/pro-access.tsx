"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Sparkles, Check, Download } from "lucide-react";
import { verifyOfflineLicense } from "./offline-license.mjs";
import { openStore } from "./storage.mjs";
import {PINNED_PUBLIC_KEYS} from "./license-public-keys.mjs";
import { captureAnalyticsEvent } from "./analytics";

type BillingReply = { pro?: boolean; checkoutAvailable?: boolean; mode?: "test" | "live"; url?: string; recoveryCode?: string; offlineLicense?: string; offline?: boolean; reason?: string };
class PurchaseError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
// Keep failure categories finite; billing messages and ownership values are private.
function billingFailureReason(error: unknown) {
  if (error instanceof PurchaseError) {
    if ([400, 402, 403, 404].includes(error.status)) return "verification_failed";
    if (error.status === 409) return "payment_pending";
    if (error.status === 429) return "rate_limited";
    return "unavailable";
  }
  if (error instanceof Error && ["ProjectSaveError", "DocumentStorageError"].includes(error.name)) return "save_failed";
  if (error instanceof TypeError || error instanceof Error && ["AbortError", "TimeoutError", "NetworkError"].includes(error.name)) return "network";
  return "unknown";
}
const STANDALONE = process.env.NEXT_PUBLIC_PIXELWALL_STANDALONE === "true";
const STOREFRONT = "https://www.pixelwall.dev";
async function billing(action: string, payload?: object): Promise<BillingReply> {
  if (STANDALONE) {
    if (action === "status") return { pro: false, checkoutAvailable: true, mode: "live" };
    if (action === "checkout") return { url: new URL("/editor?purchase=1", STOREFRONT).href };
    if (action !== "restore") throw new PurchaseError("Restore your downloaded PW2 ownership license to export with Pro. Existing PW1 codes can be converted once while online.", 402);
    const result = await fetch(new URL("/api/billing/exchange", STOREFRONT), {
      method: "POST", mode: "cors", credentials: "omit", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
    });
    const data = await result.json();
    if (!result.ok) throw new PurchaseError(data.error || "The ownership license could not be converted.", result.status);
    return data;
  }
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

const LICENSE_KEY = "pixelwall-owned-pro-v2";
// These are PUBLIC verification keys. Signing keys stay in server environment only.
const PUBLIC_KEYS = Object.keys(PINNED_PUBLIC_KEYS).length ? PINNED_PUBLIC_KEYS : (process.env.NEXT_PUBLIC_PIXELWALL_LICENSE_PUBLIC_KEYS ?? "{}");
const LICENSE_MODE = process.env.NEXT_PUBLIC_PIXELWALL_LICENSE_MODE === "test" ? "test" : "live";
async function verifyOwned(code: string) { return verifyOfflineLicense(code, { publicKeys: PUBLIC_KEYS, mode: LICENSE_MODE }); }
async function readOwned() {
  try { const store = await openStore(); try { const code = await store.getSetting(LICENSE_KEY, ""); if (code) return String(code); } finally { store.close(); } } catch { /* A downloaded license also restores ownership. */ }
  try { return window.localStorage.getItem(LICENSE_KEY) ?? ""; } catch { return ""; }
}
async function writeOwned(code: string) {
  let saved = false;
  try { const store = await openStore(); try { await store.setSetting(LICENSE_KEY, code); saved = true; } finally { store.close(); } } catch { /* Try the small compatibility copy too. */ }
  try { if (code) window.localStorage.setItem(LICENSE_KEY, code); else window.localStorage.removeItem(LICENSE_KEY); saved = true; } catch { /* The UI still offers the portable download. */ }
  return saved;
}

export function useProAccess() {
  const [status, setStatus] = useState<BillingReply>({ pro: false, checkoutAvailable: false, mode: LICENSE_MODE });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [sessionId, setSessionId] = useState("");
  const working = useRef(false);
  const revision = useRef(0);
  const owned = useRef("");
  const dialogVisible = useRef(false);
  const showDialog = useCallback((source: "menu" | "export" | "checkout_return") => {
    if (!dialogVisible.current) captureAnalyticsEvent("pro_dialog_viewed", { source });
    dialogVisible.current = true;
    setOpen(true);
  }, []);
  const close = useCallback(() => { dialogVisible.current = false; setOpen(false); }, []);

  const acceptOwned = useCallback(async (code?: string) => {
    if (!code || !await verifyOwned(code)) return false;
    owned.current = code;
    const saved = await writeOwned(code);
    setRecoveryCode(code);
    setStatus((current) => ({ ...current, pro: true, offlineLicense: code, mode: LICENSE_MODE }));
    if (!saved) setMessage("Pro is active. Download your ownership license to keep access after closing this browser.");
    return true;
  }, []);
  const forgetOwned = useCallback(async () => { owned.current = ""; await writeOwned(""); setRecoveryCode(""); }, []);
  const refresh = useCallback(async () => {
    const version = revision.current;
    const cached = owned.current || await readOwned();
    const valid = cached ? await verifyOwned(cached) : null;
    if (version !== revision.current) return;
    if (valid) { owned.current = cached; setRecoveryCode(cached); setStatus((current) => ({ ...current, pro: true, offline: !navigator.onLine, mode: LICENSE_MODE })); }
    try {
      const next = await billing("status");
      if (version !== revision.current) return;
      if (next.reason) { await forgetOwned(); setStatus(next); }
      else {
        const converted = await acceptOwned(next.offlineLicense);
        setStatus((current) => ({ ...current, ...next, pro: Boolean(next.pro || valid || converted), offline: false }));
      }
      if (next.reason === "refunded") setMessage("This purchase was refunded. Pro access is no longer active.");
      if (next.reason === "disputed") setMessage("Pro access is paused while the payment dispute is reviewed.");
    } catch { if (valid && version === revision.current) setStatus((current) => ({ ...current, pro: true, offline: true })); }
  }, [acceptOwned, forgetOwned]);

  const run = useCallback(async (operation: () => Promise<void>, onFailure?: (reason: ReturnType<typeof billingFailureReason>) => void) => {
    if (working.current) return false;
    working.current = true; revision.current++; setBusy(true); setMessage("");
    try { await operation(); return true; }
    catch (error) {
      onFailure?.(billingFailureReason(error));
      setMessage(error instanceof PurchaseError || error instanceof Error && ["ProjectSaveError", "DocumentStorageError"].includes(error.name)
        ? error.message : "We couldn’t connect. Please try again; don’t start another payment if you already paid.");
      if (error instanceof PurchaseError && [402, 403, 404].includes(error.status)) { await forgetOwned(); setStatus((current) => ({ ...current, pro: false })); }
      return false;
    } finally { working.current = false; setBusy(false); }
  }, [forgetOwned]);

  const claim = useCallback(async (id: string) => run(async () => {
    const data = await billing("claim", { sessionId: id });
    const offlineReady = await acceptOwned(data.offlineLicense);
    captureAnalyticsEvent("entitlement_claimed", { outcome: offlineReady ? "success" : "online_only", reason: offlineReady ? "none" : "ownership_license_unavailable", billing_mode: LICENSE_MODE });
    setStatus((current) => ({ ...current, pro: true }));
    setRecoveryCode(data.recoveryCode ?? ""); setSessionId(""); clearCheckoutReturn();
    setMessage(offlineReady ? "Pro is yours. Save your ownership license; it unlocks these exports offline without a subscription." : "Pro is active online. Save your recovery code; reconnect once offline licenses are available to convert it.");
  }, (reason) => captureAnalyticsEvent("entitlement_claimed", { outcome: "failure", reason, billing_mode: LICENSE_MODE })), [run, acceptOwned]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href); const outcome = url.searchParams.get("checkout"); const id = url.searchParams.get("session_id");
      if (outcome) {
        captureAnalyticsEvent("checkout_returned", { outcome: outcome === "success" ? "success" : outcome === "cancelled" || outcome === "cancel" ? "cancelled" : "unknown" });
        showDialog("checkout_return");
        if (outcome === "success" && id) { setSessionId(id); void claim(id).then(refresh); }
        else { clearCheckoutReturn(); setMessage("Checkout closed. Your free tools are ready whenever you are."); void refresh(); }
      }
      else { if (url.searchParams.get("purchase") === "1") showDialog("menu"); void refresh(); }
    }, 0);
    const onFocus = () => { if (!working.current) void refresh(); };
    window.addEventListener("focus", onFocus); window.addEventListener("online", onFocus);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("online", onFocus); };
  }, [claim, refresh, showDialog]);

  function show() { showDialog("menu"); void refresh(); }
  async function requestAccess() {
    const cached = owned.current || await readOwned();
    if (cached && await verifyOwned(cached)) { owned.current = cached; setStatus((current) => ({ ...current, pro: true })); return true; }
    const allowed = await run(async () => { const data = await billing("authorize"); await acceptOwned(data.offlineLicense); setStatus((current) => ({ ...current, pro: true })); });
    if (!allowed) showDialog("export");
    return allowed;
  }
  async function checkout(beforeLeave: () => void | Promise<void>) {
    await run(async () => {
      captureAnalyticsEvent("checkout_started", { billing_mode: status.mode ?? LICENSE_MODE });
      const data = await billing("checkout");
      if (data.pro) { await acceptOwned(data.offlineLicense); setStatus((current) => ({ ...current, pro: true })); return; }
      if (STANDALONE) {
        if (!data.url || new URL(data.url).origin !== new URL(STOREFRONT).origin) throw new Error("Invalid storefront URL");
        await beforeLeave();
        captureAnalyticsEvent("checkout_redirected", { billing_mode: status.mode ?? LICENSE_MODE });
        window.open(data.url, "_blank", "noopener,noreferrer");
        setMessage("Complete checkout in your browser, download the ownership license, then paste the PW2 code here to restore Pro.");
        return;
      }
      if (!data.url || new URL(data.url).origin !== "https://checkout.stripe.com") throw new Error("Invalid checkout URL");
      await beforeLeave();
      captureAnalyticsEvent("checkout_redirected", { billing_mode: status.mode ?? LICENSE_MODE });
      window.location.assign(data.url);
    }, (reason) => captureAnalyticsEvent("checkout_failed", { reason, billing_mode: status.mode ?? LICENSE_MODE }));
  }
  async function restore(code: string) {
    await run(async () => {
      const clean = code.trim();
      let offlineReady = false;
      if (clean.startsWith("PW2.")) {
        offlineReady = await acceptOwned(clean);
        if (!offlineReady) throw new PurchaseError("That ownership license is not valid for this store. Copy the complete PW2 code.", 400);
        // Re-establish the online cookie when reachable so refunds/disputes can
        // be observed. Ownership verification itself works with zero requests.
        if (!STANDALONE && navigator.onLine) { try { await billing("restore", { code: clean }); } catch (error) { if (error instanceof PurchaseError && [403, 404].includes(error.status)) throw error; } }
      } else { const data = await billing("restore", { code: clean }); offlineReady = await acceptOwned(data.offlineLicense); }
      captureAnalyticsEvent("entitlement_restored", { outcome: offlineReady ? "success" : "online_only", reason: offlineReady ? "none" : "ownership_license_unavailable", billing_mode: LICENSE_MODE });
      setStatus((current) => ({ ...current, pro: true })); setSessionId(""); clearCheckoutReturn(); setMessage("Pro restored. Save your ownership license with your project backups.");
    }, (reason) => captureAnalyticsEvent("entitlement_restored", { outcome: "failure", reason, billing_mode: LICENSE_MODE }));
  }
  async function getRecovery() {
    await run(async () => { const cached = owned.current || await readOwned(); if (cached && await verifyOwned(cached)) { setRecoveryCode(cached); return; } const data = await billing("recovery"); await acceptOwned(data.offlineLicense); setRecoveryCode(data.recoveryCode ?? ""); });
  }
  return { ...status, open, busy, message, recoveryCode, sessionId, show, close, requestAccess, checkout, restore, getRecovery, retryClaim: () => claim(sessionId) };
}

type ProAccess = ReturnType<typeof useProAccess>;
export function ProDialog({ access, beforeCheckout }: { access: ProAccess; beforeCheckout: () => void | Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    if (access.open && !dialog.current?.open) { dialog.current?.showModal(); heading.current?.focus(); }
    else if (!access.open && dialog.current?.open) dialog.current.close();
  }, [access.open]);
  function recoveryDownloadUrl() {
    const content = `PixelWall Pro — perpetual ownership license\n\n${access.recoveryCode}\n\nKeep this file private. Anyone with this code can use your Pro access. PW2 ownership licenses work offline in a downloaded or installed PixelWall build; PW1 codes need one online conversion.\nTo restore: open PixelWall, choose Pro, then Restore Pro.\nStore: ${STOREFRONT}\nMode: ${access.mode ?? "unknown"}\nSupport: contact@caplock.ai\nThis code restores Pro access, not your artwork. Use Save Project to back up artwork.\n`;
    return `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
  }
  return <dialog ref={dialog} className="pro-dialog ph-no-capture" aria-labelledby="pro-title" onCancel={access.close} onClose={access.close}>
    <button type="button" className="pro-close" aria-label="Close Pro details" onClick={access.close}><X size={20} /></button>
    <p className="pro-eyebrow"><Sparkles size={15} /> PIXELWALL PRO</p>
    <h2 id="pro-title" ref={heading} tabIndex={-1}>{access.pro ? "Your next frame is ready." : "Make art. Ship the whole thing."}</h2>
    {access.mode === "test" && <p className="pro-test">TEST MODE · Purchases here don’t unlock the live store. No real payment is collected.</p>}
    {access.pro ? <>
      <p className="pro-active"><Check size={18} /> Pro ownership is active in this browser</p>
      <p>GIFs, sprite sheets, game packages, and saved export presets are unlocked.</p>
      {!access.recoveryCode && <button type="button" className="pro-primary" disabled={access.busy} onClick={access.getRecovery}>GET MY RECOVERY CODE</button>}
    </> : <>
      <p>Keep the studio free. Get lifetime access to the exports that take your work further.</p>
      <div className="pro-plans">
        <section><h3>Free, always</h3><ul><li>Drawing, layers &amp; reference images</li><li>Animation editing &amp; Tilemap Lab</li><li>Individual frame PNG exports</li><li>Browser autosave &amp; Save/Open Project</li></ul></section>
        <section className="pro-plan-paid"><h3>Pro · Lifetime access <span>$15 <small>USD</small></span></h3><ul><li>Animated GIF exports</li><li>Sprite-sheet PNG exports</li><li>Sprite &amp; Tiled tilemap ZIP packages</li><li>Named export presets</li></ul></section>
      </div>
      <p className="pro-fine">One $15 payment. No subscription. Own the listed Pro export features, including offline use in an installed or downloaded build. Save your ownership license and app copy. Taxes may apply.</p>
      <button type="button" className="pro-primary" disabled={access.busy || !access.checkoutAvailable || Boolean(access.sessionId)} onClick={() => access.checkout(beforeCheckout)}>{access.busy ? "CONNECTING…" : access.checkoutAvailable ? "GET LIFETIME PRO — $15" : "CHECKOUT COMING SOON"}</button>
      <p className="pro-fine">{access.checkoutAvailable ? "Secure checkout with Stripe. Your project stays on this device during checkout." : "The free studio is ready. Pro checkout is still being connected."}</p>
      {access.checkoutAvailable && <p className="pro-fine">Have a gift or promo code? Enter it at checkout. A 100% off gift code unlocks lifetime Pro without a card.</p>}
    </>}
    {access.message && <p className="pro-message" role="status">{access.message}</p>}
    {access.sessionId && <button type="button" className="pro-secondary" disabled={access.busy} onClick={access.retryClaim}>CHECK MY PAYMENT AGAIN</button>}
    {access.recoveryCode && <div className="pro-recovery"><h3>Keep your Pro ownership license</h3><p>Use this private license in another browser or a downloaded build, including offline. It has no expiry; save your artwork separately.</p><textarea aria-label="Private Pro recovery code" readOnly value={access.recoveryCode} rows={3} /><a className="pro-primary" href={recoveryDownloadUrl()} download="pixelwall-pro-license.txt"><Download size={16} /> SAVE OWNERSHIP LICENSE</a></div>}
    {(STANDALONE || !access.pro) && <details className="pro-restore"><summary>Already have a recovery code? Restore Pro</summary><form onSubmit={(event) => { event.preventDefault(); void access.restore(code); }}><label>Private recovery code<textarea value={code} onChange={(event) => setCode(event.target.value)} placeholder="PW2.… (or an existing PW1 recovery code)" autoComplete="off" spellCheck={false} rows={3} maxLength={4096} required /></label><button type="submit" className="pro-secondary" disabled={access.busy || !code.trim()}>RESTORE PRO</button></form></details>}
    <p className="pro-fine">Need help with a purchase or refund? <a href="mailto:contact@caplock.ai">contact@caplock.ai</a>. If you lost your code, include your Stripe receipt number. Never send card details.</p>
  </dialog>;
}

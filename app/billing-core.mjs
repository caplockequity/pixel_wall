import { verifyOfflineLicense } from "./offline-license.mjs";
import { offlineSigningConfig, signOfflineLicense } from "./offline-license-server.mjs";

// Stripe is the durable purchase record. Artwork never enters these endpoints.
const COOKIE = "pixelwall_pro";
const CLAIM_COOKIE = "pixelwall_checkout";
const APP = "pixelwall-pro-v1";
const CODE_PATTERN = /^PW1\.(test|live)\.(cs_(?:test|live)_[a-zA-Z0-9]{8,200})\.([a-f0-9]{64})$/;
const SESSION_PATTERN = /^cs_(?:test|live)_[a-zA-Z0-9]{8,200}$/;
const YEAR = 365 * 24 * 60 * 60;
const encoder = new TextEncoder();

class BillingError extends Error {
  constructor(message, status = 400, code = "invalid_request") { super(message); this.status = status; this.code = code; }
}

function response(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } });
}
function cookie(request, name) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}
function checkoutClaim(request) {
  const [secret, sessionId] = cookie(request, CLAIM_COOKIE).split(".");
  return { secret: /^[a-f0-9]{64}$/.test(secret ?? "") ? secret : "", sessionId: SESSION_PATTERN.test(sessionId ?? "") ? sessionId : "" };
}
function hex(bytes) { return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function equal(a, b) {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}
async function hmac(secret, value, crypto) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
async function hash(value, crypto) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }

export function billingConfig(env) {
  const mode = env.STRIPE_MODE === "live" ? "live" : "test";
  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const price = env.STRIPE_PRICE_ID?.trim() ?? "";
  const signingSecret = env.PIXELWALL_LICENSE_SECRET?.trim() ?? "";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
  let origin = "";
  try {
    const url = new URL(env.PIXELWALL_SITE_URL ?? "");
    if (url.protocol === "https:" || (mode === "test" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) origin = url.origin;
  } catch { /* Incomplete setup is reported without exposing configuration. */ }
  const origins = [origin];
  for (const value of (env.PIXELWALL_ADDITIONAL_ORIGINS ?? "").split(",")) {
    try {
      const url = new URL(value.trim());
      if (url.protocol === "https:") origins.push(url.origin);
    } catch { /* Only explicitly configured HTTPS storefronts are accepted. */ }
  }
  const historicalPrices = (env.STRIPE_HISTORICAL_PRICE_IDS ?? "").split(",").map((id) => id.trim()).filter((id) => /^price_[a-zA-Z0-9]+$/.test(id));
  const acceptedPrices = new Set([price, ...historicalPrices]);
  const offline = offlineSigningConfig(env);
  const ready = Boolean(origin && new RegExp(`^(?:sk|rk)_${mode}_`).test(secret) && /^price_[a-zA-Z0-9]+$/.test(price) && signingSecret.length >= 32);
  return { mode, secret, price, acceptedPrices, offline, signingSecret, webhookSecret, origin, origins, ready, automaticTax: env.STRIPE_AUTOMATIC_TAX === "true" };
}

export function createBillingService({ env, fetch: fetcher = globalThis.fetch, crypto = globalThis.crypto, now = Date.now }) {
  const config = billingConfig(env);
  function requireReady() {
    if (!config.ready) throw new BillingError("Pro checkout is being set up. Your free tools are ready to use.", 503, "not_configured");
  }
  function setCookie(name, value, age = YEAR) {
    return `${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${config.origin.startsWith("https:") ? "; Secure" : ""}`;
  }
  async function stripe(path, params, method = "GET", idempotencyKey) {
    const body = new URLSearchParams(params ?? {});
    const url = `https://api.stripe.com/v1/${path}${method === "GET" && body.size ? `?${body}` : ""}`;
    let result;
    try {
      result = await fetcher(url, {
        // Workers supports manual/follow redirects. Reject non-2xx below so the
        // server key can never be forwarded to a redirected destination.
        method, redirect: "manual", signal: AbortSignal.timeout(12000),
        headers: {
          Authorization: `Bearer ${config.secret}`,
          ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        ...(method === "POST" ? { body } : {}),
      });
    } catch { throw new BillingError("We couldn’t reach Stripe. Please try again.", 503, "stripe_unavailable"); }
    if (!result.ok) {
      if (result.status === 404) throw new BillingError("That purchase could not be found.", 404, "purchase_not_found");
      throw new BillingError("Payment verification is temporarily unavailable. Please try again.", 503, "stripe_unavailable");
    }
    return result.json();
  }
  async function priceDetails() {
    const price = await stripe(`prices/${config.price}`);
    if (!price.active || price.type !== "one_time" || price.currency !== "usd" || price.unit_amount !== 1500 || price.livemode !== (config.mode === "live")) {
      throw new BillingError("Pro checkout is being configured. Please try again later.", 503, "price_mismatch");
    }
    return { amount: price.unit_amount, currency: price.currency };
  }
  async function readPurchase(id) {
    if (!SESSION_PATTERN.test(id) || !id.startsWith(`cs_${config.mode}_`)) throw new BillingError("This recovery code is not valid for this store.", 403, "invalid_license");
    const session = await stripe(`checkout/sessions/${id}`, { "expand[0]": "payment_intent.latest_charge", "expand[1]": "line_items" });
    if (session.livemode !== (config.mode === "live") || session.mode !== "payment" || session.metadata?.app !== APP || session.line_items?.has_more || session.line_items?.data?.length !== 1 || !config.acceptedPrices.has(session.line_items.data[0].price?.id) || session.line_items.data[0].quantity !== 1) {
      throw new BillingError("This purchase does not include PixelWall Pro.", 403, "wrong_product");
    }
    if (session.status !== "complete") throw new BillingError("Stripe is still confirming checkout. Try again in a moment.", 409, "payment_pending");
    if (!["paid", "no_payment_required"].includes(session.payment_status)) throw new BillingError("Stripe is still confirming payment. Try again in a moment.", 409, "payment_pending");
    // A completed, fully discounted order has no PaymentIntent. Verify Stripe's
    // totals as well as the product above; an unpaid or merely open session is
    // never a complimentary license. A redeemed discount remains lifetime access
    // even after the owner disables its promotion code for future redemptions.
    if (session.amount_total === 0 || session.payment_status === "no_payment_required") {
      if (session.amount_total !== 0 || !(session.amount_subtotal > 0) || session.total_details?.amount_discount !== session.amount_subtotal || session.payment_intent) {
        throw new BillingError("This complimentary checkout is not complete.", 409, "payment_pending");
      }
      return session;
    }
    const intent = session.payment_intent;
    const charge = intent?.latest_charge;
    if (intent?.status !== "succeeded" || !charge || typeof charge !== "object" || !charge.paid || charge.status !== "succeeded") throw new BillingError("This payment is not complete.", 409, "payment_pending");
    if (charge.refunded || (charge.amount > 0 && charge.amount_refunded >= charge.amount)) throw new BillingError("This purchase was refunded. Pro access is no longer active.", 403, "refunded");
    if (charge.disputed) {
      const disputes = await stripe("disputes", { charge: charge.id, limit: "1" });
      if (!disputes.data?.length || !["won", "warning_closed"].includes(disputes.data[0].status)) throw new BillingError("Pro access is paused while this payment dispute is reviewed.", 403, "disputed");
    }
    return session;
  }
  async function licenseFor(id) {
    const prefix = `PW1.${config.mode}.${id}`;
    return `${prefix}.${await hmac(config.signingSecret, prefix, crypto)}`;
  }
  async function checkLicense(code) {
    if (code.startsWith("PW2.")) {
      const claims = await verifyOfflineLicense(code, { publicKeys: config.offline.publicKeys, mode: config.mode, crypto });
      if (!claims) throw new BillingError("That offline license is not valid for this store.", 403, "invalid_license");
      await readPurchase(claims.purchaseId);
      return code;
    }
    const match = CODE_PATTERN.exec(code);
    if (!match || match[1] !== config.mode || !equal(await licenseFor(match[2]), code)) throw new BillingError("That recovery code is not valid. Copy the complete code from your purchase.", 403, "invalid_license");
    await readPurchase(match[2]);
    return code;
  }
  async function entitlementFor(code) {
    if (!config.offline.ready) return {};
    const claims = code.startsWith("PW2.") ? await verifyOfflineLicense(code, { publicKeys: config.offline.publicKeys, mode: config.mode, crypto }) : null;
    const purchaseId = claims?.purchaseId ?? CODE_PATTERN.exec(code)?.[2];
    if (!purchaseId) throw new BillingError("The purchase code is invalid.", 403, "invalid_license");
    const offlineLicense = claims ? code : await signOfflineLicense(purchaseId, { ...config.offline, mode: config.mode, crypto, now });
    return { offlineLicense };
  }
  async function boundedBody(request, limit) {
    if (Number(request.headers.get("content-length")) > limit) throw new BillingError("Request too large.", 413);
    const reader = request.body?.getReader();
    if (!reader) return "";
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw new BillingError("Request too large.", 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  }
  async function jsonBody(request) {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new BillingError("Expected a JSON request.", 415);
    const text = await boundedBody(request, 4096);
    try { return JSON.parse(text); } catch { throw new BillingError("Invalid request."); }
  }
  async function webhook(request) {
    if (!config.webhookSecret) throw new BillingError("Payment notifications are not configured.", 503, "not_configured");
    const body = await boundedBody(request, 1024 * 1024);
    const pieces = request.headers.get("stripe-signature")?.split(",") ?? [];
    const timestamp = pieces.find((part) => part.startsWith("t="))?.slice(2) ?? "";
    const signatures = pieces.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
    if (!/^\d+$/.test(timestamp) || Math.abs(now() / 1000 - Number(timestamp)) > 300) throw new BillingError("Invalid payment notification.", 400, "invalid_signature");
    const expected = await hmac(config.webhookSecret, `${timestamp}.${body}`, crypto);
    if (!signatures.some((signature) => equal(signature, expected))) throw new BillingError("Invalid payment notification.", 400, "invalid_signature");
    let event;
    try { event = JSON.parse(body); } catch { throw new BillingError("Invalid payment notification."); }
    if (event.livemode !== (config.mode === "live")) throw new BillingError("Payment mode mismatch.", 400);
    // Online checks observe current Stripe payment/refund/dispute status. Offline
    // licenses deliberately have no expiry; immediate offline revocation is impossible.
    // Duplicate and reordered events remain harmless.
    return response({ received: true });
  }
  async function handle(request) {
    const action = new URL(request.url).pathname.split("/").at(-1);
    const exchangeHeaders = action === "exchange" ? { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } : {};
    try {
      // A submitted recovery code authenticates this portable exchange. It never
      // reads/sets cookies, accepts a session ID, or creates a purchase.
      if (action === "exchange" && request.method === "OPTIONS") return new Response(null, { status: 204, headers: exchangeHeaders });
      if (action === "exchange" && request.method === "POST") {
        requireReady();
        if (!config.offline.ready) throw new BillingError("Offline ownership conversion is being configured. Keep your existing recovery code.", 503, "offline_not_configured");
        const payload = await jsonBody(request);
        const code = typeof payload?.code === "string" ? payload.code.trim() : "";
        await checkLicense(code);
        const entitlement = await entitlementFor(code);
        return response({ pro: true, recoveryCode: entitlement.offlineLicense, ...entitlement }, 200, exchangeHeaders);
      }
      if (request.method === "POST" && action === "webhook") return await webhook(request);
      if (request.method === "GET" && action === "status") {
        if (!config.ready) return response({ pro: false, checkoutAvailable: false, mode: config.mode });
        const code = cookie(request, COOKIE);
        if (!code) return response({ pro: false, checkoutAvailable: config.offline.ready, mode: config.mode });
        try { await checkLicense(code); return response({ pro: true, checkoutAvailable: config.offline.ready, mode: config.mode, ...await entitlementFor(code) }); }
        catch (error) {
          if (error instanceof BillingError && [403, 404].includes(error.status)) return response({ pro: false, checkoutAvailable: config.offline.ready, mode: config.mode, reason: error.code }, 200, { "Set-Cookie": setCookie(COOKIE, "", 0) });
          throw error;
        }
      }
      if (request.method !== "POST") return response({ error: "Not found." }, 404);
      requireReady();
      const requestOrigin = request.headers.get("origin");
      if (!config.origins.includes(requestOrigin) || (request.headers.get("sec-fetch-site") && !["same-origin", "none"].includes(request.headers.get("sec-fetch-site")))) throw new BillingError("Please open PixelWall directly to continue.", 403, "origin_mismatch");
      if (action === "authorize") {
        const code = cookie(request, COOKIE);
        if (!code) throw new BillingError("This export is included in PixelWall Pro.", 402, "pro_required");
        await checkLicense(code);
        return response({ pro: true, ...await entitlementFor(code) });
      }
      if (action === "checkout") {
        const active = cookie(request, COOKIE);
        if (active) {
          try { await checkLicense(active); return response({ pro: true, ...await entitlementFor(active) }); }
          catch (error) { if (!(error instanceof BillingError) || ![403, 404].includes(error.status)) throw error; }
        }
        if (!config.offline.ready) throw new BillingError("Pro ownership licenses are being configured. Existing purchases are preserved.", 503, "offline_not_configured");
        await priceDetails();
        const existingClaim = checkoutClaim(request);
        let claim = existingClaim.secret;
        if (claim && existingClaim.sessionId) {
          let previous;
          try { previous = await stripe(`checkout/sessions/${existingClaim.sessionId}`, { "expand[0]": "line_items" }); }
          catch (error) { if (!(error instanceof BillingError) || error.status !== 404) throw error; }
          if (previous?.status === "open" && previous.allow_promotion_codes === true && previous.payment_method_collection === "if_required" && previous.livemode === (config.mode === "live") && previous.metadata?.app === APP && previous.line_items?.data?.[0]?.price?.id === config.price && previous.client_reference_id === await hash(claim, crypto) && previous.url && new URL(previous.url).origin === "https://checkout.stripe.com") {
            return response({ url: previous.url });
          }
          // Completed, refunded, or expired checkout links cannot be reused.
          claim = "";
        }
        claim ||= hex(crypto.getRandomValues(new Uint8Array(32)));
        const reference = await hash(claim, crypto);
        const session = await stripe("checkout/sessions", {
          mode: "payment", "line_items[0][price]": config.price, "line_items[0][quantity]": "1",
          "payment_method_types[0]": "card", customer_creation: "always", client_reference_id: reference,
          // Payment-mode Checkout automatically skips card collection at $0.
          allow_promotion_codes: "true",
          "metadata[app]": APP, "metadata[offer]": "pro-lifetime", "payment_intent_data[metadata][app]": APP,
          success_url: `${requestOrigin}/editor?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${requestOrigin}/editor?checkout=cancelled`,
          "automatic_tax[enabled]": String(config.automaticTax),
          "custom_text[after_submit][message]": "Return to PixelWall after checkout to save your private lifetime Pro recovery code. Keep it to restore access on another device.",
        }, "POST", `pixelwall-checkout-${reference}`);
        if (!SESSION_PATTERN.test(session.id ?? "") || !session.id.startsWith(`cs_${config.mode}_`) || !session.url || new URL(session.url).origin !== "https://checkout.stripe.com") throw new BillingError("Checkout is unavailable. Please try again.", 503);
        return response({ url: session.url }, 200, { "Set-Cookie": setCookie(CLAIM_COOKIE, `${claim}.${session.id}`, 86400) });
      }
      if (action === "claim") {
        const payload = await jsonBody(request);
        const id = typeof payload?.sessionId === "string" ? payload.sessionId : "";
        const storedClaim = checkoutClaim(request);
        const claim = storedClaim.secret;
        if (!claim) throw new BillingError("Return in the browser where you started checkout, or restore with your recovery code. Contact support if you need help.", 403, "claim_missing");
        if (storedClaim.sessionId && storedClaim.sessionId !== id) throw new BillingError("This checkout belongs to a different browser. Use your recovery code to restore Pro.", 403, "claim_mismatch");
        const session = await readPurchase(id);
        if (!equal(session.client_reference_id ?? "", await hash(claim, crypto))) throw new BillingError("This checkout belongs to a different browser. Use your recovery code to restore Pro.", 403, "claim_mismatch");
        const code = await licenseFor(id);
        const entitlement = await entitlementFor(code);
        const result = response({ pro: true, recoveryCode: entitlement.offlineLicense ?? code, ...entitlement }, 200, { "Set-Cookie": setCookie(COOKIE, entitlement.offlineLicense ?? code) });
        // Keep the short-lived claim cookie so a reload can recover the code if the
        // first response or download was interrupted. It cannot claim another buyer.
        return result;
      }
      if (action === "restore") {
        const payload = await jsonBody(request);
        const code = typeof payload?.code === "string" ? payload.code.trim() : "";
        await checkLicense(code);
        return response({ pro: true, ...await entitlementFor(code) }, 200, { "Set-Cookie": setCookie(COOKIE, code) });
      }
      if (action === "recovery") {
        const code = await checkLicense(cookie(request, COOKIE));
        const entitlement = await entitlementFor(code);
        return response({ recoveryCode: entitlement.offlineLicense ?? code, ...entitlement });
      }
      if (action === "logout") return response({ pro: false }, 200, { "Set-Cookie": setCookie(COOKIE, "", 0) });
      return response({ error: "Not found." }, 404);
    } catch (error) {
      if (error instanceof BillingError) return response({ error: error.message, code: error.code }, error.status, exchangeHeaders);
      return response({ error: "We couldn’t complete that request. Please try again.", code: "billing_unavailable" }, 503, exchangeHeaders);
    }
  }
  return { handle, checkLicense, licenseFor, readPurchase };
}

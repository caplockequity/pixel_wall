import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHmac, createHash } from "node:crypto";
import { billingConfig, createBillingService } from "../app/billing-core.mjs";

const env = { STRIPE_MODE: "test", STRIPE_SECRET_KEY: "sk_test_example", STRIPE_PRICE_ID: "price_pro", PIXELWALL_LICENSE_SECRET: "test-signing-secret-that-is-long-enough", STRIPE_WEBHOOK_SECRET: "whsec_example", PIXELWALL_SITE_URL: "https://pixelwall.example" };
const id = "cs_test_example12345678";
const claim = "a".repeat(64);
const clock = 1788894000000;
function setup(overrides = {}) {
  const state = {
    calls: [], outage: false,
    price: { active: true, type: "one_time", currency: "usd", unit_amount: 1900, livemode: false },
    purchase: { id, mode: "payment", livemode: false, metadata: { app: "pixelwall-pro-v1" }, status: "complete", payment_status: "paid", client_reference_id: createHash("sha256").update(claim).digest("hex"), line_items: { has_more: false, data: [{ price: { id: env.STRIPE_PRICE_ID }, quantity: 1 }] }, payment_intent: { status: "succeeded", latest_charge: { id: "ch_example", status: "succeeded", paid: true, amount: 1900, amount_refunded: 0, refunded: false, disputed: false } } },
    dispute: "needs_response",
  };
  const service = createBillingService({ env: { ...env, ...overrides }, crypto: webcrypto, now: () => clock, fetch: async (input, options) => {
    const url = new URL(input); state.calls.push({ url, options });
    if (state.outage) throw new Error("offline");
    if (url.pathname.includes("/prices/")) return Response.json(state.price);
    if (url.pathname === "/v1/checkout/sessions") return Response.json({ id, url: "https://checkout.stripe.com/c/pay/example" });
    if (url.pathname.includes("/checkout/sessions/")) {
      if (url.searchParams.get("expand[0]") !== "line_items") {
        assert.equal(url.searchParams.get("expand[0]"), "payment_intent.latest_charge");
        assert.equal(url.searchParams.get("expand[1]"), "line_items");
      }
      return Response.json(state.purchase);
    }
    if (url.pathname === "/v1/disputes") return Response.json({ data: [{ status: state.dispute }] });
    throw new Error(`Unexpected Stripe URL ${url.pathname}`);
  } });
  function request(action, payload, cookies = "", extra = {}) {
    return service.handle(new Request(`${env.PIXELWALL_SITE_URL}/api/billing/${action}`, {
      method: action === "status" ? "GET" : "POST",
      headers: { Origin: env.PIXELWALL_SITE_URL, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: cookies, ...extra },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }));
  }
  return { state, service, request };
}

test("missing or mismatched configuration leaves the free editor available", async () => {
  const service = createBillingService({ env: {}, crypto: webcrypto });
  const response = await service.handle(new Request("http://localhost:3000/api/billing/status"));
  assert.deepEqual(await response.json(), { pro: false, checkoutAvailable: false, mode: "test" });
  assert.equal(billingConfig({ ...env, STRIPE_MODE: "live" }).ready, false);
  assert.equal(billingConfig({ ...env, PIXELWALL_SITE_URL: "http://example.com" }).ready, false);
});
test("checkout fixes price and return URLs on the server, with a private claim cookie", async () => {
  const { state, request } = setup();
  const response = await request("checkout", { price: "price_cheaper", success_url: "https://evil.example" }, `pixelwall_checkout=${claim}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax; Secure/);
  const { options } = state.calls.at(-1);
  assert.equal(options.body.get("line_items[0][price]"), "price_pro");
  assert.equal(options.body.get("mode"), "payment");
  assert.match(options.body.get("success_url"), /^https:\/\/pixelwall.example\//);
  assert.equal(options.body.get("client_reference_id"), state.purchase.client_reference_id);
  assert.equal(options.body.get("automatic_tax[enabled]"), "false");
  assert.equal(options.body.get("allow_promotion_codes"), "true");
  assert.equal(options.body.get("payment_method_collection"), null);
  state.purchase.status = "open"; state.purchase.url = "https://checkout.stripe.com/c/pay/example";
  state.purchase.allow_promotion_codes = true; state.purchase.payment_method_collection = "if_required";
  const retry = await request("checkout", undefined, response.headers.get("set-cookie").split(";")[0]);
  assert.equal((await retry.json()).url, state.purchase.url);
  assert.equal(state.calls.filter(call => call.options.method === "POST").length, 1);
});
test("an unexpected Stripe price cannot be charged", async () => {
  const { state, request } = setup(); state.price.unit_amount = 19000;
  assert.equal((await request("checkout")).status, 503);
  assert.equal(state.calls.length, 1);
});
test("configured storefront aliases retain checkout cookies and reject untrusted return origins", async () => {
  const alias = "https://pixelwall-alias.example";
  const { state, request } = setup({ PIXELWALL_ADDITIONAL_ORIGINS: `${alias},http://insecure.example,invalid` });
  const checkout = await request("checkout", undefined, `pixelwall_checkout=${claim}`, { Origin: alias });
  assert.equal(checkout.status, 200);
  const params = state.calls.at(-1).options.body;
  assert.equal(params.get("success_url"), `${alias}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  assert.equal(params.get("cancel_url"), `${alias}/?checkout=cancelled`);
  const claimed = await request("claim", { sessionId: id }, checkout.headers.get("set-cookie").split(";")[0], { Origin: alias });
  assert.equal(claimed.status, 200);
  const calls = state.calls.length;
  for (const origin of ["https://evil.example", "http://insecure.example"]) {
    assert.equal((await request("checkout", undefined, "", { Origin: origin })).status, 403);
  }
  assert.equal(state.calls.length, calls);
});
test("successful purchase claims Pro and restores on another browser", async () => {
  const { request } = setup();
  const response = await request("claim", { sessionId: id }, `pixelwall_checkout=${claim}`);
  assert.equal(response.status, 200);
  const { recoveryCode } = await response.json();
  assert.match(recoveryCode, /^PW1\.test\.cs_test_/);
  const restored = await request("restore", { code: recoveryCode });
  assert.equal(restored.status, 200);
  const cookie = restored.headers.get("set-cookie").split(";")[0];
  assert.equal((await request("authorize", undefined, cookie)).status, 200);
  assert.equal((await (await request("status", undefined, cookie)).json()).pro, true);
  assert.equal((await (await request("checkout", undefined, cookie)).json()).pro, true);
  assert.equal((await (await request("recovery", undefined, cookie)).json()).recoveryCode, recoveryCode);
});
test("knowing a session ID cannot steal another buyer’s purchase", async () => {
  const { request } = setup();
  assert.equal((await request("claim", { sessionId: id })).status, 403);
  assert.equal((await request("claim", { sessionId: id }, `pixelwall_checkout=${"b".repeat(64)}`)).status, 403);
});
test("forged, altered and wrong-mode licenses fail before contacting Stripe", async () => {
  const { state, service, request } = setup();
  const valid = await service.licenseFor(id);
  for (const code of ["true", valid.slice(0, -1) + (valid.endsWith("0") ? "1" : "0"), valid.replace("PW1.test", "PW1.live")]) {
    assert.equal((await request("restore", { code })).status, 403);
  }
  assert.equal(state.calls.length, 0);
  assert.equal((await request("authorize")).status, 402);
});
test("pending or unrelated payments never unlock Pro", async () => {
  const { state, request } = setup();
  state.purchase.payment_status = "unpaid";
  assert.equal((await request("claim", { sessionId: id }, `pixelwall_checkout=${claim}`)).status, 409);
  state.purchase.payment_status = "paid"; state.purchase.line_items.data[0].price.id = "price_other";
  assert.equal((await request("claim", { sessionId: id }, `pixelwall_checkout=${claim}`)).status, 403);
});
test("full refunds revoke access, while partial refunds preserve it", async () => {
  const { state, service, request } = setup();
  const cookie = `pixelwall_pro=${await service.licenseFor(id)}`;
  state.purchase.payment_intent.latest_charge.amount_refunded = 100;
  assert.equal((await request("authorize", undefined, cookie)).status, 200);
  state.purchase.payment_intent.latest_charge.amount_refunded = 1900;
  assert.equal((await request("authorize", undefined, cookie)).status, 403);
  const status = await request("status", undefined, cookie);
  assert.equal((await status.json()).reason, "refunded"); assert.match(status.headers.get("set-cookie"), /Max-Age=0/);
});
test("active or lost disputes revoke access; won disputes restore it", async () => {
  const { state, service, request } = setup();
  const cookie = `pixelwall_pro=${await service.licenseFor(id)}`;
  state.purchase.payment_intent.latest_charge.disputed = true;
  assert.equal((await request("authorize", undefined, cookie)).status, 403);
  state.dispute = "lost"; assert.equal((await request("authorize", undefined, cookie)).status, 403);
  state.dispute = "won"; assert.equal((await request("authorize", undefined, cookie)).status, 200);
});
test("Stripe outages preserve the cookie but block paid operations", async () => {
  const { state, service, request } = setup();
  const cookie = `pixelwall_pro=${await service.licenseFor(id)}`; state.outage = true;
  const response = await request("status", undefined, cookie);
  assert.equal(response.status, 503); assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await request("authorize", undefined, cookie)).status, 503);
  assert.equal((await request("checkout", undefined, cookie)).status, 503);
});
test("cross-site writes and oversized bodies are rejected", async () => {
  const { state, request } = setup();
  assert.equal((await request("checkout", undefined, "", { Origin: "https://evil.example" })).status, 403);
  assert.equal((await request("restore", { code: "a".repeat(5000) })).status, 413);
  assert.equal(state.calls.length, 0);
});
test("webhooks verify raw bytes, freshness and mode; retries are harmless", async () => {
  const { service, state } = setup();
  const body = JSON.stringify({ id: "evt_test", type: "checkout.session.completed", livemode: false });
  function notification(raw = body, timestamp = String(clock / 1000), signed = body) {
    const signature = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${signed}`).digest("hex");
    return service.handle(new Request(`${env.PIXELWALL_SITE_URL}/api/billing/webhook`, { method: "POST", body: raw, headers: { "stripe-signature": `t=${timestamp},v1=${signature}` } }));
  }
  assert.equal((await notification()).status, 200);
  assert.equal((await notification()).status, 200);
  assert.equal((await notification(body + " ")).status, 400);
  assert.equal((await notification(body, String(clock / 1000 - 301))).status, 400);
  const live = body.replace('"livemode":false', '"livemode":true');
  assert.equal((await notification(live, String(clock / 1000), live)).status, 400);
  assert.equal(state.calls.length, 0);
});

test("Stripe redirects are rejected without forwarding the server key", async () => {
  let calls = 0;
  const service = createBillingService({ env, crypto: webcrypto, fetch: async (url, options) => {
    calls++;
    assert.equal(new URL(url).origin, "https://api.stripe.com");
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://other.example" } });
  } });
  const response = await service.handle(new Request(`${env.PIXELWALL_SITE_URL}/api/billing/checkout`, { method: "POST", headers: { Origin: env.PIXELWALL_SITE_URL } }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "stripe_unavailable");
  assert.equal(calls, 1);
});

for (const status of ["complete", "expired"]) {
  test(`a ${status} checkout is replaced so the buyer can try again`, async () => {
    const { state, request } = setup();
    state.purchase.status = status;
    const response = await request("checkout", undefined, `pixelwall_checkout=${claim}.${id}`);
    assert.equal(response.status, 200);
    const created = state.calls.find(call => call.options.method === "POST");
    assert.ok(created);
    assert.notEqual(created.options.body.get("client_reference_id"), state.purchase.client_reference_id);
    assert.match(response.headers.get("set-cookie"), /pixelwall_checkout=[a-f0-9]{64}\.cs_test_/);
  });
}

test("claim cookies bind the browser to the current checkout session", async () => {
  const { request } = setup();
  assert.equal((await request("claim", { sessionId: id }, `pixelwall_checkout=${claim}.${id}`)).status, 200);
  assert.equal((await request("claim", { sessionId: id }, `pixelwall_checkout=${claim}.cs_test_different12345`)).status, 403);
});

function complimentary(state) {
  Object.assign(state.purchase, { payment_status: "no_payment_required", payment_intent: null, amount_subtotal: 1900, amount_total: 0, total_details: { amount_discount: 1900 } });
}

for (const paymentStatus of ["paid", "no_payment_required"]) test(`a completed 100% discounted checkout (${paymentStatus}) grants a restorable lifetime license without a payment intent`, async () => {
  const { state, request } = setup(); complimentary(state);
  state.purchase.payment_status = paymentStatus;
  const claimed = await request("claim", { sessionId: id }, `pixelwall_checkout=${claim}.${id}`);
  assert.equal(claimed.status, 200);
  const { recoveryCode } = await claimed.json();
  const restored = await request("restore", { code: recoveryCode });
  assert.equal(restored.status, 200);
  const cookie = restored.headers.get("set-cookie").split(";")[0];
  assert.equal((await request("authorize", undefined, cookie)).status, 200);
  assert.equal((await (await request("status", undefined, cookie)).json()).pro, true);
  assert.equal((await (await request("checkout", undefined, cookie)).json()).pro, true);
  assert.equal((await (await request("recovery", undefined, cookie)).json()).recoveryCode, recoveryCode);
  assert.equal(state.calls.some(call => /coupons|promotion_codes/.test(call.url.pathname)), false);
});

test("free checkout still requires the originating browser and the correct store, product, and quantity", async () => {
  const { state, request } = setup(); complimentary(state);
  assert.equal((await request("claim", { sessionId: id })).status, 403);
  assert.equal((await request("claim", { sessionId: id }, `pixelwall_checkout=${"b".repeat(64)}`)).status, 403);
  for (const field of ["product", "quantity", "mode", "app", "extra_line"]) {
    const { state: altered, request: attempt } = setup(); complimentary(altered);
    if (field === "product") altered.purchase.line_items.data[0].price.id = "price_other";
    if (field === "quantity") altered.purchase.line_items.data[0].quantity = 2;
    if (field === "mode") altered.purchase.livemode = true;
    if (field === "app") altered.purchase.metadata.app = "another-app";
    if (field === "extra_line") altered.purchase.line_items.has_more = true;
    assert.equal((await attempt("claim", { sessionId: id }, `pixelwall_checkout=${claim}`)).status, 403, field);
  }
});

for (const [label, changes] of [
  ["an open checkout", { status: "open" }],
  ["an expired checkout", { status: "expired" }],
  ["an unpaid checkout", { payment_status: "unpaid" }],
  ["a claimed paid order without a successful charge", { payment_status: "paid", amount_total: 1900, total_details: { amount_discount: 0 } }],
  ["a remaining balance", { amount_total: 1 }],
  ["missing totals", { amount_total: undefined }],
  ["a zero-priced item instead of a discount", { amount_subtotal: 0, total_details: { amount_discount: 0 } }],
  ["an incomplete discount", { total_details: { amount_discount: 1000 } }],
  ["missing discount details", { total_details: undefined }],
  ["an unexpected payment intent", { payment_intent: { status: "requires_payment_method" } }],
]) {
  test(`${label} never grants complimentary Pro`, async () => {
    const { state, request } = setup(); complimentary(state); Object.assign(state.purchase, changes);
    assert.equal((await request("claim", { sessionId: id }, `pixelwall_checkout=${claim}`)).status, 409);
  });
}

test("discounted paid orders still enforce successful payment and full refunds", async () => {
  const { state, request, service } = setup();
  Object.assign(state.purchase, { amount_subtotal: 1900, amount_total: 950, total_details: { amount_discount: 950 } });
  state.purchase.payment_intent.latest_charge.amount = 950;
  const cookie = `pixelwall_pro=${await service.licenseFor(id)}`;
  assert.equal((await request("authorize", undefined, cookie)).status, 200);
  state.purchase.payment_intent.latest_charge.amount_refunded = 950;
  assert.equal((await request("authorize", undefined, cookie)).status, 403);
});

test("old open checkout links are replaced with promo-enabled checkout", async () => {
  const { state, request } = setup();
  state.purchase.status = "open"; state.purchase.url = "https://checkout.stripe.com/c/pay/old";
  const result = await request("checkout", undefined, `pixelwall_checkout=${claim}.${id}`);
  assert.equal(result.status, 200);
  const created = state.calls.find(call => call.options.method === "POST");
  assert.ok(created);
  assert.equal(created.options.body.get("allow_promotion_codes"), "true");
});

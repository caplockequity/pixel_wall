import test from "node:test";
import assert from "node:assert/strict";
import { aggregateStripeSessions } from "../app/business-scorecard.mjs";
import { createBillingService } from "../app/billing-core.mjs";

const paid = (overrides = {}) => ({
  livemode: true, mode: "payment", metadata: { app: "pixelwall-pro-v1" }, status: "complete", payment_status: "paid",
  currency: "usd", amount_total: 1500, line_items: { has_more: false, data: [{ price: { id: "price_pro" }, quantity: 1 }] },
  payment_intent: { latest_charge: { paid: true, status: "succeeded", amount: 1500, currency: "usd", livemode: true, amount_refunded: 0 } }, ...overrides,
});

test("scorecard counts verified paid, refunds, net, and complimentary orders without customer data", () => {
  const result = aggregateStripeSessions([
    paid(), paid({ amount_total: 2000, payment_intent: { latest_charge: { paid: true, status: "succeeded", amount: 2000, currency: "usd", livemode: true, amount_refunded: 500 } } }),
    paid({ payment_status: "no_payment_required", amount_total: 0, payment_intent: null }),
    paid({ metadata: { app: "other" } }), paid({ payment_status: "unpaid" }),
  ], { mode: "live", acceptedPrices: new Set(["price_pro"]), from: "2026-01-01", to: "2026-12-31", asOf: "2026-11-02T00:00:00.000Z" });
  assert.deepEqual(result.period, { kind: "checkout_created_cohort", from: "2026-01-01", to: "2026-12-31", as_of: "2026-11-02T00:00:00.000Z", currency_unit: "minor_units", excludes_stripe_fees_and_tax_remittance: true });
  assert.deepEqual(result.records, { scanned_sessions: 5, pixelwall_sessions: 4 });
  assert.equal(result.quality.complete, true);
  assert.equal(result.quality.unpaid_or_unfinished_sessions, 1);
  assert.deepEqual(result.orders, { paid: 2, complimentary: 1, refunded: 1 });
  assert.deepEqual(result.currencies.usd, { paid_orders: 2, complimentary_orders: 1, refunded_orders: 1, gross_amount: 3500, refunded_amount: 500, net_amount: 3000 });
  assert.equal(Object.hasOwn(result, "customer"), false);
});

test("scorecard excludes wrong mode, incomplete charges, malformed totals, and extra line items", () => {
  const result = aggregateStripeSessions([
    paid({ livemode: false }), paid({ payment_intent: { latest_charge: { paid: false, status: "failed", amount_refunded: 0 } } }),
    paid({ amount_total: -1 }), paid({ line_items: { has_more: true, data: [{ quantity: 1 }] } }),
  ], { mode: "live", acceptedPrices: new Set(["price_pro"]) });
  assert.deepEqual(result.orders, { paid: 0, complimentary: 0, refunded: 0 });
  assert.deepEqual(result.currencies, {});
});

const scoreEnv = { STRIPE_MODE: "live", STRIPE_SECRET_KEY: "sk_live_fixture", STRIPE_PRICE_ID: "price_pro", PIXELWALL_LICENSE_SECRET: "a".repeat(40), PIXELWALL_SITE_URL: "https://pixelwall.example" };
test("service scorecard requires bounded ISO endpoints", async () => {
  const service = createBillingService({ env: scoreEnv, fetch: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(service.scorecard(), /ISO UTC/);
  await assert.rejects(service.scorecard({ from: "2020-01-01T00:00:00Z", to: "2022-01-01T00:00:00Z" }), /one year/);
});

test("service scorecard rejects malformed and non-advancing Stripe pagination", async () => {
  for (const body of [{ data: [] }, { data: [], has_more: true }]) {
    const service = createBillingService({ env: scoreEnv, fetch: async () => Response.json(body) });
    await assert.rejects(service.scorecard({ from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z" }), /incomplete|advance/);
  }
});

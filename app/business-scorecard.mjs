// Verified business metrics are derived from Stripe's server-side Checkout
// records. This module intentionally returns only aggregates: no customer
// email, checkout/session ID, payment intent, or license value crosses the
// scorecard boundary.

const APP = "pixelwall-pro-v1";

function emptyCurrency() {
  return { paid_orders: 0, complimentary_orders: 0, refunded_orders: 0, gross_amount: 0, refunded_amount: 0, net_amount: 0 };
}

export function aggregateStripeSessions(sessions, { mode = "live", acceptedPrices = null, from = null, to = null, asOf = new Date().toISOString(), scannedSessions = sessions.length, appSessions = null } = {}) {
  const currencies = {};
  let paidOrders = 0;
  let complimentaryOrders = 0;
  let refundedOrders = 0;
  let unpaidSessions = 0, invalidSessions = 0;
  const matching = sessions.filter(session => session?.metadata?.app === APP);
  for (const session of matching) {
    if (session?.livemode !== (mode === "live") || session?.mode !== "payment") { invalidSessions++; continue; }
    if (['open', 'expired'].includes(session.status) || session.status === 'complete' && session.payment_status === 'unpaid') { unpaidSessions++; continue; }
    // Count every remaining invalid order explicitly; never turn missing payment
    // evidence into a clean zero-revenue result.
    invalidSessions++;
    if (session.status !== "complete" || !["paid", "no_payment_required"].includes(session.payment_status)) continue;
    const line = session.line_items?.data?.[0];
    if (session.line_items?.has_more || session.line_items?.data?.length !== 1 || !line || line.quantity !== 1) continue;
    if (acceptedPrices && !acceptedPrices.has(line.price?.id)) continue;
    const charge = session.payment_intent?.latest_charge;
    const currency = String(session.currency ?? "").toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) continue;
    const total = session.amount_total;
    if (!Number.isSafeInteger(total) || total < 0) continue;
    const refunded = Number(charge?.amount_refunded ?? 0);
    const hasCharge = session.payment_status === "paid" && charge?.paid === true && charge?.status === "succeeded";
    if (hasCharge) {
      const chargeAmount = charge.amount;
      if (!Number.isSafeInteger(chargeAmount) || chargeAmount < 0 || chargeAmount !== total || String(charge.currency ?? "").toLowerCase() !== currency || charge.livemode !== session.livemode) continue;
      if (!Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > chargeAmount) continue;
      currencies[currency] ??= emptyCurrency();
      const bucket = currencies[currency];
      paidOrders++;
      invalidSessions--;
      bucket.paid_orders++;
      bucket.gross_amount += total;
      bucket.refunded_amount += refunded;
      bucket.net_amount += total - refunded;
      if (refunded > 0) { refundedOrders++; bucket.refunded_orders++; }
    } else if (["paid", "no_payment_required"].includes(session.payment_status) && total === 0 && session.payment_intent == null) {
      currencies[currency] ??= emptyCurrency();
      const bucket = currencies[currency];
      complimentaryOrders++;
      invalidSessions--;
      bucket.complimentary_orders++;
    }
  }
  return {
    definition_version: 1,
    source: "stripe_checkout_sessions",
    mode,
    records: { scanned_sessions: scannedSessions, pixelwall_sessions: appSessions ?? matching.length },
    period: { kind: "checkout_created_cohort", from, to, as_of: asOf, currency_unit: "minor_units", excludes_stripe_fees_and_tax_remittance: true },
    orders: { paid: paidOrders, complimentary: complimentaryOrders, refunded: refundedOrders },
    currencies,
    quality: { complete: invalidSessions === 0, unpaid_or_unfinished_sessions: unpaidSessions, invalid_sessions: invalidSessions,
      warning: invalidSessions ? 'Some PixelWall orders lack valid payment evidence; totals include verified orders only.' : null },
    amount_definition: 'Receipts including collected tax, less successful refunds as of this report; before Stripe fees and tax remittance. Not profit or settled net revenue.',
  };
}

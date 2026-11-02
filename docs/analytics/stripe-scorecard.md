# Verified business scorecard

`node scripts/stripe-scorecard.mjs` reads Stripe Checkout Sessions with the
server-side key and emits aggregate purchase and refund totals. It never
prints or stores customer email addresses, Checkout IDs, payment IDs, license
codes, or artwork data. Use an explicit UTC interval:

```sh
node scripts/stripe-scorecard.mjs \
  --env /path/to/.env.production.local \
  --from 2026-01-01T00:00:00.000Z \
  --to 2026-02-01T00:00:00.000Z \
  --out /path/to/scorecard.json
```

The interval is an order-created cohort (`checkout_session.created`, inclusive
`from`, exclusive `to`), limited to one year. A paid order requires a completed
PixelWall Checkout Session, exactly one accepted PixelWall price, a successful
charge, and matching amount/currency/livemode. Complimentary orders are
reported separately when the completed total is zero and Stripe has no charge.
Refunds are the charge's cumulative `amount_refunded` at report time, so a
historical cohort should be refreshed periodically to observe later refunds.
`net_amount` means receipts after refunds, in Stripe minor currency units; it
includes collected tax and excludes Stripe fees and tax remittance. It is not
profit or a settlement-date revenue report.

The report includes quality categories for ordinary unpaid or unfinished
sessions versus completed sessions that fail paid-order validation. Treat a
report with invalid paid-session counts as an operational signal to inspect, not
as proof that excluded sessions were free or paid. Ordinary expired or unpaid
checkout attempts are expected funnel outcomes and do not make the verified
revenue total incomplete.

## Connected Stripe Analytics monitor

The connected Stripe Analytics account is Caplock Equity, Inc., live account
`acct_1SpgX3L8VVKMn2EG`. Use the Stripe Analytics tool with that context and
`livemode: true`; never paste or store the secret from `.env.production.local`.
Start each query with `search_query_tables`, retrieve the schemas for
`checkout_sessions`, `checkout_sessions_metadata`, `checkout_line_items`,
`charges`, and `refunds`, then run the query and retrieve its query-run result.
Keep the UTC bounds explicit and end-exclusive.

The baseline cohort query is:

```sql
WITH line_items AS (
  SELECT checkout_session_id, COUNT(*) AS line_count,
         MAX(price_id) AS price_id, SUM(quantity) AS total_quantity
  FROM checkout_line_items
  GROUP BY checkout_session_id
), pixelwall_sessions AS (
  SELECT DISTINCT s.id, s.created, s.status, s.currency, s.payment_intent_id,
         p.amount AS intent_amount, p.status AS intent_status
  FROM checkout_sessions s
  JOIN checkout_sessions_metadata m ON m.checkout_session_id = s.id
  JOIN line_items li ON li.checkout_session_id = s.id
  LEFT JOIN payment_intents p ON p.id = s.payment_intent_id
  WHERE s.created >= TIMESTAMP '2025-11-03 00:00:00'
    AND s.created < TIMESTAMP '2026-11-03 00:00:00'
    AND s.mode = 'payment'
    AND m.key = 'app' AND m.value = 'pixelwall-pro-v1'
    AND li.line_count = 1 AND li.total_quantity = 1
    AND li.price_id IN ('price_1UDo50L8VVKMn2EGsmaVDH6i','price_1UDTFVL8VVKMn2EGcBFnIvOz')
), ranked_charges AS (
  SELECT c.*, ROW_NUMBER() OVER (
    PARTITION BY c.payment_intent
    ORDER BY CASE WHEN c.paid = true AND c.status = 'succeeded' AND c.captured = true THEN 0 ELSE 1 END,
             c.created DESC, c.id DESC
  ) AS charge_rank
  FROM charges c JOIN pixelwall_sessions s ON s.payment_intent_id = c.payment_intent
), one_charge AS (SELECT * FROM ranked_charges WHERE charge_rank = 1)
  SELECT COALESCE(c.currency, s.currency) AS currency,
  COUNT(DISTINCT CASE WHEN s.status = 'complete' AND s.intent_status = 'succeeded'
    AND c.paid = true AND c.status = 'succeeded' AND c.captured = true
    AND c.amount = s.intent_amount AND LOWER(c.currency) = LOWER(s.currency) THEN s.id END) AS paid_orders,
  COUNT(DISTINCT CASE WHEN s.status = 'complete' AND s.payment_intent_id IS NULL THEN s.id END) AS no_charge_completed_sessions,
  COUNT(DISTINCT CASE WHEN s.status = 'complete' AND s.payment_intent_id IS NOT NULL
    AND NOT (s.intent_status = 'succeeded' AND c.paid = true AND c.status = 'succeeded'
      AND c.captured = true AND c.amount = s.intent_amount
      AND LOWER(c.currency) = LOWER(s.currency)) THEN s.id END) AS invalid_paid_or_incomplete_sessions,
  COUNT(DISTINCT CASE WHEN s.status <> 'complete' THEN s.id END) AS ordinary_unpaid_or_unfinished,
  COALESCE(SUM(CASE WHEN s.status = 'complete' AND s.intent_status = 'succeeded'
    AND c.paid = true AND c.status = 'succeeded' AND c.captured = true
    AND c.amount = s.intent_amount AND LOWER(c.currency) = LOWER(s.currency) THEN c.amount ELSE 0 END), 0) AS gross_amount,
  COALESCE(SUM(CASE WHEN s.status = 'complete' AND s.intent_status = 'succeeded'
    AND c.paid = true AND c.status = 'succeeded' AND c.captured = true
    AND c.amount = s.intent_amount AND LOWER(c.currency) = LOWER(s.currency) THEN c.amount_refunded ELSE 0 END), 0) AS refunded_amount
FROM pixelwall_sessions s
LEFT JOIN one_charge c ON c.payment_intent = s.payment_intent_id
GROUP BY 1;
```

The separate refund-cashflow query catches refunds of older orders during the
current monitoring week:

```sql
WITH line_items AS (
  SELECT checkout_session_id, COUNT(*) AS line_count,
         MAX(price_id) AS price_id, SUM(quantity) AS total_quantity
  FROM checkout_line_items
  GROUP BY checkout_session_id
), pixelwall_charges AS (
  SELECT DISTINCT c.id
  FROM charges c
  JOIN checkout_sessions s ON s.payment_intent_id = c.payment_intent
  JOIN checkout_sessions_metadata m ON m.checkout_session_id = s.id
  JOIN line_items li ON li.checkout_session_id = s.id
  WHERE s.mode = 'payment'
    AND m.key = 'app' AND m.value = 'pixelwall-pro-v1'
    AND li.line_count = 1 AND li.total_quantity = 1
    AND li.price_id IN ('price_1UDo50L8VVKMn2EGsmaVDH6i','price_1UDTFVL8VVKMn2EGcBFnIvOz')
)
SELECT LOWER(r.currency) AS currency,
  COUNT(DISTINCT r.id) AS successful_refunds,
  COALESCE(SUM(r.amount), 0) AS refund_amount
FROM refunds r
JOIN pixelwall_charges c ON c.id = r.charge_id
WHERE r.status = 'succeeded'
  AND r.created >= TIMESTAMP '2026-10-27 00:00:00'
  AND r.created < TIMESTAMP '2026-11-03 00:00:00'
GROUP BY 1;
```

The first query is a checkout-created cohort; the second is refund cashflow by
refund-created date. Both use Stripe minor units. Do not call the receipt
calculation profit or settlement net: it includes collected tax and excludes
Stripe fees and tax remittance. As of the 2025-11-03 through 2026-11-03 live
check, the connected result was three completed no-charge USD sessions, zero
paid orders, zero gross paid amount, and zero successful refunds. The local
scorecard additionally recorded four expired or unpaid PixelWall sessions.
The Sigma schema does not expose Checkout `amount_total`, so the connected
cohort uses the PaymentIntent amount and treats a completed session with no
PaymentIntent as complimentary; the local API scorecard remains the stricter
source for payment-status and total validation. Keep the two results side by
side as a cross-check rather than silently substituting one for the other.

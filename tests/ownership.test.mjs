import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { signOfflineLicense, offlineSigningConfig } from '../app/offline-license-server.mjs';
import { verifyOfflineLicense, base64url, fromBase64url } from '../app/offline-license.mjs';
import { createBillingService } from '../app/billing-core.mjs';
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const privateKey = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const publicKey = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
const publicKeys = { ownership2026: publicKey }; const keyId = 'ownership2026'; const id = 'cs_test_example12345678';
const env = { STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_PRICE_ID: 'price_new15', STRIPE_HISTORICAL_PRICE_IDS: 'price_old19', PIXELWALL_LICENSE_SECRET: 'test-signing-secret-that-is-long-enough', PIXELWALL_SITE_URL: 'https://pixelwall.example', PIXELWALL_LICENSE_KEY_ID: keyId, PIXELWALL_OFFLINE_PRIVATE_JWK: JSON.stringify(privateKey), PIXELWALL_LICENSE_PUBLIC_KEYS: JSON.stringify(publicKeys) };
const signed = () => signOfflineLicense(id, { mode: 'test', keyId, privateKey, publicKeys });
test('perpetual owner license verifies offline and survives years without renewal', async () => {
 const token = await signed(); const claims = await verifyOfflineLicense(token, { mode: 'test', publicKeys });
 assert.equal(claims.purchaseId, id); assert.equal(claims.perpetual, true); assert.equal(claims.expiresAt, undefined);
 assert.equal(await verifyOfflineLicense(token, { mode: 'live', publicKeys }), null);
 assert.equal(await verifyOfflineLicense(token, { mode: 'test', publicKeys: {} }), null);
});
test('tampering, unknown key, wrong product, and unsigned local flags cannot unlock Pro', async () => {
 const token = await signed(); const parts = token.split('.'); const claims = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])));
 for (const patch of [{ product: 'another-app' }, { keyId: 'untrusted' }, { purchaseId: 'cs_test_other12345678' }, { mode: 'live' }, { perpetual: false }, { expiresAt: 9999999999 }]) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ ...claims, ...patch })));
  assert.equal(await verifyOfflineLicense(`PW2.${payload}.${parts[2]}`, { mode: 'test', publicKeys }), null);
 }
 assert.equal(await verifyOfflineLicense('true', { mode: 'test', publicKeys }), null);
 assert.equal(offlineSigningConfig({ ...env, PIXELWALL_LICENSE_PUBLIC_KEYS: '{}' }).ready, false);
});
function setup() {
 let refunded = false; const calls = [];
 const service = createBillingService({ env, crypto: webcrypto, fetch: async (url, options) => { calls.push({ url, options }); if (url.includes('/prices/')) return Response.json({ active: true, type: 'one_time', currency: 'usd', unit_amount: 1500, livemode: false }); if (options.method === 'POST') return Response.json({ id, url: 'https://checkout.stripe.com/c/pay/ok' }); return Response.json({ id, mode: 'payment', livemode: false, metadata: { app: 'pixelwall-pro-v1' }, status: 'complete', payment_status: 'paid', line_items: { has_more: false, data: [{ price: { id: 'price_old19' }, quantity: 1 }] }, payment_intent: { status: 'succeeded', latest_charge: { id: 'ch_example', status: 'succeeded', paid: true, amount: 1900, refunded, amount_refunded: refunded ? 1900 : 0, disputed: false } } }); } });
 const req = (action, code) => service.handle(new Request(`https://pixelwall.example/api/billing/${action}`, { method: action === 'status' ? 'GET' : 'POST', headers: { origin: 'https://pixelwall.example', 'Content-Type': 'application/json', ...(action === 'status' ? { cookie: `pixelwall_pro=${code}` } : {}) }, ...(action === 'status' ? {} : { body: JSON.stringify({ code }) }) }));
 return { service, calls, req, refund: () => { refunded = true; } };
}
test('existing $19 PW1 purchases convert to signed ownership; current $15 checkout price stays server controlled', async () => {
 const { service, req, calls } = setup(); const code = await service.licenseFor(id);
 const converted = await (await req('restore', code)).json(); assert.equal(converted.pro, true); assert.ok(await verifyOfflineLicense(converted.offlineLicense, { mode: 'test', publicKeys }));
 const status = await (await req('status', code)).json(); assert.ok(status.offlineLicense);
 const checkout = await req('checkout'); assert.equal(checkout.status, 200); assert.equal(calls.at(-1).options.body.get('line_items[0][price]'), 'price_new15');
});
test('online status observes refunds for new signed licenses while saved offline proofs remain perpetual', async () => {
 const { req, refund } = setup(); const token = await signed(); refund(); const status = await (await req('status', token)).json(); assert.equal(status.pro, false); assert.equal(status.reason, 'refunded');
 assert.ok(await verifyOfflineLicense(token, { mode: 'test', publicKeys }));
});

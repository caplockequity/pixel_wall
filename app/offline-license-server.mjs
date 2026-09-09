// SERVER ONLY. Never import this file from a client component.
import { base64url, LICENSE_PRODUCT, LICENSE_VERSION, verifyOfflineLicense, parsePublicKeys } from './offline-license.mjs';
const encoder = new TextEncoder();
export function offlineSigningConfig(env) {
  const keyId = env.PIXELWALL_LICENSE_KEY_ID?.trim() ?? '';
  const publicKeys = parsePublicKeys(env.PIXELWALL_LICENSE_PUBLIC_KEYS ?? env.NEXT_PUBLIC_PIXELWALL_LICENSE_PUBLIC_KEYS);
  let privateKey;
  try { privateKey = JSON.parse(env.PIXELWALL_OFFLINE_PRIVATE_JWK ?? 'null'); } catch { /* Incomplete setup is handled without revealing key material. */ }
  const ready = Boolean(/^[A-Za-z0-9_-]{1,64}$/.test(keyId) && publicKeys[keyId] && privateKey?.kty === 'EC' && privateKey.crv === 'P-256' && privateKey.d && privateKey.x === publicKeys[keyId].x && privateKey.y === publicKeys[keyId].y);
  return { keyId, publicKeys, privateKey, ready };
}
export async function signOfflineLicense(purchaseId, { mode, keyId, privateKey, publicKeys, crypto = globalThis.crypto, now = Date.now }) {
  if (!['live', 'test'].includes(mode) || !new RegExp(`^cs_${mode}_[a-zA-Z0-9]{8,200}$`).test(purchaseId)) throw new Error('Invalid license purchase');
  const claims = { version: LICENSE_VERSION, product: LICENSE_PRODUCT, purchaseId, mode, keyId, issuedAt: Math.floor(now() / 1000), perpetual: true };
  const payload = base64url(encoder.encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey('jwk', privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(`PW2.${payload}`));
  const token = `PW2.${payload}.${base64url(signature)}`;
  if (!await verifyOfflineLicense(token, { publicKeys, mode, crypto })) throw new Error('License signing configuration is inconsistent');
  return token;
}

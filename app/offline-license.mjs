/** Portable, non-expiring ownership proof. Runs in modern browsers and Node.
 * Only a pinned public key verifies access; token data never supplies a key.
 * Server signing module is separate and MUST NOT be imported by client code.
 */
export const LICENSE_PRODUCT = 'pixelwall-pro';
export const LICENSE_VERSION = 2;
const encoder = new TextEncoder();
export function base64url(bytes) { let binary = ''; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function fromBase64url(value) { if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid license encoding'); const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')); return Uint8Array.from(raw, (char) => char.charCodeAt(0)); }
export function parsePublicKeys(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, key]) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && key?.kty === 'EC' && key.crv === 'P-256' && typeof key.x === 'string' && typeof key.y === 'string' && !key.d));
}
/** Returns verified claims or null. A disconnected clock never expires a purchase.
 * @param {string} token
 * @param {{publicKeys?: Record<string, JsonWebKey> | string, mode?: string, crypto?: Crypto}} [options]
 */
export async function verifyOfflineLicense(token, { publicKeys, mode = 'live', crypto = globalThis.crypto } = {}) {
  try {
    if (typeof token !== 'string' || token.length > 4096 || !crypto?.subtle) return null;
    const parts = token.trim().split('.'); if (parts.length !== 3 || parts[0] !== 'PW2') return null;
    const payloadBytes = fromBase64url(parts[1]); const signature = fromBase64url(parts[2]); if (signature.length !== 64 || payloadBytes.length > 2000) return null;
    const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
    if (claims.version !== LICENSE_VERSION || claims.product !== LICENSE_PRODUCT || claims.mode !== mode || !['live', 'test'].includes(claims.mode) || !/^cs_(test|live)_[a-zA-Z0-9]{8,200}$/.test(claims.purchaseId) || !claims.purchaseId.startsWith(`cs_${mode}_`) || !Number.isSafeInteger(claims.issuedAt) || claims.issuedAt <= 0 || claims.perpetual !== true || Object.hasOwn(claims, 'expiresAt')) return null;
    const keys = parsePublicKeys(publicKeys); const jwk = keys[claims.keyId]; if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, encoder.encode(`PW2.${parts[1]}`));
    return valid ? claims : null;
  } catch { return null; }
}

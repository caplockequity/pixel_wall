#!/usr/bin/env node
// Offline signing-key provisioning helper. Writes files; never logs secrets.
import { webcrypto } from 'node:crypto';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const directory = resolve(process.argv[2] ?? '.pixelwall-keys');
const keyId = process.argv[3] ?? 'ownership-2026';
if (!/^[A-Za-z0-9_-]{1,64}$/.test(keyId)) throw new Error('Choose an alphanumeric key ID');
await mkdir(directory, { recursive: true, mode: 0o700 });
const secretFile = join(directory, `${keyId}.private.jwk.json`);
try { await stat(secretFile); throw new Error('A signing key already exists here. Reuse it; never replace a key accidentally.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const privateKey = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const publicKey = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
await writeFile(secretFile, JSON.stringify(privateKey), { flag: 'wx', mode: 0o600 });
await writeFile(join(directory, `${keyId}.public-keys.json`), JSON.stringify({ [keyId]: publicKey }, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
console.log(`Created signing-key files in ${directory}. Provision the private JWK as a server secret; commit only the public-key map.`);

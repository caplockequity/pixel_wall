// Test-only Node transport around the real browser worker module. The local
// installed Wasmoon asset replaces browser fetching; production origin checks
// remain in the browser runner exercised by this harness.
import { parentPort } from 'node:worker_threads';
globalThis.self = { postMessage: message => parentPort.postMessage(message) };
await import('../../app/lua-browser-worker.mjs');
parentPort.on('message', message => self.onmessage({ data: message.request ? { ...message, wasmUri: undefined } : message }));

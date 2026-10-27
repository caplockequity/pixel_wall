/** Bounded durable retry receipts. Artwork and command payloads never enter this store.
 * An unfinished receipt is deliberately ambiguous after restart: never replay it.
 * Records do not expire automatically, so an old retry key cannot become a new edit.
 */
export const RECEIPT_LIMIT = 1024;
export const RECEIPT_BYTE_LIMIT = 2 * 1024 * 1024;
const request = operation => new Promise((resolve, reject) => { operation.onsuccess = () => resolve(operation.result); operation.onerror = () => reject(operation.error); });
const finished = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || Error('Receipt transaction was interrupted.')); tx.onerror = () => {}; });
const copy = value => structuredClone(value);
function validateKey(key) { if (typeof key !== 'string' || !key.length || key.length > 200) throw Error('A receipt key must contain 1–200 characters.'); }
function validateRecord(record) {
  validateKey(record.requestKey);
  if (!/^[a-f0-9]{64}$/.test(record.payloadHash)) throw Error('A receipt requires a SHA-256 payload hash.');
  if (!['pending', 'completed', 'failed', 'cancelled'].includes(record.status)) throw Error('Invalid receipt outcome.');
  if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 8192) throw Error('Receipt metadata exceeds 8 KiB.');
}
export async function openOperationReceipts({ indexedDB = globalThis.indexedDB, name = 'pixelwall-operation-receipts-v1', limit = RECEIPT_LIMIT, byteLimit = RECEIPT_BYTE_LIMIT, now = Date.now } = {}) {
  if (!indexedDB) throw Error('Durable operation receipts are unavailable in this environment.');
  const opening = indexedDB.open(name, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore('receipts', { keyPath: 'requestKey' });
  const db = await request(opening);
  db.onversionchange = () => db.close();
  async function transaction(mode, work) {
    const tx = db.transaction('receipts', mode), done = finished(tx);
    try { const result = await work(tx.objectStore('receipts')); await done; return result; }
    catch (error) { try { tx.abort(); } catch { /* already completed */ } await done.catch(() => {}); throw error; }
  }
  async function fit(store, record) {
    validateRecord(record);
    const records = await request(store.getAll());
    const retained = records.filter(item => item.requestKey !== record.requestKey);
    if (retained.length >= limit || new TextEncoder().encode(JSON.stringify([...retained, record])).byteLength > byteLimit)
      throw Object.assign(Error('The durable retry receipt budget is full. Existing retry keys remain protected; no edit was started.'), { code: 'RECEIPT_BUDGET_EXCEEDED' });
  }
  return {
    get: key => { validateKey(key); return transaction('readonly', async store => (await request(store.get(key))) ?? null); },
    list: () => transaction('readonly', async store => (await request(store.getAll())).sort((a,b) => b.updatedAt - a.updatedAt)),
    claim: input => transaction('readwrite', async store => {
      validateRecord(input);
      const previous = await request(store.get(input.requestKey));
      if (previous) return { claimed: false, receipt: previous };
      const receipt = { ...copy(input), createdAt: now(), updatedAt: now() };
      await fit(store, receipt); store.put(receipt); return { claimed: true, receipt };
    }),
    update: (key, patch) => transaction('readwrite', async store => {
      validateKey(key);
      const previous = await request(store.get(key));
      if (!previous) throw Error('Operation receipt is missing.');
      const receipt = { ...previous, ...copy(patch), requestKey: key, payloadHash: previous.payloadHash, updatedAt: now() };
      await fit(store, receipt); store.put(receipt); return receipt;
    }),
    close: () => db.close(),
  };
}

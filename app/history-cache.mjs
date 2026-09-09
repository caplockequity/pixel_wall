import { createHistory, historyValuesEqual } from './history.mjs';

/** Session-only ownership cache: parked histories must not be edited until acquired.
 * Budget includes inactive documents and all Undo entries; reserve the active
 * history's maximum entry budget so paint operations need no cache bookkeeping.
 * The active document itself is already owned by the editor and is not extra cache memory.
 */
export function createDocumentHistoryCache({ maxBytes = 128 * 1024 * 1024, activeBudgetBytes = Math.min(maxBytes, 64 * 1024 * 1024), maxDocuments = 8, historyOptions = {}, onEvict = () => {} } = {}) {
  for (const [name, value] of Object.entries({ maxBytes, activeBudgetBytes, maxDocuments })) if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a nonnegative integer.`);
  if (activeBudgetBytes > maxBytes) throw new RangeError('The active Undo budget must fit the total cache budget.');
  if (historyOptions.maxBytes !== undefined && (!Number.isSafeInteger(historyOptions.maxBytes) || historyOptions.maxBytes < 0)) throw new TypeError('History maxBytes must be a nonnegative integer.');
  const entries = new Map(), freshOptions = { ...historyOptions, maxBytes: Math.min(historyOptions.maxBytes ?? activeBudgetBytes, activeBudgetBytes) };
  const validRevision = revision => Number.isSafeInteger(revision) && revision > 0;
  const retained = () => [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  function drop(id, reason) { const found = entries.get(id); if (!found) return false; entries.delete(id); onEvict({ documentId: id, reason }); return true; }
  function prune() {
    while (entries.size && (entries.size > maxDocuments || retained() + activeBudgetBytes > maxBytes)) drop(entries.keys().next().value, 'budget');
  }
  return {
    park({ history, document, storedRevision } = {}) {
      const id = document?.id;
      if (!id || !history || history.inTransaction || history.stats.maxBytes > activeBudgetBytes || !validRevision(storedRevision) || !historyValuesEqual(history.present, document)) {
        if (id) drop(id, 'not-saved');
        return { cached: false, reason: 'Only a completed history matching its durable saved document can be cached.' };
      }
      drop(id, 'replaced'); entries.set(id, { history, storedRevision, bytes: history.retainedBytes }); prune();
      return { cached: entries.has(id), reason: entries.has(id) ? null : 'This history exceeds the shared cache budget.' };
    },
    acquire(document, { storedRevision } = {}) {
      if (!document?.id) throw new TypeError('History requires a document ID.');
      const entry = entries.get(document.id); entries.delete(document.id);
      const reused = !!entry && validRevision(storedRevision) && entry.storedRevision === storedRevision && !entry.history.inTransaction && historyValuesEqual(entry.history.present, document);
      const history = reused ? entry.history : createHistory(document, freshOptions);
      if (entry && !reused) onEvict({ documentId: document.id, reason: 'changed' });
      prune();
      return { history, reused, reason: reused ? null : entry ? 'The saved document changed; its previous Undo history was discarded.' : null };
    },
    invalidate(documentId) { return drop(documentId, 'invalidated'); },
    clear() { for (const id of [...entries.keys()]) drop(id, 'cleared'); },
    get stats() { prune(); const parkedBytes = retained(); return { documents: entries.size, documentIds: [...entries.keys()], parkedBytes, reservedActiveBytes: activeBudgetBytes, bytes: parkedBytes + activeBudgetBytes, maxBytes, maxDocuments }; },
  };
}

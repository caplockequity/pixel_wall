/** In-memory reusable selection registry scoped to document identity and revision. */
export function createSelectionRegistry({maxEntries=128}={}) {
  const entries=new Map();
  function key(documentId,revision,selectionId){return `${documentId}:${revision}:${selectionId}`;}
  return {
    create({documentId,revision,id,selection}) { if(typeof documentId!=='string'||!Number.isSafeInteger(revision)||typeof id!=='string'||!id) throw Error('Selection identity is invalid.'); const value=structuredClone(selection); const entry={id,documentId,revision,selection:value}; entries.set(key(documentId,revision,id),entry); while(entries.size>maxEntries) entries.delete(entries.keys().next().value); return structuredClone(entry); },
    resolve({documentId,revision,id}) { const entry=entries.get(key(documentId,revision,id)); if(!entry) throw Error('Selection is missing or belongs to another document revision.'); return structuredClone(entry.selection); },
    remove({documentId,revision,id}) { return entries.delete(key(documentId,revision,id)); },
    clearDocument(documentId) { for(const [key,entry] of entries) if(entry.documentId===documentId) entries.delete(key); },
    list({documentId,revision}={}) { return [...entries.values()].filter(entry=>(documentId===undefined||entry.documentId===documentId)&&(revision===undefined||entry.revision===revision)).map(entry=>({id:entry.id,documentId:entry.documentId,revision:entry.revision})); },
  };
}

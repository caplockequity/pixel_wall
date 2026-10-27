/** Session selections are scoped to an exact document revision and bounded by encoded bytes. */
export function createSelectionRegistry({maxEntries=128,maxBytes=16*1024*1024}={}) {
  const entries=new Map();let bytes=0;
  const key=({documentId,revision,id})=>JSON.stringify([documentId,revision,id]);
  function identity(value) {
    if(typeof value.documentId!=='string'||!value.documentId||value.documentId.length>200||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.id!=='string'||!value.id||value.id.length>200)
      throw Error('Selection identity requires a document ID, nonnegative revision, and a 1–200 character selection ID.');
  }
  return {
    create(value) {
      identity(value);
      const text=JSON.stringify(value.selection);if(!text)throw Error('Selection data is required.');
      const size=new TextEncoder().encode(text).byteLength,entryKey=key(value),old=entries.get(entryKey);
      if(size>maxBytes||bytes-(old?.bytes??0)+size>maxBytes||(!old&&entries.size>=maxEntries))throw Error('Selection cache is full. Remove an unused selection explicitly.');
      const entry={id:value.id,documentId:value.documentId,revision:value.revision,selection:JSON.parse(text),bytes:size};
      entries.set(entryKey,entry);bytes+=size-(old?.bytes??0);return structuredClone(entry);
    },
    resolve(value) {identity(value);const entry=entries.get(key(value));if(!entry)throw Error('Selection is missing or belongs to another document revision.');return structuredClone(entry.selection);},
    remove(value) {identity(value);const entry=entries.get(key(value));if(!entry)return false;bytes-=entry.bytes;return entries.delete(key(value));},
    clearDocument(documentId) {for(const [id,entry]of entries)if(entry.documentId===documentId){bytes-=entry.bytes;entries.delete(id);}},
    list({documentId,revision}={}) {return [...entries.values()].filter(e=>(documentId===undefined||e.documentId===documentId)&&(revision===undefined||e.revision===revision)).map(({id,documentId,revision,bytes})=>({id,documentId,revision,bytes}));},
  };
}

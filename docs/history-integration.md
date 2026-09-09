# Session history and Lua UI context

`createHistory` preserves the existing document-only API. Lua commits can additionally call `history.commit(nextDocument, 'Lua script', {beforeContext,afterContext})`, where each context is an explicit plain UI state (or null), optionally containing typed selection masks. Both contexts are defensively cloned, and a context-only change records a transaction even if `nextDocument === history.present`. Identical artwork/context records nothing and preserves Redo. Do not submit context commits during an open paint gesture.

After calling Undo or Redo, read `history.lastContext` **once**. It is a detached before/after snapshot when the entry supplied UI state, or `undefined` for ordinary artwork history and exhausted stacks. Apply the returned selection and range when `!== undefined`; otherwise keep existing ordinary-Undo selection-clearing behavior. A selection-only Undo can change UI while returning the identical document reference: the workbench must not skip it based on `history.present === docRef.current`. Use `canUndo`/`canRedo` captured before the action to decide whether an action occurred, update UI/history state, and advance the relevant automation revision for a context change.

Context snapshots count against existing entry limits and bytes; the default context-input limit is 16 MiB, accommodating two independent 4 MiB masks. Typed arrays remain typed arrays and use byte-based accounting. Shared mutable buffers are rejected. Context snapshots are session state only and do not enter project files or the IndexedDB document schema. A transaction too large for `maxBytes` is pruned under existing history behavior: inspect `lastChange.recorded` to present any existing history-limit notice.

`createDocumentHistoryCache()` is a pure session cache; create it once in a ref. Defaults are a 128 MiB additional history/cache estimate, reserving 64 MiB for the current document's maximum history-entry budget, and at most eight inactive documents. Inactive retention estimates include complete present documents, Undo/Redo patches and UI contexts. The active document's pixels are already held by the editor and excluded from this additional memory estimate. This is estimated JS data retention, not a promise about browser heap overhead or immediately reclaimed GC memory.

Immediately before changing the active document, after its queued device save succeeds, call:

```js
cache.park({
  history: historyRef.current,
  document: savedDocumentsRef.current.get(docRef.current.id),
  storedRevision: savedRevisionsRef.current.get(docRef.current.id),
});
```

`park` refuses missing/nonpositive storage revisions, incomplete gestures, a history exceeding the reserved active budget, or history content differing from the saved snapshot. It keeps the existing history instance, so the caller must not mutate it while parked. LRU eviction releases ownership without altering documents or existing histories.

When installing a document that would currently create a new history:

```js
const {history,reused} = cache.acquire(loaded.document, {
  storedRevision: loaded.revision,
});
historyRef.current = history;
docRef.current = history.present;
```

`acquire` consumes a cached entry. It reuses only the same document ID, the exact persisted revision, and exact document content. A reload/recovery/external write with another revision or changed content gets a fresh history. It creates fresh histories within the reserved entry budget, applying any configured `historyOptions`. Existing per-document edit/native revisions remain separate from these IDB revisions.

Call `invalidate(id)` when deleting a project, replacing its document state through a deliberate recovery, or atomically saving an inactive project from Lua. New documents acquire fresh histories. Lua can park each newly created document's seed→final history after durable multi-document save; active Lua commits should retain the current history rather than parking/resetting it. Cache entries are never persisted across app relaunch. Changing tabs within a session retains Undo/Redo; opening a newly changed file intentionally starts a fresh stack. `clear()` releases all parked references, and `stats` exposes the LRU IDs, retained bytes, reservation and limits.

The Workbench now applies this flow to project switching and Lua commits. Actual desktop checks confirm selection/color-only native Undo and history retention after switching away and back within the same session.

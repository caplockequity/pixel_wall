/** Immutable document history. One gesture = one transaction; shared image data
 * is never cloned during update(). commit() stores sparse changed pixel spans.
 * Callers replace changed arrays/objects; do not mutate .present in place.
 */
const isTyped = (value) => ArrayBuffer.isView(value) && !(value instanceof DataView);
const isObject = (value) => value !== null && typeof value === 'object';
const isPlain = (value) => isObject(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function cost(value, seen = new Set()) { if (!isObject(value)) return typeof value === 'string' ? value.length * 2 : 8; if (seen.has(value)) return 0; seen.add(value); if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value.byteLength; return 32 + Object.entries(value).reduce((total, [key, entry]) => total + key.length * 2 + cost(entry, seen), 0); }
function primitiveArray(value) { return Array.isArray(value) && value.every((item) => !isObject(item)); }
function spans(before, after, path, patches) {
  let start = -1;
  for (let index = 0; index <= after.length; index++) {
    if (index < after.length && !Object.is(before[index], after[index])) { if (start < 0) start = index; }
    else if (start >= 0) { patches.push({ kind: 'span', path, start, before: before.slice(start, index), after: after.slice(start, index) }); start = -1; }
  }
}
export function diffDocuments(before, after) {
  const patches = [];
  function visit(a, b, path) {
    if (Object.is(a, b)) return;
    if ((isTyped(a) && isTyped(b) && a.constructor === b.constructor || primitiveArray(a) && primitiveArray(b)) && a.length === b.length) { spans(a, b, path, patches); return; }
    if (isPlain(a) && isPlain(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const oldExists = Object.hasOwn(a, key); const newExists = Object.hasOwn(b, key);
        if (!oldExists || !newExists) patches.push({ kind: 'value', path: [...path, key], before: a[key], after: b[key], oldExists, newExists });
        else visit(a[key], b[key], [...path, key]);
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) { for (let i = 0; i < a.length; i++) visit(a[i], b[i], [...path, i]); return; }
    patches.push({ kind: 'value', path, before: a, after: b, oldExists: true, newExists: true });
  }
  visit(before, after, []);
  return patches;
}
function copy(value) { if (isTyped(value)) return value.slice(); if (Array.isArray(value)) return [...value]; return { ...value }; }
export function applyPatches(document, patches, direction = 'after') {
  let root = document;
  const copies = new WeakMap();
  function clone(value) { if (!isObject(value)) throw new TypeError('Cannot apply history to an incompatible document'); if (copies.has(value)) return copies.get(value); const result = copy(value); copies.set(value, result); copies.set(result, result); return result; }
  function writable(path) {
    root = clone(root); let current = root;
    for (const part of path) { current[part] = clone(current[part]); current = current[part]; }
    return current;
  }
  for (const patch of patches) {
    if (patch.kind === 'span') { const target = writable(patch.path); const values = patch[direction]; for (let i = 0; i < values.length; i++) target[patch.start + i] = values[i]; }
    else if (!patch.path.length) { root = patch[direction]; }
    else { const parent = writable(patch.path.slice(0, -1)); const key = patch.path.at(-1); if (direction === 'after' ? patch.newExists : patch.oldExists) parent[key] = patch[direction]; else delete parent[key]; }
  }
  return root;
}
/** @template T
 * @param {T} initial
 * @param {{maxBytes?:number,maxEntries?:number,onPrune?:(info:{count:number,labels:string[],bytes:number})=>void}} [options]
 */
export function createHistory(initial, { maxBytes = 32 * 1024 * 1024, maxEntries = 100, onPrune } = {}) {
  let present = initial; let past = []; let future = []; let transaction = null; let lastChange = null;
  function prune() {
    const dropped = [];
    let bytes = [...past, ...future].reduce((sum, entry) => sum + entry.bytes, 0);
    while (past.length + future.length > maxEntries || bytes > maxBytes) { const removed = past.length ? past.shift() : future.shift(); if (!removed) break; bytes -= removed.bytes; dropped.push(removed.label); }
    if (dropped.length) onPrune?.({ count: dropped.length, labels: dropped, bytes });
    return dropped;
  }
  function record(before, next, label) {
    const patches = diffDocuments(before, next); present = next;
    if (!patches.length) { lastChange = { changed: false, recorded: false, pruned: 0 }; return present; }
    future = [];
    const entry = { label, patches, bytes: cost(patches) };
    past.push(entry);
    const dropped = prune();
    lastChange = { changed: true, recorded: past.includes(entry), pruned: dropped.length, bytes: entry.bytes };
    return present;
  }
  const history = {
    get present() { return present; },
    get canUndo() { return Boolean(past.length || transaction && transaction.before !== present); },
    get canRedo() { return !transaction && future.length > 0; },
    get undoLabel() { return transaction?.label ?? past.at(-1)?.label ?? ''; },
    get redoLabel() { return future.at(-1)?.label ?? ''; },
    get inTransaction() { return Boolean(transaction); },
    get lastChange() { return lastChange; },
    get stats() { return { undo: past.length, redo: future.length, bytes: [...past, ...future].reduce((sum, entry) => sum + entry.bytes, 0), maxBytes, maxEntries }; },
    commit(next, label = 'Edit') { if (transaction) { present = next; return present; } return record(present, next, label); },
    begin(label = 'Draw') { if (transaction) throw new Error('A history transaction is already active'); transaction = { before: present, label }; return present; },
    update(next) { if (!transaction) throw new Error('Begin a history transaction before updating it'); present = next; return present; },
    end(next = present) { if (!transaction) return present; const { before, label } = transaction; transaction = null; return record(before, next, label); },
    cancel() { if (transaction) present = transaction.before; transaction = null; return present; },
    undo() { if (transaction) history.end(); const entry = past.pop(); if (entry) { present = applyPatches(present, entry.patches, 'before'); future.push(entry); } return present; },
    redo() { if (transaction) history.end(); const entry = future.pop(); if (entry) { present = applyPatches(present, entry.patches, 'after'); past.push(entry); } return present; },
    reset(next) { present = next; past = []; future = []; transaction = null; lastChange = null; return present; },
  };
  return history;
}

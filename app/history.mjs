/** Immutable document history. One gesture = one transaction; shared image data
 * is never cloned during update(). commit() stores sparse changed pixel spans.
 * Callers replace changed arrays/objects; do not mutate .present in place.
 */
const isTyped = (value) => ArrayBuffer.isView(value) && !(value instanceof DataView);
const isObject = (value) => value !== null && typeof value === 'object';
const isPlain = (value) => isObject(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function cost(value, seen = new Set()) { if (!isObject(value)) return typeof value === 'string' ? value.length * 2 : 8; if (seen.has(value)) return 0; seen.add(value); if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value.byteLength; let total = 32; if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) total += cost(value[i], seen); } else for (const key of Object.keys(value)) total += key.length * 2 + cost(value[key], seen); return total; }
/** Equality without allocating diffs or converting large typed selection masks to JSON. */
export function historyValuesEqual(a, b, seen = new WeakMap()) {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b) || a.constructor !== b.constructor) return false;
  if (ArrayBuffer.isView(a) || a instanceof ArrayBuffer) {
    if (a.byteLength !== b.byteLength) return false;
    const left = ArrayBuffer.isView(a) ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength) : new Uint8Array(a);
    const right = ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b) || (!Array.isArray(a) && (!isPlain(a) || !isPlain(b)))) return false;
  if (seen.get(a) === b) return true; seen.set(a, b);
  if (Array.isArray(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!historyValuesEqual(a[i], b[i], seen)) return false; return true; }
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && historyValuesEqual(a[key], b[key], seen));
}
function cloneContext(value) {
  if (value === undefined) throw new TypeError('History context must be an explicit value; use null for an empty context.');
  const seen = new Set();
  function validate(item) {
    if (!isObject(item) || seen.has(item)) return; seen.add(item);
    if (typeof SharedArrayBuffer !== 'undefined' && (item instanceof SharedArrayBuffer || ArrayBuffer.isView(item) && item.buffer instanceof SharedArrayBuffer)) throw new TypeError('History UI context must not use shared mutable buffers.');
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) return;
    if (!Array.isArray(item) && !isPlain(item)) throw new TypeError('History UI context must contain plain values and typed arrays.');
    for (const key of Object.keys(item)) validate(item[key]);
  }
  validate(value); return structuredClone(value);
}
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
 * @param {{maxBytes?:number,maxEntries?:number,maxContextBytes?:number,onPrune?:(info:{count:number,labels:string[],bytes:number})=>void}} [options]
 */
export function createHistory(initial, { maxBytes = 32 * 1024 * 1024, maxEntries = 100, maxContextBytes = 16 * 1024 * 1024, onPrune } = {}) {
  let present = initial; let past = []; let future = []; let transaction = null; let lastChange = null; let lastContext;
  function prune() {
    const dropped = [];
    let bytes = [...past, ...future].reduce((sum, entry) => sum + entry.bytes, 0);
    while (past.length + future.length > maxEntries || bytes > maxBytes) { const removed = past.length ? past.shift() : future.shift(); if (!removed) break; bytes -= removed.bytes; dropped.push(removed.label); }
    if (dropped.length) onPrune?.({ count: dropped.length, labels: dropped, bytes });
    return dropped;
  }
  function record(before, next, label, contexts) {
    let context;
    if (contexts !== undefined) {
      if (!contexts || !Object.hasOwn(contexts, 'beforeContext') || !Object.hasOwn(contexts, 'afterContext')) throw new TypeError('Supply both beforeContext and afterContext.');
      if (cost(contexts) > maxContextBytes) throw new RangeError('History UI context exceeds its memory limit.');
      const equal = historyValuesEqual(contexts.beforeContext, contexts.afterContext);
      const beforeContext = cloneContext(contexts.beforeContext), afterContext = equal ? beforeContext : cloneContext(contexts.afterContext);
      context = { beforeContext, afterContext, changed: !equal };
    }
    const patches = diffDocuments(before, next); present = next; lastContext = undefined;
    if (!patches.length && !context?.changed) { lastChange = { changed: false, recorded: false, pruned: 0 }; return present; }
    future = [];
    const entry = { label, patches, ...(context ? { beforeContext: context.beforeContext, afterContext: context.afterContext } : {}) }; entry.bytes = cost(entry);
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
    // Return a detached copy so applying a selection cannot mutate an older entry.
    get lastContext() { return lastContext === undefined ? undefined : cloneContext(lastContext); },
    get retainedBytes() { return cost({ present, past, future, transaction, lastContext }); },
    get stats() { return { undo: past.length, redo: future.length, bytes: [...past, ...future].reduce((sum, entry) => sum + entry.bytes, 0), maxBytes, maxEntries }; },
    commit(next, label = 'Edit', contexts) { if (transaction) { if (contexts !== undefined) throw new Error('Finish the current gesture before committing UI context.'); present = next; return present; } return record(present, next, label, contexts); },
    begin(label = 'Draw') { if (transaction) throw new Error('A history transaction is already active'); lastContext = undefined; transaction = { before: present, label }; return present; },
    update(next) { if (!transaction) throw new Error('Begin a history transaction before updating it'); present = next; return present; },
    end(next = present) { if (!transaction) return present; const { before, label } = transaction; transaction = null; return record(before, next, label); },
    cancel() { if (transaction) present = transaction.before; transaction = null; lastContext = undefined; return present; },
    undo() { if (transaction) history.end(); lastContext = undefined; const entry = past.pop(); if (entry) { present = applyPatches(present, entry.patches, 'before'); lastContext = entry.beforeContext; future.push(entry); } return present; },
    redo() { if (transaction) history.end(); lastContext = undefined; const entry = future.pop(); if (entry) { present = applyPatches(present, entry.patches, 'after'); lastContext = entry.afterContext; past.push(entry); } return present; },
    reset(next) { present = next; past = []; future = []; transaction = null; lastChange = null; lastContext = undefined; return present; },
  };
  return history;
}

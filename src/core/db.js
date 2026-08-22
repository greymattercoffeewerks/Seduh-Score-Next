// IndexedDB wrapper (handoff §9, §14 T3.2). Two generic object stores rather
// than one per entity type — a generic key/value cache is simpler to get
// right and easier to extend (a new cached shape is a new key, not a new
// store + a migration bumping DB_VERSION):
//   - `cache`  — key/value mirror of server reads, each entry stamped with
//     `cachedAt` so a consumer can decide how stale is too stale.
//   - `outbox` — the ordered operation queue itself (see outbox.js, which
//     owns queue SEMANTICS; this file only owns the raw CRUD against
//     IndexedDB, sequenced by `createdAt` via a dedicated index so queue
//     order survives a page reload exactly, not just within one session).
//
// No format/UI code touches `indexedDB` directly — every access goes through
// this file's exported functions, the same "one chokepoint" discipline as
// registry.js for Supabase itself.
const DB_NAME = 'seduh-score-next';
const DB_VERSION = 1;
const CACHE_STORE = 'cache';
const OUTBOX_STORE = 'outbox';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

// Test-only: the module-scoped handle is opened once and reused for the
// page's whole lifetime in production, so tests need a way to force a fresh
// one between cases without a real page reload.
export function _resetForTests() {
  dbPromise = null;
}

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const result = await fn(store);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return result;
}

// ---------------------------------------------------------------------
// Cache — generic key/value mirror of server reads.
// ---------------------------------------------------------------------

export async function cacheGet(key) {
  const row = await withStore(CACHE_STORE, 'readonly', (store) => promisifyRequest(store.get(key)));
  return row ? row.value : null;
}

export async function cacheSet(key, value) {
  await withStore(CACHE_STORE, 'readwrite', (store) =>
    promisifyRequest(store.put({ key, value, cachedAt: Date.now() })),
  );
}

// ---------------------------------------------------------------------
// Outbox — the raw queue store. outbox.js owns retry/flush semantics; this
// is deliberately just CRUD, ordered by `createdAt`.
// ---------------------------------------------------------------------

// Every queued operation, oldest first.
export async function outboxListAll() {
  return withStore(OUTBOX_STORE, 'readonly', (store) =>
    promisifyRequest(store.index('createdAt').getAll()),
  );
}

export async function outboxPut(operation) {
  await withStore(OUTBOX_STORE, 'readwrite', (store) => promisifyRequest(store.put(operation)));
}

export async function outboxRemove(id) {
  await withStore(OUTBOX_STORE, 'readwrite', (store) => promisifyRequest(store.delete(id)));
}

// Test-only: empties both stores between test cases without needing a fresh
// fake-indexeddb instance per file.
export async function _clearAllForTests() {
  await withStore(CACHE_STORE, 'readwrite', (store) => promisifyRequest(store.clear()));
  await withStore(OUTBOX_STORE, 'readwrite', (store) => promisifyRequest(store.clear()));
}

/**
 * storage.js — IndexedDB persistence layer.
 *
 * Stores:
 *   • templates  { id (keyPath), data: ArrayBuffer, date: number }
 *   • settings   { key (keyPath), value: any }
 *
 * All operations use proper Promise wrappers (tx.oncomplete, not tx.complete)
 * for full cross-browser compatibility.
 */

const DB_NAME    = 'SpatialAIExplorer';
const DB_VERSION = 2;

// ─── DB open (singleton connection) ─────────────────────────────────────────

/** @type {IDBDatabase|null} */
let _db = null;

/**
 * Open (or reuse) the database connection.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('templates')) {
        const ts = db.createObjectStore('templates', { keyPath: 'id' });
        ts.createIndex('byDate', 'date', { unique: false });
      }

      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror   = () => reject(req.error);
    req.onblocked = () => console.warn('[storage] DB upgrade blocked — close other tabs');
  });
}

// ─── Templates ───────────────────────────────────────────────────────────────

/**
 * Persist a captured template buffer.
 * @param {string}      id      — unique key (e.g. "capture_1234567890")
 * @param {ArrayBuffer} buffer  — raw RGBA pixel data
 */
export async function saveTemplateToDB(id, buffer) {
  try {
    const db = await openDB();
    await _txWrite(db, 'templates', { id, data: buffer, date: Date.now() });
  } catch (err) {
    console.error('[storage] saveTemplate failed:', err);
  }
}

/**
 * Load all stored template metadata (id + date, not pixel data).
 * @returns {Promise<Array<{id:string, date:number}>>}
 */
export async function loadTemplatesFromDB() {
  try {
    const db      = await openDB();
    const records = await _txReadAll(db, 'templates');
    return records.map(r => ({ id: r.id, date: r.date }));
  } catch (err) {
    console.error('[storage] loadTemplates failed:', err);
    return [];
  }
}

/**
 * Delete a single template by id.
 * @param {string} id
 */
export async function deleteTemplateFromDB(id) {
  try {
    const db = await openDB();
    await _txDelete(db, 'templates', id);
  } catch (err) {
    console.error('[storage] deleteTemplate failed:', err);
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

const SETTING_DEFAULTS = {
  offlineMode:    false,
  voiceFeedback:  true,
  arOpacity:      0.8,
  cameraRes:      '720p',
};

/**
 * Load all settings from DB, falling back to defaults.
 * @returns {Promise<typeof SETTING_DEFAULTS>}
 */
export async function loadSettings() {
  const out = { ...SETTING_DEFAULTS };

  try {
    const db      = await openDB();
    const records = await _txReadAll(db, 'settings');
    for (const r of records) {
      if (r.key in out) out[r.key] = r.value;
    }
  } catch (err) {
    console.warn('[storage] loadSettings failed — using defaults:', err);
  }

  return out;
}

/**
 * Persist a single setting.
 * @param {string} key
 * @param {*}      value
 */
export async function saveSetting(key, value) {
  try {
    const db = await openDB();
    await _txWrite(db, 'settings', { key, value });
  } catch (err) {
    console.warn(`[storage] saveSetting("${key}") failed:`, err);
  }
}

// ─── Low-level IDB helpers ───────────────────────────────────────────────────

function _txWrite(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error ?? new DOMException('Transaction aborted'));
  });
}

function _txReadAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror   = () => reject(req.error);
  });
}

function _txDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error ?? new DOMException('Transaction aborted'));
  });
}
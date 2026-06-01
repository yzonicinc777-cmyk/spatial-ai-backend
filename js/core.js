/**
 * core.js — Foundational layer: reactive state store, DOM cache, and IndexedDB persistence.
 *
 * Consolidates: state.js · dom.js · storage.js
 *
 * Sections:
 *   ① STATE  — single source of truth; setState / getState / subscribe
 *   ② DOM    — element registry; refs / refList / setText / toggleClass
 *   ③ STORAGE — IndexedDB: templates + settings
 *
 * Security: no eval, no dynamic code — pure data transforms and DOM reads.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ① STATE
// ═══════════════════════════════════════════════════════════════════════════════

const INITIAL_STATE = Object.freeze({
  // Core readiness
  wasmReady:       false,
  workerReady:     false,
  cameraActive:    false,

  // Navigation
  activePage:      'camera',

  // Template / detection
  templateMode:    false,
  lastDetection:   null,   // { x, y, width, height, confidence, scale }
  scanCount:       0,
  templateCount:   0,
  saveCount:       0,
  savedTemplates:  [],     // [{ id, date }]

  // Sensors
  heading:         null,   // degrees 0-360 or null
  compassTarget:   0,
  compassVisible:  true,
  gpsAccuracy:     null,   // metres or null

  // Network / device
  isOnline:        navigator.onLine,
  batteryLevel:    null,   // 0-100 or null
  batteryCharging: false,

  // Voice
  isListening:     false,
  voiceTranscript: '',
  voiceSupported:  false,

  // Flashlight
  torchOn:         false,

  // Settings (persisted)
  offlineMode:     false,
  voiceFeedback:   true,
  arOpacity:       0.8,
  cameraRes:       '720p',
});

let _state = { ...INITIAL_STATE };

/** @type {Map<string, Set<function>>} */
const _listeners = new Map();

/**
 * Read the current state snapshot or a single key.
 * @param {string=} key
 */
export function getState(key) {
  return key === undefined ? { ..._state } : _state[key];
}

/**
 * Merge partial state and fire listeners for each changed key.
 * @param {object} patch
 */
export function setState(patch) {
  const changed = [];

  for (const key of Object.keys(patch)) {
    if (_state[key] !== patch[key]) {
      _state[key] = patch[key];
      changed.push(key);
    }
  }

  if (changed.length === 0) return;

  for (const key of changed) {
    const subs = _listeners.get(key);
    if (subs) {
      for (const cb of subs) {
        try { cb(_state[key], _state); }
        catch (err) { console.error(`[state] listener error for "${key}":`, err); }
      }
    }
  }

  const wildcard = _listeners.get('*');
  if (wildcard) {
    for (const cb of wildcard) {
      try { cb(changed, _state); }
      catch (err) { console.error('[state] wildcard listener error:', err); }
    }
  }
}

/**
 * Subscribe to one or more state keys (or '*' for all).
 * @param {string|string[]} keys
 * @param {function} cb
 * @returns {function} unsubscribe
 */
export function subscribe(keys, cb) {
  const keyArr = Array.isArray(keys) ? keys : [keys];
  for (const key of keyArr) {
    if (!_listeners.has(key)) _listeners.set(key, new Set());
    _listeners.get(key).add(cb);
  }
  return () => {
    for (const key of keyArr) _listeners.get(key)?.delete(cb);
  };
}

/**
 * Subscribe once — auto-removes after first invocation.
 * @param {string} key
 * @param {function} cb
 */
export function subscribeOnce(key, cb) {
  const unsub = subscribe(key, (...args) => { unsub(); cb(...args); });
}

// ── Convenience stat mutators ────────────────────────────────────────────────

export function incrementScan()     { setState({ scanCount:     _state.scanCount     + 1 }); }
export function incrementTemplate() { setState({ templateCount: _state.templateCount + 1 }); }
export function incrementSave()     { setState({ saveCount:     _state.saveCount     + 1 }); }

export function addSavedTemplate(entry) {
  setState({ savedTemplates: [..._state.savedTemplates, entry] });
}

export function setSavedTemplates(list) {
  setState({ savedTemplates: list, templateCount: list.length });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ② DOM
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {Record<string, HTMLElement | null>} */
const REFS = {};

/**
 * alias → element ID or CSS selector.
 * Selectors start with '.' or '['.
 */
const ELEMENT_MAP = {
  // Core scaffold
  splash:               'splash-screen',
  app:                  'app',
  bgCanvas:             'bg-canvas',

  // Status bar
  clock:                'clock',
  gpsBadge:             'gps-badge',
  compassBadge:         'compass-badge',
  batteryBadge:         'battery-badge',
  networkBadge:         'network-badge',
  statusText:           'status-text',
  statusDot:            '.status-dot',

  // Camera page
  video:                'video',
  overlayCanvas:        'overlay-canvas',
  detectionBox:         'detection-box',
  detectionLabel:       'detection-label',
  detectionDistance:    'detection-distance',
  detectionBuyBtn:      'detection-buy-btn',
  compassRing:          'compass-ring',

  // Voice bar
  voiceBar:             'voice-bar',
  micBtn:               'mic-btn',
  voiceText:            'voice-text',
  voiceWave:            'voice-wave',

  // Quick actions
  scanBtn:              'scanBtn',
  setTemplateBtn:       'setTemplateBtn',
  flashlightBtn:        'flashlightBtn',

  // Explore page
  exploreSearch:        'explore-search',
  mapContainer:         'map-container',
  poiList:              'poi-list',

  // Profile page
  templatesList:        'templates-list',
  offlineToggle:        'offline-toggle',
  voiceFeedbackToggle:  'voice-feedback-toggle',

  // Settings page
  cameraResSelect:      'camera-resolution',
  arOpacityRange:       'ar-opacity',

  // Navigation
  navBar:               'nav-bar',
  fabBtn:               'ai-lens-fab',

  // Toast / modal
  toastContainer:       'toast-container',
  modalOverlay:         'modal-overlay',
  modalTitle:           'modal-title',
  modalBody:            'modal-body',
  modalClose:           'modal-close',
};

/**
 * Must be called once after DOMContentLoaded.
 * Logs missing elements without throwing.
 */
export function initDOM() {
  for (const [alias, target] of Object.entries(ELEMENT_MAP)) {
    const isSelector = target.startsWith('.') || target.startsWith('[');
    const el = isSelector
      ? document.querySelector(target)
      : document.getElementById(target);

    if (!el) console.warn(`[dom] Missing element: alias="${alias}", target="${target}"`);
    REFS[alias] = el;
  }

  REFS.navBtns    = Array.from(document.querySelectorAll('.nav-btn'));
  REFS.statValues = Array.from(document.querySelectorAll('.stat strong'));
  REFS.backBtns   = Array.from(document.querySelectorAll('.back-btn'));
  REFS.pages      = Array.from(document.querySelectorAll('.page'));
}

/**
 * Get a cached DOM reference by alias. Returns null if missing.
 * @param {string} alias
 * @returns {HTMLElement | null}
 */
export function refs(alias) {
  if (!(alias in REFS)) {
    console.warn(`[dom] Unknown alias "${alias}" — did you call initDOM()?`);
    return null;
  }
  return REFS[alias];
}

/**
 * Get a list alias (returns empty array if missing).
 * @param {'navBtns'|'statValues'|'backBtns'|'pages'} alias
 * @returns {HTMLElement[]}
 */
export function refList(alias) {
  return REFS[alias] || [];
}

/** Set text content safely. */
export function setText(alias, text) {
  const el = refs(alias);
  if (el) el.textContent = text;
}

/** Toggle a CSS class on a ref. */
export function toggleClass(alias, cls, force) {
  refs(alias)?.classList.toggle(cls, force);
}

/** Add class to a ref. */
export function addClass(alias, cls) {
  refs(alias)?.classList.add(cls);
}

/** Remove class from a ref. */
export function removeClass(alias, cls) {
  refs(alias)?.classList.remove(cls);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ③ STORAGE
// ═══════════════════════════════════════════════════════════════════════════════

const DB_NAME    = 'SpatialAIExplorer';
const DB_VERSION = 2;

/** @type {IDBDatabase|null} */
let _db = null;

/**
 * Open (or reuse) the singleton IndexedDB connection.
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

/**
 * Persist a captured template buffer.
 * @param {string}      id
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

// ── Settings ─────────────────────────────────────────────────────────────────

const SETTING_DEFAULTS = {
  offlineMode:   false,
  voiceFeedback: true,
  arOpacity:     0.8,
  cameraRes:     '720p',
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
 * Persist a single setting key/value pair.
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

// ── Low-level IDB helpers ─────────────────────────────────────────────────────

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
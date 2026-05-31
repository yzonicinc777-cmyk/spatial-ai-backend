/**
 * state.js — Centralized reactive state store for Spatial AI Explorer
 *
 * Single source of truth for all app state. Modules subscribe to
 * specific slices; mutations go through setState() to guarantee
 * consistency and trigger registered listeners.
 *
 * Security: no eval, no dynamic code — pure data transforms.
 */

// ─── Initial state ──────────────────────────────────────────────────────────

const INITIAL_STATE = Object.freeze({
  // Core readiness
  wasmReady:      false,
  workerReady:    false,
  cameraActive:   false,

  // Navigation
  activePage: 'camera',

  // Template / detection
  templateMode:   false,
  lastDetection:  null,   // { x, y, width, height, confidence, scale }
  scanCount:      0,
  templateCount:  0,
  saveCount:      0,
  savedTemplates: [],     // [{ id, date }]

  // Sensors
  heading:        null,   // degrees 0-360 or null
  compassTarget:  0,
  compassVisible: true,
  gpsAccuracy:    null,   // metres or null

  // Network / device
  isOnline:       navigator.onLine,
  batteryLevel:   null,   // 0-100 or null
  batteryCharging: false,

  // Voice
  isListening:    false,
  voiceTranscript: '',
  voiceSupported: false,

  // Flashlight
  torchOn:        false,

  // Settings (persisted)
  offlineMode:    false,
  voiceFeedback:  true,
  arOpacity:      0.8,
  cameraRes:      '720p',
});

// ─── Internal store ──────────────────────────────────────────────────────────

let _state = { ...INITIAL_STATE };

/** @type {Map<string, Set<function>>} */
const _listeners = new Map();

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Read the current state (or a single key).
 * @template {keyof typeof INITIAL_STATE} K
 * @param {K=} key
 * @returns {K extends undefined ? typeof _state : (typeof _state)[K]}
 */
export function getState(key) {
  return key === undefined ? { ..._state } : _state[key];
}

/**
 * Merge partial state and fire listeners for each changed key.
 * @param {Partial<typeof _state>} patch
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

  // Wildcard listeners subscribed with key '*'
  const wildcard = _listeners.get('*');
  if (wildcard) {
    for (const cb of wildcard) {
      try { cb(changed, _state); }
      catch (err) { console.error('[state] wildcard listener error:', err); }
    }
  }
}

/**
 * Subscribe to state changes.
 * @param {string|string[]} keys  One or more keys, or '*' for all changes
 * @param {function} cb
 * @returns {function} unsubscribe
 */
export function subscribe(keys, cb) {
  const keyArr = Array.isArray(keys) ? keys : [keys];

  for (const key of keyArr) {
    if (!_listeners.has(key)) _listeners.set(key, new Set());
    _listeners.get(key).add(cb);
  }

  return function unsubscribe() {
    for (const key of keyArr) {
      _listeners.get(key)?.delete(cb);
    }
  };
}

/**
 * Subscribe once — auto-removes after first invocation.
 * @param {string} key
 * @param {function} cb
 */
export function subscribeOnce(key, cb) {
  const unsub = subscribe(key, (...args) => {
    unsub();
    cb(...args);
  });
}

// ─── Convenience stat mutators ───────────────────────────────────────────────

export function incrementScan() {
  setState({ scanCount: _state.scanCount + 1 });
}

export function incrementTemplate() {
  setState({ templateCount: _state.templateCount + 1 });
}

export function incrementSave() {
  setState({ saveCount: _state.saveCount + 1 });
}

export function addSavedTemplate(entry) {
  setState({ savedTemplates: [..._state.savedTemplates, entry] });
}

export function setSavedTemplates(list) {
  setState({ savedTemplates: list, templateCount: list.length });
}
/**
 * dom.js — Centralized DOM reference cache.
 *
 * All element lookups happen once at boot; every other module imports
 * typed references instead of calling getElementById repeatedly.
 * Missing elements are logged (never throw) so the app degrades
 * gracefully in partial-DOM environments.
 */

// ─── Element registry ────────────────────────────────────────────────────────

/**
 * @type {Record<string, HTMLElement | null>}
 */
const REFS = {};

/**
 * Map of alias → element ID or CSS selector.
 * Key  = the name other modules import via refs().
 * Value = DOM id (string) or selector (starts with '.' or '[').
 */
const ELEMENT_MAP = {
  // Core scaffold
  splash:        'splash-screen',
  app:           'app',
  bgCanvas:      'bg-canvas',

  // Status bar
  clock:         'clock',
  gpsBadge:      'gps-badge',
  compassBadge:  'compass-badge',
  batteryBadge:  'battery-badge',
  networkBadge:  'network-badge',
  statusText:    'status-text',
  statusDot:     '.status-dot',   // class selector

  // Camera page
  video:              'video',
  overlayCanvas:      'overlay-canvas',
  detectionBox:       'detection-box',
  detectionLabel:     'detection-label',
  detectionDistance:  'detection-distance',
  detectionBuyBtn:    'detection-buy-btn',
  compassRing:        'compass-ring',

  // Voice bar
  voiceBar:       'voice-bar',
  micBtn:         'mic-btn',
  voiceText:      'voice-text',
  voiceWave:      'voice-wave',

  // Quick actions
  scanBtn:            'scanBtn',
  setTemplateBtn:     'setTemplateBtn',
  flashlightBtn:      'flashlightBtn',

  // Explore page
  exploreSearch:  'explore-search',
  mapContainer:   'map-container',
  poiList:        'poi-list',

  // Profile page
  templatesList:         'templates-list',
  offlineToggle:         'offline-toggle',
  voiceFeedbackToggle:   'voice-feedback-toggle',

  // Settings page
  cameraResSelect: 'camera-resolution',
  arOpacityRange:  'ar-opacity',

  // Navigation
  navBar:    'nav-bar',
  fabBtn:    'ai-lens-fab',

  // Toast / modal
  toastContainer: 'toast-container',
  modalOverlay:   'modal-overlay',
  modalTitle:     'modal-title',
  modalBody:      'modal-body',
  modalClose:     'modal-close',
};

// ─── Init ────────────────────────────────────────────────────────────────────

/**
 * Must be called once — after DOMContentLoaded — before any other module
 * accesses refs(). Safely logs missing elements without throwing.
 */
export function initDOM() {
  for (const [alias, target] of Object.entries(ELEMENT_MAP)) {
    const isSelector = target.startsWith('.') || target.startsWith('[');
    const el = isSelector
      ? document.querySelector(target)
      : document.getElementById(target);

    if (!el) {
      console.warn(`[dom] Missing element: alias="${alias}", target="${target}"`);
    }
    REFS[alias] = el;
  }

  // Multi-element collections
  REFS.navBtns = Array.from(document.querySelectorAll('.nav-btn'));
  REFS.statValues = Array.from(document.querySelectorAll('.stat strong'));
  REFS.backBtns = Array.from(document.querySelectorAll('.back-btn'));
  REFS.pages = Array.from(document.querySelectorAll('.page'));
}

// ─── Accessor ────────────────────────────────────────────────────────────────

/**
 * Get a cached DOM reference by alias.
 * Returns null (not throws) for missing elements so callers can optional-chain.
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Set text content safely.
 * @param {string} alias
 * @param {string} text
 */
export function setText(alias, text) {
  const el = refs(alias);
  if (el) el.textContent = text;
}

/**
 * Toggle a CSS class on an element.
 * @param {string} alias
 * @param {string} cls
 * @param {boolean} force
 */
export function toggleClass(alias, cls, force) {
  const el = refs(alias);
  if (el) el.classList.toggle(cls, force);
}

/**
 * Add class to element.
 * @param {string} alias
 * @param {string} cls
 */
export function addClass(alias, cls) {
  refs(alias)?.classList.add(cls);
}

/**
 * Remove class from element.
 * @param {string} alias
 * @param {string} cls
 */
export function removeClass(alias, cls) {
  refs(alias)?.classList.remove(cls);
}
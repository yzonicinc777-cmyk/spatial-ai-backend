/**
 * detection.worker.js — Off-main-thread WASM template matcher.
 *
 * Protocol (postMessage):
 *   IN  { type: 'init' }
 *   OUT { type: 'ready' }
 *
 *   IN  { type: 'set_template',  payload: { data, width, height } }
 *   OUT { type: 'template_set' }
 *
 *   IN  { type: 'detect',        payload: { imageData, width, height } }  (buffer transferred)
 *   OUT { type: 'result',        matches: Match[] }
 *   OUT { type: 'error',         error: string, code: string }
 *
 *   IN  { type: 'clear_template' }
 *   OUT { type: 'template_cleared' }
 *
 *   IN  { type: 'configure',     payload: { min_confidence?, step?, multi_scale?, use_color? } }
 *   OUT { type: 'configured' }
 *
 * Match: { x, y, width, height, confidence, scale }
 *
 * Security:
 *   • Strict type-checking on every inbound message
 *   • No eval, no dynamic import beyond the WASM initialiser
 *   • All errors caught and forwarded — worker never silently dies
 */

import init, {
  set_template,
  detect_template,
  clear_template,
  configure,
} from '/pkg/spatial_explorer_core.js';

// ─── State ───────────────────────────────────────────────────────────────────

let _wasmReady   = false;
let _processing  = false;
let _hasTemplate = false;

const DEFAULT_CONFIG = {
  min_confidence: 0.35,
  step:           2,
  multi_scale:    true,
  use_color:      true,
};

let _config = { ...DEFAULT_CONFIG };

// ─── Init ────────────────────────────────────────────────────────────────────

async function _init() {
  try {
    await init();
    _wasmReady = true;
    _applyConfig(_config);
    self.postMessage({ type: 'ready' });
  } catch (err) {
    _postError('WASM_INIT_FAILED', `WASM init failed: ${err.message}`);
  }
}

// ─── Message router ──────────────────────────────────────────────────────────

self.addEventListener('message', async (e) => {
  const msg = e.data;

  // Defensive: verify message shape
  if (!msg || typeof msg.type !== 'string') {
    _postError('INVALID_MESSAGE', 'Received malformed message');
    return;
  }

  switch (msg.type) {
    case 'init':
      await _init();
      break;

    case 'set_template':
      await _handleSetTemplate(msg.payload);
      break;

    case 'detect':
      await _handleDetect(msg.payload);
      break;

    case 'clear_template':
      _handleClear();
      break;

    case 'configure':
      _handleConfigure(msg.payload);
      break;

    default:
      _postError('UNKNOWN_TYPE', `Unknown message type: ${msg.type}`);
  }
});

// ─── Handlers ────────────────────────────────────────────────────────────────

async function _handleSetTemplate(payload) {
  if (!_guardReady()) return;

  if (!_validatePayload(payload, ['data', 'width', 'height'])) {
    _postError('INVALID_TEMPLATE', 'set_template payload missing required fields');
    return;
  }

  const { data, width, height } = payload;

  if (!(data instanceof Uint8ClampedArray) && !(data instanceof Uint8Array)) {
    _postError('INVALID_TEMPLATE_DATA', 'Template data must be Uint8ClampedArray or Uint8Array');
    return;
  }

  try {
    // Ensure data is Uint8ClampedArray for WASM boundary
    const clamped = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
    set_template(clamped, width, height);
    _hasTemplate = true;
    self.postMessage({ type: 'template_set' });
  } catch (err) {
    _postError('SET_TEMPLATE_FAILED', `set_template error: ${err.message}`);
  }
}

async function _handleDetect(payload) {
  // Guard: avoid queuing frames faster than we can process
  if (!_guardReady() || _processing) return;

  if (!_hasTemplate) {
    // No template — nothing to detect, return empty silently
    self.postMessage({ type: 'result', matches: [] });
    return;
  }

  if (!_validatePayload(payload, ['imageData', 'width', 'height'])) {
    _postError('INVALID_FRAME', 'detect payload missing required fields');
    return;
  }

  _processing = true;

  try {
    const { imageData, width, height } = payload;

    // imageData arrives as a transferred ArrayBuffer or Uint8ClampedArray
    const data = imageData instanceof Uint8ClampedArray
      ? imageData
      : new Uint8ClampedArray(imageData);

    const resultJson = detect_template(data, width, height);
    const matches    = _parseResult(resultJson);

    self.postMessage({ type: 'result', matches });
  } catch (err) {
    _postError('DETECT_FAILED', `detection error: ${err.message}`);
  } finally {
    _processing = false;
  }
}

function _handleClear() {
  if (!_guardReady()) return;

  try {
    clear_template();
    _hasTemplate = false;
    self.postMessage({ type: 'template_cleared' });
  } catch (err) {
    _postError('CLEAR_FAILED', `clear_template error: ${err.message}`);
  }
}

function _handleConfigure(payload) {
  if (payload && typeof payload === 'object') {
    // Validate and merge only known keys
    const allowed = new Set(['min_confidence', 'step', 'multi_scale', 'use_color']);
    for (const k of Object.keys(payload)) {
      if (allowed.has(k)) _config[k] = payload[k];
    }
  }

  if (_wasmReady) _applyConfig(_config);
  self.postMessage({ type: 'configured', config: { ..._config } });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _applyConfig(cfg) {
  try {
    configure(JSON.stringify(cfg));
  } catch (err) {
    console.warn('[worker] configure() failed:', err.message);
  }
}

/**
 * Parse the JSON string returned by detect_template.
 * Handles sentinel strings gracefully.
 * @param {string|null} json
 * @returns {Array}
 */
function _parseResult(json) {
  if (!json || json === 'no_template' || json === 'invalid_template' || json === '[]') {
    return [];
  }

  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];

    // Validate each match object
    return parsed.filter(m =>
      typeof m.x         === 'number' &&
      typeof m.y         === 'number' &&
      typeof m.width     === 'number' &&
      typeof m.height    === 'number' &&
      typeof m.confidence === 'number' &&
      m.width > 0 && m.height > 0 &&
      m.confidence >= 0 && m.confidence <= 1
    );
  } catch (err) {
    console.warn('[worker] Failed to parse detect result:', err.message);
    return [];
  }
}

function _guardReady() {
  if (!_wasmReady) {
    _postError('NOT_READY', 'WASM not yet initialised');
    return false;
  }
  return true;
}

function _validatePayload(payload, keys) {
  if (!payload || typeof payload !== 'object') return false;
  return keys.every(k => k in payload && payload[k] != null);
}

function _postError(code, message) {
  self.postMessage({ type: 'error', code, error: message });
  console.error(`[worker][${code}]`, message);
}
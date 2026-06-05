/**
 * engine.js — Device sensors, detection worker bridge, and voice commands.
 *
 * Consolidates: sensor.js · detection.js · voice.js
 *
 * Sections:
 *   ① SENSOR    — DeviceOrientation, Geolocation, Battery, Network
 *   ② DETECTION — Worker bridge, template lifecycle, frame pipeline
 *   ③ VOICE     — Web Speech API, command parser / dispatcher
 *
 * Security:
 *   • Voice commands matched by regex/includes() — no eval, no dynamic dispatch
 *   • Worker runs in its own origin-sandboxed context
 *   • ImageData buffers are transferred (zero-copy, zero-retain)
 *   • All worker messages are type-checked before dispatch
 */

import {
  setState, getState,
  incrementTemplate, incrementSave, addSavedTemplate,
  refs, saveTemplateToDB,
} from './core.js';


import { showToast, updateStatus, navigateTo } from './render.js';


// ── NOTE: camera callbacks are injected at runtime to avoid circular deps ────
// render.js calls setFrameCallback / setDrawCallbacks after both modules load.

// ═══════════════════════════════════════════════════════════════════════════════
// ① SENSOR
// ═══════════════════════════════════════════════════════════════════════════════

// ── Network ──────────────────────────────────────────────────────────────────

export function initNetwork() {
  const update = () => setState({ isOnline: navigator.onLine });
  window.addEventListener('online',  update, { passive: true });
  window.addEventListener('offline', update, { passive: true });
  update();
}

// ── Battery ──────────────────────────────────────────────────────────────────

export async function initBattery() {
  if (!('getBattery' in navigator)) return;
  try {
    const battery = await navigator.getBattery();
    const sync = () => setState({
      batteryLevel:    Math.round(battery.level * 100),
      batteryCharging: battery.charging,
    });
    battery.addEventListener('levelchange',    sync);
    battery.addEventListener('chargingchange', sync);
    sync();
  } catch (err) {
    console.warn('[sensor] Battery API failed:', err);
  }
}

// ── GPS ───────────────────────────────────────────────────────────────────────

let _gpsWatchId = null;

export function initGPS() {
  if (!navigator.geolocation) return;
  const onSuccess = (pos) => setState({ gpsAccuracy: pos.coords.accuracy });
  const onError   = ()    => setState({ gpsAccuracy: null });
  const opts      = { enableHighAccuracy: false, timeout: 8000, maximumAge: 15000 };
  navigator.geolocation.getCurrentPosition(onSuccess, onError, opts);
  _gpsWatchId = navigator.geolocation.watchPosition(onSuccess, onError, opts);
}

export function stopGPS() {
  if (_gpsWatchId !== null) {
    navigator.geolocation.clearWatch(_gpsWatchId);
    _gpsWatchId = null;
  }
}

// ── Compass (DeviceOrientation) ───────────────────────────────────────────────

let _compassInitialised = false;

function _handleOrientation(e) {
  // webkitCompassHeading is more accurate on iOS (true north, pre-corrected)
  const heading = e.webkitCompassHeading != null
    ? e.webkitCompassHeading
    : (e.alpha != null ? (360 - e.alpha) % 360 : null);
  if (heading !== null) setState({ heading });
}

/**
 * Initialise compass. On iOS 13+ must be called from a user gesture.
 * @param {function=} onDenied  — called if permission rejected
 */
export async function initCompass(onDenied) {
  if (_compassInitialised) return;
  if (!window.DeviceOrientationEvent) {
    console.warn('[sensor] DeviceOrientationEvent not supported');
    return;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm === 'granted') {
        window.addEventListener('deviceorientation', _handleOrientation, { passive: true });
        _compassInitialised = true;
      } else {
        onDenied?.();
      }
    } catch (err) {
      console.warn('[sensor] Compass permission error:', err);
      onDenied?.();
    }
  } else {
    window.addEventListener('deviceorientation', _handleOrientation, { passive: true });
    _compassInitialised = true;
  }
}

/** Set the compass target bearing (0–359°). */
export function setCompassTarget(deg) {
  setState({ compassTarget: ((deg % 360) + 360) % 360, compassVisible: true });
}

export function showCompass() { setState({ compassVisible: true  }); }
export function hideCompass() { setState({ compassVisible: false }); }

// ═══════════════════════════════════════════════════════════════════════════════
// ② DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

/** @type {Worker|null} */
let _worker          = null;
let _processingFrame = false;

/**
 * Callbacks injected by render.js to avoid circular imports.
 * Set via setDetectionDrawCallbacks().
 */
let _drawMatches         = null;
let _clearOverlay        = null;
let _hideDetectionBox    = null;
let _positionDetectionBox = null;

/**
 * Called by render.js after it is initialised.
 * Provides the canvas-drawing functions detection needs.
 */
export function setDetectionDrawCallbacks({ drawMatches, clearOverlay, hideDetectionBox, positionDetectionBox }) {
  _drawMatches          = drawMatches;
  _clearOverlay         = clearOverlay;
  _hideDetectionBox     = hideDetectionBox;
  _positionDetectionBox = positionDetectionBox;
}

// ── Frame callback injection point ────────────────────────────────────────────

/** @type {function(ImageData, number, number): void | null} */
let _onFrameReady = null;

/**
 * Inject the frame-sending callback into render.js (camera).
 * Exported so render.js can call setFrameCallback(_sendFrame).
 * @param {function|null} cb
 */
export function setFrameCallback(cb) {
  _onFrameReady = cb;
}

// ── Worker lifecycle ──────────────────────────────────────────────────────────

export function initDetectionWorker() {
  if (_worker) return;

  try {
   _worker = new Worker('/js/detection_worker.js', { type: 'module' });
  } catch (err) {
    console.error('[detection] Worker creation failed:', err);
    updateStatus('Detection unavailable', 'warn');
    return;
  }

  _worker.addEventListener('message',      _handleWorkerMessage);
  _worker.addEventListener('error',        _handleWorkerError);
  _worker.addEventListener('messageerror', (e) => {
    console.error('[detection] Worker message error:', e);
  });

  // Expose the frame-sender so render.js (camera) can call it
  _onFrameReady = _sendFrame;

  _worker.postMessage({ type: 'init' });
}

export function terminateWorker() {
  _onFrameReady = null;
  if (_worker) { _worker.terminate(); _worker = null; }
  setState({ workerReady: false });
}

// ── Inbound message handler ───────────────────────────────────────────────────

function _handleWorkerMessage({ data }) {
  if (!data || typeof data.type !== 'string') return;

  switch (data.type) {
    case 'ready':
      setState({ workerReady: true });
      updateStatus('AI engine ready');
      showToast('AI Lens active ✦', 'success');
      break;

    case 'result':
      _processingFrame = false;
      _onResult(data.matches ?? []);
      break;

    case 'template_set':
      _onTemplateSet();
      break;

    case 'template_cleared':
      showToast('Template cleared', 'info');
      break;

    case 'error':
      _processingFrame = false;
      console.error('[detection] Worker error:', data.code, data.error);
      if (data.code !== 'NOT_READY') updateStatus('Detection error', 'error');
      break;

    default:
      console.warn('[detection] Unknown message type:', data.type);
  }
}

function _handleWorkerError(e) {
  _processingFrame = false;
 console.error('[detection] Worker crash:', e.message ?? '(no message — likely a load/import failure)', e.filename ? `${e.filename}:${e.lineno}` : '(check Network tab for 404 on worker script)');
  updateStatus('Detection engine crashed', 'error');
  showToast('AI engine error — reload to recover', 'error');
}

// ── Detection result ──────────────────────────────────────────────────────────

function _onResult(matches) {
  if (matches.length === 0) {
    _hideDetectionBox?.();
    _clearOverlay?.();
    return;
  }
  _drawMatches?.(matches);
  _positionDetectionBox?.(matches[0]);
}

// ── Frame pipeline ────────────────────────────────────────────────────────────

/**
 * Transfers the ImageData buffer to the worker (zero-copy).
 * Called by render.js (camera) via the _onFrameReady ref.
 */
function _sendFrame(imageData, width, height) {
  if (!_worker || !getState('workerReady') || _processingFrame) return;
  _processingFrame = true;

  const buffer = imageData.data.buffer;
  _worker.postMessage(
    { type: 'detect', payload: { imageData: imageData.data, width, height } },
    [buffer]
  );
}

/** Returns the current frame-send callback so render.js can register it. */
export function getFrameSender() {
  return _sendFrame;
}

// ── Template management ───────────────────────────────────────────────────────

/**
 * Send captured ImageData to worker as the new template.
 * Also persists to IndexedDB and updates stats.
 * @param {ImageData} imgData
 */
export async function setTemplate(imgData) {
  if (!_worker || !getState('workerReady')) {
    showToast('AI engine not ready', 'error');
    return;
  }
  if (!imgData) return;

const clone  = imgData.data.buffer.slice(0);   // clone for IndexedDB, never transferred

_worker.postMessage(
  { type: 'set_template', payload: { data: new Uint8ClampedArray(clone), width: imgData.width, height: imgData.height } }
  // No transfer list — clone is small enough, and we need it for saveTemplateToDB below
);

  const id = `capture_${Date.now()}`;
  incrementTemplate();
  await saveTemplateToDB(id, clone);
  addSavedTemplate({ id, date: Date.now() });
  incrementSave();
}

export function clearTemplate() {
  if (!_worker) return;
  _worker.postMessage({ type: 'clear_template' });
  updateStatus('Template cleared');
  setState({ templateMode: false });
  refs('setTemplateBtn')?.classList.remove('mode-active');
}

// ── Template mode UI ──────────────────────────────────────────────────────────

export function enterTemplateMode() {
  setState({ templateMode: true });
  refs('setTemplateBtn')?.classList.add('mode-active');
  updateStatus('Tap an object to capture template');
}

export function exitTemplateMode() {
  setState({ templateMode: false });
  refs('setTemplateBtn')?.classList.remove('mode-active');
}

async function _onTemplateSet() {
  exitTemplateMode();
  showToast('Template captured ✓', 'success');
  updateStatus('Template active — scanning');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ③ VOICE
// ═══════════════════════════════════════════════════════════════════════════════

// Forward declarations — camera functions injected via setVoiceCameraCallbacks()
let _captureCentre    = null;
let _toggleFlashlight = null;

/**
 * Called by render.js to provide camera functions voice commands need.
 * @param {{ captureCentre: function, toggleFlashlight: function }} cbs
 */
export function setVoiceCameraCallbacks({ captureCentre, toggleFlashlight }) {
  _captureCentre    = captureCentre;
  _toggleFlashlight = toggleFlashlight;
}

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

/** @type {SpeechRecognition|null} */
let _rec   = null;
let _final = '';

// ── Init ──────────────────────────────────────────────────────────────────────

export function initVoice() {
  setState({ voiceSupported: !!SpeechRec });

  if (!SpeechRec) {
    const micBtn = refs('micBtn');
    if (micBtn) micBtn.style.display = 'none';
    return;
  }

  _rec                 = new SpeechRec();
  _rec.continuous      = false;
  _rec.interimResults  = true;
  _rec.lang            = navigator.language || 'en-US';
  _rec.maxAlternatives = 1;

  _rec.onstart  = _onStart;
  _rec.onend    = _onEnd;
  _rec.onerror  = _onError;
  _rec.onresult = _onVoiceResult;
}

// ── Session control ───────────────────────────────────────────────────────────

export function startListening() {
  if (!_rec || getState('isListening')) return;
  try { _rec.start(); }
  catch (err) { console.warn('[voice] start failed:', err); }
}

export function stopListening() {
  if (!_rec || !getState('isListening')) return;
  _rec.stop();
}

export function toggleListening() {
  getState('isListening') ? stopListening() : startListening();
}

// ── Recognition handlers ──────────────────────────────────────────────────────

function _onStart() {
  _final = '';
  setState({ isListening: true, voiceTranscript: '' });
  _setVoiceUI(true);
  const vt = refs('voiceText');
  if (vt) vt.textContent = 'Listening…';
  updateStatus('Voice active');
}

function _onEnd() {
  setState({ isListening: false });
  _setVoiceUI(false);
  const vt = refs('voiceText');
  if (vt) vt.textContent = _final || 'Say "find red shoes near me"';
  _final = '';
  updateStatus('Ready');
}

function _onError(e) {
  setState({ isListening: false });
  _setVoiceUI(false);

  const known = {
    'not-allowed':   'Microphone permission denied',
    'no-speech':     'No speech detected',
    'audio-capture': 'No microphone found',
    'network':       'Network error (voice)',
    'aborted':       null,  // user-initiated; stay silent
  };

  const msg = known[e.error];
  if (msg === undefined) {
    showToast(`Voice error: ${e.error}`, 'error');
    updateStatus(`Voice: ${e.error}`, 'error');
  } else if (msg) {
    showToast(msg, 'error');
    updateStatus(msg, 'warn');
  }
}

function _onVoiceResult(e) {
  let interim = '';
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const t = e.results[i][0].transcript;
    if (e.results[i].isFinal) _final += t;
    else interim += t;
  }
  const display = _final || interim || 'Listening…';
  setState({ voiceTranscript: display });
  const vt = refs('voiceText');
  if (vt) vt.textContent = display;
  if (_final) dispatch(_final.trim().toLowerCase());
}

// ── Command parser ────────────────────────────────────────────────────────────

const DIRECTIONS = {
  'north': 0, 'east': 90, 'south': 180, 'west': 270,
  'northeast': 45, 'northwest': 315, 'southeast': 135, 'southwest': 225,
};

/**
 * Parse and execute a voice command string.
 * Public so it can be tested or called programmatically.
 * @param {string} cmd — lower-cased transcript
 */
export function dispatch(cmd) {
  updateStatus(`"${cmd}"`);
  if (navigator.vibrate) navigator.vibrate(30);

  // Navigation
  if (/(go to|open|show)\s+camera/.test(cmd) || cmd === 'camera') return navigateTo('camera');
  if (/(go to|open|show)\s+explore/.test(cmd) || cmd.includes('explore')) return navigateTo('explore');
  if (/(go to|open|show)\s+profile/.test(cmd) || cmd.includes('profile')) return navigateTo('profile');

  // Template
  if (/(set|start|new)\s*template/.test(cmd))    return enterTemplateMode();
  if (/(reset|clear|remove)\s*template/.test(cmd)) return clearTemplate();

  // Scan / find
  if (/(scan|find|search|look for)/.test(cmd)) {
    const imgData = _captureCentre?.();
    if (imgData) setTemplate(imgData);
    showToast('Scanning centre of frame…');
    return;
  }

  // Compass
  if (cmd.includes('show compass')) { showCompass(); updateStatus('Compass on'); return; }
  if (cmd.includes('hide compass')) { hideCompass(); updateStatus('Compass off'); return; }
  if (cmd.includes('point to') || cmd.includes('face')) {
    for (const [dir, deg] of Object.entries(DIRECTIONS)) {
      if (cmd.includes(dir)) { setCompassTarget(deg); return; }
    }
  }

  // Flashlight
  if (/flash(light)?|torch/.test(cmd)) return _toggleFlashlight?.();

  // Unknown
  showToast(`Not recognised: "${cmd}"`);
  updateStatus('Command unrecognised', 'warn');
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _setVoiceUI(active) {
  refs('voiceBar')?.classList.toggle('listening', active);
  refs('voiceWave')?.classList.toggle('listening', active);
  const mic = refs('micBtn');
  mic?.classList.toggle('listening', active);
  mic?.setAttribute('aria-pressed', String(active));
}
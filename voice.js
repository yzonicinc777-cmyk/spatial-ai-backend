/**
 * voice.js — Web Speech API integration & command dispatch.
 *
 * Manages:
 *   • SpeechRecognition session lifecycle (start / stop / error recovery)
 *   • Interim + final transcript rendering
 *   • Parsed command dispatch to other modules
 *
 * Security: voice commands are lower-cased strings matched by includes() —
 * no eval, no dynamic dispatch on untrusted data.
 */

import { refs }                               from './dom.js';
import { setState, getState }                 from './state.js';
import { showToast, updateStatus, navigateTo } from './ui.js';
import { setCompassTarget, showCompass, hideCompass } from './sensor.js';
import { enterTemplateMode, clearTemplate }   from './detection.js';
import { captureCentre }                      from './camera.js';
import { setTemplate }                        from './detection.js';
import { toggleFlashlight }                   from './camera.js';

// ─── Private ─────────────────────────────────────────────────────────────────

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

/** @type {SpeechRecognition|null} */
let _rec   = null;
let _final = '';

// ─── Init ────────────────────────────────────────────────────────────────────

export function initVoice() {
  setState({ voiceSupported: !!SpeechRec });

  if (!SpeechRec) {
    const micBtn = refs('micBtn');
    if (micBtn) micBtn.style.display = 'none';
    return;
  }

  _rec                  = new SpeechRec();
  _rec.continuous       = false;
  _rec.interimResults   = true;
  _rec.lang             = navigator.language || 'en-US';
  _rec.maxAlternatives  = 1;

  _rec.onstart  = _onStart;
  _rec.onend    = _onEnd;
  _rec.onerror  = _onError;
  _rec.onresult = _onResult;
}

// ─── Session control ─────────────────────────────────────────────────────────

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

// ─── Recognition handlers ────────────────────────────────────────────────────

function _onStart() {
  _final = '';
  setState({ isListening: true, voiceTranscript: '' });
  _setVoiceUI(true);
  if (refs('voiceText')) refs('voiceText').textContent = 'Listening…';
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
    'not-allowed':     'Microphone permission denied',
    'no-speech':       'No speech detected',
    'audio-capture':   'No microphone found',
    'network':         'Network error (voice)',
    'aborted':         null,  // user-initiated, stay silent
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

function _onResult(e) {
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

// ─── Command parser ──────────────────────────────────────────────────────────

const DIRECTIONS = {
  'north': 0, 'east': 90, 'south': 180, 'west': 270,
  'northeast': 45, 'northwest': 315, 'southeast': 135, 'southwest': 225,
};

/**
 * Parse and execute a voice command string.
 * Public so it can be tested or called from other modules.
 * @param {string} cmd — lower-cased transcript
 */
export function dispatch(cmd) {
  updateStatus(`"${cmd}"`);

  if (navigator.vibrate) navigator.vibrate(30);

  // Navigation
  if (/(go to|open|show)\s+camera/.test(cmd) || cmd === 'camera') {
    return navigateTo('camera');
  }
  if (/(go to|open|show)\s+explore/.test(cmd) || cmd.includes('explore')) {
    return navigateTo('explore');
  }
  if (/(go to|open|show)\s+profile/.test(cmd) || cmd.includes('profile')) {
    return navigateTo('profile');
  }

  // Template
  if (/(set|start|new)\s*template/.test(cmd)) return enterTemplateMode();
  if (/(reset|clear|remove)\s*template/.test(cmd)) return clearTemplate();

  // Scan / find
  if (/(scan|find|search|look for)/.test(cmd)) {
    const imgData = captureCentre();
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
  if (/flash(light)?|torch/.test(cmd)) return toggleFlashlight();

  // Unknown
  showToast(`Not recognised: "${cmd}"`);
  updateStatus('Command unrecognised', 'warn');
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function _setVoiceUI(active) {
  const bar  = refs('voiceBar');
  const wave = refs('voiceWave');
  const mic  = refs('micBtn');

  bar?.classList.toggle('listening', active);
  wave?.classList.toggle('listening', active);
  mic?.classList.toggle('listening', active);
  mic?.setAttribute('aria-pressed', String(active));
}
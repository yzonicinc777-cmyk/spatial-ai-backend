/**
 * app.js — Application entry point & orchestrator.
 *
 * Owns the boot sequence only — all feature logic lives in the
 * appropriate module. This file is intentionally thin.
 *
 * Boot order:
 *   1. DOM cache (dom.js)
 *   2. Reactive UI bindings (ui.js)
 *   3. Splash + background (ui.js)
 *   4. Persist: load settings + templates (storage.js)
 *   5. WASM core (spatial_explorer_core.js)
 *   6. Sensors (sensor.js)
 *   7. Voice (voice.js)
 *   8. UI event bindings (this file)
 *   9. Camera (on first user gesture)
 *
 * Security:
 *   • CSP enforced in HTML (no inline JS beyond this module entry)
 *   • No eval, no innerHTML with unsanitised user input
 *   • Content-Security-Policy meta tag covers all external resources
 */

import init, { configure, set_template, detect_template } from './pkg/spatial_explorer_core.js';

import { initDOM, refs, refList }              from './js/dom.js';
import { getState, setState, subscribe }       from './js/state.js';
import {
  initBackground, initClock,
  hideSplash, scheduleSplashHide,
  updateStatus, showToast,
  navigateTo, bindStateToUI,
  openModal, closeModal,
  addRippleEffect,
}                                              from './js/ui.js';
import { initCompass, initGPS, initBattery, initNetwork } from './js/sensor.js';
import { initVoice, toggleListening }         from './js/voice.js';
import {
  initCamera, toggleFlashlight,
  captureRegion, captureCentre,
  eventToVideoCoords, bindCompassRing,
}                                             from './js/camera.js';
import {
  initDetectionWorker,
  enterTemplateMode, clearTemplate, setTemplate,
}                                             from './js/detection.js';
import {
  loadSettings, loadTemplatesFromDB, saveSetting,
}                                             from './js/storage.js';
import { setSavedTemplates }                  from './js/state.js';

// ─── Service Worker ──────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('[app] SW registration failed:', err));
  });
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function start() {

  // ── 1. DOM ────────────────────────────────────────────────────────────────
  initDOM();

  // ── 2 + 3. UI base ────────────────────────────────────────────────────────
  bindStateToUI();    // wire state → DOM reactively
  initBackground();   // particle canvas
  initClock();        // live clock
  scheduleSplashHide(3400); // safety fallback

  // ── 4. Persistence ────────────────────────────────────────────────────────
  updateStatus('Loading…');

  const [settings, templates] = await Promise.all([
    loadSettings(),
    loadTemplatesFromDB(),
  ]);

  setState({ ...settings });
  setSavedTemplates(templates);
  _applyPersistedSettings(settings);

  // ── 5. WASM core ──────────────────────────────────────────────────────────
  updateStatus('Loading AI engine…');

  try {
    await init();
    setState({ wasmReady: true });
    console.info('[app]', greet('Explorer'));
    updateStatus('AI engine ready');
  } catch (err) {
    console.error('[app] WASM init failed:', err);
    updateStatus('AI limited — WASM unavailable', 'warn');
    showToast('Core AI engine failed to load', 'error');
  }

  hideSplash();

  // ── 6. Sensors ────────────────────────────────────────────────────────────
  initNetwork();
  initBattery();
  initGPS();
  // Compass init is deferred to first user gesture (iOS requires it)

  // ── 7. Voice ──────────────────────────────────────────────────────────────
  initVoice();

  // ── 8. Compass ring DOM binding ───────────────────────────────────────────
  bindCompassRing();

  // ── 9. UI events ──────────────────────────────────────────────────────────
  _bindEvents();

  // ── 10. Camera on first gesture ───────────────────────────────────────────
  updateStatus('Tap anywhere to start camera');

  const _startCamera = async () => {
    await initCamera();
    initDetectionWorker();
    // iOS compass permission piggybacks the same gesture
    await initCompass(() => updateStatus('Compass permission denied', 'warn'));
  };

  document.body.addEventListener('click',    _startCamera, { once: true });
  document.body.addEventListener('touchend', _startCamera, { once: true });
}

// ─── Settings restoration ────────────────────────────────────────────────────

function _applyPersistedSettings(settings) {
  const offlineEl  = refs('offlineToggle');
  const voiceEl    = refs('voiceFeedbackToggle');
  const opacityEl  = refs('arOpacityRange');
  const resEl      = refs('cameraResSelect');

  if (offlineEl)  offlineEl.checked         = !!settings.offlineMode;
  if (voiceEl)    voiceEl.checked           = settings.voiceFeedback !== false;
  if (opacityEl)  opacityEl.value           = settings.arOpacity ?? 0.8;
  if (resEl)      resEl.value               = settings.cameraRes ?? '720p';
}

// ─── Event binding ───────────────────────────────────────────────────────────

function _bindEvents() {

  // ── Navigation ────────────────────────────────────────────────────────────
  for (const btn of refList('navBtns')) {
    btn.addEventListener('click', (e) => {
      const page = btn.dataset.page;
      if (page) { navigateTo(page); addRippleEffect(e); }
    });
  }

  for (const btn of refList('backBtns')) {
    btn.addEventListener('click', () => navigateTo('camera'));
  }

  // ── Quick actions ─────────────────────────────────────────────────────────
  refs('scanBtn')?.addEventListener('click', async () => {
    const imgData = captureCentre();
    if (imgData) await setTemplate(imgData);
    showToast('Scanning centre…');
  });

  refs('setTemplateBtn')?.addEventListener('click', enterTemplateMode);
  refs('flashlightBtn')?.addEventListener('click',  toggleFlashlight);

  // ── Video tap (template mode) ─────────────────────────────────────────────
  refs('video')?.addEventListener('click', async (e) => {
    if (!getState('templateMode')) return;
    const { x, y }  = eventToVideoCoords(e);
    const imgData   = captureRegion(x, y);
    if (imgData) await setTemplate(imgData);
  });

  // ── Touch tap on video ────────────────────────────────────────────────────
  refs('video')?.addEventListener('touchend', async (e) => {
    if (!getState('templateMode')) return;
    e.preventDefault();
    const { x, y }  = eventToVideoCoords(e);
    const imgData   = captureRegion(x, y);
    if (imgData) await setTemplate(imgData);
  }, { passive: false });

  // ── FAB (AI Lens) ─────────────────────────────────────────────────────────
  refs('fabBtn')?.addEventListener('click', async () => {
    navigateTo('camera');
    const imgData = captureCentre();
    if (imgData) await setTemplate(imgData);
    showToast('AI Lens activated — centre scanned');
    if (navigator.vibrate) navigator.vibrate([20, 20, 20]);
  });

  // ── Detection buy button ──────────────────────────────────────────────────
  refs('detectionBuyBtn')?.addEventListener('click', () => {
    const det = getState('lastDetection');
    if (!det) return;
    openModal('Product Details', `
      <p><strong>Detected Object</strong></p>
      <p>Position: (${Math.round(det.x)}, ${Math.round(det.y)})</p>
      <p>Size: ${Math.round(det.width)} × ${Math.round(det.height)} px</p>
      <p>Confidence: ${Math.round(det.confidence * 100)}%</p>
      <button class="affiliate-btn" id="affiliate-link">
        🛒 Shop Similar on Amazon
      </button>
      <p class="text-muted" style="margin-top:10px;font-size:0.8rem;">
        Full product recognition coming soon
      </p>
    `);
    document.getElementById('affiliate-link')?.addEventListener('click', () => {
      window.open(
        'https://www.amazon.com/s?k=detected+object&tag=youraffiliate-20',
        '_blank', 'noopener,noreferrer'
      );
    });
  });

  // ── Modal close ───────────────────────────────────────────────────────────
  refs('modalClose')?.addEventListener('click', closeModal);
  refs('modalOverlay')?.addEventListener('click', (e) => {
    if (e.target === refs('modalOverlay')) closeModal();
  });

  // Keyboard: Escape closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // ── Mic ──────────────────────────────────────────────────────────────────
  refs('micBtn')?.addEventListener('click', toggleListening);

  // ── Settings toggles ──────────────────────────────────────────────────────
  refs('offlineToggle')?.addEventListener('change', async (e) => {
    setState({ offlineMode: e.target.checked });
    await saveSetting('offlineMode', e.target.checked);
    showToast(`Offline mode ${e.target.checked ? 'enabled' : 'disabled'}`);
  });

  refs('voiceFeedbackToggle')?.addEventListener('change', async (e) => {
    setState({ voiceFeedback: e.target.checked });
    await saveSetting('voiceFeedback', e.target.checked);
    showToast(`Voice feedback ${e.target.checked ? 'on' : 'off'}`);
  });

  refs('arOpacityRange')?.addEventListener('input', async (e) => {
    const val = parseFloat(e.target.value);
    setState({ arOpacity: val });
    await saveSetting('arOpacity', val);
  });

  refs('cameraResSelect')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    setState({ cameraRes: val });
    await saveSetting('cameraRes', val);
    showToast(`Resolution set to ${val} — restart camera to apply`);
  });

  // ── Explore search ────────────────────────────────────────────────────────
  refs('exploreSearch')?.addEventListener('input', (e) => {
    const q   = e.target.value.trim().toLowerCase();
    const poi = refs('poiList');
    if (!poi) return;
    poi.innerHTML = q
      ? `<p class="placeholder-text">🔍 Searching for "<em>${_escape(q)}</em>"…</p>`
      : '<p class="placeholder-text">Nearby places will appear here</p>';
  });
}

// ─── Sanitise for innerHTML placeholder ─────────────────────────────────────

function _escape(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Go ──────────────────────────────────────────────────────────────────────

start();
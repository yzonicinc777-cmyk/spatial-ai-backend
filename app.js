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

import { initDOM, refs, refList, getState, setState,
         setSavedTemplates, loadSettings, loadTemplatesFromDB,
         saveSetting }                         from './js/core.js';
import { initNetwork, initBattery, initGPS, initCompass,
         initDetectionWorker, enterTemplateMode, clearTemplate, setTemplate,
         initVoice, toggleListening,
         setDetectionDrawCallbacks, setVoiceCameraCallbacks,
         getFrameSender }                      from './js/engine.js';
import { initBackground, initClock, hideSplash, scheduleSplashHide,
         updateStatus, showToast, navigateTo, bindStateToUI,
         openModal, closeModal, addRippleEffect,
         initCamera, toggleFlashlight, captureRegion, captureCentre,
         eventToVideoCoords, bindCompassRing,
         setFrameCallback,
         drawMatches, clearOverlay, hideDetectionBox,
         positionDetectionBox }                from './js/render.js';

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
    
    // 1. Load saved user settings (from storage.js)
    const savedSettings = await loadSettings() || {};
    
    // 2. Define defaults matching the Rust 'DetectionConfig' struct exactly
    const defaultConfig = {
        min_confidence: 0.35,
        max_results: 5,
        step: 2,
        multi_scale: true,
        use_edges: false,
        use_color: true,
        use_features: false,
        pyramid_levels: 3,
        harris_k: 0.04,
        harris_threshold: 1e6, // Note: Rust uses 1e6 (number), not "1e6" (string)
        min_feature_inliers: 6,
        ransac_iterations: 200,
        histogram_gate: 0.10,
        iou_threshold: 0.30,
        search_margin: 64
    };

    // 3. Merge saved settings with defaults and configure
    const finalConfig = { ...defaultConfig, ...savedSettings };
    configure(JSON.stringify(finalConfig));
    
    console.info('[app] Spatial AI Core loaded and configured');
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
  // Auto-start camera immediately without waiting for gesture
  (async () => {
    await initCamera();
    initDetectionWorker();
    setFrameCallback(getFrameSender());
    setDetectionDrawCallbacks({ drawMatches, clearOverlay, hideDetectionBox, positionDetectionBox });
    setVoiceCameraCallbacks({ captureCentre, toggleFlashlight });
    await initCompass(() => updateStatus('Compass permission denied', 'warn'));
  })();
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

  // ── Sidebar toggle ─────────────────────────────────────────────────────────
  const sidebarToggle   = document.getElementById('sidebar-toggle');
  const sidebarClose    = document.getElementById('sidebar-close');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const sidebar         = refs('navBar');  // #nav-bar

  const openSidebar  = () => {
    sidebar?.classList.add('open');
    sidebarBackdrop?.classList.add('open');
    sidebarToggle?.setAttribute('aria-expanded', 'true');
    sidebar?.setAttribute('aria-hidden', 'false');
  };
  const closeSidebar = () => {
    sidebar?.classList.remove('open');
    sidebarBackdrop?.classList.remove('open');
    sidebarToggle?.setAttribute('aria-expanded', 'false');
    sidebar?.setAttribute('aria-hidden', 'true');
  };

  sidebarToggle?.addEventListener('click',   openSidebar);
  sidebarClose?.addEventListener('click',    closeSidebar);
  sidebarBackdrop?.addEventListener('click', closeSidebar);

  // Close sidebar when a nav item is chosen
  for (const btn of refList('navBtns')) {
    btn.addEventListener('click', closeSidebar);
  }

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });

  // ── Gemini + menu toggle ───────────────────────────────────────────────────
  const plusBtn  = document.getElementById('gemini-plus-btn');
  const plusMenu = document.getElementById('gemini-menu');

  const openMenu  = () => {
    plusBtn?.classList.add('open');
    plusMenu?.classList.add('open');
    plusBtn?.setAttribute('aria-expanded', 'true');
    plusMenu?.setAttribute('aria-hidden', 'false');
  };
  const closeMenu = () => {
    plusBtn?.classList.remove('open');
    plusMenu?.classList.remove('open');
    plusBtn?.setAttribute('aria-expanded', 'false');
    plusMenu?.setAttribute('aria-hidden', 'true');
  };

  plusBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    plusMenu?.classList.contains('open') ? closeMenu() : openMenu();
  });

  // Close menu when any menu item is clicked
  plusMenu?.querySelectorAll('.gemini-menu-item').forEach(item => {
    item.addEventListener('click', closeMenu);
  });

  // Close menu on outside click
  document.addEventListener('click', (e) => {
    if (!plusBtn?.contains(e.target) && !plusMenu?.contains(e.target)) closeMenu();
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
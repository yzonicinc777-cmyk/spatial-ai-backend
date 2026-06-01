/**
 * render.js — Camera pipeline, overlay rendering, and presentation layer.
 *
 * Consolidates: camera.js · ui.js
 *
 * Sections:
 *   ① CAMERA  — getUserMedia, frame-capture loop, template capture,
 *                overlay canvas drawing, flashlight, compass ring
 *   ② UI      — Splash, particle background, clock, status bar, toasts,
 *                modal, navigation, stats, reactive bindings
 *
 * Circular-dep strategy (same as original):
 *   • render.js does NOT import engine.js at module level.
 *   • engine.js calls setFrameCallback() / setDetectionDrawCallbacks() /
 *     setVoiceCameraCallbacks() after both modules are loaded.
 *
 * Security: no eval; canvas only reads local MediaStream frames.
 */

import { refs, refList, setText, toggleClass, addClass, removeClass } from './core.js';
import { setState, getState, subscribe }                              from './core.js';

// ── Injection points filled by engine.js ─────────────────────────────────────

/** Set by engine.js — receives (ImageData, w, h) each frame. */
let _onFrameReady = null;

/**
 * Called by engine.js (detection) after worker is up.
 * @param {function(ImageData, number, number): void | null} cb
 */
export function setFrameCallback(cb) {
  _onFrameReady = cb;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ① CAMERA
// ═══════════════════════════════════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────────────────────────────────

const FRAME_SKIP   = 3;   // process every Nth frame
const RETICLE_SIZE = 50;  // px² template capture region

// ── Private refs ──────────────────────────────────────────────────────────────

let _video         = null;
let _overlayCanvas = null;
let _overlayCtx    = null;
let _captureCanvas = null;
let _captureCtx    = null;
let _frameCount    = 0;
let _stream        = null;
let _raf           = null;

const RES_MAP = {
  '1080p': { width: 1920, height: 1080 },
  '720p':  { width: 1280, height: 720  },
  '480p':  { width: 854,  height: 480  },
};

// ── Camera init ───────────────────────────────────────────────────────────────

/**
 * Open the rear camera and wire the video element.
 * @returns {Promise<void>}
 */
export async function initCamera() {
  _video         = refs('video');
  _overlayCanvas = refs('overlayCanvas');

  if (!_video || !_overlayCanvas) {
    console.error('[camera] Missing video or overlay canvas elements');
    return;
  }

  _overlayCtx = _overlayCanvas.getContext('2d');

  const res         = getState('cameraRes');
  const constraints = RES_MAP[res] || RES_MAP['720p'];

  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width:  { ideal: constraints.width  },
        height: { ideal: constraints.height },
      },
      audio: false,
    });

    _video.srcObject = _stream;
    await _video.play();

    _initCaptureCanvas();
    _bindResizeObserver();
    setState({ cameraActive: true });
    updateStatus('Camera ready');
    showToast('Camera active', 'success');
    _startFrameLoop();

  } catch (err) {
    const msg = err.name === 'NotAllowedError'
      ? 'Camera permission denied'
      : `Camera error: ${err.message}`;
    updateStatus(msg, 'error');
    showToast(msg, 'error');
    console.error('[camera]', err);
  }
}

export function stopCamera() {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  if (_stream) {
    _stream.getTracks().forEach(t => t.stop());
    _stream = null;
  }
  setState({ cameraActive: false, torchOn: false });
}

// ── Canvas setup ──────────────────────────────────────────────────────────────

function _initCaptureCanvas() {
  if (_captureCanvas) return;
  _captureCanvas = document.createElement('canvas');
  _captureCtx    = _captureCanvas.getContext('2d', { willReadFrequently: true });
}

function _syncCanvasSizes() {
  if (!_video || !_video.videoWidth) return;
  const w = _video.videoWidth;
  const h = _video.videoHeight;

  if (_overlayCanvas.width !== w || _overlayCanvas.height !== h) {
    _overlayCanvas.width  = w;
    _overlayCanvas.height = h;
  }
  if (_captureCanvas && (_captureCanvas.width !== w || _captureCanvas.height !== h)) {
    _captureCanvas.width  = w;
    _captureCanvas.height = h;
  }
}

function _bindResizeObserver() {
  _video.addEventListener('loadedmetadata', _syncCanvasSizes);
  if (window.ResizeObserver) {
    new ResizeObserver(_syncCanvasSizes).observe(_video);
  } else {
    window.addEventListener('resize', _syncCanvasSizes, { passive: true });
  }
  _syncCanvasSizes();
}

// ── Frame-capture loop ────────────────────────────────────────────────────────

function _startFrameLoop() {
  const tick = () => {
    _raf = requestAnimationFrame(tick);

    if (++_frameCount % FRAME_SKIP !== 0) return;
    if (!_video || _video.readyState < 2) return;
    if (!getState('workerReady') || !_onFrameReady) return;

    _syncCanvasSizes();

    const w = _captureCanvas.width;
    const h = _captureCanvas.height;
    if (!w || !h) return;

    _captureCtx.drawImage(_video, 0, 0, w, h);
    const imageData = _captureCtx.getImageData(0, 0, w, h);
    _onFrameReady(imageData, w, h);  // transfers ownership
  };

  _raf = requestAnimationFrame(tick);
}

// ── Template capture ──────────────────────────────────────────────────────────

/**
 * Capture a RETICLE_SIZE² region around (x, y) in video-space.
 * @param {number} x
 * @param {number} y
 * @returns {ImageData|null}
 */
export function captureRegion(x, y) {
  if (!_video || _video.readyState < 2 || !_captureCtx) return null;
  _syncCanvasSizes();
  const w = _captureCanvas.width;
  const h = _captureCanvas.height;
  _captureCtx.drawImage(_video, 0, 0, w, h);
  const cx = Math.max(0, Math.min(Math.round(x), w - RETICLE_SIZE));
  const cy = Math.max(0, Math.min(Math.round(y), h - RETICLE_SIZE));
  return _captureCtx.getImageData(cx, cy, RETICLE_SIZE, RETICLE_SIZE);
}

/**
 * Capture at centre of video frame.
 * @returns {ImageData|null}
 */
export function captureCentre() {
  if (!_video) return null;
  return captureRegion(_video.videoWidth / 2, _video.videoHeight / 2);
}

/** Convert pointer event on the video element to video-space coordinates. */
export function eventToVideoCoords(e) {
  if (!_video) return { x: 0, y: 0 };
  const rect   = _video.getBoundingClientRect();
  const scaleX = _video.videoWidth  / rect.width;
  const scaleY = _video.videoHeight / rect.height;
  const client = e.touches ? e.touches[0] : e;
  return {
    x: (client.clientX - rect.left) * scaleX,
    y: (client.clientY - rect.top)  * scaleY,
  };
}

// ── Overlay rendering ─────────────────────────────────────────────────────────

/**
 * Draw detection match boxes + compass arrow on the overlay canvas.
 * @param {Array<{x,y,width,height,confidence,scale}>} matches
 */
export function drawMatches(matches) {
  if (!_overlayCtx || !_overlayCanvas) return;

  const { width: w, height: h } = _overlayCanvas;
  _overlayCtx.clearRect(0, 0, w, h);

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];

    _overlayCtx.save();
    _overlayCtx.strokeStyle = i === 0 ? '#4ecdc4' : '#ffb347';
    _overlayCtx.lineWidth   = i === 0 ? 3 : 2;
    _overlayCtx.shadowBlur  = i === 0 ? 14 : 6;
    _overlayCtx.shadowColor = i === 0 ? '#4ecdc4' : '#ffb347';
    _overlayCtx.strokeRect(m.x, m.y, m.width, m.height);
    _overlayCtx.restore();

    // Confidence label badge
    const pct    = `${Math.round(m.confidence * 100)}%`;
    const badgeW = _overlayCtx.measureText(pct).width + 12;
    _overlayCtx.fillStyle = 'rgba(0,0,0,0.6)';
    _overlayCtx.beginPath();
    _overlayCtx.roundRect?.(m.x, m.y - 20, badgeW, 18, 4)
      || _overlayCtx.fillRect(m.x, m.y - 20, badgeW, 18);
    _overlayCtx.fill();
    _overlayCtx.fillStyle = i === 0 ? '#4ecdc4' : '#ffb347';
    _overlayCtx.font      = '600 11px system-ui,sans-serif';
    _overlayCtx.fillText(pct, m.x + 6, m.y - 6);
  }

  // Compass arrow overlay
  const { compassVisible, heading, compassTarget } = getState();
  if (compassVisible && heading !== null) {
    _drawCompassArrow(w, h, heading, compassTarget);
  }
}

export function clearOverlay() {
  if (!_overlayCtx || !_overlayCanvas) return;
  _overlayCtx.clearRect(0, 0, _overlayCanvas.width, _overlayCanvas.height);
}

function _drawCompassArrow(cW, cH, heading, target) {
  const cx  = cW - 72;
  const cy  = cH - 72;
  const rad = ((target - heading) * Math.PI) / 180;
  const len = 42;
  const ex  = cx + Math.sin(rad) * len;
  const ey  = cy - Math.cos(rad) * len;

  _overlayCtx.save();
  _overlayCtx.strokeStyle = '#ffb347';
  _overlayCtx.lineWidth   = 3.5;
  _overlayCtx.shadowBlur  = 10;
  _overlayCtx.shadowColor = '#ffb347';
  _overlayCtx.lineCap     = 'round';
  _overlayCtx.beginPath();
  _overlayCtx.moveTo(cx, cy);
  _overlayCtx.lineTo(ex, ey);
  _overlayCtx.stroke();

  const a  = Math.atan2(ey - cy, ex - cx);
  const hl = 11;
  _overlayCtx.fillStyle = '#ffb347';
  _overlayCtx.beginPath();
  _overlayCtx.moveTo(ex, ey);
  _overlayCtx.lineTo(ex - hl * Math.cos(a - Math.PI / 6), ey - hl * Math.sin(a - Math.PI / 6));
  _overlayCtx.lineTo(ex - hl * Math.cos(a + Math.PI / 6), ey - hl * Math.sin(a + Math.PI / 6));
  _overlayCtx.closePath();
  _overlayCtx.fill();
  _overlayCtx.restore();
}

// ── Detection box DOM positioning ─────────────────────────────────────────────

/**
 * Move the AR detection box element to sit over the best match.
 * @param {{x,y,width,height,confidence,scale}} match
 */
export function positionDetectionBox(match) {
  const box  = refs('detectionBox');
  const lbl  = refs('detectionLabel');
  const dist = refs('detectionDistance');
  if (!box || !_video || !_overlayCanvas) return;

  const videoRect = _video.getBoundingClientRect();
  const scaleX    = videoRect.width  / _overlayCanvas.width;
  const scaleY    = videoRect.height / _overlayCanvas.height;

  box.style.left   = `${match.x * scaleX}px`;
  box.style.top    = `${match.y * scaleY}px`;
  box.style.width  = `${match.width  * scaleX}px`;
  box.style.height = `${match.height * scaleY}px`;
  box.classList.remove('hidden');

  if (lbl)  lbl.textContent  = `${Math.round(match.confidence * 100)}% match`;
  if (dist) dist.textContent = match.scale !== 1.0 ? `${match.scale.toFixed(1)}× scale` : '~1.5 m';

  setState({ lastDetection: match });
}

export function hideDetectionBox() {
  refs('detectionBox')?.classList.add('hidden');
  setState({ lastDetection: null });
}

// ── Flashlight ────────────────────────────────────────────────────────────────

export async function toggleFlashlight() {
  if (!_stream) { showToast('Camera not active', 'error'); return; }
  const track = _stream.getVideoTracks()[0];
  if (!track)  { showToast('No video track', 'error'); return; }

  try {
    const torchOn = !getState('torchOn');
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    setState({ torchOn });
    showToast(torchOn ? '💡 Flashlight on' : 'Flashlight off');
  } catch {
    showToast('Flashlight not supported on this device', 'error');
  }
}

// ── Compass ring DOM binding ──────────────────────────────────────────────────

export function bindCompassRing() {
  subscribe(['heading', 'compassTarget', 'compassVisible'], () => {
    const ring = refs('compassRing');
    if (!ring) return;
    const { heading, compassTarget, compassVisible } = getState();
    ring.classList.toggle('hidden', !compassVisible);
    if (compassVisible && heading !== null) {
      ring.style.transform = `rotate(${compassTarget - heading}deg)`;
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ② UI
// ═══════════════════════════════════════════════════════════════════════════════

// ── Splash ────────────────────────────────────────────────────────────────────

let _splashHideTimer = null;

export function hideSplash() {
  if (_splashHideTimer) clearTimeout(_splashHideTimer);
  const splash = refs('splash');
  const app    = refs('app');

  if (splash) {
    splash.classList.add('hidden');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  }
  if (app) {
    app.style.opacity = '1';
    app.removeAttribute('aria-hidden');
  }
}

export function scheduleSplashHide(ms = 3200) {
  _splashHideTimer = setTimeout(() => {
    const splash = refs('splash');
    if (splash && !splash.classList.contains('hidden')) hideSplash();
  }, ms);
}

// ── Particle background ───────────────────────────────────────────────────────

const _TAU = Math.PI * 2;

let _bgAnimId  = null;
let _bgPaused  = false;
let _bgCtx     = null;
let _bgW = 0, _bgH = 0;
let _particles = [];
let _lastFrame = 0;

export function initBackground() {
  const canvas = refs('bgCanvas');
  if (!canvas) return;

  _bgCtx = canvas.getContext('2d');

  const resize = () => {
    _bgW = canvas.width  = window.innerWidth;
    _bgH = canvas.height = window.innerHeight;
  };
  window.addEventListener('resize', resize, { passive: true });
  resize();
  _spawnParticles();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _bgPaused = true;
      if (_bgAnimId) { cancelAnimationFrame(_bgAnimId); _bgAnimId = null; }
    } else {
      _bgPaused = false;
      _lastFrame = 0;
      _bgTick(0);
    }
  });

  _bgTick(0);
}

function _spawnParticles() {
  const isMobile = window.innerWidth < 768;
  const count    = isMobile ? 28 : 55;
  _particles = Array.from({ length: count }, () => ({
    x:     Math.random() * _bgW,
    y:     Math.random() * _bgH,
    vx:    (Math.random() - 0.5) * 0.22,
    vy:    (Math.random() - 0.5) * 0.22,
    r:     Math.random() * 1.6 + 0.5,
    alpha: Math.random() * 0.4 + 0.1,
    hue:   Math.random() > 0.7 ? 280 : 190,
    sat:   80 + Math.random() * 20,
    phase: Math.random() * _TAU,
    speed: 0.008 + Math.random() * 0.012,
  }));
}

function _bgTick(ts) {
  if (_bgPaused || !_bgCtx) return;
  if (ts - _lastFrame < 14) { _bgAnimId = requestAnimationFrame(_bgTick); return; }
  _lastFrame = ts;
  _bgCtx.clearRect(0, 0, _bgW, _bgH);

  for (const p of _particles) {
    p.x += p.vx; p.y += p.vy; p.phase += p.speed;
    if (p.x < 0 || p.x > _bgW) p.vx *= -1;
    if (p.y < 0 || p.y > _bgH) p.vy *= -1;
    const breathAlpha = p.alpha * (0.7 + 0.3 * Math.sin(p.phase));
    _bgCtx.beginPath();
    _bgCtx.arc(p.x, p.y, p.r, 0, _TAU);
    _bgCtx.fillStyle = `hsla(${p.hue},${p.sat}%,70%,${breathAlpha})`;
    _bgCtx.fill();
  }

  _bgCtx.strokeStyle = 'rgba(0,212,255,0.04)';
  _bgCtx.lineWidth   = 0.5;

  for (let i = 0; i < _particles.length; i++) {
    for (let j = i + 1; j < _particles.length; j++) {
      const dx   = _particles[i].x - _particles[j].x;
      const dy   = _particles[i].y - _particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 120) {
        _bgCtx.globalAlpha = (1 - dist / 120) * 0.08;
        _bgCtx.beginPath();
        _bgCtx.moveTo(_particles[i].x, _particles[i].y);
        _bgCtx.lineTo(_particles[j].x, _particles[j].y);
        _bgCtx.stroke();
      }
    }
  }

  _bgCtx.globalAlpha = 1;
  _bgAnimId = requestAnimationFrame(_bgTick);
}

// ── Clock ─────────────────────────────────────────────────────────────────────

let _clockId = null;

export function initClock() {
  _tick();
  const offset = 1000 - (Date.now() % 1000);
  setTimeout(() => { _tick(); _clockId = setInterval(_tick, 1000); }, offset);
}

function _tick() {
  const el = refs('clock');
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Status ────────────────────────────────────────────────────────────────────

const STATUS_COLOURS = {
  ok:    { bg: '#4ecdc4', shadow: '0 0 8px rgba(78,205,196,0.8)' },
  warn:  { bg: '#ffb347', shadow: '0 0 8px rgba(255,179,71,0.8)' },
  error: { bg: '#ff5f6d', shadow: '0 0 8px rgba(255,95,109,0.8)' },
};

export function updateStatus(msg, level = 'ok') {
  setText('statusText', msg);
  const dot = refs('statusDot');
  if (!dot) return;
  const c = STATUS_COLOURS[level] || STATUS_COLOURS.ok;
  dot.style.background = c.bg;
  dot.style.boxShadow  = c.shadow;
}

export function updateGPSBadge(accuracy) {
  const badge = refs('gpsBadge');
  if (!badge) return;
  badge.textContent = accuracy !== null ? `📍 ${Math.round(accuracy)}m` : '📍 --';
}

export function updateCompassBadge(heading) {
  setText('compassBadge', heading !== null ? `🧭 ${Math.round(heading)}°` : '🧭 --°');
}

export function updateBatteryBadge(level, charging) {
  const badge = refs('batteryBadge');
  if (!badge) return;
  if (level === null) { badge.textContent = '🔋 --'; return; }
  const icon = charging ? '⚡' : '🔋';
  badge.textContent   = `${icon} ${level}%`;
  badge.style.color   = level < 20 ? '#ff5f6d' : '';
}

export function updateNetworkBadge(online) {
  const badge = refs('networkBadge');
  if (!badge) return;
  badge.textContent = online ? '🌐' : '🚫';
  badge.className   = `status-badge${online ? ' online' : ''}`;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

const TOAST_DURATION = 2800;
let _toastQueue = 0;

const TOAST_BORDER = {
  success: '#4ecdc4',
  error:   '#ff5f6d',
  warn:    '#ffb347',
  info:    '#7b2ff7',
};

export function showToast(message, type = 'info') {
  const container = refs('toastContainer');
  if (!container) return;
  if (_toastQueue >= 3) return;   // collapse if too many
  _toastQueue++;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.borderLeftColor = TOAST_BORDER[type] || TOAST_BORDER.info;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  container.appendChild(toast);

  // Force reflow for CSS transition
  toast.getBoundingClientRect();

  const dismiss = () => {
    toast.style.transition = 'opacity 0.28s ease, transform 0.28s ease';
    toast.style.opacity    = '0';
    toast.style.transform  = 'translateY(-10px) scale(0.94)';
    setTimeout(() => { toast.remove(); _toastQueue = Math.max(0, _toastQueue - 1); }, 300);
  };

  const timer = setTimeout(dismiss, TOAST_DURATION);
  toast.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function openModal(title, bodyHTML) {
  const overlay = refs('modalOverlay');
  const titleEl = refs('modalTitle');
  const bodyEl  = refs('modalBody');
  if (!overlay || !titleEl || !bodyEl) return;

  titleEl.textContent = title;
  bodyEl.innerHTML    = bodyHTML;
  overlay.classList.remove('hidden');

  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
  });

  const focusable = overlay.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length) setTimeout(() => focusable[0].focus(), 80);
}

export function closeModal() {
  const overlay = refs('modalOverlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.addEventListener('transitionend', () => overlay.classList.add('hidden'), { once: true });
}

// ── Navigation ────────────────────────────────────────────────────────────────

export function navigateTo(page) {
  const pages   = refList('pages');
  const navBtns = refList('navBtns');

  for (const p of pages) {
    if (p.classList.contains('active')) {
      p.classList.remove('active');
      p.classList.add('page-exit');
      const clean = () => { p.classList.remove('page-exit'); p.removeEventListener('transitionend', clean); };
      p.addEventListener('transitionend', clean);
    }
  }

  const target = document.getElementById(`${page}-page`);
  if (target) {
    target.classList.remove('page-exit');
    requestAnimationFrame(() => target.classList.add('active'));
  }

  for (const btn of navBtns) {
    const isActive = btn.dataset.page === page;
    btn.classList.toggle('active-nav', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  }

  setState({ activePage: page });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export function renderStats() {
  const els  = refList('statValues');
  const s    = getState();
  const vals = [s.scanCount, s.templateCount, s.saveCount];
  vals.forEach((v, i) => { if (els[i]) els[i].textContent = v; });
}

// ── Templates list ────────────────────────────────────────────────────────────

export function renderTemplatesList() {
  const container = refs('templatesList');
  if (!container) return;

  const templates = getState('savedTemplates');

  if (!templates.length) {
    container.innerHTML = '<p class="placeholder-text">No templates saved yet</p>';
    return;
  }

  container.innerHTML = templates.map(t => `
    <div class="template-item" role="listitem">
      <span class="template-icon" aria-hidden="true">📸</span>
      <span class="template-name">${_esc(t.id)}</span>
      <span class="template-date">${new Date(t.date).toLocaleDateString()}</span>
    </div>
  `).join('');
}

// ── Ripple ────────────────────────────────────────────────────────────────────

export function addRippleEffect(e) {
  const btn    = e.currentTarget;
  const ripple = btn.querySelector('.nav-ripple');
  if (!ripple) return;

  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);

  ripple.style.cssText = `
    width:${size}px;height:${size}px;
    left:${e.clientX - rect.left - size / 2}px;
    top:${e.clientY - rect.top - size / 2}px;
    animation:none;
  `;
  ripple.getBoundingClientRect();
  ripple.style.animation = 'rippleEffect 0.6s linear';
}

// ── HTML escape helper ────────────────────────────────────────────────────────

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Reactive bindings ─────────────────────────────────────────────────────────

export function bindStateToUI() {
  subscribe(['scanCount', 'templateCount', 'saveCount'], renderStats);
  subscribe('savedTemplates', renderTemplatesList);
  subscribe('isOnline',      online => updateNetworkBadge(online));
  subscribe('heading',       h      => updateCompassBadge(h));
  subscribe('gpsAccuracy',   a      => updateGPSBadge(a));
  subscribe(['batteryLevel', 'batteryCharging'], () => {
    const { batteryLevel, batteryCharging } = getState();
    updateBatteryBadge(batteryLevel, batteryCharging);
  });
}
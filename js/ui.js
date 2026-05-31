/**
 * ui.js — UI presentation layer.
 *
 * Responsibilities:
 *   • Splash show/hide
 *   • Particle background canvas
 *   • Status bar (clock, badges, status dot)
 *   • Toast notifications
 *   • Modal dialog
 *   • Navigation page transitions
 *   • Stats display
 *   • Templates list render
 *
 * This module never mutates state directly — it reads from state and
 * updates DOM only.
 */

import { refs, refList, setText, addClass, removeClass, toggleClass } from './dom.js';
import { getState, setState, subscribe } from './state.js';

// ─── Splash ──────────────────────────────────────────────────────────────────

let _splashHideTimer = null;

export function showSplash() {
  removeClass('splash', 'hidden');
}

export function hideSplash() {
  if (_splashHideTimer) clearTimeout(_splashHideTimer);

  const splash = refs('splash');
  const app    = refs('app');

  if (splash) splash.classList.add('hidden');
  if (app)    app.style.opacity = '1';
}

/** Auto-hide splash after ms if not hidden already. */
export function scheduleSplashHide(ms = 3200) {
  _splashHideTimer = setTimeout(() => {
    const splash = refs('splash');
    if (splash && !splash.classList.contains('hidden')) hideSplash();
  }, ms);
}

// ─── Particle background ─────────────────────────────────────────────────────

let _bgAnimId    = null;
let _bgPaused    = false;
let _bgCtx       = null;
let _bgW         = 0;
let _bgH         = 0;
let _particles   = [];

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

  const isMobile = window.innerWidth < 768;
  const count    = isMobile ? 22 : 44;

  _particles = Array.from({ length: count }, () => ({
    x:      Math.random() * _bgW,
    y:      Math.random() * _bgH,
    vx:     (Math.random() - 0.5) * 0.28,
    vy:     (Math.random() - 0.5) * 0.28,
    radius: Math.random() * 1.8 + 0.8,
    alpha:  Math.random() * 0.45 + 0.15,
  }));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _bgPaused = true;
      if (_bgAnimId) { cancelAnimationFrame(_bgAnimId); _bgAnimId = null; }
    } else {
      _bgPaused = false;
      _bgDraw();
    }
  });

  _bgDraw();
}

function _bgDraw() {
  if (_bgPaused || !_bgCtx) return;

  _bgCtx.clearRect(0, 0, _bgW, _bgH);

  for (const p of _particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > _bgW) p.vx *= -1;
    if (p.y < 0 || p.y > _bgH) p.vy *= -1;

    _bgCtx.beginPath();
    _bgCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    _bgCtx.fillStyle = `rgba(0,212,255,${p.alpha})`;
    _bgCtx.fill();
  }

  _bgAnimId = requestAnimationFrame(_bgDraw);
}

// ─── Clock ───────────────────────────────────────────────────────────────────

let _clockInterval = null;

export function initClock() {
  _updateClock();
  _clockInterval = setInterval(_updateClock, 1000);
}

function _updateClock() {
  setText('clock', new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
}

// ─── Status bar ──────────────────────────────────────────────────────────────

/**
 * Update the status indicator text and dot colour.
 * @param {string}  msg
 * @param {'ok'|'warn'|'error'} level
 */
export function updateStatus(msg, level = 'ok') {
  setText('statusText', msg);

  const dot = refs('statusDot');
  if (!dot) return;

  const colours = {
    ok:    { bg: '#4ecdc4', shadow: '0 0 8px #4ecdc4' },
    warn:  { bg: '#ffb347', shadow: '0 0 8px #ffb347' },
    error: { bg: '#ff6b6b', shadow: '0 0 8px #ff6b6b' },
  };
  const c = colours[level] || colours.ok;
  dot.style.background  = c.bg;
  dot.style.boxShadow   = c.shadow;
}

/** Update GPS badge. */
export function updateGPSBadge(accuracy) {
  const badge = refs('gpsBadge');
  if (!badge) return;
  badge.textContent = accuracy !== null ? `📍 ${Math.round(accuracy)}m` : '📍 Off';
}

/** Update compass badge. */
export function updateCompassBadge(heading) {
  setText('compassBadge', heading !== null ? `🧭 ${Math.round(heading)}°` : '🧭 --°');
}

/** Update battery badge. */
export function updateBatteryBadge(level, charging) {
  const badge = refs('batteryBadge');
  if (!badge) return;
  if (level === null) { badge.textContent = '🔋 --'; return; }
  const icon = charging ? '⚡' : '🔋';
  badge.textContent = `${icon} ${level}%`;
  badge.style.color = level < 20 ? 'var(--accent-coral)' : '';
}

/** Update network badge. */
export function updateNetworkBadge(online) {
  const badge = refs('networkBadge');
  if (!badge) return;
  badge.textContent = online ? '🌐' : '🚫';
  badge.className   = `status-badge${online ? ' online' : ''}`;
}

// ─── Toast ───────────────────────────────────────────────────────────────────

const TOAST_DURATION = 2800;

/**
 * @param {string} message
 * @param {'info'|'success'|'error'|'warn'} type
 */
export function showToast(message, type = 'info') {
  const container = refs('toastContainer');
  if (!container) return;

  const borderColours = {
    success: '#4ecdc4',
    error:   '#ff6b6b',
    warn:    '#ffb347',
    info:    '#7b2ff7',
  };

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.borderLeftColor = borderColours[type] || borderColours.info;

  // Accessibility
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  container.appendChild(toast);

  // Force reflow for entrance animation
  toast.getBoundingClientRect();

  const dismiss = () => {
    toast.style.opacity    = '0';
    toast.style.transform  = 'translateY(-12px) scale(0.94)';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    setTimeout(() => toast.remove(), 320);
  };

  const timer = setTimeout(dismiss, TOAST_DURATION);
  toast.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
}

// ─── Modal ───────────────────────────────────────────────────────────────────

/**
 * Open the modal with a title and arbitrary HTML body.
 * @param {string} title
 * @param {string} bodyHTML   — caller is responsible for sanitising
 */
export function openModal(title, bodyHTML) {
  const overlay = refs('modalOverlay');
  const titleEl = refs('modalTitle');
  const bodyEl  = refs('modalBody');

  if (!overlay || !titleEl || !bodyEl) return;

  titleEl.textContent = title;
  bodyEl.innerHTML    = bodyHTML;

  overlay.classList.add('visible');
  overlay.setAttribute('aria-hidden', 'false');

  // Trap focus inside modal
  const focusable = overlay.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length) focusable[0].focus();
}

export function closeModal() {
  const overlay = refs('modalOverlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.setAttribute('aria-hidden', 'true');
}

// ─── Navigation ──────────────────────────────────────────────────────────────

/**
 * Transition to a named page.
 * @param {'camera'|'explore'|'profile'|'settings'} page
 */
export function navigateTo(page) {
  const pages   = refList('pages');
  const navBtns = refList('navBtns');

  // Slide out current
  for (const p of pages) {
    if (p.classList.contains('active')) {
      p.classList.remove('active');
      p.classList.add('page-exit');
      // Clean up exit class after transition
      const onEnd = () => { p.classList.remove('page-exit'); p.removeEventListener('transitionend', onEnd); };
      p.addEventListener('transitionend', onEnd);
    }
  }

  // Slide in target
  const target = document.getElementById(`${page}-page`);
  if (target) {
    target.classList.remove('page-exit');
    // rAF ensures exit class is applied first
    requestAnimationFrame(() => target.classList.add('active'));
  }

  // Update nav pills
  for (const btn of navBtns) {
    const isActive = btn.dataset.page === page;
    btn.classList.toggle('active-nav', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  }

  setState({ activePage: page });
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export function renderStats() {
  const els  = refList('statValues');
  const s    = getState();
  const vals = [s.scanCount, s.templateCount, s.saveCount];
  vals.forEach((v, i) => { if (els[i]) els[i].textContent = v; });
}

// ─── Templates list ──────────────────────────────────────────────────────────

export function renderTemplatesList() {
  const container = refs('templatesList');
  if (!container) return;

  const templates = getState('savedTemplates');

  if (templates.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No templates saved yet</p>';
    return;
  }

  container.innerHTML = templates.map(t => `
    <div class="template-item" role="listitem">
      <span class="template-icon" aria-hidden="true">📸</span>
      <span class="template-name">${_escapeHTML(t.id)}</span>
      <span class="template-date">${new Date(t.date).toLocaleDateString()}</span>
    </div>
  `).join('');
}

// ─── Ripple effect ───────────────────────────────────────────────────────────

export function addRippleEffect(e) {
  const btn    = e.currentTarget;
  const ripple = btn.querySelector('.nav-ripple');
  if (!ripple) return;

  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);

  ripple.style.width  = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left   = `${e.clientX - rect.left  - size / 2}px`;
  ripple.style.top    = `${e.clientY - rect.top   - size / 2}px`;
  ripple.style.animation = 'none';
  ripple.getBoundingClientRect(); // force reflow
  ripple.style.animation = 'rippleEffect 0.6s linear';
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function _escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Reactive bindings ───────────────────────────────────────────────────────

/** Wire state → UI reactively. Call once after initDOM(). */
export function bindStateToUI() {
  subscribe(['scanCount', 'templateCount', 'saveCount'], renderStats);
  subscribe('savedTemplates', renderTemplatesList);

  subscribe('isOnline', (online) => updateNetworkBadge(online));
  subscribe('batteryLevel', () => {
    const s = getState();
    updateBatteryBadge(s.batteryLevel, s.batteryCharging);
  });
  subscribe('batteryCharging', () => {
    const s = getState();
    updateBatteryBadge(s.batteryLevel, s.batteryCharging);
  });
  subscribe('heading', (h) => updateCompassBadge(h));
  subscribe('gpsAccuracy', (a) => updateGPSBadge(a));
}
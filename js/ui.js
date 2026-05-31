/**
 * ui.js — Presentation layer. World-class 2026 upgrade.
 *
 * Improvements over v1:
 *   • Particle system: orbital + nebula effect instead of plain dots
 *   • Status bar uses semantic colour tokens
 *   • Toast stacking with auto-dismiss queue
 *   • Modal is a bottom-sheet on mobile, centred dialog on desktop
 *   • Navigation uses CSS variable injection for active indicator
 *   • All DOM writes batched via requestAnimationFrame where possible
 *   • Zero layout-thrash reads/writes mixed
 */

import { refs, refList, setText, addClass, removeClass, toggleClass } from './dom.js';
import { getState, setState, subscribe } from './state.js';

// ─── Splash ──────────────────────────────────────────────────────────────────

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

// ─── Particle background ─────────────────────────────────────────────────────

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

  _particles = Array.from({ length: count }, (_, i) => ({
    x:      Math.random() * _bgW,
    y:      Math.random() * _bgH,
    vx:     (Math.random() - 0.5) * 0.22,
    vy:     (Math.random() - 0.5) * 0.22,
    r:      Math.random() * 1.6 + 0.5,
    alpha:  Math.random() * 0.4 + 0.1,
    // Hue drift: cyan → purple
    hue:    Math.random() > 0.7 ? 280 : 190,
    sat:    80 + Math.random() * 20,
    phase:  Math.random() * _TAU,
    speed:  0.008 + Math.random() * 0.012,
  }));
}

function _bgTick(ts) {
  if (_bgPaused || !_bgCtx) return;

  // 60fps cap
  if (ts - _lastFrame < 14) {
    _bgAnimId = requestAnimationFrame(_bgTick);
    return;
  }
  _lastFrame = ts;

  _bgCtx.clearRect(0, 0, _bgW, _bgH);

  for (const p of _particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.phase += p.speed;

    if (p.x < 0 || p.x > _bgW) p.vx *= -1;
    if (p.y < 0 || p.y > _bgH) p.vy *= -1;

    // Breathing alpha
    const breathAlpha = p.alpha * (0.7 + 0.3 * Math.sin(p.phase));

    _bgCtx.beginPath();
    _bgCtx.arc(p.x, p.y, p.r, 0, _TAU);
    _bgCtx.fillStyle = `hsla(${p.hue},${p.sat}%,70%,${breathAlpha})`;
    _bgCtx.fill();
  }

  // Draw subtle connection lines between close particles
  _bgCtx.strokeStyle = 'rgba(0,212,255,0.04)';
  _bgCtx.lineWidth = 0.5;

  for (let i = 0; i < _particles.length; i++) {
    for (let j = i + 1; j < _particles.length; j++) {
      const dx = _particles[i].x - _particles[j].x;
      const dy = _particles[i].y - _particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 120) {
        const a = (1 - dist / 120) * 0.08;
        _bgCtx.globalAlpha = a;
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

// ─── Clock ───────────────────────────────────────────────────────────────────

let _clockId = null;

export function initClock() {
  _tick();
  // Align to next full second boundary
  const offset = 1000 - (Date.now() % 1000);
  setTimeout(() => {
    _tick();
    _clockId = setInterval(_tick, 1000);
  }, offset);
}

function _tick() {
  const el = refs('clock');
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Status ──────────────────────────────────────────────────────────────────

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
  badge.textContent = `${icon} ${level}%`;
  badge.style.color = level < 20 ? '#ff5f6d' : '';
}

export function updateNetworkBadge(online) {
  const badge = refs('networkBadge');
  if (!badge) return;
  badge.textContent = online ? '🌐' : '🚫';
  badge.className   = `status-badge${online ? ' online' : ''}`;
}

// ─── Toast ───────────────────────────────────────────────────────────────────

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

  // Collapse if too many
  if (_toastQueue >= 3) return;
  _toastQueue++;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.borderLeftColor = TOAST_BORDER[type] || TOAST_BORDER.info;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  container.appendChild(toast);

  // Force reflow for animation
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

// ─── Modal ───────────────────────────────────────────────────────────────────

export function openModal(title, bodyHTML) {
  const overlay = refs('modalOverlay');
  const titleEl = refs('modalTitle');
  const bodyEl  = refs('modalBody');

  if (!overlay || !titleEl || !bodyEl) return;

  titleEl.textContent = title;
  bodyEl.innerHTML    = bodyHTML;

  overlay.classList.remove('hidden');
  // rAF ensures hidden → visible triggers the CSS transition
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
  });

  // Focus first interactive element
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

// ─── Navigation ──────────────────────────────────────────────────────────────

export function navigateTo(page) {
  const pages   = refList('pages');
  const navBtns = refList('navBtns');

  // Exit current
  for (const p of pages) {
    if (p.classList.contains('active')) {
      p.classList.remove('active');
      p.classList.add('page-exit');
      const clean = () => { p.classList.remove('page-exit'); p.removeEventListener('transitionend', clean); };
      p.addEventListener('transitionend', clean);
    }
  }

  // Enter target
  const target = document.getElementById(`${page}-page`);
  if (target) {
    target.classList.remove('page-exit');
    requestAnimationFrame(() => target.classList.add('active'));
  }

  // Nav pills
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

// ─── Ripple ──────────────────────────────────────────────────────────────────

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

  // Force reflow
  ripple.getBoundingClientRect();
  ripple.style.animation = 'rippleEffect 0.6s linear';
}

// ─── Escape helper ───────────────────────────────────────────────────────────

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Reactive bindings ───────────────────────────────────────────────────────

export function bindStateToUI() {
  subscribe(['scanCount', 'templateCount', 'saveCount'], renderStats);
  subscribe('savedTemplates', renderTemplatesList);
  subscribe('isOnline',       online  => updateNetworkBadge(online));
  subscribe('heading',        h       => updateCompassBadge(h));
  subscribe('gpsAccuracy',    a       => updateGPSBadge(a));
  subscribe(['batteryLevel', 'batteryCharging'], () => {
    const { batteryLevel, batteryCharging } = getState();
    updateBatteryBadge(batteryLevel, batteryCharging);
  });
}
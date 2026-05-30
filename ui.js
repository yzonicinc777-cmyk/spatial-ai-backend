// ui.js
import { state } from './state.js';
import {
  toastContainer, modalOverlay, modalTitle, modalBody, setTemplateBtn,
  detectionBuyBtn, modalClose, exploreSearch, poiList, fabBtn, video, detectionBox,
  statsElements, splashScreen, appContainer, bgCanvas, bgCtx, statusText, statusDot,
  compassRing, offlineToggle, voiceFeedbackToggle, templatesList   // ← added templatesList
} from './dom.js';
import {
  captureTemplateAt, autoCaptureTemplate, toggleFlashlight, clearTemplate, doScan
} from './camera.js';
import { saveSetting } from './store.js';
import { setCompassTarget } from './sensors.js';

// ---------- UI Helpers ----------
export function updateStatus(msg, isWarning = false) {
  if (statusText) statusText.textContent = msg;
  if (statusDot) {
    statusDot.style.background = isWarning ? '#ff6b6b' : '#4ecdc4';
    statusDot.style.boxShadow = isWarning ? '0 0 8px #ff6b6b' : '0 0 8px #4ecdc4';
  }
  console.log('[Status]', msg);
}

export function vibrate(duration = 20) {
  if (navigator.vibrate) navigator.vibrate(duration);
}

export function showToast(message, type = 'info') {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  if (type === 'success') toast.style.borderLeftColor = '#4ecdc4';
  else if (type === 'error') toast.style.borderLeftColor = '#ff6b6b';
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

export function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`${page}-page`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active-nav', btn.getAttribute('data-page') === page);
  });
  vibrate(15);
}

export function addRippleEffect(e) {
  const btn = e.currentTarget;
  const ripple = btn.querySelector('.nav-ripple');
  if (!ripple) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  ripple.style.animation = 'none';
  ripple.offsetHeight;
  ripple.style.animation = 'rippleEffect 0.6s linear';
}

export function renderTemplatesList() {
  if (!templatesList) return;
  if (state.savedTemplates.length === 0) {
    templatesList.innerHTML = '<p class="placeholder-text">No templates saved yet</p>';
  } else {
    templatesList.innerHTML = state.savedTemplates.map(t =>
      `<div class="template-item">📸 ${t.id} <span style="font-size:0.7rem;opacity:0.6">${new Date(t.date).toLocaleDateString()}</span></div>`
    ).join('');
  }
}

export function updateStats() {
  if (statsElements && statsElements.length >= 3) {
    statsElements[0].textContent = state.scanCount;
    statsElements[1].textContent = state.templateCount;
    statsElements[2].textContent = state.saveCount;
  }
}

export function showProductModal() {
  if (!modalOverlay || !state.lastDetection) return;
  modalTitle.textContent = 'Product Details';
  modalBody.innerHTML = `
    <p><strong>Detected Object</strong></p>
    <p>Coordinates: (${Math.round(state.lastDetection.x)}, ${Math.round(state.lastDetection.y)})</p>
    <p>Size: ${state.lastDetection.w} x ${state.lastDetection.h}</p>
    <button class="affiliate-btn" id="affiliate-link">Buy from Amazon (affiliate)</button>
    <p class="text-muted" style="margin-top:8px;">Coming soon: real product match</p>
  `;
  modalOverlay.classList.add('visible');
  document.getElementById('affiliate-link')?.addEventListener('click', () => {
    window.open('https://www.amazon.com/s?k=detected+object&tag=youraffiliate-20', '_blank');
  });
}

// ---------- Template Mode ----------
export function enterTemplateMode() {
  state.templateMode = true;
  setTemplateBtn?.classList.add('mode-active');
  updateStatus('Tap an object to set template');
  vibrate();
}

export function exitTemplateMode() {
  state.templateMode = false;
  setTemplateBtn?.classList.remove('mode-active');
}

// ---------- Splash & Background ----------
export function initSplash() {
  const hideSplash = () => {
    if (splashScreen) splashScreen.classList.add('hidden');
    if (appContainer) appContainer.style.opacity = '1';
  };
  setTimeout(() => {
    if (splashScreen && !splashScreen.classList.contains('hidden')) hideSplash();
  }, 3200);
  return hideSplash;
}

export function initBackground() {
  if (!bgCanvas) return;
  if (!bgCtx) bgCtx = bgCanvas.getContext('2d');
  let w, h;
  const resize = () => {
    w = bgCanvas.width = window.innerWidth;
    h = bgCanvas.height = window.innerHeight;
  };
  window.addEventListener('resize', resize);
  resize();

  const isMobile = window.innerWidth < 768;
  const particleCount = isMobile ? 20 : 40;
  const particles = [];
  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      radius: Math.random() * 2 + 1,
      alpha: Math.random() * 0.5 + 0.2
    });
  }

  let bgAnimId = null;
  let bgPaused = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      bgPaused = true;
      if (bgAnimId) cancelAnimationFrame(bgAnimId);
    } else {
      bgPaused = false;
      draw();
    }
  });

  function draw() {
    if (bgPaused) return;
    if (!bgCtx) return;
    bgCtx.clearRect(0, 0, w, h);
    for (let p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      bgCtx.beginPath();
      bgCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      bgCtx.fillStyle = `rgba(0,212,255,${p.alpha})`;
      bgCtx.fill();
    }
    bgAnimId = requestAnimationFrame(draw);
  }
  draw();
}

// ---------- Event Binding (called from app.js) ----------
export function initUI() {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      navigateTo(btn.getAttribute('data-page'));
      addRippleEffect(e);
    });
  });

  const scanBtn = document.getElementById('scanBtn');
  const setTemplateBtnEl = document.getElementById('setTemplateBtn');
  const flashlightBtnEl = document.getElementById('flashlightBtn');
  scanBtn?.addEventListener('click', doScan);
  setTemplateBtnEl?.addEventListener('click', enterTemplateMode);
  flashlightBtnEl?.addEventListener('click', toggleFlashlight);

  const micBtn = document.getElementById('mic-btn');
  micBtn?.addEventListener('click', () => {
    if (!state.recognition) { showToast('Voice not supported', 'error'); return; }
    if (state.isListening) state.recognition.stop();
    else state.recognition.start();
  });

  video?.addEventListener('click', (e) => {
    if (!state.templateMode) return;
    const rect = video.getBoundingClientRect();
    const scaleX = video.videoWidth / rect.width;
    const scaleY = video.videoHeight / rect.height;
    captureTemplateAt(
      (e.clientX - rect.left) * scaleX,
      (e.clientY - rect.top) * scaleY
    );
  });

  const detectionBuyBtnEl = document.getElementById('detection-buy-btn');
  detectionBuyBtnEl?.addEventListener('click', showProductModal);

  const modalCloseBtn = document.getElementById('modal-close');
  const modalOverlayEl = document.getElementById('modal-overlay');
  modalCloseBtn?.addEventListener('click', () => modalOverlayEl?.classList.remove('visible'));
  modalOverlayEl?.addEventListener('click', (e) => {
    if (e.target === modalOverlayEl) modalOverlayEl.classList.remove('visible');
  });

  const offlineToggleEl = document.getElementById('offline-toggle');
  const voiceFeedbackToggleEl = document.getElementById('voice-feedback-toggle');
  offlineToggleEl?.addEventListener('change', (e) => {
    saveSetting('offlineMode', e.target.checked);
    showToast(`Offline mode ${e.target.checked ? 'enabled' : 'disabled'}`);
  });
  voiceFeedbackToggleEl?.addEventListener('change', (e) => {
    saveSetting('voiceFeedback', e.target.checked);
    showToast(`Voice feedback ${e.target.checked ? 'on' : 'off'}`);
  });

  const exploreSearchEl = document.getElementById('explore-search');
  const poiListEl = document.getElementById('poi-list');
  exploreSearchEl?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    if (poiListEl) {
      poiListEl.innerHTML = query
        ? `<p>🔍 Searching for "${query}" in offline DB...</p>`
        : '<p class="placeholder-text">Nearby places will appear here</p>';
    }
  });

  const fabBtnEl = document.getElementById('ai-lens-fab');
  fabBtnEl?.addEventListener('click', () => {
    doScan();
    navigateTo('camera');
    showToast('AI Lens activated – center object scanned');
  });

  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo('camera'));
  });
}
// app.js – main orchestrator
import init, { greet } from '/pkg/spatial_explorer_core.js';
import { initCamera, startFrameCapture } from './camera.js';
import { initCompass, updateClock, updateGPS, updateBattery } from './sensors.js';
import { initVoice } from './voice.js';
import { loadSettings, loadTemplatesFromDB } from './store.js';
import { initUI, initSplash, initBackground, updateStatus, showToast } from './ui.js';
import { setDomElements } from './dom.js';  // ← new import

async function start() {
  // Get DOM elements
  const get = id => document.getElementById(id);
  
  // Collect all DOM references in an object
  const elements = {
    splashScreen: get('splash-screen'),
    appContainer: get('app'),
    bgCanvas: get('bg-canvas'),
    clockEl: get('clock'),
    gpsBadge: get('gps-badge'),
    compassBadge: get('compass-badge'),
    batteryBadge: get('battery-badge'),
    networkBadge: get('network-badge'),
    statusText: get('status-text'),
    statusDot: document.querySelector('.status-dot'),
    video: get('video'),
    overlayCanvas: get('overlay-canvas'),
    detectionBox: get('detection-box'),
    detectionLabel: get('detection-label'),
    detectionDistance: get('detection-distance'),
    detectionBuyBtn: get('detection-buy-btn'),
    compassRing: get('compass-ring'),
    voiceBar: get('voice-bar'),
    micBtn: get('mic-btn'),
    voiceText: get('voice-text'),
    voiceWave: get('voice-wave'),
    scanBtn: get('scanBtn'),
    setTemplateBtn: get('setTemplateBtn'),
    flashlightBtn: get('flashlightBtn'),
    exploreSearch: get('explore-search'),
    mapContainer: get('map-container'),
    poiList: get('poi-list'),
    templatesList: get('templates-list'),
    offlineToggle: get('offline-toggle'),
    voiceFeedbackToggle: get('voice-feedback-toggle'),
    statsElements: document.querySelectorAll('.stat strong'),
    navBar: get('nav-bar'),
    fabBtn: get('ai-lens-fab'),
    toastContainer: get('toast-container'),
    modalOverlay: get('modal-overlay'),
    modalTitle: get('modal-title'),
    modalBody: get('modal-body'),
    modalClose: get('modal-close'),
  };

  // Assign them to the module variables in dom.js
  setDomElements(elements);

  const hideSplash = initSplash();
  initBackground();

  await loadSettings();
  await loadTemplatesFromDB();

  updateStatus('Loading WASM...');
  try {
    await init();
    console.log(greet('Explorer'));
    updateStatus('WASM ready');
    hideSplash();
  } catch (err) {
    console.error('WASM init error:', err);
    updateStatus('WASM failed – limited mode', true);
    showToast('Core engine failed to load', 'error');
    hideSplash();
  }

  initCompass();
  initVoice();

  const startCameraOnInteraction = async () => {
    await initCamera();
    updateStatus('Tap object or use voice');
  };
  document.body.addEventListener('click', startCameraOnInteraction, { once: true });
  document.body.addEventListener('touchend', startCameraOnInteraction, { once: true });

  initUI();
  updateStatus('Tap anywhere to start camera');
}

start();
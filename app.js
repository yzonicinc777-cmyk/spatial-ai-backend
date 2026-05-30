// app.js – main orchestrator
import init, { greet } from '/pkg/spatial_explorer_core.js';
import { initCamera, startFrameCapture } from './camera.js';
import { initCompass, updateClock, updateGPS, updateBattery } from './sensors.js';
import { initVoice } from './voice.js';
import { loadSettings, loadTemplatesFromDB } from './store.js';
import { initUI, initSplash, initBackground, updateStatus, showToast } from './ui.js';

// Populate DOM references (these are exported from dom.js but need to be assigned)
// We'll just grab the elements directly here and assign to the exported variables.
import * as dom from './dom.js';

async function start() {
  // Get DOM elements
  const get = id => document.getElementById(id);
  dom.splashScreen = get('splash-screen');
  dom.appContainer = get('app');
  dom.bgCanvas = get('bg-canvas');
  dom.clockEl = get('clock');
  dom.gpsBadge = get('gps-badge');
  dom.compassBadge = get('compass-badge');
  dom.batteryBadge = get('battery-badge');
  dom.networkBadge = get('network-badge');
  dom.statusText = get('status-text');
  dom.statusDot = document.querySelector('.status-dot');
  dom.video = get('video');
  dom.overlayCanvas = get('overlay-canvas');
  dom.overlayCtx = dom.overlayCanvas?.getContext('2d');
  dom.detectionBox = get('detection-box');
  dom.detectionLabel = get('detection-label');
  dom.detectionDistance = get('detection-distance');
  dom.detectionBuyBtn = get('detection-buy-btn');
  dom.compassRing = get('compass-ring');
  dom.voiceBar = get('voice-bar');
  dom.micBtn = get('mic-btn');
  dom.voiceText = get('voice-text');
  dom.voiceWave = get('voice-wave');
  dom.scanBtn = get('scanBtn');
  dom.setTemplateBtn = get('setTemplateBtn');
  dom.flashlightBtn = get('flashlightBtn');
  dom.exploreSearch = get('explore-search');
  dom.mapContainer = get('map-container');
  dom.poiList = get('poi-list');
  dom.templatesList = get('templates-list');
  dom.offlineToggle = get('offline-toggle');
  dom.voiceFeedbackToggle = get('voice-feedback-toggle');
  dom.statsElements = document.querySelectorAll('.stat strong');
  dom.navBar = get('nav-bar');
  dom.fabBtn = get('ai-lens-fab');
  dom.toastContainer = get('toast-container');
  dom.modalOverlay = get('modal-overlay');
  dom.modalTitle = get('modal-title');
  dom.modalBody = get('modal-body');
  dom.modalClose = get('modal-close');

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
  document.body.addEventListener('click',    startCameraOnInteraction, { once: true });
  document.body.addEventListener('touchend', startCameraOnInteraction, { once: true });

  initUI();
  updateStatus('Tap anywhere to start camera');
}

start();
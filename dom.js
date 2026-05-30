// dom.js – individual exported variables (mutable, can be assigned via setDomElements)
export let splashScreen, appContainer, bgCanvas, bgCtx;
export let clockEl, gpsBadge, compassBadge, batteryBadge, networkBadge, statusText, statusDot;
export let video, overlayCanvas, overlayCtx;
export let detectionBox, detectionLabel, detectionDistance, detectionBuyBtn;
export let compassRing, compassSvg;
export let voiceBar, micBtn, voiceText, voiceWave;
export let quickActions, scanBtn, setTemplateBtn, flashlightBtn;
export let exploreSearch, mapContainer, poiList;
export let templatesList, offlineToggle, voiceFeedbackToggle;
export let statsElements;
export let navBar;   // navBar is still used? Keep if needed
export let fabBtn;
export let toastContainer;
export let modalOverlay, modalTitle, modalBody, modalClose;

// Function to assign all DOM references (called from app.js)
export function setDomElements(e) {
  splashScreen = e.splashScreen;
  appContainer = e.appContainer;
  bgCanvas = e.bgCanvas;
  bgCtx = e.bgCanvas?.getContext('2d');
  clockEl = e.clockEl;
  gpsBadge = e.gpsBadge;
  compassBadge = e.compassBadge;
  batteryBadge = e.batteryBadge;
  networkBadge = e.networkBadge;
  statusText = e.statusText;
  statusDot = e.statusDot;
  video = e.video;
  overlayCanvas = e.overlayCanvas;
  overlayCtx = e.overlayCanvas?.getContext('2d');
  detectionBox = e.detectionBox;
  detectionLabel = e.detectionLabel;
  detectionDistance = e.detectionDistance;
  detectionBuyBtn = e.detectionBuyBtn;
  compassRing = e.compassRing;
  voiceBar = e.voiceBar;
  micBtn = e.micBtn;
  voiceText = e.voiceText;
  voiceWave = e.voiceWave;
  scanBtn = e.scanBtn;
  setTemplateBtn = e.setTemplateBtn;
  flashlightBtn = e.flashlightBtn;
  exploreSearch = e.exploreSearch;
  mapContainer = e.mapContainer;
  poiList = e.poiList;
  templatesList = e.templatesList;
  offlineToggle = e.offlineToggle;
  voiceFeedbackToggle = e.voiceFeedbackToggle;
  statsElements = e.statsElements;
  navBar = e.navBar;
  fabBtn = e.fabBtn;
  toastContainer = e.toastContainer;
  modalOverlay = e.modalOverlay;
  modalTitle = e.modalTitle;
  modalBody = e.modalBody;
  modalClose = e.modalClose;
}
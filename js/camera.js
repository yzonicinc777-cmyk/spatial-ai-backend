/**
 * camera.js — Camera, overlay canvas, flashlight, and frame-capture pipeline.
 *
 * Responsibilities:
 *   • Request camera permission and open the video stream
 *   • Size / resize the overlay canvas to match video intrinsics
 *   • Provide a zero-copy frame-capture loop that feeds the detection worker
 *   • Render match bounding boxes + compass arrow on the overlay canvas
 *   • Toggle the torch (flashlight)
 *
 * NOTE: camera.js does NOT import detection.js to avoid circular deps.
 * Instead it exposes sendFrameToWorker as a callback set by detection.js.
 *
 * Security: no eval; canvas only reads local MediaStream frames.
 */

import { refs }                          from './dom.js';
import { setState, getState, subscribe } from './state.js';
import { showToast, updateStatus }       from './ui.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const FRAME_SKIP   = 3;   // process every Nth frame
const RETICLE_SIZE = 50;  // px² template capture region

// ─── Private refs ────────────────────────────────────────────────────────────

let _video         = null;
let _overlayCanvas = null;
let _overlayCtx    = null;
let _captureCanvas = null;
let _captureCtx    = null;
let _frameCount    = 0;
let _stream        = null;
let _raf           = null;

/** Injected by detection.js — avoids circular import */
let _onFrameReady  = null;

// Resolution presets
const RES_MAP = {
  '1080p': { width: 1920, height: 1080 },
  '720p':  { width: 1280, height: 720  },
  '480p':  { width: 854,  height: 480  },
};

// ─── Injection point ─────────────────────────────────────────────────────────

/**
 * Called by detection.js after worker is up.
 * @param {function(ImageData, number, number): void} cb
 */
export function setFrameCallback(cb) {
  _onFrameReady = cb;
}

// ─── Camera init ─────────────────────────────────────────────────────────────

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
        facingMode:  'environment',
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

// ─── Canvas setup ────────────────────────────────────────────────────────────

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

// ─── Frame-capture loop ──────────────────────────────────────────────────────

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

// ─── Template capture ────────────────────────────────────────────────────────

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

// ─── Overlay rendering ───────────────────────────────────────────────────────

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
    const pct   = `${Math.round(m.confidence * 100)}%`;
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

// ─── Detection box DOM positioning ──────────────────────────────────────────

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

// ─── Flashlight ──────────────────────────────────────────────────────────────

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

// ─── Compass ring DOM binding ─────────────────────────────────────────────────

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
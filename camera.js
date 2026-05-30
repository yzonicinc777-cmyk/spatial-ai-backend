// camera.js
import { state } from './state.js';
import {
  video, overlayCanvas, overlayCtx, detectionBox, detectionLabel, detectionDistance,
  detectionBuyBtn
} from './dom.js';
import {
  updateStatus, showToast, updateStats, exitTemplateMode, navigateTo
} from './ui.js';
import { saveTemplateToDB } from './store.js';

export function initDetectionWorker() {
  state.detectionWorker = new Worker('detection.worker.js', { type: 'module' });
  state.detectionWorker.onmessage = (e) => {
    const { type, matches, error } = e.data;
    if (type === 'ready') {
      state.workerReady = true;
      updateStatus('AI engine ready');
      showToast('AI Lens active', 'success');
    } else if (type === 'result') {
      if (matches && matches.length) drawMatches(matches);
      else hideDetectionBox();
    } else if (type === 'error') {
      console.error(error);
      updateStatus('Detection error', true);
    } else if (type === 'template_set') {
      exitTemplateMode();
      showToast('Template captured', 'success');
    } else if (type === 'template_cleared') {
      showToast('Template cleared', 'info');
    }
  };
  state.detectionWorker.postMessage({ type: 'init' });
}

export function drawMatches(matches) {
  if (!overlayCtx) return;
  const w = overlayCanvas.width, h = overlayCanvas.height;
  overlayCtx.clearRect(0, 0, w, h);
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    overlayCtx.strokeStyle = i === 0 ? '#4ecdc4' : '#ffb347';
    overlayCtx.lineWidth = i === 0 ? 3 : 2;
    overlayCtx.strokeRect(m.x, m.y, m.width, m.height);
    overlayCtx.fillStyle = 'white';
    overlayCtx.font = '12px Inter';
    overlayCtx.fillText(`${Math.round(m.confidence * 100)}%`, m.x + 4, m.y - 6);
    if (i === 0) updateDetectionBoxUI(m, w, h);
  }
  if (matches.length === 0) hideDetectionBox();
}

export function updateDetectionBoxUI(match, canvasWidth, canvasHeight) {
  if (!detectionBox) return;
  const videoRect = video.getBoundingClientRect();
  const scaleX = videoRect.width / canvasWidth;
  const scaleY = videoRect.height / canvasHeight;
  detectionBox.classList.remove('hidden');
  detectionBox.style.left = match.x * scaleX + 'px';
  detectionBox.style.top = match.y * scaleY + 'px';
  detectionBox.style.width = match.width * scaleX + 'px';
  detectionBox.style.height = match.height * scaleY + 'px';
  if (detectionLabel) detectionLabel.textContent = `${Math.round(match.confidence * 100)}% match`;
  if (detectionDistance) detectionDistance.textContent = match.scale !== 1.0 ? `scale ${match.scale.toFixed(1)}×` : '~1.5m';
  state.lastDetection = match;
}

export function hideDetectionBox() {
  if (detectionBox && !detectionBox.classList.contains('hidden')) detectionBox.classList.add('hidden');
  state.lastDetection = null;
}

export async function captureTemplateAt(x, y) {
  if (!video || video.readyState < 2) return;
  if (!state.captureCanvas || !state.captureCtx) return;

  const w = video.videoWidth, h = video.videoHeight;
  if (state.captureCanvas.width !== w || state.captureCanvas.height !== h) {
    state.captureCanvas.width = w;
    state.captureCanvas.height = h;
  }
  state.captureCtx.drawImage(video, 0, 0, w, h);

  x = Math.max(0, Math.min(x, w - 50));
  y = Math.max(0, Math.min(y, h - 50));
  const imgData = state.captureCtx.getImageData(x, y, 50, 50);
  state.detectionWorker.postMessage({
    type: 'set_template',
    payload: { data: imgData.data, width: 50, height: 50 }
  });
  state.templateCount++;
  updateStats();
  saveTemplateToDB(`capture_${Date.now()}`, imgData.data.buffer);
}

export function autoCaptureTemplate() {
  if (!video) return;
  captureTemplateAt(video.videoWidth / 2, video.videoHeight / 2);
}

export function clearTemplate() {
  if (state.detectionWorker) {
    state.detectionWorker.postMessage({ type: 'clear_template' });
    updateStatus('Template cleared');
    exitTemplateMode();
    showToast('Template cleared', 'info');
  }
}

export function startFrameCapture() {
  if (!state.captureCanvas) {
    state.captureCanvas = document.createElement('canvas');
    state.captureCtx = state.captureCanvas.getContext('2d', { willReadFrequently: true });
  }

  let lastW = 0, lastH = 0;

  const processFrame = () => {
    if (!state.workerReady || !video.videoWidth) {
      requestAnimationFrame(processFrame);
      return;
    }
    if (state.frameSkip++ % state.FRAME_SKIP === 0) {
      const w = video.videoWidth, h = video.videoHeight;
      if (w !== lastW || h !== lastH) {
        state.captureCanvas.width = w;
        state.captureCanvas.height = h;
        lastW = w; lastH = h;
      }
      state.captureCtx.drawImage(video, 0, 0);
      const imageData = state.captureCtx.getImageData(0, 0, w, h);
      state.detectionWorker.postMessage(
        { type: 'detect', payload: { imageData: imageData.data, width: w, height: h } },
        [imageData.data.buffer]
      );
    }
    requestAnimationFrame(processFrame);
  };
  requestAnimationFrame(processFrame);
}

export async function initCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();

    if (!state.captureCanvas) {
      state.captureCanvas = document.createElement('canvas');
      state.captureCtx = state.captureCanvas.getContext('2d');
    }

    const resizeCanvas = () => {
      if (video.videoWidth) {
        overlayCanvas.width = video.videoWidth;
        overlayCanvas.height = video.videoHeight;
        if (state.captureCanvas) {
          state.captureCanvas.width = video.videoWidth;
          state.captureCanvas.height = video.videoHeight;
        }
      }
    };
    video.addEventListener('loadedmetadata', resizeCanvas);
    window.addEventListener('resize', resizeCanvas);
    setTimeout(resizeCanvas, 150);

    updateStatus('Camera ready');
    showToast('Camera active');

    initDetectionWorker();
    startFrameCapture();

    setInterval(aiDetectFrame, 2000);
  } catch (err) {
    updateStatus(`Camera denied: ${err.message}`, true);
    showToast('Camera permission required', 'error');
  }
}

export function drawCompassArrow(canvasWidth, canvasHeight) {
  if (!overlayCtx) return;
  const cx = canvasWidth - 70, cy = canvasHeight - 70;
  const angleRad = ((state.compassTarget - state.currentHeading) * Math.PI) / 180;
  const len = 45;
  const ex = cx + Math.sin(angleRad) * len;
  const ey = cy - Math.cos(angleRad) * len;

  overlayCtx.save();
  overlayCtx.beginPath();
  overlayCtx.moveTo(cx, cy);
  overlayCtx.lineTo(ex, ey);
  overlayCtx.strokeStyle = '#ffb347';
  overlayCtx.lineWidth = 4;
  overlayCtx.shadowBlur = 8;
  overlayCtx.shadowColor = '#ffb347';
  overlayCtx.stroke();
  const a = Math.atan2(ey - cy, ex - cx);
  const hl = 12;
  const lx = ex - hl * Math.cos(a - Math.PI / 6);
  const ly = ey - hl * Math.sin(a - Math.PI / 6);
  const rx = ex - hl * Math.cos(a + Math.PI / 6);
  const ry = ey - hl * Math.sin(a + Math.PI / 6);
  overlayCtx.beginPath();
  overlayCtx.moveTo(ex, ey);
  overlayCtx.lineTo(lx, ly);
  overlayCtx.lineTo(rx, ry);
  overlayCtx.fillStyle = '#ffb347';
  overlayCtx.fill();
  overlayCtx.restore();
}

export function doScan() {
  autoCaptureTemplate();
  showToast('Scanning...');
}

export async function toggleFlashlight() {
  if (!video || !video.srcObject) return;
  const stream = video.srcObject;
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  try {
    if (state.flashlightTrack) {
      await track.applyConstraints({ advanced: [{ torch: false }] });
      state.flashlightTrack = null;
      showToast('Flashlight off');
    } else {
      await track.applyConstraints({ advanced: [{ torch: true }] });
      state.flashlightTrack = track;
      showToast('Flashlight on');
    }
  } catch (err) {
    showToast('Flashlight not supported', 'error');
  }
}

async function aiDetectFrame() {
  if (!state.captureCanvas) return;
  state.captureCanvas.toBlob(async (blob) => {
    const fd = new FormData();
    fd.append('file', blob, 'frame.jpg');
    try {
      const res = await fetch('https://spatial-ai-backend-production.up.railway.app/api/detect', {
        method: 'POST', body: fd
      });
      const { detections } = await res.json();
      if (detections.length) {
        drawMatches(detections.map(d => ({
          x: d.x, y: d.y,
          width: d.width, height: d.height,
          confidence: d.confidence,
          scale: 1.0,
          label: d.label
        })));
      }
    } catch (e) { /* server offline, fall back to WASM */ }
  }, 'image/jpeg', 0.7);
}
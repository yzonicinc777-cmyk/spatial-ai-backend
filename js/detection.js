/**
 * detection.js — Detection worker bridge & template lifecycle management.
 *
 * Owns the Worker instance, serialises outbound messages, and routes
 * inbound results to the camera renderer and state store.
 *
 * Avoids circular imports by using the setFrameCallback() injection
 * point in camera.js instead of importing camera.js directly into
 * the init call.
 *
 * Security:
 *   • Worker runs in its own origin-sandboxed context
 *   • ImageData buffers are transferred (zero-copy, zero-retain)
 *   • All worker messages are type-checked before dispatch
 */

import { setState, getState, incrementTemplate, incrementSave, addSavedTemplate } from './state.js';
import { showToast, updateStatus }     from './ui.js';
import { refs }                         from './dom.js';
import { saveTemplateToDB }             from './storage.js';
import {
  drawMatches,
  clearOverlay,
  hideDetectionBox,
  positionDetectionBox,
  setFrameCallback,
}                                       from './camera.js';

// ─── Worker management ───────────────────────────────────────────────────────

/** @type {Worker|null} */
let _worker          = null;
let _processingFrame = false;

/**
 * Initialise the detection worker and wire the frame callback.
 */
export function initDetectionWorker() {
  if (_worker) return;

  try {
    _worker = new Worker('./js/detection.worker.js', { type: 'module' });
  } catch (err) {
    console.error('[detection] Worker creation failed:', err);
    updateStatus('Detection unavailable', 'warn');
    return;
  }

  _worker.addEventListener('message',      _handleWorkerMessage);
  _worker.addEventListener('error',        _handleWorkerError);
  _worker.addEventListener('messageerror', (e) => {
    console.error('[detection] Worker message error:', e);
  });

  // Inject frame-sending callback into camera.js (breaks circular dep)
  setFrameCallback(_sendFrame);

  _worker.postMessage({ type: 'init' });
}

export function terminateWorker() {
  setFrameCallback(null);
  if (_worker) { _worker.terminate(); _worker = null; }
  setState({ workerReady: false });
}

// ─── Inbound message handler ─────────────────────────────────────────────────

function _handleWorkerMessage({ data }) {
  if (!data || typeof data.type !== 'string') return;

  switch (data.type) {
    case 'ready':
      setState({ workerReady: true });
      updateStatus('AI engine ready');
      showToast('AI Lens active ✦', 'success');
      break;

    case 'result':
      _processingFrame = false;
      _onResult(data.matches ?? []);
      break;

    case 'template_set':
      _onTemplateSet();
      break;

    case 'template_cleared':
      showToast('Template cleared', 'info');
      break;

    case 'error':
      _processingFrame = false;
      console.error('[detection] Worker error:', data.code, data.error);
      if (data.code !== 'NOT_READY') updateStatus('Detection error', 'error');
      break;

    default:
      console.warn('[detection] Unknown message type:', data.type);
  }
}

function _handleWorkerError(e) {
  _processingFrame = false;
  console.error('[detection] Worker crash:', e.message, `${e.filename}:${e.lineno}`);
  updateStatus('Detection engine crashed', 'error');
  showToast('AI engine error — reload to recover', 'error');
}

// ─── Detection result ────────────────────────────────────────────────────────

function _onResult(matches) {
  if (matches.length === 0) {
    hideDetectionBox();
    clearOverlay();
    return;
  }
  drawMatches(matches);
  positionDetectionBox(matches[0]);
}

// ─── Frame pipeline ───────────────────────────────────────────────────────────

/**
 * Injected into camera.js via setFrameCallback().
 * Transfers the ImageData buffer to the worker (zero-copy).
 * @param {ImageData} imageData
 * @param {number} width
 * @param {number} height
 */
function _sendFrame(imageData, width, height) {
  if (!_worker || !getState('workerReady') || _processingFrame) return;
  _processingFrame = true;

  const buffer = imageData.data.buffer;
  _worker.postMessage(
    { type: 'detect', payload: { imageData: imageData.data, width, height } },
    [buffer]
  );
}

// ─── Template management ─────────────────────────────────────────────────────

/**
 * Send captured ImageData to worker as the new template.
 * Also persists to IndexedDB and updates stats.
 * @param {ImageData} imgData
 */
export async function setTemplate(imgData) {
  if (!_worker || !getState('workerReady')) {
    showToast('AI engine not ready', 'error');
    return;
  }
  if (!imgData) return;

  // Clone buffer before transfer so we can persist it
  const clone  = imgData.data.buffer.slice(0);
  const buffer = imgData.data.buffer;

  _worker.postMessage(
    {
      type:    'set_template',
      payload: { data: imgData.data, width: imgData.width, height: imgData.height },
    },
    [buffer]
  );

  const id = `capture_${Date.now()}`;
  incrementTemplate();
  await saveTemplateToDB(id, clone);
  addSavedTemplate({ id, date: Date.now() });
  incrementSave();
}

export function clearTemplate() {
  if (!_worker) return;
  _worker.postMessage({ type: 'clear_template' });
  updateStatus('Template cleared');
  setState({ templateMode: false });
  refs('setTemplateBtn')?.classList.remove('mode-active');
}

// ─── Template mode UI ────────────────────────────────────────────────────────

export function enterTemplateMode() {
  setState({ templateMode: true });
  refs('setTemplateBtn')?.classList.add('mode-active');
  updateStatus('Tap an object to capture template');
}

export function exitTemplateMode() {
  setState({ templateMode: false });
  refs('setTemplateBtn')?.classList.remove('mode-active');
}

async function _onTemplateSet() {
  exitTemplateMode();
  showToast('Template captured ✓', 'success');
  updateStatus('Template active — scanning');
}
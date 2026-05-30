// detection.worker.js
import init, { set_template, detect_template, clear_template, configure } from '/pkg/spatial_explorer_core.js';

let wasmReady = false;
let processing = false;

self.onmessage = async (e) => {
  const { type, payload } = e.data;
  switch (type) {
    case 'init':
      await init();
      wasmReady = true;
      configure(JSON.stringify({ min_confidence: 0.35, step: 2, multi_scale: true, use_color: true }));
      self.postMessage({ type: 'ready' });
      break;
    case 'set_template':
      if (wasmReady) set_template(payload.data, payload.width, payload.height);
      self.postMessage({ type: 'template_set' });
      break;
    case 'detect':
      if (!wasmReady || processing) break;
      processing = true;
      try {
        const { imageData, width, height } = payload;
        const resultJson = detect_template(imageData, width, height);
        let matches = [];
        if (resultJson && resultJson !== 'no_template' && resultJson !== 'invalid_template' && resultJson !== '[]') {
          matches = JSON.parse(resultJson);
        }
        self.postMessage({ type: 'result', matches });
      } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
      } finally {
        processing = false;
      }
      break;
    case 'clear_template':
      if (wasmReady) clear_template();
      self.postMessage({ type: 'template_cleared' });
      break;
  }
};
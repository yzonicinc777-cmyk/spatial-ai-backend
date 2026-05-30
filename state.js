// state.js
export let wasmReady = false;
export let templateMode = false;

export let currentHeading = null;
export let compassTarget = 0;
export let showCompass = true;

export let recognition = null;
export let isListening = false;
export let voiceFinalTranscript = '';

export let savedTemplates = [];

export let scanCount = 0;
export let templateCount = 0;
export let saveCount = 0;

export let flashlightTrack = null;

export let isOnline = navigator.onLine;

export let lastDetection = null;

export let detectionWorker = null;
export let captureCanvas = null;
export let captureCtx = null;
export let workerReady = false;
export let frameSkip = 0;
export const FRAME_SKIP = 3;
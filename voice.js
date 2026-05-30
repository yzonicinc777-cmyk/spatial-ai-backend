import { state } from './state.js';
import { voiceBar, micBtn, voiceText, voiceWave, compassRing } from './dom.js';
import { updateStatus, showToast, vibrate, navigateTo, enterTemplateMode } from './ui.js';
import { doScan, autoCaptureTemplate, clearTemplate, toggleFlashlight } from './camera.js';
import { setCompassTarget } from './sensors.js';

export function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (micBtn) micBtn.style.display = 'none';
    return;
  }
  state.recognition = new SpeechRecognition();
  state.recognition.continuous = false;
  state.recognition.interimResults = true;
  state.recognition.lang = 'en-US';

  state.recognition.onstart = () => {
    state.isListening = true;
    voiceBar?.classList.add('listening');
    voiceWave?.classList.add('listening');
    micBtn?.classList.add('listening');
    if (voiceText) voiceText.textContent = 'Listening...';
    updateStatus('Voice active');
  };

  state.recognition.onerror = (e) => {
    state.isListening = false;
    voiceBar?.classList.remove('listening');
    voiceWave?.classList.remove('listening');
    micBtn?.classList.remove('listening');
    if (voiceText) voiceText.textContent = 'Say "find red shoes near me"';
    updateStatus(`Voice error: ${e.error}`, true);
    showToast(`Voice error: ${e.error}`, 'error');
  };

  state.recognition.onend = () => {
    state.isListening = false;
    voiceBar?.classList.remove('listening');
    voiceWave?.classList.remove('listening');
    micBtn?.classList.remove('listening');
    if (voiceText) voiceText.textContent = state.voiceFinalTranscript || 'Say "find red shoes near me"';
    state.voiceFinalTranscript = '';
    updateStatus('Ready');
  };

  state.recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        state.voiceFinalTranscript += e.results[i][0].transcript;
      } else {
        interim += e.results[i][0].transcript;
      }
    }
    if (voiceText) voiceText.textContent = state.voiceFinalTranscript || interim || 'Listening...';
    if (state.voiceFinalTranscript) {
      handleVoiceCommand(state.voiceFinalTranscript.trim().toLowerCase());
    }
  };
}

export function handleVoiceCommand(cmd) {
  updateStatus(`"${cmd}"`);
  vibrate(30);
  if (cmd.includes('set template')) {
    enterTemplateMode();
  } else if (cmd.includes('find') || cmd.includes('search')) {
    autoCaptureTemplate();
    showToast('Looking for similar items...');
  } else if (cmd.includes('reset template') || cmd.includes('clear template')) {
    clearTemplate();
  } else if (cmd.includes('show compass')) {
    state.showCompass = true;
    if (compassRing) compassRing.classList.remove('hidden');
    updateStatus('Compass visible');
  } else if (cmd.includes('hide compass')) {
    state.showCompass = false;
    if (compassRing) compassRing.classList.add('hidden');
    updateStatus('Compass hidden');
  } else if (cmd.includes('point to north'))  setCompassTarget(0);
  else if (cmd.includes('point to east'))     setCompassTarget(90);
  else if (cmd.includes('point to south'))    setCompassTarget(180);
  else if (cmd.includes('point to west'))     setCompassTarget(270);
  else if (cmd.includes('explore'))           navigateTo('explore');
  else if (cmd.includes('profile'))           navigateTo('profile');
  else if (cmd.includes('camera'))            navigateTo('camera');
  else if (cmd.includes('scan'))              doScan();
  else if (cmd.includes('flashlight') || cmd.includes('torch')) toggleFlashlight();
  else {
    updateStatus(`Unknown: "${cmd}"`);
    showToast(`Command not recognized: ${cmd}`);
  }
}
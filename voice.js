// voice.js
import {
  recognition, isListening, voiceFinalTranscript, showCompass
} from './state.js';
import { voiceBar, micBtn, voiceText, voiceWave, compassRing as domCompassRing } from './dom.js';
import { updateStatus, showToast, vibrate, navigateTo, enterTemplateMode } from './ui.js';
import { doScan, autoCaptureTemplate, clearTemplate, toggleFlashlight } from './camera.js';
import { setCompassTarget } from './sensors.js';
// Note: doScan, autoCaptureTemplate, clearTemplate, toggleFlashlight are in camera.js,
// but we will re-export them from ui.js for convenience (see ui.js later).

export function initVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if (micBtn) micBtn.style.display = 'none';
    return;
  }
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    voiceBar?.classList.add('listening');
    voiceWave?.classList.add('listening');
    micBtn?.classList.add('listening');
    if (voiceText) voiceText.textContent = 'Listening...';
    updateStatus('Voice active');
  };

  recognition.onerror = (e) => {
    isListening = false;
    voiceBar?.classList.remove('listening');
    voiceWave?.classList.remove('listening');
    micBtn?.classList.remove('listening');
    if (voiceText) voiceText.textContent = 'Say "find red shoes near me"';
    updateStatus(`Voice error: ${e.error}`, true);
    showToast(`Voice error: ${e.error}`, 'error');
  };

  recognition.onend = () => {
    isListening = false;
    voiceBar?.classList.remove('listening');
    voiceWave?.classList.remove('listening');
    micBtn?.classList.remove('listening');
    if (voiceText) voiceText.textContent = voiceFinalTranscript || 'Say "find red shoes near me"';
    voiceFinalTranscript = '';
    updateStatus('Ready');
  };

  recognition.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        voiceFinalTranscript += e.results[i][0].transcript;
      } else {
        interim += e.results[i][0].transcript;
      }
    }
    if (voiceText) voiceText.textContent = voiceFinalTranscript || interim || 'Listening...';
    if (voiceFinalTranscript) {
      handleVoiceCommand(voiceFinalTranscript.trim().toLowerCase());
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
    showCompass = true;
    if (domCompassRing) domCompassRing.classList.remove('hidden');
    updateStatus('Compass visible');
  } else if (cmd.includes('hide compass')) {
    showCompass = false;
    if (domCompassRing) domCompassRing.classList.add('hidden');
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
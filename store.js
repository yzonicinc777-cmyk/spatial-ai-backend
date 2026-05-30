// store.js
import { savedTemplates, templateCount, saveCount, scanCount } from './state.js';
import { templatesList, offlineToggle, voiceFeedbackToggle, statsElements } from './dom.js';
import { showToast, updateStats as uiUpdateStats, renderTemplatesList as uiRenderTemplatesList } from './ui.js';
// Note: we import updateStats and renderTemplatesList from ui.js to avoid circular dependency.
// They will be defined in ui.js.

export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SpatialAIExplorer', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('templates')) {
        db.createObjectStore('templates', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTemplateToDB(id, buffer) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('templates', 'readwrite');
      tx.objectStore('templates').put({ id, data: buffer, date: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    savedTemplates.push({ id, date: Date.now() });
    uiRenderTemplatesList();
    saveCount++;
    uiUpdateStats();
  } catch (err) {
    console.error('Save template failed:', err);
  }
}

export async function loadTemplatesFromDB() {
  try {
    const db = await openDB();
    const tx = db.transaction('templates', 'readonly');
    const store = tx.objectStore('templates');
    const request = store.getAll();
    const results = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    savedTemplates.length = 0;
    savedTemplates.push(...results.map(r => ({ id: r.id, date: r.date })));
    uiRenderTemplatesList();
    templateCount = savedTemplates.length;
    uiUpdateStats();
  } catch (err) {
    console.error('Load templates failed:', err);
  }
}

export async function loadSettings() {
  try {
    const db = await openDB();
    const tx = db.transaction('settings', 'readonly');
    const reqOffline = tx.objectStore('settings').get('offlineMode');
    const reqVoice   = tx.objectStore('settings').get('voiceFeedback');
    const offlineVal = await new Promise(r => { reqOffline.onsuccess = () => r(reqOffline.result?.value); });
    const voiceVal   = await new Promise(r => { reqVoice.onsuccess   = () => r(reqVoice.result?.value);   });
    if (offlineToggle)      offlineToggle.checked      = offlineVal === true;
    if (voiceFeedbackToggle) voiceFeedbackToggle.checked = voiceVal !== false;
  } catch (e) {
    console.warn('loadSettings failed:', e);
  }
}

export async function saveSetting(key, value) {
  try {
    const db = await openDB();
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
  } catch (e) {
    console.warn('saveSetting failed:', e);
  }
}
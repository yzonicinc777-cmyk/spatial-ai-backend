// sensors.js
import { currentHeading, compassTarget, showCompass, isOnline } from './state.js';
import { compassRing, compassBadge, gpsBadge, batteryBadge, networkBadge, clockEl } from './dom.js';
import { updateStatus } from './ui.js';

export function updateClock() {
  const now = new Date();
  if (clockEl) clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

export function updateNetworkStatus() {
  if (networkBadge) {
    networkBadge.textContent = isOnline ? '🌐' : '🚫';
    networkBadge.className = `status-badge ${isOnline ? 'online' : ''}`;
  }
}
window.addEventListener('online', () => { isOnline = true; updateNetworkStatus(); });
window.addEventListener('offline', () => { isOnline = false; updateNetworkStatus(); });
updateNetworkStatus();

export function updateBattery() {
  if ('getBattery' in navigator) {
    navigator.getBattery().then(battery => {
      const level = Math.round(battery.level * 100);
      if (batteryBadge) batteryBadge.textContent = `🔋 ${level}%`;
      battery.addEventListener('levelchange', () => {
        if (batteryBadge) batteryBadge.textContent = `🔋 ${Math.round(battery.level * 100)}%`;
      });
    });
  } else if (batteryBadge) {
    batteryBadge.textContent = '🔋 --';
  }
}
updateBattery();

export function updateGPS() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (gpsBadge) gpsBadge.textContent = `📍 ${pos.coords.accuracy.toFixed(0)}m`;
      },
      () => {
        if (gpsBadge) gpsBadge.textContent = '📍 Off';
      },
      { enableHighAccuracy: false, timeout: 5000 }
    );
  } else if (gpsBadge) {
    gpsBadge.textContent = '📍 N/A';
  }
}
setInterval(updateGPS, 10000);
updateGPS();

export function initCompass() {
  if (!window.DeviceOrientationEvent) {
    updateStatus('Compass unsupported', true);
    return;
  }
  const handleOrientation = (e) => {
    if (e.alpha !== null) {
      currentHeading = e.alpha;
      updateCompassUI();
    }
  };
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    document.body.addEventListener('click', () => {
      DeviceOrientationEvent.requestPermission()
        .then(perm => {
          if (perm === 'granted') window.addEventListener('deviceorientation', handleOrientation);
          else updateStatus('Compass denied', true);
        })
        .catch(() => updateStatus('Compass error', true));
    }, { once: true });
  } else {
    window.addEventListener('deviceorientation', handleOrientation);
  }
}

export function updateCompassUI() {
  if (compassBadge) {
    compassBadge.textContent = `🧭 ${currentHeading !== null ? Math.round(currentHeading) + '°' : '--°'}`;
  }
  if (compassRing && !compassRing.classList.contains('hidden') && currentHeading !== null) {
    compassRing.style.transform = `rotate(${compassTarget - currentHeading}deg)`;
  }
}

export function setCompassTarget(deg) {
  compassTarget = deg;
  if (compassRing) compassRing.classList.remove('hidden');
  updateCompassUI();
}
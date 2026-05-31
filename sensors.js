/**
 * sensor.js — Device sensor management.
 *
 * Handles:
 *   • DeviceOrientation (compass / heading)
 *   • Geolocation (GPS accuracy)
 *   • Battery API
 *   • Network status (online/offline)
 *
 * All sensor reads feed into state.js — UI reacts through subscriptions.
 * Permission requests are deferred until a user gesture is available.
 */

import { setState, getState } from './state.js';

// ─── Network ─────────────────────────────────────────────────────────────────

export function initNetwork() {
  const update = () => setState({ isOnline: navigator.onLine });
  window.addEventListener('online',  update, { passive: true });
  window.addEventListener('offline', update, { passive: true });
  update();
}

// ─── Battery ─────────────────────────────────────────────────────────────────

export async function initBattery() {
  if (!('getBattery' in navigator)) return;

  try {
    const battery = await navigator.getBattery();

    const sync = () => setState({
      batteryLevel:    Math.round(battery.level * 100),
      batteryCharging: battery.charging,
    });

    battery.addEventListener('levelchange',   sync);
    battery.addEventListener('chargingchange', sync);
    sync();
  } catch (err) {
    console.warn('[sensor] Battery API failed:', err);
  }
}

// ─── GPS ─────────────────────────────────────────────────────────────────────

let _gpsWatchId = null;

export function initGPS() {
  if (!navigator.geolocation) return;

  const onSuccess = (pos) => setState({ gpsAccuracy: pos.coords.accuracy });
  const onError   = ()    => setState({ gpsAccuracy: null });
  const opts      = { enableHighAccuracy: false, timeout: 8000, maximumAge: 15000 };

  // Initial single fix
  navigator.geolocation.getCurrentPosition(onSuccess, onError, opts);

  // Passive watch every ~15 s via maximumAge cache
  _gpsWatchId = navigator.geolocation.watchPosition(onSuccess, onError, opts);
}

export function stopGPS() {
  if (_gpsWatchId !== null) {
    navigator.geolocation.clearWatch(_gpsWatchId);
    _gpsWatchId = null;
  }
}

// ─── Compass (DeviceOrientation) ─────────────────────────────────────────────

let _compassInitialised = false;

function _handleOrientation(e) {
  // webkitCompassHeading is more accurate on iOS (true north, already corrected)
  const heading = e.webkitCompassHeading != null
    ? e.webkitCompassHeading
    : (e.alpha != null ? (360 - e.alpha) % 360 : null);

  if (heading !== null) setState({ heading });
}

/**
 * Initialise compass. On iOS 13+ this must be called from a user gesture.
 * @param {function=} onDenied  — called if permission rejected
 */
export async function initCompass(onDenied) {
  if (_compassInitialised) return;

  if (!window.DeviceOrientationEvent) {
    console.warn('[sensor] DeviceOrientationEvent not supported');
    return;
  }

  // iOS 13+ requires explicit permission
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm === 'granted') {
        window.addEventListener('deviceorientation', _handleOrientation, { passive: true });
        _compassInitialised = true;
      } else {
        onDenied?.();
      }
    } catch (err) {
      console.warn('[sensor] Compass permission error:', err);
      onDenied?.();
    }
  } else {
    // Android / desktop — no permission gate
    window.addEventListener('deviceorientation', _handleOrientation, { passive: true });
    _compassInitialised = true;
  }
}

/**
 * Set the compass target bearing (0–359 °).
 * The UI module reads state.compassTarget for the ring arrow.
 * @param {number} deg
 */
export function setCompassTarget(deg) {
  setState({ compassTarget: ((deg % 360) + 360) % 360, compassVisible: true });
}

export function showCompass() {
  setState({ compassVisible: true });
}

export function hideCompass() {
  setState({ compassVisible: false });
}
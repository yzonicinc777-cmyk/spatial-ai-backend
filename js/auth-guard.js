/**
 * auth-guard.js — Client-side session management for Spatial AI Explorer
 *
 * Responsibilities:
 *   • Store / retrieve the JWT access token
 *   • Silently refresh the token via the /api/auth/refresh cookie endpoint
 *   • Redirect un-authenticated users to auth.html
 *   • Export helpers for any page that needs the current user's data
 *
 * Place this file in your /js/ folder alongside core.js.
 * Import it at the top of app.js (or any protected page script).
 */

// ── Constants ─────────────────────────────────────────────────────
const AUTH_TOKEN_KEY = 'sai_auth_token';
const USER_KEY       = 'sai_user';
const AUTH_PAGE = 'auth.html';
const REFRESH_URL    = '/api/auth/refresh';
const ME_URL         = '/api/auth/me';

// ── Token storage (sessionStorage = cleared on tab close) ─────────
export function getToken()           { return sessionStorage.getItem(AUTH_TOKEN_KEY); }
export function setToken(token)      { sessionStorage.setItem(AUTH_TOKEN_KEY, token); }
export function removeToken()        { sessionStorage.removeItem(AUTH_TOKEN_KEY); sessionStorage.removeItem(USER_KEY); }

export function getUser() {
  try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); }
  catch { return null; }
}
export function setUser(u) { sessionStorage.setItem(USER_KEY, JSON.stringify(u)); }

// ── JWT decode (no verification — trust server, just read claims) ──
function decodeJWT(token) {
  try {
    // Supports both real JWTs (base64url payload) and the simulated
    // token produced by auth.html's _simulateAuth() helper, whose
    // middle segment is plain base64.
    const payload = token.split('.')[1];
    if (!payload) return null;
    // Normalise base64url → base64, then decode
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      payload.length + (4 - payload.length % 4) % 4, '='
    ));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Check whether the stored token is expired ─────────────────────
function isTokenExpired(token) {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) return true;
  return decoded.exp * 1000 < Date.now() + 60_000; // 60s leeway
}

// ── Attempt silent token refresh ───────────────────────────────────
// The httpOnly refresh cookie is sent automatically by the browser.
export async function refreshToken() {
  try {
    const res  = await fetch(REFRESH_URL, { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.token) {
      setToken(data.token);
      return data.token;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * getValidToken()
 * Returns a valid (non-expired) access token, refreshing silently if needed.
 * Returns null if no session exists.
 */
export async function getValidToken() {
  let token = getToken();
  if (!token) return null;
  if (isTokenExpired(token)) {
    token = await refreshToken();
  }
  return token;
}

/**
 * requireAuth()
 * Call this at the top of any protected page/script.
 * Redirects to auth.html if no valid session exists.
 *
 * Usage (in app.js or explorer.html inline script):
 *   import { requireAuth } from '/js/auth-guard.js';
 *   await requireAuth();   // ← add this before anything else
 */
export async function requireAuth() {
  const token = await getValidToken();
  if (!token) {
    // Save intended destination so auth page can redirect back
    sessionStorage.setItem('sai_auth_return', location.href);
    location.replace(AUTH_PAGE);
    throw new Error('Not authenticated — redirecting.');
  }
  return token;
}

/**
 * fetchWithAuth(url, options)
 * Drop-in replacement for fetch() that adds the Authorization header
 * and automatically retries once after a silent token refresh on 401.
 */
export async function fetchWithAuth(url, options = {}) {
  let token = await getValidToken();
  if (!token) { location.replace(AUTH_PAGE); return; }

  const doFetch = (t) =>
    fetch(url, {
      ...options,
      credentials: 'include',
      headers: { ...(options.headers || {}), Authorization: `Bearer ${t}` },
    });

  let res = await doFetch(token);

  // One automatic retry after token refresh
  if (res.status === 401) {
    token = await refreshToken();
    if (!token) { location.replace(AUTH_PAGE); return; }
    res = await doFetch(token);
    if (res.status === 401) { location.replace(AUTH_PAGE); return; }
  }

  return res;
}

/**
 * logout()
 * Signs the user out and redirects to auth.html.
 */
export async function logout() {
  try {
    const token = getToken();
    if (token) {
      await fetch('/api/auth/logout', {
        method:  'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  } catch { /* ignore network errors on logout */ }
  removeToken();
  location.replace(AUTH_PAGE);
}

/**
 * loadCurrentUser()
 * Fetches fresh user data from /api/auth/me and caches it.
 * Returns null on failure.
 */
export async function loadCurrentUser() {
  try {
    const res  = await fetchWithAuth(ME_URL);
    if (!res || !res.ok) return null;
    const user = await res.json();
    setUser(user);
    return user;
  } catch {
    return null;
  }
}
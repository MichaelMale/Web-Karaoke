// Spotify integration: PKCE auth, Web API helpers, Web Playback SDK player.

import { config, REDIRECT_URI } from './config.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

/* ---------------- PKCE helpers ---------------- */

function randomString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

async function sha256Base64Url(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------------- Auth flow ---------------- */

export async function beginLogin() {
  const verifier = randomString();
  config.pkceVerifier = verifier;
  const challenge = await sha256Base64Url(verifier);
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.assign(`${AUTH_URL}?${params}`);
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
  const data = await res.json();
  config.tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || config.tokens?.refreshToken,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return config.tokens;
}

// Call on page load; completes the redirect leg if ?code= is present.
export async function handleRedirectCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return false;

  // Clean the URL either way.
  window.history.replaceState({}, '', REDIRECT_URI);
  if (error) throw new Error(`Spotify authorization failed: ${error}`);

  await tokenRequest({
    client_id: config.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: config.pkceVerifier,
  });
  config.pkceVerifier = '';
  return true;
}

export async function getAccessToken() {
  const t = config.tokens;
  if (!t) return null;
  if (Date.now() < t.expiresAt) return t.accessToken;
  if (!t.refreshToken) { config.tokens = null; return null; }
  try {
    const refreshed = await tokenRequest({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      refresh_token: t.refreshToken,
    });
    return refreshed.accessToken;
  } catch {
    config.tokens = null;
    return null;
  }
}

export function isConnected() { return !!config.tokens; }

export function disconnect() { config.tokens = null; }

/* ---------------- Web API ---------------- */

async function api(path) {
  const token = await getAccessToken();
  if (!token) throw new Error('Not connected to Spotify');
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { config.tokens = null; throw new Error('Spotify session expired — please reconnect'); }
  if (!res.ok) throw new Error(`Spotify API error (${res.status})`);
  return res.status === 204 ? null : res.json();
}

export function getProfile() { return api('/me'); }

// Spotify's Feb 2026 dev-mode changes cap search limit at 10 for
// development-mode apps; anything higher returns 400 "Invalid limit".
export async function searchTracks(query, limit = 10) {
  const data = await api(`/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`);
  return data.tracks.items.map((t) => ({
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(', '),
    album: t.album.name,
    art: t.album.images?.[1]?.url || t.album.images?.[0]?.url || '',
    durationMs: t.duration_ms,
  }));
}

/* ---------------- Web Playback SDK ---------------- */

let player = null;
let deviceId = null;
let sdkReady = new Promise((resolve) => {
  if (window.Spotify) resolve();
  else window.onSpotifyWebPlaybackSDKReady = resolve;
});

// All iOS browsers (Safari, and Chrome/Edge/Firefox for iOS, which are all
// WebKit) cannot run the Spotify Web Playback SDK — it needs EME/DRM playback
// that iOS WebKit does not grant to third-party web players. Detecting this up
// front lets us skip a pointless 12s connection timeout and go straight to
// a-cappella mode with an honest explanation.
export function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ masquerades as desktop Safari:
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// True when in-browser Spotify playback has any chance of working here.
export function isPlaybackSupported() {
  if (isIOS()) return false;
  // The SDK relies on Encrypted Media Extensions.
  return typeof navigator.requestMediaKeySystemAccess === 'function';
}

// Returns { player, deviceId } or throws if playback isn't possible (e.g. no Premium).
export async function ensurePlayer() {
  if (player && deviceId) return { player, deviceId };
  if (!isPlaybackSupported()) {
    throw new Error(isIOS()
      ? 'In-browser Spotify playback is not available on iOS (Safari/Chrome)'
      : 'This browser does not support in-browser Spotify playback');
  }
  await sdkReady;

  player = new Spotify.Player({
    name: 'Web Karaoke',
    getOAuthToken: async (cb) => cb(await getAccessToken()),
    volume: 0.85,
  });

  deviceId = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Spotify player timed out — Premium is required for in-browser playback')), 12000);
    player.addListener('ready', ({ device_id }) => { clearTimeout(timer); resolve(device_id); });
    player.addListener('initialization_error', ({ message }) => { clearTimeout(timer); reject(new Error(message)); });
    player.addListener('authentication_error', ({ message }) => { clearTimeout(timer); reject(new Error(message)); });
    player.addListener('account_error', () => {
      clearTimeout(timer);
      reject(new Error('Spotify Premium is required for in-browser playback'));
    });
    player.connect();
  });

  return { player, deviceId };
}

export async function playTrack(uri) {
  const { deviceId: id } = await ensurePlayer();
  const token = await getAccessToken();
  const res = await fetch(`${API}/me/player/play?device_id=${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri] }),
  });
  if (!res.ok && res.status !== 202) throw new Error(`Could not start playback (${res.status})`);
}

export async function stopPlayback() {
  try { if (player) await player.pause(); } catch { /* already stopped */ }
}

// Millisecond position of current playback, or null if unavailable.
export async function getPositionMs() {
  const state = await getPlayerState();
  return state ? state.position : null;
}

// Full playback state ({ position, paused, … }) or null if unavailable.
export async function getPlayerState() {
  if (!player) return null;
  return player.getCurrentState();
}

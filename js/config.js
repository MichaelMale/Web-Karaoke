// Persistent app configuration.
//
// Values are written to BOTH localStorage and sessionStorage and read from
// either (localStorage first). This keeps the Spotify client ID and tokens
// available across the OAuth redirect and page reloads even in browsers or
// modes where one of the stores is blocked or cleared.

const KEYS = {
  clientId: 'wk_spotify_client_id',
  mxmKey: 'wk_musixmatch_key',
  tokens: 'wk_spotify_tokens',
  pkceVerifier: 'wk_pkce_verifier',
  scores: 'wk_scores',
};

function read(key) {
  try {
    const v = localStorage.getItem(key);
    if (v != null) return v;
  } catch { /* storage blocked */ }
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  for (const store of [localStorage, sessionStorage]) {
    try {
      if (value == null) store.removeItem(key);
      else store.setItem(key, value);
    } catch { /* storage blocked — best effort */ }
  }
}

export const config = {
  get clientId() { return read(KEYS.clientId) || ''; },
  set clientId(v) { write(KEYS.clientId, v.trim()); },

  get mxmKey() { return read(KEYS.mxmKey) || ''; },
  set mxmKey(v) { write(KEYS.mxmKey, v.trim()); },

  get tokens() {
    try { return JSON.parse(read(KEYS.tokens)) || null; }
    catch { return null; }
  },
  set tokens(v) { write(KEYS.tokens, v ? JSON.stringify(v) : null); },

  get pkceVerifier() { return read(KEYS.pkceVerifier) || ''; },
  set pkceVerifier(v) { write(KEYS.pkceVerifier, v || null); },

  get scores() {
    try { return JSON.parse(read(KEYS.scores)) || []; }
    catch { return []; }
  },
  set scores(v) { write(KEYS.scores, JSON.stringify(v)); },
};

// The page itself is the OAuth redirect target.
export const REDIRECT_URI = window.location.origin + window.location.pathname;

// Persistent app configuration (localStorage-backed).

const KEYS = {
  clientId: 'wk_spotify_client_id',
  mxmKey: 'wk_musixmatch_key',
  tokens: 'wk_spotify_tokens',
  pkceVerifier: 'wk_pkce_verifier',
  scores: 'wk_scores',
};

export const config = {
  get clientId() { return localStorage.getItem(KEYS.clientId) || ''; },
  set clientId(v) { localStorage.setItem(KEYS.clientId, v.trim()); },

  get mxmKey() { return localStorage.getItem(KEYS.mxmKey) || ''; },
  set mxmKey(v) { localStorage.setItem(KEYS.mxmKey, v.trim()); },

  get tokens() {
    try { return JSON.parse(localStorage.getItem(KEYS.tokens)) || null; }
    catch { return null; }
  },
  set tokens(v) {
    if (v) localStorage.setItem(KEYS.tokens, JSON.stringify(v));
    else localStorage.removeItem(KEYS.tokens);
  },

  get pkceVerifier() { return sessionStorage.getItem(KEYS.pkceVerifier) || ''; },
  set pkceVerifier(v) {
    if (v) sessionStorage.setItem(KEYS.pkceVerifier, v);
    else sessionStorage.removeItem(KEYS.pkceVerifier);
  },

  get scores() {
    try { return JSON.parse(localStorage.getItem(KEYS.scores)) || []; }
    catch { return []; }
  },
  set scores(v) { localStorage.setItem(KEYS.scores, JSON.stringify(v)); },
};

// The page itself is the OAuth redirect target.
export const REDIRECT_URI = window.location.origin + window.location.pathname;

// Lyrics resolution chain: Spotify → LRCLIB → Musixmatch.
// LRCLIB comes before Musixmatch because it is free and serves time-synced
// lyrics without an API key; Musixmatch is a paid API kept as a last resort.
//
// Result shape: {
//   source: 'spotify' | 'lrclib' | 'musixmatch',
//   synced: boolean,            // true when line timings are real, false when estimated
//   lines: [{ timeMs, text }],  // sorted by timeMs
// }

import { config } from './config.js';
import { getAccessToken } from './spotify.js';

/* ---------------- Spotify (unofficial lyrics endpoint) ----------------
 * Spotify has no public lyrics API; the endpoint used by its own web
 * player usually rejects third-party tokens / CORS, but we honour the
 * "check Spotify first" requirement and fall through cleanly. */

async function fromSpotify(track) {
  const token = await getAccessToken();
  const res = await fetch(
    `https://spclient.wg.spotify.com/color-lyrics/v2/track/${track.id}?format=json`,
    { headers: { Authorization: `Bearer ${token}`, 'App-Platform': 'WebPlayer' } },
  );
  if (!res.ok) throw new Error(`Spotify lyrics unavailable (${res.status})`);
  const data = await res.json();
  const rawLines = data?.lyrics?.lines;
  if (!rawLines?.length) throw new Error('No lyrics on Spotify');
  const synced = data.lyrics.syncType === 'LINE_SYNCED';
  const lines = rawLines
    .map((l) => ({ timeMs: Number(l.startTimeMs) || 0, text: (l.words || '').trim() }))
    .filter((l) => l.text && l.text !== '♪');
  return finalize('spotify', synced, lines, track);
}

/* ---------------- Musixmatch ----------------
 * Uses JSONP (the Musixmatch API supports format=jsonp) to avoid CORS.
 * Requires a developer API key from https://developer.musixmatch.com. */

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = `__mxm_cb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const script = document.createElement('script');
    const cleanup = () => { delete window[cb]; script.remove(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Musixmatch request timed out')); }, 10000);
    window[cb] = (data) => { clearTimeout(timer); cleanup(); resolve(data); };
    script.src = `${url}&format=jsonp&callback=${cb}`;
    script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error('Musixmatch request failed')); };
    document.head.appendChild(script);
  });
}

// Parse LRC-style "[mm:ss.xx] text" lines.
function parseLrc(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
    if (!m) continue;
    const timeMs = Math.round((parseInt(m[1], 10) * 60 + parseFloat(m[2])) * 1000);
    const line = m[3].trim();
    if (line) lines.push({ timeMs, text: line });
  }
  return lines;
}

async function fromMusixmatch(track) {
  if (!config.mxmKey) throw new Error('No Musixmatch API key configured');
  const base = 'https://api.musixmatch.com/ws/1.1';
  const q = `q_track=${encodeURIComponent(track.name)}&q_artist=${encodeURIComponent(track.artists)}&apikey=${encodeURIComponent(config.mxmKey)}`;

  // Prefer time-synced subtitles…
  try {
    const data = await jsonp(`${base}/matcher.subtitle.get?${q}&f_subtitle_length=${Math.round(track.durationMs / 1000)}&f_subtitle_length_max_deviation=10`);
    const body = data?.message?.body?.subtitle?.subtitle_body;
    if (data?.message?.header?.status_code === 200 && body) {
      const lines = parseLrc(body);
      if (lines.length) return finalize('musixmatch', true, lines, track);
    }
  } catch { /* fall through to plain lyrics */ }

  // …fall back to plain (unsynced) lyrics.
  const data = await jsonp(`${base}/matcher.lyrics.get?${q}`);
  const body = data?.message?.body?.lyrics?.lyrics_body;
  if (data?.message?.header?.status_code !== 200 || !body) throw new Error('No lyrics on Musixmatch');
  const lines = body
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('******')) // strip the free-tier disclaimer banner
    .map((text) => ({ timeMs: 0, text }));
  if (!lines.length) throw new Error('No lyrics on Musixmatch');
  return finalize('musixmatch', false, lines, track);
}

/* ---------------- LRCLIB (free, CORS-friendly, synced) ---------------- */

async function fromLrclib(track) {
  const params = new URLSearchParams({
    track_name: track.name,
    artist_name: track.artists.split(',')[0].trim(),
    duration: String(Math.round(track.durationMs / 1000)),
  });
  let res = await fetch(`https://lrclib.net/api/get?${params}`);
  if (res.status === 404) {
    // Retry without the duration constraint via search.
    const sp = new URLSearchParams({ track_name: track.name, artist_name: track.artists.split(',')[0].trim() });
    const list = await (await fetch(`https://lrclib.net/api/search?${sp}`)).json();
    const hit = Array.isArray(list) && list.find((x) => x.syncedLyrics) || list?.[0];
    if (!hit) throw new Error('No lyrics on LRCLIB');
    return lrclibResult(hit, track);
  }
  if (!res.ok) throw new Error(`LRCLIB error (${res.status})`);
  return lrclibResult(await res.json(), track);
}

function lrclibResult(data, track) {
  if (data.syncedLyrics) {
    const lines = parseLrc(data.syncedLyrics);
    if (lines.length) return finalize('lrclib', true, lines, track);
  }
  if (data.plainLyrics) {
    const lines = data.plainLyrics.split(/\r?\n/).map((t) => t.trim()).filter(Boolean)
      .map((text) => ({ timeMs: 0, text }));
    if (lines.length) return finalize('lrclib', false, lines, track);
  }
  throw new Error('No lyrics on LRCLIB');
}

/* ---------------- shared ---------------- */

// When lyrics aren't time-synced, spread lines evenly across the track
// (skipping a lead-in) so the karaoke screen still advances.
function finalize(source, synced, lines, track) {
  if (!synced) {
    const leadInMs = 8000;
    const usable = Math.max(track.durationMs - leadInMs - 12000, 30000);
    const step = usable / lines.length;
    lines = lines.map((l, i) => ({ ...l, timeMs: Math.round(leadInMs + i * step) }));
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return { source, synced, lines };
}

/**
 * Resolve lyrics for a track, trying each provider in order.
 * onStep(step, status) reports progress: step ∈ spotify|musixmatch|lrclib,
 * status ∈ active|done|failed|skipped.
 */
export async function fetchLyrics(track, onStep = () => {}) {
  const providers = [
    ['spotify', fromSpotify],
    ['lrclib', fromLrclib],
    ['musixmatch', fromMusixmatch],
  ];
  const errors = [];
  for (const [name, fn] of providers) {
    onStep(name, 'active');
    try {
      const result = await fn(track);
      onStep(name, 'done');
      return result;
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      onStep(name, 'failed');
    }
  }
  throw new Error(`No lyrics found for this track. (${errors.join(' · ')})`);
}

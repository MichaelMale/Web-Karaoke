// App controller: screen routing and wiring between modules.

import { config, REDIRECT_URI } from './config.js';
import * as spotify from './spotify.js';
import { fetchLyrics } from './lyrics.js';
import { KaraokeSession, formatTime } from './karaoke.js';
import { PerformanceRater } from './scoring.js';
import { addScore, clearScores, renderScoreboard } from './scoreboard.js';

const $ = (id) => document.getElementById(id);

const screens = ['settings', 'connect', 'search', 'loading', 'karaoke', 'results', 'scoreboard'];

const state = {
  track: null,        // selected track
  lyrics: null,       // fetchLyrics result
  session: null,      // KaraokeSession
  rater: null,        // PerformanceRater
  result: null,       // final score object
  recordingUrl: null,
  aCappella: false,   // no Spotify playback (non-Premium fallback)
};

/* ---------------- navigation ---------------- */

function show(name) {
  screens.forEach((s) => { $(`screen-${s}`).hidden = s !== name; });
  document.querySelectorAll('.nav-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.nav === name));
  if (name === 'scoreboard') renderScoreboard($('scoreboard-body'), $('scoreboard-empty'));
}

function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4200);
}

function homeScreen() {
  if (!config.clientId) return 'settings';
  if (!spotify.isConnected()) return 'connect';
  return 'search';
}

/* ---------------- settings & connect ---------------- */

function initSettings() {
  $('redirect-uri-display').value = REDIRECT_URI;
  $('input-client-id').value = config.clientId;
  $('input-mxm-key').value = config.mxmKey;

  $('btn-save-settings').addEventListener('click', () => {
    config.clientId = $('input-client-id').value;
    config.mxmKey = $('input-mxm-key').value;
    if (!config.clientId) { toast('A Spotify Client ID is required.', true); return; }
    toast('Settings saved.');
    show(homeScreen());
  });

  $('btn-disconnect').addEventListener('click', () => {
    spotify.disconnect();
    $('user-chip').hidden = true;
    $('nav-search').hidden = true;
    toast('Disconnected from Spotify.');
    show(homeScreen());
  });

  $('btn-connect').addEventListener('click', () => {
    if (!config.clientId) { toast('Add your Spotify Client ID in Settings first.', true); show('settings'); return; }
    spotify.beginLogin().catch((e) => toast(e.message, true));
  });

  if (window.location.protocol === 'file:') {
    $('connect-hint').textContent = 'Heads up: serve this app over http(s) — Spotify auth does not work from file:// URLs.';
  }
}

async function refreshUser() {
  if (!spotify.isConnected()) return;
  try {
    const me = await spotify.getProfile();
    $('user-name').textContent = me.display_name || me.id;
    const img = $('user-avatar');
    if (me.images?.[0]?.url) { img.src = me.images[0].url; img.hidden = false; } else img.hidden = true;
    $('user-chip').hidden = false;
    $('nav-search').hidden = false;
  } catch { /* token may have just expired; connect screen will handle it */ }
}

/* ---------------- search ---------------- */

function initSearch() {
  const run = async () => {
    const q = $('input-search').value.trim();
    if (!q) return;
    const list = $('track-list');
    list.innerHTML = '<li class="hint">Searching…</li>';
    try {
      const tracks = await spotify.searchTracks(q);
      list.innerHTML = '';
      if (!tracks.length) { list.innerHTML = '<li class="hint">No results.</li>'; return; }
      for (const t of tracks) {
        const li = document.createElement('li');
        li.className = 'track-item';
        li.innerHTML = `
          <img src="${t.art}" alt="" loading="lazy" />
          <div class="t-meta">
            <div class="t-name"></div>
            <div class="t-artist"></div>
          </div>
          <span class="t-dur">${formatTime(t.durationMs)}</span>
          <button class="btn primary small t-sing">Sing 🎤</button>`;
        li.querySelector('.t-name').textContent = t.name;
        li.querySelector('.t-artist').textContent = `${t.artists} · ${t.album}`;
        li.addEventListener('click', () => startSong(t));
        list.appendChild(li);
      }
    } catch (e) {
      list.innerHTML = '';
      toast(e.message, true);
      if (!spotify.isConnected()) show('connect');
    }
  };
  $('btn-search').addEventListener('click', run);
  $('input-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
}

/* ---------------- song flow ---------------- */

async function startSong(track) {
  state.track = track;
  show('loading');
  $('loading-title').textContent = `Fetching lyrics for “${track.name}”…`;
  document.querySelectorAll('#lyric-steps li').forEach((li) => { li.className = ''; });

  try {
    state.lyrics = await fetchLyrics(track, (step, status) => {
      const li = document.querySelector(`#lyric-steps li[data-step="${step}"]`);
      if (li) li.className = status;
    });
  } catch (e) {
    toast(e.message, true);
    show('search');
    return;
  }

  await beginKaraoke();
}

async function beginKaraoke() {
  const { track, lyrics } = state;

  $('k-art').src = track.art;
  $('k-title').textContent = track.name;
  $('k-artist').textContent = track.artists;
  $('sync-note').hidden = lyrics.synced;
  $('k-live-score').textContent = '0';

  // Try real Spotify playback; fall back to a-cappella mode (internal clock).
  state.aCappella = false;
  $('loading-title').textContent = 'Starting playback…';
  try {
    await spotify.playTrack(track.uri);
  } catch (e) {
    state.aCappella = true;
    toast(`${e.message} — a-cappella mode: sing along to the lyrics without backing audio.`, true);
  }

  show('karaoke');

  const session = new KaraokeSession({
    lines: lyrics.lines,
    durationMs: track.durationMs,
    useSpotify: !state.aCappella,
    els: {
      scroller: $('lyrics-scroller'),
      countdown: $('countdown'),
      progress: $('song-progress'),
      timeNow: $('time-now'),
      timeTotal: $('time-total'),
    },
    onTick: () => {
      if (state.rater) $('k-live-score').textContent = state.rater.liveScore().toLocaleString();
    },
    onEnd: () => finishSong(),
  });
  state.session = session;

  // Microphone + recording (optional — the show goes on without it).
  state.rater = new PerformanceRater();
  try {
    await state.rater.start(() => session.nowMs(), (level) => {
      $('mic-level').style.width = `${Math.round(level * 100)}%`;
    });
    $('rec-dot').hidden = false;
  } catch {
    state.rater = null;
    toast('Microphone unavailable — singing will not be scored.', true);
  }

  session.start();
}

async function finishSong(early = false) {
  const { session, rater, track, lyrics } = state;
  if (!session) return;
  session.stop();
  state.session = null;
  $('rec-dot').hidden = true;
  await spotify.stopPlayback();

  let blob = null;
  if (rater) {
    blob = await rater.stop();
    state.result = rater.score(lyrics.lines, track.durationMs);
  } else {
    state.result = { total: 0, grade: '–', presence: 0, pitch: 0, consistency: 0 };
  }
  state.rater = null;

  // Results screen
  $('result-heading').textContent = early ? 'Ended early — here’s your score' : 'Performance complete!';
  $('result-grade').textContent = state.result.grade;
  $('result-score').textContent = state.result.total.toLocaleString();
  setBar('rb-presence', state.result.presence);
  setBar('rb-pitch', state.result.pitch);
  setBar('rb-consistency', state.result.consistency);

  if (state.recordingUrl) URL.revokeObjectURL(state.recordingUrl);
  state.recordingUrl = null;
  if (blob) {
    state.recordingUrl = URL.createObjectURL(blob);
    $('recording-audio').src = state.recordingUrl;
    $('playback-wrap').hidden = false;
  } else {
    $('playback-wrap').hidden = true;
  }

  $('btn-save-score').disabled = false;
  show('results');
}

function setBar(id, val) {
  $(id).style.width = `${val}%`;
  $(`${id}-val`).textContent = `${val}%`;
}

/* ---------------- results & scoreboard ---------------- */

function initResults() {
  $('btn-quit').addEventListener('click', () => finishSong(true));

  $('btn-save-score').addEventListener('click', () => {
    const singer = $('input-singer').value.trim() || 'Anonymous';
    addScore({
      singer,
      song: state.track.name,
      artist: state.track.artists,
      grade: state.result.grade,
      total: state.result.total,
    });
    $('btn-save-score').disabled = true;
    toast(`Saved ${singer}'s score!`);
    show('scoreboard');
  });

  $('btn-sing-again').addEventListener('click', () => show('search'));

  $('btn-clear-scores').addEventListener('click', () => {
    if (window.confirm('Clear the entire scoreboard?')) {
      clearScores();
      renderScoreboard($('scoreboard-body'), $('scoreboard-empty'));
    }
  });
}

/* ---------------- boot ---------------- */

async function boot() {
  initSettings();
  initSearch();
  initResults();

  document.querySelectorAll('.nav-btn').forEach((b) =>
    b.addEventListener('click', () => show(b.dataset.nav)));
  const goHome = () => show(homeScreen());
  $('logo-home').addEventListener('click', goHome);
  $('logo-home').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') goHome(); });

  try {
    const justConnected = await spotify.handleRedirectCallback();
    if (justConnected) toast('Connected to Spotify 🎉');
  } catch (e) {
    toast(e.message, true);
  }

  await refreshUser();
  show(homeScreen());
}

boot();

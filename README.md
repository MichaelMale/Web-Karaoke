# 🎤 Web Karaoke

A responsive, client-side HTML5 karaoke app powered by Spotify. Search any song,
get time-synced lyrics on a KaraFun-style screen, sing into your microphone,
get rated, and climb the scoreboard.

No build step, no backend — everything runs in your browser.

## Features

- **Connect Spotify** — secure Authorization Code + PKCE OAuth flow (no client
  secret, no server needed).
- **Song search** — search the full Spotify catalogue and pick what to sing.
- **Lyrics chain** — tries **Spotify** lyrics first, then **Musixmatch**
  (optional API key), then **LRCLIB** (free synced-lyrics database) as a final
  fallback. Synced (LRC) lyrics drive real line timings; unsynced lyrics get
  estimated timings.
- **KaraFun-style karaoke screen** — full-width lyric stage with the active
  line highlighted and progressively filled, upcoming lines below, countdown
  dots before entries, song progress bar.
- **Playback** — full tracks via the Spotify Web Playback SDK (Premium).
  Non-Premium accounts automatically get *a-cappella mode*: lyrics run on an
  internal clock and you sing without backing audio.
- **Recording & rating** — your mic is analysed live (energy + pitch via
  autocorrelation) and recorded with MediaRecorder. At the end you get a
  score out of 10,000, a letter grade (S–F), a breakdown (timing/presence,
  pitch/melody, consistency), and can listen back to your performance.
- **Scoreboard** — top-100 performances persisted in `localStorage`, with
  medals for the podium.

## Setup

1. **Create a Spotify app** (free) at
   [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard):
   - Add a **Redirect URI** matching where you serve this app, e.g.
     `http://localhost:8000/index.html` (the Settings screen shows the exact
     value to copy).
   - Enable the **Web API** and **Web Playback SDK**.
   - Copy the **Client ID**.

2. **Serve the app** over HTTP (OAuth won't work from `file://`):

   ```sh
   python3 -m http.server 8000
   # or: npx serve .
   ```

3. Open `http://localhost:8000/`, paste your Client ID into **Settings**, and
   hit **Connect Spotify**.

4. *(Optional)* add a [Musixmatch](https://developer.musixmatch.com/) API key
   in Settings to enable the Musixmatch lyrics fallback. Without it the app
   still works — LRCLIB covers most popular songs with synced lyrics for free.

## Notes & limitations

- **Spotify lyrics**: Spotify has no public lyrics API. The app attempts the
  web player's lyrics endpoint first as requested, but Spotify usually rejects
  third-party tokens, in which case the app falls through to Musixmatch/LRCLIB
  automatically — you'll see the provider chain progress on the loading screen.
- **Full playback requires Spotify Premium** (a Web Playback SDK restriction).
  Free accounts fall back to a-cappella mode.
- **Musixmatch free tier** only returns partial lyrics and no synced subtitles;
  a paid plan is needed for time-synced Musixmatch subtitles.
- **Scoring** is based on your voice (presence during lyric lines, melodic
  range, consistency across lines) — it can't compare you against the original
  melody, so treat it as party-grade rating, not a singing exam. Use
  headphones so the backing track doesn't bleed into the mic score.

## Tech

Vanilla HTML/CSS/JS (ES modules) — no frameworks, no dependencies:

| File | Role |
| --- | --- |
| `index.html` | All screens (settings, connect, search, karaoke, results, scoreboard) |
| `css/style.css` | Responsive dark theme |
| `js/app.js` | Screen routing & wiring |
| `js/spotify.js` | PKCE auth, Web API, Web Playback SDK |
| `js/lyrics.js` | Spotify → Musixmatch → LRCLIB lyrics chain, LRC parsing |
| `js/karaoke.js` | Lyric timing engine & display |
| `js/scoring.js` | Mic capture, pitch detection, recording, scoring |
| `js/scoreboard.js` | Persistent scoreboard |

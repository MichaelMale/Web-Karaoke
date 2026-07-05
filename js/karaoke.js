// Karaoke session engine: drives the lyric display against a clock
// (Spotify playback position when available, otherwise an internal timer).
//
// Display is a focused two-line view: the current line, large, with a
// progressive gold fill, plus a dimmed preview of the next line. No
// scrolling.

import { getPlayerState } from './spotify.js';

export class KaraokeSession {
  /**
   * @param {object} opts
   *   lines        [{ timeMs, text }]
   *   durationMs   total song length
   *   useSpotify   sync to Spotify playback position (else internal clock)
   *   els          { scroller, countdown, progress, timeNow, timeTotal }
   *   onTick(tMs)  called each frame
   *   onEnd()      called when the song finishes
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.running = false;
    this.currentIndex = null;
    this.lastKnownPos = 0;
    this.lastPosWallClock = 0;
    this.playing = true;
    this.raf = null;
    this._startWall = 0;
  }

  buildDom() {
    const c = this.els.scroller;
    c.innerHTML = `
      <div class="lyric-line current">
        <span class="fill-wrap"><span class="base"></span><span class="fill" aria-hidden="true"></span></span>
      </div>
      <div class="lyric-line next"></div>`;
    this.currentEl = c.querySelector('.lyric-line.current');
    this.baseEl = c.querySelector('.base');
    this.fillEl = c.querySelector('.fill');
    this.nextEl = c.querySelector('.lyric-line.next');
    this.els.timeTotal.textContent = formatTime(this.durationMs);
  }

  start() {
    this.buildDom();
    this.running = true;
    this._startWall = performance.now();
    this.lastKnownPos = 0;
    this.lastPosWallClock = this._startWall;
    if (this.useSpotify) this._pollSpotify();
    const loop = () => {
      if (!this.running) return;
      this._frame(this._now());
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this._pollTimer);
  }

  /** Current song position in ms (interpolated between Spotify polls,
   *  frozen while playback is paused/buffering). */
  _now() {
    if (!this.useSpotify) return performance.now() - this._startWall;
    if (!this.playing) return this.lastKnownPos;
    return this.lastKnownPos + (performance.now() - this.lastPosWallClock);
  }

  nowMs() { return this.running ? this._now() : null; }

  _pollSpotify() {
    this._pollTimer = setInterval(async () => {
      const state = await getPlayerState();
      if (state) {
        this.lastKnownPos = state.position;
        this.lastPosWallClock = performance.now();
        this.playing = !state.paused;
      }
    }, 500);
  }

  _frame(tMs) {
    if (tMs >= this.durationMs) {
      this.stop();
      this.onEnd?.();
      return;
    }

    const idx = this._lineIndexAt(tMs);

    // Countdown dots before the first line / during long instrumental gaps.
    const next = this.lines.find((l) => l.timeMs > tMs);
    const gap = next ? next.timeMs - tMs : 0;
    const lineOver = idx >= 0 && this._lineEndMs(idx) < tMs;
    if ((idx === -1 || lineOver) && next && gap > 1200 && gap < 12000) {
      this.els.countdown.hidden = false;
      this.els.countdown.textContent = '● '.repeat(Math.min(5, Math.ceil(gap / 1000))).trim();
    } else {
      this.els.countdown.hidden = true;
    }

    if (idx !== this.currentIndex) {
      this.currentIndex = idx;
      this._render(idx);
    }

    // Progressive fill on the current line (clip-path handles wrapped text).
    if (idx >= 0) {
      const lineStart = this.lines[idx].timeMs;
      const lineEnd = this._lineEndMs(idx);
      const frac = Math.max(0, Math.min(1, (tMs - lineStart) / Math.max(lineEnd - lineStart, 1)));
      const clip = `inset(0 ${(100 - frac * 100).toFixed(1)}% 0 0)`;
      this.fillEl.style.clipPath = clip;
      this.fillEl.style.webkitClipPath = clip; // Safari < 14
    }

    this.els.progress.style.width = `${((tMs / this.durationMs) * 100).toFixed(2)}%`;
    this.els.timeNow.textContent = formatTime(tMs);
    this.onTick?.(tMs);
  }

  _lineEndMs(idx) {
    return idx + 1 < this.lines.length
      ? this.lines[idx + 1].timeMs
      : Math.min(this.lines[idx].timeMs + 6000, this.durationMs);
  }

  _lineIndexAt(tMs) {
    let idx = -1;
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].timeMs <= tMs) idx = i;
      else break;
    }
    return idx;
  }

  _render(idx) {
    // Before the first line: preview it dimmed, with the countdown above.
    const showIdx = Math.max(idx, 0);
    const line = this.lines[showIdx];
    this.baseEl.textContent = line?.text || '';
    this.fillEl.textContent = line?.text || '';
    this.fillEl.style.clipPath = 'inset(0 100% 0 0)';
    this.fillEl.style.webkitClipPath = 'inset(0 100% 0 0)';
    this.currentEl.classList.toggle('upcoming', idx === -1);
    this.nextEl.textContent = this.lines[showIdx + 1]?.text || '';
  }
}

export function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Karaoke session engine: drives the lyric display against a clock
// (Spotify playback position when available, otherwise an internal timer).

import { getPositionMs } from './spotify.js';

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
    this.currentIndex = -1;
    this.lastKnownPos = 0;
    this.lastPosWallClock = 0;
    this.raf = null;
    this._startWall = 0;
  }

  buildDom() {
    this.els.scroller.innerHTML = '';
    this.lineEls = this.lines.map((line) => {
      const div = document.createElement('div');
      div.className = 'lyric-line';
      div.innerHTML = `<span class="fill-wrap">${escapeHtml(line.text)}<span class="fill">${escapeHtml(line.text)}</span></span>`;
      this.els.scroller.appendChild(div);
      return div;
    });
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

  /** Current song position in ms (interpolated between Spotify polls). */
  _now() {
    if (!this.useSpotify) return performance.now() - this._startWall;
    return this.lastKnownPos + (performance.now() - this.lastPosWallClock);
  }

  nowMs() { return this.running ? this._now() : null; }

  _pollSpotify() {
    this._pollTimer = setInterval(async () => {
      const pos = await getPositionMs();
      if (pos != null) {
        this.lastKnownPos = pos;
        this.lastPosWallClock = performance.now();
      }
    }, 800);
  }

  _frame(tMs) {
    if (tMs >= this.durationMs) {
      this.stop();
      this.onEnd?.();
      return;
    }

    // Countdown before the first line / during long gaps.
    const next = this.lines.find((l) => l.timeMs > tMs);
    const idx = this._lineIndexAt(tMs);
    const gap = next ? next.timeMs - tMs : 0;
    if (idx === -1 && next && gap > 1200 && gap < 12000) {
      this.els.countdown.hidden = false;
      this.els.countdown.textContent = '● '.repeat(Math.min(5, Math.ceil(gap / 1000))).trim();
    } else {
      this.els.countdown.hidden = true;
    }

    if (idx !== this.currentIndex) {
      this.currentIndex = idx;
      this._highlight(idx);
    }

    // Progressive fill on the active line.
    if (idx >= 0) {
      const lineStart = this.lines[idx].timeMs;
      const lineEnd = idx + 1 < this.lines.length
        ? this.lines[idx + 1].timeMs
        : Math.min(lineStart + 6000, this.durationMs);
      const frac = Math.max(0, Math.min(1, (tMs - lineStart) / Math.max(lineEnd - lineStart, 1)));
      const fill = this.lineEls[idx].querySelector('.fill');
      if (fill) fill.style.width = `${(frac * 100).toFixed(1)}%`;
    }

    this.els.progress.style.width = `${((tMs / this.durationMs) * 100).toFixed(2)}%`;
    this.els.timeNow.textContent = formatTime(tMs);
    this.onTick?.(tMs);
  }

  _lineIndexAt(tMs) {
    let idx = -1;
    for (let i = 0; i < this.lines.length; i++) {
      if (this.lines[i].timeMs <= tMs) idx = i;
      else break;
    }
    return idx;
  }

  _highlight(idx) {
    this.lineEls.forEach((el, i) => {
      el.classList.toggle('active', i === idx);
      el.classList.toggle('past', idx >= 0 && i < idx);
    });
    // Center the active (or upcoming) line in the stage.
    const target = this.lineEls[Math.max(idx, 0)];
    if (target) {
      const stageH = this.els.scroller.parentElement.clientHeight;
      const offset = target.offsetTop + target.offsetHeight / 2 - stageH / 2;
      this.els.scroller.style.transform = `translateY(${-Math.max(offset, 0)}px)`;
    }
  }
}

export function formatTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

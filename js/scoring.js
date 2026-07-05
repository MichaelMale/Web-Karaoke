// Microphone capture, live analysis (energy + pitch via autocorrelation),
// MediaRecorder capture, and the final performance score.

const SAMPLE_INTERVAL_MS = 60;
const NOISE_FLOOR_RMS = 0.012;

export class PerformanceRater {
  constructor() {
    this.samples = [];      // { tMs, rms, pitchHz }
    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.recorder = null;
    this.chunks = [];
    this.timer = null;
    this.getSongTimeMs = null;
    this.onLevel = () => {};
  }

  /** Ask for the mic and start sampling. getSongTimeMs maps wall clock → song position. */
  async start(getSongTimeMs, onLevel) {
    this.getSongTimeMs = getSongTimeMs;
    this.onLevel = onLevel || (() => {});
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);

    try {
      this.recorder = new MediaRecorder(this.stream);
      this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      this.recorder.start();
    } catch { this.recorder = null; } // recording is best-effort

    const buf = new Float32Array(this.analyser.fftSize);
    this.timer = setInterval(() => {
      this.analyser.getFloatTimeDomainData(buf);
      const rms = rootMeanSquare(buf);
      const pitchHz = rms > NOISE_FLOOR_RMS ? detectPitch(buf, this.audioCtx.sampleRate) : null;
      const tMs = this.getSongTimeMs();
      if (tMs != null) this.samples.push({ tMs, rms, pitchHz });
      this.onLevel(Math.min(1, rms * 9));
    }, SAMPLE_INTERVAL_MS);
  }

  /** Stop everything; returns a Blob of the recording (or null). */
  async stop() {
    clearInterval(this.timer);
    let blob = null;
    if (this.recorder && this.recorder.state !== 'inactive') {
      blob = await new Promise((resolve) => {
        this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType }));
        this.recorder.stop();
      });
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.audioCtx?.close().catch(() => {});
    return blob;
  }

  /**
   * Score singing against lyric line windows.
   * lines: [{ timeMs }] sorted; each line's window runs to the next line
   * (capped at 8s). Returns { total, grade, presence, pitch, consistency }
   * each sub-score 0–100, total 0–10000.
   */
  score(lines, songDurationMs) {
    const windows = lines.map((l, i) => {
      const end = i + 1 < lines.length ? lines[i + 1].timeMs : Math.min(l.timeMs + 6000, songDurationMs);
      return [l.timeMs, Math.min(end, l.timeMs + 8000)];
    });

    const inWindow = (t) => windows.some(([a, b]) => t >= a && t < b);
    const active = this.samples.filter((s) => inWindow(s.tMs));
    const voiced = active.filter((s) => s.rms > NOISE_FLOOR_RMS);

    if (!this.samples.length || !active.length) {
      return { total: 0, grade: 'F', presence: 0, pitch: 0, consistency: 0 };
    }

    // Presence: fraction of lyric time with voice detected.
    const presence = clamp01(voiced.length / active.length / 0.75) * 100;

    // Pitch: reward melodic range (variety of notes) and voicedness.
    const semis = voiced
      .filter((s) => s.pitchHz)
      .map((s) => Math.round(12 * Math.log2(s.pitchHz / 440)));
    const uniqueNotes = new Set(semis).size;
    const voicedRatio = semis.length / Math.max(voiced.length, 1);
    const pitch = clamp01((Math.min(uniqueNotes, 12) / 12) * 0.6 + voicedRatio * 0.4) * 100;

    // Consistency: how evenly the singer showed up across all lines.
    const perLine = windows.map(([a, b]) => {
      const w = this.samples.filter((s) => s.tMs >= a && s.tMs < b);
      if (!w.length) return 0;
      return w.filter((s) => s.rms > NOISE_FLOOR_RMS).length / w.length;
    });
    const sungLines = perLine.filter((r) => r > 0.25).length;
    const consistency = clamp01(sungLines / Math.max(perLine.length, 1) / 0.8) * 100;

    const weighted = presence * 0.5 + pitch * 0.3 + consistency * 0.2;
    const total = Math.round(weighted * 100); // 0–10000
    return { total, grade: gradeFor(weighted), presence: Math.round(presence), pitch: Math.round(pitch), consistency: Math.round(consistency) };
  }

  /** Live running score preview (cheap, called during the song). */
  liveScore() {
    const voiced = this.samples.filter((s) => s.rms > NOISE_FLOOR_RMS).length;
    return Math.min(9999, Math.round(voiced * 8));
  }
}

function gradeFor(pct) {
  if (pct >= 92) return 'S';
  if (pct >= 82) return 'A';
  if (pct >= 68) return 'B';
  if (pct >= 52) return 'C';
  if (pct >= 35) return 'D';
  return 'F';
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function rootMeanSquare(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// Autocorrelation pitch detector (ACF2+), good enough for singing voice.
function detectPitch(buf, sampleRate) {
  const size = buf.length;
  let best = -1;
  let bestCorr = 0;
  const minLag = Math.floor(sampleRate / 1000); // 1000 Hz cap
  const maxLag = Math.floor(sampleRate / 70);   // 70 Hz floor

  let norm = 0;
  for (let i = 0; i < size; i++) norm += buf[i] * buf[i];
  if (norm < 1e-6) return null;

  for (let lag = minLag; lag <= maxLag && lag < size; lag++) {
    let corr = 0;
    for (let i = 0; i < size - lag; i++) corr += buf[i] * buf[i + lag];
    corr /= norm;
    if (corr > bestCorr) { bestCorr = corr; best = lag; }
  }
  if (bestCorr < 0.3 || best < 0) return null;
  return sampleRate / best;
}

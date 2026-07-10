// Self-contained audio for the TV: synthesized SFX + simple looping music via
// the Web Audio API (no asset files). Browsers block autoplay, so nothing sounds
// until enable() is called from a real user gesture (a key press / tap on the TV).

class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = false;
    this.musicTimer = null;
    this.currentTrack = null;
    this._pendingTrack = null;
  }

  enable() {
    if (this.enabled) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.enabled = true;
      if (this._pendingTrack) this.music(this._pendingTrack);
    } catch (e) { /* audio unavailable — stay silent */ }
  }

  _tone(freq, start, dur, type = 'square', gain = 0.3) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(this.master);
    o.start(start); o.stop(start + dur + 0.03);
  }

  _noise(start, dur, gain = 0.3) {
    if (!this.ctx) return;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g); g.connect(this.master);
    src.start(start);
  }

  sfx(name) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'goal': this._tone(660, t, 0.12, 'square', 0.35); this._tone(880, t + 0.1, 0.22, 'square', 0.35); break;
      case 'card': this._tone(520, t, 0.06, 'triangle', 0.3); break;
      case 'kill': this._noise(t, 0.25, 0.4); this._tone(180, t, 0.3, 'sawtooth', 0.35); this._tone(90, t + 0.06, 0.3, 'sawtooth', 0.3); break;
      case 'meeting': for (let i = 0; i < 3; i++) { this._tone(440, t + i * 0.18, 0.12, 'square', 0.35); this._tone(330, t + i * 0.18 + 0.09, 0.09, 'square', 0.3); } break;
      case 'ding': this._tone(880, t, 0.08, 'sine', 0.3); break;
      case 'task': this._tone(660, t, 0.08, 'sine', 0.3); this._tone(990, t + 0.07, 0.12, 'sine', 0.3); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this._tone(f, t + i * 0.12, 0.22, 'square', 0.35)); break;
      case 'lose': [440, 370, 311, 233].forEach((f, i) => this._tone(f, t + i * 0.15, 0.24, 'sawtooth', 0.3)); break;
      default: break;
    }
  }

  music(track) {
    this._pendingTrack = track;
    if (!this.enabled || !this.ctx || this.currentTrack === track) return;
    this.stopMusic();
    this.currentTrack = track;
    const seqs = {
      lobby: { step: 0.30, gain: 0.11, seq: [220, 277, 330, 277, 247, 294, 330, 294], bass: 110 },
      game: { step: 0.20, gain: 0.12, seq: [330, 392, 494, 392, 349, 440, 523, 440], bass: 131 },
    };
    const s = seqs[track] || seqs.game;
    let i = 0;
    const playStep = () => {
      if (!this.enabled || this.currentTrack !== track) return;
      const t = this.ctx.currentTime + 0.03;
      this._tone(s.seq[i % s.seq.length], t, s.step * 0.9, 'triangle', s.gain);
      if (i % 4 === 0) this._tone(s.bass, t, s.step * 1.8, 'square', s.gain * 0.9);
      i += 1;
    };
    playStep();
    this.musicTimer = setInterval(playStep, s.step * 1000);
  }

  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    this.currentTrack = null;
  }
}

export default new GameAudio();

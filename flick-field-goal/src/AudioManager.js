// AudioManager — procedural SFX via Web Audio API. No external files.
//
// Sounds (all synthesized):
//   kickThump  — short low-mid thump
//   cheer      — band-pass white noise burst, longer for "perfect"
//   groan      — descending sine sweep
//   whistle    — high square pulse
//   crowdLoop  — long, looping low-amplitude noise (only while playing)
//
// Browser autoplay rules require a user gesture before AudioContext
// can produce sound. ensure() is called from the first interaction.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.crowdGain = null;
    this.crowdNode = null;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
  }

  // Best-effort haptic helper alongside audio so callers have one obvious
  // entry-point for "trigger feedback."
  haptic(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
  }

  startCrowdLoop() {
    if (!this.ctx || this.crowdNode) return;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 4, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // Pink-ish noise, soft.
      data[i] = (Math.random() * 2 - 1) * 0.3;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const gain = this.ctx.createGain(); gain.gain.value = 0.08;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass"; filter.frequency.value = 250; filter.Q.value = 0.7;
    src.connect(filter); filter.connect(gain); gain.connect(this.master);
    src.start();
    this.crowdNode = src; this.crowdGain = gain;
  }
  stopCrowdLoop() {
    if (this.crowdNode) {
      try { this.crowdNode.stop(); } catch {}
      this.crowdNode.disconnect(); this.crowdGain.disconnect();
      this.crowdNode = null; this.crowdGain = null;
    }
  }

  kickThump() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.25);
  }

  cheer(perfect) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dur = perfect ? 0.85 : 0.55;
    // White noise burst → bandpass 1.5kHz → quick fade in/out.
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = "bandpass"; filt.frequency.value = perfect ? 1200 : 800; filt.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(perfect ? 0.55 : 0.40, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t);
    if (perfect) {
      // Bass thump under the cheer for the perfect-kick impact.
      const o = this.ctx.createOscillator();
      o.type = "sine"; o.frequency.value = 80;
      const og = this.ctx.createGain(); og.gain.value = 0;
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(og); og.connect(this.master);
      o.start(t); o.stop(t + 0.5);
    }
  }

  groan() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.75);
  }

  whistle() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = "square"; o.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.20, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.32);
  }
}

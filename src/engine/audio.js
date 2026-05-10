// Procedural Web Audio engine. No asset files.
// - One-shot SFX (jump, pickup, gem, flip, land, perfect, crash, boost, click)
// - Looping engine drone with throttle / boost modulation
// - Background music scheduler with two pattern modes (menu / game)
// - Master mute persisted to localStorage
//
// AudioContext is created lazily on the first user gesture (browsers
// require this).
let audio = null, master = null;
let engineOsc = null, engineGain = null, engineFilter = null;
let muted = false;
try { muted = localStorage.getItem("declanbike.muted") === "1"; } catch (e) {}

function ensure() {
  if (audio) {
    if (audio.state === "suspended") audio.resume();
    return audio;
  }
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  audio = new C();
  master = audio.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(audio.destination);
  return audio;
}

function blip(freq, dur = 0.12, type = "sine", vol = 0.18, when = 0) {
  if (!ensure()) return;
  const t = audio.currentTime + when;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function sweep(f1, f2, dur, type = "square", vol = 0.18) {
  if (!ensure()) return;
  const t = audio.currentTime;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.3, lpf = 1500) {
  if (!ensure()) return;
  const len = Math.floor(audio.sampleRate * dur);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = audio.createBufferSource();
  src.buffer = buf;
  const f = audio.createBiquadFilter();
  f.type = "lowpass"; f.frequency.value = lpf;
  const g = audio.createGain();
  const t = audio.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

function startEngine() {
  if (!ensure() || engineOsc) return;
  engineOsc = audio.createOscillator();
  engineOsc.type = "sawtooth";
  engineOsc.frequency.value = 80;
  engineFilter = audio.createBiquadFilter();
  engineFilter.type = "lowpass";
  engineFilter.frequency.value = 700;
  engineGain = audio.createGain();
  engineGain.gain.value = 0;
  engineOsc.connect(engineFilter);
  engineFilter.connect(engineGain);
  engineGain.connect(master);
  engineOsc.start();
}
function setEngine(speed01, throttle, boost) {
  if (!engineOsc) return;
  const t = audio.currentTime;
  const baseFreq = 65 + speed01 * 230 + (throttle ? 25 : 0) + (boost ? 70 : 0);
  engineOsc.frequency.cancelScheduledValues(t);
  engineOsc.frequency.linearRampToValueAtTime(baseFreq, t + 0.06);
  engineFilter.frequency.linearRampToValueAtTime(500 + speed01 * 1400 + (boost ? 700 : 0), t + 0.06);
  const targetGain = (throttle || boost) ? 0.085 : 0.025 + speed01 * 0.04;
  engineGain.gain.cancelScheduledValues(t);
  engineGain.gain.linearRampToValueAtTime(muted ? 0 : targetGain, t + 0.06);
}
function stopEngine() {
  if (!engineOsc) return;
  const t = audio.currentTime;
  engineGain.gain.cancelScheduledValues(t);
  engineGain.gain.linearRampToValueAtTime(0, t + 0.15);
  const osc = engineOsc;
  engineOsc = null;
  setTimeout(() => { try { osc.stop(); } catch {} }, 220);
}

// One-shot SFX library
function jump()      { sweep(220, 540, 0.14, "square", 0.20); }
function pickup()    { blip(880, 0.07, "triangle", 0.18); blip(1320, 0.10, "triangle", 0.10, 0.04); }
function gem()       { blip(880, 0.08, "triangle", 0.18); blip(1100, 0.08, "triangle", 0.18, 0.06); blip(1320, 0.12, "triangle", 0.18, 0.12); }
function flipSnd(n)  { for (let i = 0; i < n; i++) blip(660 + i * 220, 0.07, "square", 0.16, i * 0.06); }
function landSnd()   { sweep(160, 80, 0.16, "sine", 0.28); noise(0.10, 0.10, 600); }
function perfectSnd(){ blip(1320, 0.10, "triangle", 0.20); blip(1760, 0.18, "triangle", 0.18, 0.08); }
function crashSnd()  { noise(0.45, 0.40, 900); sweep(260, 60, 0.32, "sawtooth", 0.22); }
function boostHit()  { noise(0.20, 0.18, 3000); sweep(800, 1600, 0.18, "sine", 0.10); }
function click()     { blip(900, 0.04, "square", 0.10); }

// ----- Background music ---------------------------------------------------
let musicTimer = null;
let musicMode = "menu";
let musicBeat = 0;
const PATTERN_GAME = {
  bass: [0, null, 0, null, -3, null, 0, null, -5, null, -5, null, -7, null, -3, null],
  arp:  [12, 7, 12, 15, 12, 7, 19, 15, 12, 7, 12, 15, 14, 10, 17, 19],
  kick: [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0],
  snare:[0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
};
const PATTERN_MENU = {
  bass: [0, null, null, null, -3, null, null, null, -5, null, null, null, -7, null, null, null],
  arp:  [12, null, 14, null, 17, null, 14, null, 12, null, 14, null, 17, null, 19, null],
  kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  snare:[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
const ROOT_HZ = 110;
const semi = (n) => ROOT_HZ * Math.pow(2, n / 12);

function tick() {
  if (!ensure()) return;
  const pat = musicMode === "menu" ? PATTERN_MENU : PATTERN_GAME;
  const i = musicBeat % pat.bass.length;
  const t = audio.currentTime + 0.02;
  if (pat.bass[i] != null) {
    const o = audio.createOscillator(), g = audio.createGain(), f = audio.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 600;
    o.type = "triangle"; o.frequency.setValueAtTime(semi(pat.bass[i]), t);
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.28);
    o.connect(f); f.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.32);
  }
  if (pat.arp[i] != null) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "square"; o.frequency.setValueAtTime(semi(pat.arp[i]), t);
    g.gain.setValueAtTime(0.025, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.15);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.18);
  }
  if (pat.kick[i]) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.10);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.14);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.16);
  }
  if (pat.snare[i]) {
    const len = Math.floor(audio.sampleRate * 0.10);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let k = 0; k < len; k++) data[k] = Math.random() * 2 - 1;
    const src = audio.createBufferSource();
    src.buffer = buf;
    const f = audio.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = 1500;
    const g = audio.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.10);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }
  musicBeat++;
}
function startMusic(mode) {
  const newMode = mode || "game";
  if (musicTimer && musicMode === newMode) return;
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  musicMode = newMode;
  if (!ensure()) return;
  musicBeat = 0;
  musicTimer = setInterval(tick, 220);
}
function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}

function toggleMute() {
  muted = !muted;
  try { localStorage.setItem("declanbike.muted", muted ? "1" : "0"); } catch (e) {}
  if (master) master.gain.value = muted ? 0 : 0.55;
  return muted;
}
function isMuted() { return muted; }

export const Sound = {
  ensure, startEngine, setEngine, stopEngine,
  jump, pickup, gem, flip: flipSnd, land: landSnd, perfect: perfectSnd,
  crash: crashSnd, boostHit, click, toggleMute, isMuted,
  startMusic, stopMusic,
};

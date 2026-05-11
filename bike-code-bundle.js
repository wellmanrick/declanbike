// ============================================================
// DECLANBIKE — bike game source
// ============================================================

// ---------- src/state.js ----------
// Shared mutable game state.
// G is a single mutable container so consumers can read and write
// `G.state`, `G.runtime`, `G.minigameRuntime` from any module without
// needing setter functions everywhere.
export const STATE = Object.freeze({
  MENU: "menu",
  LEVELS: "levels",
  GARAGE: "garage",
  QUESTS: "quests",       // doubles as mini-games hub
  HOW: "how",
  PLAY: "play",
  PAUSE: "pause",
  RESULT: "result",
  MINIGAME: "minigame",
  CB_LEVELS: "cb-levels", // Can Bash level select
  FG_LEVELS: "fg-levels", // Field Goal level select
  PP_LEVELS: "pp-levels", // Party Pong level select
});

export const G = {
  state: STATE.MENU,
  runtime: null,         // active trail run
  minigameRuntime: null, // active mini-game
};

// ---------- src/engine/rng.js ----------
// Deterministic pseudo-random number generator. Mulberry32 — seedable so
// procedurally-generated trails always look the same per level seed.
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- src/engine/canvas.js ----------
// Canvas + viewport. The render area fills the device viewport with
// device-pixel-ratio scaling so we draw at native resolution.
//
// W / H are CSS-pixel logical dimensions; ctx is pre-transformed by DPR
// so callers draw in CSS coordinates as if the canvas were 1:1.
//
// VW / VH are the *world* visible dimensions, scaled by WORLD_ZOOM.
// Recomputed on every resize.

export const canvas = document.getElementById("game");
export const ctx = canvas.getContext("2d");

// Mutable. Imported as live bindings.
export let W = canvas.width;
export let H = canvas.height;
export let DPR = window.devicePixelRatio || 1;

export const WORLD_ZOOM = 1.55;
export let VW = (W || 0) / WORLD_ZOOM;
export let VH = (H || 0) / WORLD_ZOOM;

// Recompute the world viewport. Defaults to WORLD_ZOOM so resize at boot
// works; the per-frame render path passes its dynamic camera zoom so the
// camera follow + parallax stays correct.
export function updateViewport(zoom) {
  const z = zoom == null ? WORLD_ZOOM : zoom;
  VW = W / z;
  VH = H / z;
}

export function resizeCanvas() {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  DPR = window.devicePixelRatio || 1;
  W = cw; H = ch;
  canvas.width  = Math.round(cw * DPR);
  canvas.height = Math.round(ch * DPR);
  canvas.style.width  = cw + "px";
  canvas.style.height = ch + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  updateViewport();
  const app = document.getElementById("app");
  if (app) { app.style.width = cw + "px"; app.style.height = ch + "px"; }
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
resizeCanvas();

// Common math helpers shared by everyone.
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function wrapAngle(a) {
  while (a > Math.PI)  a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ---------- src/engine/input.js ----------
// Keyboard + touch button input. Synthesizes a uniform key set so the
// game logic doesn't care whether a press came from a hardware key or
// an on-screen button.
//
// keys      — currently-held keys (Set of KeyboardEvent.code values)
// justPressed — keys that transitioned to pressed this frame; cleared
//               at the end of each loop tick.
import { Sound } from "./audio.js";

export const keys = new Set();
export const justPressed = new Set();

window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) justPressed.add(e.code);
  keys.add(e.code);
  Sound.ensure(); // unlock audio on first user gesture
});
window.addEventListener("keyup", (e) => { keys.delete(e.code); });
window.addEventListener("pointerdown", () => Sound.ensure(), { once: false });

// High-level intent of the held keys (for the bike physics).
export function input() {
  return {
    throttle: keys.has("ArrowRight") || keys.has("KeyD"),
    brake:    keys.has("ArrowLeft")  || keys.has("KeyA"),
    leanFwd:  keys.has("ArrowUp")    || keys.has("KeyW"),
    leanBack: keys.has("ArrowDown")  || keys.has("KeyS"),
    boost:    keys.has("Space"),
    preload:  keys.has("ShiftLeft")  || keys.has("ShiftRight"),
  };
}

const isTouchDevice = (("ontouchstart" in window) || (navigator.maxTouchPoints > 0));

export function setupTouchControls() {
  const touchEl = document.getElementById("touch");
  if (!touchEl) return;
  if (isTouchDevice) touchEl.classList.add("show");

  const muteBtn = document.getElementById("mute-btn");
  if (muteBtn) {
    const updateMuteUi = () => {
      muteBtn.textContent = Sound.isMuted() ? "🔇" : "♪";
      muteBtn.classList.toggle("muted", Sound.isMuted());
    };
    updateMuteUi();
    muteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      Sound.ensure();
      Sound.toggleMute();
      updateMuteUi();
    });
  }

  const buttons = touchEl.querySelectorAll(".tbtn, .tpad");
  for (const btn of buttons) {
    const code = btn.dataset.key;
    if (!code) continue;
    const press = (e) => {
      e.preventDefault();
      btn.classList.add("held");
      Sound.ensure();
      if (code === "Escape") {
        if (!keys.has("Escape")) justPressed.add("Escape");
        keys.add("Escape");
        setTimeout(() => keys.delete("Escape"), 50);
        return;
      }
      if (!keys.has(code)) justPressed.add(code);
      keys.add(code);
    };
    const release = (e) => {
      e.preventDefault();
      btn.classList.remove("held");
      if (code === "Escape") return;
      keys.delete(code);
    };
    btn.addEventListener("touchstart", press, { passive: false });
    btn.addEventListener("touchend", release, { passive: false });
    btn.addEventListener("touchcancel", release, { passive: false });
    btn.addEventListener("mousedown", press);
    btn.addEventListener("mouseup", release);
    btn.addEventListener("mouseleave", release);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}

// ---------- src/engine/save.js ----------
// Save / load for the player profile. localStorage-backed with graceful
// fallbacks for browsers that throw on storage access (Safari Private).
const SAVE_KEY = "declanbike.save.v1";

export const DEFAULT_SAVE = {
  cash: 250,
  best: {},                       // levelId -> { time, score, distance, completed, medal }
  ownedParts: {                   // partId -> true for owned
    engine_stock: true, tire_stock: true, suspension_stock: true,
    frame_stock: true, paint_red: true,
    char_declan: true,
  },
  equipped: {
    engine: "engine_stock",
    tire: "tire_stock",
    suspension: "suspension_stock",
    frame: "frame_stock",
    paint: "paint_red",
    character: "char_declan",
  },
  tutorialsSeen: {},
  quests: {},                     // questId -> { progress, done, claimed }
  unlockedLevels: { trail_01: true },
  totals: {
    distance: 0, flips: 0, airtime: 0, crashes: 0, runs: 0, jumps: 0,
    cleanLandings: 0, perfectLandings: 0, gems: 0, cleanRuns: 0,
  },
  minigameBest: {},
  canBashLevels: {},              // levelId -> { stars, ballsUsed, score, cleared }
  canBashSeenTypes: {},           // canType -> true once the player has seen
                                  // a level containing it (drives the first-
                                  // encounter tutorial toast).
  canBashSeenPowers: {},          // power-up type -> true once the player
                                  // has collected one (drives the use-it
                                  // tutorial toast).
  fieldGoalLevels: {},            // levelId -> { stars, made, attempts, score }
  fieldGoalSeenConditions: {},    // condition slug -> true once the player has
                                  // played a level featuring that condition
                                  // (drives the first-encounter tutorial).
  fieldGoalSeenPowers: {},        // power-up slug -> true once the player has
                                  // collected one (drives the use-it tutorial).
  fieldGoalBest: {                // Lifetime Field Goal records.
    longestMake: 0,               //   farthest converted kick in yards
    bestStreak: 0,                //   longest in-round consecutive-make streak
    totalMakes: 0,                //   lifetime makes across all rounds
  },
  partyPongLevels: {},            // levelId -> { stars, ballsUsed, score, cleared }
  partyPongBest: {                // Lifetime Party Pong records.
    bestStreak: 0,                //   longest in-round consecutive-make streak
    totalMakes: 0,                //   lifetime cups sunk across all rounds
    rackClears: 0,                //   total racks cleared
  },
};

function _load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(DEFAULT_SAVE), parsed, {
      ownedParts: Object.assign({}, DEFAULT_SAVE.ownedParts, parsed.ownedParts || {}),
      equipped: Object.assign({}, DEFAULT_SAVE.equipped, parsed.equipped || {}),
      totals: Object.assign({}, DEFAULT_SAVE.totals, parsed.totals || {}),
      best: parsed.best || {},
      quests: parsed.quests || {},
      unlockedLevels: Object.assign({}, DEFAULT_SAVE.unlockedLevels, parsed.unlockedLevels || {}),
      minigameBest: parsed.minigameBest || {},
      canBashLevels: parsed.canBashLevels || {},
      canBashSeenTypes: parsed.canBashSeenTypes || {},
      canBashSeenPowers: parsed.canBashSeenPowers || {},
      fieldGoalLevels: parsed.fieldGoalLevels || {},
      fieldGoalSeenConditions: parsed.fieldGoalSeenConditions || {},
      fieldGoalSeenPowers: parsed.fieldGoalSeenPowers || {},
      fieldGoalBest: Object.assign({}, DEFAULT_SAVE.fieldGoalBest, parsed.fieldGoalBest || {}),
      partyPongLevels: parsed.partyPongLevels || {},
      partyPongBest: Object.assign({}, DEFAULT_SAVE.partyPongBest, parsed.partyPongBest || {}),
    });
  } catch (e) {
    console.warn("Save load failed", e);
    return structuredClone(DEFAULT_SAVE);
  }
}

// `save` is the live profile. Mutate it freely; call persistSave() to write.
// Exported as `let` so internal reassignment (reset) propagates to imports.
export let save = _load();

export function persistSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
}

export function resetSave() {
  save = structuredClone(DEFAULT_SAVE);
  persistSave();
  return save;
}

// ---------- src/engine/audio.js ----------
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
// Crowd cheer — layered noise base + pitched sweeps emulating a stadium
// roar. `big` doubles the duration and stacks an extra octave for a
// bigger "wow" reaction.
function cheerSnd(big) {
  const dur = big ? 1.2 : 0.8;
  noise(dur, big ? 0.30 : 0.22, 1400);
  sweep(380, 620, dur * 0.85, "sawtooth", big ? 0.07 : 0.05);
  sweep(440, 720, dur * 0.95, "triangle", big ? 0.06 : 0.04);
  if (big) {
    sweep(880, 1320, dur * 0.85, "triangle", 0.05);
    blip(1320, 0.20, "triangle", 0.07, 0.15);
  }
}
// Crowd groan — descending sweeps + muffled noise. Played on misses.
function groanSnd() {
  noise(0.65, 0.20, 700);
  sweep(420, 220, 0.6, "sawtooth", 0.05);
  sweep(360, 200, 0.7, "triangle", 0.04);
}
// Tiny firework crackle — short noise + chirped blip cluster. Layered
// per burst when streak fireworks fire.
function fireworkSnd() {
  noise(0.18, 0.18, 5000);
  blip(2200 + Math.random() * 400, 0.10, "triangle", 0.10, 0.05);
}

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
  cheer: cheerSnd, groan: groanSnd, firework: fireworkSnd,
  startMusic, stopMusic,
};

// ---------- src/engine/juice.js ----------
// Juice helpers — toasts (DOM popups), particle spawners, floating
// world text. Pure helpers; rely on the run-time game state for the
// active particle / text lists.
import { G } from "../state.js";

export function pushToast(text, kind = "gold", ttl = 1500) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  stack.appendChild(el);
  setTimeout(() => el.remove(), ttl + 400);
}

export function pushFloating(text, x, y, color) {
  if (!G.runtime) return;
  G.runtime.floatingTexts.push({ text, x, y, vy: -60, life: 1.2, maxLife: 1.2, color });
}

export function spawnExhaustParticles(isBoost) {
  const r = G.runtime;
  if (!r) return;
  const b = r.bike;
  const offsetX = -Math.cos(b.angle) * 22 - Math.sin(b.angle) * 6;
  const offsetY = -Math.sin(b.angle) * 22 + Math.cos(b.angle) * -2;
  for (let i = 0; i < (isBoost ? 3 : 1); i++) {
    r.particles.push({
      x: b.x + offsetX, y: b.y + offsetY,
      vx: -b.vx * 0.1 - 60 + Math.random() * -40,
      vy: -20 + Math.random() * -60,
      life: 0.6, maxLife: 0.6,
      color: isBoost ? "#6ee7ff" : "#776655",
      size: 4 + Math.random() * (isBoost ? 6 : 3),
    });
  }
}

export function spawnSmashParticles(x, y, type) {
  if (!G.runtime) return;
  const r = G.runtime;
  const palette = type === "rock"
    ? ["#9aa3b3", "#666e80", "#3d4150", "#cccccc"]
    : type === "log"
    ? ["#925a2c", "#6a3e1f", "#3b2412", "#d8a13a"]
    : ["#1a1a1a", "#3b3b3b", "#888"];
  for (let i = 0; i < 18; i++) {
    r.particles.push({
      x: x + (Math.random() - 0.5) * 14,
      y: y + (Math.random() - 0.5) * 14,
      vx: (Math.random() - 0.4) * 480,
      vy: -120 - Math.random() * 240,
      life: 0.6 + Math.random() * 0.4, maxLife: 1.0,
      color: palette[Math.floor(Math.random() * palette.length)],
      size: 2 + Math.random() * 4,
    });
  }
  for (let i = 0; i < 6; i++) {
    r.particles.push({
      x: x, y: y - 14,
      vx: (Math.random() - 0.5) * 200,
      vy: -60 - Math.random() * 80,
      life: 0.25, maxLife: 0.25,
      color: "rgba(255, 230, 120, 0.9)",
      size: 5 + Math.random() * 4,
    });
  }
}

// terrainHeightAt is injected at boot to break a circular dep with
// the world/terrain module.
let _terrainHeightAt = (_, x) => 540;
export function _setTerrainHeightFn(fn) { _terrainHeightAt = fn; }

export function spawnLandingDust(intensity) {
  if (!G.runtime) return;
  const r = G.runtime;
  const b = r.bike;
  const groundY = _terrainHeightAt(r.terrain, b.x);
  const n = Math.floor(8 + intensity * 14);
  for (let i = 0; i < n; i++) {
    const dir = i < n / 2 ? -1 : 1;
    r.particles.push({
      x: b.x + (Math.random() - 0.5) * 30,
      y: groundY,
      vx: dir * (40 + Math.random() * 200) * intensity,
      vy: -40 - Math.random() * 120 * intensity,
      life: 0.7 + Math.random() * 0.4,
      maxLife: 1.0,
      color: "rgba(180, 150, 100, " + (0.45 + Math.random() * 0.3).toFixed(2) + ")",
      size: 3 + Math.random() * 5,
    });
  }
}

export function spawnCrashParticles() {
  if (!G.runtime) return;
  const r = G.runtime;
  const b = r.bike;
  for (let i = 0; i < 24; i++) {
    r.particles.push({
      x: b.x, y: b.y,
      vx: (Math.random() - 0.5) * 400,
      vy: -100 - Math.random() * 200,
      life: 0.9, maxLife: 0.9,
      color: ["#ffb020","#ff5a3a","#776655","#cccccc"][Math.floor(Math.random()*4)],
      size: 3 + Math.random() * 4,
    });
  }
}

// ---------- src/world/terrain.js ----------
// Procedural terrain generator. Each level seeds a deterministic
// heightmap of dirt, ramps, gaps, decorative props, collectibles,
// obstacles (rocks/logs/tires), hazards (oil/mud/fire/springs),
// and checkpoints.
//
// The map is sampled every TERRAIN_DX pixels; consumers interpolate via
// terrainHeightAt(). After generating the raw shape we slope-limit and
// triangle-smooth so cliffs can't form even when ramps and gaps overlap.
import { mulberry32 } from "../engine/rng.js";

export const TERRAIN_DX = 8;     // sample spacing in world px
export const GROUND_BASE = 540;  // base ground y in world coords

export function buildTerrain(level) {
  const rand = mulberry32(level.seed);
  const samples = Math.ceil(level.length / TERRAIN_DX) + 100;
  const heights = new Float32Array(samples);
  const obstacles = [];
  const collectibles = [];
  const ramps = [];
  const checkpoints = [];

  const freq1 = 0.0025 * level.hills;
  const freq2 = 0.008 * level.hills;
  const amp1 = 60 * level.hills;
  const amp2 = 18 * level.hills;
  const phase1 = rand() * 100;
  const phase2 = rand() * 100;

  for (let i = 0; i < samples; i++) {
    const x = i * TERRAIN_DX;
    let y = GROUND_BASE;
    if (x > 200 && x < level.length - 200) {
      y -= Math.sin(x * freq1 + phase1) * amp1;
      y -= Math.sin(x * freq2 + phase2) * amp2;
    }
    heights[i] = y;
  }

  for (let i = 0; i < 30; i++) heights[i] = GROUND_BASE;
  const lastSamples = Math.floor(level.length / TERRAIN_DX);
  for (let i = lastSamples - 30; i <= lastSamples + 60 && i < samples; i++) heights[i] = GROUND_BASE - 20;

  function deform(cx, w, peak) {
    const ci = Math.floor(cx / TERRAIN_DX);
    const halfSamples = Math.ceil(w / TERRAIN_DX);
    for (let k = -halfSamples; k <= halfSamples; k++) {
      const idx = ci + k;
      if (idx < 30 || idx >= lastSamples - 30) continue;
      const t = k / halfSamples;
      const profile = Math.cos(t * Math.PI * 0.5);
      heights[idx] -= peak * Math.max(0, profile);
    }
  }

  // Big ramps — headline jumps.
  const bigRampCount = Math.floor(level.length / 220 * Math.max(0.6, level.gaps) + 6);
  for (let n = 0; n < bigRampCount; n++) {
    const cx = 280 + rand() * (level.length - 560);
    const w = 80 + rand() * 90;
    const h = 70 + rand() * (90 * level.gaps);
    deform(cx, w, h);
    ramps.push({ x: cx, y: GROUND_BASE - h, w, h });
  }
  // Small bumps — rolling hill texture.
  const bumpCount = Math.floor(level.length / 90);
  for (let n = 0; n < bumpCount; n++) {
    const cx = 200 + rand() * (level.length - 400);
    const w = 30 + rand() * 50;
    const h = 10 + rand() * 22;
    deform(cx, w, h);
  }
  // Roller doubles — paired ramps for tabletop combos.
  const doubleCount = Math.floor(level.length / 700 + 2);
  for (let n = 0; n < doubleCount; n++) {
    const cx = 400 + rand() * (level.length - 900);
    const w = 70 + rand() * 30;
    const h = 60 + rand() * 50;
    deform(cx, w, h);
    deform(cx + w * 2 + 20, w, h * (0.7 + rand() * 0.5));
    ramps.push({ x: cx, y: GROUND_BASE - h, w, h });
  }
  // Gaps — negative dips.
  const gapCount = Math.floor(level.gaps * 8 + 4);
  for (let n = 0; n < gapCount; n++) {
    const cx = 600 + rand() * (level.length - 1100);
    const w = 50 + rand() * (90 * level.gaps);
    const depth = 70 + rand() * 70;
    const ci = Math.floor(cx / TERRAIN_DX);
    const halfSamples = Math.ceil(w / TERRAIN_DX);
    for (let k = -halfSamples; k <= halfSamples; k++) {
      const idx = ci + k;
      if (idx < 30 || idx >= lastSamples - 30) continue;
      const t = k / halfSamples;
      const profile = Math.cos(t * Math.PI * 0.5);
      heights[idx] += depth * profile;
    }
  }

  // Collectibles.
  const collectCount = Math.floor(level.length / 180);
  for (let n = 0; n < collectCount; n++) {
    const x = 350 + rand() * (level.length - 700);
    const i = Math.floor(x / TERRAIN_DX);
    const groundY = heights[i];
    const y = groundY - 60 - rand() * 110;
    const r0 = rand();
    let type;
    if (r0 < 0.05)      type = "star";
    else if (r0 < 0.10) type = "shield";
    else if (r0 < 0.13) type = "magnet";
    else if (r0 < 0.22) type = "gem";
    else                type = "bolt";
    collectibles.push({ x, y, type, taken: false, bob: rand() * Math.PI * 2 });
  }

  // Checkpoints.
  for (let cx = 700; cx < level.length - 100; cx += 700) {
    const i = Math.floor(cx / TERRAIN_DX);
    checkpoints.push({ x: cx, y: heights[i] });
  }

  // Theme-aware decorative props.
  const props = [];
  const theme = level.theme || "dusk";
  const propStep = 110 + rand() * 40;
  const signPhrases = ["SEND IT", "CAUTION", "SLOW", "RAMP", "GAP", "FAST!", "JUMP!", "200m", "LEFT TURN", "DROP"];
  for (let cx = 220; cx < level.length - 200; cx += propStep + rand() * 80) {
    const roll = rand();
    if (theme === "desert") {
      if (roll < 0.45) props.push({ x: cx, type: "cactus", h: 16 + rand() * 16 });
      else if (roll < 0.7) props.push({ x: cx, type: "rock", r: 6 + rand() * 8 });
      else if (roll < 0.85) props.push({ x: cx, type: "sign", h: 24 + rand() * 8, text: signPhrases[Math.floor(rand() * signPhrases.length)] });
      else props.push({ x: cx, type: "flag", h: 26 + rand() * 10, color: "#ffce6e" });
    } else if (theme === "night") {
      if (roll < 0.5) props.push({ x: cx, type: "tree", h: 22 + rand() * 16, r: 7 + rand() * 5 });
      else if (roll < 0.8) props.push({ x: cx, type: "rock", r: 5 + rand() * 7 });
      else props.push({ x: cx, type: "sign", h: 22 + rand() * 6, text: signPhrases[Math.floor(rand() * signPhrases.length)] });
    } else if (theme === "sunset") {
      if (roll < 0.45) props.push({ x: cx, type: "tree", h: 20 + rand() * 18, r: 7 + rand() * 5 });
      else if (roll < 0.7) props.push({ x: cx, type: "cone", h: 12 + rand() * 4 });
      else if (roll < 0.85) props.push({ x: cx, type: "flag", h: 24 + rand() * 6, color: "#ff5a3a" });
      else props.push({ x: cx, type: "rock", r: 5 + rand() * 6 });
    } else {
      if (roll < 0.55) props.push({ x: cx, type: "tree", h: 24 + rand() * 18, r: 8 + rand() * 5 });
      else if (roll < 0.78) props.push({ x: cx, type: "rock", r: 6 + rand() * 7 });
      else if (roll < 0.92) props.push({ x: cx, type: "sign", h: 22 + rand() * 6, text: signPhrases[Math.floor(rand() * signPhrases.length)] });
      else props.push({ x: cx, type: "cone", h: 12 + rand() * 4 });
    }
  }

  // Slope limit + smooth so cliffs can't form.
  const maxStep = TERRAIN_DX * 1.4;
  for (let i = 1; i < heights.length; i++) {
    const dh = heights[i] - heights[i - 1];
    if (dh >  maxStep) heights[i] = heights[i - 1] + maxStep;
    if (dh < -maxStep) heights[i] = heights[i - 1] - maxStep;
  }
  for (let i = heights.length - 2; i >= 0; i--) {
    const dh = heights[i] - heights[i + 1];
    if (dh >  maxStep) heights[i] = heights[i + 1] + maxStep;
    if (dh < -maxStep) heights[i] = heights[i + 1] - maxStep;
  }
  for (let i = 1; i < heights.length - 1; i++) {
    heights[i] = (heights[i - 1] + heights[i] * 2 + heights[i + 1]) * 0.25;
  }

  // Solid obstacles — rocks/logs crash you unless you're fast and level
  // (smash bonus); tires are soft, slowing you with sparks. Placed after
  // slope smoothing so they sit on top of the final ground line.
  const obstacleCount = Math.floor(level.length / 380);
  for (let n = 0; n < obstacleCount; n++) {
    const x = 600 + rand() * (level.length - 1100);
    const i = Math.floor(x / TERRAIN_DX);
    const y = heights[i];
    const r0 = rand();
    let type, r;
    if (r0 < 0.40)      { type = "rock"; r = 10 + rand() * 8; }
    else if (r0 < 0.75) { type = "tire"; r = 12 + rand() * 4; }
    else                { type = "log";  r = 11 + rand() * 6; }
    obstacles.push({ x, y, type, r, hit: false });
  }

  // Hazard strips — oil slides, mud bogs, fire pits, plus springs.
  // Widths tuned so the player has to either thread or jump.
  const hazards = [];
  const springCount = Math.floor(level.length / 480) + 3;
  for (let n = 0; n < springCount; n++) {
    const cx = 500 + rand() * (level.length - 800);
    hazards.push({ x: cx, w: 32, type: "spring", fired: false });
  }
  const oilCount = Math.floor(level.length / 700);
  for (let n = 0; n < oilCount; n++) {
    const cx = 600 + rand() * (level.length - 1000);
    hazards.push({ x: cx, w: 55 + rand() * 30, type: "oil" });
  }
  const mudCount = Math.floor(level.length / 850);
  for (let n = 0; n < mudCount; n++) {
    const cx = 600 + rand() * (level.length - 1000);
    hazards.push({ x: cx, w: 70 + rand() * 30, type: "mud" });
  }
  // Fire pits scale with the level's gap difficulty so easy worlds
  // stay friendly. A single pit per 1500 px even on the gentlest level.
  const fireCount = Math.max(1, Math.floor(level.length / 1500 * level.gaps));
  for (let n = 0; n < fireCount; n++) {
    const cx = 900 + rand() * (level.length - 1500);
    hazards.push({ x: cx, w: 45 + rand() * 30, type: "fire" });
  }

  return { heights, obstacles, collectibles, ramps, checkpoints, props, hazards };
}

export function terrainHeightAt(terrain, x) {
  if (x < 0) return GROUND_BASE;
  const idx = x / TERRAIN_DX;
  const i0 = Math.floor(idx);
  const i1 = i0 + 1;
  if (i1 >= terrain.heights.length) return terrain.heights[terrain.heights.length - 1];
  const t = idx - i0;
  return terrain.heights[i0] * (1 - t) + terrain.heights[i1] * t;
}

export function terrainSlopeAt(terrain, x) {
  const dx = 6;
  const y0 = terrainHeightAt(terrain, x - dx);
  const y1 = terrainHeightAt(terrain, x + dx);
  return Math.atan2(y1 - y0, 2 * dx); // positive = downhill
}

// ---------- src/config/themes.js ----------
// Visual themes — palette + sky/mountain/ground colors per biome.
// Used by world rendering for parallax, atmosphere, color grading.
export const THEMES = {
  day: {
    name: "Day",
    sky: [["#7fbcff", 0], ["#cfe7ff", 0.6], ["#fff4d6", 1]],
    mtnFar:  "#7d8eb0", mtnMid: "#566285", mtnNear: "#3b486a",
    treeFar: "#4f6b3e", treeNear: "#2c4226",
    ground: "#6b421e", grassTop: "#a06a3c", grassTuft: "#7da64a",
    sun: { x: 0.78, y: 0.30, color: "rgba(255, 230, 150, 0.55)", outerColor: "rgba(255, 200, 110, 0.20)", size: 70 },
    propFog: 0.0, stars: 0,
    tint: "rgba(255, 240, 200, 0.06)", rays: 0.18, dark: false,
  },
  sunset: {
    name: "Sunset",
    sky: [["#1d1535", 0], ["#ff6a3a", 0.55], ["#ffce6e", 0.92], ["#ffe6a3", 1]],
    mtnFar:  "#5b3a5c", mtnMid: "#3b2244", mtnNear: "#1f1429",
    treeFar: "#2d1a36", treeNear: "#15081a",
    ground: "#5a2d18", grassTop: "#9a4f24", grassTuft: "#b96b34",
    sun: { x: 0.72, y: 0.55, color: "rgba(255, 150, 80, 0.78)", outerColor: "rgba(255, 90, 50, 0.25)", size: 130 },
    propFog: 0.15, stars: 0,
    tint: "rgba(255, 130, 70, 0.10)", rays: 0.30, dark: false,
  },
  dusk: {
    name: "Dusk",
    sky: [["#0d1226", 0], ["#3a3050", 0.55], ["#5a3340", 1]],
    mtnFar: "#3c364e", mtnMid: "#2a2444", mtnNear: "#1c1a30",
    treeFar: "#1a1426", treeNear: "#0e1a18",
    ground: "#5a3a26", grassTop: "#a06a3c", grassTuft: "#5a4a30",
    sun: { x: 0.78, y: 0.28, color: "rgba(255, 200, 120, 0.45)", outerColor: "rgba(255, 180, 80, 0.22)", size: 130 },
    propFog: 0.2, stars: 30,
    tint: "rgba(140, 110, 200, 0.08)", rays: 0.10, dark: true,
  },
  night: {
    name: "Night",
    sky: [["#02050f", 0], ["#0a1430", 0.55], ["#1a2952", 1]],
    mtnFar: "#13193a", mtnMid: "#0a0f24", mtnNear: "#06091a",
    treeFar: "#070b18", treeNear: "#03050d",
    ground: "#3a2618", grassTop: "#5a3818", grassTuft: "#3a4022",
    sun: { x: 0.20, y: 0.22, color: "rgba(220, 230, 255, 0.85)", outerColor: "rgba(180, 200, 255, 0.20)", size: 60 },
    propFog: 0.25, stars: 100,
    tint: "rgba(40, 70, 160, 0.16)", rays: 0.0, dark: true,
  },
  desert: {
    name: "Desert",
    sky: [["#fdb24a", 0], ["#fde7a4", 0.6], ["#fff4d6", 1]],
    mtnFar: "#caa37a", mtnMid: "#a6764a", mtnNear: "#7a4e2c",
    treeFar: "#7a4e2c", treeNear: "#5a3818",
    ground: "#c9874c", grassTop: "#e0a266", grassTuft: "#a8632a",
    sun: { x: 0.82, y: 0.22, color: "rgba(255, 245, 200, 0.85)", outerColor: "rgba(255, 220, 150, 0.40)", size: 90 },
    propFog: 0.35, stars: 0,
    tint: "rgba(255, 200, 110, 0.10)", rays: 0.40, dark: false,
  },
};

// ---------- src/config/levels.js ----------
// Trail catalog. Each entry sets terrain seed + difficulty knobs (hills,
// gaps), the visual theme, gold/silver/bronze medal time targets, and
// optional flags like lowGravity for special variants.
import { save } from "../engine/save.js";

export const LEVELS = [
  { id: "trail_01", name: "Backyard Trail",  length: 2200, seed: 11,  difficulty: 1, hills: 0.6, gaps: 0.2, theme: "day",
    medals: { gold: 25, silver: 38, bronze: 55 },
    desc: "An easy warm-up loop. Learn the controls." },
  { id: "trail_02", name: "Pine Ridge",      length: 2800, seed: 23,  difficulty: 2, hills: 1.0, gaps: 0.5, theme: "day",
    medals: { gold: 32, silver: 48, bronze: 68 },
    desc: "Rolling hills with the first real ramps.", unlockAfter: "trail_01" },
  { id: "trail_03", name: "Quarry Run",      length: 3400, seed: 47,  difficulty: 3, hills: 1.4, gaps: 0.8, theme: "sunset",
    medals: { gold: 42, silver: 60, bronze: 82 },
    desc: "Wide gaps under sunset glow. Bring boost.", unlockAfter: "trail_02" },
  { id: "trail_04", name: "Dunes",           length: 3000, seed: 71,  difficulty: 3, hills: 2.0, gaps: 0.4, theme: "desert",
    medals: { gold: 38, silver: 54, bronze: 74 },
    desc: "Smooth and rolling. Catch air on every crest.", unlockAfter: "trail_02" },
  { id: "trail_05", name: "Twilight Pass",   length: 3600, seed: 91,  difficulty: 4, hills: 1.4, gaps: 1.0, theme: "dusk",
    medals: { gold: 46, silver: 64, bronze: 88 },
    desc: "Dusk roller doubles and tight gaps. Quick reactions.", unlockAfter: "trail_03" },
  { id: "trail_06", name: "Sunset Ridge",    length: 3200, seed: 113, difficulty: 4, hills: 1.6, gaps: 1.0, theme: "sunset",
    medals: { gold: 42, silver: 58, bronze: 80 },
    desc: "Cresting ridges and long gaps in the sunset light.", unlockAfter: "trail_04" },
  { id: "trail_07", name: "Lunar Loop",      length: 3800, seed: 131, difficulty: 4, hills: 2.4, gaps: 1.2, theme: "night",
    medals: { gold: 52, silver: 70, bronze: 95 },
    desc: "Low gravity. Big floaty jumps under starlight.", unlockAfter: "trail_05", lowGravity: true },
  { id: "trail_08", name: "Canyon Run",      length: 3600, seed: 157, difficulty: 5, hills: 1.8, gaps: 1.6, theme: "desert",
    medals: { gold: 48, silver: 66, bronze: 90 },
    desc: "Long red ridges and yawning gaps. Time it or eat sand.", unlockAfter: "trail_06" },
  { id: "trail_09", name: "Midnight Mile",   length: 4000, seed: 179, difficulty: 5, hills: 1.4, gaps: 1.8, theme: "night",
    medals: { gold: 54, silver: 72, bronze: 98 },
    desc: "Wide gaps in the dark. Pure send.", unlockAfter: "trail_07" },
  { id: "trail_10", name: "Mt. Send-It",     length: 4400, seed: 137, difficulty: 5, hills: 2.4, gaps: 1.4, theme: "dusk",
    medals: { gold: 58, silver: 78, bronze: 105 },
    desc: "Final boss. Big air, big gaps, no margin.", unlockAfter: "trail_08" },
];

export function medalForTime(level, time) {
  if (!level.medals) return null;
  if (time <= level.medals.gold)   return "gold";
  if (time <= level.medals.silver) return "silver";
  if (time <= level.medals.bronze) return "bronze";
  return null;
}
export function medalRank(m) { return m === "gold" ? 3 : m === "silver" ? 2 : m === "bronze" ? 1 : 0; }
export function medalIcon(m) { return m === "gold" ? "🥇" : m === "silver" ? "🥈" : m === "bronze" ? "🥉" : "—"; }

export function levelUnlocked(lvl) {
  if (!lvl.unlockAfter) return true;
  if (save.unlockedLevels[lvl.id]) return true;
  return !!(save.best[lvl.unlockAfter] && save.best[lvl.unlockAfter].completed);
}

// ---------- src/config/stats.js ----------
// Compose the bike's effective stats from equipped parts + the active
// character. Pulls from the live save profile.
import { save } from "../engine/save.js";
import { PARTS, partById } from "./parts.js";
import { characterById } from "./characters.js";

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function getEquippedStats() {
  const base = {
    topSpeed: 60, accel: 1.0, grip: 0.55, suspension: 0.35,
    boostCap: 100, boostRegen: 8, durability: 100, weight: 1.0, paint: "#e94c3a",
  };
  for (const cat of ["engine", "tire", "suspension", "frame", "paint"]) {
    const p = partById(save.equipped[cat]);
    if (!p) continue;
    const s = p.stats;
    if (s.speedBoost) base.topSpeed += s.speedBoost;
    if (s.accel) base.accel = s.accel;
    if (s.grip != null) base.grip = s.grip;
    if (s.suspension != null) base.suspension = s.suspension;
    if (s.boostCap != null) base.boostCap = s.boostCap;
    if (s.boostRegen != null) base.boostRegen = s.boostRegen;
    if (s.durability != null) base.durability = s.durability;
    if (s.weight != null) base.weight = s.weight;
    if (s.paint) base.paint = s.paint;
  }
  // Character modifiers — additive on top of bike parts.
  const ch = characterById(save.equipped.character || "char_declan");
  if (ch) {
    const cs = ch.stats || {};
    if (cs.topSpeed)   base.topSpeed += cs.topSpeed;
    if (cs.accel)      base.accel += cs.accel;
    if (cs.grip)       base.grip = clamp(base.grip + cs.grip, 0.1, 1);
    if (cs.suspension) base.suspension = clamp(base.suspension + cs.suspension, 0.1, 1);
    if (cs.boostRegen) base.boostRegen += cs.boostRegen;
    if (cs.durability) base.durability += cs.durability;
    if (cs.weight)     base.weight = Math.max(0.6, base.weight + cs.weight);
    base.charAccent = ch.accent || "#ffb020";
    base.charBoots = ch.boots || "#0a0a0e";
    base.charName = ch.name;
  }
  return base;
}

// ---------- src/config/parts.js ----------
// Bike part catalog. Each part lives in a category (engine, tire, etc.)
// and carries its stats. Stat semantics:
//   speedBoost (engine):  added top-speed (mph)
//   accel:                acceleration multiplier (1.0 baseline)
//   grip:                 how fast bike conforms to slope (0..1)
//   suspension:           vertical impact absorption (0..1)
//   boostCap:             max boost meter
//   boostRegen:           boost regen / sec
//   durability:           bike health
//   weight:               heavier = slower accel + more stable in air
//   paint:                color string

export const PARTS = {
  engine: [
    { id: "engine_stock",  name: "Stock 125cc",     cost: 0,    desc: "What it came with. Reliable enough.",
      stats: { speedBoost: 0,  accel: 1.0, boostCap: 100, boostRegen: 8 } },
    { id: "engine_250",    name: "Trailshredder 250", cost: 400, desc: "More cubes, more grunt off the line.",
      stats: { speedBoost: 8,  accel: 1.15, boostCap: 110, boostRegen: 10 } },
    { id: "engine_450",    name: "Big Bore 450",    cost: 1100, desc: "Punchy mid-range, eats hills.",
      stats: { speedBoost: 16, accel: 1.30, boostCap: 130, boostRegen: 11 } },
    { id: "engine_turbo",  name: "Turbo 600",       cost: 2400, desc: "Forced induction. Hold on.",
      stats: { speedBoost: 26, accel: 1.45, boostCap: 150, boostRegen: 13 } },
    { id: "engine_nitro",  name: "Nitro Beast",     cost: 5000, desc: "Stupidly fast. Tries to throw you.",
      stats: { speedBoost: 40, accel: 1.65, boostCap: 200, boostRegen: 18 } },
  ],
  tire: [
    { id: "tire_stock",   name: "Hard Compound",   cost: 0,    desc: "Lasts forever, slips a little.",
      stats: { grip: 0.55 } },
    { id: "tire_knobby",  name: "Knobby MX",       cost: 250,  desc: "Bites into dirt. Standard issue.",
      stats: { grip: 0.72 } },
    { id: "tire_mud",     name: "Mud Slingers",    cost: 600,  desc: "Aggressive lugs. Better recovery.",
      stats: { grip: 0.82 } },
    { id: "tire_paddle",  name: "Sand Paddles",    cost: 1300, desc: "Insane grip on every surface, somehow.",
      stats: { grip: 0.92 } },
  ],
  suspension: [
    { id: "suspension_stock", name: "Old Forks",     cost: 0,   desc: "Bouncy. Not in a fun way.",
      stats: { suspension: 0.35 } },
    { id: "suspension_sport", name: "Sport Forks",   cost: 350, desc: "Soaks up small chatter.",
      stats: { suspension: 0.55 } },
    { id: "suspension_long",  name: "Long Travel",   cost: 900, desc: "Eat the big hits.",
      stats: { suspension: 0.75 } },
    { id: "suspension_works", name: "Works Edition", cost: 1900,desc: "Pro-level damping. Stick the landing.",
      stats: { suspension: 0.92 } },
  ],
  frame: [
    { id: "frame_stock",   name: "Steel Frame",     cost: 0,   desc: "Heavy. Tanky.",
      stats: { durability: 100, weight: 1.10 } },
    { id: "frame_alu",     name: "Aluminum Frame",  cost: 500, desc: "Lighter, bit more fragile.",
      stats: { durability: 110, weight: 0.95 } },
    { id: "frame_carbon",  name: "Carbon Fiber",    cost: 1600,desc: "Featherweight, stiff as a board.",
      stats: { durability: 130, weight: 0.80 } },
    { id: "frame_titan",   name: "Titanium Pro",    cost: 3500,desc: "The good stuff. Light AND tough.",
      stats: { durability: 180, weight: 0.85 } },
  ],
  paint: [
    { id: "paint_red",    name: "Factory Red",      cost: 0,   desc: "Classic.",            stats: { paint: "#e94c3a" } },
    { id: "paint_blue",   name: "Cobalt Blue",      cost: 100, desc: "Cool & calm.",        stats: { paint: "#3a7be9" } },
    { id: "paint_black",  name: "Midnight Black",   cost: 150, desc: "Stealth mode.",       stats: { paint: "#1d2030" } },
    { id: "paint_lime",   name: "Acid Lime",        cost: 200, desc: "Look at me.",         stats: { paint: "#c2ff3a" } },
    { id: "paint_gold",   name: "Champion Gold",    cost: 500, desc: "Earned, not bought.", stats: { paint: "#ffc940" } },
  ],
};

export function partById(id) {
  for (const cat of Object.keys(PARTS)) {
    const p = PARTS[cat].find(p => p.id === id);
    if (p) return { ...p, category: cat };
  }
  return null;
}

// ---------- src/config/quests.js ----------
// Lifetime quest catalog. Quests track totals from save.totals or
// per-run "best" metrics stored on the quest itself, and pay out cash
// automatically when their target is reached.
import { save, persistSave } from "../engine/save.js";
import { LEVELS } from "./levels.js";
import { pushToast } from "../engine/juice.js";

export const QUESTS = [
  { id: "q_first_run",    name: "First Run",        desc: "Complete any trail.",                      target: 1,             metric: "completions",     reward: 100 },
  { id: "q_distance_1",   name: "Long Hauler",      desc: "Cover 5 km total distance.",               target: 5000,          metric: "distance",        reward: 200 },
  { id: "q_distance_2",   name: "Cross-Country",    desc: "Cover 25 km total.",                       target: 25000,         metric: "distance",        reward: 800 },
  { id: "q_flips_1",      name: "Backflipper",      desc: "Land 5 flips total.",                      target: 5,             metric: "flips",           reward: 150 },
  { id: "q_flips_2",      name: "Trick Master",     desc: "Land 50 flips total.",                     target: 50,            metric: "flips",           reward: 600 },
  { id: "q_air_1",        name: "Bird Brain",       desc: "Rack up 60 seconds of air time.",          target: 60,            metric: "airtime",         reward: 250 },
  { id: "q_combo_1",      name: "Combo Cook",       desc: "Hit a 5x combo in a single run.",          target: 5,             metric: "maxCombo",        reward: 300 },
  { id: "q_combo_2",      name: "Combo Chef",       desc: "Hit a 10x combo in a single run.",         target: 10,            metric: "maxCombo",        reward: 800 },
  { id: "q_clean_1",      name: "Stick the Landing",desc: "Stick 25 clean landings.",                 target: 25,            metric: "cleanLandings",   reward: 250 },
  { id: "q_perfect",      name: "Perfectionist",    desc: "Nail 10 perfect landings (within 3°).",    target: 10,            metric: "perfectLandings", reward: 500 },
  { id: "q_jumps",        name: "Send It",          desc: "Catch 50 jumps total.",                    target: 50,            metric: "jumps",           reward: 350 },
  { id: "q_crashes",      name: "Tough Skin",       desc: "Survive 10 crashes. Painful but fair.",    target: 10,            metric: "crashes",         reward: 200 },
  { id: "q_complete_3",   name: "Trail Boss",       desc: "Complete 3 different trails.",             target: 3,             metric: "uniqueTrails",    reward: 600 },
  { id: "q_complete_all", name: "Excite Champion",  desc: "Complete every trail.",                    target: LEVELS.length, metric: "uniqueTrails",    reward: 1500 },
  { id: "q_speed_1",      name: "Need for Speed",   desc: "Hit 80 mph in a single run.",              target: 80,            metric: "topSpeed",        reward: 300 },
  { id: "q_speed_2",      name: "Ludicrous Speed",  desc: "Hit 110 mph in a single run.",             target: 110,           metric: "topSpeed",        reward: 700 },
  { id: "q_gem",          name: "Gem Collector",    desc: "Collect 20 gems total.",                   target: 20,            metric: "gemsTotal",       reward: 400 },
  { id: "q_air_2",        name: "Skydiver",         desc: "Rack up 5 minutes of air time total.",     target: 300,           metric: "airtime",         reward: 700 },
  { id: "q_air_single",   name: "Hang Time",        desc: "Get 5s of airtime on one jump.",           target: 5,             metric: "longestAir",      reward: 350 },
  { id: "q_no_crash",     name: "Clean Run",        desc: "Finish any trail without crashing.",       target: 1,             metric: "cleanRuns",       reward: 500 },
  { id: "q_perfect_3",    name: "Stick Three",      desc: "Three perfect landings in one run.",       target: 3,             metric: "runPerfects",     reward: 400 },
  { id: "q_runs",         name: "Frequent Flyer",   desc: "Finish 25 runs.",                          target: 25,            metric: "runs",            reward: 500 },
];

export function getQuestProgress(q) {
  const t = save.totals;
  switch (q.metric) {
    case "distance":         return Math.floor(t.distance);
    case "flips":            return t.flips;
    case "airtime":          return Math.floor(t.airtime);
    case "cleanLandings":    return t.cleanLandings;
    case "perfectLandings":  return t.perfectLandings;
    case "jumps":            return t.jumps;
    case "crashes":          return t.crashes;
    case "runs":             return t.runs || 0;
    case "completions":      return Object.values(save.best).filter(b => b.completed).length;
    case "uniqueTrails":     return Object.values(save.best).filter(b => b.completed).length;
    case "gemsTotal":        return t.gems || 0;
    case "cleanRuns":        return t.cleanRuns || 0;
    case "maxCombo":
    case "topSpeed":
    case "longestAir":
    case "runPerfects":
      return save.quests[q.id]?.progress || 0;
    default: return 0;
  }
}

export function refreshQuestStates(runStats = null) {
  const perRunMetrics = ["maxCombo", "topSpeed", "longestAir", "runPerfects"];
  for (const q of QUESTS) {
    const state = save.quests[q.id] || (save.quests[q.id] = { progress: 0, done: false, claimed: false });
    if (perRunMetrics.includes(q.metric) && runStats) {
      const v = runStats[q.metric];
      if (typeof v === "number" && v > state.progress) state.progress = v;
    }
    const prog = getQuestProgress(q);
    if (!state.done && prog >= q.target) {
      state.done = true;
      pushToast(`Quest done: ${q.name}`, "gold");
    }
  }
  for (const q of QUESTS) {
    const s = save.quests[q.id];
    if (s.done && !s.claimed) {
      save.cash += q.reward;
      s.claimed = true;
      pushToast(`+$${q.reward} — ${q.name}`, "green");
    }
  }
  persistSave();
}

// ---------- src/config/characters.js ----------
// Selectable rider characters. Each one carries a stat delta on top of
// whatever the bike parts provide, plus a visual accent (jacket stripe)
// and boot color used by the bike renderer.
export const CHARACTERS = [
  { id: "char_declan", name: "Declan",  cost: 0,    desc: "All-around. Reliable.",
    stats: {}, accent: "#ffb020", boots: "#0a0a0e" },
  { id: "char_maya",   name: "Maya",    cost: 600,  desc: "Lightweight speedster. Fast but fragile.",
    stats: { topSpeed: 8, accel: 0.08, durability: -25 }, accent: "#ff5a3a", boots: "#1d2030" },
  { id: "char_brick",  name: "Brick",   cost: 800,  desc: "Heavy. Tank-spec. Slower off the line.",
    stats: { durability: 50, weight: 0.10, accel: -0.05 }, accent: "#888", boots: "#3a3a3a" },
  { id: "char_pixie",  name: "Pixie",   cost: 1200, desc: "Acrobat. Spins fast, lands soft.",
    stats: { weight: -0.18, suspension: 0.10 }, accent: "#c2ff3a", boots: "#0a0a0e" },
  { id: "char_ace",    name: "Ace",     cost: 1800, desc: "Pro rider. Boost regen + grip bonus.",
    stats: { boostRegen: 4, grip: 0.06 }, accent: "#6ee7ff", boots: "#1a1a1a" },
];

export function characterById(id) { return CHARACTERS.find(c => c.id === id); }

// ---------- src/main.js (bike portion, lines 1-2517) ----------
// Game runtime entry. Imports the modular engine + config layers and
// ties together the bike physics, world rendering, UI flow, mini-games,
// and the main loop. Future rounds will keep splitting the chunks below
// (BIKE PHYSICS, RENDERING, UI, MINI-GAMES, LOOP) into their own modules
// under src/bike, src/world, src/ui, src/minigames respectively.
//
// What's already extracted:
//   src/engine/save.js       — profile + localStorage
//   src/engine/audio.js      — Sound (Web Audio + procedural music)
//   src/engine/canvas.js     — canvas, ctx, W/H, DPR, viewport, resize
//   src/engine/input.js      — keys + touch button wiring + input()
//   src/engine/rng.js        — mulberry32
//   src/engine/juice.js      — particles, toasts, floating texts
//   src/world/terrain.js     — buildTerrain + heightAt/slopeAt
//   src/state.js             — STATE enum + G mutable container
//   src/config/*             — parts, characters, themes, levels, quests, stats

import { save, persistSave, resetSave, DEFAULT_SAVE } from "./engine/save.js";
import { PARTS, partById } from "./config/parts.js";
import { CHARACTERS, characterById } from "./config/characters.js";
import { getEquippedStats } from "./config/stats.js";
import { THEMES } from "./config/themes.js";
import { LEVELS, medalForTime, medalRank, medalIcon, levelUnlocked } from "./config/levels.js";
import { QUESTS, getQuestProgress, refreshQuestStates } from "./config/quests.js";
import { canvas, ctx, W, H, DPR, WORLD_ZOOM, VW, VH, updateViewport, resizeCanvas, clamp, lerp, wrapAngle } from "./engine/canvas.js";
import { Sound } from "./engine/audio.js";
import { keys, justPressed, input, setupTouchControls } from "./engine/input.js";
import { mulberry32 } from "./engine/rng.js";
import { buildTerrain, terrainHeightAt, terrainSlopeAt, TERRAIN_DX, GROUND_BASE } from "./world/terrain.js";
import { STATE, G } from "./state.js";
import { CAN_LEVELS, buildCans, starsFor, levelById as canLevelById, isLevelUnlocked as isCanLevelUnlocked, CAN_TYPE_INFO, POWER_INFO } from "./games/canBash/levels.js";
import { FG_LEVELS, FG_CONDITION_INFO, FG_POWERUP_INFO, starsFor as fgStarsFor, levelById as fgLevelById, isLevelUnlocked as isFgLevelUnlocked } from "./games/fieldGoal/levels.js";
import { PP_LEVELS, buildCups as ppBuildCups, starsFor as ppStarsFor, levelById as ppLevelById, isLevelUnlocked as isPpLevelUnlocked } from "./games/partyPong/levels.js";
import {
  pushToast, pushFloating,
  spawnExhaustParticles, spawnSmashParticles, spawnLandingDust, spawnCrashParticles,
  _setTerrainHeightFn,
} from "./engine/juice.js";

// Wire the late-bound terrain helper into juice.js so spawnLandingDust
// can sample the ground at the bike's position.
_setTerrainHeightFn(terrainHeightAt);

/* Declan Bike — Excite Trails
 * Single-file dirt bike side-scroller with bike-builder, upgrades, and side quests.
 * No external libraries.
 */

// Silent error stub — kept around so existing window.__diag() calls below
// remain harmless. Real errors still go to the console; we just don't draw
// a banner over the menu anymore.
window.__diag = function () {};

// Polyfill structuredClone for older iOS / Safari builds. Without this the
// script throws on the very first load and nothing else runs.
if (typeof structuredClone === "undefined") {
  window.structuredClone = function (obj) {
    return JSON.parse(JSON.stringify(obj));
  };
  window.__diag && window.__diag("[boot] structuredClone polyfilled");
} else {
  window.__diag && window.__diag("[boot] structuredClone native");
}

function startRun(levelId) {
  const level = LEVELS.find(l => l.id === levelId);
  if (!level) return;
  const terrain = buildTerrain(level);
  const stats = getEquippedStats();
  const startX = 120;
  const startY = terrainHeightAt(terrain, startX);
  G.runtime = {
    level, terrain, stats,
    bike: {
      x: startX, y: startY, vx: 80, vy: 0,
      angle: 0, angVel: 0,
      wheelAngle: 0,
      landSquash: 0,
      boostingPrev: false,
      onGround: true,
      airtime: 0,
      lastGroundedAt: performance.now(),
      currentFlipRot: 0,
      airTrick: { tuck: 0, superman: 0, noHand: 0 },
      oilTime: 0,
      tireTrail: [], // recent ground positions for trail rendering
      // Wheelie / stoppie hold state — `time` is the accumulated seconds
      // of the current trick, `dir` is -1 (wheelie) or +1 (stoppie).
      wheelie: { time: 0, dir: 0 },
      health: stats.durability,
      boost: stats.boostCap,
      throttleHeat: 0,
      crashed: false,
      crashTimer: 0,
      finished: false,
    },
    cam: { x: 0, y: 0 },
    time: 0,
    score: 0,
    cashEarned: 0,
    combo: 1,
    comboTimer: 0,
    distance: 0,
    particles: [],
    floatingTexts: [],
    runStats: { flips: 0, airtime: 0, jumps: 0, cleanLandings: 0, perfectLandings: 0, crashes: 0, maxCombo: 1, collectibles: 0, gems: 0, topSpeed: 0, longestAir: 0, runPerfects: 0 },
    finishLineX: level.length - 60,
    paused: false,
    finishedAt: null,
    shake: { mag: 0 },
    gravityScale: level.lowGravity ? 0.55 : 1.0,
    countdown: 3.0,        // 3 → 2 → 1 → GO! before input is accepted
    countdownLastTick: 4,  // last whole second we played a beep for
    powerup: null,         // { type: "star"|"shield"|"magnet", time: 5 }
  };
  G.state = STATE.PLAY;
  showOnly("hud");
  Sound.ensure();
  Sound.startEngine();
  Sound.startMusic("game");
  // First-run tutorials.
  setTimeout(() => maybeTutorial("welcome", "Throttle ▶ to ride.  Brake ◀.  Tap ⤴ to jump."), 500);
  setTimeout(() => maybeTutorial("flip", "In the air, hold ↻ to flip.  Land smooth for combos."), 4500);
  setTimeout(() => maybeTutorial("boost", "Hit ⚡ to boost.  Watch your meter."), 9500);
  setTimeout(() => maybeTutorial("hazards", "Watch out — fire pits crash you, oil slicks make you slide."), 14500);
}

function maybeTutorial(id, text) {
  if (G.state !== STATE.PLAY || !G.runtime) return;
  if (save.tutorialsSeen?.[id]) return;
  if (!save.tutorialsSeen) save.tutorialsSeen = {};
  save.tutorialsSeen[id] = true;
  persistSave();
  pushToast(text, "gold", 3500);
}

//==========================================================
// PHYSICS
//==========================================================
const GRAVITY = 1100;             // px/s^2
const TOP_SPEED_PX = (mph) => mph * 6;  // arbitrary mapping for visual speed
const FRICTION_GROUND = 0.998;
const FRICTION_AIR = 0.9995;

function updateBike(dt) {
  const r = G.runtime;
  const b = r.bike;
  if (b.crashed) {
    b.crashTimer -= dt;
    if (b.crashTimer <= 0) {
      // respawn at last checkpoint
      const cps = r.terrain.checkpoints;
      let cp = null;
      for (const c of cps) { if (c.x < b.x - 40) cp = c; }
      const sx = cp ? cp.x : 120;
      b.x = sx;
      b.y = terrainHeightAt(r.terrain, sx) - 30;
      b.vx = 60; b.vy = 0; b.angle = 0; b.angVel = 0;
      b.crashed = false;
      b.airtime = 0;
      b.currentFlipRot = 0;
      if (b.wheelie) { b.wheelie.time = 0; b.wheelie.dir = 0; }
      b.health = Math.max(b.health, r.stats.durability * 0.4);
      r.combo = 1;
    }
    return;
  }
  if (b.finished) return;

  const inp = input();
  const stats = r.stats;
  const topSpeed = TOP_SPEED_PX(stats.topSpeed);

  // Sample ground at front and rear wheels
  const wheelOffset = 22;
  const rxL = b.x - Math.cos(b.angle) * wheelOffset;
  const ryL = b.y - Math.sin(b.angle) * wheelOffset;
  const rxR = b.x + Math.cos(b.angle) * wheelOffset;
  const ryR = b.y - Math.sin(b.angle) * wheelOffset;
  const groundL = terrainHeightAt(r.terrain, rxL);
  const groundR = terrainHeightAt(r.terrain, rxR);
  const wheelGroundL = ryL >= groundL - 1;
  const wheelGroundR = ryR >= groundR - 1;
  const slopeAngle = terrainSlopeAt(r.terrain, b.x);
  const groundY = terrainHeightAt(r.terrain, b.x);
  let onGround = (b.y >= groundY - 4);

  // Explicit jump action: tap Shift (or on-screen jump button) while grounded.
  const jumpPressed = justPressed.has("ShiftLeft") || justPressed.has("ShiftRight");
  if (jumpPressed && onGround && !b.crashed && !b.finished) {
    b.y -= 8;
    b.vy = -480;
    b.airtime = 0;
    b.currentFlipRot = 0;
    b.airTrick = { tuck: 0, superman: 0, noHand: 0 };
    b.onGround = false;
    onGround = false; // skip the on-ground branch this frame so vy survives
    r.runStats.jumps++;
    Sound.jump();
    pushToast("Jump!", "gold", 600);
  } else if (onGround && !b.onGround) {
    // landing event
    handleLanding(slopeAngle);
  } else if (!onGround && b.onGround) {
    // takeoff event (off a crest/ramp without jumping)
    b.airtime = 0;
    b.currentFlipRot = 0;
    b.airTrick = { tuck: 0, superman: 0, noHand: 0 };
    r.runStats.jumps++;
    pushToast("Air!", "gold", 800);
  }
  if (!jumpPressed) b.onGround = onGround;

  if (onGround) {
    // Wheelie / stoppie detection: hold throttle + back lean for wheelie,
    // brake + forward lean for stoppie. Builds a continuous bonus.
    const wantsWheelie = inp.throttle && inp.leanBack && Math.abs(b.vx) > 60;
    const wantsStoppie = inp.brake    && inp.leanFwd  && Math.abs(b.vx) > 80;
    if (wantsWheelie)      { b.wheelie.time += dt; b.wheelie.dir = -1; }
    else if (wantsStoppie) { b.wheelie.time += dt; b.wheelie.dir = +1; }
    else if (b.wheelie.time > 0) {
      // Released — bank score if held long enough.
      if (b.wheelie.time > 0.4) {
        const sec = Math.min(8, b.wheelie.time);
        const bonus = Math.floor(sec * 60);
        const name = b.wheelie.dir < 0 ? "Wheelie" : "Stoppie";
        r.score += bonus;
        r.cashEarned += Math.floor(bonus * 0.05);
        pushFloating(`${name} +${bonus}`, b.x, b.y - 36, "#ffb020");
        if (sec > 1.5) {
          r.combo = Math.min(10, r.combo + 1);
          r.comboTimer = Math.max(r.comboTimer, 3);
        }
      }
      b.wheelie.time = 0; b.wheelie.dir = 0;
    }

    // align to slope smoothly
    const target = slopeAngle;
    const angleDiff = wrapAngle(target - b.angle);
    // grip controls how quickly the bike stabilizes
    b.angle += clamp(angleDiff, -dt * (4 + stats.grip * 6), dt * (4 + stats.grip * 6));
    b.angVel = 0;

    // throttle
    let thrust = 0;
    // Throttle: ramps up over the first ~0.4s of holding so it feels
    // mechanical rather than flicking on/off.
    if (inp.throttle) {
      b.throttleHold = Math.min(1, (b.throttleHold || 0) + dt * 2.5);
      thrust = 950 * stats.accel / stats.weight * (0.45 + 0.55 * b.throttleHold);
    } else {
      b.throttleHold = Math.max(0, (b.throttleHold || 0) - dt * 5);
    }
    if (inp.brake) thrust = -700;
    // boost
    const boosting = inp.boost && b.boost > 1 && (inp.throttle || b.vx > 50);
    if (boosting) {
      thrust += 700;
      b.boost = Math.max(0, b.boost - 35 * dt);
      spawnExhaustParticles(true);
      if (!b.boostingPrev) Sound.boostHit();
    } else {
      b.boost = Math.min(stats.boostCap, b.boost + stats.boostRegen * dt);
    }
    b.boostingPrev = boosting;
    // Apply thrust along ground (horizontal component) plus gravity-along-slope.
    b.vx += Math.cos(slopeAngle) * thrust * dt;
    // Downhill slope (positive angle in screen coords) gives a free push; uphill resists.
    b.vx += Math.sin(slopeAngle) * 380 * dt;

    // Cap top speed (along velocity direction)
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > topSpeed) {
      const k = topSpeed / sp;
      b.vx *= k; b.vy *= k;
    }
    // friction
    b.vx *= Math.pow(FRICTION_GROUND, dt * 60);
    if (!inp.throttle && !inp.brake) b.vx *= Math.pow(0.997, dt * 60);

    // glue to terrain
    b.vy = 0;
    // Move x first
    b.x += b.vx * dt;
    const newGround = terrainHeightAt(r.terrain, b.x);
    b.y = newGround;

    // crest detection: if terrain drops away ahead and we're moving fast, launch.
    if (b.x > 0 && b.vx > 0) {
      const ahead = terrainHeightAt(r.terrain, b.x + Math.max(20, b.vx * 0.05));
      const drop = ahead - b.y;
      if (drop > 10 && b.vx > 200) {
        b.onGround = false;
        b.y -= 6;
        b.vy = -Math.min(b.vx * 0.28, 320);
        b.airtime = 0;
        b.currentFlipRot = 0;
        r.runStats.jumps++;
      }
    }

    // engine hum heat
    b.throttleHeat = clamp(b.throttleHeat + (inp.throttle ? dt * 1.5 : -dt * 1.0), 0, 1);
    // exhaust particles when throttling
    if (inp.throttle && Math.random() < 0.35) spawnExhaustParticles(false);

    // tire trail — sample rear wheel position
    if (Math.abs(b.vx) > 60) {
      const rx = b.x - Math.cos(b.angle) * 22;
      const ry = b.y - Math.sin(b.angle) * 22;
      b.tireTrail.push({ x: rx, y: ry, life: 1.5 });
      if (b.tireTrail.length > 80) b.tireTrail.shift();
    }
  } else {
    // air
    b.airtime += dt;
    r.runStats.airtime += dt;
    // gravity
    b.vy += GRAVITY * (r.gravityScale || 1.0) * dt;
    // boost in air slightly extends jumps
    if (inp.boost && b.boost > 1) {
      const dir = b.vx >= 0 ? 1 : -1;
      b.vx += dir * 350 * dt;
      b.vy -= 140 * dt;
      b.boost = Math.max(0, b.boost - 35 * dt);
      spawnExhaustParticles(true);
    }
    // Rotation control. Up/Down (or W/S) always rotate. Throttle/brake also
    // rotate after ~0.25s of air, so small hops over bumps while just driving
    // don't accidentally pitch the bike off and crash the landing.
    const rotForce = 13.0 / stats.weight;
    const paddleEngaged = b.airtime > 0.25;
    const rotFwd  = inp.leanFwd  || (paddleEngaged && inp.throttle);
    const rotBack = inp.leanBack || (paddleEngaged && inp.brake);
    if (rotFwd)  b.angVel += rotForce * dt;
    if (rotBack) b.angVel -= rotForce * dt;
    // Self-leveling: when no rotation input is held and we're past the
    // initial paddle delay, gently pull the bike back toward level so a
    // small bump doesn't end with a crash.
    if (!rotFwd && !rotBack && b.airtime > 0.15) {
      const target = terrainSlopeAt(r.terrain, b.x);
      const diff = wrapAngle(target - b.angle);
      b.angVel += diff * 4.0 * dt;
    }
    b.angVel *= Math.pow(0.992, dt * 60);
    b.angle += b.angVel * dt;
    b.currentFlipRot += b.angVel * dt;

    // Trick detection: track time spent holding specific input combos in air.
    if (!b.airTrick) b.airTrick = { tuck: 0, superman: 0, noHand: 0 };
    if (rotFwd && rotBack)                       b.airTrick.tuck += dt;
    else if (inp.boost && !rotFwd && !rotBack)   b.airTrick.superman += dt;
    else if (!rotFwd && !rotBack && !inp.boost)  b.airTrick.noHand += dt;

    // simple air drag
    b.vx *= Math.pow(FRICTION_AIR, dt * 60);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  // wheel spin: 13px radius wheel, angular vel = vx / r
  b.wheelAngle = (b.wheelAngle + (b.vx / 13) * dt) % (Math.PI * 2);
  // landing squash decays
  if (b.landSquash > 0) b.landSquash = Math.max(0, b.landSquash - dt * 4);

  // Track per-run bests for quest metrics
  const speedMph = Math.abs(b.vx) / 6;
  if (speedMph > r.runStats.topSpeed) r.runStats.topSpeed = speedMph;
  if (!b.onGround && b.airtime > r.runStats.longestAir) r.runStats.longestAir = b.airtime;

  // boundary
  if (b.x < 20) { b.x = 20; b.vx = Math.max(0, b.vx); }
  if (b.x >= r.finishLineX) {
    b.finished = true;
    finishRun();
    return;
  }

  // distance accumulate
  r.distance = Math.max(r.distance, b.x);
  // Combo timer
  r.comboTimer -= dt;
  if (r.comboTimer <= 0 && r.combo > 1) r.combo = 1;

  // Obstacle collision. Soft props (cone/tire) just slow you and spark.
  // Hard props (rock/log) crash you UNLESS you're committed (fast + level
  // angle), in which case you smash through with a score bonus.
  for (const obs of r.terrain.obstacles) {
    if (obs.hit) continue;
    const dx = b.x - obs.x;
    const dy = b.y - obs.y;
    const d2 = dx*dx + dy*dy;
    if (d2 >= (obs.r + 16) * (obs.r + 16)) continue;
    obs.hit = true;
    const speed = Math.abs(b.vx);
    const slopeNow = terrainSlopeAt(r.terrain, b.x);
    const angOk = Math.abs(wrapAngle(b.angle - slopeNow)) < 0.6; // ~34°
    const isSoft = obs.type === "tire";
    if (isSoft || (speed > 200 && angOk)) {
      // Smash / plow through — keep going.
      const reward = isSoft ? 25 : 60;
      r.score += reward;
      r.cashEarned += Math.floor(reward * 0.1);
      b.health = Math.max(0, b.health - (isSoft ? 4 : 12));
      b.vx *= isSoft ? 0.92 : 0.78;
      pushFloating(`SMASH +${reward}`, obs.x, obs.y - 30, "#ffb020");
      Sound.boostHit && Sound.boostHit();
      if (r.shake) r.shake.mag = Math.max(r.shake.mag, isSoft ? 4 : 8);
      spawnSmashParticles(obs.x, obs.y, obs.type);
      // health depletion still ends the run via wipeout.
      if (b.health <= 0 && !b.finished) {
        b.finished = true;
        setTimeout(() => wipeoutRun(), 600);
      }
    } else {
      crash(`Hit a ${obs.type}!`);
      return;
    }
  }

  // hazard collision (oil, mud, fire, spring) — terrain-aligned strips.
  if (b.oilTime > 0) b.oilTime = Math.max(0, b.oilTime - dt);
  for (const hz of r.terrain.hazards || []) {
    if (b.x < hz.x || b.x > hz.x + hz.w) continue;
    if (hz.type === "fire" && !b.crashed) {
      crash("Fire pit!");
      return;
    }
    if (hz.type === "spring" && b.onGround && !hz.fired) {
      hz.fired = true;
      b.y -= 8;
      b.vy = -680;
      b.vx += 60;
      b.onGround = false;
      b.airtime = 0;
      b.currentFlipRot = 0;
      r.runStats.jumps++;
      Sound.jump();
      pushToast("BOING!", "gold", 700);
      pushFloating("BOING!", b.x, b.y - 30, "#4ddc8c");
    }
    if (hz.type === "oil" && b.onGround) {
      b.oilTime = 1.0;
    }
    if (hz.type === "mud" && b.onGround) {
      b.vx *= Math.pow(0.92, dt * 60);
    }
  }
  // Oil residual: induce tiny wobble in body angle while sliding
  if (b.oilTime > 0 && b.onGround) {
    b.angle += (Math.random() - 0.5) * 0.06;
  }
  // collectibles
  // Magnet: pull eligible collectibles toward the bike.
  const magnetActive = r.powerup && r.powerup.type === "magnet" && r.powerup.time > 0;
  for (const c of r.terrain.collectibles) {
    if (c.taken) continue;
    let dx = b.x - c.x;
    let dy = b.y - c.y;
    if (magnetActive && (c.type === "bolt" || c.type === "gem")) {
      const d2 = dx*dx + dy*dy;
      if (d2 < 220 * 220) {
        const d = Math.sqrt(d2) || 1;
        c.x += (dx / d) * 360 * dt;
        c.y += (dy / d) * 360 * dt;
        dx = b.x - c.x; dy = b.y - c.y;
      }
    }
    const radius = (c.type === "star" || c.type === "shield" || c.type === "magnet") ? 36 : 30;
    if (dx*dx + dy*dy < radius*radius) {
      c.taken = true;
      if (c.type === "gem") {
        r.cashEarned += 50; r.score += 250; r.runStats.gems++;
        pushFloating("+$50", c.x, c.y, "#6ee7ff"); Sound.gem();
      } else if (c.type === "bolt") {
        r.cashEarned += 5; r.score += 25; r.runStats.collectibles++;
        pushFloating("+$5", c.x, c.y, "#ffc940"); Sound.pickup();
      } else if (c.type === "star") {
        r.powerup = { type: "star", time: 5 };
        r.score += 50;
        pushFloating("STAR!", c.x, c.y, "#ffe680");
        pushToast("Invincibility 5s", "gold", 1100);
        Sound.perfect && Sound.perfect();
      } else if (c.type === "shield") {
        // Persistent — added to bike. If a shield is already active, refresh.
        b.hasShield = true;
        r.score += 30;
        pushFloating("SHIELD!", c.x, c.y, "#6ee7ff");
        pushToast("Shield ready (one free crash)", "green", 1200);
        Sound.gem && Sound.gem();
      } else if (c.type === "magnet") {
        r.powerup = { type: "magnet", time: 5 };
        r.score += 30;
        pushFloating("MAGNET!", c.x, c.y, "#c2ff3a");
        pushToast("Magnet 5s — coins fly to you", "green", 1100);
        Sound.gem && Sound.gem();
      }
    }
  }
}

function handleLanding(slopeAngle) {
  const r = G.runtime;
  const b = r.bike;
  const angDiff = Math.abs(wrapAngle(b.angle - slopeAngle));
  const angDiffDeg = angDiff * 180 / Math.PI;

  const flips = Math.round(b.currentFlipRot / (Math.PI * 2));
  const absFlips = Math.abs(flips);

  // Tolerance bands:
  //   < 6°   : Perfect — bonus + cash + sfx
  //   < 35°  : Clean — small bonus
  //   < 65°  : Save — auto-correct angle, no bonus, no crash
  //   ≥ 65°  : Bail — crash
  const PERFECT = 6, CLEAN = 35, SAVE = 65;

  if (angDiffDeg < CLEAN) {
    let bonus = 0;
    let label = "Clean!";
    if (angDiffDeg < PERFECT) {
      label = "Perfect!"; bonus += 100;
      r.runStats.perfectLandings++;
      save.totals.perfectLandings++;
      Sound.perfect();
      if (r.shake) r.shake.mag = Math.max(r.shake.mag, 5);
    } else {
      bonus += 30;
      Sound.land();
    }
    r.runStats.cleanLandings++;
    save.totals.cleanLandings++;

    if (absFlips > 0) {
      const flipBonus = absFlips * 200 * r.combo;
      bonus += flipBonus;
      r.combo = Math.min(10, r.combo + absFlips);
      r.comboTimer = 4;
      r.runStats.flips += absFlips;
      save.totals.flips += absFlips;
      pushToast(`${absFlips}x ${flips > 0 ? "Front" : "Back"}flip! +${flipBonus} (x${r.combo})`, "gold", 1400);
      Sound.flip(Math.min(4, absFlips + 1));
    } else {
      pushToast(label, "green", 800);
    }

    // Air-trick bonuses (independent of flip count). Awarded if held >0.4s.
    const at = b.airTrick || {};
    let trickName = null, trickBonus = 0;
    if (at.tuck > 0.4)         { trickName = "Tuck";     trickBonus = 150; }
    if (at.superman > at.tuck && at.superman > 0.4) { trickName = "Superman"; trickBonus = 250; }
    if (at.noHand > Math.max(at.tuck, at.superman) && at.noHand > 0.4) {
      trickName = "No-Hander"; trickBonus = 200;
    }
    if (trickName) {
      bonus += trickBonus;
      pushToast(`${trickName}! +${trickBonus}`, "gold", 1100);
    }

    if (r.combo > r.runStats.maxCombo) r.runStats.maxCombo = r.combo;
    r.score += bonus;
    r.cashEarned += Math.floor(bonus * 0.05);
    pushFloating(`+${bonus}`, b.x, b.y - 30, "#ffb020");
    b.angle = slopeAngle;
    b.angVel = 0;

    const absorb = r.stats.suspension;
    b.landSquash = clamp(Math.abs(b.vy) / 700, 0, 1) * (1 - absorb * 0.7);
    b.vy *= (1 - absorb) * 0.4;
    spawnLandingDust(Math.max(0.5, b.landSquash * 1.2));
  } else if (angDiffDeg < SAVE) {
    // Sketchy save — don't crash, but punish: lose combo, no bonus, big squash.
    pushToast("Save!", "gold", 700);
    r.combo = 1; r.comboTimer = 0;
    b.angle = slopeAngle;
    b.angVel = 0;
    b.vx *= 0.6;
    b.vy *= 0.2;
    b.landSquash = 1;
    Sound.land();
    spawnLandingDust(1.0);
  } else {
    crash("Bailed!");
  }
  b.currentFlipRot = 0;
}

function crash(reason) {
  const r = G.runtime;
  const b = r.bike;
  if (b.crashed) return;
  // Star = invincibility, walks through everything.
  if (r.powerup && r.powerup.type === "star" && r.powerup.time > 0) {
    pushFloating("BLOCKED!", b.x, b.y - 30, "#ffe680");
    return;
  }
  // Shield absorbs one crash and is consumed.
  if (b.hasShield) {
    b.hasShield = false;
    pushFloating("SHIELDED!", b.x, b.y - 30, "#6ee7ff");
    pushToast("Shield broken", "gold", 800);
    Sound.boostHit && Sound.boostHit();
    if (r.shake) r.shake.mag = Math.max(r.shake.mag, 6);
    return;
  }
  b.crashed = true;
  b.crashTimer = 1.4;
  b.vx *= -0.2;
  b.vy = -200;
  b.angVel = (Math.random() - 0.5) * 12;
  b.health = Math.max(0, b.health - 25);
  r.combo = 1;
  r.comboTimer = 0;
  r.runStats.crashes++;
  save.totals.crashes++;
  spawnCrashParticles();
  pushToast(reason, "red", 1100);
  Sound.crash();
  if (r.shake) r.shake.mag = 14;
  // Wipeout: health depleted, end the run as failure.
  if (b.health <= 0 && !b.finished) {
    b.finished = true;
    b.crashTimer = 2.0;
    setTimeout(() => wipeoutRun(), 1100);
  }
}

function wipeoutRun() {
  if (!G.runtime) return;
  const r = G.runtime;
  const earned = Math.floor(r.cashEarned * 0.4);
  save.cash += earned;
  save.totals.runs += 1;
  save.totals.airtime += r.runStats.airtime;
  save.totals.jumps += r.runStats.jumps;
  save.totals.gems = (save.totals.gems || 0) + r.runStats.gems;
  refreshQuestStates(r.runStats);
  persistSave();
  Sound.stopEngine();
  showResult(false, { wipeoutEarned: earned, wipeout: true });
}

function finishRun() {
  const r = G.runtime;
  // Score finalization
  const distM = Math.floor(r.distance / 10);
  const timeBonus = Math.max(0, Math.floor(800 - r.time * 12));
  const distBonus = distM * 2;
  const cashFromScore = Math.floor((r.score) * 0.05);
  r.cashEarned += cashFromScore + timeBonus + Math.floor(distBonus * 0.5);
  save.cash += r.cashEarned;
  save.totals.distance += distM;
  save.totals.runs += 1;
  save.totals.airtime += r.runStats.airtime;
  save.totals.jumps += r.runStats.jumps;
  save.totals.gems = (save.totals.gems || 0) + r.runStats.gems;
  if (r.runStats.crashes === 0) save.totals.cleanRuns = (save.totals.cleanRuns || 0) + 1;
  r.runStats.runPerfects = r.runStats.perfectLandings;

  const lvl = r.level;
  const prev = save.best[lvl.id] || { score: 0, time: Infinity, distance: 0, completed: false, medal: null };
  const newTime = Math.min(prev.time, r.time);
  const newMedal = medalForTime(lvl, newTime);
  if (newMedal && medalRank(newMedal) > medalRank(prev.medal)) {
    pushToast(`${medalIcon(newMedal)} ${newMedal.toUpperCase()} medal!`, "gold", 1800);
    r.cashEarned += newMedal === "gold" ? 500 : newMedal === "silver" ? 300 : 150;
  }
  save.best[lvl.id] = {
    completed: true,
    score: Math.max(prev.score, r.score + (timeBonus + distBonus)),
    time: newTime,
    distance: Math.max(prev.distance, distM),
    medal: newMedal && medalRank(newMedal) > medalRank(prev.medal) ? newMedal : prev.medal,
  };
  // unlock next levels
  for (const L of LEVELS) {
    if (L.unlockAfter === lvl.id) save.unlockedLevels[L.id] = true;
  }

  refreshQuestStates(r.runStats);
  persistSave();

  r.finishedAt = performance.now();
  setTimeout(() => showResult(true, { timeBonus, distBonus, cashFromScore }), 700);
  Sound.stopEngine();
}

function abandonRun() {
  if (!G.runtime) return;
  const r = G.runtime;
  // Still bank a fraction of cash
  const earned = Math.floor(r.cashEarned * 0.5);
  save.cash += earned;
  save.totals.distance += Math.floor(r.distance / 10);
  save.totals.runs += 1;
  save.totals.airtime += r.runStats.airtime;
  save.totals.jumps += r.runStats.jumps;
  refreshQuestStates(r.runStats);
  persistSave();
  showResult(false, { abandonedEarned: earned });
  Sound.stopEngine();
}



//==========================================================
// RENDERING
//==========================================================

// (WORLD_ZOOM / VW / VH / updateViewport are declared up near the canvas
// globals so resizeCanvas can call updateViewport at boot without TDZ.)

function render() {
  const r = G.runtime;
  ctx.clearRect(0, 0, W, H);

  // Background sky always renders (theme-aware if we have a G.runtime).
  const theme = r ? THEMES[r.level.theme] : menuTheme();
  drawSky(theme);

  if (!r) {
    // Menu / non-play states: render an autoscrolling demo background.
    drawMenuDemo(theme);
    return;
  }

  // Dynamic camera: zoom out for speed and altitude so big jumps and tall
  // hills stay framed, and lead the bike forward at speed.
  const b = r.bike;
  const groundY = terrainHeightAt(r.terrain, b.x);
  const altitude = Math.max(0, groundY - b.y);
  const speed01 = Math.min(1, Math.abs(b.vx) / 700);
  // Required vertical span: bike + ground + margins. The further off the
  // ground we are, the more zoomed out we need to be to see both.
  const requiredVH = Math.max(420, altitude + 280);
  const altZoom = H / requiredVH;
  const speedZoom = WORLD_ZOOM - speed01 * 0.22;
  const zoomTarget = clamp(Math.min(altZoom, speedZoom), 1.0, WORLD_ZOOM);
  if (r.cam.zoom == null) r.cam.zoom = WORLD_ZOOM;
  r.cam.zoom = lerp(r.cam.zoom, zoomTarget, 0.07);
  // updateViewport() mutates VW/VH inside canvas.js — we can't reassign
  // the imported `let` bindings from here (ES module imports are
  // read-only), so the live values flow through the helper.
  updateViewport(r.cam.zoom);

  // Camera target. At low speed bike sits ~38% from left; at high speed
  // it slides toward 20% so we see more of what's coming. When the bike
  // is high in the air, frame the midpoint of bike + ground so both stay
  // visible instead of letting one fall off-screen.
  const lookFrac = 0.38 - speed01 * 0.18;
  const targetX = b.x - VW * lookFrac;
  let targetY;
  if (altitude > 60) {
    const mid = (b.y + groundY) / 2;
    targetY = mid - VH * 0.5;
  } else {
    targetY = b.y - VH * 0.55;
  }
  // Don't dig too far below ground.
  targetY = Math.min(targetY, GROUND_BASE - VH * 0.30);
  r.cam.x = lerp(r.cam.x, Math.max(0, targetX), 0.14);
  r.cam.y = lerp(r.cam.y, targetY, 0.10);

  // screen-shake offsets (decays inside loop)
  const sk = r.shake || (r.shake = { x: 0, y: 0, mag: 0 });
  const sx = (Math.random() - 0.5) * sk.mag;
  const sy = (Math.random() - 0.5) * sk.mag;

  // parallax background layers (in screen space, theme-aware)
  drawParallax(theme, r.cam.x, sx, sy);

  // World transform: zoom + camera + screen shake
  ctx.save();
  ctx.scale(r.cam.zoom, r.cam.zoom);
  ctx.translate(-Math.floor(r.cam.x) + sx, -Math.floor(r.cam.y) + sy);

  drawTerrain(r.terrain, r.cam.x, theme);
  drawProps(r.terrain, r.cam.x, theme);
  drawHazards(r.terrain, r.cam.x);
  drawCheckpoints(r.terrain, r.cam.x);
  drawObstacles(r.terrain, r.cam.x);
  drawCollectibles(r.terrain, r.cam.x);
  drawFinishLine(r.finishLineX, r.terrain);

  // tire trail + particles behind bike
  drawTireTrail(r.bike);
  drawParticles();

  drawBike(r.bike, r.stats);
  drawFloatingTexts();

  // Foreground silhouette layer — closer parallax props, drawn over the bike
  // so the world has depth.
  drawForeground(r.cam.x, theme);
  ctx.restore();

  // foreground (screen-space) overlays
  drawSunRays(theme);
  drawForegroundFog(theme);
  if (input().boost && G.runtime.bike.boost > 1) drawSpeedLines();
  drawColorGrade(theme);
  drawVignette();
  if (r.countdown > 0) drawCountdown(r.countdown);
  if (r.powerup) drawPowerupBadge(r.powerup);

  updateHUD();
}

function drawColorGrade(theme) {
  if (!theme.tint) return;
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = theme.tint;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawSunRays(theme) {
  if (!theme.rays || theme.rays <= 0) return;
  const s = theme.sun;
  const sx = W * s.x, sy = H * s.y;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = theme.rays;
  const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.9);
  grad.addColorStop(0,    "rgba(255, 240, 180, 0.55)");
  grad.addColorStop(0.4,  "rgba(255, 200, 120, 0.20)");
  grad.addColorStop(1,    "rgba(255, 180, 80, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // A few discrete light shafts.
  ctx.lineCap = "round";
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 0.6 - 0.3 + Math.sin(performance.now() / 4000 + i) * 0.05;
    const dx = Math.cos(a), dy = Math.sin(a);
    const grad2 = ctx.createLinearGradient(sx, sy, sx + dx * 800, sy + dy * 800);
    grad2.addColorStop(0, "rgba(255, 230, 160, 0.40)");
    grad2.addColorStop(1, "rgba(255, 230, 160, 0)");
    ctx.strokeStyle = grad2;
    ctx.lineWidth = 60;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + dx * 800, sy + dy * 800);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCountdown(countdown) {
  // Big animated 3 / 2 / 1 / GO! at center.
  const sec = Math.ceil(countdown);
  const text = sec >= 1 ? String(sec) : "GO!";
  const phase = 1 - (countdown % 1); // 0 → 1 within each second
  const scale = 1.4 - 0.4 * phase;
  const alpha = Math.max(0.2, 1 - phase * 0.7);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.font = "bold 120px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillText(text, 4, 6);
  ctx.fillStyle = sec === 0 ? "#4ddc8c" : "#ffb020";
  ctx.fillText(text, 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawPowerupBadge(p) {
  const icons = { star: "★", shield: "🛡", magnet: "🧲" };
  const label = (p.type[0].toUpperCase() + p.type.slice(1));
  const x = W / 2;
  const y = 60;
  ctx.save();
  ctx.fillStyle = "rgba(11,13,18,0.75)";
  ctx.strokeStyle = "#ffb020";
  ctx.lineWidth = 2;
  const w = 180, h = 38;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x - w/2, y - h/2, w, h, 10) : ctx.rect(x - w/2, y - h/2, w, h);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#ffb020";
  ctx.font = "bold 16px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${icons[p.type] || "?"}  ${label}  ${p.time.toFixed(1)}s`, x, y);
  ctx.restore();
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}


// Cycles through themes every few seconds for the main menu backdrop.
function menuTheme() {
  const order = ["day", "sunset", "dusk", "night", "desert"];
  const idx = Math.floor(performance.now() / 7000) % order.length;
  return THEMES[order[idx]];
}

// Synthetic terrain for the autoscrolling demo backdrop on menus.
const _menuDemo = {
  scroll: 0,
  fakeTerrain: (() => {
    const len = 8000;
    const heights = new Float32Array(Math.ceil(len / TERRAIN_DX) + 100);
    for (let i = 0; i < heights.length; i++) {
      const x = i * TERRAIN_DX;
      heights[i] = GROUND_BASE - Math.sin(x * 0.005) * 40 - Math.sin(x * 0.013 + 1.1) * 18;
    }
    const terrain = { heights, obstacles: [], collectibles: [], ramps: [], checkpoints: [], props: [] };
    // Sprinkle some props
    for (let cx = 200; cx < len - 200; cx += 140) {
      const r = Math.sin(cx) * 0.5 + 0.5;
      if (r < 0.5) terrain.props.push({ x: cx, type: "tree", h: 26, r: 9 });
      else if (r < 0.8) terrain.props.push({ x: cx, type: "rock", r: 7 });
      else terrain.props.push({ x: cx, type: "sign", h: 24, text: "SEND IT" });
    }
    return terrain;
  })(),
};

function drawMenuDemo(theme) {
  const t = performance.now() / 1000;
  _menuDemo.scroll = t * 80;
  const camX = _menuDemo.scroll;
  drawParallax(theme, camX, 0, 0);
  ctx.save();
  ctx.scale(WORLD_ZOOM, WORLD_ZOOM);
  ctx.translate(-Math.floor(camX), -Math.floor(GROUND_BASE - VH * 0.55));
  drawTerrain(_menuDemo.fakeTerrain, camX, theme);
  drawProps(_menuDemo.fakeTerrain, camX, theme);

  // Demo bike — bouncing along terrain
  const bx = camX + VW * 0.45;
  const by = terrainHeightAt(_menuDemo.fakeTerrain, bx);
  const stats = getEquippedStats();
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(Math.sin(t * 1.2) * 0.05);
  paintBike(ctx, {
    paint: stats.paint,
    accent: stats.charAccent,
    boots: stats.charBoots,
    wheelAngle: t * 7,
    lean: { x: 1, y: 0 },
    squash: 0,
    boosting: false,
  });
  ctx.restore();

  ctx.restore();
  drawForegroundFog(theme);
  drawVignette();
}

function drawSky(theme) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  for (const [c, stop] of theme.sky) g.addColorStop(stop, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Stars (night themes)
  if (theme.stars > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < theme.stars; i++) {
      // Deterministic star positions per i
      const sx = ((i * 127) % W);
      const sy = ((i * 53) % Math.floor(H * 0.55));
      const r = (i % 5 === 0) ? 1.6 : 1.0;
      const tw = 0.5 + 0.5 * Math.sin(performance.now() / 600 + i);
      ctx.globalAlpha = 0.4 + 0.6 * tw;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Sun / moon disc with glow halo
  const s = theme.sun;
  const sx = W * s.x, sy = H * s.y;
  ctx.fillStyle = s.outerColor;
  ctx.beginPath(); ctx.arc(sx, sy, s.size * 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = s.color;
  ctx.beginPath(); ctx.arc(sx, sy, s.size, 0, Math.PI * 2); ctx.fill();

  // Drifting clouds (day/sunset/desert themes)
  if (theme.name !== "Night") {
    const t = performance.now() / 1000;
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 240 + t * (15 + i * 3)) % (W + 200)) - 100;
      const cy = 60 + (i % 3) * 30;
      drawCloud(cx, cy, 30 + (i % 3) * 12);
    }
  }
}

function drawCloud(x, y, w) {
  ctx.beginPath();
  ctx.arc(x, y, w, 0, Math.PI * 2);
  ctx.arc(x + w * 0.7, y + 4, w * 0.7, 0, Math.PI * 2);
  ctx.arc(x - w * 0.7, y + 4, w * 0.65, 0, Math.PI * 2);
  ctx.fill();
}

function drawParallax(theme, camX, sx, sy) {
  // Layer 1 — far mountains (slowest)
  // Layer baselines are anchored to H so the parallax stays positioned
  // relative to the screen (and the ground band) at any aspect ratio.
  const farY  = H * 0.44;
  const midY  = H * 0.57;
  const nearY = H * 0.68;
  const treeY = H * 0.79;

  const p1 = camX * 0.10 + sx * 0.2;
  ctx.fillStyle = theme.mtnFar;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W + 200; x += 70) {
    const wx = x + p1;
    const y = farY + Math.sin(wx * 0.0035) * 60 + Math.sin(wx * 0.011 + 1.2) * 26;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

  // Layer 2 — mid mountains
  const p2 = camX * 0.22 + sx * 0.4;
  ctx.fillStyle = theme.mtnMid;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W + 200; x += 60) {
    const wx = x + p2;
    const y = midY + Math.sin(wx * 0.005) * 48 + Math.sin(wx * 0.013 + 0.6) * 22;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

  // Layer 3 — near hills
  const p3 = camX * 0.36 + sx * 0.6;
  ctx.fillStyle = theme.mtnNear;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W + 200; x += 50) {
    const wx = x + p3;
    const y = nearY + Math.sin(wx * 0.008 + 2.1) * 38 + Math.sin(wx * 0.017) * 16;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

  // Layer 4 — tree silhouette band
  const p4 = camX * 0.52 + sx * 0.8;
  ctx.fillStyle = theme.treeFar;
  for (let x = (-p4 % 50); x < W + 60; x += 50) {
    const seed = Math.floor((x + p4) / 50);
    const h = 22 + ((seed * 13) % 28);
    const baseY = treeY + ((seed * 7) % 8);
    ctx.beginPath();
    ctx.moveTo(x - 9, baseY);
    ctx.lineTo(x, baseY - h);
    ctx.lineTo(x + 9, baseY);
    ctx.closePath();
    ctx.fill();
  }
}

function drawForegroundFog(theme) {
  if (!theme.propFog) return;
  const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${theme.propFog})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
}

function drawVignette() {
  const g = ctx.createRadialGradient(W/2, H/2, Math.min(W,H) * 0.4, W/2, H/2, Math.max(W,H) * 0.7);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawProps(terrain, camX, theme) {
  const camLeft = camX - 40;
  const camRight = camX + VW + 40;
  for (const p of terrain.props || []) {
    if (p.x < camLeft || p.x > camRight) continue;
    const groundY = terrainHeightAt(terrain, p.x);
    if (p.type === "tree") {
      // Trunk
      ctx.fillStyle = "#3b2412";
      ctx.fillRect(p.x - 2, groundY - p.h, 4, p.h);
      // Foliage cluster
      ctx.fillStyle = theme.treeNear;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(p.x + (i - 1) * 6, groundY - p.h - 4 + (i % 2) * 3, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Subtle highlight
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath(); ctx.arc(p.x - 4, groundY - p.h - 6, p.r * 0.4, 0, Math.PI * 2); ctx.fill();
    } else if (p.type === "cactus") {
      ctx.fillStyle = "#2f5e2c";
      ctx.fillRect(p.x - 3, groundY - p.h, 6, p.h);
      ctx.fillRect(p.x - 9, groundY - p.h * 0.65, 4, p.h * 0.45);
      ctx.fillRect(p.x + 5, groundY - p.h * 0.55, 4, p.h * 0.4);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(p.x - 2, groundY - p.h, 1, p.h);
    } else if (p.type === "rock") {
      ctx.fillStyle = "#6a6f78";
      ctx.beginPath();
      ctx.ellipse(p.x, groundY - p.r * 0.4, p.r, p.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.ellipse(p.x - p.r * 0.3, groundY - p.r * 0.5, p.r * 0.3, p.r * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === "sign") {
      ctx.fillStyle = "#3b2412";
      ctx.fillRect(p.x - 1.5, groundY - p.h, 3, p.h);
      ctx.fillStyle = "#d8a13a";
      ctx.fillRect(p.x - 14, groundY - p.h, 28, 14);
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "bold 9px ui-monospace";
      ctx.fillText(p.text, p.x - 11, groundY - p.h + 10);
    } else if (p.type === "cone") {
      ctx.fillStyle = "#ff7a2c";
      ctx.beginPath();
      ctx.moveTo(p.x, groundY - p.h);
      ctx.lineTo(p.x - 6, groundY);
      ctx.lineTo(p.x + 6, groundY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillRect(p.x - 5, groundY - p.h * 0.55, 10, 2);
    } else if (p.type === "flag") {
      ctx.fillStyle = "#888";
      ctx.fillRect(p.x - 1, groundY - p.h, 2, p.h);
      ctx.fillStyle = p.color || "#ffb020";
      ctx.beginPath();
      ctx.moveTo(p.x, groundY - p.h);
      ctx.lineTo(p.x + 14, groundY - p.h + 4);
      ctx.lineTo(p.x, groundY - p.h + 8);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawTerrain(terrain, camX, theme) {
  const startX = Math.max(0, camX - 40);
  const endX = camX + VW + 40;
  const startI = Math.max(0, Math.floor(startX / TERRAIN_DX));
  const endI = Math.min(terrain.heights.length - 1, Math.ceil(endX / TERRAIN_DX));

  // Dirt fill
  ctx.fillStyle = theme.ground;
  ctx.beginPath();
  ctx.moveTo(startI * TERRAIN_DX, GROUND_BASE + 600);
  for (let i = startI; i <= endI; i++) {
    ctx.lineTo(i * TERRAIN_DX, terrain.heights[i]);
  }
  ctx.lineTo(endI * TERRAIN_DX, GROUND_BASE + 600);
  ctx.closePath();
  ctx.fill();

  // top stripe (grass / dirt edge)
  ctx.strokeStyle = theme.grassTop;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = startI; i <= endI; i++) {
    const x = i * TERRAIN_DX;
    const y = terrain.heights[i];
    if (i === startI) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Grass tufts on the surface (every ~24px, deterministic)
  ctx.fillStyle = theme.grassTuft;
  for (let i = startI; i <= endI; i += 3) {
    if ((i * 17 + 11) % 4 !== 0) continue;
    const x = i * TERRAIN_DX;
    const y = terrain.heights[i];
    ctx.fillRect(x, y - 3, 1.5, 3);
    ctx.fillRect(x + 2, y - 2, 1, 2);
  }

  // Texture diagonal hash
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  for (let i = startI; i <= endI; i += 3) {
    const x = i * TERRAIN_DX;
    const y = terrain.heights[i];
    ctx.beginPath();
    ctx.moveTo(x, y + 18);
    ctx.lineTo(x + 18, y + 30);
    ctx.stroke();
  }

  // Lighter dust layer just above darker subsoil
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.moveTo(startI * TERRAIN_DX, GROUND_BASE + 600);
  for (let i = startI; i <= endI; i++) {
    ctx.lineTo(i * TERRAIN_DX, terrain.heights[i] + 60);
  }
  ctx.lineTo(endI * TERRAIN_DX, GROUND_BASE + 600);
  ctx.closePath();
  ctx.fill();
}

function drawCheckpoints(terrain, camX) {
  for (const cp of terrain.checkpoints) {
    if (cp.x < camX - 50 || cp.x > camX + VW + 50) continue;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cp.x, cp.y);
    ctx.lineTo(cp.x, cp.y - 90);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 176, 32, 0.85)";
    ctx.fillRect(cp.x, cp.y - 90, 26, 16);
  }
}

function drawTireTrail(bike) {
  if (!bike.tireTrail || bike.tireTrail.length < 2) return;
  ctx.strokeStyle = "rgba(20, 12, 6, 0.45)";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  let first = true;
  for (const p of bike.tireTrail) {
    if (first) { ctx.moveTo(p.x, p.y); first = false; }
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

// Foreground silhouette layer — extra moving foliage / grass blades close
// to the camera, drawn after the bike. Adds depth without breaking gameplay.
function drawForeground(camX, theme) {
  const t = performance.now() / 1000;
  // Foreground grass blades — wave with sin
  const period = 16;
  const startX = Math.floor(camX / period) * period;
  ctx.fillStyle = theme.grassTuft;
  for (let x = startX; x < camX + VW; x += period) {
    const groundY = G.runtime ? terrainHeightAt(G.runtime.terrain, x) : GROUND_BASE;
    const sway = Math.sin(t * 2 + x * 0.05) * 1.5;
    ctx.fillRect(x + sway, groundY - 5, 1.5, 5);
    ctx.fillRect(x + 5 - sway, groundY - 3, 1, 3);
  }
  // Light wisps drifting through foreground (atmospheric)
  if (theme.propFog && theme.propFog > 0.1) {
    ctx.fillStyle = `rgba(255, 255, 255, ${theme.propFog * 0.18})`;
    for (let i = 0; i < 4; i++) {
      const wx = camX + ((i * 410 + t * 60) % VW);
      const wy = GROUND_BASE - 30 + Math.sin(t + i) * 8;
      ctx.beginPath();
      ctx.ellipse(wx, wy, 60, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawHazards(terrain, camX) {
  if (!terrain.hazards) return;
  const t = performance.now() / 1000;
  for (const h of terrain.hazards) {
    if (h.x + h.w < camX - 60 || h.x > camX + VW + 60) continue;
    const groundLeft = terrainHeightAt(terrain, h.x);
    const groundRight = terrainHeightAt(terrain, h.x + h.w);
    if (h.type === "oil") {
      // Dark glossy puddle
      ctx.fillStyle = "rgba(15, 15, 20, 0.95)";
      ctx.beginPath();
      ctx.moveTo(h.x, groundLeft);
      ctx.lineTo(h.x + h.w, groundRight);
      ctx.lineTo(h.x + h.w - 4, groundRight + 3);
      ctx.lineTo(h.x + 4, groundLeft + 3);
      ctx.closePath(); ctx.fill();
      // Rainbow sheen
      ctx.fillStyle = "rgba(120, 120, 255, 0.18)";
      ctx.fillRect(h.x + 8, groundLeft - 1, h.w - 16, 1.5);
    } else if (h.type === "mud") {
      ctx.fillStyle = "#3a2516";
      ctx.beginPath();
      ctx.moveTo(h.x, groundLeft);
      ctx.lineTo(h.x + h.w, groundRight);
      ctx.lineTo(h.x + h.w, groundRight + 4);
      ctx.lineTo(h.x, groundLeft + 4);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.10)";
      for (let i = 0; i < 4; i++) ctx.fillRect(h.x + 6 + i * 14, groundLeft - 1, 6, 1.2);
    } else if (h.type === "fire") {
      // Pit edges
      ctx.fillStyle = "#1a0e08";
      ctx.fillRect(h.x, groundLeft, h.w, 6);
      // Animated flames
      for (let i = 0; i < 6; i++) {
        const fx = h.x + 8 + i * (h.w - 16) / 5;
        const flick = Math.sin(t * 8 + i * 1.7) * 4;
        ctx.fillStyle = "rgba(255, 100, 30, 0.95)";
        ctx.beginPath();
        ctx.moveTo(fx - 6, groundLeft);
        ctx.lineTo(fx, groundLeft - 22 - flick);
        ctx.lineTo(fx + 6, groundLeft);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "rgba(255, 220, 80, 0.85)";
        ctx.beginPath();
        ctx.moveTo(fx - 3, groundLeft);
        ctx.lineTo(fx, groundLeft - 12 - flick * 0.6);
        ctx.lineTo(fx + 3, groundLeft);
        ctx.closePath(); ctx.fill();
      }
    } else if (h.type === "spring") {
      // Spring pad
      const cx = h.x + h.w / 2;
      const cy = groundLeft;
      ctx.fillStyle = "#4ddc8c";
      ctx.fillRect(cx - 16, cy - 4, 32, 4);
      ctx.fillStyle = "#2db86b";
      // coil zigzag
      ctx.strokeStyle = "#2db86b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 5; i++) {
        const px = cx - 12 + i * 5;
        const py = cy + 2 + (i % 2) * 4;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      // Indicator arrow
      ctx.fillStyle = h.fired ? "#3a4f3a" : "#4ddc8c";
      ctx.beginPath();
      const a = h.fired ? 0 : Math.sin(t * 4) * 2;
      ctx.moveTo(cx, cy - 22 - a);
      ctx.lineTo(cx - 6, cy - 14 - a);
      ctx.lineTo(cx + 6, cy - 14 - a);
      ctx.closePath(); ctx.fill();
    }
  }
}

function drawObstacles(terrain, camX) {
  for (const o of terrain.obstacles) {
    if (o.hit) continue;
    if (o.x < camX - 80 || o.x > camX + VW + 80) continue;
    if (o.type === "rock") {
      ctx.fillStyle = "#777a7e";
      ctx.beginPath();
      ctx.arc(o.x, o.y - o.r * 0.7, o.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5a5d62";
      ctx.beginPath();
      ctx.arc(o.x - o.r * 0.3, o.y - o.r * 0.7, o.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (o.type === "tire") {
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.arc(o.x, o.y - o.r, o.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3b3b3b";
      ctx.beginPath();
      ctx.arc(o.x, o.y - o.r, o.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else { // log
      ctx.fillStyle = "#6a3e1f";
      ctx.fillRect(o.x - o.r, o.y - o.r * 1.2, o.r * 2, o.r * 1.2);
      ctx.fillStyle = "#925a2c";
      ctx.beginPath();
      ctx.ellipse(o.x - o.r, o.y - o.r * 0.6, o.r * 0.4, o.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawCollectibles(terrain, camX) {
  const t = performance.now() / 1000;
  for (const c of terrain.collectibles) {
    if (c.taken) continue;
    if (c.x < camX - 40 || c.x > camX + VW + 40) continue;
    const bobY = c.y + Math.sin(t * 3 + c.bob) * 4;

    // Halo glow — bigger and brighter for power-ups, modest for coins.
    let haloColor = "rgba(255, 201, 64, 0.25)";
    let haloR = 18;
    if (c.type === "gem")    { haloColor = "rgba(110, 231, 255, 0.30)"; haloR = 22; }
    if (c.type === "star")   { haloColor = "rgba(255, 230, 120, 0.55)"; haloR = 30; }
    if (c.type === "shield") { haloColor = "rgba(110, 231, 255, 0.45)"; haloR = 28; }
    if (c.type === "magnet") { haloColor = "rgba(194, 255, 58, 0.45)";  haloR = 28; }
    const pulse = 1 + 0.15 * Math.sin(t * 4 + c.bob);
    const grad = ctx.createRadialGradient(c.x, bobY, 0, c.x, bobY, haloR * pulse);
    grad.addColorStop(0, haloColor);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(c.x - haloR * 1.4, bobY - haloR * 1.4, haloR * 2.8, haloR * 2.8);

    if (c.type === "gem") {
      ctx.fillStyle = "#6ee7ff"; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x, bobY - 14); ctx.lineTo(c.x + 10, bobY);
      ctx.lineTo(c.x, bobY + 14); ctx.lineTo(c.x - 10, bobY);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (c.type === "star") {
      // 5-point star
      ctx.fillStyle = "#ffe680"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const r = (i % 2 === 0) ? 14 : 6;
        const x = c.x + Math.cos(a) * r;
        const y = bobY + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (c.type === "shield") {
      // Heater-shield shape
      ctx.fillStyle = "#6ee7ff"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x, bobY - 14);
      ctx.lineTo(c.x + 12, bobY - 8);
      ctx.lineTo(c.x + 10, bobY + 6);
      ctx.quadraticCurveTo(c.x, bobY + 14, c.x - 10, bobY + 6);
      ctx.lineTo(c.x - 12, bobY - 8);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.fillRect(c.x - 1, bobY - 6, 2, 10);
      ctx.fillRect(c.x - 5, bobY - 2, 10, 2);
    } else if (c.type === "magnet") {
      // Horseshoe magnet
      ctx.fillStyle = "#c2ff3a"; ctx.strokeStyle = "#444"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, bobY + 2, 10, Math.PI, 0, false);
      ctx.lineTo(c.x + 10, bobY + 8);
      ctx.lineTo(c.x + 4, bobY + 8);
      ctx.arc(c.x, bobY + 2, 4, 0, Math.PI, true);
      ctx.lineTo(c.x - 10, bobY + 8);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // Tips
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(c.x - 12, bobY + 8, 6, 4);
      ctx.fillRect(c.x + 6,  bobY + 8, 6, 4);
    } else {
      // bolt
      ctx.fillStyle = "#ffc940"; ctx.strokeStyle = "#7a4a00"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c.x, bobY, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#7a4a00";
      ctx.fillRect(c.x - 2, bobY - 2, 4, 4);
    }
  }
}

function drawFinishLine(x, terrain) {
  const groundY = terrainHeightAt(terrain, x);
  // checker pole
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 2, groundY - 180, 4, 180);
  // banner
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = (i % 2 === 0) ? "#fff" : "#000";
    ctx.fillRect(x, groundY - 180 + i * 10, 80, 10);
  }
  ctx.fillStyle = "#000";
  ctx.font = "bold 14px ui-monospace";
  ctx.fillText("FINISH", x + 6, groundY - 110);
}

function drawParticles() {
  const r = G.runtime;
  for (const p of r.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFloatingTexts() {
  const r = G.runtime;
  ctx.font = "bold 16px ui-monospace";
  ctx.textAlign = "center";
  for (const f of r.floatingTexts) {
    ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "start";
}

// Shared bike renderer. `g` is the 2D context, already translated/rotated.
// `opts` carries: paint, wheelAngle, lean ({x, y}), squash (0..1 landing impact),
// boosting, throttling.
function paintBike(g, opts) {
  const paint = opts.paint || "#e94c3a";
  const accent = opts.accent || "#ffffff";
  const boots  = opts.boots  || "#0a0a0e";
  const wA = opts.wheelAngle || 0;
  const lean = opts.lean || { x: 0, y: 0 };
  const squash = opts.squash || 0;
  const boosting = !!opts.boosting;
  const dark = !!opts.dark;       // theme is dark → draw a headlight beam
  const braking = !!opts.braking; // brake light when slowing down

  // ----- Headlight beam (dark themes only) — drawn first so the bike
  // covers its base. Cone of light projecting forward.
  if (dark) {
    g.save();
    g.globalCompositeOperation = "lighter";
    const beamGrad = g.createLinearGradient(28, -10, 200, -10);
    beamGrad.addColorStop(0,   "rgba(255, 240, 200, 0.55)");
    beamGrad.addColorStop(0.4, "rgba(255, 230, 160, 0.20)");
    beamGrad.addColorStop(1,   "rgba(255, 220, 140, 0)");
    g.fillStyle = beamGrad;
    g.beginPath();
    g.moveTo(26, -14);
    g.lineTo(220, -50);
    g.lineTo(220, 30);
    g.lineTo(26, -2);
    g.closePath();
    g.fill();
    g.restore();
  }

  // ----- Wheels ----------------------------------------------------------
  const wheelR = 13;
  const wheelXs = [-24, 24];
  for (const wx of wheelXs) {
    // Tire — outer dark
    g.fillStyle = "#0f0f12";
    g.beginPath(); g.arc(wx, 0, wheelR, 0, Math.PI * 2); g.fill();
    // Tread ticks (rotate with bike's wheelAngle)
    g.save();
    g.translate(wx, 0);
    g.rotate(wA);
    g.fillStyle = "#3a3a40";
    for (let i = 0; i < 8; i++) {
      g.save();
      g.rotate((i / 8) * Math.PI * 2);
      g.fillRect(-1, wheelR - 4, 2, 4);
      g.restore();
    }
    // Rim
    g.fillStyle = "#9aa3b3";
    g.beginPath(); g.arc(0, 0, 6, 0, Math.PI * 2); g.fill();
    // Spokes
    g.strokeStyle = "#cfd6e3";
    g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * 6, Math.sin(a) * 6);
      g.stroke();
    }
    // Hub
    g.fillStyle = "#1d222e";
    g.beginPath(); g.arc(0, 0, 2.2, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // ----- Frame: base triangle + swingarm ---------------------------------
  // Swingarm (rear)
  g.strokeStyle = "#1d222e";
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(-24, 0); g.lineTo(-6, -6); g.stroke();
  // Lower frame
  g.beginPath(); g.moveTo(-6, -6); g.lineTo(14, -8); g.stroke();
  // Front fork (with two stanchions). Compresses on landing impact (squash).
  const forkLen = 16 - squash * 6;
  g.strokeStyle = "#cfd6e3";
  g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(24, 0); g.lineTo(20, -forkLen); g.stroke();
  g.strokeStyle = "#7d8898";
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(26, 0); g.lineTo(22, -forkLen); g.stroke();
  // Front fender
  g.fillStyle = paint;
  g.beginPath();
  g.moveTo(14, -2); g.quadraticCurveTo(22, -7, 30, -3);
  g.lineTo(30, -1); g.quadraticCurveTo(22, -5, 14, 0);
  g.closePath(); g.fill();

  // Engine block (with vertical fins)
  g.fillStyle = "#2a2f3c";
  g.fillRect(-9, -10, 18, 12);
  g.fillStyle = "#11141c";
  for (let i = 0; i < 4; i++) g.fillRect(-8 + i * 5, -10, 2, 8);
  // Engine highlight
  g.fillStyle = "rgba(255,255,255,0.05)";
  g.fillRect(-9, -10, 18, 2);

  // Gas tank (paint color, with shading + highlight)
  g.fillStyle = paint;
  g.beginPath();
  g.moveTo(-12, -10);
  g.lineTo(-2, -20);
  g.lineTo(14, -16);
  g.lineTo(16, -10);
  g.closePath();
  g.fill();
  // Tank shading underside
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.beginPath();
  g.moveTo(-12, -10); g.lineTo(16, -10); g.lineTo(14, -8); g.lineTo(-10, -8);
  g.closePath(); g.fill();
  // Tank highlight
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.beginPath();
  g.moveTo(-2, -19); g.lineTo(8, -17); g.lineTo(8, -16); g.lineTo(-2, -18);
  g.closePath(); g.fill();

  // Number plate on side
  g.fillStyle = "#f2f2f5";
  g.beginPath();
  g.moveTo(-24, -8); g.lineTo(-12, -10); g.lineTo(-10, -4); g.lineTo(-22, -2);
  g.closePath(); g.fill();
  g.fillStyle = "#1a1a1a";
  g.font = "bold 7px ui-monospace";
  g.fillText("07", -20, -4);

  // Seat (curved)
  g.fillStyle = "#0c0d12";
  g.beginPath();
  g.moveTo(-22, -10); g.quadraticCurveTo(-16, -14, -8, -14); g.lineTo(-2, -14);
  g.lineTo(-2, -12); g.quadraticCurveTo(-12, -12, -22, -8);
  g.closePath(); g.fill();
  // Seat stitch highlight
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.lineWidth = 0.6;
  g.beginPath();
  g.moveTo(-20, -12); g.quadraticCurveTo(-12, -14, -4, -13);
  g.stroke();

  // Rear shock (visible spring)
  g.strokeStyle = "#ffb020";
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(-8, -8); g.lineTo(-18, -2); g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.25)";
  g.lineWidth = 0.6;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(-10 - i * 2, -7 + i); g.lineTo(-12 - i * 2, -5 + i);
    g.stroke();
  }

  // Exhaust pipe
  g.strokeStyle = "#9aa3b3";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, -4); g.quadraticCurveTo(-12, 0, -22, -4);
  g.stroke();
  // Exhaust tip
  g.fillStyle = "#1d222e";
  g.beginPath(); g.arc(-22, -4, 2.5, 0, Math.PI * 2); g.fill();

  // Handlebars + grip
  g.strokeStyle = "#1d222e";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(20, -16); g.lineTo(28, -22);
  g.stroke();
  g.fillStyle = "#0c0d12";
  g.beginPath(); g.arc(28, -22, 2.5, 0, Math.PI * 2); g.fill();

  // ----- Rider -----------------------------------------------------------
  const lx = lean.x, ly = lean.y - squash * 1.5;
  // Pants / lower body
  g.fillStyle = "#1d2030";
  g.fillRect(-4 + lx, -16 + ly, 12, 8);
  // Jacket / torso (paint color)
  g.fillStyle = paint;
  g.beginPath();
  g.moveTo(-4 + lx, -28 + ly);
  g.lineTo(8 + lx, -26 + ly);
  g.lineTo(10 + lx, -16 + ly);
  g.lineTo(-4 + lx, -16 + ly);
  g.closePath(); g.fill();
  // Jacket stripe (character accent)
  g.fillStyle = accent;
  g.fillRect(-3 + lx, -22 + ly, 12, 1.5);

  // Helmet — base shape
  g.fillStyle = paint;
  g.beginPath();
  g.arc(3 + lx, -33 + ly, 7, 0, Math.PI * 2);
  g.fill();
  // Helmet darken bottom
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.beginPath();
  g.arc(3 + lx, -33 + ly, 7, 0, Math.PI);
  g.fill();
  // Helmet stripe
  g.fillStyle = "#fff";
  g.fillRect(0 + lx, -38 + ly, 8, 1.5);
  // Visor
  g.fillStyle = "#0c1426";
  g.beginPath();
  g.moveTo(2 + lx, -36 + ly);
  g.lineTo(10 + lx, -34 + ly);
  g.lineTo(10 + lx, -31 + ly);
  g.lineTo(2 + lx, -31 + ly);
  g.closePath(); g.fill();
  // Visor reflection
  g.fillStyle = "rgba(150, 220, 255, 0.5)";
  g.fillRect(7 + lx, -35 + ly, 2.5, 1.5);

  // Arms — gripping handlebars
  g.strokeStyle = paint;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(6 + lx, -22 + ly);
  g.quadraticCurveTo(18, -22, 26, -20);
  g.stroke();
  // Glove
  g.fillStyle = "#0c0d12";
  g.beginPath(); g.arc(26, -20, 2, 0, Math.PI * 2); g.fill();

  // Leg — bent on peg
  g.strokeStyle = "#1d2030";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(2 + lx, -10 + ly); g.quadraticCurveTo(0, -4, -6, -2);
  g.stroke();
  // Boot (character)
  g.fillStyle = boots;
  g.beginPath(); g.ellipse(-7, -2, 3, 2, 0, 0, Math.PI * 2); g.fill();

  // Brake light (rear) when braking — small red glow.
  if (braking) {
    g.save();
    g.globalCompositeOperation = "lighter";
    const grad = g.createRadialGradient(-22, -8, 0, -22, -8, 12);
    grad.addColorStop(0, "rgba(255, 60, 60, 0.85)");
    grad.addColorStop(1, "rgba(255, 60, 60, 0)");
    g.fillStyle = grad;
    g.fillRect(-36, -22, 28, 28);
    g.restore();
    g.fillStyle = "#ff3030";
    g.beginPath(); g.arc(-22, -8, 1.6, 0, Math.PI * 2); g.fill();
  }

  // Drive chain — a thin link line between sprockets. Subtle but adds detail.
  g.strokeStyle = "rgba(40, 40, 50, 0.7)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-22, 0); g.lineTo(-3, -2);
  g.stroke();

  // Boost flame from exhaust
  if (boosting) {
    const t = performance.now() / 60;
    g.fillStyle = "rgba(255, 220, 80, 0.85)";
    g.beginPath();
    g.moveTo(-22, -4);
    g.lineTo(-30 - Math.sin(t) * 2, -6);
    g.lineTo(-34 - Math.sin(t * 1.3) * 3, -3);
    g.lineTo(-30 - Math.sin(t) * 2, -1);
    g.closePath(); g.fill();
    g.fillStyle = "rgba(110, 231, 255, 0.9)";
    g.beginPath();
    g.moveTo(-22, -4);
    g.lineTo(-26 - Math.sin(t) * 1, -5);
    g.lineTo(-28, -3);
    g.lineTo(-26, -2);
    g.closePath(); g.fill();
  }
}

function drawBike(b, stats) {
  // Aura around bike when star or shield is active.
  const r = G.runtime;
  if (r) {
    const t = performance.now() / 1000;
    if (r.powerup && r.powerup.type === "star" && r.powerup.time > 0) {
      const pulse = 1 + 0.12 * Math.sin(t * 12);
      const grad = ctx.createRadialGradient(b.x, b.y - 10, 0, b.x, b.y - 10, 60 * pulse);
      grad.addColorStop(0, "rgba(255, 230, 120, 0.50)");
      grad.addColorStop(1, "rgba(255, 230, 120, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(b.x - 80, b.y - 90, 160, 130);
    } else if (b.hasShield) {
      ctx.strokeStyle = "rgba(110, 231, 255, " + (0.4 + 0.2 * Math.sin(t * 8)) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y - 12, 36, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // Ground shadow (drawn in world coords, no rotation)
  if (!b.onGround && G.runtime) {
    const groundY = terrainHeightAt(G.runtime.terrain, b.x);
    const dist = Math.max(0, groundY - b.y);
    const shadowScale = clamp(1 - dist / 400, 0.2, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(b.x, groundY + 2, 32 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const inp = input();
  let leanX = 0, leanY = 0;
  if (b.onGround) {
    if (inp.brake) leanX = -3;
    if (inp.leanFwd) { leanX = 3; leanY = -2; }
    if (inp.throttle) leanY = -1;
  } else {
    // air pose: rider tucks slightly
    leanY = -1;
  }
  // squash on landing impact (decays)
  const squash = clamp((b.landSquash || 0), 0, 1);
  const boosting = !!b.boostingPrev;

  ctx.save();
  ctx.translate(b.x, b.y);
  // Visual-only wheelie / stoppie tilt on top of the physics angle.
  let tilt = 0;
  if (b.onGround && b.wheelie && b.wheelie.time > 0) {
    tilt = b.wheelie.dir * Math.min(0.55, b.wheelie.time * 1.6);
  }
  ctx.rotate(b.angle + tilt);
  const theme = G.runtime ? THEMES[G.runtime.level.theme] : null;
  paintBike(ctx, {
    paint: stats.paint,
    accent: stats.charAccent,
    boots: stats.charBoots,
    wheelAngle: b.wheelAngle || 0,
    lean: { x: leanX, y: leanY },
    squash, boosting,
    dark: !!(theme && theme.dark),
    braking: !!inp.brake && b.onGround,
  });
  ctx.restore();
}

function drawSpeedLines() {
  // Cyan streaks across the screen + faint vignette pulse for boost punch.
  ctx.strokeStyle = "rgba(110, 231, 255, 0.55)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    const y = (Math.random() * H);
    const len = 80 + Math.random() * 200;
    const x = Math.random() * W;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len, y);
    ctx.stroke();
  }
  // Cyan haze on edges
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0,    "rgba(110, 231, 255, 0.20)");
  g.addColorStop(0.5,  "rgba(110, 231, 255, 0.00)");
  g.addColorStop(1,    "rgba(110, 231, 255, 0.20)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

//==========================================================
// HUD
//==========================================================
function updateHUD() {
  if (!G.runtime) return;
  const r = G.runtime;
  const speedMph = Math.round(r.bike.vx / 6);
  document.getElementById("hud-speed").textContent = Math.max(0, speedMph);
  document.getElementById("hud-boost").style.width = `${(r.bike.boost / r.stats.boostCap) * 100}%`;
  const healthPct = (r.bike.health / r.stats.durability) * 100;
  const healthEl = document.getElementById("hud-health");
  healthEl.style.width = `${healthPct}%`;
  // Pulse low health.
  healthEl.parentElement.classList.toggle("low", healthPct < 35);
  document.getElementById("hud-combo").textContent = r.combo;
  document.getElementById("hud-score").textContent = r.score;
  document.getElementById("hud-cash").textContent = r.cashEarned;
  document.getElementById("hud-time").textContent = r.time.toFixed(1);
  document.getElementById("hud-dist").textContent = Math.floor(r.distance / 10);

  // quest tracker — show 3 most-progressed unfinished
  const tracker = document.getElementById("quest-tracker");
  const open = QUESTS
    .map(q => ({ q, prog: getQuestProgress(q), done: save.quests[q.id]?.done }))
    .filter(x => !x.done)
    .sort((a, b) => (b.prog / b.q.target) - (a.prog / a.q.target))
    .slice(0, 3);
  if (open.length === 0) {
    tracker.innerHTML = `<div class="qt-title">All quests done</div><div class="qt-row done">Champion.</div>`;
  } else {
    tracker.innerHTML = `<div class="qt-title">Next Quests</div>` + open.map(({ q, prog }) => {
      return `<div class="qt-row"><span>${q.name}</span><span>${Math.min(prog, q.target)}/${q.target}</span></div>`;
    }).join("");
  }
}

//==========================================================
// MENU / UI WIRING
//==========================================================
function showOnly(id) {
  for (const overlay of ["menu","levels","garage","quests","how","result","pause","hud","cb-levels","fg-levels","pp-levels"]) {
    const el = document.getElementById(overlay);
    if (!el) continue;
    if (overlay === id) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }
  // Touch overlay only shown during PLAY (and only on touch devices via .show class)
  const touchEl = document.getElementById("touch");
  if (touchEl) {
    if (id === "hud") touchEl.classList.remove("hidden");
    else touchEl.classList.add("hidden");
  }
  // Music: game music during HUD, menu music elsewhere.
  if (id === "hud") Sound.startMusic("game");
  else if (id === "pause") { /* keep current track playing */ }
  else Sound.startMusic("menu");
}
function showHud() { document.getElementById("hud").classList.remove("hidden"); }
function hideHud() { document.getElementById("hud").classList.add("hidden"); }

function buildLevelGrid() {
  const grid = document.getElementById("level-grid");
  grid.innerHTML = "";
  for (const lvl of LEVELS) {
    const card = document.createElement("div");
    const unlocked = levelUnlocked(lvl);
    card.className = "level-card" + (unlocked ? "" : " locked");
    const best = save.best[lvl.id];
    const themeName = THEMES[lvl.theme]?.name || "—";
    const medal = best?.medal ? medalIcon(best.medal) : "";
    card.innerHTML = `
      <div class="lc-name">${unlocked ? "" : "🔒 "}${lvl.name} ${medal}</div>
      <div class="lc-meta">${themeName} • ${"★".repeat(lvl.difficulty)}${"☆".repeat(5 - lvl.difficulty)} • ${lvl.length}m${lvl.lowGravity ? " • Low-G" : ""}</div>
      <div class="lc-best">${best && best.completed
        ? `Best: ${best.score} pts • ${best.time.toFixed(1)}s`
        : "Not completed"}</div>
      <div class="lc-meta">🥇 ${lvl.medals.gold}s &nbsp; 🥈 ${lvl.medals.silver}s &nbsp; 🥉 ${lvl.medals.bronze}s</div>
      <div class="lc-meta">${lvl.desc}</div>
    `;
    if (unlocked) card.addEventListener("click", () => startRun(lvl.id));
    grid.appendChild(card);
  }
}

function buildGarage() {
  document.getElementById("garage-cash").textContent = save.cash;
  drawGaragePreview();
  updateGarageStatBars();
  buildPartsList(currentPartsTab);
}
let currentPartsTab = "engine";
document.querySelectorAll(".parts-tabs .tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".parts-tabs .tab").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    currentPartsTab = t.dataset.tab;
    buildPartsList(currentPartsTab);
  });
});

function buildPartsList(tab) {
  const list = document.getElementById("parts-list");
  list.innerHTML = "";
  // The "character" tab uses a different catalog and equipment slot.
  const items = (tab === "character") ? CHARACTERS : PARTS[tab];
  const slot = (tab === "character") ? "character" : tab;
  for (const p of items) {
    const owned = !!save.ownedParts[p.id];
    const equipped = save.equipped[slot] === p.id;
    const card = document.createElement("div");
    card.className = "part-card" + (equipped ? " equipped" : "") + (owned || save.cash >= p.cost ? "" : " locked");
    const stats = Object.entries(p.stats || {}).filter(([k,v]) => k !== "paint" && k !== "accent" && k !== "boots")
      .map(([k,v]) => {
        const sign = (typeof v === "number" && v > 0) ? "+" : "";
        return `${k}: ${sign}${v}`;
      }).join("  •  ");
    card.innerHTML = `
      <div>
        <div class="pc-name">${p.name}</div>
        <div class="pc-desc">${p.desc}</div>
        <div class="pc-stats">${stats || ""}</div>
      </div>
      <div class="pc-buy">
        <div class="pc-cost">${owned ? (equipped ? "Equipped" : "Owned") : `$${p.cost}`}</div>
        <button>${equipped ? "Equipped" : (owned ? "Equip" : "Buy")}</button>
      </div>
    `;
    const btn = card.querySelector("button");
    btn.disabled = equipped || (!owned && save.cash < p.cost);
    btn.addEventListener("click", () => {
      if (!owned) {
        if (save.cash < p.cost) return;
        save.cash -= p.cost;
        save.ownedParts[p.id] = true;
      }
      save.equipped[slot] = p.id;
      persistSave();
      buildGarage();
      pushToast(`Equipped ${p.name}`, "green");
    });
    list.appendChild(card);
  }
}

function drawGaragePreview() {
  const c = document.getElementById("garage-canvas");
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  // bg
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, "#1d2540");
  grad.addColorStop(1, "#0c1020");
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // floor
  g.fillStyle = "#101828";
  g.fillRect(0, c.height - 60, c.width, 60);
  g.fillStyle = "#1a2238";
  for (let x = 0; x < c.width; x += 24) g.fillRect(x, c.height - 60, 1, 60);

  const stats = getEquippedStats();
  g.save();
  g.translate(c.width / 2, c.height - 90);
  g.scale(2.2, 2.2);
  drawStaticBike(g, stats);
  g.restore();

  // engine name
  const engine = partById(save.equipped.engine);
  g.fillStyle = "#ffb020";
  g.font = "bold 16px ui-monospace";
  g.fillText(engine.name, 16, 28);
}
function drawStaticBike(g, stats) {
  paintBike(g, { paint: stats.paint, accent: stats.charAccent, boots: stats.charBoots, wheelAngle: 0, lean: { x: 0, y: 0 }, squash: 0, boosting: false });
}

function updateGarageStatBars() {
  const stats = getEquippedStats();
  // normalize for visualization
  const map = [
    ["g-stat-speed", stats.topSpeed / 110],
    ["g-stat-accel", (stats.accel - 0.9) / 0.85],
    ["g-stat-grip", stats.grip],
    ["g-stat-susp", stats.suspension],
    ["g-stat-boost", stats.boostCap / 220],
    ["g-stat-dura", stats.durability / 200],
  ];
  for (const [id, v] of map) {
    document.getElementById(id).style.width = `${clamp(v, 0, 1) * 100}%`;
  }
}

function buildQuests() {
  // The "quests" overlay now shows mini-games. Lifetime quest tracking
  // still runs in the background and pays out automatically.
  const list = document.getElementById("quests-list");
  list.innerHTML = "";
  for (const id of Object.keys(MINIGAMES)) {
    const mg = MINIGAMES[id];
    const card = document.createElement("div");
    card.className = "quest-card minigame-card";
    card.style.borderLeft = `4px solid ${mg.color}`;
    let summary;
    if (id === "can_bash") {
      const lvls = save.canBashLevels || {};
      const totalStars = CAN_LEVELS.reduce((s, l) => s + ((lvls[l.id]?.stars) || 0), 0);
      const maxStars = CAN_LEVELS.length * 3;
      summary = `Stars: ${totalStars} / ${maxStars}`;
    } else if (id === "field_goal") {
      const lvls = save.fieldGoalLevels || {};
      const totalStars = FG_LEVELS.reduce((s, l) => s + ((lvls[l.id]?.stars) || 0), 0);
      const maxStars = FG_LEVELS.length * 3;
      const best = save.fieldGoalBest || {};
      const tail = (best.longestMake || best.bestStreak)
        ? ` • Long ${best.longestMake || 0}yd • Streak ${best.bestStreak || 0}`
        : "";
      summary = `Stars: ${totalStars} / ${maxStars}${tail}`;
    } else if (id === "party_pong") {
      const lvls = save.partyPongLevels || {};
      const totalStars = PP_LEVELS.reduce((s, l) => s + ((lvls[l.id]?.stars) || 0), 0);
      const maxStars = PP_LEVELS.length * 3;
      const best = save.partyPongBest || {};
      const tail = (best.totalMakes || best.bestStreak)
        ? ` • ${best.totalMakes || 0} cups • Streak ${best.bestStreak || 0}`
        : "";
      summary = `Stars: ${totalStars} / ${maxStars}${tail}`;
    } else {
      const best = (save.minigameBest && save.minigameBest[id]) || 0;
      summary = `Best: ${best} pts`;
    }
    card.innerHTML = `
      <div>
        <div class="qc-name">${mg.icon || "🎯"}  ${mg.name}</div>
        <div class="qc-desc">${mg.desc}</div>
        <div class="qc-desc">${summary}</div>
      </div>
      <div class="qc-reward">${id === "can_bash" || id === "field_goal" || id === "party_pong" ? "Levels ▶" : "Play ▶"}</div>
    `;
    card.addEventListener("click", () => {
      if (id === "can_bash") openCanBashLevels();
      else if (id === "field_goal") openFieldGoalLevels();
      else if (id === "party_pong") openPartyPongLevels();
      else startMinigame(id);
    });
    list.appendChild(card);
  }
}

function openCanBashLevels() {
  buildCanBashLevelGrid();
  G.state = STATE.CB_LEVELS;
  showOnly("cb-levels");
}

function buildCanBashLevelGrid() {
  const grid = document.getElementById("cb-level-grid");
  grid.innerHTML = "";
  const progress = save.canBashLevels || {};
  CAN_LEVELS.forEach((lvl, idx) => {
    const unlocked = isCanLevelUnlocked(progress, lvl.id);
    const rec = progress[lvl.id];
    const stars = (rec && rec.stars) || 0;
    const card = document.createElement("div");
    card.className = "level-card" + (unlocked ? "" : " locked");
    card.style.setProperty("--i", idx);
    const starsHtml =
      `<span class="lc-stars">` +
      `<span${stars >= 1 ? "" : ' class="empty"'}>★</span>` +
      `<span${stars >= 2 ? "" : ' class="empty"'}>★</span>` +
      `<span${stars >= 3 ? "" : ' class="empty"'}>★</span>` +
      `</span>`;
    card.innerHTML = `
      <div class="lc-name">${unlocked ? "" : "🔒 "}${lvl.name}</div>
      <div class="lc-meta">${lvl.balls} ball${lvl.balls === 1 ? "" : "s"} • ${lvl.formation.type}</div>
      <div class="lc-best">${lvl.subtitle}</div>
      ${starsHtml}
      ${rec && rec.cleared ? `<div class="lc-meta">Best: ${rec.ballsUsed} ball${rec.ballsUsed === 1 ? "" : "s"} • ${rec.score} pts</div>` : ""}
    `;
    if (unlocked) card.addEventListener("click", () => startMinigame("can_bash", lvl.id));
    grid.appendChild(card);
  });
}

function openFieldGoalLevels() {
  buildFieldGoalLevelGrid();
  G.state = STATE.FG_LEVELS;
  showOnly("fg-levels");
}

function buildFieldGoalLevelGrid() {
  const grid = document.getElementById("fg-level-grid");
  grid.innerHTML = "";
  const progress = save.fieldGoalLevels || {};
  // Header row showing the player's lifetime FG records.
  const best = save.fieldGoalBest || {};
  const totalStars = FG_LEVELS.reduce((s, l) => s + ((progress[l.id]?.stars) || 0), 0);
  const maxStars = FG_LEVELS.length * 3;
  const header = document.createElement("div");
  header.className = "fg-bests";
  header.innerHTML = `
    <span><strong>${totalStars}/${maxStars}</strong> ★</span>
    <span><strong>${best.longestMake || 0}</strong> yd long</span>
    <span><strong>${best.bestStreak || 0}</strong> streak</span>
    <span><strong>${best.totalMakes || 0}</strong> makes</span>
  `;
  grid.appendChild(header);
  FG_LEVELS.forEach((lvl, idx) => {
    const unlocked = isFgLevelUnlocked(progress, lvl.id);
    const rec = progress[lvl.id];
    const stars = (rec && rec.stars) || 0;
    const card = document.createElement("div");
    card.className = "level-card" + (unlocked ? "" : " locked");
    card.style.setProperty("--i", idx);
    const starsHtml =
      `<span class="lc-stars">` +
      `<span${stars >= 1 ? "" : ' class="empty"'}>★</span>` +
      `<span${stars >= 2 ? "" : ' class="empty"'}>★</span>` +
      `<span${stars >= 3 ? "" : ' class="empty"'}>★</span>` +
      `</span>`;
    const yards = Math.round(lvl.distance * 1.094);
    card.innerHTML = `
      <div class="lc-name">${unlocked ? "" : "🔒 "}${lvl.name}</div>
      <div class="lc-meta">${yards} yd • ${lvl.attempts} kick${lvl.attempts === 1 ? "" : "s"} • wind ±${lvl.windRange}</div>
      <div class="lc-best">${lvl.subtitle}</div>
      ${starsHtml}
      ${rec ? `<div class="lc-meta">Best: ${rec.made}/${rec.attempts} • ${rec.score} pts</div>` : ""}
    `;
    if (unlocked) card.addEventListener("click", () => startMinigame("field_goal", lvl.id));
    grid.appendChild(card);
  });
}

function openPartyPongLevels() {
  buildPartyPongLevelGrid();
  G.state = STATE.PP_LEVELS;
  showOnly("pp-levels");
}

function buildPartyPongLevelGrid() {
  const grid = document.getElementById("pp-level-grid");
  grid.innerHTML = "";
  const progress = save.partyPongLevels || {};
  // Header row showing the player's lifetime PP records.
  const best = save.partyPongBest || {};
  const totalStars = PP_LEVELS.reduce((s, l) => s + ((progress[l.id]?.stars) || 0), 0);
  const maxStars = PP_LEVELS.length * 3;
  const header = document.createElement("div");
  header.className = "pp-bests";
  header.innerHTML = `
    <span><strong>${totalStars}/${maxStars}</strong> ★</span>
    <span><strong>${best.totalMakes || 0}</strong> cups sunk</span>
    <span><strong>${best.bestStreak || 0}</strong> streak</span>
    <span><strong>${best.rackClears || 0}</strong> racks</span>
  `;
  grid.appendChild(header);
  PP_LEVELS.forEach((lvl, idx) => {
    const unlocked = isPpLevelUnlocked(progress, lvl.id);
    const rec = progress[lvl.id];
    const stars = (rec && rec.stars) || 0;
    const card = document.createElement("div");
    card.className = "level-card" + (unlocked ? "" : " locked");
    card.style.setProperty("--i", idx);
    const starsHtml =
      `<span class="lc-stars">` +
      `<span${stars >= 1 ? "" : ' class="empty"'}>★</span>` +
      `<span${stars >= 2 ? "" : ' class="empty"'}>★</span>` +
      `<span${stars >= 3 ? "" : ' class="empty"'}>★</span>` +
      `</span>`;
    card.innerHTML = `
      <div class="lc-name">${unlocked ? "" : "🔒 "}${lvl.name}</div>
      <div class="lc-meta">${lvl.balls} ball${lvl.balls === 1 ? "" : "s"} • ${lvl.rack.type}</div>
      <div class="lc-best">${lvl.subtitle}</div>
      ${starsHtml}
      ${rec && rec.cleared ? `<div class="lc-meta">Best: ${rec.ballsUsed} ball${rec.ballsUsed === 1 ? "" : "s"} • ${rec.score} pts</div>` : ""}
    `;
    if (unlocked) card.addEventListener("click", () => startMinigame("party_pong", lvl.id));
    grid.appendChild(card);
  });
}

function showResult(completed, extra) {
  const r = G.runtime;
  G.state = STATE.RESULT;
  hideHud();
  const titleEl = document.getElementById("result-title");
  const body = document.getElementById("result-body");
  if (extra && extra.wipeout) {
    titleEl.textContent = `💥 Wiped Out — ${r.level.name}`;
  } else if (completed) {
    titleEl.textContent = `Trail Complete — ${r.level.name}`;
  } else {
    titleEl.textContent = `Run Ended — ${r.level.name}`;
  }
  let html = "";
  html += `<div class="row"><span>Time</span><span>${r.time.toFixed(1)}s</span></div>`;
  html += `<div class="row"><span>Distance</span><span>${Math.floor(r.distance/10)} m</span></div>`;
  html += `<div class="row"><span>Score</span><span>${r.score}</span></div>`;
  html += `<div class="row"><span>Flips</span><span>${r.runStats.flips}</span></div>`;
  html += `<div class="row"><span>Clean Landings</span><span>${r.runStats.cleanLandings}</span></div>`;
  html += `<div class="row"><span>Perfect Landings</span><span>${r.runStats.perfectLandings}</span></div>`;
  html += `<div class="row"><span>Max Combo</span><span>x${r.runStats.maxCombo}</span></div>`;
  html += `<div class="row"><span>Crashes</span><span>${r.runStats.crashes}</span></div>`;
  if (completed) {
    html += `<div class="row bonus"><span>Time bonus</span><span>+$${extra.timeBonus}</span></div>`;
    html += `<div class="row bonus"><span>Distance bonus</span><span>+$${Math.floor(extra.distBonus * 0.5)}</span></div>`;
    html += `<div class="row bonus"><span>Score cash</span><span>+$${extra.cashFromScore}</span></div>`;
  } else if (extra && extra.abandonedEarned != null) {
    html += `<div class="row bonus"><span>Half pay (abandoned)</span><span>+$${extra.abandonedEarned}</span></div>`;
  } else if (extra && extra.wipeout) {
    html += `<div class="row" style="color:var(--bad)"><span>Bike totaled</span><span>40% pay</span></div>`;
    html += `<div class="row bonus"><span>Wipeout payout</span><span>+$${extra.wipeoutEarned}</span></div>`;
  }
  if (completed && save.best[r.level.id]?.medal) {
    const m = save.best[r.level.id].medal;
    html += `<div class="row bonus"><span>Medal</span><span>${medalIcon(m)} ${m.toUpperCase()}</span></div>`;
  }
  html += `<div class="row total"><span>Cash earned</span><span>+$${r.cashEarned}</span></div>`;
  html += `<div class="row"><span>Wallet</span><span>$${save.cash}</span></div>`;
  body.innerHTML = html;
  showOnly("result");
}

function bindMenuActions() {
  function doAction(action) {
    if (typeof Sound !== "undefined" && Sound.ensure) Sound.ensure();
    switch (action) {
      case "play": buildLevelGrid(); G.state = STATE.LEVELS; showOnly("levels"); break;
      case "garage": buildGarage(); G.state = STATE.GARAGE; showOnly("garage"); break;
      case "quests": buildQuests(); G.state = STATE.QUESTS; showOnly("quests"); break;
      case "how": G.state = STATE.HOW; showOnly("how"); break;
      case "back-menu": G.runtime = null; G.state = STATE.MENU; showOnly("menu"); break;
      case "cb-back": G.state = STATE.QUESTS; buildQuests(); showOnly("quests"); break;
      case "fg-back": G.state = STATE.QUESTS; buildQuests(); showOnly("quests"); break;
      case "pp-back": G.state = STATE.QUESTS; buildQuests(); showOnly("quests"); break;
      case "resume": G.state = STATE.PLAY; showOnly("hud"); break;
      case "retry":
        if (G.runtime) startRun(G.runtime.level.id);
        break;
      case "abandon":
        if (G.runtime) abandonRun();
        break;
      case "reset":
        if (confirm("Wipe save? You'll lose cash, parts, and quest progress.")) {
          resetSave();
          persistSave();
          pushToast("Save reset.", "red");
        }
        break;
    }
  }
  function bindOne(el) {
    if (el.__bound) return;
    el.__bound = true;
    el.addEventListener("click", function () { doAction(el.dataset.action); });
  }
  document.querySelectorAll("[data-action]").forEach(bindOne);
  // Re-bind any newly-added [data-action] elements (result/pause overlays).
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.dataset && node.dataset.action) bindOne(node);
        node.querySelectorAll && node.querySelectorAll("[data-action]").forEach(bindOne);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
bindMenuActions();
window.__diag && window.__diag("[boot] menu actions bound to " + document.querySelectorAll("[data-action]").length + " buttons");
// Visible heartbeat so we can tell from the page whether JS finished
// initializing — a tiny marker in the corner of the menu footer.
try {
  const f = document.querySelector("#menu .footer");
  if (f) f.textContent += "  •  v" + (
    document.querySelector('script[src*="main.js"]')?.src.split("?v=")[1] || "dev"
  );
} catch {}

//==========================================================
// MINI-GAMES
//==========================================================
// Each mini-game is a small self-contained module that owns its G.state and
// renders to the main canvas. They share a flick-style input (drag + release
// to launch) routed through canvas pointer events.

function startMinigame(id, levelId) {
  const mg = MINIGAMES[id];
  if (!mg) return;
  Sound.ensure && Sound.ensure();
  Sound.startMusic && Sound.startMusic("game");
  // Resolve the level for level-driven mini-games (currently only Can Bash).
  let level = null;
  if (id === "can_bash") {
    level = (levelId && canLevelById(levelId)) || CAN_LEVELS[0];
  } else if (id === "field_goal") {
    level = (levelId && fgLevelById(levelId)) || FG_LEVELS[0];
  } else if (id === "party_pong") {
    level = (levelId && ppLevelById(levelId)) || PP_LEVELS[0];
  }
  G.minigameRuntime = mg.init(level);
  G.minigameRuntime.id = id;
  G.state = STATE.MINIGAME;
  // Hide every overlay (and the touch UI). The canvas is the whole screen.
  for (const overlay of ["menu","levels","garage","quests","how","result","pause","hud","touch","cb-levels","fg-levels","pp-levels"]) {
    const el = document.getElementById(overlay);
    if (el) el.classList.add("hidden");
  }
}

function settleMinigame() {
  if (!G.minigameRuntime || G.minigameRuntime._settled) return;
  const mg = MINIGAMES[G.minigameRuntime.id];
  if (!mg) return;
  const score = G.minigameRuntime.score || 0;
  const best = save.minigameBest && save.minigameBest[G.minigameRuntime.id];
  const cash = mg.payout ? mg.payout(G.minigameRuntime) : Math.floor(score / 2);
  save.cash += cash;
  save.minigameBest = save.minigameBest || {};
  if (!best || score > best) save.minigameBest[G.minigameRuntime.id] = score;
  persistSave();
  pushToast(`${mg.name}: ${score} pts • +$${cash}`, "gold", 2200);
  G.minigameRuntime._settled = true;
}

function endMinigame() {
  if (!G.minigameRuntime) return;
  settleMinigame();
  G.minigameRuntime = null;
  G.state = STATE.QUESTS;
  buildQuests();
  showOnly("quests");
}

function canvasPointerToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (W / rect.width),
    y: (clientY - rect.top)  * (H / rect.height),
  };
}
function dispatchMinigamePointer(kind, e) {
  if (G.state !== STATE.MINIGAME || !G.minigameRuntime) return;
  e.preventDefault && e.preventDefault();
  const p = canvasPointerToWorld(e.clientX, e.clientY);
  // If the round is over, route the click through the Game Over buttons.
  if (G.minigameRuntime.finished) {
    if (kind === "down" && (!G.minigameRuntime.finishHoldUntil ||
        performance.now() > G.minigameRuntime.finishHoldUntil)) {
      const inBtn = (b) => b && p.x >= b.x && p.x <= b.x + b.w
                              && p.y >= b.y && p.y <= b.y + b.h;
      const rt = G.minigameRuntime;
      if (rt.id === "can_bash") {
        if (inBtn(rt._btnNextLevel)) {
          // Advance to the next unlocked level if it exists; otherwise
          // fall back to retrying the current one.
          const idx = CAN_LEVELS.findIndex(l => l.id === rt.level.id);
          const next = (idx >= 0 && idx + 1 < CAN_LEVELS.length) ? CAN_LEVELS[idx + 1] : null;
          const progress = save.canBashLevels || {};
          if (next && isCanLevelUnlocked(progress, next.id)) {
            G.minigameRuntime = null;
            startMinigame("can_bash", next.id);
          } else {
            G.minigameRuntime = null;
            openCanBashLevels();
          }
        } else if (inBtn(rt._btnRetry)) {
          const lvlId = rt.level.id;
          G.minigameRuntime = null;
          startMinigame("can_bash", lvlId);
        } else if (inBtn(rt._btnLevels)) {
          G.minigameRuntime = null;
          openCanBashLevels();
        }
        return;
      }
      if (rt.id === "field_goal") {
        if (inBtn(rt._btnNextLevel)) {
          Sound.click && Sound.click();
          const idx = FG_LEVELS.findIndex(l => l.id === rt.level.id);
          const next = (idx >= 0 && idx + 1 < FG_LEVELS.length) ? FG_LEVELS[idx + 1] : null;
          const progress = save.fieldGoalLevels || {};
          if (next && isFgLevelUnlocked(progress, next.id)) {
            G.minigameRuntime = null;
            startMinigame("field_goal", next.id);
          } else {
            G.minigameRuntime = null;
            openFieldGoalLevels();
          }
        } else if (inBtn(rt._btnRetry)) {
          Sound.click && Sound.click();
          const lvlId = rt.level.id;
          G.minigameRuntime = null;
          startMinigame("field_goal", lvlId);
        } else if (inBtn(rt._btnLevels)) {
          Sound.click && Sound.click();
          G.minigameRuntime = null;
          openFieldGoalLevels();
        }
        return;
      }
      if (rt.id === "party_pong") {
        if (inBtn(rt._btnNextLevel)) {
          Sound.click && Sound.click();
          const idx = PP_LEVELS.findIndex(l => l.id === rt.level.id);
          const next = (idx >= 0 && idx + 1 < PP_LEVELS.length) ? PP_LEVELS[idx + 1] : null;
          const progress = save.partyPongLevels || {};
          if (next && isPpLevelUnlocked(progress, next.id)) {
            G.minigameRuntime = null;
            startMinigame("party_pong", next.id);
          } else {
            G.minigameRuntime = null;
            openPartyPongLevels();
          }
        } else if (inBtn(rt._btnRetry)) {
          Sound.click && Sound.click();
          const lvlId = rt.level.id;
          G.minigameRuntime = null;
          startMinigame("party_pong", lvlId);
        } else if (inBtn(rt._btnLevels)) {
          Sound.click && Sound.click();
          G.minigameRuntime = null;
          openPartyPongLevels();
        }
        return;
      }
      if (inBtn(rt._btnPlayAgain)) {
        const id = rt.id;
        settleMinigame();
        G.minigameRuntime = null;
        startMinigame(id);
      } else if (inBtn(rt._btnMenu)) {
        endMinigame();
      }
    }
    return;
  }
  const mg = MINIGAMES[G.minigameRuntime.id];
  if (mg && mg.handlePointer) mg.handlePointer(G.minigameRuntime, kind, p.x, p.y);
}
canvas.addEventListener("pointerdown", (e) => dispatchMinigamePointer("down", e));
canvas.addEventListener("pointermove", (e) => dispatchMinigamePointer("move", e));
canvas.addEventListener("pointerup",   (e) => dispatchMinigamePointer("up",   e));
canvas.addEventListener("pointercancel",(e) => dispatchMinigamePointer("up",  e));


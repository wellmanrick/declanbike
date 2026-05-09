/* Declan Bike — Excite Trails
 * Single-file dirt bike side-scroller with bike-builder, upgrades, and side quests.
 * No external libraries. Renders to a 1280x720 canvas.
 */

//==========================================================
// SAVE / LOAD
//==========================================================
const SAVE_KEY = "declanbike.save.v1";

const DEFAULT_SAVE = {
  cash: 250,
  best: {},                       // levelId -> { time, score, distance, completed }
  ownedParts: {                   // partId -> true for owned
    engine_stock: true, tire_stock: true, suspension_stock: true,
    frame_stock: true, paint_red: true,
  },
  equipped: {
    engine: "engine_stock",
    tire: "tire_stock",
    suspension: "suspension_stock",
    frame: "frame_stock",
    paint: "paint_red",
  },
  quests: {},                     // questId -> { progress, done, claimed }
  unlockedLevels: { trail_01: true },
  totals: { distance: 0, flips: 0, airtime: 0, crashes: 0, runs: 0, jumps: 0, cleanLandings: 0, perfectLandings: 0 },
};

function loadSave() {
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
    });
  } catch (e) {
    console.warn("Save load failed", e);
    return structuredClone(DEFAULT_SAVE);
  }
}
function persistSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
}
let save = loadSave();

//==========================================================
// PARTS CATALOG
//==========================================================
// Stat semantics — added to base stats:
//   speedBoost: top speed (mph add)
//   accel: acceleration multiplier (1.0 baseline)
//   grip: how fast bike conforms to slope and recovers (0..1)
//   suspension: how much vertical impact is absorbed (0..1)
//   boostCap: max boost meter
//   boostRegen: boost regeneration per second
//   durability: max health
//   weight: heavier = slower accel but more stable in air

const PARTS = {
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

function partById(id) {
  for (const cat of Object.keys(PARTS)) {
    const p = PARTS[cat].find(p => p.id === id);
    if (p) return { ...p, category: cat };
  }
  return null;
}

function getEquippedStats() {
  const base = {
    topSpeed: 60, accel: 1.0, grip: 0.55, suspension: 0.35,
    boostCap: 100, boostRegen: 8, durability: 100, weight: 1.0, paint: "#e94c3a",
  };
  for (const cat of ["engine","tire","suspension","frame","paint"]) {
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
  return base;
}

//==========================================================
// LEVEL CATALOG
//==========================================================
const LEVELS = [
  { id: "trail_01", name: "Backyard Trail",   length: 2200, seed: 11,  difficulty: 1, hills: 0.6, gaps: 0.2, obstacles: 0.3,
    desc: "An easy warm-up loop. Learn the controls." },
  { id: "trail_02", name: "Pine Ridge",       length: 2800, seed: 23,  difficulty: 2, hills: 1.0, gaps: 0.5, obstacles: 0.5,
    desc: "Rolling hills with the first real ramps.", unlockAfter: "trail_01" },
  { id: "trail_03", name: "Quarry Run",       length: 3400, seed: 47,  difficulty: 3, hills: 1.4, gaps: 0.8, obstacles: 0.8,
    desc: "Big gaps. Bring boost.", unlockAfter: "trail_02" },
  { id: "trail_04", name: "Dunes",            length: 3000, seed: 71,  difficulty: 3, hills: 2.0, gaps: 0.4, obstacles: 0.4,
    desc: "Smooth and rolling. Catch air on every crest.", unlockAfter: "trail_02" },
  { id: "trail_05", name: "Industrial Yard",  length: 3600, seed: 91,  difficulty: 4, hills: 1.0, gaps: 1.0, obstacles: 1.4,
    desc: "Tight obstacles, sharp jumps. Reflex test.", unlockAfter: "trail_03" },
  { id: "trail_06", name: "Mt. Send-It",      length: 4400, seed: 137, difficulty: 5, hills: 2.2, gaps: 1.4, obstacles: 1.0,
    desc: "Final boss. Don't blink.", unlockAfter: "trail_05" },
];

function levelUnlocked(lvl) {
  if (!lvl.unlockAfter) return true;
  if (save.unlockedLevels[lvl.id]) return true;
  return !!(save.best[lvl.unlockAfter] && save.best[lvl.unlockAfter].completed);
}

//==========================================================
// QUEST CATALOG
//==========================================================
// Quests track lifetime progress and pay out cash on claim.
const QUESTS = [
  { id: "q_first_run",  name: "First Run",     desc: "Complete any trail.",                 target: 1,    metric: "completions", reward: 100 },
  { id: "q_distance_1", name: "Long Hauler",   desc: "Cover 5 km total distance.",          target: 5000, metric: "distance",    reward: 200 },
  { id: "q_distance_2", name: "Cross-Country", desc: "Cover 25 km total.",                  target: 25000, metric: "distance",   reward: 800 },
  { id: "q_flips_1",    name: "Backflipper",   desc: "Land 5 flips total.",                 target: 5,    metric: "flips",       reward: 150 },
  { id: "q_flips_2",    name: "Trick Master",  desc: "Land 50 flips total.",                target: 50,   metric: "flips",       reward: 600 },
  { id: "q_air_1",      name: "Bird Brain",    desc: "Rack up 60 seconds of air time.",     target: 60,   metric: "airtime",     reward: 250 },
  { id: "q_combo_1",    name: "Combo Cook",    desc: "Hit a 5x combo in a single run.",     target: 5,    metric: "maxCombo",    reward: 300 },
  { id: "q_combo_2",    name: "Combo Chef",    desc: "Hit a 10x combo in a single run.",    target: 10,  metric: "maxCombo",     reward: 800 },
  { id: "q_clean_1",    name: "Stick the Landing", desc: "Stick 25 clean landings.",        target: 25,   metric: "cleanLandings", reward: 250 },
  { id: "q_perfect",    name: "Perfectionist", desc: "Nail 10 perfect landings (within 3°).",target: 10,  metric: "perfectLandings", reward: 500 },
  { id: "q_jumps",      name: "Send It",       desc: "Catch 50 jumps total.",               target: 50,   metric: "jumps",       reward: 350 },
  { id: "q_crashes",    name: "Tough Skin",    desc: "Survive 10 crashes. Painful but fair.", target: 10, metric: "crashes",     reward: 200 },
  { id: "q_complete_3", name: "Trail Boss",    desc: "Complete 3 different trails.",        target: 3,    metric: "uniqueTrails", reward: 600 },
  { id: "q_complete_all", name: "Excite Champion", desc: "Complete every trail.",           target: LEVELS.length, metric: "uniqueTrails", reward: 1500 },
];

function getQuestProgress(q) {
  const t = save.totals;
  switch (q.metric) {
    case "distance": return Math.floor(t.distance);
    case "flips": return t.flips;
    case "airtime": return Math.floor(t.airtime);
    case "cleanLandings": return t.cleanLandings;
    case "perfectLandings": return t.perfectLandings;
    case "jumps": return t.jumps;
    case "crashes": return t.crashes;
    case "completions": return Object.values(save.best).filter(b => b.completed).length;
    case "uniqueTrails": return Object.values(save.best).filter(b => b.completed).length;
    case "maxCombo": return save.quests[q.id]?.progress || 0;
    default: return 0;
  }
}

function refreshQuestStates(runStats = null) {
  for (const q of QUESTS) {
    const state = save.quests[q.id] || (save.quests[q.id] = { progress: 0, done: false, claimed: false });
    if (q.metric === "maxCombo" && runStats) {
      if (runStats.maxCombo > state.progress) state.progress = runStats.maxCombo;
    }
    const prog = getQuestProgress(q);
    if (!state.done && prog >= q.target) {
      state.done = true;
      pushToast(`Quest done: ${q.name}`, "gold");
    }
  }
  // Auto-claim rewards on completion
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

//==========================================================
// CANVAS / RENDER GLOBALS
//==========================================================
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;

// scale-to-fit handler — letterbox
function resizeCanvas() {
  const ratio = W / H;
  const wRatio = window.innerWidth / window.innerHeight;
  let cw, ch;
  if (wRatio > ratio) { ch = window.innerHeight; cw = ch * ratio; }
  else { cw = window.innerWidth; ch = cw / ratio; }
  document.getElementById("app").style.width = cw + "px";
  document.getElementById("app").style.height = ch + "px";
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

//==========================================================
// INPUT
//==========================================================
const keys = new Set();
const justPressed = new Set();
window.addEventListener("keydown", (e) => {
  if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Space"].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) justPressed.add(e.code);
  keys.add(e.code);
});
window.addEventListener("keyup", (e) => { keys.delete(e.code); });
function input() {
  return {
    throttle: keys.has("ArrowRight") || keys.has("KeyD"),
    brake:    keys.has("ArrowLeft")  || keys.has("KeyA"),
    leanFwd:  keys.has("ArrowUp")    || keys.has("KeyW"),
    leanBack: keys.has("ArrowDown")  || keys.has("KeyS"),
    boost:    keys.has("Space"),
    preload:  keys.has("ShiftLeft")  || keys.has("ShiftRight"),
  };
}

// Touch controls — simulate key state on press/hold.
const isTouchDevice = (("ontouchstart" in window) || (navigator.maxTouchPoints > 0));
function setupTouchControls() {
  const touchEl = document.getElementById("touch");
  if (!touchEl) return;
  if (isTouchDevice) touchEl.classList.add("show");

  const buttons = touchEl.querySelectorAll(".tbtn");
  for (const btn of buttons) {
    const code = btn.dataset.key;
    const press = (e) => {
      e.preventDefault();
      btn.classList.add("held");
      if (code === "Escape") {
        // Treat as one-shot
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
    // Mouse fallback (desktop testing)
    btn.addEventListener("mousedown", press);
    btn.addEventListener("mouseup", release);
    btn.addEventListener("mouseleave", release);
    // Prevent context menu on long-press
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}

//==========================================================
// PRNG (seedable)
//==========================================================
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

//==========================================================
// TERRAIN GENERATION
//==========================================================
const TERRAIN_DX = 8;            // sample spacing in world px
const GROUND_BASE = 540;         // base ground y
const SCROLL_SPEED_REF = 1.0;    // for camera scaling

function buildTerrain(level) {
  const rand = mulberry32(level.seed);
  const samples = Math.ceil(level.length / TERRAIN_DX) + 100;
  const heights = new Float32Array(samples);
  const obstacles = []; // { x, y, type, r, hit:false }
  const collectibles = []; // { x, y, type, taken:false }
  const ramps = []; // { x, y, w, h }
  const checkpoints = [];

  // base hills via layered sin waves
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

  // smooth a flat start (~0..240) and finish pad
  for (let i = 0; i < 30; i++) heights[i] = GROUND_BASE;
  const lastSamples = Math.floor(level.length / TERRAIN_DX);
  for (let i = lastSamples - 30; i <= lastSamples + 60 && i < samples; i++) heights[i] = GROUND_BASE - 20;

  // place ramps (positive bumps) & gaps (negative dips)
  const ramCount = Math.floor(level.length / 350 * level.gaps + 4);
  for (let n = 0; n < ramCount; n++) {
    const cx = 350 + rand() * (level.length - 700);
    const w = 80 + rand() * 80;
    const h = 60 + rand() * 70 * level.gaps;
    const ci = Math.floor(cx / TERRAIN_DX);
    const halfSamples = Math.ceil(w / TERRAIN_DX);
    for (let k = -halfSamples; k <= halfSamples; k++) {
      const idx = ci + k;
      if (idx < 30 || idx >= lastSamples - 30) continue;
      const t = k / halfSamples; // -1..1
      // ramp curve: slow rise, sharp drop after peak (or symmetric)
      const profile = Math.cos(t * Math.PI * 0.5);
      heights[idx] -= h * Math.max(0, profile);
    }
    ramps.push({ x: cx, y: GROUND_BASE - h, w, h });
  }

  // gaps (lower ground)
  const gapCount = Math.floor(level.gaps * 4);
  for (let n = 0; n < gapCount; n++) {
    const cx = 600 + rand() * (level.length - 1100);
    const w = 50 + rand() * 80 * level.gaps;
    const ci = Math.floor(cx / TERRAIN_DX);
    const halfSamples = Math.ceil(w / TERRAIN_DX);
    for (let k = -halfSamples; k <= halfSamples; k++) {
      const idx = ci + k;
      if (idx < 30 || idx >= lastSamples - 30) continue;
      const t = k / halfSamples;
      const profile = Math.cos(t * Math.PI * 0.5);
      heights[idx] += 90 * profile;
    }
  }

  // obstacles
  const obsCount = Math.floor(level.length / 300 * level.obstacles);
  for (let n = 0; n < obsCount; n++) {
    const x = 400 + rand() * (level.length - 800);
    const i = Math.floor(x / TERRAIN_DX);
    const y = heights[i];
    const r = rand();
    let type;
    if (r < 0.5) type = "rock";
    else if (r < 0.85) type = "tire";
    else type = "log";
    obstacles.push({ x, y, type, r: 14 + rand() * 8, hit: false });
  }

  // collectibles — gold bolts above peaks and over gaps
  const collectCount = Math.floor(level.length / 180);
  for (let n = 0; n < collectCount; n++) {
    const x = 350 + rand() * (level.length - 700);
    const i = Math.floor(x / TERRAIN_DX);
    const groundY = heights[i];
    const y = groundY - 60 - rand() * 110;
    collectibles.push({ x, y, type: rand() < 0.1 ? "gem" : "bolt", taken: false, bob: rand() * Math.PI * 2 });
  }

  // checkpoints every ~700px
  for (let cx = 700; cx < level.length - 100; cx += 700) {
    const i = Math.floor(cx / TERRAIN_DX);
    checkpoints.push({ x: cx, y: heights[i] });
  }

  return { heights, obstacles, collectibles, ramps, checkpoints };
}

function terrainHeightAt(terrain, x) {
  if (x < 0) return GROUND_BASE;
  const idx = x / TERRAIN_DX;
  const i0 = Math.floor(idx);
  const i1 = i0 + 1;
  if (i1 >= terrain.heights.length) return terrain.heights[terrain.heights.length - 1];
  const t = idx - i0;
  return terrain.heights[i0] * (1 - t) + terrain.heights[i1] * t;
}
function terrainSlopeAt(terrain, x) {
  const dx = 6;
  const y0 = terrainHeightAt(terrain, x - dx);
  const y1 = terrainHeightAt(terrain, x + dx);
  return Math.atan2(y1 - y0, 2 * dx); // positive = downhill
}

//==========================================================
// GAME STATE
//==========================================================
const STATE = {
  MENU: "menu",
  LEVELS: "levels",
  GARAGE: "garage",
  QUESTS: "quests",
  HOW: "how",
  PLAY: "play",
  PAUSE: "pause",
  RESULT: "result",
};
let state = STATE.MENU;
let runtime = null; // active run

function startRun(levelId) {
  const level = LEVELS.find(l => l.id === levelId);
  if (!level) return;
  const terrain = buildTerrain(level);
  const stats = getEquippedStats();
  const startX = 120;
  const startY = terrainHeightAt(terrain, startX);
  runtime = {
    level, terrain, stats,
    bike: {
      x: startX, y: startY, vx: 80, vy: 0,
      angle: 0, angVel: 0,
      onGround: true,
      airtime: 0,
      lastGroundedAt: performance.now(),
      preload: 0,
      currentFlipRot: 0,
      pendingFlips: 0,
      pendingDirection: 0,
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
    runStats: { flips: 0, airtime: 0, jumps: 0, cleanLandings: 0, perfectLandings: 0, crashes: 0, maxCombo: 1, collectibles: 0, gems: 0 },
    finishLineX: level.length - 60,
    paused: false,
    finishedAt: null,
  };
  state = STATE.PLAY;
  showOnly("hud");
}

//==========================================================
// PHYSICS
//==========================================================
const GRAVITY = 1100;             // px/s^2
const TOP_SPEED_PX = (mph) => mph * 6;  // arbitrary mapping for visual speed
const FRICTION_GROUND = 0.998;
const FRICTION_AIR = 0.9995;

function updateBike(dt) {
  const r = runtime;
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
      b.pendingFlips = 0;
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
  const onGround = (b.y >= groundY - 4);

  // Shift "preload" charges a hop on takeoff
  if (inp.preload && onGround) b.preload = Math.min(1, b.preload + dt * 2.5);
  if (!inp.preload) b.preload = Math.max(0, b.preload - dt * 4);

  if (onGround && !b.onGround) {
    // landing event
    handleLanding(slopeAngle);
  }
  if (!onGround && b.onGround) {
    // takeoff event
    b.airtime = 0;
    b.currentFlipRot = 0;
    if (b.preload > 0.4) {
      b.vy -= 220 * b.preload;
      b.preload = 0;
    }
    r.runStats.jumps++;
    pushToast("Air!", "gold", 800);
  }
  b.onGround = onGround;

  if (onGround) {
    // align to slope smoothly
    const target = slopeAngle;
    const angleDiff = wrapAngle(target - b.angle);
    // grip controls how quickly the bike stabilizes
    b.angle += clamp(angleDiff, -dt * (4 + stats.grip * 6), dt * (4 + stats.grip * 6));
    b.angVel = 0;

    // throttle
    let thrust = 0;
    if (inp.throttle) thrust = 950 * stats.accel / stats.weight;
    if (inp.brake) thrust = -700;
    // boost
    if (inp.boost && b.boost > 1 && (inp.throttle || b.vx > 50)) {
      thrust += 700;
      b.boost = Math.max(0, b.boost - 35 * dt);
      spawnExhaustParticles(true);
    } else {
      b.boost = Math.min(stats.boostCap, b.boost + stats.boostRegen * dt);
    }
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
        b.y -= 6; // detach from ground
        b.vy = -Math.min(b.vx * 0.28, 320);
        b.airtime = 0;
        b.currentFlipRot = 0;
        if (b.preload > 0.4) { b.vy -= 200 * b.preload; b.preload = 0; }
        r.runStats.jumps++;
      }
    }

    // engine hum heat
    b.throttleHeat = clamp(b.throttleHeat + (inp.throttle ? dt * 1.5 : -dt * 1.0), 0, 1);
    // exhaust particles when throttling
    if (inp.throttle && Math.random() < 0.35) spawnExhaustParticles(false);
  } else {
    // air
    b.airtime += dt;
    r.runStats.airtime += dt;
    // gravity
    b.vy += GRAVITY * dt;
    // boost in air slightly extends jumps
    if (inp.boost && b.boost > 1) {
      const dir = b.vx >= 0 ? 1 : -1;
      b.vx += dir * 350 * dt;
      b.vy -= 140 * dt;
      b.boost = Math.max(0, b.boost - 35 * dt);
      spawnExhaustParticles(true);
    }
    // rotation control. Heavier frames rotate slower.
    const rotForce = 7.0 / stats.weight;
    if (inp.leanFwd)  b.angVel += rotForce * dt; // nose down -> front flip when moving right
    if (inp.leanBack) b.angVel -= rotForce * dt; // nose up -> back flip
    // mild damping
    b.angVel *= Math.pow(0.995, dt * 60);
    b.angle += b.angVel * dt;
    b.currentFlipRot += b.angVel * dt;

    // simple air drag
    b.vx *= Math.pow(FRICTION_AIR, dt * 60);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

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

  // obstacle collision
  for (const obs of r.terrain.obstacles) {
    if (obs.hit) continue;
    const dx = b.x - obs.x;
    const dy = b.y - obs.y;
    const d2 = dx*dx + dy*dy;
    if (d2 < (obs.r + 18) * (obs.r + 18)) {
      obs.hit = true;
      crash(`Hit a ${obs.type}!`);
      return;
    }
  }
  // collectibles
  for (const c of r.terrain.collectibles) {
    if (c.taken) continue;
    const dx = b.x - c.x;
    const dy = b.y - c.y;
    if (dx*dx + dy*dy < 30*30) {
      c.taken = true;
      if (c.type === "gem") { r.cashEarned += 50; r.score += 250; r.runStats.gems++; pushFloating("+$50", c.x, c.y, "#6ee7ff"); }
      else { r.cashEarned += 5; r.score += 25; r.runStats.collectibles++; pushFloating("+$5", c.x, c.y, "#ffc940"); }
    }
  }
}

function handleLanding(slopeAngle) {
  const r = runtime;
  const b = r.bike;
  const angDiff = Math.abs(wrapAngle(b.angle - slopeAngle));
  const angDiffDeg = angDiff * 180 / Math.PI;

  const flips = Math.round(b.currentFlipRot / (Math.PI * 2));
  const absFlips = Math.abs(flips);

  if (angDiffDeg < 25) {
    // Clean / perfect
    let bonus = 0;
    let label = "Clean!";
    if (angDiffDeg < 4) {
      label = "Perfect!"; bonus += 100;
      r.runStats.perfectLandings++;
      save.totals.perfectLandings++;
    } else {
      bonus += 30;
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
    } else {
      pushToast(label, "green", 800);
    }
    if (r.combo > r.runStats.maxCombo) r.runStats.maxCombo = r.combo;
    r.score += bonus;
    r.cashEarned += Math.floor(bonus * 0.05);
    pushFloating(`+${bonus}`, b.x, b.y - 30, "#ffb020");
    // snap angle
    b.angle = slopeAngle;
    b.angVel = 0;

    // suspension absorbs vertical
    const absorb = r.stats.suspension;
    b.vy *= (1 - absorb) * 0.4;
  } else {
    // bad landing
    crash("Bailed!");
  }
  b.currentFlipRot = 0;
}

function crash(reason) {
  const r = runtime;
  const b = r.bike;
  if (b.crashed) return;
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
}

function finishRun() {
  const r = runtime;
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

  const lvl = r.level;
  const prev = save.best[lvl.id] || { score: 0, time: Infinity, distance: 0, completed: false };
  save.best[lvl.id] = {
    completed: true,
    score: Math.max(prev.score, r.score + (timeBonus + distBonus)),
    time: Math.min(prev.time, r.time),
    distance: Math.max(prev.distance, distM),
  };
  // unlock next levels
  for (const L of LEVELS) {
    if (L.unlockAfter === lvl.id) save.unlockedLevels[L.id] = true;
  }

  refreshQuestStates(r.runStats);
  persistSave();

  r.finishedAt = performance.now();
  setTimeout(() => showResult(true, { timeBonus, distBonus, cashFromScore }), 700);
}

function abandonRun() {
  if (!runtime) return;
  const r = runtime;
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
}

//==========================================================
// PARTICLES & FLOATING TEXT
//==========================================================
function spawnExhaustParticles(isBoost) {
  const r = runtime;
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
function spawnCrashParticles() {
  const r = runtime;
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
function pushFloating(text, x, y, color) {
  if (!runtime) return;
  runtime.floatingTexts.push({ text, x, y, vy: -60, life: 1.2, maxLife: 1.2, color });
}

//==========================================================
// TOASTS
//==========================================================
function pushToast(text, kind = "gold", ttl = 1500) {
  const stack = document.getElementById("toast-stack");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  stack.appendChild(el);
  setTimeout(() => el.remove(), ttl + 400);
}

//==========================================================
// RENDERING
//==========================================================
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function wrapAngle(a) {
  while (a > Math.PI)  a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function render() {
  const r = runtime;
  ctx.clearRect(0, 0, W, H);

  // sky
  drawSky();

  if (!r) return;

  // camera
  const targetX = r.bike.x - W * 0.35;
  const targetY = r.bike.y - H * 0.55;
  r.cam.x = lerp(r.cam.x, Math.max(0, targetX), 0.12);
  r.cam.y = lerp(r.cam.y, clamp(targetY, GROUND_BASE - H * 0.7, GROUND_BASE - H * 0.4), 0.08);

  // parallax mountains
  drawMountains(r.cam.x);
  drawTrees(r.cam.x);

  ctx.save();
  ctx.translate(-Math.floor(r.cam.x), -Math.floor(r.cam.y));

  drawTerrain(r.terrain, r.cam.x);
  drawCheckpoints(r.terrain, r.cam.x);
  drawObstacles(r.terrain, r.cam.x);
  drawCollectibles(r.terrain, r.cam.x);
  drawFinishLine(r.finishLineX, r.terrain);

  // particles behind bike
  drawParticles();

  drawBike(r.bike, r.stats);
  drawFloatingTexts();
  ctx.restore();

  // foreground UI overlay (speed lines for boost)
  if (input().boost && runtime.bike.boost > 1) drawSpeedLines();

  updateHUD();
}

function lerp(a, b, t) { return a + (b - a) * t; }

function drawSky() {
  // gradient already set on canvas via CSS, but draw a sun/cloud feel
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0d1226");
  g.addColorStop(0.55, "#3a3050");
  g.addColorStop(1, "#5a3340");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // sun
  ctx.fillStyle = "rgba(255, 180, 80, 0.25)";
  ctx.beginPath();
  ctx.arc(W * 0.78, H * 0.28, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 220, 140, 0.35)";
  ctx.beginPath();
  ctx.arc(W * 0.78, H * 0.28, 80, 0, Math.PI * 2);
  ctx.fill();
}

function drawMountains(camX) {
  const par = camX * 0.15;
  ctx.fillStyle = "#2a2444";
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W + 200; x += 60) {
    const wx = x + par;
    const y = 380 + Math.sin(wx * 0.005) * 50 + Math.sin(wx * 0.013 + 1.3) * 25;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  const par2 = camX * 0.3;
  ctx.fillStyle = "#1c1a30";
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W + 200; x += 50) {
    const wx = x + par2;
    const y = 460 + Math.sin(wx * 0.008 + 2.1) * 40 + Math.sin(wx * 0.017) * 18;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

function drawTrees(camX) {
  const par = camX * 0.55;
  ctx.fillStyle = "#0e1a18";
  for (let x = -par % 40; x < W; x += 40) {
    const h = 25 + ((x * 13 + Math.floor(par/40) * 7) % 30);
    const baseY = 540;
    ctx.beginPath();
    ctx.moveTo(x - 8, baseY);
    ctx.lineTo(x, baseY - h);
    ctx.lineTo(x + 8, baseY);
    ctx.closePath();
    ctx.fill();
  }
}

function drawTerrain(terrain, camX) {
  const startX = Math.max(0, camX - 40);
  const endX = camX + W + 40;
  const startI = Math.max(0, Math.floor(startX / TERRAIN_DX));
  const endI = Math.min(terrain.heights.length - 1, Math.ceil(endX / TERRAIN_DX));

  // Dirt fill
  ctx.fillStyle = "#5a3a26";
  ctx.beginPath();
  ctx.moveTo(startI * TERRAIN_DX, GROUND_BASE + 600);
  for (let i = startI; i <= endI; i++) {
    ctx.lineTo(i * TERRAIN_DX, terrain.heights[i]);
  }
  ctx.lineTo(endI * TERRAIN_DX, GROUND_BASE + 600);
  ctx.closePath();
  ctx.fill();

  // top stripe (grass / dirt edge)
  ctx.strokeStyle = "#a06a3c";
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = startI; i <= endI; i++) {
    const x = i * TERRAIN_DX;
    const y = terrain.heights[i];
    if (i === startI) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Texture lines
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
}

function drawCheckpoints(terrain, camX) {
  for (const cp of terrain.checkpoints) {
    if (cp.x < camX - 50 || cp.x > camX + W + 50) continue;
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

function drawObstacles(terrain, camX) {
  for (const o of terrain.obstacles) {
    if (o.hit) continue;
    if (o.x < camX - 80 || o.x > camX + W + 80) continue;
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
    if (c.x < camX - 40 || c.x > camX + W + 40) continue;
    const bobY = c.y + Math.sin(t * 3 + c.bob) * 4;
    if (c.type === "gem") {
      ctx.fillStyle = "#6ee7ff";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x, bobY - 14);
      ctx.lineTo(c.x + 10, bobY);
      ctx.lineTo(c.x, bobY + 14);
      ctx.lineTo(c.x - 10, bobY);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = "#ffc940";
      ctx.strokeStyle = "#7a4a00";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, bobY, 8, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
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
  const r = runtime;
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
  const r = runtime;
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

function drawBike(b, stats) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);

  // shadow under (only if airborne — show ground shadow)
  ctx.restore();
  if (!b.onGround && runtime) {
    const groundY = terrainHeightAt(runtime.terrain, b.x);
    const dist = Math.max(0, groundY - b.y);
    const shadowScale = clamp(1 - dist / 400, 0.2, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.35 * shadowScale})`;
    ctx.beginPath();
    ctx.ellipse(b.x, groundY + 2, 30 * shadowScale, 6 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);

  // Bike body
  // wheels
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 4;
  ctx.fillStyle = "#1a1a1a";
  // back wheel
  ctx.beginPath(); ctx.arc(-22, 0, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // front wheel
  ctx.beginPath(); ctx.arc(22, 0, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // wheel rims
  ctx.strokeStyle = "#666";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(-22, 0, 5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(22, 0, 5, 0, Math.PI * 2); ctx.stroke();
  // engine block
  ctx.fillStyle = "#444";
  ctx.fillRect(-8, -8, 16, 14);
  // gas tank / main body — paint color
  ctx.fillStyle = stats.paint;
  ctx.beginPath();
  ctx.moveTo(-22, -6);
  ctx.lineTo(0, -16);
  ctx.lineTo(18, -10);
  ctx.lineTo(22, -2);
  ctx.lineTo(-18, -2);
  ctx.closePath();
  ctx.fill();
  // forks (front)
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(20, -14);
  ctx.stroke();
  // handlebars
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(20, -14);
  ctx.lineTo(28, -22);
  ctx.stroke();
  // rear suspension
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.lineTo(-10, -8);
  ctx.stroke();
  // seat
  ctx.fillStyle = "#0f0f0f";
  ctx.fillRect(-18, -14, 14, 4);

  // RIDER — leans with input
  const inp = input();
  let leanX = 0, leanY = 0;
  if (b.onGround) {
    if (inp.brake) leanX = -3;
    if (inp.leanFwd) { leanX = 3; leanY = -2; }
    if (inp.throttle) leanY = -1;
  }
  // body
  ctx.fillStyle = "#2a3350";
  ctx.fillRect(-4 + leanX, -32 + leanY, 12, 18);
  // helmet
  ctx.fillStyle = stats.paint;
  ctx.beginPath();
  ctx.arc(2 + leanX, -36 + leanY, 7, 0, Math.PI * 2);
  ctx.fill();
  // visor
  ctx.fillStyle = "#aafaff";
  ctx.fillRect(2 + leanX, -38 + leanY, 6, 4);
  // arms
  ctx.strokeStyle = "#2a3350";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(2 + leanX, -22 + leanY);
  ctx.lineTo(24, -18);
  ctx.stroke();
  // legs
  ctx.beginPath();
  ctx.moveTo(0 + leanX, -16 + leanY);
  ctx.lineTo(-10, -4);
  ctx.stroke();

  ctx.restore();
}

function drawSpeedLines() {
  ctx.strokeStyle = "rgba(110, 231, 255, 0.5)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    const y = (Math.random() * H);
    const len = 60 + Math.random() * 120;
    const x = Math.random() * W;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - len, y);
    ctx.stroke();
  }
}

//==========================================================
// HUD
//==========================================================
function updateHUD() {
  if (!runtime) return;
  const r = runtime;
  const speedMph = Math.round(r.bike.vx / 6);
  document.getElementById("hud-speed").textContent = Math.max(0, speedMph);
  document.getElementById("hud-boost").style.width = `${(r.bike.boost / r.stats.boostCap) * 100}%`;
  document.getElementById("hud-health").style.width = `${(r.bike.health / r.stats.durability) * 100}%`;
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
  for (const overlay of ["menu","levels","garage","quests","how","result","pause","hud"]) {
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
    card.innerHTML = `
      <div class="lc-name">${unlocked ? "" : "🔒 "}${lvl.name}</div>
      <div class="lc-meta">Difficulty ${"★".repeat(lvl.difficulty)}${"☆".repeat(5 - lvl.difficulty)} • ${lvl.length}m</div>
      <div class="lc-best">${best && best.completed
        ? `Best: ${best.score} pts • ${best.time.toFixed(1)}s`
        : "Not completed"}</div>
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
  for (const p of PARTS[tab]) {
    const owned = !!save.ownedParts[p.id];
    const equipped = save.equipped[tab] === p.id;
    const card = document.createElement("div");
    card.className = "part-card" + (equipped ? " equipped" : "") + (owned || save.cash >= p.cost ? "" : " locked");
    const stats = Object.entries(p.stats).filter(([k,v]) => k !== "paint")
      .map(([k,v]) => `${k}: ${typeof v === "number" ? v : v}`).join("  •  ");
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
      save.equipped[tab] = p.id;
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
  // copy of drawBike without input/runtime deps
  g.strokeStyle = "#222"; g.lineWidth = 4;
  g.fillStyle = "#1a1a1a";
  g.beginPath(); g.arc(-22, 0, 12, 0, Math.PI * 2); g.fill(); g.stroke();
  g.beginPath(); g.arc(22, 0, 12, 0, Math.PI * 2); g.fill(); g.stroke();
  g.strokeStyle = "#666"; g.lineWidth = 1.5;
  g.beginPath(); g.arc(-22, 0, 5, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(22, 0, 5, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#444"; g.fillRect(-8, -8, 16, 14);
  g.fillStyle = stats.paint;
  g.beginPath();
  g.moveTo(-22, -6); g.lineTo(0, -16); g.lineTo(18, -10); g.lineTo(22, -2); g.lineTo(-18, -2);
  g.closePath(); g.fill();
  g.strokeStyle = "#888"; g.lineWidth = 3;
  g.beginPath(); g.moveTo(22, 0); g.lineTo(20, -14); g.stroke();
  g.strokeStyle = "#222"; g.lineWidth = 3;
  g.beginPath(); g.moveTo(20, -14); g.lineTo(28, -22); g.stroke();
  g.strokeStyle = "#888"; g.lineWidth = 3;
  g.beginPath(); g.moveTo(-22, 0); g.lineTo(-10, -8); g.stroke();
  g.fillStyle = "#0f0f0f"; g.fillRect(-18, -14, 14, 4);
  g.fillStyle = "#2a3350"; g.fillRect(-4, -32, 12, 18);
  g.fillStyle = stats.paint; g.beginPath(); g.arc(2, -36, 7, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#aafaff"; g.fillRect(2, -38, 6, 4);
  g.strokeStyle = "#2a3350"; g.lineWidth = 4;
  g.beginPath(); g.moveTo(2, -22); g.lineTo(24, -18); g.stroke();
  g.beginPath(); g.moveTo(0, -16); g.lineTo(-10, -4); g.stroke();
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
  const list = document.getElementById("quests-list");
  list.innerHTML = "";
  for (const q of QUESTS) {
    const s = save.quests[q.id] || { progress: 0, done: false };
    const prog = getQuestProgress(q);
    const done = s.done;
    const card = document.createElement("div");
    card.className = "quest-card" + (done ? " done" : "");
    card.innerHTML = `
      <div>
        <div class="qc-name">${q.name}</div>
        <div class="qc-desc">${q.desc}</div>
        <div class="qc-desc">Progress: ${Math.min(prog, q.target)} / ${q.target}</div>
      </div>
      <div class="qc-reward">$${q.reward}</div>
    `;
    list.appendChild(card);
  }
}

function showResult(completed, extra) {
  const r = runtime;
  state = STATE.RESULT;
  hideHud();
  const titleEl = document.getElementById("result-title");
  const body = document.getElementById("result-body");
  titleEl.textContent = completed ? `Trail Complete — ${r.level.name}` : `Run Ended — ${r.level.name}`;
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
  }
  html += `<div class="row total"><span>Cash earned</span><span>+$${r.cashEarned}</span></div>`;
  html += `<div class="row"><span>Wallet</span><span>$${save.cash}</span></div>`;
  body.innerHTML = html;
  showOnly("result");
}

function bindMenuActions() {
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const action = t.dataset.action;
    switch (action) {
      case "play": buildLevelGrid(); state = STATE.LEVELS; showOnly("levels"); break;
      case "garage": buildGarage(); state = STATE.GARAGE; showOnly("garage"); break;
      case "quests": buildQuests(); state = STATE.QUESTS; showOnly("quests"); break;
      case "how": state = STATE.HOW; showOnly("how"); break;
      case "back-menu": runtime = null; state = STATE.MENU; showOnly("menu"); break;
      case "resume": state = STATE.PLAY; showOnly("hud"); break;
      case "retry":
        if (runtime) startRun(runtime.level.id);
        break;
      case "reset":
        if (confirm("Wipe save? You'll lose cash, parts, and quest progress.")) {
          save = structuredClone(DEFAULT_SAVE);
          persistSave();
          pushToast("Save reset.", "red");
        }
        break;
    }
  });
}
bindMenuActions();

//==========================================================
// LOOP
//==========================================================
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  // Pause toggle
  if (justPressed.has("Escape")) {
    justPressed.delete("Escape");
    if (state === STATE.PLAY) { state = STATE.PAUSE; showOnly("pause"); }
    else if (state === STATE.PAUSE) { state = STATE.PLAY; showOnly("hud"); }
    else if (state === STATE.LEVELS || state === STATE.GARAGE || state === STATE.QUESTS || state === STATE.HOW || state === STATE.RESULT) {
      runtime = null; state = STATE.MENU; showOnly("menu");
    }
  }
  if (justPressed.has("KeyR") && state === STATE.PLAY && runtime) {
    justPressed.delete("KeyR");
    startRun(runtime.level.id);
  }

  if (state === STATE.PLAY && runtime) {
    runtime.time += dt;
    updateBike(dt);
    // particles update
    for (let i = runtime.particles.length - 1; i >= 0; i--) {
      const p = runtime.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
      if (p.life <= 0) runtime.particles.splice(i, 1);
    }
    for (let i = runtime.floatingTexts.length - 1; i >= 0; i--) {
      const f = runtime.floatingTexts[i];
      f.life -= dt;
      f.y += f.vy * dt;
      if (f.life <= 0) runtime.floatingTexts.splice(i, 1);
    }
  }

  render();
  justPressed.clear();
  requestAnimationFrame(loop);
}

// Boot
showOnly("menu");
setupTouchControls();
refreshQuestStates();
requestAnimationFrame(loop);

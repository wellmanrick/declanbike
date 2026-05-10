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

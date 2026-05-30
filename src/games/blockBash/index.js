// Block Bash — Minecraft-inspired tap-to-mine minigame.
//
// Implements the Minigame contract documented above MINIGAMES in main.js.
// No levels: single 60-second round, max score on a randomly-generated
// pixelated tile grid. Tap exposed blocks to mine; harder ores need more
// hits but pay out more. Combo multiplier mirrors Duck Hunt.
//
// Dependencies kept intentionally narrow — ctx/W/H + Sound — same pattern
// as Duck Hunt so the file drops in cleanly.

import { ctx, W, H } from "../../engine/canvas.js";
import { Sound } from "../../engine/audio.js";

const GRID_COLS = 12;
const TIME_LIMIT = 60;
const COMBO_WINDOW = 1.2;
const COMBO_CAP = 5;

// Tile catalog. Keyed by integer so the grid is a flat Int8Array.
// hits = taps to break, score = base points, palette = [base, light, dark]
// for the cube-face shading, speck = [color, count] for ore flecks (null
// for plain blocks).
const TILES = {
  0: { name: "air",     hits: 0, score: 0,   palette: null,                              speck: null },
  1: { name: "grass",   hits: 1, score: 2,   palette: ["#5cb04c", "#7ec96b", "#3f8a36"], speck: null },
  2: { name: "dirt",    hits: 1, score: 1,   palette: ["#9b6b3f", "#b9824f", "#724b27"], speck: ["#5e3a1d", 4] },
  3: { name: "stone",   hits: 2, score: 5,   palette: ["#8a8a8a", "#a8a8a8", "#5f5f5f"], speck: ["#6e6e6e", 3] },
  4: { name: "coal",    hits: 2, score: 15,  palette: ["#7a7a7a", "#969696", "#525252"], speck: ["#1a1a1a", 5] },
  5: { name: "iron",    hits: 3, score: 40,  palette: ["#9c9c9c", "#bcbcbc", "#6a6a6a"], speck: ["#d9a273", 5] },
  6: { name: "gold",    hits: 3, score: 100, palette: ["#8c8c8c", "#a8a8a8", "#5f5f5f"], speck: ["#ffd83a", 5] },
  7: { name: "diamond", hits: 4, score: 250, palette: ["#8c8c8c", "#a8a8a8", "#5f5f5f"], speck: ["#5ef0ff", 5] },
  8: { name: "bedrock", hits: 0, score: 0,   palette: ["#3a3a3a", "#525252", "#1a1a1a"], speck: ["#2a2a2a", 5] }, // unbreakable
};

function generateGrid(rows) {
  // Single-row prefix of sky, then grass, then biome layers. Random ore
  // sprinkles get denser/more valuable as depth increases.
  const grid = new Int8Array(GRID_COLS * rows);
  const set = (c, r, v) => { grid[r * GRID_COLS + c] = v; };

  const SKY_ROWS = 1;
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < rows; r++) {
      let tile;
      if (r < SKY_ROWS) tile = 0;
      else if (r === SKY_ROWS) tile = 1;           // grass cap
      else if (r < SKY_ROWS + 4) tile = 2;         // dirt band
      else if (r === rows - 1) tile = 8;           // bedrock floor
      else {
        // Stone layer with depth-weighted ore odds. Coal common up top,
        // iron mid, gold/diamond rare and deeper.
        const depth = (r - SKY_ROWS - 4) / Math.max(1, rows - SKY_ROWS - 5);
        const roll = Math.random();
        if      (roll < 0.05 + depth * 0.02)                     tile = 4; // coal
        else if (roll < 0.07 + depth * 0.08 && depth > 0.20)     tile = 5; // iron
        else if (roll < 0.09 + depth * 0.06 && depth > 0.55)     tile = 6; // gold
        else if (roll < 0.10 + depth * 0.04 && depth > 0.75)     tile = 7; // diamond
        else                                                      tile = 3; // stone
      }
      set(c, r, tile);
    }
  }
  return grid;
}

function isExposed(grid, rows, c, r) {
  if (c < 0 || c >= GRID_COLS || r < 0 || r >= rows) return false;
  const t = grid[r * GRID_COLS + c];
  if (t === 0) return false;
  // Border counts as air. Any 4-neighbor air → exposed.
  if (r === 0) return true;
  const up    = grid[(r - 1) * GRID_COLS + c];
  const down  = r < rows - 1 ? grid[(r + 1) * GRID_COLS + c] : 8;
  const left  = c > 0          ? grid[r * GRID_COLS + (c - 1)] : 8;
  const right = c < GRID_COLS-1 ? grid[r * GRID_COLS + (c + 1)] : 8;
  return up === 0 || down === 0 || left === 0 || right === 0;
}

function computeLayout() {
  // Square tiles sized to the canvas width. Grid is left-aligned; vertical
  // rows are computed from canvas height so the world fills the screen.
  const tile = Math.floor(W / GRID_COLS);
  const offX = Math.floor((W - tile * GRID_COLS) / 2);
  const rows = Math.max(10, Math.floor((H - 100) / tile)); // HUD strip at top
  const offY = 100;
  return { tile, offX, offY, rows };
}

export const BlockBash = {
  name: "Block Bash",
  desc: "Mine the deepest, rarest blocks in 60 seconds.",
  icon: "⛏️",
  color: "#7ec96b",
  init() {
    const { rows } = computeLayout();
    return {
      grid: generateGrid(rows),
      rows,
      hp: new Int8Array(GRID_COLS * rows),  // per-tile damage taken
      time: TIME_LIMIT,
      elapsed: 0,
      score: 0,
      mined: 0,                              // total tiles broken
      bestTile: 0,                           // rarest tile broken (for end screen)
      combo: 1, bestCombo: 1, lastBreakElapsed: -Infinity,
      finished: false,
      particles: [],
      floats: [],
      cracks: [],                            // recent crack shake samples
      cursor: { x: -1, y: -1, active: false },
      shakeUntil: 0,
    };
  },
  payout(g) {
    // Tuned: a clean run of mostly stone with a few ores → ~$3-5; a great
    // run with diamond hits → ~$10+. Mirrors Duck Hunt's score/25 ratio.
    return Math.floor(g.score / 20);
  },
  handlePointer(g, kind, x, y) {
    if (g.finished) return;
    if (kind === "down" || kind === "move") {
      g.cursor.x = x; g.cursor.y = y; g.cursor.active = true;
    }
    if (kind !== "down") return;
    const { tile, offX, offY, rows } = computeLayout();
    const c = Math.floor((x - offX) / tile);
    const r = Math.floor((y - offY) / tile);
    if (c < 0 || c >= GRID_COLS || r < 0 || r >= rows) return;
    const idx = r * GRID_COLS + c;
    const t = g.grid[idx];
    if (t === 0 || t === 8) {
      // Air/bedrock = wasted tap; break combo, small puff.
      g.combo = 1;
      BlockBash.spawnPuff(g, offX + c * tile + tile / 2, offY + r * tile + tile / 2);
      return;
    }
    if (!isExposed(g.grid, rows, c, r)) {
      // Hidden block. Show "covered" puff and break combo.
      g.combo = 1;
      BlockBash.spawnPuff(g, offX + c * tile + tile / 2, offY + r * tile + tile / 2);
      BlockBash.pushFloat(g, "covered", offX + c * tile + tile / 2, offY + r * tile, "#cccccc");
      return;
    }
    const info = TILES[t];
    g.hp[idx]++;
    Sound.boostHit && Sound.boostHit();
    if (g.hp[idx] >= info.hits) {
      // Mine through. Score, particles, combo bump, depth float.
      const px = offX + c * tile + tile / 2;
      const py = offY + r * tile + tile / 2;
      const sinceLast = g.elapsed - g.lastBreakElapsed;
      if (sinceLast < COMBO_WINDOW) {
        g.combo = Math.min(COMBO_CAP, g.combo + 1);
        if (g.combo > g.bestCombo) g.bestCombo = g.combo;
      }
      g.lastBreakElapsed = g.elapsed;
      const earn = info.score * g.combo;
      g.score += earn;
      g.mined++;
      if (t > g.bestTile) g.bestTile = t;
      g.grid[idx] = 0;
      g.hp[idx] = 0;
      BlockBash.spawnChunks(g, px, py, info.palette);
      const tag = g.combo > 1 ? `+${earn}  x${g.combo}` : `+${earn}`;
      BlockBash.pushFloat(g, tag, px, py - tile * 0.3, info.speck ? info.speck[0] : "#ffe680");
      g.shakeUntil = g.elapsed + 0.08;
      Sound.gem && Sound.gem();
    } else {
      // Partial hit — dust + tap sound, combo preserved.
      BlockBash.spawnPuff(g, offX + c * tile + tile / 2, offY + r * tile + tile / 2);
    }
  },
  spawnChunks(g, x, y, palette) {
    for (let i = 0; i < 12; i++) {
      g.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 260,
        vy: -120 - Math.random() * 160,
        life: 0.6 + Math.random() * 0.4, maxLife: 1.0,
        size: 4 + Math.random() * 4,
        rot: 0, rotVel: (Math.random() - 0.5) * 6,
        color: palette[Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? 1 : 2)],
        kind: "chunk",
      });
    }
  },
  spawnPuff(g, x, y) {
    for (let i = 0; i < 6; i++) {
      g.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 80,
        vy: (Math.random() - 0.5) * 80,
        life: 0.3, maxLife: 0.3,
        size: 3 + Math.random() * 3,
        rot: 0, rotVel: 0,
        color: "rgba(255,255,255,0.5)",
        kind: "puff",
      });
    }
  },
  pushFloat(g, text, x, y, color) {
    g.floats.push({ text, x, y, vy: -50, life: 0.85, maxLife: 0.85, color });
  },
  update(g, dt) {
    if (g.finished) return;
    g.time -= dt;
    g.elapsed += dt;
    if (g.time <= 0) {
      g.time = 0;
      g.finished = true;
    }
    // Combo decay: if you idle past the window, the multiplier visibly
    // resets so the HUD dots don't lie about your active streak.
    if (g.combo > 1 && g.elapsed - g.lastBreakElapsed > COMBO_WINDOW) {
      g.combo = 1;
    }
    for (const p of g.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 480 * dt;
      p.rot += p.rotVel * dt;
      p.life -= dt;
    }
    g.particles = g.particles.filter(p => p.life > 0);
    for (const f of g.floats) {
      f.y += f.vy * dt;
      f.life -= dt;
    }
    g.floats = g.floats.filter(f => f.life > 0);
  },
  render(g) {
    const { tile, offX, offY, rows } = computeLayout();

    // ---- Sky gradient + parallax clouds (just enough to feel like a
    // ---- biome, not enough to compete with the grid for attention).
    const sky = ctx.createLinearGradient(0, 0, 0, offY);
    sky.addColorStop(0, "#6cc4ff");
    sky.addColorStop(1, "#bfe6ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, offY);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    const t = performance.now() / 1000;
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 220 + t * (10 + i * 3)) % (W + 200)) - 100;
      const cy = 30 + (i % 2) * 25;
      // Blocky Minecraft-style clouds — chained squares instead of arcs.
      for (let j = 0; j < 4; j++) {
        ctx.fillRect(cx + j * 14, cy, 16, 14);
      }
      ctx.fillRect(cx + 8, cy - 12, 28, 12);
    }

    // ---- Grid. Tiny screen shake on a successful mine via shakeUntil.
    let shakeX = 0, shakeY = 0;
    if (g.shakeUntil > 0 && g.elapsed < g.shakeUntil) {
      shakeX = (Math.random() - 0.5) * 3;
      shakeY = (Math.random() - 0.5) * 3;
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const idx = r * GRID_COLS + c;
        const tt = g.grid[idx];
        if (tt === 0) continue;
        const info = TILES[tt];
        const tx = offX + c * tile + shakeX;
        const ty = offY + r * tile + shakeY;
        const [base, light, dark] = info.palette;

        // Base
        ctx.fillStyle = base;
        ctx.fillRect(tx, ty, tile, tile);
        // Top + left highlight (2px)
        ctx.fillStyle = light;
        ctx.fillRect(tx, ty, tile, 2);
        ctx.fillRect(tx, ty, 2, tile);
        // Bottom + right shadow (2px)
        ctx.fillStyle = dark;
        ctx.fillRect(tx, ty + tile - 2, tile, 2);
        ctx.fillRect(tx + tile - 2, ty, 2, tile);

        // Ore specks — deterministic per-tile via a tiny hash so they
        // don't shimmer between frames.
        if (info.speck) {
          ctx.fillStyle = info.speck[0];
          const seed = (c * 73856093) ^ (r * 19349663) ^ tt;
          let s = seed;
          for (let k = 0; k < info.speck[1]; k++) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const sx = tx + 5 + (s % (tile - 12));
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const sy = ty + 5 + (s % (tile - 12));
            const sz = 3 + (s & 3);
            ctx.fillRect(sx, sy, sz, sz);
          }
        }

        // Crack overlay for partially-mined tiles. Three stages.
        const dmg = g.hp[idx];
        if (dmg > 0 && info.hits > 1) {
          const frac = dmg / info.hits;
          ctx.strokeStyle = `rgba(0,0,0,${0.4 + frac * 0.4})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          // Diagonal crack
          ctx.moveTo(tx + 4, ty + tile - 6);
          ctx.lineTo(tx + tile * 0.55, ty + tile * 0.45);
          ctx.lineTo(tx + tile - 5, ty + 5);
          // Branches scale with damage
          if (frac > 0.5) {
            ctx.moveTo(tx + tile * 0.55, ty + tile * 0.45);
            ctx.lineTo(tx + tile - 6, ty + tile * 0.6);
          }
          if (frac > 0.75) {
            ctx.moveTo(tx + tile * 0.55, ty + tile * 0.45);
            ctx.lineTo(tx + 6, ty + tile * 0.3);
          }
          ctx.stroke();
        }
      }
    }

    // ---- Particles (chunks + puffs) — pixel-flavored squares.
    for (const p of g.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.kind === "chunk") {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // ---- Floating "+pts xN" callouts. Stroked so they stay legible.
    ctx.font = "bold 22px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    for (const f of g.floats) {
      const a = Math.max(0, f.life / f.maxLife);
      ctx.globalAlpha = a;
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";

    // ---- Selection highlight under the cursor while pointer is active.
    if (g.cursor.active && !g.finished) {
      const c = Math.floor((g.cursor.x - offX) / tile);
      const r = Math.floor((g.cursor.y - offY) / tile);
      if (c >= 0 && c < GRID_COLS && r >= 0 && r < rows) {
        const tt = g.grid[r * GRID_COLS + c];
        if (tt !== 0) {
          const exposed = isExposed(g.grid, rows, c, r) && tt !== 8;
          ctx.strokeStyle = exposed ? "rgba(255,255,255,0.95)" : "rgba(255,80,80,0.85)";
          ctx.lineWidth = 3;
          ctx.strokeRect(offX + c * tile + 1, offY + r * tile + 1, tile - 2, tile - 2);
        }
      }
    }

    // ---- HUD: time bar, score, combo dots, mined count.
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, offY - 8);

    // Time bar
    const barX = 16, barY = 14, barW = W - 32, barH = 14;
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(barX, barY, barW, barH);
    const tFrac = g.time / TIME_LIMIT;
    ctx.fillStyle = tFrac > 0.33 ? "#7ec96b" : tFrac > 0.15 ? "#ffd03a" : "#ff5a3a";
    ctx.fillRect(barX, barY, barW * tFrac, barH);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(`Time: ${Math.ceil(g.time)}s`, 16, 50);
    ctx.fillText(`Score: ${g.score}`, 16, 72);
    ctx.textAlign = "right";
    ctx.fillText(`Mined: ${g.mined}`, W - 16, 50);
    if (g.bestTile > 0) {
      const best = TILES[g.bestTile];
      ctx.fillStyle = best.speck ? best.speck[0] : "#fff";
      ctx.fillText(`Best: ${best.name}`, W - 16, 72);
    }
    ctx.textAlign = "start";

    // Combo dots (Duck Hunt pattern).
    const dotCount = COMBO_CAP, dotR = 5, dotGap = 14, dotY = 92, dotX0 = 16;
    const filled = Math.min(g.combo - 1, dotCount);
    for (let i = 0; i < dotCount; i++) {
      const dx = dotX0 + i * dotGap + dotR;
      ctx.fillStyle = i < filled ? "#ffd03a" : "rgba(255,255,255,0.22)";
      ctx.beginPath();
      ctx.arc(dx, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (g.combo > 1) {
      ctx.fillStyle = "#ffd03a";
      ctx.font = "bold 14px ui-monospace, monospace";
      ctx.fillText(`x${g.combo}`, dotX0 + dotCount * dotGap + 14, dotY + 5);
    }

    if (g.mined === 0 && !g.finished) {
      ctx.font = "bold 16px ui-monospace, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.textAlign = "center";
      ctx.fillText("Tap exposed blocks to mine", W / 2, H - 18);
      ctx.textAlign = "start";
    }
  },
};

// @ts-nocheck
// Duck Hunt — tap-to-shoot minigame.
//
// Implements the Minigame contract documented above MINIGAMES in main.js.
// No level metadata: this is a single-rack 10-shot round.
//
// Dependencies kept intentionally narrow:
//   - ctx, W, H  (canvas)
//   - Sound      (sfx)
// Adding new minigames in this pattern means: drop a file under
// src/games/<id>/index.js exporting the contract, then register it in
// MINIGAMES.

import { ctx, W, H } from "../../engine/canvas.js";
import { Sound } from "../../engine/audio.js";

export const DuckHunt = {
  name: "Duck Hunt",
  desc: "Tap the ducks before they fly off. 10 shots.",
  icon: "🦆",
  color: "#ffce6e",
  init() {
    return {
      ducks: [], shots: 10, fired: 0, hits: 0, score: 0, time: 0,
      spawnTimer: 0, finished: false, message: "", messageTimer: 0,
      muzzle: 0,                   // brief screen-flash on shot
      cursor: { x: W / 2, y: H / 2, active: false },
      // Combo multiplier — captured before the bump on each hit so the
      // throw that builds combo uses the prior value. Reset on miss.
      combo: 1, bestCombo: 1,
      // Feather burst on hits / puff on misses, plus per-duck floating
      // "+pts xN" callouts.
      particles: [],
      floats: [],
    };
  },
  payout(g) { return g.hits * 25; },
  spawnDuck(g) {
    const fromLeft = Math.random() < 0.5;
    // 12% gold, 18% small/fast, rest standard.
    const r = Math.random();
    const gold  = r < 0.12;
    const small = !gold && r < 0.30;
    const speedMul = small ? 1.7 : 1.0;
    const speed = (220 + Math.random() * 180) * speedMul;
    g.ducks.push({
      x: fromLeft ? -30 : W + 30,
      // Spawn above the new lake horizon (~63%) so ducks don't appear to
      // fly through water. 18%–60% of screen height.
      y: H * (0.18 + Math.random() * 0.42),
      vx: fromLeft ? speed : -speed,
      vy: -20 - Math.random() * 40,
      hit: false, alpha: 1, t: 0,
      gold, small,
      // Tuned down so the bigger polished art stays close to the original
      // on-screen footprint (hit radius unchanged at 44px).
      size: small ? 0.5 : 0.65,
      // Vertical sin-wave bob so ducks don't track on a flat line.
      waveOffset: Math.random() * Math.PI * 2,
      waveAmp:    18 + Math.random() * 14,
      flap:       Math.random() * Math.PI * 2,
      // Death rotation when shot — applied as the duck falls.
      rot: 0,
      rotVel: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 4),
    });
  },
  handlePointer(g, kind, x, y) {
    if (g.finished) return;
    // Track cursor for crosshair render on every pointer event.
    if (kind === "down" || kind === "move") {
      g.cursor.x = x; g.cursor.y = y; g.cursor.active = true;
    }
    if (kind !== "down") return;
    if (g.fired >= g.shots) return;
    g.fired++; g.muzzle = 0.12;
    Sound.boostHit && Sound.boostHit();
    // Hit-test ducks (closest within 44px wins).
    let best = null, bestD = 44 * 44;
    for (const d of g.ducks) {
      if (d.hit) continue;
      const dx = d.x - x, dy = d.y - y;
      const d2 = dx*dx + dy*dy;
      if (d2 < bestD) { bestD = d2; best = d; }
    }
    if (best) {
      best.hit = true; best.vy = 320; best.vx *= 0.3;
      g.hits++;
      const base = best.gold ? 200 : (best.small ? 80 : 50);
      // Capture combo BEFORE bumping it so this hit uses the multiplier
      // that prior hits built up. Combo caps at 5x.
      const mult = g.combo;
      const earn = base * mult;
      g.score += earn;
      g.combo = Math.min(5, g.combo + 1);
      if (g.combo > g.bestCombo) g.bestCombo = g.combo;
      DuckHunt.spawnFeathers(g, best.x, best.y, best.gold);
      const tag = mult > 1 ? `+${earn}  x${mult}` : `+${earn}`;
      DuckHunt.pushFloat(g, tag, best.x, best.y - 18, best.gold ? "#ffe680" : "#ffb020");
      Sound.gem && Sound.gem();
    } else {
      g.combo = 1;
      DuckHunt.spawnPuff(g, x, y);
      DuckHunt.pushFloat(g, "MISS", x, y - 14, "#ff5a3a");
    }
  },
  spawnFeathers(g, x, y, gold) {
    const colors = gold
      ? ["#ffe680", "#ffc940", "#fff4b8"]
      : ["#ffffff", "#cfd6e3", "#7d8898"];
    for (let i = 0; i < 16; i++) {
      g.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 280,
        vy: -120 - Math.random() * 180,
        life: 0.8 + Math.random() * 0.5,
        maxLife: 1.2,
        size: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        rotVel: (Math.random() - 0.5) * 8,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  },
  spawnPuff(g, x, y) {
    for (let i = 0; i < 6; i++) {
      g.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 90,
        vy: (Math.random() - 0.5) * 90,
        life: 0.28,
        maxLife: 0.28,
        size: 5 + Math.random() * 5,
        rot: 0, rotVel: 0,
        color: "rgba(255,255,255,0.45)",
      });
    }
  },
  pushFloat(g, text, x, y, color) {
    g.floats.push({ text, x, y, vy: -55, life: 0.9, maxLife: 0.9, color });
  },
  update(g, dt) {
    g.time += dt;
    g.muzzle = Math.max(0, g.muzzle - dt);
    if (g.messageTimer > 0) g.messageTimer = Math.max(0, g.messageTimer - dt);
    // Spawn
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0 && g.fired < g.shots) {
      DuckHunt.spawnDuck(g);
      g.spawnTimer = 0.7 + Math.random() * 0.6;
    }
    // Update ducks
    for (const d of g.ducks) {
      d.t += dt;
      d.x += d.vx * dt;
      if (d.hit) {
        d.vy += 600 * dt;
        d.y += d.vy * dt;
        d.rot += d.rotVel * dt;
        d.alpha = Math.max(0, d.alpha - dt * 0.5);
      } else {
        // Living ducks bob on a sin wave instead of tracking flat.
        d.y += d.vy * dt + Math.sin(d.t * 3 + d.waveOffset) * d.waveAmp * dt;
        d.flap += dt * 12;
      }
    }
    g.ducks = g.ducks.filter(d => d.x > -60 && d.x < W + 60 && d.y < H + 60 && d.alpha > 0);
    // Feather / puff particles.
    for (const p of g.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 180 * dt;
      p.rot += p.rotVel * dt;
      p.life -= dt;
    }
    g.particles = g.particles.filter(p => p.life > 0);
    // Floating text.
    for (const f of g.floats) {
      f.y += f.vy * dt;
      f.life -= dt;
    }
    g.floats = g.floats.filter(f => f.life > 0);
    // End when out of shots and ducks have left.
    if (g.fired >= g.shots && g.ducks.length === 0 && !g.finished) {
      g.finished = true;
    }
  },
  render(g) {
    // ---- Layered background: sky -> clouds -> mountains -> trees ----
    //      -> lake (with animated ripples) -> grass -> cattails -> vignette.
    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,    "#1e9bff");
    sky.addColorStop(0.55, "#7fd4ff");
    sky.addColorStop(1,    "#dff6ff");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    const t = performance.now() / 1000;

    // Clouds — soft, drifting.
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    for (let i = 0; i < 7; i++) {
      const cx = ((i * 260 + t * (18 + i * 2)) % (W + 220)) - 110;
      const cy = 55 + (i % 4) * 55;
      const r = 28 + (i % 3) * 8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.8, cy + 5, r * 0.75, 0, Math.PI * 2);
      ctx.arc(cx - r * 0.8, cy + 6, r * 0.65, 0, Math.PI * 2);
      ctx.arc(cx + r * 1.45, cy + 10, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mountains — two ranges for depth.
    const baseY = H * 0.62;
    ctx.fillStyle = "#5fa2c8";
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= W + 80; x += 80) {
      ctx.lineTo(x, baseY - 90 - Math.sin(x * 0.012) * 35);
    }
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

    ctx.fillStyle = "#3d7aa4";
    ctx.beginPath();
    ctx.moveTo(0, baseY + 45);
    for (let x = 0; x <= W + 80; x += 70) {
      ctx.lineTo(x, baseY - 35 - Math.sin(x * 0.018 + 1.4) * 28);
    }
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();

    // Pine trees along the foothills.
    ctx.fillStyle = "#2f6b45";
    for (let x = -20; x < W + 40; x += 30) {
      const h = 35 + Math.sin(x * 0.08) * 12;
      ctx.beginPath();
      ctx.moveTo(x,       baseY + 28);
      ctx.lineTo(x + 13,  baseY - h);
      ctx.lineTo(x + 26,  baseY + 28);
      ctx.closePath(); ctx.fill();
    }

    // Lake — vertical gradient + animated wave lines.
    const lakeTop = H * 0.63;
    const lake = ctx.createLinearGradient(0, lakeTop, 0, H * 0.82);
    lake.addColorStop(0, "#2d9fd6");
    lake.addColorStop(1, "#0d5d84");
    ctx.fillStyle = lake;
    ctx.fillRect(0, lakeTop, W, H * 0.2);

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    const wt = performance.now() / 600;
    for (let i = 0; i < 18; i++) {
      const yy = lakeTop + 12 + i * 8;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 40) {
        const wave = Math.sin(x * 0.025 + wt + i) * 6;
        if (x === 0) ctx.moveTo(x, yy + wave);
        else         ctx.lineTo(x, yy + wave);
      }
      ctx.stroke();
    }

    // Grass — solid ground + individual blades (deterministic height per x
    // so they sway via sin() but don't twitch frame-to-frame).
    const groundY = H * 0.78;
    ctx.fillStyle = "#294f24";
    ctx.fillRect(0, groundY, W, H - groundY);

    const gt = performance.now() / 400;
    for (let x = -10; x < W + 20; x += 8) {
      const h = 35 + Math.sin(x * 0.07 + gt) * 10 + (x * 7 % 11);
      ctx.fillStyle = x % 3 === 0 ? "#3f7d33" : x % 2 === 0 ? "#2f6b2e" : "#1e4f24";
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.quadraticCurveTo(x + 6, groundY + 35, x + 2, groundY - h);
      ctx.quadraticCurveTo(x + 12, groundY + 30, x + 10, H);
      ctx.closePath();
      ctx.fill();
    }

    // Cattails — brown ellipse heads on slender stems.
    for (let x = 20; x < W; x += 90) {
      const y = groundY + 15 + Math.sin(x) * 10;
      ctx.strokeStyle = "#1d3d1d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + 6, y);
      ctx.stroke();
      ctx.fillStyle = "#8b5a2b";
      ctx.beginPath();
      ctx.ellipse(x + 6, y - 14, 5, 17, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Vignette — softens edges, focuses the eye on the action.
    const vg = ctx.createRadialGradient(
      W / 2, H / 2, Math.min(W, H) * 0.35,
      W / 2, H / 2, Math.max(W, H) * 0.75
    );
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    // Ducks — polished art: drop shadow, body, flapping wing, neck/head,
    // triangle beak, eye + highlight, tail, chest sheen, gold halo, kill X.
    // Death rotation applied via d.rot so shot ducks tumble as they fall.
    for (const d of g.ducks) {
      ctx.save();
      ctx.translate(d.x, d.y);
      if (d.hit) ctx.rotate(d.rot);
      ctx.scale((d.vx < 0 ? -1 : 1) * d.size, d.size);
      ctx.globalAlpha = d.alpha;

      const body = d.gold ? "#ffc940" : d.small ? "#55d8ff" : "#8b5a2b";
      const wing = d.gold ? "#ffe680" : d.small ? "#b5f4ff" : "#5a351a";
      const head = d.gold ? "#ffe680" : "#147d5c";

      const flap  = Math.sin(d.flap);
      const wingY = flap * 16;

      // Drop shadow — draws the silhouette offset, then the real duck on top.
      const drawDuckShape = (color, wingCol, headCol) => {
        // Body
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.ellipse(0, 10, 31, 18, 0, 0, Math.PI * 2); ctx.fill();
        // Wing (flap controls vertical offset)
        ctx.fillStyle = wingCol;
        ctx.beginPath();
        ctx.ellipse(-8, 4 + wingY * 0.28, 21, 9, wingY * 0.03, 0, Math.PI * 2);
        ctx.fill();
        // Head
        ctx.fillStyle = headCol;
        ctx.beginPath(); ctx.arc(25, -5, 13, 0, Math.PI * 2); ctx.fill();
        // Beak
        ctx.fillStyle = color === "#000" ? "#000" : "#ff9f1c";
        ctx.beginPath();
        ctx.moveTo(36, -7); ctx.lineTo(53, -1); ctx.lineTo(36, 5);
        ctx.closePath(); ctx.fill();
        // Tail
        ctx.fillStyle = color === "#000" ? "#000" : "#2c1a0e";
        ctx.beginPath();
        ctx.moveTo(-27, 5); ctx.lineTo(-47, -9); ctx.lineTo(-39, 13);
        ctx.closePath(); ctx.fill();
      };

      ctx.save();
      ctx.translate(3, 4);
      ctx.globalAlpha = d.alpha * 0.35;
      drawDuckShape("#000", "#000", "#000");
      ctx.restore();

      drawDuckShape(body, wing, head);

      // Eye highlight (white) + pupil (black).
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(29, -9, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(30, -9, 1.5, 0, Math.PI * 2); ctx.fill();

      // Chest sheen — subtle highlight curve along the belly.
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-18, 2);
      ctx.quadraticCurveTo(-5, -4, 11, 3);
      ctx.stroke();

      // Gold halo
      if (d.gold && !d.hit) {
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 56);
        grad.addColorStop(0, "rgba(255, 220, 80, 0.55)");
        grad.addColorStop(1, "rgba(255, 220, 80, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(-64, -64, 128, 128);
      }

      // Kill marker — red X overlaid on shot ducks.
      if (d.hit) {
        ctx.strokeStyle = "#ff3030";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-14, -14); ctx.lineTo(14, 14);
        ctx.moveTo(14, -14);  ctx.lineTo(-14, 14);
        ctx.stroke();
      }

      ctx.restore();
    }
    // Feather / puff particles — over ducks, under HUD.
    for (const p of g.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // Floating "+pts xN" callouts at the duck position — stroked so they
    // stay legible against the busier scene.
    ctx.font = "bold 24px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 5;
    for (const f of g.floats) {
      const a = Math.max(0, f.life / f.maxLife);
      ctx.globalAlpha = a;
      ctx.strokeStyle = "rgba(0,0,0,0.75)";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    // Muzzle flash
    if (g.muzzle > 0) {
      ctx.fillStyle = `rgba(255, 230, 120, ${g.muzzle * 5})`;
      ctx.fillRect(0, 0, W, H);
    }
    // Crosshair — follows the player's finger / pointer.
    if (g.cursor.active && g.fired < g.shots) {
      const cx = g.cursor.x, cy = g.cursor.y;
      ctx.strokeStyle = "rgba(255, 80, 80, 0.95)";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 28, cy); ctx.lineTo(cx - 8, cy);
      ctx.moveTo(cx + 8, cy);  ctx.lineTo(cx + 28, cy);
      ctx.moveTo(cx, cy - 28); ctx.lineTo(cx, cy - 8);
      ctx.moveTo(cx, cy + 8);  ctx.lineTo(cx, cy + 28);
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 80, 80, 0.95)";
      ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
    }
    // HUD
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(`Hits: ${g.hits} / ${g.fired}    Score: ${g.score}`, 16, 28);
    ctx.fillText(`Shots left: ${Math.max(0, g.shots - g.fired)}`, 16, 52);
    // Combo dots — five pips that fill as the streak builds. Same
    // pattern as QB Challenge's combo strip.
    const dotCount = 5, dotR = 6, dotGap = 16, dotY = 78, dotX0 = 16;
    const filled = Math.min(g.combo - 1, dotCount);
    for (let i = 0; i < dotCount; i++) {
      const dx = dotX0 + i * dotGap + dotR;
      ctx.fillStyle = i < filled ? "#ffd03a" : "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.arc(dx, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (g.combo > 1) {
      ctx.fillStyle = "#d49600";
      ctx.font = "bold 14px ui-monospace, monospace";
      ctx.fillText(`x${g.combo}`, dotX0 + dotCount * dotGap + 14, dotY + 5);
    }
    if (g.fired === 0) {
      ctx.font = "bold 16px ui-monospace, monospace";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.textAlign = "center";
      ctx.fillText("Tap a duck to shoot it", W/2, H * 0.95);
      ctx.textAlign = "start";
    }
  },
};

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
import { FG_LEVELS, FG_CONDITION_INFO, starsFor as fgStarsFor, levelById as fgLevelById, isLevelUnlocked as isFgLevelUnlocked } from "./games/fieldGoal/levels.js";
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
      preload: 0,
      currentFlipRot: 0,
      airTrick: { tuck: 0, superman: 0, noHand: 0 },
      oilTime: 0,
      tireTrail: [], // recent ground positions for trail rendering
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
    if (!b.wheelie) b.wheelie = { time: 0, dir: 0 };
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
  VW = W / r.cam.zoom;
  VH = H / r.cam.zoom;

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
  for (const overlay of ["menu","levels","garage","quests","how","result","pause","hud","cb-levels","fg-levels"]) {
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
      summary = `Stars: ${totalStars} / ${maxStars}`;
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
      <div class="qc-reward">${id === "can_bash" || id === "field_goal" ? "Levels ▶" : "Play ▶"}</div>
    `;
    card.addEventListener("click", () => {
      if (id === "can_bash") openCanBashLevels();
      else if (id === "field_goal") openFieldGoalLevels();
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
  for (const lvl of CAN_LEVELS) {
    const unlocked = isCanLevelUnlocked(progress, lvl.id);
    const rec = progress[lvl.id];
    const stars = (rec && rec.stars) || 0;
    const card = document.createElement("div");
    card.className = "level-card" + (unlocked ? "" : " locked");
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
  }
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
  for (const lvl of FG_LEVELS) {
    const unlocked = isFgLevelUnlocked(progress, lvl.id);
    const rec = progress[lvl.id];
    const stars = (rec && rec.stars) || 0;
    const card = document.createElement("div");
    card.className = "level-card" + (unlocked ? "" : " locked");
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
  }
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
      case "resume": G.state = STATE.PLAY; showOnly("hud"); break;
      case "retry":
        if (G.runtime) startRun(G.runtime.level.id);
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
    document.querySelector('script[src*="game.js"]')?.src.split("?v=")[1] || "dev"
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
  }
  G.minigameRuntime = mg.init(level);
  G.minigameRuntime.id = id;
  G.state = STATE.MINIGAME;
  // Hide every overlay (and the touch UI). The canvas is the whole screen.
  for (const overlay of ["menu","levels","garage","quests","how","result","pause","hud","touch","cb-levels","fg-levels"]) {
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
          const lvlId = rt.level.id;
          G.minigameRuntime = null;
          startMinigame("field_goal", lvlId);
        } else if (inBtn(rt._btnLevels)) {
          G.minigameRuntime = null;
          openFieldGoalLevels();
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

//----------------------------------------------------------
// FIRST-PERSON FLICK PROJECTION HELPERS
//----------------------------------------------------------
// World coords (meters):
//   x = lateral (0 = straight ahead)
//   y = height above the ground (positive = up)
//   z = depth into the screen (positive = away from camera)
// Camera sits at (0, FP_CAMERA_H, 0) looking down +z. Anything at the
// camera's eye height (y = FP_CAMERA_H) projects exactly to the horizon;
// the ground plane (y = 0) projects below the horizon and rises to it as
// z → ∞; tall things (uprights) project above the horizon. This is the
// standard pinhole model and avoids the "ball balloons to fill screen"
// bug at small z.
const FP_FOCAL    = 600;       // pixels of focal length
const FP_CAMERA_H = 1.6;       // ~5'3" eye line, behind the holder
let   _fpCamZ     = 0;         // virtual camera offset along z (set per-game)
function fpSetCam(z) { _fpCamZ = z || 0; }
function fpHorizonY() { return H * 0.55; }
function fpProject(x, y, z) {
  const zz = Math.max(0.5, z - _fpCamZ);
  return {
    sx: W / 2 + x * FP_FOCAL / zz,
    sy: fpHorizonY() + (FP_CAMERA_H - y) * FP_FOCAL / zz,
    scale: FP_FOCAL / zz / 60,   // baseline scale: ~1× at z=10
  };
}
function fpDrawSky(top1, top2, bot) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, top1); sky.addColorStop(0.55, top2); sky.addColorStop(1, bot);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
}
// Fill the ground plane with grass + perspective lateral lines. Optionally
// pass `bg` to override the field color.
function fpDrawField(grass, lineColor, opts) {
  const horizon = fpHorizonY();
  ctx.fillStyle = grass;
  ctx.fillRect(0, horizon, W, H - horizon);
  // Yard lines every 5m — drawn via projection of the ground plane.
  ctx.strokeStyle = lineColor || "rgba(255,255,255,0.40)";
  for (let z = 5; z <= 120; z += 5) {
    const left  = fpProject(-25, 0, z);
    const right = fpProject( 25, 0, z);
    ctx.lineWidth = Math.max(0.6, 2 * (FP_FOCAL / z / 60));
    ctx.beginPath(); ctx.moveTo(left.sx, left.sy); ctx.lineTo(right.sx, right.sy); ctx.stroke();
  }
  // Hash marks down the center.
  ctx.strokeStyle = lineColor || "rgba(255,255,255,0.50)";
  for (let z = 2; z <= 80; z += 2) {
    const a = fpProject(-0.4, 0, z);
    const b = fpProject( 0.4, 0, z);
    ctx.lineWidth = Math.max(0.5, 1.5 * (FP_FOCAL / z / 60));
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
  }
}

// Standard flick handler. Returns {power, lateral, upward} on release of
// a real upward swipe, otherwise null.
function fpProcessFlick(state, kind, x, y) {
  if (kind === "down") { state.dragStart = { x, y, t: performance.now() }; state.dragNow = { x, y }; return null; }
  if (kind === "move" && state.dragStart) { state.dragNow = { x, y }; return null; }
  if (kind === "up" && state.dragStart) {
    const sx = state.dragStart.x, sy = state.dragStart.y;
    const ex = (state.dragNow ? state.dragNow.x : x);
    const ey = (state.dragNow ? state.dragNow.y : y);
    state.dragStart = null; state.dragNow = null;
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.hypot(dx, dy);
    if (dy > -25 || dist < 60) return null;
    const power = Math.min(1, dist / 360);
    const lateral = Math.max(-1, Math.min(1, dx / Math.max(60, -dy)));
    const upward = -dy / dist;
    return { dx, dy, dist, power, lateral, upward };
  }
  return null;
}

function fpDrawAimArc(state, originSX, originSY, color) {
  if (!state.dragStart || !state.dragNow) return;
  const dx = state.dragNow.x - state.dragStart.x;
  const dy = state.dragNow.y - state.dragStart.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 8) return;
  const power = Math.min(1, dist / 360);
  // Preview arc — projects roughly where the ball will travel on screen.
  ctx.strokeStyle = color || `rgba(255, 220, 80, ${0.5 + power * 0.5})`;
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  for (let t = 0; t <= 1; t += 0.05) {
    const px = originSX + (-dx) * t * 0.55;
    const py = originSY + (-dy) * t - 700 * t * (1 - t) * power * 0.45;
    if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // Power bar
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(W - 130, 20, 110, 10);
  ctx.fillStyle = color || "#ffb020";
  ctx.fillRect(W - 130, 20, 110 * power, 10);
}


//----------------------------------------------------------
// FIELD GOAL KICK (first-person flick)
//----------------------------------------------------------
const FieldGoal = {
  name: "Field Goal Kick",
  desc: "Flick UP from the ball to kick. Curve with the angle. Mind the wind.",
  icon: "🏈",
  color: "#4ddc8c",
  init(level) {
    const lvl = level || FG_LEVELS[0];
    // Surface a one-time tutorial when the player first encounters this
    // condition. Mirrors Can Bash's first-encounter type tutorials.
    const condition = lvl.condition || "standard";
    const tutorialQueue = [];
    if (condition !== "standard") {
      save.fieldGoalSeenConditions = save.fieldGoalSeenConditions || {};
      if (!save.fieldGoalSeenConditions[condition]) {
        const info = FG_CONDITION_INFO[condition];
        if (info && info.label) tutorialQueue.push({ label: info.label });
        save.fieldGoalSeenConditions[condition] = true;
        persistSave();
      }
    }
    return {
      level: lvl,
      condition,
      ball: null,
      // Posts: distance, gap, crossbar height, top of uprights. Distance
      // and gap come from the level; reset() picks the lateral offset
      // and wind per attempt.
      posts: { z: lvl.distance, gap: lvl.gap, x: 0, crossbar: 1.0, top: 9.5 },
      attempts: lvl.attempts, kicked: 0, made: 0, score: 0,
      wind: 0, dragStart: null, dragNow: null,
      message: "", messageTimer: 0, finished: false,
      stars: 0,
      cameraZ: 0,
      kickFx: 0,
      // Snow particles persist across attempts so the storm feels continuous.
      snow: condition === "snowstorm" ? FieldGoal.makeSnow() : null,
      // Crosswind gust schedule — set per-attempt in reset().
      gustAt: 0,
      gusted: false,
      // Triple condition: which of the three goal slots is live (gold).
      // Re-rolled per attempt in reset() so the player has to re-read.
      liveSlot: 0,
      tutorialQueue,
      _tutorialNextAt: 0.5,
    };
  },
  // Build a fresh snow field — small particles falling at a steady rate
  // across the screen volume, used for the snowstorm condition's render
  // and for ball drag.
  makeSnow() {
    const n = 140;
    const flakes = new Array(n);
    for (let i = 0; i < n; i++) {
      flakes[i] = {
        x: (Math.random() * 2 - 1) * 30,
        y: Math.random() * 12,
        z: 4 + Math.random() * 50,
        vy: -2 - Math.random() * 1.5,
        vx: (Math.random() - 0.5) * 0.6,
      };
    }
    return flakes;
  },
  payout(g) { return Math.floor((g.score || 0) * 1.0); },
  reset(g) {
    // Per-attempt randomness inside the level's configured ranges. Distance
    // and gap stay constant for the level; wind and lateral offset roll
    // fresh on every attempt so each kick is a new read.
    const lvl = g.level || FG_LEVELS[0];
    g.posts.z   = lvl.distance;
    g.posts.gap = lvl.gap;
    g.posts.x   = (Math.random() * 2 - 1) * lvl.offCenterRange;
    g.wind      = (Math.random() * 2 - 1) * lvl.windRange;
    g.ball = { x: 0, y: 0, z: 4, vx: 0, vy: 0, vz: 0, spin: 0,
               kicked: false, scored: false, gone: false, t: 0 };
    g.message = ""; g.messageTimer = 0;
    g.cameraZ = 0;
    g.kickFx = 0;
    // Crosswind: schedule the gust at 0.4–0.9s into flight; flag we
    // haven't gusted yet so update() flips the wind exactly once.
    if (g.condition === "crosswind") {
      g.gustAt = 0.4 + Math.random() * 0.5;
      g.gusted = false;
    }
    // Triple: pick the live (gold) post set, 0=left, 1=center, 2=right.
    if (g.condition === "triple") {
      g.liveSlot = Math.floor(Math.random() * 3);
    }
  },
  handlePointer(g, kind, x, y) {
    if (g.finished) return;
    if (!g.ball) FieldGoal.reset(g);
    if (g.ball.kicked) return;
    const flick = fpProcessFlick(g, kind, x, y);
    if (!flick) return;
    const { power, lateral, upward } = flick;
    // Power scales with target distance so a long kick needs more flick.
    const distScale = Math.max(0.7, g.posts.z / 25);
    // Ball follows the *line* of the flick: forward speed from upward
    // component, lateral speed straight from horizontal component, no
    // continuous spin. The curve only comes from wind.
    g.ball.vz = (12 + power * 14) * distScale * (0.6 + 0.4 * upward);
    g.ball.vy = 5 + power * 8 * upward;
    g.ball.vx = lateral * 9 * power;
    g.ball.spin = 0;
    g.ball.kicked = true;
    g.kickFx = 0.25;
    Sound.boostHit && Sound.boostHit();
  },
  update(g, dt) {
    if (!g.ball) FieldGoal.reset(g);
    const b = g.ball, p = g.posts;
    if (g.kickFx > 0) g.kickFx = Math.max(0, g.kickFx - dt);
    // First-encounter tutorial pop. Mirrors Can Bash: only fires while the
    // player hasn't kicked yet so it doesn't fight gameplay messages.
    if (g.tutorialQueue && g.tutorialQueue.length > 0 && !b.kicked) {
      g._tutorialNextAt -= dt;
      if (g._tutorialNextAt <= 0) {
        const next = g.tutorialQueue.shift();
        pushToast(next.label, "gold", 2400);
        g._tutorialNextAt = 2.5;
      }
    }
    // Snowstorm: the snow keeps falling whether or not the ball is in flight.
    if (g.snow) {
      for (const f of g.snow) {
        f.y += f.vy * dt;
        f.x += f.vx * dt;
        if (f.y < 0) {
          f.y = 10 + Math.random() * 2;
          f.x = (Math.random() * 2 - 1) * 30;
          f.z = 4 + Math.random() * 50;
        }
      }
    }
    if (b.kicked && !b.gone) {
      b.t += dt;
      b.vy -= 9.8 * dt;
      // Wind nudges the ball laterally; tamed so it's a factor not a coin flip.
      b.vx += g.wind * 0.6 * dt;
      // Crosswind gust: flip the wind direction once mid-flight. Toast
      // the player so the change is legible.
      if (g.condition === "crosswind" && !g.gusted && b.t >= g.gustAt) {
        g.wind = -g.wind * 1.4;
        g.gusted = true;
        pushToast("GUST!", "red", 700);
      }
      // Snowstorm: extra air drag in all axes simulates pushing through snow.
      // Tuned light so the level is challenging-but-fair: ~20% energy loss
      // per second on the horizontal axes, lighter on the vertical.
      if (g.condition === "snowstorm") {
        b.vx -= b.vx * 0.20 * dt;
        b.vy -= b.vy * 0.08 * dt;
        b.vz -= b.vz * 0.20 * dt;
      }
      b.x  += b.vx * dt;
      b.y  += b.vy * dt;
      b.z  += b.vz * dt;
      // Camera trails the ball ~6m back so the goalposts grow as the kick
      // approaches them.
      const targetCam = Math.max(0, b.z - 6);
      g.cameraZ = g.cameraZ + (targetCam - g.cameraZ) * Math.min(1, dt * 4);
      if (b.z >= p.z && !b.scored) {
        b.scored = true;
        const tripleOffsets = [-5, 0, 5];
        // Triple: hit detection is anchored to the LIVE slot's center, not
        // posts.x. Decoy slots register as "Wrong door!" misses if the
        // ball passes through them; everything else is a "Wide!".
        const liveCenter = (p.x || 0) + (g.condition === "triple" ? tripleOffsets[g.liveSlot] : 0);
        const offset = b.x - liveCenter;
        const between = Math.abs(offset) < p.gap / 2;
        const aboveBar = b.y > p.crossbar;
        const belowTop = b.y < p.top + 1;
        const through  = between && aboveBar && belowTop;
        // Two-point: must clear bar by 1m or less. Going higher = "Sailed!".
        const tightWindow = b.y < p.crossbar + 1.0;
        // Triple: did the ball pass through one of the decoy slots?
        let throughDecoy = false;
        if (g.condition === "triple" && aboveBar && belowTop) {
          for (let i = 0; i < tripleOffsets.length; i++) {
            if (i === g.liveSlot) continue;
            const decoyCenter = (p.x || 0) + tripleOffsets[i];
            if (Math.abs(b.x - decoyCenter) < p.gap / 2) { throughDecoy = true; break; }
          }
        }
        const liveOK = true; // Through-test is already anchored to live slot.
        // Bullseye: gold ring is centered above the crossbar. Compute
        // hit before scoring so we can stack +5 onto a clean make.
        let ringHit = false;
        if (g.condition === "bullseye" && between) {
          const ringYLow  = p.crossbar + 0.4;
          const ringYHigh = p.crossbar + 1.8;
          const ringXHalf = p.gap * 0.18;
          ringHit = b.y > ringYLow && b.y < ringYHigh
                    && Math.abs(offset) < ringXHalf;
        }
        if (g.condition === "two_point" && through && !tightWindow) {
          g.message = "Sailed!"; g.messageTimer = 1.4; Sound.crash && Sound.crash();
        } else if (through && liveOK) {
          g.made++;
          let pts = 7;
          let msg = "GOOD!";
          if (ringHit) { pts += 5; msg = "BULLSEYE!"; }
          g.score += pts;
          g.message = msg; g.messageTimer = 1.4;
          Sound.perfect && Sound.perfect();
        } else if (throughDecoy) {
          g.message = "Wrong door!"; g.messageTimer = 1.4; Sound.crash && Sound.crash();
        } else if (g.condition === "doink" && Math.abs(offset) >= p.gap / 2
                   && Math.abs(offset) < p.gap / 2 + 0.4
                   && b.y > p.crossbar && b.y < p.top + 0.5) {
          // Doink condition turns the post hit into a +3 partial reward.
          g.score += 3;
          g.message = "Doink! +3"; g.messageTimer = 1.4;
          Sound.boostHit && Sound.boostHit();
        } else if (between && b.y <= p.crossbar) {
          g.message = "Short!"; g.messageTimer = 1.4; Sound.crash && Sound.crash();
        } else if (Math.abs(offset) < p.gap) {
          g.message = "Doinked!"; g.messageTimer = 1.4; Sound.crash && Sound.crash();
        } else {
          g.message = "Wide!"; g.messageTimer = 1.4; Sound.crash && Sound.crash();
        }
      }
      if (b.y < 0 || b.z > p.z + 12) b.gone = true;
    }
    if ((b.gone || b.scored) && !g.finished) {
      g.messageTimer -= dt;
      if (g.messageTimer <= 0) {
        g.kicked++;
        if (g.kicked >= g.attempts) {
          g.finished = true;
          g.stars = fgStarsFor(g.level, g.made);
          // Persist best-record for this level. Stars never go down; ties
          // keep the higher score and made count.
          save.fieldGoalLevels = save.fieldGoalLevels || {};
          const prev = save.fieldGoalLevels[g.level.id];
          const rec = { stars: g.stars, made: g.made, attempts: g.attempts, score: g.score };
          if (!prev || rec.stars > (prev.stars || 0) ||
              (rec.stars === prev.stars && rec.score > (prev.score || 0))) {
            save.fieldGoalLevels[g.level.id] = rec;
          }
          // Cash payout — credit on level finish so the level-based flow
          // still rewards the wallet (Can Bash skips this; FG keeps it
          // because it's how the original mode behaved).
          const cash = FieldGoal.payout(g);
          save.cash += cash;
          g.cashEarned = cash;
          persistSave();
        } else {
          FieldGoal.reset(g);
        }
      }
    }
  },
  render(g) {
    if (!g.ball) FieldGoal.reset(g);
    fpSetCam(g.cameraZ || 0);
    if (g.condition === "snowstorm") {
      // Heavy overcast sky for the snowstorm condition. Lighter fog tint
      // also overlays at the end of render to wash out distant geometry.
      fpDrawSky("#9aa6b3", "#e8edf2", "#9bb39a");
    } else {
      fpDrawSky("#7fbcff", "#cfeaff", "#4d8d2a");
    }

    // Stadium stands behind the field — three banked tiers with a crowd
    // pattern, then a back-wall scoreboard. The whole structure projects
    // back-of-end-zone via the perspective helper so it grows on approach.
    {
      const standZ = g.posts.z + 18;        // a few meters past end zone
      const standW = 70;                     // wide enough to fill the frame
      // Lower wall (concrete)
      const wallNearL = fpProject(-standW/2, 0, standZ - 2);
      const wallNearR = fpProject( standW/2, 0, standZ - 2);
      const wallTopL  = fpProject(-standW/2, 4, standZ);
      const wallTopR  = fpProject( standW/2, 4, standZ);
      ctx.fillStyle = "#3a3036";
      ctx.beginPath();
      ctx.moveTo(wallNearL.sx, wallNearL.sy);
      ctx.lineTo(wallNearR.sx, wallNearR.sy);
      ctx.lineTo(wallTopR.sx, wallTopR.sy);
      ctx.lineTo(wallTopL.sx, wallTopL.sy);
      ctx.closePath(); ctx.fill();
      // Tiered seating — three bands of color rising up.
      const tiers = [
        { y0: 4,  y1: 9,  color: "#1a3a6a" },
        { y0: 9,  y1: 13, color: "#2c4a82" },
        { y0: 13, y1: 16, color: "#1a3a6a" },
      ];
      for (const t of tiers) {
        const tlA = fpProject(-standW/2, t.y0, standZ);
        const trA = fpProject( standW/2, t.y0, standZ);
        const tlB = fpProject(-standW/2, t.y1, standZ);
        const trB = fpProject( standW/2, t.y1, standZ);
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.moveTo(tlA.sx, tlA.sy);
        ctx.lineTo(trA.sx, trA.sy);
        ctx.lineTo(trB.sx, trB.sy);
        ctx.lineTo(tlB.sx, tlB.sy);
        ctx.closePath(); ctx.fill();
        // Crowd dots — pseudo-random based on tier index + position.
        const rowProj = fpProject(0, (t.y0 + t.y1) / 2, standZ);
        const dotR = Math.max(1, 1.6 * rowProj.scale * 6);
        const dotPalette = ["#ffd03a","#ff5a3a","#fff","#4ddc8c","#6ee7ff","#cccccc"];
        const startSX = tlA.sx, endSX = trA.sx;
        const span = endSX - startSX;
        const count = Math.floor(span / Math.max(4, dotR * 2.2));
        for (let i = 0; i < count; i++) {
          const px = startSX + (i + 0.5) * (span / count);
          const py = (tlA.sy + tlB.sy) / 2 +
                     ((i * 53 + tiers.indexOf(t) * 17) % 7) - 4;
          ctx.fillStyle = dotPalette[(i + tiers.indexOf(t)) % dotPalette.length];
          ctx.fillRect(px - dotR, py - dotR, dotR * 2, dotR * 2);
        }
      }
      // Top railing
      const railL = fpProject(-standW/2, 16, standZ);
      const railR = fpProject( standW/2, 16, standZ);
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = Math.max(1, 1.2 * railL.scale * 6);
      ctx.beginPath();
      ctx.moveTo(railL.sx, railL.sy);
      ctx.lineTo(railR.sx, railR.sy);
      ctx.stroke();

      // Stadium lights — two tall poles flanking the stand.
      for (const lx of [-standW/2 + 4, standW/2 - 4]) {
        const poleBot = fpProject(lx, 0, standZ + 1);
        const poleTop = fpProject(lx, 22, standZ + 1);
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = Math.max(1.5, 2 * poleBot.scale * 6);
        ctx.beginPath(); ctx.moveTo(poleBot.sx, poleBot.sy); ctx.lineTo(poleTop.sx, poleTop.sy); ctx.stroke();
        // Light fixture rectangle
        ctx.fillStyle = "#fff8c0";
        ctx.fillRect(poleTop.sx - 12 * poleTop.scale * 6,
                     poleTop.sy - 6 * poleTop.scale * 6,
                     24 * poleTop.scale * 6, 8 * poleTop.scale * 6);
        // Glow
        const gg = ctx.createRadialGradient(poleTop.sx, poleTop.sy, 0,
                                             poleTop.sx, poleTop.sy, 80);
        gg.addColorStop(0, "rgba(255,250,200,0.55)");
        gg.addColorStop(1, "rgba(255,250,200,0)");
        ctx.fillStyle = gg;
        ctx.fillRect(poleTop.sx - 100, poleTop.sy - 100, 200, 200);
      }
    }

    fpDrawField("#3a7a1f", "rgba(255,255,255,0.45)");

    // Yard-line numbers down the field — every 10 yards (≈9.14m). Drawn
    // on both sides of the field with reverse on the far side.
    {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.textAlign = "center";
      for (let z = 9; z < 50; z += 9) {
        const labelLeft  = fpProject(-3.0, 0.05, z);
        const labelRight = fpProject( 3.0, 0.05, z);
        const yardsAway = Math.round(z * 1.094);
        const num = String(50 - Math.min(50, yardsAway));
        const fs = Math.max(8, 22 * labelLeft.scale);
        ctx.font = `bold ${fs}px ui-monospace, monospace`;
        ctx.fillText(num, labelLeft.sx, labelLeft.sy);
        ctx.fillText(num, labelRight.sx, labelRight.sy);
      }
      ctx.textAlign = "start";
    }
    // End-zone tint behind the posts.
    const ezNear = fpProject(-25, 0, g.posts.z - 2);
    const ezFar  = fpProject( 25, 0, g.posts.z + 8);
    if (ezFar.sy < ezNear.sy) {
      ctx.fillStyle = "rgba(255, 100, 60, 0.20)";
      ctx.fillRect(0, ezFar.sy, W, ezNear.sy - ezFar.sy);
    }

    const p = g.posts;
    const px = p.x || 0;
    // Helper — draw one goal-post set (stem, crossbar, two uprights).
    // Color is the post tint; live posts are bright yellow, decoy posts
    // in triple mode are silver-white so the live set stands out.
    function drawPostSet(centerX, postZ, gap, color) {
      const sBase = fpProject(centerX, 0, postZ);
      const sTop  = fpProject(centerX, p.crossbar, postZ);
      const cL    = fpProject(centerX - gap / 2, p.crossbar, postZ);
      const cR    = fpProject(centerX + gap / 2, p.crossbar, postZ);
      const uL    = fpProject(centerX - gap / 2, p.top, postZ);
      const uR    = fpProject(centerX + gap / 2, p.top, postZ);
      ctx.lineCap = "round";
      ctx.strokeStyle = color;
      const w = Math.max(3, 8 * sBase.scale * 6);
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(sBase.sx, sBase.sy); ctx.lineTo(sTop.sx, sTop.sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cL.sx, cL.sy); ctx.lineTo(cR.sx, cR.sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cL.sx, cL.sy); ctx.lineTo(uL.sx, uL.sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cR.sx, cR.sy); ctx.lineTo(uR.sx, uR.sy); ctx.stroke();
      ctx.lineCap = "butt";
      const padNear = fpProject(centerX - 0.4, 0, postZ + 0.4);
      const padFar  = fpProject(centerX + 0.4, 0, postZ - 0.4);
      ctx.fillStyle = "#fff";
      ctx.fillRect(padFar.sx, padFar.sy - 8, Math.max(4, padNear.sx - padFar.sx), 10);
    }
    const postYellow = "#ffd03a";
    if (g.condition === "triple") {
      // Three goal sets at fixed offsets relative to the active center.
      // Only the live slot scores (the live slot's posts are gold; decoys
      // are silver-white). Offsets must match the hit-detection table in
      // update().
      const tripleOffsets = [-5, 0, 5];
      const liveSlot = g.liveSlot;
      tripleOffsets.forEach((dx, i) => {
        if (i === liveSlot) return;
        drawPostSet(px + dx, p.z, p.gap, "#cfd6e3");
      });
      drawPostSet(px + tripleOffsets[liveSlot], p.z, p.gap, postYellow);
    } else {
      drawPostSet(px, p.z, p.gap, postYellow);
    }
    // Bullseye ring — gold loop centered above the crossbar; cleared
    // through the ring stacks +5 onto the make.
    if (g.condition === "bullseye") {
      const ringYMid = p.crossbar + 1.1;
      const ringXHalf = p.gap * 0.18;
      const ringTop  = fpProject(px, ringYMid + 0.7, p.z);
      const ringBot  = fpProject(px, ringYMid - 0.7, p.z);
      const ringLft  = fpProject(px - ringXHalf, ringYMid, p.z);
      const ringRgt  = fpProject(px + ringXHalf, ringYMid, p.z);
      ctx.strokeStyle = postYellow;
      ctx.lineWidth = Math.max(2, 4 * ringTop.scale * 6);
      ctx.beginPath();
      ctx.ellipse(
        (ringLft.sx + ringRgt.sx) / 2, (ringTop.sy + ringBot.sy) / 2,
        Math.max(2, (ringRgt.sx - ringLft.sx) / 2),
        Math.max(2, (ringBot.sy - ringTop.sy) / 2),
        0, 0, Math.PI * 2
      );
      ctx.stroke();
    }

    // Wind flag — pole + waving flag at the back of the end zone, behind
    // and slightly offset from the goalposts. Bends in the wind direction.
    {
      const flagX = px - 8;            // 8m to the left of the goal center
      const flagZ = p.z + 6;            // a few meters behind the posts
      const flagH = 4.5;                // pole height (m)
      const poleBase = fpProject(flagX, 0, flagZ);
      const poleTop  = fpProject(flagX, flagH, flagZ);
      // Pole
      ctx.strokeStyle = "#fff";
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1.5, 4 * poleBase.scale * 6);
      ctx.beginPath();
      ctx.moveTo(poleBase.sx, poleBase.sy);
      ctx.lineTo(poleTop.sx, poleTop.sy);
      ctx.stroke();
      ctx.lineCap = "butt";
      // Flag — drawn as a quad anchored at top of pole, swept in wind
      // direction. wsign = +1 for wind blowing right, -1 for wind left.
      const wsign = g.wind >= 0 ? 1 : -1;
      const wpow  = Math.min(1, Math.abs(g.wind) / 9);
      const flagLen = 1.4 + wpow * 1.2;       // longer when stronger
      const flagDrop = 1.0 - wpow * 0.5;      // higher when stronger (less droop)
      const flagTip  = fpProject(flagX + wsign * flagLen, flagH - flagDrop, flagZ);
      const flagBot  = fpProject(flagX,                   flagH - 1.4,      flagZ);
      const wave = Math.sin(performance.now() / 120) * 4;
      ctx.fillStyle = "#ff5a3a";
      ctx.beginPath();
      ctx.moveTo(poleTop.sx, poleTop.sy);
      ctx.lineTo(flagTip.sx, flagTip.sy + wave);
      ctx.lineTo(flagBot.sx, flagBot.sy);
      ctx.closePath(); ctx.fill();
      // White stripe across the flag
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(1, 1.5 * poleBase.scale * 6);
      ctx.beginPath();
      ctx.moveTo((poleTop.sx + flagBot.sx) / 2, (poleTop.sy + flagBot.sy) / 2);
      ctx.lineTo(flagTip.sx * 0.7 + (poleTop.sx + flagBot.sx) * 0.15,
                 (flagTip.sy + wave) * 0.7 + (poleTop.sy + flagBot.sy) * 0.15);
      ctx.stroke();
    }

    // HUD — wind, distance, score, attempts left.
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.font = "bold 16px ui-monospace, monospace";
    const dir = g.wind > 0.5 ? "→" : g.wind < -0.5 ? "←" : "·";
    ctx.fillText(`Wind: ${dir} ${Math.abs(Math.round(g.wind * 4))}`, 16, 26);
    const yards = Math.round(p.z * 1.094);
    ctx.fillText(`Distance: ${yards} yd`, 16, 48);
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(`Made: ${g.made}/${g.kicked}    Score: ${g.score}`, 16, 74);
    ctx.fillText(`Kicks left: ${Math.max(0, g.attempts - g.kicked)}`, 16, 96);
    if (g.level && g.level.name) {
      ctx.font = "bold 14px ui-monospace, monospace";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(g.level.name, 16, 116);
    }
    if (g.condition && g.condition !== "standard") {
      const info = FG_CONDITION_INFO[g.condition];
      if (info) {
        ctx.font = "bold 13px ui-monospace, monospace";
        ctx.fillStyle = "rgba(255, 90, 60, 0.85)";
        ctx.fillText(info.label, 16, 134);
      }
    }

    // Aim preview — when the ball is at rest, originate from its fixed
    // bottom-of-screen sprite position. Once kicked, switch to perspective.
    const restSX = W / 2;
    const restSY = H * 0.84;
    const restR  = Math.min(72, Math.max(48, W * 0.10));
    if (!g.ball.kicked) fpDrawAimArc(g, restSX, restSY);

    // Razor Wire — translucent red band at the upper edge of the legal
    // clearance window. Anything above this line is "Sailed!" in two_point.
    if (g.condition === "two_point") {
      const bandY = p.crossbar + 1.0;
      const wireL = fpProject(px - p.gap / 2, bandY, p.z);
      const wireR = fpProject(px + p.gap / 2, bandY, p.z);
      ctx.strokeStyle = "rgba(255, 60, 60, 0.85)";
      ctx.lineWidth = Math.max(1.5, 3 * wireL.scale * 6);
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(wireL.sx, wireL.sy);
      ctx.lineTo(wireR.sx, wireR.sy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Snowstorm flakes — drawn after the field/posts so they appear in
    // front, but before the football so the ball stays legible. Each
    // flake projects through the perspective helper so depth reads.
    if (g.snow) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const f of g.snow) {
        const proj = fpProject(f.x, f.y, f.z);
        if (!proj || proj.sy < 0 || proj.sy > H) continue;
        const sz = Math.max(1, 2.4 * proj.scale * 6);
        ctx.fillRect(proj.sx - sz / 2, proj.sy - sz / 2, sz, sz);
      }
    }

    // Football
    const b = g.ball;
    let bx, by, r, vertical;
    if (!b.kicked) {
      bx = restSX; by = restSY; r = restR; vertical = true;
    } else {
      const proj = fpProject(b.x, b.y, b.z);
      bx = proj.sx; by = proj.sy; r = Math.max(6, 22 * proj.scale);
      vertical = false;
    }
    // Tee shadow under the ball at rest.
    if (vertical) {
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.beginPath();
      ctx.ellipse(restSX, restSY + r * 0.95, r * 0.55, r * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(b.kicked ? b.t * 7 : 0);
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, "#9b5a2c"); grad.addColorStop(1, "#5a2a0e");
    ctx.fillStyle = grad;
    const rx = vertical ? r * 0.6  : r;
    const ry = vertical ? r * 0.95 : r * 0.62;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = Math.max(0.5, r * 0.05);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    if (r > 6) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(1.5, r * 0.06);
      if (vertical) {
        // Vertical lacing facing the kicker.
        ctx.beginPath(); ctx.moveTo(0, -ry * 0.6); ctx.lineTo(0, ry * 0.6); ctx.stroke();
        const lace = Math.max(2, r * 0.10);
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(-lace, i * ry * 0.18);
          ctx.lineTo( lace, i * ry * 0.18);
          ctx.stroke();
        }
      } else {
        // Horizontal lacing while tumbling end-over-end.
        ctx.beginPath(); ctx.moveTo(-r * 0.4, 0); ctx.lineTo(r * 0.4, 0); ctx.stroke();
        const lace = Math.max(2, r * 0.10);
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * r * 0.16, -lace);
          ctx.lineTo(i * r * 0.16,  lace);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    // Quick "kick" puff at the moment of impact.
    if (g.kickFx > 0) {
      const a = g.kickFx / 0.25;
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const puffR = (1 - a) * 80 + 30;
      ctx.beginPath(); ctx.arc(restSX, restSY + 10, puffR, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Snowstorm fog wash — soft white vignette over the whole frame so
    // the storm reads as low visibility. Drawn after the football so the
    // ball gets dimmed too, but before message text so the result still
    // pops.
    if (g.condition === "snowstorm") {
      const fog = ctx.createRadialGradient(W/2, H/2, W * 0.15, W/2, H/2, W * 0.75);
      fog.addColorStop(0, "rgba(245, 248, 255, 0.05)");
      fog.addColorStop(1, "rgba(245, 248, 255, 0.45)");
      ctx.fillStyle = fog;
      ctx.fillRect(0, 0, W, H);
    }
    if (g.message && g.messageTimer > 0) {
      ctx.font = "bold 56px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(g.message, W/2 + 3, H/2 + 3);
      const positive = g.message === "GOOD!" || g.message === "BULLSEYE!" ||
                       g.message.startsWith("Doink! ");
      ctx.fillStyle = positive ? "#4ddc8c" : "#ff5470";
      ctx.fillText(g.message, W/2, H/2);
      ctx.textAlign = "start";
    }
    if (!b.kicked && !g.dragStart) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.font = "bold 14px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Flick UP toward the goal — angle curves the kick", W/2, H * 0.95);
      ctx.textAlign = "start";
    }
  },
};

//----------------------------------------------------------
// CAN BASH — game-feel helpers
//----------------------------------------------------------
// Slow-motion factor used during big plays (explosion, big knockdown).
const CB_SLOW_FACTOR = 0.30;

// Best-effort vibration. Mobile-only; silently no-ops elsewhere. Wrapped
// so a stray call from desktop / Safari doesn't blow up the loop.
function cbVibrate(pattern) {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {}
}

// Fire all three feedback channels at once with sane defaults. Most
// callers want every channel for an event so this keeps trigger sites
// terse (one line per event class).
function cbJuice(g, opts) {
  if (opts.shake) g.shake = Math.max(g.shake, opts.shake);
  if (opts.pauseT) g.pauseT = Math.max(g.pauseT, opts.pauseT);
  if (opts.slowT) g.slowT = Math.max(g.slowT, opts.slowT);
  if (opts.vibrate) cbVibrate(opts.vibrate);
}

//----------------------------------------------------------
// CAN BASH (first-person flick)
//----------------------------------------------------------
const CanBash = {
  name: "Can Bash",
  desc: "Flick UP at the can stack. Knock 'em all down. 3 throws.",
  icon: "🥎",
  color: "#ff5a3a",
  init(level) {
    // Default to the first level if launched without one (legacy direct-launch
    // path). The level catalog drives the formation and ball budget.
    const lvl = level || CAN_LEVELS[0];
    const layout = buildCans(lvl);
    const tableZ = 10;
    const canHeight = 0.55;
    const canWidth  = 0.45;
    const cans = layout.cans.map(c => ({
      x: c.x, y: c.y, z: tableZ, w: canWidth, h: canHeight,
      hit: false, fallVx: 0, fallVy: 0, angle: 0, angVel: 0, fallT: 0,
      gold: !!c.gold,
      type: c.type || "standard",
      shatter: false, exploded: false,
    }));
    // If the level didn't pin a gold can, fall back to one random pick so
    // every match still has a bonus target.
    if (!cans.some(c => c.gold) && cans.length > 0) {
      cans[Math.floor(Math.random() * cans.length)].gold = true;
    }
    // First-encounter tutorial: queue a one-time toast for any new type
    // present in this level. The toasts surface during gameplay (see
    // update() — they pop one at a time on a small delay).
    save.canBashSeenTypes = save.canBashSeenTypes || {};
    const tutorialQueue = [];
    const seenInLevel = new Set();
    for (const c of cans) {
      if (c.type === "standard" || seenInLevel.has(c.type)) continue;
      seenInLevel.add(c.type);
      if (!save.canBashSeenTypes[c.type]) {
        const info = CAN_TYPE_INFO[c.type];
        if (info && info.label) tutorialQueue.push({ type: c.type, label: info.label });
        save.canBashSeenTypes[c.type] = true;
      }
    }
    if (tutorialQueue.length > 0) persistSave();
    return {
      level: lvl,
      cans, ball: null, extraBalls: [],
      throws: lvl.balls || 3,
      thrown: 0, score: 0, knocked: 0,
      tableZ, tableTopY: layout.tableTopY,
      message: "", messageTimer: 0, finished: false,
      cleared: false, stars: 0,
      dragStart: null, dragNow: null,
      _knockedAtThrow: 0,
      tutorialQueue, _tutorialNextAt: 0.5,
      // Game-feel state. Each is decayed in update() over time.
      //   shake     — pixel amplitude of screen-shake; render translates by
      //               a random offset proportional to it.
      //   pauseT    — when > 0, physics tick is paused for this many seconds
      //               (hit-pause / impact freeze).
      //   slowT     — when > 0, dt is multiplied by SLOW_FACTOR for this
      //               many seconds (slow-motion).
      shake: 0, pauseT: 0, slowT: 0,
      // Power-up state.
      //   pickups     — floating tokens bound to cans; collected on knock.
      //   activePower — single-slot inventory; arms the next throw and is
      //                 consumed when fired. Collecting overwrites.
      pickups: layout.pickups || [],
      activePower: null,
    };
  },
  // Step a single ball one physics frame. Handles travel, collision,
  // type-aware knock thresholds, cascade, support resolution, big-play
  // bonus, and bomb-ball AoE. Shared between the primary ball and any
  // multi-ball extras.
  _stepBall(g, b, dt) {
    if (!b || !b.thrown || b.gone) return;
    b.t += dt;
    b.vy -= 9.8 * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    if (b.z >= g.tableZ - 0.5 && !b.didHit) {
      const impactSpeed = Math.hypot(b.vx, b.vy, b.vz);
      let directHits = [];
      // Bomb-ball: detonate AoE at impact point regardless of which
      // can (if any) was struck. Knock everything within blast radius.
      if (b.bomb) {
        const BOMB_R = 1.0;
        for (const c of g.cans) {
          if (c.hit) continue;
          const dxA = c.x - b.x, dyA = c.y - b.y;
          if (Math.hypot(dxA, dyA) <= BOMB_R) {
            CanBash.knock(g, c, dxA * 4 + (Math.random() - 0.5) * 0.8,
                                -0.8 + dyA * 0.5);
            directHits.push(c);
          }
        }
        cbJuice(g, { shake: 22, pauseT: 0.12, slowT: 0.45, vibrate: [0, 40, 30, 40] });
      } else {
        for (const c of g.cans) {
          if (c.hit) continue;
          const dx = b.x - c.x;
          const dy = b.y - c.y;
          if (Math.abs(dx) < c.w * 0.55 + 0.18 && Math.abs(dy) < c.h * 0.6 + 0.18) {
            const info = CAN_TYPE_INFO[c.type] || CAN_TYPE_INFO.standard;
            if (impactSpeed >= info.knockSpeed) {
              CanBash.knock(g, c, b.vx * 0.4 + dx * 4, -b.vy * 0.5 + 1.2);
              directHits.push(c);
              cbJuice(g, { shake: 4, pauseT: 0.03, vibrate: 15 });
            } else {
              if (!g.message) {
                g.message = c.type === "lead" ? "Lead — flick HARDER!" : "Bounced off!";
                g.messageTimer = 1.0;
                Sound.crash && Sound.crash();
              }
              if (c.type === "lead") cbJuice(g, { shake: 6, vibrate: [0, 25, 15, 25] });
              else cbJuice(g, { shake: 2, vibrate: 8 });
            }
            const damp = c.type === "lead" ? 0.10 : 0.30;
            b.vx *= damp; b.vy *= damp; b.vz *= damp * 0.6;
          }
        }
      }
      // Cascade — only the can directly above each direct hit topples
      // (gravity-style). Two passes so a missing keystone can drop the
      // can resting on it, but no row-wide sideways chain reactions.
      for (let pass = 0; pass < 2; pass++) {
        const newly = [];
        for (const src of directHits) {
          for (const c of g.cans) {
            if (c.hit) continue;
            const dx = c.x - src.x;
            const dy = c.y - src.y;
            const above = dy < 0;
            if (above && Math.abs(dx) < src.w * 0.8 &&
                Math.abs(dy) < src.h * 1.3) {
              CanBash.knock(g, c,
                src.fallVx * 0.35 + dx * 1.5,
                -1.0 - Math.random() * 0.6);
              newly.push(c);
            }
          }
        }
        if (newly.length === 0) break;
        directHits = newly;
      }
      CanBash.resolveSupport(g);
      // Per-throw bonus tracks against g._knockedAtThrow (set in the
      // throw-release path). With multi-ball, all three balls share the
      // same _knockedAtThrow snapshot so the bonus can accumulate.
      const knockedThisThrow = g.knocked - (g._knockedAtThrow || 0);
      if (knockedThisThrow >= 5 && !g._bigPlayFiredThisThrow) {
        const bonus = Math.min(80, knockedThisThrow * 10);
        g.score += bonus;
        g.message = `${knockedThisThrow}-can KO! +${bonus}`;
        g.messageTimer = 1.6;
        cbJuice(g, {
          shake: 14, pauseT: 0.10, slowT: 0.50,
          vibrate: [0, 30, 20, 30, 20, 30],
        });
        g._bigPlayFiredThisThrow = true;
      }
      b.didHit = true;
    }
    if (b.z > g.tableZ + 4 || b.y < -1) b.gone = true;
  },
  knock(g, c, vx, vy) {
    if (c.hit) return;
    // If a pickup was bound to this can, hand it to the player. Single-
    // slot inventory: collecting a new one overwrites whatever was armed.
    const pickup = (g.pickups || []).find(p => g.cans[p.canIdx] === c && !p.taken);
    if (pickup) {
      pickup.taken = true;
      g.activePower = pickup.type;
      const info = POWER_INFO[pickup.type];
      if (info) {
        pushToast(info.label, "gold", 2200);
        // First-encounter persistence flag (separate from per-throw label).
        save.canBashSeenPowers = save.canBashSeenPowers || {};
        if (!save.canBashSeenPowers[pickup.type]) {
          save.canBashSeenPowers[pickup.type] = true;
          persistSave();
        }
      }
      cbVibrate(20);
    }
    c.hit = true;
    c.fallVx = vx + (Math.random() - 0.5) * 0.6;
    c.fallVy = vy;
    c.angle  = (Math.random() - 0.5) * 0.6;
    c.angVel = (Math.random() - 0.5) * 6;
    g.knocked++;
    const info = CAN_TYPE_INFO[c.type] || CAN_TYPE_INFO.standard;
    let pts = info.score;
    if (c.gold) pts += 50;     // gold bonus stacks on top of any type
    g.score += pts;
    if (c.type === "glass") {
      c.shatter = true;        // render branch swaps to shatter VFX
      cbJuice(g, { shake: 3, vibrate: 12 });
      Sound.pickup && Sound.pickup();
    } else if (c.type === "explosive") {
      c.exploded = true;
      // AoE: any unhit can within EXPLODE_RADIUS goes down regardless of
      // support. Chain reactions allowed — another explosive caught in the
      // blast detonates and recurses through this branch.
      const EXPLODE_RADIUS = 1.0;
      for (const o of g.cans) {
        if (o === c || o.hit) continue;
        const dxAoE = o.x - c.x, dyAoE = o.y - c.y;
        if (Math.hypot(dxAoE, dyAoE) <= EXPLODE_RADIUS) {
          CanBash.knock(g, o,
            dxAoE * 4 + (Math.random() - 0.5) * 0.8,
            -0.8 + dyAoE * 0.5);
        }
      }
      // Detonation feel: hard shake, brief freeze, slow-mo spillover so
      // the player sees the AoE topple chain. Chunky double-pulse haptics.
      cbJuice(g, { shake: 22, pauseT: 0.12, slowT: 0.45, vibrate: [0, 40, 30, 40] });
      Sound.crash && Sound.crash();
    } else if (c.type === "lead") {
      // Lead, when actually knocked, is the highlight of a hard flick.
      cbJuice(g, { shake: 10, pauseT: 0.06, vibrate: 35 });
      Sound.pickup && Sound.pickup();
    } else {
      Sound.pickup && Sound.pickup();
    }
  },
  // After any cascade, walk the stack and topple any can that has lost
  // its supporting can / table. Repeat until nothing falls.
  resolveSupport(g) {
    let pass = 0;
    while (pass++ < 8) {
      let droppedSomething = false;
      for (const c of g.cans) {
        if (c.hit) continue;
        // Bottom of this can in world coords.
        const bottomY = c.y - c.h * 0.5;
        // Supported by the table?
        if (bottomY <= g.tableTopY + 0.06) continue;
        // Supported by another standing can directly below?
        let supported = false;
        for (const o of g.cans) {
          if (o === c || o.hit) continue;
          const oTop = o.y + o.h * 0.5;
          const dy = bottomY - oTop;            // gap between bottoms
          const dx = Math.abs(c.x - o.x);
          if (dy >= -0.05 && dy <= 0.20 && dx < c.w * 0.85) {
            supported = true; break;
          }
        }
        if (!supported) {
          CanBash.knock(g, c, (Math.random() - 0.5) * 0.8, -0.4);
          droppedSomething = true;
        }
      }
      if (!droppedSomething) break;
    }
  },
  payout(g) {
    const cleared = g.cans.every(c => c.hit);
    return g.knocked * 30 + (cleared ? 100 : 0);
  },
  resetBall(g) {
    g.ball = { x: 0, y: 0.4, z: 3, vx: 0, vy: 0, vz: 0, spin: 0, thrown: false, gone: false, didHit: false, t: 0 };
    g.extraBalls = [];
  },
  handlePointer(g, kind, x, y) {
    if (g.finished) return;
    if (!g.ball) CanBash.resetBall(g);
    if (g.ball.thrown) return;
    const now = performance.now();
    if (kind === "down") {
      g.dragStart = { x, y, t: now };
      g.dragNow = { x, y };
      g.dragHistory = [{ x, y, t: now }];
      return;
    }
    if (kind === "move" && g.dragStart) {
      g.dragNow = { x, y };
      g.dragHistory.push({ x, y, t: now });
      // Keep only recent history (last 200ms) so the velocity sample
      // tracks how fast the finger is moving RIGHT NOW.
      const cutoff = now - 200;
      while (g.dragHistory.length > 0 && g.dragHistory[0].t < cutoff) {
        g.dragHistory.shift();
      }
      return;
    }
    if (kind !== "up" || !g.dragStart) return;

    // Release: where the finger landed is the AIM point. How fast the
    // finger was moving over the last ~100ms is the POWER.
    const hist = g.dragHistory || [];
    let fingerSpeed = 0; // px/s
    if (hist.length >= 2) {
      const last = hist[hist.length - 1];
      const cutoff = now - 110;
      const start = hist.find(p => p.t >= cutoff) || hist[0];
      const dt = (last.t - start.t) / 1000;
      if (dt > 0.005) {
        fingerSpeed = Math.hypot(last.x - start.x, last.y - start.y) / dt;
      }
    }
    g.dragStart = null; g.dragNow = null; g.dragHistory = null;

    // Aim mapping. The release POSITION on screen — not the drag
    // direction — drives both yaw and the target row. Inverse-project
    // the release point through the FP camera so the spot the finger
    // landed maps to a world target at the table's depth (z = tableZ).
    //
    // This is what the player intuits: "release at the bottom row" hits
    // the bottom row, "release at the apex" hits the apex. Drag length
    // and finger speed only set power, not aim height.
    const ballSX = W / 2;
    const ballSY = H * 0.84;
    if (y > ballSY - 40) return;                              // must release above the ball

    // Power from finger speed. ~600 px/s = soft, ~2400 px/s = full.
    const power = Math.max(0.18, Math.min(1, fingerSpeed / 2200));
    const speed = 11 + power * 23;                            // 11 → 34 m/s

    // Inverse-project screen Y at z=tableZ to a world Y. The FP camera
    // formula is sy = horizonY + (CAMERA_H − y) · focal / z, so:
    //   y = CAMERA_H − (sy − horizonY) · z / focal
    const horizonY = H * 0.55;                                // matches fpHorizonY()
    const tableZ = 10;
    const projY = 1.6 - (y - horizonY) * tableZ / 600;
    // Clamp to plausible can-row span so wild releases bias to the top
    // or bottom row instead of overshooting the stack.
    const target_y = Math.max(0.6, Math.min(4.0, projY));

    // Lateral aim from horizontal screen position. Center → straight,
    // far-left/right → ±45° yaw.
    const yaw = Math.max(-1, Math.min(1, (x - ballSX) / (W * 0.4))) * (Math.PI / 4);
    // Quadratic in u = tan(loft):  A·u² − B·u + (A + Δy) = 0
    //   A = g·Δz² / (speed² · cos²(yaw))   (gravity drop term)
    //   B = Δz / cos(yaw)                  (forward travel)
    //   Δy = target_y − y0                 (height gain over the throw)
    const dz = 7;                                             // z=3 → z=10
    const dy0 = target_y - 0.4;                               // ball y0 = 0.4
    const cosYaw = Math.max(0.6, Math.cos(yaw));
    const A = (4.9 * dz * dz) / (speed * speed * cosYaw * cosYaw);
    const B = dz / cosYaw;
    const disc = B * B - 4 * A * (A + dy0);
    let loft;
    if (disc < 0) {
      // Target unreachable at this speed — fall back to the apex of the
      // achievable parabola (max range, slightly short).
      loft = Math.atan(B / (2 * A));
    } else {
      const u = (B - Math.sqrt(disc)) / (2 * A);              // direct shot (smaller root)
      loft = Math.atan(Math.max(0.07, u));                    // ~4° floor for visible arc
    }
    g.ball.vz = speed * Math.cos(loft) * Math.cos(yaw);
    g.ball.vy = speed * Math.sin(loft);
    g.ball.vx = speed * Math.cos(loft) * Math.sin(yaw);
    if (g.ball.vz < 6) g.ball.vz = 6;
    // Power tax on accuracy: hard flicks wobble; soft flicks stay precise.
    const wildness = power * power * 0.22;
    g.ball.vx += (Math.random() - 0.5) * 3.0 * wildness;
    g.ball.vy += (Math.random() - 0.5) * 1.4 * wildness;
    g.ball.vz += (Math.random() - 0.5) * 1.0 * wildness;
    g.ball.spin = 0;
    g.ball.thrown = true;
    g.ball.trail = [];
    // Apply armed power-up. Single-slot inventory: consume on throw.
    if (g.activePower === "bomb") {
      g.ball.bomb = true;
    } else if (g.activePower === "multi") {
      // Spawn two extra balls flanking the primary with a small yaw spread
      // so the trio fans out toward the table. Each is independent.
      const make = (yawOffset) => {
        const yaw2 = yaw + yawOffset;
        const ex = {
          x: 0, y: 0.4, z: 3,
          vx: speed * Math.cos(loft) * Math.sin(yaw2),
          vy: speed * Math.sin(loft),
          vz: speed * Math.cos(loft) * Math.cos(yaw2),
          spin: 0, thrown: true, gone: false, didHit: false, t: 0, trail: [],
        };
        if (ex.vz < 6) ex.vz = 6;
        return ex;
      };
      g.extraBalls = [make(0.20), make(-0.20)];
    } else if (g.activePower === "slow") {
      // Whole-throw slow-mo: hold for ~3.5s of physics time, plenty for a
      // ball to fly out and land.
      g.slowT = Math.max(g.slowT, 3.5);
    }
    g.activePower = null; // consumed
    g.thrown++;
    g._knockedAtThrow = g.knocked;
    g._bigPlayFiredThisThrow = false;
    Sound.boostHit && Sound.boostHit();
  },
  update(g, dt) {
    if (!g.ball) CanBash.resetBall(g);
    // Game-feel pacing: hit-pause freezes physics; slow-mo scales dt.
    // Both decay on real wall-clock time (not physics dt) so the freeze
    // doesn't extend itself.
    if (g.pauseT > 0) {
      g.pauseT -= dt;
      // Still decay shake during pause so the screen doesn't lock-shake.
      g.shake *= 0.85;
      return;
    }
    if (g.slowT > 0) {
      g.slowT -= dt;
      dt *= CB_SLOW_FACTOR;
    }
    // Shake decays exponentially toward zero.
    g.shake *= Math.exp(-dt * 6);
    if (g.shake < 0.05) g.shake = 0;
    // Drive the first-encounter tutorial queue: one toast every ~2.5s,
    // only while the player hasn't thrown the first ball yet so it
    // doesn't compete with gameplay messages.
    if (g.tutorialQueue && g.tutorialQueue.length > 0 && !g.ball.thrown) {
      g._tutorialNextAt -= dt;
      if (g._tutorialNextAt <= 0) {
        const next = g.tutorialQueue.shift();
        pushToast(next.label, "gold", 2400);
        g._tutorialNextAt = 2.5;
      }
    }
    // Process the primary ball plus any multi-ball extras. Each is
    // independent for physics + collision, but knockdowns + bonuses pool
    // into the shared g.knocked / g.score counters.
    const allBalls = [g.ball, ...(g.extraBalls || [])];
    for (const b of allBalls) {
      CanBash._stepBall(g, b, dt);
    }
    for (const c of g.cans) {
      if (!c.hit) continue;
      c.fallT += dt;
      c.fallVy -= 9.8 * dt;
      c.x += c.fallVx * dt;
      c.y += c.fallVy * dt;
      c.angle += (c.angVel || 0) * dt;
      if (c.y < 0) c.y = 0;
    }
    // Throw is settled when EVERY ball (primary + multi-ball extras) has
    // either left the play volume or sat post-impact for at least 0.6s.
    const ballsSettled = allBalls.every(b => b.gone || (b.thrown && b.didHit && b.t > 0.6));
    if (ballsSettled && !g.finished) {
      const cleared = g.cans.every(c => c.hit);
      if (g.thrown >= g.throws || cleared) {
        if (cleared) g.score += 50;
        g.finished = true;
        g.cleared = cleared;
        g.stars = starsFor(g.level, g.thrown, cleared);
        // Outcome haptic: cleared = ascending triple-pulse, failed = a
        // single soft tap. The vibrate API ignores the call on desktop.
        cbVibrate(cleared ? [0, 25, 30, 25, 30, 60] : 80);
        // Persist best result for this level. Stars never go down; ties keep
        // the better ball-count and score.
        save.canBashLevels = save.canBashLevels || {};
        const prev = save.canBashLevels[g.level.id];
        const rec = { stars: g.stars, ballsUsed: g.thrown, score: g.score, cleared };
        if (!prev || rec.stars > prev.stars ||
            (rec.stars === prev.stars && rec.score > (prev.score || 0))) {
          save.canBashLevels[g.level.id] = rec;
        }
        persistSave();
      } else {
        CanBash.resetBall(g);
      }
    }
  },
  render(g) {
    if (!g.ball) CanBash.resetBall(g);
    // Screen-shake: brackets the entire render. Random offset proportional
    // to g.shake; restored at the end so the canvas state stays balanced.
    ctx.save();
    if (g.shake > 0.05) {
      const sx = (Math.random() - 0.5) * g.shake;
      const sy = (Math.random() - 0.5) * g.shake;
      ctx.translate(sx, sy);
    }
    fpSetCam(0);
    // Carnival sky — warm gradient, with a striped tent banner pinned to
    // the top and a string of bulbs swaying gently across the upper half.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#3a1a30"); sky.addColorStop(0.55, "#9b3a4a"); sky.addColorStop(1, "#3a2516");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // Striped tent roof — alternating red/cream triangles
    const tentH = Math.max(40, H * 0.10);
    const tentSegs = 12;
    for (let i = 0; i < tentSegs; i++) {
      const x0 = (i / tentSegs) * W;
      const x1 = ((i + 1) / tentSegs) * W;
      ctx.fillStyle = i % 2 === 0 ? "#e94c3a" : "#fff4d6";
      ctx.beginPath();
      ctx.moveTo(x0, 0); ctx.lineTo(x1, 0);
      ctx.lineTo((x0 + x1) / 2, tentH);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, tentH, W, 4);
    // String of bulbs hanging from the tent edge
    {
      const t = performance.now() / 1000;
      const sag = (x) => tentH + 10 + Math.sin(x * 0.018 + t * 0.6) * 6 + 22;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = sag(x);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      const bulbColors = ["#ffd03a", "#ff5a3a", "#6ee7ff", "#4ddc8c", "#fff"];
      for (let x = 30; x < W - 10; x += 60) {
        const y = sag(x) + 10;
        const c = bulbColors[Math.floor(x / 60) % bulbColors.length];
        // Glow
        const grad = ctx.createRadialGradient(x, y, 0, x, y, 20);
        grad.addColorStop(0, c); grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(x - 22, y - 22, 44, 44);
        // Bulb
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Ground (sawdust feel)
    fpDrawField("#5a3818", "rgba(255, 200, 100, 0.18)");

    // Table — wooden box at z=tableZ.
    const tableHalfW = 2.0, tableDepth = 1.2;
    const tlz = g.tableZ - tableDepth / 2;
    const trz = g.tableZ + tableDepth / 2;
    const topL = fpProject(-tableHalfW, g.tableTopY, tlz);
    const topR = fpProject( tableHalfW, g.tableTopY, tlz);
    const topBL = fpProject(-tableHalfW, g.tableTopY, trz);
    const topBR = fpProject( tableHalfW, g.tableTopY, trz);
    const botL = fpProject(-tableHalfW, 0, tlz);
    const botR = fpProject( tableHalfW, 0, tlz);
    ctx.fillStyle = "#5a2a10";
    ctx.beginPath();
    ctx.moveTo(topL.sx, topL.sy); ctx.lineTo(topR.sx, topR.sy);
    ctx.lineTo(botR.sx, botR.sy); ctx.lineTo(botL.sx, botL.sy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#8a4a26";
    ctx.beginPath();
    ctx.moveTo(topL.sx, topL.sy); ctx.lineTo(topR.sx, topR.sy);
    ctx.lineTo(topBR.sx, topBR.sy); ctx.lineTo(topBL.sx, topBL.sy);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,200,140,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(topL.sx, topL.sy); ctx.lineTo(topR.sx, topR.sy);
    ctx.stroke();

    // Cans (back-to-front)
    const sorted = g.cans.slice().sort((a, b) => b.y - a.y);
    for (const c of sorted) {
      const proj = fpProject(c.x, c.y, c.z);
      const w = Math.max(8, 32 * proj.scale);
      const h = Math.max(10, 40 * proj.scale);
      // Glass shatter: skip the can body; it's gone. Particles handled
      // after the loop.
      if (c.hit && c.shatter && c.fallT > 0.4) continue;
      ctx.save();
      ctx.translate(proj.sx, proj.sy);
      if (c.hit) ctx.rotate(c.angle);
      // Per-type body fill. Gold pulse overrides everything when the can
      // is still standing.
      const can = ctx.createLinearGradient(-w/2, 0, w/2, 0);
      if (c.gold && !c.hit) {
        const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 250);
        can.addColorStop(0, `rgba(180, 130, 30, ${pulse})`);
        can.addColorStop(0.5, `rgba(255, 220, 80, ${pulse})`);
        can.addColorStop(1, `rgba(180, 130, 30, ${pulse})`);
      } else if (c.type === "glass") {
        // Translucent cyan with a hint of bubble shimmer.
        const tShim = performance.now() / 800;
        const bright = 0.55 + 0.15 * Math.sin(tShim + c.x * 1.3);
        can.addColorStop(0, `rgba(120, 200, 220, 0.55)`);
        can.addColorStop(0.5, `rgba(200, 240, 255, ${bright})`);
        can.addColorStop(1, `rgba(120, 200, 220, 0.55)`);
      } else if (c.type === "lead") {
        can.addColorStop(0, "#363a44"); can.addColorStop(0.5, "#5a6070"); can.addColorStop(1, "#262830");
      } else if (c.type === "explosive") {
        // Pulsing red with a hot core — read as "danger" at a glance.
        const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 180);
        can.addColorStop(0, "#5a0a0a");
        can.addColorStop(0.5, `rgba(${230 + 25 * pulse}, ${40 + 20 * pulse}, 30, 1)`);
        can.addColorStop(1, "#5a0a0a");
      } else if (c.type === "stacker") {
        // Coin-stack — banded gold/copper.
        can.addColorStop(0, "#8a5a10");
        can.addColorStop(0.5, "#f0c050");
        can.addColorStop(1, "#8a5a10");
      } else {
        can.addColorStop(0, "#888"); can.addColorStop(0.5, "#dadada"); can.addColorStop(1, "#666");
      }
      ctx.fillStyle = can;
      ctx.fillRect(-w/2, -h/2, w, h);
      // Label band + decoration per type.
      if (c.type === "glass" && !c.hit) {
        // Subtle highlight stripe instead of a label.
        ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
        ctx.fillRect(-w/2 + w*0.1, -h*0.3, w*0.12, h*0.6);
      } else if (c.type === "lead") {
        // Crosshatch shading (just a couple of dark lines for texture).
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = Math.max(0.5, 1 * proj.scale);
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(-w/2, -h*0.4 + i * h*0.18);
          ctx.lineTo( w/2, -h*0.4 + i * h*0.18 + h*0.10);
          ctx.stroke();
        }
        ctx.fillStyle = "#1a1c22";
        ctx.fillRect(-w/2, -h * 0.18, w, h * 0.4);
      } else if (c.type === "explosive") {
        // Wrap label + fuse.
        ctx.fillStyle = "#1a0000";
        ctx.fillRect(-w/2, -h * 0.18, w, h * 0.4);
        if (!c.hit) {
          // Tiny fuse line on top
          ctx.strokeStyle = "#3a2a10";
          ctx.lineWidth = Math.max(0.6, 1.5 * proj.scale);
          ctx.beginPath();
          ctx.moveTo(0, -h/2);
          ctx.lineTo(w*0.18, -h/2 - h*0.2);
          ctx.stroke();
          // Fuse spark
          const sparkPhase = (performance.now() / 90) % 1;
          ctx.fillStyle = sparkPhase < 0.5 ? "#ffd03a" : "#ff5a3a";
          ctx.beginPath();
          ctx.arc(w*0.18, -h/2 - h*0.2, Math.max(1.2, 1.6 * proj.scale), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (c.type === "stacker") {
        // Banded coin lines.
        ctx.strokeStyle = "rgba(120, 80, 0, 0.6)";
        ctx.lineWidth = Math.max(0.4, 0.9 * proj.scale);
        for (let i = -2; i <= 2; i++) {
          const yy = i * h * 0.18;
          ctx.beginPath();
          ctx.moveTo(-w/2, yy); ctx.lineTo(w/2, yy);
          ctx.stroke();
        }
      } else {
        // Standard label band — red ribbon + white piping.
        ctx.fillStyle = c.gold ? "#7a4f00" : "#e94c3a";
        ctx.fillRect(-w/2, -h * 0.18, w, h * 0.4);
        ctx.fillStyle = "#fff";
        ctx.fillRect(-w/2, -h * 0.22, w, 1.5);
        ctx.fillRect(-w/2,  h * 0.22, w, 1.5);
      }
      // Gold star marking (orthogonal to type)
      if (c.gold) {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.max(8, 12 * proj.scale)}px ui-monospace`;
        ctx.textAlign = "center";
        ctx.fillText("★", 0, h * 0.07);
        ctx.textAlign = "start";
      }
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = Math.max(0.5, 1.2 * proj.scale);
      ctx.beginPath(); ctx.ellipse(0, -h/2, w/2, h * 0.07, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Type-specific knock VFX. Drawn on top of cans so they read clearly.
    for (const c of g.cans) {
      if (!c.hit) continue;
      const proj = fpProject(c.x, c.y, c.z);
      // Glass shatter — burst of cyan shards expanding from the can's
      // last position, fading over ~0.4s.
      if (c.type === "glass" && c.shatter) {
        const a = Math.max(0, 1 - c.fallT / 0.5);
        if (a > 0) {
          const r = 12 * proj.scale * (1 + c.fallT * 4);
          ctx.save();
          ctx.translate(proj.sx, proj.sy);
          for (let i = 0; i < 8; i++) {
            const ang = i / 8 * Math.PI * 2;
            const ex = Math.cos(ang) * r;
            const ey = Math.sin(ang) * r * 0.8;
            ctx.fillStyle = `rgba(180, 230, 255, ${a * 0.85})`;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex + 4 * proj.scale, ey - 6 * proj.scale);
            ctx.lineTo(ex - 3 * proj.scale, ey + 4 * proj.scale);
            ctx.closePath(); ctx.fill();
          }
          ctx.restore();
        }
      }
      // Explosive flash — radial gradient that punches at t=0 and fades.
      if (c.type === "explosive" && c.exploded) {
        const a = Math.max(0, 1 - c.fallT / 0.45);
        if (a > 0) {
          const r = 60 * proj.scale * (1 + c.fallT * 3);
          const grad = ctx.createRadialGradient(proj.sx, proj.sy, 0, proj.sx, proj.sy, r);
          grad.addColorStop(0, `rgba(255, 230, 120, ${a})`);
          grad.addColorStop(0.4, `rgba(255, 120, 40, ${a * 0.7})`);
          grad.addColorStop(1, `rgba(255, 60, 30, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(proj.sx, proj.sy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Power-up pickups — float a small icon above each uncollected
    // pickup's host can. Bobs gently for "grabbable" feel.
    if (g.pickups && g.pickups.length > 0) {
      const t = performance.now() / 400;
      for (const p of g.pickups) {
        if (p.taken) continue;
        const c = g.cans[p.canIdx];
        if (!c || c.hit) { p.taken = true; continue; }
        const proj = fpProject(c.x, c.y + 0.85 + Math.sin(t + p.canIdx) * 0.08, c.z);
        const sz = Math.max(14, 26 * proj.scale);
        // Glow
        const glow = ctx.createRadialGradient(proj.sx, proj.sy, 0, proj.sx, proj.sy, sz * 1.5);
        const tint = p.type === "bomb" ? "180, 60, 60"
                   : p.type === "multi" ? "80, 200, 240"
                   : "180, 130, 240";
        glow.addColorStop(0, `rgba(${tint}, 0.6)`);
        glow.addColorStop(1, `rgba(${tint}, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(proj.sx - sz * 1.5, proj.sy - sz * 1.5, sz * 3, sz * 3);
        // Icon
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.round(sz)}px ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const icon = p.type === "bomb" ? "💣"
                   : p.type === "multi" ? "✕3"
                   : "⏱";
        ctx.fillText(icon, proj.sx, proj.sy);
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "start";
      }
    }

    // Baseball — at-rest sprite at the bottom; perspective once thrown.
    const restSX = W / 2;
    const restSY = H * 0.84;
    const restR  = Math.min(64, Math.max(40, W * 0.085));
    if (!g.ball.thrown) fpDrawAimArc(g, restSX, restSY, "rgba(255, 90, 80, 0.85)");
    const b = g.ball;
    let bx, by, br;
    if (!b.thrown) {
      bx = restSX; by = restSY; br = restR;
    } else {
      const bp = fpProject(b.x, b.y, b.z);
      bx = bp.sx; by = bp.sy; br = Math.max(5, 18 * bp.scale);
    }
    // Trail: render fading ghosts of the ball so the arc reads.
    if (b.thrown) {
      b.trail = b.trail || [];
      b.trail.push({ x: bx, y: by, r: br });
      if (b.trail.length > 12) b.trail.shift();
      for (let i = 0; i < b.trail.length - 1; i++) {
        const tp = b.trail[i];
        const a = (i + 1) / b.trail.length;
        ctx.fillStyle = `rgba(255, 255, 255, ${a * 0.45})`;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, tp.r * (0.45 + 0.55 * a), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Helper for drawing a baseball — used for both the primary ball and
    // any multi-ball extras. Power-up tint is only applied to the primary
    // (at-rest) ball as a hint for what's armed.
    function drawBaseball(cx, cy, cr, rot, tintColor) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      const bgrad2 = ctx.createRadialGradient(-cr * 0.3, -cr * 0.3, cr * 0.1, 0, 0, cr);
      bgrad2.addColorStop(0, "#fff"); bgrad2.addColorStop(1, "#cfd6e3");
      ctx.fillStyle = bgrad2;
      ctx.beginPath(); ctx.arc(0, 0, cr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#aa0000";
      ctx.lineWidth = Math.max(1, cr * 0.10);
      if (cr > 5) {
        ctx.beginPath(); ctx.arc(0, 0, cr * 0.78, -0.6, 0.6); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, cr * 0.78, Math.PI - 0.6, Math.PI + 0.6); ctx.stroke();
        const dash = Math.max(2, cr * 0.10);
        for (let i = -2; i <= 2; i++) {
          const a = i * 0.18;
          const x1 = Math.cos(a) * cr * 0.78, y1 = Math.sin(a) * cr * 0.78;
          const x2 = Math.cos(a) * cr * 0.62, y2 = Math.sin(a) * cr * 0.62;
          ctx.beginPath(); ctx.moveTo(x1 + dash, y1); ctx.lineTo(x2 + dash, y2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-x1 - dash, y1); ctx.lineTo(-x2 - dash, y2); ctx.stroke();
        }
      }
      // Power-up tint overlay (only on the resting primary ball).
      if (tintColor) {
        ctx.fillStyle = tintColor;
        ctx.beginPath(); ctx.arc(0, 0, cr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    let armedTint = null;
    if (!b.thrown && g.activePower) {
      armedTint = g.activePower === "bomb"  ? "rgba(220, 60, 40, 0.30)"
                : g.activePower === "multi" ? "rgba(80, 200, 240, 0.30)"
                : "rgba(180, 130, 240, 0.30)";
    }
    drawBaseball(bx, by, br, b.t * 8, armedTint);
    // Bomb-ball glow overlay while flying.
    if (b.thrown && b.bomb) {
      ctx.save();
      const glow = ctx.createRadialGradient(bx, by, 0, bx, by, br * 2.2);
      glow.addColorStop(0, "rgba(255, 120, 60, 0.55)");
      glow.addColorStop(1, "rgba(255, 60, 30, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(bx - br * 2.5, by - br * 2.5, br * 5, br * 5);
      ctx.restore();
    }
    // Multi-ball extras — same projection pipeline, no rest position.
    for (const eb of (g.extraBalls || [])) {
      if (eb.gone) continue;
      const ep = fpProject(eb.x, eb.y, eb.z);
      const er = Math.max(5, 18 * ep.scale);
      eb.trail = eb.trail || [];
      eb.trail.push({ x: ep.sx, y: ep.sy, r: er });
      if (eb.trail.length > 10) eb.trail.shift();
      for (let i = 0; i < eb.trail.length - 1; i++) {
        const tp = eb.trail[i];
        const a = (i + 1) / eb.trail.length;
        ctx.fillStyle = `rgba(160, 230, 255, ${a * 0.45})`;
        ctx.beginPath();
        ctx.arc(tp.x, tp.y, tp.r * (0.45 + 0.55 * a), 0, Math.PI * 2);
        ctx.fill();
      }
      drawBaseball(ep.sx, ep.sy, er, eb.t * 8, null);
    }

    // HUD
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.font = "bold 16px ui-monospace, monospace";
    if (g.level && g.level.name) ctx.fillText(`${g.level.name}`, 16, 24);
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(`Knocked: ${g.knocked} / ${g.cans.length}    Score: ${g.score}`, 16, 48);
    ctx.fillText(`Balls left: ${Math.max(0, g.throws - g.thrown)} / ${g.throws}`, 16, 72);
    if (g.activePower) {
      const icon = g.activePower === "bomb" ? "💣 Bomb-ball"
                 : g.activePower === "multi" ? "✕3 Multi-ball"
                 : "⏱ Slow-time";
      ctx.fillStyle = "#ffd03a";
      ctx.font = "bold 16px ui-monospace, monospace";
      ctx.fillText(`Armed: ${icon}`, 16, 96);
    }
    if (!b.thrown && !g.dragStart) {
      ctx.font = "bold 14px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Flick UP at the cans — angle bends the throw", W/2, H * 0.95);
      ctx.textAlign = "start";
    }
    ctx.restore(); // matches the save() at the top of render() (shake)
  },
};


//----------------------------------------------------------
// DUCK HUNT (tap-to-shoot)
//----------------------------------------------------------
const DuckHunt = {
  name: "Duck Hunt",
  desc: "Tap the ducks before they fly off. 10 shots.",
  icon: "🦆",
  color: "#ffce6e",
  init() {
    return {
      ducks: [], shots: 10, fired: 0, hits: 0, score: 0, time: 0,
      spawnTimer: 0, finished: false, message: "", messageTimer: 0,
      muzzle: 0, // briefly flash on shot
      cursor: { x: W / 2, y: H / 2, active: false },
      streak: 0,
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
      y: H * (0.25 + Math.random() * 0.45),
      vx: fromLeft ? speed : -speed,
      vy: -20 - Math.random() * 40,
      hit: false, alpha: 1, t: 0,
      gold, small,
      size: small ? 0.7 : 1.0,
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
      g.streak++;
      const mult = Math.min(3, 1 + g.streak * 0.25);
      const earn = Math.round(base * mult);
      g.score += earn;
      g.message = `+${earn}${g.streak >= 3 ? "  x" + g.streak : ""}`;
      g.messageTimer = 0.7;
      Sound.gem && Sound.gem();
    } else {
      g.streak = 0;
    }
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
        d.alpha = Math.max(0, d.alpha - dt * 0.5);
      } else {
        d.y += d.vy * dt;
      }
    }
    g.ducks = g.ducks.filter(d => d.x > -60 && d.x < W + 60 && d.y < H + 60 && d.alpha > 0);
    // End when out of shots and ducks have left.
    if (g.fired >= g.shots && g.ducks.length === 0 && !g.finished) {
      g.finished = true;
    }
  },
  render(g) {
    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#9ad0ff"); sky.addColorStop(0.6, "#cfe7ff"); sky.addColorStop(1, "#7da64a");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // Hills
    ctx.fillStyle = "#3a7a1f";
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H * 0.78 + Math.sin(x * 0.012) * 16);
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    // Reeds
    ctx.fillStyle = "#1a3010";
    for (let x = 0; x < W; x += 14) ctx.fillRect(x, H * 0.84, 2, 14);

    // Drifting clouds for some sky depth.
    {
      const t = performance.now() / 1000;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (let i = 0; i < 4; i++) {
        const cx = ((i * 280 + t * (10 + i * 4)) % (W + 200)) - 100;
        const cy = 60 + (i % 3) * 40;
        const cw = 36 + (i % 3) * 10;
        ctx.beginPath();
        ctx.arc(cx, cy, cw, 0, Math.PI * 2);
        ctx.arc(cx + cw * 0.7, cy + 4, cw * 0.7, 0, Math.PI * 2);
        ctx.arc(cx - cw * 0.7, cy + 4, cw * 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Ducks
    for (const d of g.ducks) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.scale((d.vx < 0 ? -1 : 1) * d.size, d.size);
      ctx.globalAlpha = d.alpha;
      const bodyCol = d.gold ? "#ffce6e" : (d.hit ? "#7a4a14" : "#4a3018");
      const headCol = d.gold ? "#a07020" : "#1a4f2a";
      const wingCol = d.gold ? "#7a4a00" : "#2a1a08";
      // Body
      ctx.fillStyle = bodyCol;
      ctx.beginPath(); ctx.ellipse(0, 0, 18, 10, 0, 0, Math.PI * 2); ctx.fill();
      // Head
      ctx.fillStyle = headCol;
      ctx.beginPath(); ctx.arc(14, -8, 7, 0, Math.PI * 2); ctx.fill();
      // Beak
      ctx.fillStyle = "#ffb020";
      ctx.fillRect(20, -8, 7, 3);
      // Wing flap
      const flap = d.hit ? -0.3 : Math.sin(d.t * 18) * 0.6;
      ctx.fillStyle = wingCol;
      ctx.save();
      ctx.rotate(flap);
      ctx.beginPath(); ctx.ellipse(0, -6, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Eye
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(16, -10, 1.5, 0, Math.PI * 2); ctx.fill();
      // Gold halo
      if (d.gold && !d.hit) {
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 36);
        grad.addColorStop(0, "rgba(255, 220, 80, 0.55)");
        grad.addColorStop(1, "rgba(255, 220, 80, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(-44, -44, 88, 88);
      }
      ctx.restore();
    }
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
      ctx.fillStyle = "rgba(255, 80, 80, 0.85)";
      ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
    }
    // Floating "+pts" message
    if (g.message && g.messageTimer > 0) {
      const a = Math.min(1, g.messageTimer / 0.7);
      ctx.globalAlpha = a;
      ctx.font = "bold 22px ui-monospace, monospace";
      ctx.fillStyle = "#ffe680";
      ctx.textAlign = "center";
      ctx.fillText(g.message, W / 2, H * 0.18);
      ctx.textAlign = "start";
      ctx.globalAlpha = 1;
    }
    // HUD
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(`Hits: ${g.hits} / ${g.fired}    Score: ${g.score}`, 16, 28);
    ctx.fillText(`Shots left: ${Math.max(0, g.shots - g.fired)}`, 16, 52);
    if (g.fired === 0) {
      ctx.font = "bold 16px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Tap a duck to shoot it", W/2, H * 0.95);
      ctx.textAlign = "start";
    }
  },
};

//----------------------------------------------------------
// HOOPS (first-person flick — basketball)
//----------------------------------------------------------
const Hoops = {
  name: "Hoops",
  desc: "Flick the basketball at the rim. Free throws, threes, and deep bombs from random spots.",
  icon: "🏀",
  color: "#ff7a2c",
  init() {
    return {
      ball: null, hoop: null, shotType: "free",
      attempts: 8, taken: 0, made: 0, swishes: 0, score: 0,
      message: "", messageTimer: 0, finished: false,
      dragStart: null, dragNow: null, cameraZ: 0,
    };
  },
  payout(g) { return Math.floor((g.score || 0) * 1.0); },
  reset(g) {
    const a = g.taken || 0;
    // Mix: first attempt is a free throw, then random across types.
    let shotType, hoopZ, hoopX;
    const r = Math.random();
    if (a === 0)        { shotType = "FREE";  hoopZ = 5.5; hoopX = (Math.random()-0.5) * 0.4; }
    else if (r < 0.4)   { shotType = "FREE";  hoopZ = 5  + Math.random() * 1.5; hoopX = (Math.random()-0.5) * 0.6; }
    else if (r < 0.8)   { shotType = "THREE"; hoopZ = 7  + Math.random() * 1.5; hoopX = (Math.random()-0.5) * 4.0; }
    else                { shotType = "DEEP";  hoopZ = 9  + Math.random() * 2.0; hoopX = (Math.random()-0.5) * 5.0; }
    g.shotType = shotType;
    g.hoop = { z: hoopZ, x: hoopX, y: 3.05 };
    g.ball = { x: 0, y: 0.4, z: 1.6, vx: 0, vy: 0, vz: 0,
               released: false, scored: false, gone: false, t: 0,
               trail: [] };
    g.netFlop = 0;
    g.message = ""; g.messageTimer = 0;
    g.cameraZ = 0;
  },
  handlePointer(g, kind, x, y) {
    if (g.finished) return;
    if (!g.ball) Hoops.reset(g);
    if (g.ball.released) return;
    const flick = fpProcessFlick(g, kind, x, y);
    if (!flick) return;
    const { power, lateral, upward } = flick;
    const distScale = Math.max(0.7, g.hoop.z / 7);
    g.ball.vz = (8 + power * 9) * distScale * (0.6 + 0.4 * upward);
    g.ball.vy = 5 + power * 9 * upward;
    g.ball.vx = lateral * 5 * power;
    g.ball.released = true;
    Sound.boostHit && Sound.boostHit();
  },
  update(g, dt) {
    if (!g.ball) Hoops.reset(g);
    const b = g.ball, h = g.hoop;
    if (b.released && !b.gone) {
      b.t += dt;
      b.vy -= 9.8 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      g.cameraZ = g.cameraZ + (Math.max(0, b.z - 3) - g.cameraZ) * Math.min(1, dt * 4);
      // Score: ball passes through rim plane (y = h.y) descending, within ~0.30m radius.
      if (!b.scored && b.y < h.y && b.vy < 0) {
        const dx = b.x - h.x;
        const dz = b.z - h.z;
        const radial = Math.sqrt(dx*dx + dz*dz);
        if (radial < 0.30) {
          b.scored = true;
          const points = g.shotType === "FREE" ? 2 : (g.shotType === "THREE" ? 3 : 4);
          const swish = radial < 0.14 && Math.abs(dz) < 0.08;
          g.made++;
          if (swish) g.swishes++;
          const earn = points + (swish ? 1 : 0);
          g.score += earn;
          g.message = swish ? `SWISH! +${earn}` : `MAKE! +${earn}`;
          g.messageTimer = 1.4;
          Sound.perfect && Sound.perfect();
          // Damp the ball so it falls through the net visibly.
          b.vy = -2; b.vx *= 0.4; b.vz *= 0.2;
          g.netFlop = 0.6; // animate the net flopping outward
        }
      }
      if (g.netFlop > 0) g.netFlop = Math.max(0, g.netFlop - dt * 1.5);
      if (b.y < 0 || b.z > h.z + 6 || Math.abs(b.x) > 16) {
        b.gone = true;
        if (!b.scored) { g.message = "Miss"; g.messageTimer = 1.0; Sound.crash && Sound.crash(); }
      }
    }
    if ((b.gone || b.scored) && !g.finished) {
      g.messageTimer -= dt;
      if (g.messageTimer <= 0) {
        g.taken++;
        if (g.taken >= g.attempts) g.finished = true;
        else Hoops.reset(g);
      }
    }
  },
  render(g) {
    if (!g.ball) Hoops.reset(g);
    fpSetCam(g.cameraZ || 0);
    // Indoor gym: warm overhead lights blending down to a hardwood floor.
    fpDrawSky("#1a1226", "#2c2236", "#4a2a14");

    // Court floor — perspective hardwood with a court-line key, free-throw
    // line, and 3-point arc.
    const horizon = fpHorizonY();
    // Hardwood (skip fpDrawField — we draw our own court markings here).
    {
      const grad = ctx.createLinearGradient(0, horizon, 0, H);
      grad.addColorStop(0, "#a06030"); grad.addColorStop(1, "#5a3220");
      ctx.fillStyle = grad;
      ctx.fillRect(0, horizon, W, H - horizon);
    }
    // Wood grain — long forward-going stripes at lane edges.
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    for (let lane = -6; lane <= 6; lane++) {
      const near = fpProject(lane * 1.2, 0, 1);
      const far  = fpProject(lane * 1.2, 0, 80);
      ctx.beginPath(); ctx.moveTo(near.sx, near.sy); ctx.lineTo(far.sx, far.sy); ctx.stroke();
    }
    // Free throw key — a painted rectangle on the floor.
    const h = g.hoop;
    {
      const keyHalfW = 1.8;
      const keyZ0 = h.z - 4.6;        // free-throw line
      const keyZ1 = h.z + 0.2;        // base of backboard
      const k1 = fpProject(h.x - keyHalfW, 0, keyZ0);
      const k2 = fpProject(h.x + keyHalfW, 0, keyZ0);
      const k3 = fpProject(h.x + keyHalfW, 0, keyZ1);
      const k4 = fpProject(h.x - keyHalfW, 0, keyZ1);
      ctx.fillStyle = "rgba(170, 60, 40, 0.55)";
      ctx.beginPath();
      ctx.moveTo(k1.sx, k1.sy); ctx.lineTo(k2.sx, k2.sy);
      ctx.lineTo(k3.sx, k3.sy); ctx.lineTo(k4.sx, k4.sy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = Math.max(1.2, 2 * k1.scale * 6);
      ctx.stroke();
    }
    // Three-point arc on the floor.
    {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = Math.max(1, 1.5 * 6);
      ctx.beginPath();
      let started = false;
      const arcR = 6.75;
      for (let a = -Math.PI / 2 - 1.0; a <= -Math.PI / 2 + 1.0; a += 0.05) {
        const px = h.x + Math.cos(a) * arcR;
        const pz = h.z + Math.sin(a) * arcR;
        if (pz < 0.5) continue;
        const p = fpProject(px, 0, pz);
        if (!started) { ctx.moveTo(p.sx, p.sy); started = true; }
        else ctx.lineTo(p.sx, p.sy);
      }
      ctx.stroke();
    }
    // Free-throw line.
    {
      const ftZ = h.z - 4.6;
      const ftL = fpProject(h.x - 1.8, 0, ftZ);
      const ftR = fpProject(h.x + 1.8, 0, ftZ);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = Math.max(1.5, 2.5 * ftL.scale * 6);
      ctx.beginPath(); ctx.moveTo(ftL.sx, ftL.sy); ctx.lineTo(ftR.sx, ftR.sy); ctx.stroke();
    }

    // Backboard support — pole rising from BEHIND the backboard with a
    // horizontal arm to the back of the board.
    const armZ = h.z + 1.6;            // pole this far behind the rim
    const armBase = fpProject(h.x, 0, armZ);
    const armTop  = fpProject(h.x, h.y + 1.0, armZ);
    ctx.strokeStyle = "#222";
    ctx.lineWidth = Math.max(2, 5 * armBase.scale * 6);
    ctx.beginPath();
    ctx.moveTo(armBase.sx, armBase.sy);
    ctx.lineTo(armTop.sx, armTop.sy);
    ctx.stroke();
    // Horizontal arm from pole to back of backboard.
    const armToBoard = fpProject(h.x, h.y + 1.0, h.z + 0.15);
    ctx.lineWidth = Math.max(2, 4 * armBase.scale * 6);
    ctx.beginPath();
    ctx.moveTo(armTop.sx, armTop.sy);
    ctx.lineTo(armToBoard.sx, armToBoard.sy);
    ctx.stroke();

    // Backboard — white rectangle BEHIND the rim.
    const bbLeft = -0.9, bbRight = 0.9, bbBot = h.y + 0.1, bbTop = h.y + 1.5;
    const bbZ = h.z + 0.10;
    const bbBL = fpProject(h.x + bbLeft,  bbBot, bbZ);
    const bbBR = fpProject(h.x + bbRight, bbBot, bbZ);
    const bbTL = fpProject(h.x + bbLeft,  bbTop, bbZ);
    const bbTR = fpProject(h.x + bbRight, bbTop, bbZ);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.moveTo(bbBL.sx, bbBL.sy); ctx.lineTo(bbBR.sx, bbBR.sy);
    ctx.lineTo(bbTR.sx, bbTR.sy); ctx.lineTo(bbTL.sx, bbTL.sy);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = Math.max(1, 2 * bbBL.scale * 6);
    ctx.stroke();
    // Inner red shooter's square just above the rim.
    const sqL = h.x - 0.25, sqR = h.x + 0.25, sqB = h.y + 0.05, sqT = h.y + 0.55;
    const sBL = fpProject(sqL, sqB, bbZ - 0.01);
    const sBR = fpProject(sqR, sqB, bbZ - 0.01);
    const sTL = fpProject(sqL, sqT, bbZ - 0.01);
    const sTR = fpProject(sqR, sqT, bbZ - 0.01);
    ctx.strokeStyle = "#ff5a3a";
    ctx.lineWidth = Math.max(1, 3 * bbBL.scale * 6);
    ctx.beginPath();
    ctx.moveTo(sBL.sx, sBL.sy); ctx.lineTo(sBR.sx, sBR.sy);
    ctx.lineTo(sTR.sx, sTR.sy); ctx.lineTo(sTL.sx, sTL.sy);
    ctx.closePath(); ctx.stroke();

    // Rim — orange ring with a slight 3D shadow.
    const rimC = fpProject(h.x, h.y, h.z);
    const rimE = fpProject(h.x + 0.30, h.y, h.z);
    const rimRX = Math.abs(rimE.sx - rimC.sx);
    const rimRY = Math.max(2, rimRX * 0.35);
    // Underside (shadow)
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.ellipse(rimC.sx, rimC.sy + rimRY * 0.5, rimRX, rimRY, 0, 0, Math.PI * 2);
    ctx.fill();
    // Rim itself
    ctx.strokeStyle = "#ff7a2c";
    ctx.lineWidth = Math.max(2.5, 5 * rimC.scale * 6);
    ctx.beginPath();
    ctx.ellipse(rimC.sx, rimC.sy, rimRX, rimRY, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Highlight on the front edge of the rim.
    ctx.strokeStyle = "#ffce6e";
    ctx.lineWidth = Math.max(1, 2 * rimC.scale * 6);
    ctx.beginPath();
    ctx.ellipse(rimC.sx, rimC.sy, rimRX, rimRY, 0, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();

    // Net — strands hanging from rim. On a make, the net "flops" outward
    // (g.netFlop is decaying from 0.6 → 0).
    const flop = g.netFlop || 0;
    const netBotY = h.y - 0.45 + flop * 0.15; // rises briefly on swish
    ctx.strokeStyle = "rgba(245, 245, 245, 0.85)";
    ctx.lineWidth = Math.max(1, 1.4 * rimC.scale * 6);
    const strands = 14;
    for (let i = 0; i < strands; i++) {
      const ang = (i / strands) * Math.PI * 2;
      const startX = h.x + Math.cos(ang) * 0.30;
      const startZ = h.z + Math.sin(ang) * 0.30 * 0.4;
      const start = fpProject(startX, h.y, startZ);
      // Bottom of net flares slightly outward when flopping.
      const flareX = h.x + Math.cos(ang) * (0.10 + flop * 0.15);
      const flareZ = h.z + Math.sin(ang) * 0.10;
      const end = fpProject(flareX, netBotY, flareZ);
      ctx.beginPath();
      ctx.moveTo(start.sx, start.sy);
      ctx.lineTo(end.sx, end.sy);
      ctx.stroke();
    }
    // Horizontal net rings for cross-stitch detail.
    ctx.lineWidth = Math.max(0.6, 0.8 * rimC.scale * 6);
    for (const fy of [0.15, 0.30]) {
      ctx.beginPath();
      const rxFactor = 1 - fy / 0.45 * (0.6 - flop * 0.5);
      ctx.ellipse(rimC.sx, rimC.sy + fy * (rimRY * 4),
                  rimRX * rxFactor, rimRY * rxFactor, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // HUD
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.fillText(`${g.shotType}  •  ${Math.round(h.z * 1.094)} yd`, 16, 26);
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(`Made: ${g.made}/${g.taken}    Score: ${g.score}`, 16, 50);
    ctx.fillText(`Shots left: ${Math.max(0, g.attempts - g.taken)}`, 16, 72);
    if (g.swishes > 0) {
      ctx.fillStyle = "#ffe680";
      ctx.fillText(`Swishes: ${g.swishes}`, 16, 94);
    }

    // Aim preview
    const restSX = W / 2, restSY = H * 0.84;
    const restR = Math.min(56, Math.max(38, W * 0.075));
    if (!g.ball.released) fpDrawAimArc(g, restSX, restSY, "rgba(255, 122, 44, 0.85)");

    // Basketball
    const b = g.ball;
    let bx, by, r;
    if (!b.released) { bx = restSX; by = restSY; r = restR; }
    else {
      const proj = fpProject(b.x, b.y, b.z);
      bx = proj.sx; by = proj.sy; r = Math.max(5, 18 * proj.scale);
    }
    // Append to trail and draw it before the ball so the ball reads on top.
    if (b.released) {
      b.trail = b.trail || [];
      b.trail.push({ x: bx, y: by, r });
      if (b.trail.length > 14) b.trail.shift();
      for (let i = 0; i < b.trail.length - 1; i++) {
        const t = b.trail[i];
        const a = (i + 1) / b.trail.length;
        ctx.fillStyle = `rgba(255, 159, 85, ${a * 0.45})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r * (0.5 + 0.5 * a), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(b.released ? b.t * 8 : 0);
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, "#ff9f55"); grad.addColorStop(1, "#a3501c");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    if (r > 8) {
      ctx.strokeStyle = "#1a0a00";
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
      ctx.beginPath(); ctx.arc(-r * 0.65, 0, r * 0.95, -1.0, 1.0); ctx.stroke();
      ctx.beginPath(); ctx.arc( r * 0.65, 0, r * 0.95, Math.PI - 1.0, Math.PI + 1.0); ctx.stroke();
    }
    ctx.restore();

    if (g.message && g.messageTimer > 0) {
      ctx.font = "bold 48px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(g.message, W/2 + 3, H/2 + 3);
      ctx.fillStyle = g.message.includes("SWISH") ? "#ffe680"
                    : g.message.includes("MAKE")  ? "#4ddc8c"
                    : "#ff5470";
      ctx.fillText(g.message, W/2, H/2);
      ctx.textAlign = "start";
    }
    if (!b.released && !g.dragStart) {
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.font = "bold 14px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Flick UP at the rim — arc it in", W/2, H * 0.95);
      ctx.textAlign = "start";
    }
  },
};

//----------------------------------------------------------
// QB CHALLENGE (first-person flick — football at bullseyes)
//----------------------------------------------------------
const QBChallenge = {
  name: "QB Challenge",
  desc: "Flick footballs at bullseye targets at random spots. Some move. Hit the gold for max points.",
  icon: "🎯",
  color: "#6ee7ff",
  init() {
    return {
      ball: null, target: null,
      attempts: 8, taken: 0, hits: 0, score: 0,
      message: "", messageTimer: 0, finished: false,
      dragStart: null, dragNow: null, cameraZ: 0,
    };
  },
  payout(g) { return Math.floor((g.score || 0) * 1.0); },
  reset(g) {
    const a = g.taken || 0;
    // Distance, lateral spread, height — and chance of moving — all ramp.
    g.target = {
      z:        12 + Math.random() * (8 + a * 1.5),    // 12 → 20+
      x:        (Math.random() - 0.5) * (4 + a * 0.6),  // ±2 → ±5
      y:        1.6 + Math.random() * 1.8,
      ringSize: 1.2,
      moving:   a >= 2 && Math.random() < (0.25 + a * 0.10),
      moveSpeed: 0.6 + Math.random() * 1.4,
      movePhase: Math.random() * Math.PI * 2,
      moveAmp:  1.0 + Math.random() * 1.6,
    };
    g.ball = { x: 0, y: 0.5, z: 2, vx: 0, vy: 0, vz: 0,
               thrown: false, scored: false, gone: false, t: 0 };
    g.message = ""; g.messageTimer = 0;
    g.cameraZ = 0;
  },
  handlePointer(g, kind, x, y) {
    if (g.finished) return;
    if (!g.ball) QBChallenge.reset(g);
    if (g.ball.thrown) return;
    const flick = fpProcessFlick(g, kind, x, y);
    if (!flick) return;
    const { power, lateral, upward } = flick;
    const distScale = Math.max(0.8, g.target.z / 16);
    g.ball.vz = (12 + power * 14) * distScale * (0.65 + 0.35 * upward);
    g.ball.vy = 4 + power * 8 * upward;
    g.ball.vx = lateral * 8 * power;
    g.ball.thrown = true;
    Sound.boostHit && Sound.boostHit();
  },
  update(g, dt) {
    if (!g.ball) QBChallenge.reset(g);
    const b = g.ball, t = g.target;
    if (t.moving) t.movePhase += t.moveSpeed * dt;
    if (b.thrown && !b.gone) {
      b.t += dt;
      b.vy -= 9.8 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      g.cameraZ = g.cameraZ + (Math.max(0, b.z - 4) - g.cameraZ) * Math.min(1, dt * 4);
      if (b.z >= t.z && !b.scored) {
        const tx = t.x + (t.moving ? Math.sin(t.movePhase) * t.moveAmp : 0);
        const dx = b.x - tx;
        const dy = b.y - t.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < t.ringSize) {
          b.scored = true;
          let points, label;
          if (dist < 0.30)      { points = 50; label = "BULLSEYE!"; }
          else if (dist < 0.65) { points = 25; label = "Hit!"; }
          else                  { points = 10; label = "Edge!"; }
          g.score += points; g.hits++;
          g.message = `${label} +${points}`;
          g.messageTimer = 1.4;
          Sound.perfect && Sound.perfect();
        } else {
          b.gone = true;
          g.message = "Wide!"; g.messageTimer = 1.0;
          Sound.crash && Sound.crash();
        }
      }
      if (b.y < 0 || b.z > t.z + 4 || Math.abs(b.x) > 16) {
        b.gone = true;
        if (!b.scored && !g.message) { g.message = "Short!"; g.messageTimer = 1.0; }
      }
    }
    if ((b.gone || b.scored) && !g.finished) {
      g.messageTimer -= dt;
      if (g.messageTimer <= 0) {
        g.taken++;
        if (g.taken >= g.attempts) g.finished = true;
        else QBChallenge.reset(g);
      }
    }
  },
  render(g) {
    if (!g.ball) QBChallenge.reset(g);
    fpSetCam(g.cameraZ || 0);
    fpDrawSky("#7fbcff", "#cfeaff", "#4d8d2a");
    fpDrawField("#3a7a1f", "rgba(255,255,255,0.30)");

    // Target — concentric rings on a stand.
    const t = g.target;
    const tx = t.x + (t.moving ? Math.sin(t.movePhase) * t.moveAmp : 0);
    const center = fpProject(tx, t.y, t.z);
    const edge   = fpProject(tx + t.ringSize, t.y, t.z);
    const radius = Math.max(8, Math.abs(edge.sx - center.sx));
    // Pole from ground to bottom of target
    const pole = fpProject(tx, 0, t.z + 0.05);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = Math.max(2, 3 * center.scale * 6);
    ctx.beginPath();
    ctx.moveTo(pole.sx, pole.sy);
    ctx.lineTo(center.sx, center.sy + radius);
    ctx.stroke();
    // Rings outer → inner
    const colors = ["#1a3a82", "#fff", "#ff5a3a", "#ffd03a"];
    for (let i = 0; i < colors.length; i++) {
      const r = radius * (1 - i * 0.25);
      ctx.fillStyle = colors[i];
      ctx.beginPath(); ctx.arc(center.sx, center.sy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const r = radius * (1 - i * 0.25);
      ctx.beginPath(); ctx.arc(center.sx, center.sy, r, 0, Math.PI * 2); ctx.stroke();
    }
    // Center bullseye dot
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.arc(center.sx, center.sy, Math.max(2, radius * 0.05), 0, Math.PI * 2); ctx.fill();

    if (t.moving && !g.ball.thrown) {
      ctx.fillStyle = "rgba(255, 100, 60, 0.95)";
      ctx.font = "bold 13px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("◀ MOVING ▶", center.sx, center.sy - radius - 10);
      ctx.textAlign = "start";
    }

    // HUD
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.fillText(`Distance: ${Math.round(t.z * 1.094)} yd`, 16, 26);
    ctx.fillText(t.moving ? "MOVING TARGET" : "STATIC TARGET", 16, 48);
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(`Hits: ${g.hits}/${g.taken}    Score: ${g.score}`, 16, 74);
    ctx.fillText(`Throws left: ${Math.max(0, g.attempts - g.taken)}`, 16, 96);

    // Aim preview
    const restSX = W / 2, restSY = H * 0.84;
    const restR  = Math.min(70, Math.max(46, W * 0.095));
    if (!g.ball.thrown) fpDrawAimArc(g, restSX, restSY, "rgba(110, 231, 255, 0.85)");

    // Football — spirals along the travel direction once thrown.
    // Track previous screen position so we can orient the long axis along
    // the apparent velocity. Render a fading motion streak behind the ball.
    const b = g.ball;
    let bx, by, r, vertical;
    if (!b.thrown) { bx = restSX; by = restSY; r = restR; vertical = true; }
    else {
      const proj = fpProject(b.x, b.y, b.z);
      bx = proj.sx; by = proj.sy; r = Math.max(6, 22 * proj.scale);
      vertical = false;
    }
    if (b.thrown) {
      b.trail = b.trail || [];
      b.trail.push({ x: bx, y: by, r });
      if (b.trail.length > 12) b.trail.shift();
      for (let i = 0; i < b.trail.length - 1; i++) {
        const tp = b.trail[i];
        const a = (i + 1) / b.trail.length;
        ctx.fillStyle = `rgba(155, 90, 44, ${a * 0.40})`;
        ctx.beginPath();
        ctx.ellipse(tp.x, tp.y, tp.r * (0.5 + 0.5 * a), tp.r * 0.4 * (0.5 + 0.5 * a),
                    0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Compute travel angle in screen space (long axis aligned with motion).
    let travelAngle = 0;
    if (b.thrown && b.trail && b.trail.length >= 2) {
      const last = b.trail[b.trail.length - 1];
      const prev = b.trail[Math.max(0, b.trail.length - 4)];
      travelAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
    }
    ctx.save();
    ctx.translate(bx, by);
    if (b.thrown) {
      // Long axis points along the throw line. The "spiral" is faked by
      // sweeping the lacing visibility sinusoidally — gives the illusion
      // of the ball rotating about its long axis.
      ctx.rotate(travelAngle);
    }
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, "#9b5a2c"); grad.addColorStop(1, "#5a2a0e");
    ctx.fillStyle = grad;
    const rx = vertical ? r * 0.6  : r;
    const ry = vertical ? r * 0.95 : r * 0.62;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    if (r > 6) {
      if (vertical) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1.5, r * 0.06);
        ctx.beginPath(); ctx.moveTo(0, -ry * 0.6); ctx.lineTo(0, ry * 0.6); ctx.stroke();
        const lace = Math.max(2, r * 0.10);
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(-lace, i * ry * 0.18); ctx.lineTo(lace, i * ry * 0.18); ctx.stroke();
        }
      } else {
        // Spiral lacing: a single chord rotating around the long axis. We
        // render it as a slim ellipse offset by sin(spinPhase) so it
        // appears to wrap around the ball.
        const spinPhase = b.t * 22;       // fast spiral rate
        const offset = Math.sin(spinPhase) * ry * 0.55;
        const stripeAlpha = 0.85;
        ctx.fillStyle = `rgba(255, 255, 255, ${stripeAlpha})`;
        ctx.beginPath();
        ctx.ellipse(0, offset, r * 0.35, r * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
        // Cross-stitches on the same chord
        ctx.strokeStyle = `rgba(255, 255, 255, ${stripeAlpha})`;
        ctx.lineWidth = Math.max(1, r * 0.06);
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * r * 0.12, offset - r * 0.10);
          ctx.lineTo(i * r * 0.12, offset + r * 0.10);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    if (g.message && g.messageTimer > 0) {
      ctx.font = "bold 48px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(g.message, W/2 + 3, H/2 + 3);
      ctx.fillStyle = g.message.includes("BULLSEYE") ? "#ffe680"
                    : g.message.includes("Hit")      ? "#4ddc8c"
                    : g.message.includes("Edge")     ? "#ffb020"
                    : "#ff5470";
      ctx.fillText(g.message, W/2, H/2);
      ctx.textAlign = "start";
    }
    if (!b.thrown && !g.dragStart) {
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.font = "bold 14px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("Flick UP at the target — gold center for max points", W/2, H * 0.95);
      ctx.textAlign = "start";
    }
  },
};

const MINIGAMES = {
  field_goal: FieldGoal,
  can_bash: CanBash,
  duck_hunt: DuckHunt,
  hoops: Hoops,
  qb_challenge: QBChallenge,
};

function drawMinigameFinishedOverlay(g) {
  ctx.fillStyle = "rgba(0,0,0,0.70)";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ffb020";
  ctx.font = "bold 36px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("Game Over", W/2, H * 0.32);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 24px ui-monospace, monospace";
  ctx.fillText(`Score: ${g.score || 0}`, W/2, H * 0.40);
  const mg = MINIGAMES[g.id];
  const cash = mg && mg.payout ? mg.payout(g) : Math.floor((g.score||0) / 2);
  const best = (save.minigameBest && save.minigameBest[g.id]) || 0;
  if ((g.score || 0) > best) {
    ctx.fillStyle = "#ffe680";
    ctx.fillText(`NEW BEST!`, W/2, H * 0.475);
  } else {
    ctx.fillStyle = "#cfd6e3";
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(`Best: ${best}`, W/2, H * 0.475);
  }
  ctx.fillStyle = "#4ddc8c";
  ctx.font = "bold 24px ui-monospace, monospace";
  ctx.fillText(`+$${cash}`, W/2, H * 0.54);
  // Buttons (regions stored on the game G.state for click detection).
  const bw = Math.min(220, W * 0.35);
  const bh = 60;
  const gap = 20;
  const cy = H * 0.66;
  g._btnPlayAgain = { x: W/2 - bw - gap/2, y: cy, w: bw, h: bh };
  g._btnMenu      = { x: W/2 + gap/2,      y: cy, w: bw, h: bh };
  for (const [btn, label, fill] of [
    [g._btnPlayAgain, "Play Again ▶", "#ffb020"],
    [g._btnMenu,      "Menu",          "#2a3350"],
  ]) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 12);
    else ctx.rect(btn.x, btn.y, btn.w, btn.h);
    ctx.fill();
    ctx.fillStyle = label === "Menu" ? "#fff" : "#1a1206";
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 6);
  }
  ctx.textAlign = "start";
}

// Field Goal result overlay. Shows level title, animated star reveal,
// makes/attempts/score line, cash earned, and Next/Retry/Levels buttons.
// Layout mirrors the Can Bash overlay.
function drawFieldGoalFinishedOverlay(g) {
  ctx.fillStyle = "rgba(0,0,0,0.78)";
  ctx.fillRect(0, 0, W, H);
  const cleared = g.stars > 0;
  ctx.textAlign = "center";
  ctx.fillStyle = cleared ? "#ffd03a" : "#ff8a3a";
  ctx.font = "bold 34px ui-monospace, monospace";
  ctx.fillText(cleared ? "Round Done!" : "Out of Kicks", W / 2, H * 0.20);
  ctx.fillStyle = "#cfd6e3";
  ctx.font = "bold 18px ui-monospace, monospace";
  ctx.fillText(`${g.level.name}`, W / 2, H * 0.25);
  // Stars — three slots, gold or hollow, popped in left-to-right.
  const heldFor = Math.max(0, performance.now() - (g.finishHoldUntil - 600));
  const starSize = Math.min(56, W * 0.085);
  const starGap = starSize * 1.7;
  const starY = H * 0.38;
  for (let i = 0; i < 3; i++) {
    const cx = W / 2 + (i - 1) * starGap;
    const earned = i < g.stars;
    const revealAt = 250 + i * 220;
    const reveal = Math.max(0, Math.min(1, (heldFor - revealAt) / 220));
    const pop = earned ? (1 + Math.sin(reveal * Math.PI) * 0.25) : 1;
    ctx.save();
    ctx.translate(cx, starY);
    ctx.scale(pop, pop);
    ctx.fillStyle = earned ? "#ffd03a" : "rgba(255,255,255,0.18)";
    ctx.strokeStyle = earned ? "#ffae20" : "rgba(255,255,255,0.25)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let s = 0; s < 10; s++) {
      const a = (s / 10) * Math.PI * 2 - Math.PI / 2;
      const r = (s % 2 === 0) ? starSize : starSize * 0.45;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // Stats line + cash earned.
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px ui-monospace, monospace";
  ctx.fillText(
    `${g.made} / ${g.attempts} made  •  ${g.score} pts`,
    W / 2, H * 0.53
  );
  if (g.cashEarned) {
    ctx.fillStyle = "#4ddc8c";
    ctx.font = "bold 22px ui-monospace, monospace";
    ctx.fillText(`+$${g.cashEarned}`, W / 2, H * 0.59);
  }
  // Buttons. Layout drops Next when there's no next level.
  const idx = FG_LEVELS.findIndex(l => l.id === g.level.id);
  const hasNext = cleared && idx >= 0 && idx + 1 < FG_LEVELS.length;
  const labels = hasNext
    ? [["next", "Next Level ▶", "#4ddc8c"], ["retry", "Retry", "#ffb020"], ["levels", "Levels", "#2a3350"]]
    : [["retry", "Retry", "#ffb020"], ["levels", "Levels", "#2a3350"]];
  const bw = Math.min(220, W * 0.32);
  const bh = 60;
  const gap = 16;
  const totalW = labels.length * bw + (labels.length - 1) * gap;
  const startX = W / 2 - totalW / 2;
  const cy = H * 0.70;
  labels.forEach(([key, label, fill], i) => {
    const x = startX + i * (bw + gap);
    const rect = { x, y: cy, w: bw, h: bh };
    if (key === "next")   g._btnNextLevel = rect;
    if (key === "retry")  g._btnRetry     = rect;
    if (key === "levels") g._btnLevels    = rect;
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 12);
    else ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.fill();
    ctx.fillStyle = (fill === "#2a3350") ? "#fff" : "#1a1206";
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 6);
  });
  if (!hasNext) g._btnNextLevel = null;
  ctx.textAlign = "start";
}

// Can Bash result overlay. Shows the level title, animated stars, the
// score, and three buttons: Next Level (or Levels if locked / last),
// Retry, Levels.
function drawCanBashFinishedOverlay(g) {
  ctx.fillStyle = "rgba(0,0,0,0.78)";
  ctx.fillRect(0, 0, W, H);
  // Title — cleared vs. failed framing.
  const cleared = !!g.cleared;
  ctx.textAlign = "center";
  ctx.fillStyle = cleared ? "#ffd03a" : "#ff8a3a";
  ctx.font = "bold 34px ui-monospace, monospace";
  ctx.fillText(cleared ? "Level Clear!" : "Out of Balls", W / 2, H * 0.22);
  ctx.fillStyle = "#cfd6e3";
  ctx.font = "bold 18px ui-monospace, monospace";
  ctx.fillText(`${g.level.name}`, W / 2, H * 0.27);
  // Stars — three slots, gold or hollow. Tiny pop animation as they reveal.
  const heldFor = Math.max(0, performance.now() - (g.finishHoldUntil - 600));
  const starSize = Math.min(56, W * 0.085);
  const starGap = starSize * 1.7;
  const starY = H * 0.40;
  for (let i = 0; i < 3; i++) {
    const cx = W / 2 + (i - 1) * starGap;
    const earned = i < g.stars;
    const revealAt = 250 + i * 220;
    const reveal = Math.max(0, Math.min(1, (heldFor - revealAt) / 220));
    const pop = earned ? (1 + Math.sin(reveal * Math.PI) * 0.25) : 1;
    ctx.save();
    ctx.translate(cx, starY);
    ctx.scale(pop, pop);
    ctx.fillStyle = earned ? "#ffd03a" : "rgba(255,255,255,0.18)";
    ctx.strokeStyle = earned ? "#ffae20" : "rgba(255,255,255,0.25)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let s = 0; s < 10; s++) {
      const a = (s / 10) * Math.PI * 2 - Math.PI / 2;
      const r = (s % 2 === 0) ? starSize : starSize * 0.45;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // Stats line
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px ui-monospace, monospace";
  ctx.fillText(
    `${g.knocked} / ${g.cans.length} cans  •  ${g.thrown} ball${g.thrown === 1 ? "" : "s"} used  •  ${g.score} pts`,
    W / 2, H * 0.55
  );
  // Buttons. Layout adjusts when there's no next level.
  const idx = CAN_LEVELS.findIndex(l => l.id === g.level.id);
  const hasNext = cleared && idx >= 0 && idx + 1 < CAN_LEVELS.length;
  const labels = hasNext
    ? [["next", "Next Level ▶", "#4ddc8c"], ["retry", "Retry", "#ffb020"], ["levels", "Levels", "#2a3350"]]
    : [["retry", "Retry", "#ffb020"], ["levels", "Levels", "#2a3350"]];
  const bw = Math.min(220, W * 0.32);
  const bh = 60;
  const gap = 16;
  const totalW = labels.length * bw + (labels.length - 1) * gap;
  const startX = W / 2 - totalW / 2;
  const cy = H * 0.70;
  labels.forEach(([key, label, fill], i) => {
    const x = startX + i * (bw + gap);
    const rect = { x, y: cy, w: bw, h: bh };
    if (key === "next")   g._btnNextLevel = rect;
    if (key === "retry")  g._btnRetry     = rect;
    if (key === "levels") g._btnLevels    = rect;
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 12);
    else ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.fill();
    ctx.fillStyle = (fill === "#2a3350") ? "#fff" : "#1a1206";
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 6);
  });
  // Clear stale slots so click routing doesn't fire on a hidden button.
  if (!hasNext) g._btnNextLevel = null;
  ctx.textAlign = "start";
}

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
    if (G.state === STATE.PLAY) { G.state = STATE.PAUSE; showOnly("pause"); Sound.stopEngine(); }
    else if (G.state === STATE.PAUSE) { G.state = STATE.PLAY; showOnly("hud"); Sound.startEngine(); }
    else if (G.state === STATE.MINIGAME) {
      // Forfeit current mini-game. Level-driven games return to their own
      // level select; the others return to the mini-game hub.
      const rtId = G.minigameRuntime && G.minigameRuntime.id;
      G.minigameRuntime = null;
      if (rtId === "can_bash") { G.state = STATE.CB_LEVELS; openCanBashLevels(); }
      else if (rtId === "field_goal") { G.state = STATE.FG_LEVELS; openFieldGoalLevels(); }
      else { G.state = STATE.QUESTS; buildQuests(); showOnly("quests"); }
    }
    else if (G.state === STATE.CB_LEVELS || G.state === STATE.FG_LEVELS) {
      G.state = STATE.QUESTS; buildQuests(); showOnly("quests");
    }
    else if (G.state === STATE.LEVELS || G.state === STATE.GARAGE || G.state === STATE.QUESTS || G.state === STATE.HOW || G.state === STATE.RESULT) {
      G.runtime = null; G.state = STATE.MENU; showOnly("menu"); Sound.stopEngine();
    }
  }
  if (justPressed.has("KeyM")) {
    justPressed.delete("KeyM");
    const m = Sound.toggleMute();
    pushToast(m ? "Muted" : "Sound on", m ? "red" : "green", 700);
  }
  if (justPressed.has("KeyR") && G.state === STATE.PLAY && G.runtime) {
    justPressed.delete("KeyR");
    startRun(G.runtime.level.id);
  }

  // Mini-game tick + render path takes over the canvas while active.
  if (G.state === STATE.MINIGAME && G.minigameRuntime) {
    const mg = MINIGAMES[G.minigameRuntime.id];
    if (mg) {
      mg.update(G.minigameRuntime, dt);
      mg.render(G.minigameRuntime);
      if (G.minigameRuntime.finished) {
        if (!G.minigameRuntime.finishHoldUntil) {
          G.minigameRuntime.finishHoldUntil = performance.now() + 600;
        }
        if (G.minigameRuntime.id === "can_bash") {
          drawCanBashFinishedOverlay(G.minigameRuntime);
        } else if (G.minigameRuntime.id === "field_goal") {
          drawFieldGoalFinishedOverlay(G.minigameRuntime);
        } else {
          drawMinigameFinishedOverlay(G.minigameRuntime);
        }
      }
    }
    requestAnimationFrame(loop);
    justPressed.clear();
    return;
  }

  if (G.state === STATE.PLAY && G.runtime) {
    // Countdown freeze: tick it down, beep on each whole-second boundary,
    // hold the bike steady at the start.
    if (G.runtime.countdown > 0) {
      G.runtime.countdown -= dt;
      const sec = Math.max(0, Math.ceil(G.runtime.countdown));
      if (sec < G.runtime.countdownLastTick) {
        G.runtime.countdownLastTick = sec;
        if (sec === 0) {
          pushToast("GO!", "gold", 700);
          Sound.boostHit && Sound.boostHit();
        } else {
          Sound.click && Sound.click();
        }
      }
      // Decay particles + tire-trail while frozen so they don't pile up.
      // (No physics update; bike sits still until GO.)
      Sound.setEngine(0, false, false);
    } else {
      G.runtime.time += dt;
      updateBike(dt);
      // engine sound modulated by speed/throttle/boost
      const inp = input();
      const speed01 = clamp(Math.abs(G.runtime.bike.vx) / TOP_SPEED_PX(G.runtime.stats.topSpeed), 0, 1);
      Sound.setEngine(speed01, inp.throttle, inp.boost && G.runtime.bike.boost > 1);
    }

    // dust kick from rear wheel when grounded and moving
    const b = G.runtime.bike;
    if (b.onGround && Math.abs(b.vx) > 80 && Math.random() < 0.5) {
      const groundY = terrainHeightAt(G.runtime.terrain, b.x);
      G.runtime.particles.push({
        x: b.x - 18 + Math.random() * 6,
        y: groundY,
        vx: -b.vx * 0.15 - Math.random() * 30,
        vy: -30 - Math.random() * 40,
        life: 0.5, maxLife: 0.5,
        color: "rgba(180, 150, 100, 0.55)",
        size: 3 + Math.random() * 3,
      });
    }

    // shake decay
    if (G.runtime.shake) G.runtime.shake.mag = Math.max(0, G.runtime.shake.mag - dt * 28);

    // Powerup timer (star / magnet — shield is persistent).
    if (G.runtime.powerup && G.runtime.powerup.time > 0) {
      G.runtime.powerup.time = Math.max(0, G.runtime.powerup.time - dt);
      if (G.runtime.powerup.time === 0) {
        pushToast(`${G.runtime.powerup.type[0].toUpperCase() + G.runtime.powerup.type.slice(1)} ended`, "red", 700);
        G.runtime.powerup = null;
      }
    }

    // particles update
    for (let i = G.runtime.particles.length - 1; i >= 0; i--) {
      const p = G.runtime.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
      if (p.life <= 0) G.runtime.particles.splice(i, 1);
    }
    for (let i = G.runtime.floatingTexts.length - 1; i >= 0; i--) {
      const f = G.runtime.floatingTexts[i];
      f.life -= dt;
      f.y += f.vy * dt;
      if (f.life <= 0) G.runtime.floatingTexts.splice(i, 1);
    }
    // tire trail decay
    if (G.runtime.bike.tireTrail) {
      for (let i = G.runtime.bike.tireTrail.length - 1; i >= 0; i--) {
        G.runtime.bike.tireTrail[i].life -= dt;
        if (G.runtime.bike.tireTrail[i].life <= 0) G.runtime.bike.tireTrail.splice(i, 1);
      }
    }
  }

  render();
  justPressed.clear();
  requestAnimationFrame(loop);
}

// Auto-pause when tab hidden / phone screen locks.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && G.state === STATE.PLAY) {
    G.state = STATE.PAUSE;
    showOnly("pause");
    Sound.stopEngine();
  }
});
window.addEventListener("blur", () => {
  if (G.state === STATE.PLAY) {
    G.state = STATE.PAUSE;
    showOnly("pause");
    Sound.stopEngine();
  }
});

// Boot
window.__diag && window.__diag("[boot] entering boot block");
showOnly("menu");
setupTouchControls();
refreshQuestStates();
requestAnimationFrame(loop);
window.__diag && window.__diag("[boot] init complete ✓");
// Auto-dismiss the diagnostic banner after a short delay so it doesn't
// clutter the menu once everything is healthy. Tap the banner to keep it.
setTimeout(function () {
  var d = document.getElementById("__diag");
  if (d && !d.dataset.pin) d.parentNode && d.parentNode.removeChild(d);
}, 4000);
document.addEventListener("click", function (e) {
  var d = document.getElementById("__diag");
  if (d && d.contains(e.target)) d.dataset.pin = "1";
});

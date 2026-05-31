// QB Challenge — quarterback minigame.
//
// 8 plays per round. Each play:
//   1. Pre-snap (0.6s) — receivers line up, ghost route arrows preview
//      the play, the snap-cue blinks.
//   2. Live — receivers run their routes, pocket pressure ring shrinks.
//      The player flicks the football to lead a receiver.
//   3. Outcome — completion / incomplete / sack / interception display
//      for 1.4s, then advance to the next play.
//
// Throw types come from the flick power band: bullet (low arc, fast),
// touch (medium), lob (high arc, slow). The player must lead receivers
// based on the travel time of the throw.
//
// Reuses src/engine/fpView.js for the perspective projection + flick
// parsing, and src/engine/audio.js for snap / whistle / cheer / groan.

import { ctx, W, H, ease } from "../../engine/canvas.js";
import { Sound } from "../../engine/audio.js";
import { save } from "../../engine/save.js";
import {
  fpSetCam, fpHorizonY, fpProject, fpProcessFlick, fpDrawAimArc,
} from "../../engine/fpView.js";
import { routeSample, routePath, pickFormation, LOS_Z } from "./routes.js";

const ATTEMPTS_PER_ROUND = 8;
const PRESNAP_T = 0.6;        // pre-snap freeze before snap auto-fires
const POCKET_T_MAX = 3.5;     // pocket pressure timer at attempt 1
const POCKET_T_MIN = 2.2;     // pocket pressure timer at attempt 8
const OUTCOME_T = 1.4;        // how long the outcome message holds
const SACK_OUTCOME_T = 1.6;

// Tighter than the field goal threshold — receivers are smaller targets
// at the catch point. Tuned by playtest.
const CATCH_R = 1.45;
const BULLSEYE_R = 0.55;

// Throw bands. power01 maps to vy_initial, vz_initial. Bullet is fast
// and flat; lob is slow and high.
function classifyThrow(power, upward) {
  if (power < 0.40) return { kind: "bullet", vyScale: 6.0, vzScale: 36 };
  if (power < 0.70) return { kind: "touch",  vyScale: 9.0, vzScale: 28 };
  return                  { kind: "lob",     vyScale: 14.0, vzScale: 22 };
}

// Sound throttles to keep the stadium audio from stacking when events
// fire in quick succession.
let _lastCheer = 0, _lastGroan = 0;
function cheerThrottled(big) {
  const now = performance.now();
  if (now - _lastCheer < 400) return;
  _lastCheer = now;
  Sound.cheer && Sound.cheer(big);
}
function groanThrottled() {
  const now = performance.now();
  if (now - _lastGroan < 400) return;
  _lastGroan = now;
  Sound.groan && Sound.groan();
}

export const QBChallenge = {
  name: "QB Challenge",
  desc: "Read the routes. Lead the receiver. Beat the pocket clock.",
  icon: "🏈",
  color: "#6ee7ff",

  init() {
    return {
      // Round state
      attempts: ATTEMPTS_PER_ROUND, taken: 0,
      completions: 0, sacks: 0,
      score: 0, longestGain: 0, streak: 0, bestStreak: 0,
      combo: 1, bestCombo: 1,
      finished: false,
      // Per-play state — populated by reset()
      phase: "presnap", phaseT: 0,
      receivers: [], defenders: [],
      ball: null,
      pocket: { t: 0, max: POCKET_T_MAX, broken: false },
      // Hype window (brief multiplier on crowd-dot brightness after a
      // big play). t counts down; intensity is the visual punch.
      hype: { t: 0, intensity: 1 },
      // Outcome message — `message` is the headline; `messageSub` is
      // the +yards/+points breakdown rendered smaller underneath.
      message: "", messageSub: "", messageColor: "#fff", outcomeT: 0,
      lastGainYd: 0,
      // Input drag state — shared with fpProcessFlick
      dragStart: null, dragNow: null,
      // Camera tracks the ball as it flies downfield
      cameraZ: 0,
    };
  },

  reset(g) {
    const a = g.taken | 0;
    // Pocket clock tightens with each play.
    const pocketSpan = POCKET_T_MAX - POCKET_T_MIN;
    const pocketMax = POCKET_T_MAX - pocketSpan * (a / Math.max(1, ATTEMPTS_PER_ROUND - 1));
    g.pocket = { t: 0, max: pocketMax, broken: false };
    g.receivers = pickFormation(a).map((spec, i) => ({
      id: i,
      route: spec.route,
      x0: spec.x0,
      jersey: spec.jersey,
      t: 0,
      x: spec.x0, y: 1.6, z: LOS_Z,
      vx: 0, vz: 0,
      caught: false,
    }));
    // Defenders converge on the QB. Two from attempt 3 onward; one
    // before that to keep early plays gentle. Start x is kept inside
    // ±3.5 so they project on-screen from the snap (camera at z=0,
    // LOS at z=LOS_Z = 10).
    g.defenders = [];
    const defCount = a < 2 ? 1 : 2;
    for (let i = 0; i < defCount; i++) {
      const side = i === 0 ? -1 : 1;
      g.defenders.push({
        side,
        startX: side * 3.5, startZ: LOS_Z + 2,
        x: side * 3.5, z: LOS_Z + 2,
        progress: 0,
      });
    }
    g.ball = {
      x: 0, y: 0.9, z: LOS_Z - 1.5,
      vx: 0, vy: 0, vz: 0,
      thrown: false, scored: false, gone: false,
      t: 0, kind: null,
      trail: [],
    };
    g.phase = "presnap";
    g.phaseT = 0;
    g.message = "";
    g.messageSub = "";
    g.outcomeT = 0;
    // lastGainYd intentionally NOT reset — the scoreboard's LAST cell
    // shows the previous play's gain until a new outcome resolves.
    g.cameraZ = 0;
  },

  handlePointer(g, kind, x, y) {
    if (g.finished) return;
    if (!g.ball) QBChallenge.reset(g);
    // Tap-to-snap: any pointer-down during pre-snap fires the snap
    // early. fpProcessFlick still captures drag state for the throw.
    if (g.phase === "presnap" && kind === "down") {
      snap(g);
    }
    if (g.phase !== "live") {
      // We still let fpProcessFlick capture drag state so the player
      // can wind up during pre-snap and release after snap.
      fpProcessFlick(g, kind, x, y);
      return;
    }
    if (g.ball.thrown) {
      // Discard further drag input during ball flight.
      fpProcessFlick(g, kind, x, y);
      return;
    }
    const flick = fpProcessFlick(g, kind, x, y);
    if (!flick) return;
    throwBall(g, flick);
  },

  update(g, dt) {
    if (!g.ball) QBChallenge.reset(g);
    if (g.finished) return;

    if (g.hype.t > 0) g.hype.t -= dt;

    if (g.phase === "presnap") {
      g.phaseT += dt;
      if (g.phaseT >= PRESNAP_T) snap(g);
      return;
    }

    if (g.phase === "live") {
      // Advance receivers
      for (const r of g.receivers) {
        if (r.caught) continue;
        r.t += dt;
        const p = routeSample(r.route, r.x0, r.t);
        r.x = p.x; r.z = p.z; r.vx = p.vx; r.vz = p.vz;
      }
      // Advance defenders + pocket pressure (only while QB still holds
      // the ball — throwing freezes the pressure).
      if (!g.ball.thrown) {
        g.pocket.t += dt;
        const f = Math.min(1, g.pocket.t / g.pocket.max);
        for (const d of g.defenders) {
          d.progress = f;
          // Lerp from startX/startZ to a tight collapse point just
          // outside the QB.
          const closeX = d.side * 0.8;
          const closeZ = LOS_Z - 2;
          d.x = d.startX + (closeX - d.startX) * f;
          d.z = d.startZ + (closeZ - d.startZ) * f;
        }
        if (g.pocket.t >= g.pocket.max) { sack(g); return; }
      }
      // Ball physics
      if (g.ball.thrown && !g.ball.gone) {
        const b = g.ball;
        b.t += dt;
        b.vy -= 9.8 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        // Sample the ball trail in screen-space for the spiral trail.
        const proj = fpProject(b.x, b.y, b.z);
        b.trail.push({ sx: proj.sx, sy: proj.sy, r: Math.max(5, 18 * proj.scale) });
        if (b.trail.length > 16) b.trail.shift();
        // Camera leads the ball past the LOS so the receiver stays in
        // frame on deep throws. Capped so the end zone never collapses
        // into the foreground.
        const camTarget = Math.min(20, Math.max(0, b.z - 12));
        g.cameraZ = g.cameraZ + (camTarget - g.cameraZ) * Math.min(1, dt * 4);
        // Spiral whoosh pitch follows downfield speed.
        // (Whoosh itself fires on release; this is just a pitched followup
        // we'd add later — kept minimal to avoid audio overload.)

        // Reception test — for each receiver whose z plane the ball
        // just crossed, evaluate completion.
        for (const r of g.receivers) {
          if (r.caught) continue;
          if (b.scored) break;
          if (b.z >= r.z && b.z - b.vz * dt < r.z) {
            tryCatch(g, b, r);
          }
        }
        // Out-of-bounds / overthrown checks
        if (!b.scored && (b.y < 0 || b.z > 60 || Math.abs(b.x) > 22)) {
          b.gone = true;
          incomplete(g, b.y < 0 ? "Short!" : "Overthrown!");
        }
      }
      // After the play resolves, hold the outcome briefly.
      if (g.phase === "live" && (g.ball.gone || g.ball.scored) && g.outcomeT === 0) {
        g.outcomeT = OUTCOME_T;
        g.phase = "outcome";
      }
      return;
    }

    if (g.phase === "outcome") {
      g.outcomeT -= dt;
      // Ease the camera back to the QB origin while the outcome holds
      // so the next pre-snap snaps in with the field re-framed.
      g.cameraZ = g.cameraZ + (0 - g.cameraZ) * Math.min(1, dt * 3);
      if (g.outcomeT <= 0) advancePlay(g);
      return;
    }
  },

  render(g) {
    if (!g.ball) QBChallenge.reset(g);
    fpSetCam(g.cameraZ || 0);

    drawStadium(g);
    drawField(g);
    drawEndZone();
    drawLOSLine();

    // Defenders behind the receivers visually (further from camera);
    // draw before receivers so close defenders overlap them.
    for (const d of g.defenders) drawDefender(d);

    // Pre-snap route arrows.
    if (g.phase === "presnap") {
      for (const r of g.receivers) drawRoutePreview(r);
    }

    // Pocket ring at the QB origin (only meaningful pre-throw).
    if (g.phase === "live" && !g.ball.thrown) drawPocket(g);

    for (const r of g.receivers) drawReceiver(r);

    // Ball
    drawBall(g.ball);

    // Aim preview while dragging mid-play
    if (g.phase === "live" && !g.ball.thrown) {
      const restSX = W / 2, restSY = H * 0.84;
      fpDrawAimArc(g, restSX, restSY, "rgba(110, 231, 255, 0.85)");
    }

    drawScoreboard(g);
    drawMessage(g);
    drawPresnapCue(g);
  },

  payout(g) { return Math.floor((g.score || 0) * 1.0); },

  // Stadium-themed game-over panel — themed jumbotron + stat board +
  // Play Again / Menu buttons. Dispatched from main.js after the
  // generic 600ms finishHoldUntil window starts.
  renderFinished(g) { drawQbFinishedOverlay(g); },
};

// ──────────────────────────────────────────────────────────────────────
// Play lifecycle
// ──────────────────────────────────────────────────────────────────────

function snap(g) {
  if (g.phase !== "presnap") return;
  g.phase = "live";
  g.phaseT = 0;
  // Reset per-receiver t so their routes start at the snap, not at the
  // pre-snap clock.
  for (const r of g.receivers) r.t = 0;
  Sound.hike && Sound.hike();
}

function throwBall(g, flick) {
  const { power, upward, lateral } = flick;
  const t = classifyThrow(power, upward);
  const b = g.ball;
  b.kind = t.kind;
  // Slight upward bias even on bullets so the ball clears the LOS.
  b.vy = Math.max(2.5, t.vyScale * Math.max(0.4, upward));
  b.vz = t.vzScale * (0.55 + 0.55 * power);
  b.vx = lateral * 9 * power;
  b.thrown = true;
  Sound.spiralWhoosh && Sound.spiralWhoosh(power);
}

function tryCatch(g, b, r) {
  // Vertical alignment matters — receivers catch around chest height.
  const dx = b.x - r.x;
  const dy = b.y - (r.y + 0.4);
  const horiz = Math.hypot(dx, dy);
  if (horiz > CATCH_R) return; // ball whizzed past
  // Completion. Score by yards gained (catch z - LOS) and the quality
  // of the lead (bullseye if the ball was right on the receiver).
  b.scored = true;
  r.caught = true;
  const gainYd = Math.max(0, Math.round((r.z - LOS_Z) * 1.094));
  g.lastGainYd = gainYd;
  if (gainYd > g.longestGain) g.longestGain = gainYd;
  g.completions++;
  g.streak++;
  if (g.streak > g.bestStreak) g.bestStreak = g.streak;
  // Base points = 10 + yards. Bullseye 1.5×.
  const bullseye = horiz < BULLSEYE_R;
  let base = 10 + gainYd;
  if (bullseye) base = Math.floor(base * 1.5);
  const mult = g.combo;
  const points = base * mult;
  g.score += points;
  g.combo = Math.min(g.combo + 1, 5);
  if (g.combo > g.bestCombo) g.bestCombo = g.combo;
  const headline = bullseye ? "BULLSEYE!" : "COMPLETION";
  g.message = headline;
  g.messageSub = `+${gainYd}yd  +${points}${mult > 1 ? `  x${mult}` : ""}`;
  g.messageColor = bullseye ? "#ffd03a" : "#4ddc8c";
  // Hype window — big completion punches harder.
  const big = bullseye || gainYd >= 20;
  g.hype.t = big ? 1.2 : 0.6;
  g.hype.intensity = big ? 2.5 : 1.8;
  cheerThrottled(big);
  Sound.whistle && Sound.whistle();
}

function incomplete(g, reason) {
  g.combo = 1;
  g.streak = 0;
  g.message = reason || "Incomplete";
  g.messageSub = "";
  g.messageColor = "#ff5470";
  g.hype.t = 0.5;
  g.hype.intensity = 0.55;
  groanThrottled();
  Sound.whistle && Sound.whistle();
}

function sack(g) {
  if (g.ball.thrown) return; // can't sack a thrown ball
  g.combo = 1;
  g.streak = 0;
  g.sacks++;
  g.lastGainYd = -7;
  g.message = "SACKED!";
  g.messageSub = "-7yd";
  g.messageColor = "#ff5470";
  g.ball.gone = true;
  g.outcomeT = SACK_OUTCOME_T;
  g.phase = "outcome";
  g.hype.t = 0.8;
  g.hype.intensity = 0.4;
  groanThrottled();
}

function advancePlay(g) {
  g.taken++;
  if (g.taken >= g.attempts) {
    g.finished = true;
    // Persist lifetime stats via main.js settleMinigame() — but also
    // bump qbChallengeBest fields directly here so longestGain etc.
    // survive even if the player closes the tab before clicking.
    persistRoundStats(g);
    return;
  }
  QBChallenge.reset(g);
}

function persistRoundStats(g) {
  // Lazy import to avoid pulling save.js into the module's init chain.
  // (Live ES bindings make this cheap.)
  import("../../engine/save.js").then(({ save, persistSave }) => {
    save.qbChallengeBest = save.qbChallengeBest || {
      bestScore: 0, longestGain: 0, bestStreak: 0,
      totalCompletions: 0, totalSacks: 0, completionPct: 0,
    };
    const b = save.qbChallengeBest;
    if (g.score > b.bestScore) b.bestScore = g.score;
    if (g.longestGain > b.longestGain) b.longestGain = g.longestGain;
    if (g.bestStreak > b.bestStreak) b.bestStreak = g.bestStreak;
    const priorAttempts = (b.totalCompletions / Math.max(0.0001, b.completionPct / 100)) || 0;
    const newAttempts = priorAttempts + g.attempts;
    b.totalCompletions += g.completions;
    b.totalSacks += g.sacks;
    b.completionPct = Math.round((b.totalCompletions / newAttempts) * 1000) / 10;
    persistSave();
  }).catch(() => {});
}

// ──────────────────────────────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────────────────────────────

// Stadium backdrop cache — the sky, bowl, towers, jumbotron frame, and
// the 160-dot crowd never change between frames (only their brightness
// does), so we render them once to two offscreen canvases and blit
// them per frame. Collapses ~170 canvas ops per frame to ~2 drawImages.
// Invalidates when the viewport changes size.
let _stadiumCache = null;

function ensureStadium() {
  if (_stadiumCache && _stadiumCache.w === W && _stadiumCache.h === H) return;
  const horizon = fpHorizonY();
  const bowlTop = horizon - 70;
  const bowlMid = horizon - 28;

  // Layer 1 — sky + bowl + towers + jumbotron frame (static dim base).
  const dim = document.createElement("canvas");
  dim.width = W; dim.height = H;
  const dctx = dim.getContext("2d");

  const sky = dctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.00, "#1c1b3a");
  sky.addColorStop(0.45, "#3a2a55");
  sky.addColorStop(0.70, "#a85a3a");
  sky.addColorStop(1.00, "#0e0d1c");
  dctx.fillStyle = sky;
  dctx.fillRect(0, 0, W, H);

  // Upper bowl tier
  dctx.fillStyle = "#1a1530";
  dctx.beginPath();
  dctx.moveTo(0, bowlMid);
  dctx.quadraticCurveTo(W * 0.5, bowlTop, W, bowlMid);
  dctx.lineTo(W, horizon);
  dctx.lineTo(0, horizon);
  dctx.closePath();
  dctx.fill();
  // Lower bowl tier
  dctx.fillStyle = "#241d3e";
  dctx.beginPath();
  dctx.moveTo(0, horizon - 10);
  dctx.quadraticCurveTo(W * 0.5, bowlMid + 8, W, horizon - 10);
  dctx.lineTo(W, horizon);
  dctx.lineTo(0, horizon);
  dctx.closePath();
  dctx.fill();

  // Light towers
  dctx.fillStyle = "rgba(255, 240, 200, 0.95)";
  for (const tx of [W * 0.10, W * 0.32, W * 0.68, W * 0.90]) {
    dctx.beginPath(); dctx.arc(tx, bowlTop - 20, 5, 0, Math.PI * 2); dctx.fill();
    dctx.fillStyle = "rgba(20, 18, 35, 0.9)";
    dctx.fillRect(tx - 1, bowlTop - 18, 2, 18);
    dctx.fillStyle = "rgba(255, 240, 200, 0.95)";
  }

  // Jumbotron frame (the live score draws on top each frame, in the
  // main render path).
  const jbW = 86, jbH = 32;
  const jbX = W / 2 - jbW / 2, jbY = bowlTop - 4;
  dctx.fillStyle = "#0a0a14";
  dctx.fillRect(jbX, jbY, jbW, jbH);
  dctx.strokeStyle = "#3a3050"; dctx.lineWidth = 1;
  dctx.strokeRect(jbX, jbY, jbW, jbH);

  // Layer 2 — crowd dots at full brightness, no twinkle. Per-frame
  // brightness is applied via globalAlpha on the blit. The original
  // per-dot twinkle is replaced by a global brightness oscillation
  // (one sin call per frame instead of 160).
  const lit = document.createElement("canvas");
  lit.width = W; lit.height = H;
  const lctx = lit.getContext("2d");
  lctx.fillStyle = "rgba(255, 220, 160, 1)";
  for (let i = 0; i < 160; i++) {
    const r1 = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const r2 = (Math.sin(i * 78.233 + 1.7) * 43758.5453) % 1;
    const u = Math.abs(r1);
    const v = Math.abs(r2);
    const cx = u * W;
    const arcY = bowlTop + (1 - Math.pow(u * 2 - 1, 2)) * 8;
    const cy = arcY + v * (horizon - arcY - 4) - 2;
    if (cy >= horizon) continue;
    lctx.fillRect(cx, cy, 1.4, 1.4);
  }

  _stadiumCache = { w: W, h: H, dim, lit, jbX, jbY, jbW, jbH };
}

function drawStadium(g) {
  ensureStadium();
  // Static base: sky + bowl + towers + jumbotron frame, all in one blit.
  ctx.drawImage(_stadiumCache.dim, 0, 0);
  // Crowd: single drawImage with brightness modulated by a global
  // twinkle envelope + the hype window (eased so it ramps instead of
  // popping). One sin() per frame instead of 160.
  const tNow = performance.now() / 1000;
  const baseTwinkle = 0.55 + 0.45 * Math.sin(tNow * 2);
  let hype = 1.0;
  if (g.hype && g.hype.t > 0) {
    const hypeT = Math.min(1, g.hype.t / 1.2);
    hype = ease(hypeT, "easeOutQuad") * g.hype.intensity;
  }
  ctx.save();
  ctx.globalAlpha = Math.min(1, 0.35 * baseTwinkle * hype);
  ctx.drawImage(_stadiumCache.lit, 0, 0);
  ctx.restore();
  // Live jumbotron score sits on the cached frame.
  const c = _stadiumCache;
  ctx.fillStyle = "#ffb020";
  ctx.font = "bold 18px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(g.score), c.jbX + c.jbW / 2, c.jbY + 22);
  ctx.textAlign = "start";
}

function drawField(g) {
  const horizon = fpHorizonY();
  // Grass — slight lighting gradient from horizon down (darker at the
  // distant LOS, lighter close).
  const grass = ctx.createLinearGradient(0, horizon, 0, H);
  grass.addColorStop(0, "#173615");
  grass.addColorStop(1, "#2a5224");
  ctx.fillStyle = grass;
  ctx.fillRect(0, horizon, W, H - horizon);
  // Yard lines every 5m
  ctx.strokeStyle = "rgba(255, 255, 255, 0.40)";
  for (let z = 5; z <= 80; z += 5) {
    const left  = fpProject(-22, 0, z);
    const right = fpProject( 22, 0, z);
    ctx.lineWidth = Math.max(0.6, 2 * (600 / z / 60));
    ctx.beginPath();
    ctx.moveTo(left.sx, left.sy);
    ctx.lineTo(right.sx, right.sy);
    ctx.stroke();
  }
  // Yard numbers — only at 10m increments and only when they project
  // big enough to read.
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  for (let z = 10; z <= 60; z += 10) {
    const p = fpProject(0, 0, z);
    const sz = Math.max(8, 18 * p.scale);
    if (sz < 10) continue;
    ctx.font = `bold ${Math.round(sz)}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    const yards = Math.round(z * 1.094);
    ctx.fillText(`${yards}`, p.sx, p.sy - 2);
  }
  ctx.textAlign = "start";
  // Hash marks every 2m
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  for (let z = 2; z <= 60; z += 2) {
    const a = fpProject(-0.6, 0, z);
    const b = fpProject( 0.6, 0, z);
    ctx.lineWidth = Math.max(0.5, 1.5 * (600 / z / 60));
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
  }
  // Sideline brand stripes
  ctx.fillStyle = "rgba(255, 90, 58, 0.30)";
  for (const x of [-22, 22]) {
    const near = fpProject(x, 0, 1.5);
    const far  = fpProject(x, 0, 80);
    ctx.beginPath();
    ctx.moveTo(near.sx, near.sy);
    ctx.lineTo(far.sx,  far.sy);
    ctx.lineTo(far.sx + (x > 0 ? -1.5 : 1.5), far.sy);
    ctx.lineTo(near.sx + (x > 0 ? -6 : 6), near.sy);
    ctx.closePath();
    ctx.fill();
  }
}

function drawEndZone() {
  // End zone fill — solid color band past z=60 to suggest a TD bonus
  // area for monster lobs.
  const nearL = fpProject(-22, 0, 60);
  const nearR = fpProject( 22, 0, 60);
  const farL  = fpProject(-22, 0, 80);
  const farR  = fpProject( 22, 0, 80);
  ctx.fillStyle = "rgba(255, 90, 58, 0.35)";
  ctx.beginPath();
  ctx.moveTo(nearL.sx, nearL.sy);
  ctx.lineTo(nearR.sx, nearR.sy);
  ctx.lineTo(farR.sx,  farR.sy);
  ctx.lineTo(farL.sx,  farL.sy);
  ctx.closePath();
  ctx.fill();
}

function drawLOSLine() {
  // Blue LOS line at z = LOS_Z.
  const left  = fpProject(-22, 0, LOS_Z);
  const right = fpProject( 22, 0, LOS_Z);
  ctx.strokeStyle = "rgba(80, 180, 255, 0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left.sx, left.sy);
  ctx.lineTo(right.sx, right.sy);
  ctx.stroke();
}

function drawPocket(g) {
  // Red shrinking ring at the QB origin (just under the camera).
  const f = Math.min(1, g.pocket.t / g.pocket.max);
  const danger = f > 0.7;
  const pulse = danger ? 1 + 0.08 * Math.sin(performance.now() / 60) : 1;
  const r0 = 80, r1 = 28;
  const r = (r0 + (r1 - r0) * f) * pulse;
  const cx = W / 2;
  const cy = H * 0.88;
  ctx.save();
  ctx.strokeStyle = danger ? "rgba(255, 60, 60, 0.85)" : "rgba(255, 160, 60, 0.55)";
  ctx.lineWidth = danger ? 3 : 2;
  ctx.setLineDash(danger ? [6, 4] : []);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawDefender(d) {
  // Crouched silhouette closing on the QB. Sized by FP projection.
  const p = fpProject(d.x, 0, Math.max(LOS_Z, d.z));
  const h = Math.max(18, 110 * p.scale * (0.7 + 0.6 * d.progress));
  ctx.fillStyle = "rgba(10, 12, 20, 0.85)";
  // Body
  ctx.beginPath();
  ctx.ellipse(p.sx, p.sy - h * 0.45, h * 0.22, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  // Helmet
  ctx.beginPath();
  ctx.arc(p.sx, p.sy - h * 0.92, h * 0.14, 0, Math.PI * 2);
  ctx.fill();
  // Reach-arm bleeding toward the QB when close
  if (d.progress > 0.5) {
    ctx.strokeStyle = "rgba(255, 60, 60, " + (d.progress - 0.5) + ")";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy - h * 0.5);
    ctx.lineTo(p.sx + (-d.side) * h * 0.45, p.sy - h * 0.7);
    ctx.stroke();
  }
}

function drawReceiver(r) {
  const p = fpProject(r.x, 0, r.z);
  const baseH = Math.max(16, 95 * p.scale);
  // Stride bounce — slight Y oscillation while running.
  const bounce = Math.sin(r.t * 12) * baseH * 0.04;
  const cx = p.sx;
  const cy = p.sy - bounce;
  const torsoH = baseH * 0.45;
  const helmH = baseH * 0.18;
  const stripeColor = r.caught ? "#4ddc8c" : "#ffb020";
  // Legs (two short lines)
  ctx.strokeStyle = "#1a1206";
  ctx.lineWidth = Math.max(1.5, baseH * 0.06);
  const legSwing = Math.sin(r.t * 14) * baseH * 0.18;
  ctx.beginPath();
  ctx.moveTo(cx - baseH * 0.05, cy);
  ctx.lineTo(cx - baseH * 0.10 + legSwing, cy - baseH * 0.30);
  ctx.moveTo(cx + baseH * 0.05, cy);
  ctx.lineTo(cx + baseH * 0.10 - legSwing, cy - baseH * 0.30);
  ctx.stroke();
  // Body
  ctx.fillStyle = stripeColor;
  ctx.beginPath();
  ctx.ellipse(cx, cy - baseH * 0.50, baseH * 0.16, torsoH * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  // Jersey number
  if (baseH > 30) {
    ctx.fillStyle = "#1a1206";
    ctx.font = `bold ${Math.round(baseH * 0.18)}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.fillText(String(r.jersey), cx, cy - baseH * 0.45);
    ctx.textAlign = "start";
  }
  // Helmet
  ctx.fillStyle = "#1a1d24";
  ctx.beginPath();
  ctx.arc(cx, cy - baseH * 0.78, helmH, 0, Math.PI * 2);
  ctx.fill();
  // Arms (swing opposite of legs)
  ctx.strokeStyle = stripeColor;
  ctx.beginPath();
  ctx.moveTo(cx - baseH * 0.12, cy - baseH * 0.60);
  ctx.lineTo(cx - baseH * 0.20 - legSwing, cy - baseH * 0.45);
  ctx.moveTo(cx + baseH * 0.12, cy - baseH * 0.60);
  ctx.lineTo(cx + baseH * 0.20 + legSwing, cy - baseH * 0.45);
  ctx.stroke();
}

function drawRoutePreview(r) {
  // Dashed arrow tracing the receiver's planned route over the next
  // 1.6s. Helps the player decide who to throw to.
  const pts = routePath(r.route, r.x0, 1.6);
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = fpProject(pts[i].x, 0.2, pts[i].z);
    if (i === 0) ctx.moveTo(p.sx, p.sy);
    else ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // Arrowhead at the end
  if (pts.length >= 2) {
    const last = fpProject(pts[pts.length - 1].x, 0.2, pts[pts.length - 1].z);
    const prev = fpProject(pts[pts.length - 2].x, 0.2, pts[pts.length - 2].z);
    const ang = Math.atan2(last.sy - prev.sy, last.sx - prev.sx);
    ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
    ctx.beginPath();
    ctx.moveTo(last.sx, last.sy);
    ctx.lineTo(last.sx - Math.cos(ang - 0.4) * 10, last.sy - Math.sin(ang - 0.4) * 10);
    ctx.lineTo(last.sx - Math.cos(ang + 0.4) * 10, last.sy - Math.sin(ang + 0.4) * 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Proper-spiral football renderer. The body is a prolate spheroid
// whose long axis aligns with the apparent velocity (computed in
// screen-space from the recent trail). The laces sit on a band that
// rolls around the long axis — modeled by sweeping the band's visible
// length with the spin phase so it appears to wrap.
function drawBall(b) {
  let sx, sy, r, vertical;
  if (!b.thrown) {
    // At rest — vertical, on a tee just below center.
    sx = W / 2;
    sy = H * 0.84;
    r  = Math.min(72, Math.max(46, W * 0.095));
    vertical = true;
  } else {
    const p = fpProject(b.x, b.y, b.z);
    sx = p.sx; sy = p.sy;
    r  = Math.max(7, 22 * p.scale);
    vertical = false;
  }

  // Trail — fading prolate streaks behind the ball.
  if (b.thrown && b.trail && b.trail.length >= 2) {
    for (let i = 0; i < b.trail.length - 1; i++) {
      const tp = b.trail[i];
      const next = b.trail[i + 1];
      // easeOutCubic — front of the trail (nearest the ball) is full
      // brightness, tail fades quickly. Reads as a tight spiral wake.
      const a = ease((i + 1) / b.trail.length, "easeOutCubic");
      const ang = Math.atan2(next.sy - tp.sy, next.sx - tp.sx);
      ctx.save();
      ctx.translate(tp.sx, tp.sy);
      ctx.rotate(ang);
      ctx.fillStyle = `rgba(160, 110, 60, ${a * 0.30})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, tp.r * 0.9, tp.r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Determine long-axis screen angle from velocity (sampled via trail).
  let travelAngle = 0;
  if (b.thrown && b.trail && b.trail.length >= 3) {
    const last = b.trail[b.trail.length - 1];
    const prev = b.trail[Math.max(0, b.trail.length - 4)];
    travelAngle = Math.atan2(last.sy - prev.sy, last.sx - prev.sx);
  }
  // At apex the velocity flattens; fall back to "vertical-ish" if the
  // angle is undefined (very small trail delta).
  if (b.thrown && b.trail && b.trail.length >= 2) {
    const last = b.trail[b.trail.length - 1];
    const prev = b.trail[b.trail.length - 2];
    if (Math.hypot(last.sx - prev.sx, last.sy - prev.sy) < 0.5) {
      travelAngle = -Math.PI / 2; // pointing up
    }
  }

  ctx.save();
  ctx.translate(sx, sy);
  if (b.thrown) ctx.rotate(travelAngle);
  // Body — prolate spheroid silhouette with a top-lit gradient.
  const rx = vertical ? r * 0.60 : r;
  const ry = vertical ? r * 0.95 : r * 0.55;
  const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.30, r * 0.10, 0, 0, r * 1.05);
  grad.addColorStop(0, "#b06a32");
  grad.addColorStop(0.5, "#8a4920");
  grad.addColorStop(1, "#4a2008");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  // Subtle highlight stripe on the upper side
  ctx.fillStyle = "rgba(255, 220, 180, 0.18)";
  ctx.beginPath();
  ctx.ellipse(-rx * 0.20, -ry * 0.30, rx * 0.55, ry * 0.20, 0, 0, Math.PI * 2);
  ctx.fill();

  if (r > 6) {
    if (vertical) {
      // Standing-on-tee — front-facing laces stack.
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(1.5, r * 0.06);
      ctx.beginPath(); ctx.moveTo(0, -ry * 0.6); ctx.lineTo(0, ry * 0.6); ctx.stroke();
      const lace = Math.max(2, r * 0.10);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(-lace, i * ry * 0.18);
        ctx.lineTo( lace, i * ry * 0.18);
        ctx.stroke();
      }
    } else {
      // Axial spin: lacing band rolls around the long axis. We model
      // visibility by mapping spin phase to a 0..1 facing factor — when
      // facing toward camera the laces are fully visible; rolled away
      // they vanish. The band is centered on the ball's long axis.
      const spinPhase = b.t * 14;            // 14 rad/s spin rate
      const facing = Math.cos(spinPhase);    // -1..1
      const visible = Math.max(0, facing);   // hide when rolled away
      if (visible > 0.02) {
        const bandWidth = rx * 0.55 * visible;
        const bandHeight = ry * 0.18;
        ctx.fillStyle = `rgba(245, 245, 230, ${0.85 * visible})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, bandWidth, bandHeight, 0, 0, Math.PI * 2);
        ctx.fill();
        // Cross-stitches along the band
        ctx.strokeStyle = `rgba(120, 60, 30, ${0.7 * visible})`;
        ctx.lineWidth = Math.max(1, r * 0.06);
        const stitchCount = 5;
        for (let i = 0; i < stitchCount; i++) {
          const lx = -bandWidth * 0.7 + (i / (stitchCount - 1)) * bandWidth * 1.4;
          ctx.beginPath();
          ctx.moveTo(lx, -bandHeight * 0.7);
          ctx.lineTo(lx,  bandHeight * 0.7);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();
}

function drawScoreboard(g) {
  // Top-edge canvas scoreboard — five cells in a row.
  const padX = 8, padY = 6;
  const y = padY + 4;
  const h = 38;
  // Cell layout
  const cells = [
    { label: "SCORE",  value: String(g.score) },
    { label: "PLAY",   value: `${Math.min(g.taken + 1, g.attempts)}/${g.attempts}` },
    { label: "LAST",   value: g.lastGainYd > 0
                                ? `+${g.lastGainYd}yd`
                                : g.lastGainYd < 0
                                ? `${g.lastGainYd}yd`
                                : "—" },
    { label: "COMBO",  value: `x${g.combo}` },
    { label: "LONG",   value: `${g.longestGain}yd` },
  ];
  const totalW = W - padX * 2;
  const cellW = totalW / cells.length;
  // Background strip
  ctx.fillStyle = "rgba(11, 13, 22, 0.78)";
  ctx.fillRect(padX, padY, totalW, h);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, padY, totalW, h);
  // Cells
  for (let i = 0; i < cells.length; i++) {
    const cx = padX + cellW * i;
    if (i > 0) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
      ctx.beginPath();
      ctx.moveTo(cx, padY + 4); ctx.lineTo(cx, padY + h - 4); ctx.stroke();
    }
    ctx.fillStyle = "rgba(190, 200, 220, 0.85)";
    ctx.font = "bold 9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(cells[i].label, cx + cellW / 2, y + 8);
    const color = cells[i].label === "LAST" && g.lastGainYd < 0 ? "#ff5470"
                : cells[i].label === "LAST" && g.lastGainYd > 15 ? "#4ddc8c"
                : cells[i].label === "COMBO" && g.combo >= 3 ? "#ffd03a"
                : "#fff";
    ctx.fillStyle = color;
    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.fillText(cells[i].value, cx + cellW / 2, y + 26);
  }
  ctx.textAlign = "start";
}

function drawPresnapCue(g) {
  if (g.phase !== "presnap" || g.finished) return;
  ctx.save();
  const t = performance.now() / 1000;
  const a = 0.55 + 0.45 * Math.sin(t * 6);
  ctx.fillStyle = `rgba(255, 220, 80, ${a})`;
  ctx.font = "bold 16px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("Tap to snap  •  flick to throw", W / 2, H * 0.95);
  ctx.textAlign = "start";
  ctx.restore();
}

// ──────────────────────────────────────────────────────────────────────
// Game-over panel — jumbotron-style FINAL header, stat board with the
// player's round line + their lifetime best beneath it, cash earned,
// and Play Again / Menu buttons. Staggered fade-in tied to the
// generic finishHoldUntil clock so reveals feel intentional.
// ──────────────────────────────────────────────────────────────────────
function drawQbFinishedOverlay(g) {
  const heldFor = Math.max(0, performance.now() - ((g.finishHoldUntil || 0) - 600));
  // Backdrop — darker than the field but lets the stadium read through.
  const bgA = Math.min(0.78, heldFor / 240 * 0.78);
  ctx.fillStyle = `rgba(7, 9, 18, ${bgA})`;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";

  // "FINAL" header in jumbotron amber, slides down on entry.
  // Title position uses easeOutBack so it overshoots slightly and
  // settles. Alpha stays linear so it doesn't pulse during fade-in.
  const titleA = Math.min(1, heldFor / 240);
  const titleEase = ease(titleA, "easeOutBack");
  const titleY = H * 0.16 - (1 - titleEase) * 22;
  ctx.fillStyle = `rgba(255, 176, 32, ${titleA})`;
  ctx.font = "bold 30px ui-monospace, monospace";
  ctx.fillText("FINAL", W / 2, titleY);

  // Big score number underneath, jumbotron-style.
  const scoreA = Math.min(1, Math.max(0, (heldFor - 120) / 240));
  ctx.fillStyle = `rgba(255, 215, 106, ${scoreA})`;
  ctx.font = "bold 84px ui-monospace, monospace";
  ctx.fillText(String(g.score), W / 2, H * 0.30);

  // Optional NEW BEST badge — checks the legacy minigameBest key too
  // so the badge fires even if save.qbChallengeBest is still empty
  // (first-ever finish on a fresh save).
  const legacyBest = (save.minigameBest && save.minigameBest.qb_challenge) || 0;
  const best = (save.qbChallengeBest && save.qbChallengeBest.bestScore) || 0;
  const newBest = g.score > 0 && g.score >= Math.max(legacyBest, best);
  if (newBest) {
    const badgeA = Math.min(1, Math.max(0, (heldFor - 350) / 240));
    const pulse = 1 + 0.08 * Math.sin(performance.now() / 220);
    ctx.save();
    ctx.translate(W / 2, H * 0.355);
    ctx.scale(pulse, pulse);
    ctx.fillStyle = `rgba(255, 215, 106, ${badgeA * 0.18})`;
    ctx.beginPath();
    const bw = 132, bh = 26;
    if (ctx.roundRect) ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 6);
    else ctx.rect(-bw / 2, -bh / 2, bw, bh);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 215, 106, ${badgeA})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 230, 128, ${badgeA})`;
    ctx.font = "bold 13px ui-monospace, monospace";
    ctx.fillText("NEW PERSONAL BEST", 0, 5);
    ctx.restore();
  }

  // Stat board — six rows in two columns (round + lifetime), with a
  // hairline divider down the middle. Reveals row-by-row.
  const cardY = H * 0.42;
  const cardH = 168;
  const cardW = Math.min(330, W - 28);
  const cardX = W / 2 - cardW / 2;
  const cardA = Math.min(1, Math.max(0, (heldFor - 480) / 240));
  ctx.save();
  ctx.globalAlpha = cardA;
  // Card background
  ctx.fillStyle = "rgba(11, 13, 22, 0.85)";
  ctx.strokeStyle = "rgba(255, 176, 32, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(cardX, cardY, cardW, cardH, 10);
  else ctx.rect(cardX, cardY, cardW, cardH);
  ctx.fill(); ctx.stroke();
  // Column headers
  ctx.fillStyle = "rgba(190, 200, 220, 0.75)";
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.fillText("THIS ROUND",  cardX + cardW * 0.27, cardY + 18);
  ctx.fillText("LIFETIME BEST", cardX + cardW * 0.73, cardY + 18);
  // Divider
  ctx.strokeStyle = "rgba(255, 176, 32, 0.20)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX + cardW / 2, cardY + 28);
  ctx.lineTo(cardX + cardW / 2, cardY + cardH - 10);
  ctx.stroke();
  ctx.restore();

  // Stat rows — each row puts the label dead-center with the round
  // value on the left and the lifetime value on the right, all on one
  // baseline so the eye can scan the columns cleanly.
  const rows = [
    { label: "COMPLETIONS",  round: `${g.completions}/${g.attempts}`, life: String((save.qbChallengeBest && save.qbChallengeBest.totalCompletions) || 0) },
    { label: "LONGEST GAIN", round: `${g.longestGain}yd`,             life: `${(save.qbChallengeBest && save.qbChallengeBest.longestGain) || 0}yd` },
    { label: "BEST STREAK",  round: `x${g.bestStreak}`,               life: `x${(save.qbChallengeBest && save.qbChallengeBest.bestStreak) || 0}` },
    { label: "SACKS TAKEN",  round: String(g.sacks),                  life: String((save.qbChallengeBest && save.qbChallengeBest.totalSacks) || 0) },
  ];
  const rowGap = 26;
  const rowY0 = cardY + 50;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // easeInOutQuad — soft accelerate + decelerate so the row reveal
    // doesn't snap on either end of the fade-in.
    const rowA = ease(
      Math.min(1, Math.max(0, (heldFor - 600 - i * 110) / 220)),
      "easeInOutQuad"
    );
    if (rowA <= 0) continue;
    const y = rowY0 + i * rowGap;
    // Round just set a new lifetime high? Highlight the round value in
    // gold and keep the lifetime column muted so the eye lands on what
    // changed.
    const beatLifetime =
      (r.label === "LONGEST GAIN" && g.longestGain > 0 && g.longestGain > ((save.qbChallengeBest && save.qbChallengeBest.longestGain) || 0)) ||
      (r.label === "BEST STREAK"  && g.bestStreak > 0 && g.bestStreak > ((save.qbChallengeBest && save.qbChallengeBest.bestStreak) || 0));
    // Round value (left column, centered)
    ctx.fillStyle = beatLifetime
      ? `rgba(255, 215, 106, ${rowA})`
      : `rgba(255, 255, 255, ${rowA})`;
    ctx.font = "bold 17px ui-monospace, monospace";
    ctx.fillText(r.round, cardX + cardW * 0.22, y);
    // Centered label
    ctx.fillStyle = `rgba(190, 200, 220, ${rowA * 0.80})`;
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.fillText(r.label, W / 2, y - 1);
    // Lifetime value (right column, muted)
    ctx.fillStyle = `rgba(190, 200, 220, ${rowA})`;
    ctx.font = "bold 17px ui-monospace, monospace";
    ctx.fillText(r.life, cardX + cardW * 0.78, y);
  }

  // Cash earned — green, slides up.
  const cash = QBChallenge.payout(g);
  const cashA = Math.min(1, Math.max(0, (heldFor - 1100) / 240));
  if (cashA > 0) {
    ctx.fillStyle = `rgba(77, 220, 140, ${cashA})`;
    ctx.font = "bold 26px ui-monospace, monospace";
    ctx.fillText(`+$${cash}`, W / 2, cardY + cardH + 36 + (1 - cashA) * 8);
  }

  // Buttons. Same rects the dispatcher hit-tests against (_btnPlayAgain
  // / _btnMenu), staggered fade-in for hierarchy.
  const bw = Math.min(190, W * 0.42);
  const bh = 56;
  const gap = 16;
  const cy = H * 0.84;
  g._btnPlayAgain = { x: W / 2 - bw - gap / 2, y: cy, w: bw, h: bh };
  g._btnMenu      = { x: W / 2 + gap / 2,      y: cy, w: bw, h: bh };
  drawQbButton(g._btnPlayAgain, "Play Again ▶", "#ffb020", "#1a1206",
               Math.min(1, Math.max(0, (heldFor - 1300) / 240)),
               /*pulse*/ true);
  drawQbButton(g._btnMenu, "Menu", "rgba(58, 70, 105, 0.95)", "#fff",
               Math.min(1, Math.max(0, (heldFor - 1420) / 240)),
               /*pulse*/ false);

  ctx.textAlign = "start";
}

function drawQbButton(rect, label, fill, ink, alpha, pulse) {
  if (alpha <= 0) return;
  // Drop-in eases past-and-back (easeOutBack) for a "lands and settles"
  // feel. Alpha stays linear so the button doesn't strobe.
  const drop = (1 - ease(alpha, "easeOutBack")) * 10;
  ctx.save();
  ctx.globalAlpha = alpha;
  let drawFill = fill;
  if (pulse) {
    const p = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    const lift = Math.floor(20 * p);
    drawFill = `rgba(${255}, ${176 + lift}, ${32 + lift}, ${alpha})`;
  }
  ctx.fillStyle = drawFill;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(rect.x, rect.y + drop, rect.w, rect.h, 12);
  else ctx.rect(rect.x, rect.y + drop, rect.w, rect.h);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.font = "bold 18px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 6 + drop);
  ctx.restore();
}

function drawMessage(g) {
  if (!g.message || g.outcomeT <= 0) return;
  ctx.save();
  ctx.textAlign = "center";
  // Headline
  ctx.font = "bold 38px ui-monospace, monospace";
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillText(g.message, W / 2 + 2, H / 2 + 2);
  ctx.fillStyle = g.messageColor || "#fff";
  ctx.fillText(g.message, W / 2, H / 2);
  // Sub-line — smaller, just below
  if (g.messageSub) {
    ctx.font = "bold 22px ui-monospace, monospace";
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillText(g.messageSub, W / 2 + 2, H / 2 + 34);
    ctx.fillStyle = "#fff";
    ctx.fillText(g.messageSub, W / 2, H / 2 + 32);
  }
  ctx.textAlign = "start";
  ctx.restore();
}

// @ts-nocheck
// First-person flick view — shared pinhole projection + TRUE flick-input
// helpers used by Field Goal, Hoops, Can Bash, Party Pong, and QB Challenge.
// The world is described in meters; the camera sits behind the holder/QB
// looking down +z.
//
//   x = lateral (0 = straight ahead)
//   y = height above the ground
//   z = depth (positive = away from camera)
//
// Anything at the camera's eye height (y = FP_CAMERA_H) projects to
// the horizon. Tall things (uprights, light towers) project above it.
// Standard pinhole, no perspective surprises.
//
// Flick model
// -----------
// This is an impulse / paper-toss flick, NOT a slingshot:
//   • Power comes from finger SPEED over the last ~70ms, not drag length.
//   • Direction is the velocity vector of that window (where you snapped).
//   • Peak velocity in the window is used so a lift-off slowdown doesn't
//     kill a real flick.
//   • A slow long drag does nothing. A short fast snap launches.
//   • You flick TOWARD the target (not pull-back-and-release).

import { ctx, W, H } from "./canvas.js";

export const FP_FOCAL    = 600;       // pixels of focal length
export const FP_CAMERA_H = 1.6;       // ~5'3" eye line

let _fpCamZ = 0;

export function fpSetCam(z) { _fpCamZ = z || 0; }
export function fpGetCamZ()  { return _fpCamZ; }
export function fpHorizonY() { return H * 0.55; }

export function fpProject(x, y, z) {
  const zz = Math.max(0.5, z - _fpCamZ);
  return {
    sx: W / 2 + x * FP_FOCAL / zz,
    sy: fpHorizonY() + (FP_CAMERA_H - y) * FP_FOCAL / zz,
    scale: FP_FOCAL / zz / 60,   // baseline scale: ~1× at z=10
  };
}

export function fpDrawSky(top1, top2, bot) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, top1); sky.addColorStop(0.55, top2); sky.addColorStop(1, bot);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
}

// Fill the ground plane with grass + perspective lateral lines.
export function fpDrawField(grass, lineColor, opts) {
  const horizon = fpHorizonY();
  ctx.fillStyle = grass;
  ctx.fillRect(0, horizon, W, H - horizon);
  ctx.strokeStyle = lineColor || "rgba(255,255,255,0.40)";
  for (let z = 5; z <= 120; z += 5) {
    const left  = fpProject(-25, 0, z);
    const right = fpProject( 25, 0, z);
    ctx.lineWidth = Math.max(0.6, 2 * (FP_FOCAL / z / 60));
    ctx.beginPath(); ctx.moveTo(left.sx, left.sy); ctx.lineTo(right.sx, right.sy); ctx.stroke();
  }
  ctx.strokeStyle = lineColor || "rgba(255,255,255,0.50)";
  for (let z = 2; z <= 80; z += 2) {
    const a = fpProject(-0.4, 0, z);
    const b = fpProject( 0.4, 0, z);
    ctx.lineWidth = Math.max(0.5, 1.5 * (FP_FOCAL / z / 60));
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
  }
}

// ──────────────────────────────────────────────────────────────────────
// True-flick sampling
// ──────────────────────────────────────────────────────────────────────
const FLICK_KEEP_MS    = 180;   // history horizon
const FLICK_WINDOW_MS  = 70;    // velocity is measured over this span
const FLICK_TAIL_MS    = 14;    // ignore the last frames of finger-lift slowdown
const FLICK_MIN_DT     = 0.012; // seconds — reject noisy 1-frame spikes
const FLICK_MIN_SPEED  = 380;   // px/s — below this is a drag, not a flick
const FLICK_FULL_SPEED = 2000;  // px/s — a snappy snap
const FLICK_MIN_DIST   = 16;    // px — reject taps
const FLICK_MIN_UP     = 0.22;  // must be at least this much screen-up

function pushSample(state, x, y, t) {
  if (!state.dragHistory) state.dragHistory = [];
  const hist = state.dragHistory;
  const last = hist[hist.length - 1];
  // Skip duplicates (some browsers fire move+up at the same pixel).
  if (last && last.x === x && last.y === y && t - last.t < 4) return;
  hist.push({ x, y, t });
  const cutoff = t - FLICK_KEEP_MS;
  while (hist.length > 1 && hist[0].t < cutoff) hist.shift();
}

function clearFlick(state) {
  state.dragStart = null;
  state.dragNow = null;
  state.dragHistory = null;
}

// Peak-velocity window inside the recent history. Returns
// { speed, vx, vy, dx, dy, dist } or null.
function peakWindow(hist) {
  if (!hist || hist.length < 2) return null;
  const tEnd = hist[hist.length - 1].t;
  const tHi = tEnd - FLICK_TAIL_MS;
  const tLo = tEnd - FLICK_KEEP_MS;
  let best = null;
  for (let i = 0; i < hist.length; i++) {
    const a = hist[i];
    if (a.t < tLo) continue;
    for (let j = i + 1; j < hist.length; j++) {
      const b = hist[j];
      if (b.t > tHi + 8) break;
      const dt = (b.t - a.t) / 1000;
      if (dt < FLICK_MIN_DT) continue;
      if (dt > (FLICK_WINDOW_MS / 1000) + 0.045) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const speed = dist / dt;
      if (!best || speed > best.speed) {
        best = { speed, dx, dy, dist, vx: dx / dt, vy: dy / dt };
      }
    }
  }
  if (best) return best;
  // Fallback: first-to-last of whatever we have.
  const a = hist[0], b = hist[hist.length - 1];
  const dt = Math.max(FLICK_MIN_DT, (b.t - a.t) / 1000);
  const dx = b.x - a.x, dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  return { speed: dist / dt, dx, dy, dist, vx: dx / dt, vy: dy / dt };
}

function totalDist(hist) {
  if (!hist || hist.length < 2) return 0;
  const a = hist[0], b = hist[hist.length - 1];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function descriptorFromPeak(peak, hist) {
  if (!peak) return null;
  const speed = peak.speed;
  const power = Math.max(0, Math.min(1, speed / FLICK_FULL_SPEED));
  const dist = totalDist(hist);
  const vx = peak.vx, vy = peak.vy;
  const spd = Math.max(1, speed);
  const lateral = Math.max(-1, Math.min(1, vx / Math.max(280, -vy)));
  const upward = Math.max(0, Math.min(1, -vy / spd));
  return {
    dx: peak.dx, dy: peak.dy, dist,
    vx, vy, speed,
    power, lateral, upward,
  };
}

function isLaunchable(f) {
  if (!f) return false;
  if (f.speed < FLICK_MIN_SPEED) return false;
  if (f.dist < FLICK_MIN_DIST) return false;
  if (f.vy >= 0) return false;                 // must go screen-up
  if (f.upward < FLICK_MIN_UP) return false;   // mostly upward
  return true;
}

// Read the current gesture without consuming it. `opts.launch` (default
// false) filters out sub-threshold drags — use true only on pointer-up.
export function fpFlickFromState(state, opts) {
  const launch = !!(opts && opts.launch);
  const hist = state.dragHistory;
  if (!hist || hist.length < 2) return null;
  const peak = peakWindow(hist);
  const flick = descriptorFromPeak(peak, hist);
  if (!flick) return null;
  if (launch) {
    if (!isLaunchable(flick)) return null;
  }
  return flick;
}

// Standard flick handler. Tracks samples on down/move. On release of a
// real upward SNAP, returns { dx, dy, dist, power, lateral, upward, speed }.
// Slow drags and taps return null.
export function fpProcessFlick(state, kind, x, y) {
  const now = performance.now();
  if (kind === "down") {
    state.dragStart = { x, y, t: now };
    state.dragNow = { x, y };
    state.dragHistory = [{ x, y, t: now }];
    return null;
  }
  if (kind === "move" && state.dragStart) {
    state.dragNow = { x, y };
    pushSample(state, x, y, now);
    return null;
  }
  if (kind === "up" && state.dragStart) {
    state.dragNow = { x, y };
    pushSample(state, x, y, now);
    const flick = fpFlickFromState(state, { launch: true });
    const dist = totalDist(state.dragHistory);
    clearFlick(state);
    if (!flick && dist > 36) {
      // They dragged, but it wasn't a snap. Teach the new feel once.
      state.flickMiss = { until: now + 1100 };
    }
    return flick;
  }
  return null;
}

// Nudge the resting ball along the current swipe so it "comes with"
// the finger — Paper Toss / flick-kick juice. Caps so it never leaves
// the tee area. `stretch` / `angle` let callers squash the sprite.
export function fpFlickNudge(state, originSX, originSY) {
  if (!state || !state.dragStart || !state.dragNow) {
    return { x: originSX, y: originSY, stretch: 0, angle: -Math.PI / 2, power: 0 };
  }
  const f = fpFlickFromState(state, { launch: false });
  const dx = state.dragNow.x - state.dragStart.x;
  const dy = state.dragNow.y - state.dragStart.y;
  const follow = 0.20;
  let ox = dx * follow;
  let oy = dy * follow;
  const max = 58;
  const m = Math.hypot(ox, oy);
  if (m > max) { ox *= max / m; oy *= max / m; }
  const power = f ? f.power : 0;
  const angle = f ? Math.atan2(f.vy, f.vx) : Math.atan2(dy, dx);
  return { x: originSX + ox, y: originSY + oy, stretch: power, angle, power };
}

// Flick HUD: finger trail (the actual swipe), a direction cone from the
// ball in the SNAP direction (not inverted), a speed meter, and a
// power ring around the origin.
export function fpDrawAimArc(state, originSX, originSY, color) {
  // Coaching toast after a too-slow drag. Survives the gesture clear.
  if (state.flickMiss && performance.now() < state.flickMiss.until) {
    const a = Math.min(1, (state.flickMiss.until - performance.now()) / 280);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("SNAP IT — flick faster, don't drag", W / 2, H * 0.78);
    ctx.textAlign = "start";
    ctx.restore();
  } else if (state.flickMiss && performance.now() >= state.flickMiss.until) {
    state.flickMiss = null;
  }
  if (!state.dragStart || !state.dragNow) return;
  const hist = state.dragHistory || [];
  const flick = fpFlickFromState(state, { launch: false });
  const power = flick ? flick.power : 0;
  const col = color || "rgba(255, 220, 80, 0.9)";
  const rgb = (function parseRgb(c) {
    const m = String(c).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? `${m[1]}, ${m[2]}, ${m[3]}` : "255, 220, 80";
  })(col);

  // Finger trail — recent samples as a fading stroke. This is the
  // gesture the player just made, not a predicted ballistic.
  if (hist.length >= 2) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 1; i < hist.length; i++) {
      const a = (i + 1) / hist.length;
      ctx.strokeStyle = `rgba(${rgb}, ${(0.15 + a * 0.75).toFixed(2)})`;
      ctx.lineWidth = 2 + a * (3 + power * 5);
      ctx.beginPath();
      ctx.moveTo(hist[i - 1].x, hist[i - 1].y);
      ctx.lineTo(hist[i].x, hist[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Direction cone from the tee along the velocity vector.
  if (flick && flick.speed > 80) {
    const ang = Math.atan2(flick.vy, flick.vx);
    const len = 40 + power * 90;
    const tipX = originSX + Math.cos(ang) * len;
    const tipY = originSY + Math.sin(ang) * len;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.35 + power * 0.55;
    ctx.lineWidth = 3 + power * 3;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(originSX, originSY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.5 + power * 0.5;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(ang - 0.4) * 12, tipY - Math.sin(ang - 0.4) * 12);
    ctx.lineTo(tipX - Math.cos(ang + 0.4) * 12, tipY - Math.sin(ang + 0.4) * 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Power ring around the origin — grows with SNAP speed.
  if (power > 0.04) {
    ctx.save();
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.25 + power * 0.55;
    ctx.lineWidth = 2 + power * 3;
    ctx.beginPath();
    ctx.arc(originSX, originSY, 18 + power * 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Speed meter — fills with flick SPEED, not drag length.
  const mx = W - 134, my = 18, mw = 114, mh = 12;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(mx, my, mw, mh);
  const ready = power >= FLICK_MIN_SPEED / FLICK_FULL_SPEED;
  ctx.fillStyle = power > 0.85 ? "#fff4a0" : ready ? (color || "#ffb020") : "rgba(255,255,255,0.35)";
  ctx.fillRect(mx, my, mw * power, mh);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(mx, my, mw, mh);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.textAlign = "right";
  ctx.fillText(power > 0.85 ? "SNAP!" : "SNAP", mx - 6, my + 10);
  ctx.textAlign = "start";
}

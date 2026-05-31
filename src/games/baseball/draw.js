// First-person scene composers + UI widgets.
//
// drawPitcherView() — camera at the mound looking down +z toward the
//   plate. Renders sky, grass, foul lines, the catcher silhouette,
//   the umpire, the strike zone overlay, the in-flight ball, and the
//   aim crosshair if the player is currently dragging.
//
// drawBatterView() / drawFieldView() land in Phases 3 and 4.

import { ctx, W, H, ease } from "../../engine/canvas.js";
import {
  fpSetCam, fpHorizonY, fpProject, fpDrawSky, fpDrawField,
} from "../../engine/fpView.js";
import {
  PLATE_Z, PLATE_TOP, PLATE_BOTTOM, PLATE_HALF_W, BALL_R, BALL_RELEASE_Y,
} from "./pitches.js";

// Camera Z used for the BATTER view. We sit the camera just behind
// home plate looking back toward the mound. The world-frame coordinates
// stay the same as the pitcher view (pitcher at z=0, plate at z=18.4)
// so the physics doesn't need to know about the camera flip — only
// rendering does. projectFromBatter() handles the perspective inversion.
import {
  FP_FOCAL, FP_CAMERA_H,
} from "../../engine/fpView.js";
// 4m behind the plate is roughly the "broadcast slot camera" distance
// real ballgames use — it gives the strike zone a comfortable on-screen
// size and the pitcher silhouette enough distance that the ball's
// approach feels real instead of jumping in your face.
export const BATTER_CAM_Z = PLATE_Z + 4.0;
const BATTER_EYE_H = 1.65;                         // ~5'5" eye-height

// Custom projection for the batter view. Looks back at the mound (so
// world +z = away from camera becomes "behind" us; world -z + cam offset
// is the new "forward"). x is mirrored because the batter is facing the
// pitcher (their left-hand side is +x in the pitcher frame).
export function projectFromBatter(x, y, z) {
  const zz = Math.max(0.5, BATTER_CAM_Z - z);
  return {
    sx: W / 2 + (-x) * FP_FOCAL / zz,
    sy: fpHorizonY() + (BATTER_EYE_H - y) * FP_FOCAL / zz,
    scale: FP_FOCAL / zz / 60,
  };
}

// ──────────────────────────────────────────────────────────────────────
// PITCHER VIEW
// ──────────────────────────────────────────────────────────────────────
export function drawPitcherView(g) {
  fpSetCam(0);
  drawSkyAndField();
  drawFoulLines();
  // Order matters — the catcher and umpire are behind the strike zone
  // box, so draw them first.
  drawCatcher();
  drawUmpire();
  drawStrikeZone();
  // Ball trail + ball after the zone box so the ball can occlude.
  if (g.ball) drawBallTrail(g.ball);
  if (g.ball) drawBall(g.ball);
  // Crosshair tracks the player's drag. When no drag is active,
  // show the held aim point (since Phase 2 uses tap-and-release-to-pitch).
  drawAimCrosshair(g);
}

function drawSkyAndField() {
  fpDrawSky("#0e1726", "#1e3454", "#3d6a48");
  fpDrawField("#3d6a48", "rgba(255,255,255,0.06)");
}

function drawFoulLines() {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 2;
  for (const x of [-28, 28]) {
    const a = fpProject(0, 0, 0.5);
    const b = fpProject(x, 0, 95);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
  }
}

// Catcher squats behind home plate — head + torso + glove. Drawn from
// behind so all we see is the back of the helmet, the shoulders, and
// the glove peeking around the side.
function drawCatcher() {
  // Catcher's body sits a hair in front of the plate so the strike-zone
  // box reads cleanly.
  const z = PLATE_Z - 0.45;
  // Head
  const head = fpProject(0, 1.45, z);
  const torso = fpProject(0, 1.05, z);
  const shoulderL = fpProject(-0.40, 1.20, z);
  const shoulderR = fpProject(0.40, 1.20, z);
  const r = Math.max(6, 24 * head.scale);
  // Helmet
  ctx.fillStyle = "#1c2540";
  ctx.beginPath();
  ctx.arc(head.sx, head.sy, r, 0, Math.PI * 2);
  ctx.fill();
  // Helmet stripe
  ctx.strokeStyle = "#f8d56a";
  ctx.lineWidth = Math.max(1, 2.2 * head.scale);
  ctx.beginPath();
  ctx.moveTo(head.sx - r * 0.7, head.sy - r * 0.2);
  ctx.lineTo(head.sx + r * 0.7, head.sy - r * 0.2);
  ctx.stroke();
  // Torso / chest protector
  ctx.fillStyle = "#243454";
  ctx.beginPath();
  ctx.moveTo(shoulderL.sx, shoulderL.sy);
  ctx.lineTo(shoulderR.sx, shoulderR.sy);
  ctx.lineTo(torso.sx + r * 1.5, torso.sy + r * 0.8);
  ctx.lineTo(torso.sx - r * 1.5, torso.sy + r * 0.8);
  ctx.closePath();
  ctx.fill();
  // Glove peeking out on the right
  const glove = fpProject(0.30, 0.85, z + 0.1);
  ctx.fillStyle = "#7a4a1c";
  ctx.beginPath();
  ctx.arc(glove.sx, glove.sy, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

// Umpire stands directly behind the catcher — taller silhouette in
// black.
function drawUmpire() {
  const z = PLATE_Z + 0.10;
  const head = fpProject(0, 1.95, z);
  const shoulderL = fpProject(-0.45, 1.70, z);
  const shoulderR = fpProject(0.45, 1.70, z);
  const hip = fpProject(0, 1.10, z);
  const r = Math.max(5, 18 * head.scale);
  ctx.fillStyle = "rgba(20, 22, 30, 0.85)";
  // Body silhouette
  ctx.beginPath();
  ctx.moveTo(shoulderL.sx, shoulderL.sy);
  ctx.lineTo(shoulderR.sx, shoulderR.sy);
  ctx.lineTo(hip.sx + r * 1.6, hip.sy);
  ctx.lineTo(hip.sx - r * 1.6, hip.sy);
  ctx.closePath();
  ctx.fill();
  // Head
  ctx.beginPath();
  ctx.arc(head.sx, head.sy, r, 0, Math.PI * 2);
  ctx.fill();
}

// Strike zone rectangle, projected as a 3D box at the plate plane.
// Subtly pulses so it draws the eye.
function drawStrikeZone() {
  const corners = [
    fpProject(-PLATE_HALF_W, PLATE_BOTTOM, PLATE_Z),
    fpProject( PLATE_HALF_W, PLATE_BOTTOM, PLATE_Z),
    fpProject( PLATE_HALF_W, PLATE_TOP,    PLATE_Z),
    fpProject(-PLATE_HALF_W, PLATE_TOP,    PLATE_Z),
  ];
  const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 400);
  ctx.strokeStyle = `rgba(255, 235, 130, ${0.5 * pulse + 0.2})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(corners[0].sx, corners[0].sy);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].sx, corners[i].sy);
  ctx.closePath();
  ctx.stroke();
  // Filled overlay — very faint so it doesn't crowd the catcher
  ctx.fillStyle = `rgba(255, 235, 130, ${0.06 * pulse})`;
  ctx.fill();
}

function drawBallTrail(ball) {
  if (!ball.trail || ball.trail.length < 2) return;
  ctx.strokeStyle = ball.pitch.colorTrail;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < ball.trail.length; i++) {
    const t = ball.trail[i];
    const p = fpProject(t.x, t.y, t.z);
    if (i === 0) ctx.moveTo(p.sx, p.sy);
    else ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
}

function drawBall(ball) {
  const p = fpProject(ball.x, ball.y, ball.z);
  const r = ballScreenRadius(ball.z);
  ctx.fillStyle = ball.pitch.colorPrimary;
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
  ctx.fill();
  drawBallSeam(p.sx, p.sy, r);
}

// Real-world ball-to-screen radius, capped + floored so the ball
// stays visible at the far end and doesn't become a window-filling
// blob at the near end. Camera-Z agnostic: callers pass the world z
// of the ball; we know the camera positions from the projection
// constants.
function ballScreenRadius(worldZ) {
  // Pitcher view: camera at z=0, ball travels 0..18m → dist 0.5..18m.
  // Batter view: camera at BATTER_CAM_Z, dist BATTER_CAM_Z..(BATTER_CAM_Z-PLATE_Z).
  // We can compute either view's distance off the same ball.z because
  // we know which composer is active by which call site this is — but
  // for simplicity, use the SHORTER of the two distances. The pitcher
  // view caller will always see the larger distance; the batter caller
  // will see the smaller. Both look natural.
  const distPitcher = Math.max(0.5, worldZ);
  const distBatter  = Math.max(0.5, BATTER_CAM_Z - worldZ);
  const dist = Math.min(distPitcher, distBatter);
  return Math.max(2.5, Math.min(28, BALL_R * FP_FOCAL / dist));
}

function drawBallSeam(cx, cy, r) {
  if (r <= 3) return;
  ctx.strokeStyle = "rgba(220, 50, 50, 0.85)";
  ctx.lineWidth = Math.max(0.8, r * 0.18);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.7, -Math.PI * 0.35, Math.PI * 0.35);
  ctx.stroke();
}

// Aim crosshair — follows the player's drag while picking the pitch's
// target. Projected at the plate plane so the player sees exactly
// where their pitch is aimed.
function drawAimCrosshair(g) {
  if (!g.armedPitch) return;
  if (g.phase !== "aim" && g.phase !== "presnap") return;
  const ax = g.aimX != null ? g.aimX : 0;
  const ay = g.aimY != null ? g.aimY : (PLATE_TOP + PLATE_BOTTOM) / 2;
  const p = fpProject(ax, ay, PLATE_Z);
  const r = 14;
  ctx.strokeStyle = "#f8d56a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
  ctx.moveTo(p.sx - r - 5, p.sy); ctx.lineTo(p.sx - r + 4, p.sy);
  ctx.moveTo(p.sx + r - 4, p.sy); ctx.lineTo(p.sx + r + 5, p.sy);
  ctx.moveTo(p.sx, p.sy - r - 5); ctx.lineTo(p.sx, p.sy - r + 4);
  ctx.moveTo(p.sx, p.sy + r - 4); ctx.lineTo(p.sx, p.sy + r + 5);
  ctx.stroke();
  ctx.fillStyle = "rgba(248, 213, 106, 0.6)";
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

// ──────────────────────────────────────────────────────────────────────
// PITCHER UI — pitch-type chips along the bottom of the screen and
// the count widget on the right edge. Drawn on top of the field view.
// ──────────────────────────────────────────────────────────────────────
export function drawPitchChips(g, pitches) {
  const chipH = 56;
  const gap = 8;
  const pad = 12;
  const chipW = Math.min(78, (W - pad * 2 - gap * (pitches.length - 1)) / pitches.length);
  const totalW = chipW * pitches.length + gap * (pitches.length - 1);
  const x0 = W / 2 - totalW / 2;
  const y0 = H - chipH - 24;
  // Store rects on the runtime so handlePointer can hit-test them.
  g._pitchChipRects = [];
  ctx.textAlign = "center";
  for (let i = 0; i < pitches.length; i++) {
    const p = pitches[i];
    const x = x0 + i * (chipW + gap);
    const rect = { x, y: y0, w: chipW, h: chipH, pitchId: p.id };
    g._pitchChipRects.push(rect);
    const isArmed = g.armedPitch && g.armedPitch.id === p.id;
    // Chip background
    ctx.fillStyle = isArmed ? p.colorPrimary : "rgba(11, 13, 22, 0.85)";
    ctx.strokeStyle = isArmed ? "#fff" : "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 10);
    else ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.fill(); ctx.stroke();
    // Label
    ctx.fillStyle = isArmed ? "#1a1206" : "#fff";
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(p.short, x + chipW / 2, y0 + 24);
    ctx.fillStyle = isArmed ? "rgba(30, 22, 12, 0.85)" : "rgba(190, 200, 220, 0.78)";
    ctx.font = "bold 9px ui-monospace, monospace";
    ctx.fillText(`${p.vMph}mph`, x + chipW / 2, y0 + 42);
  }
  ctx.textAlign = "start";
}

// Cue prompt above the chips — guides the player through the pitch flow.
export function drawPitcherPrompt(g) {
  let msg = "";
  if (g.phase === "presnap" && !g.armedPitch) msg = "Pick a pitch";
  else if (g.phase === "presnap" && g.armedPitch) msg = "Drag to aim · release to pitch";
  else if (g.phase === "aim") msg = "Release to fire";
  else if (g.phase === "pitch") msg = "";
  else if (g.phase === "resolve") msg = "";
  if (!msg) return;
  ctx.save();
  ctx.fillStyle = "rgba(11, 13, 22, 0.65)";
  ctx.font = "bold 13px ui-monospace, monospace";
  const tw = ctx.measureText(msg).width + 24;
  const tx = W / 2 - tw / 2;
  const ty = H - 56 - 24 - 30;
  if (ctx.roundRect) {
    ctx.beginPath(); ctx.roundRect(tx, ty, tw, 24, 12); ctx.fill();
  } else {
    ctx.fillRect(tx, ty, tw, 24);
  }
  ctx.fillStyle = "#f8d56a";
  ctx.textAlign = "center";
  ctx.fillText(msg, W / 2, ty + 16);
  ctx.textAlign = "start";
  ctx.restore();
}

// ──────────────────────────────────────────────────────────────────────
// BATTER VIEW — camera behind home plate, looking toward the mound.
// The pitcher's silhouette is at world z=0; the ball comes from that
// far end and grows as it approaches the camera.
// ──────────────────────────────────────────────────────────────────────
export function drawBatterView(g) {
  drawBatterSky();
  drawBatterField();
  drawBatterFoulLines();
  drawPitcherFigure(g);
  // Strike-zone box anchored above home plate. From the batter's
  // perspective this projects much larger than the pitcher's view of
  // the same box — gives the batter a real target to read pitches off.
  drawBatterStrikeZone();
  if (g.ball) drawBatterBallTrail(g.ball);
  if (g.ball) drawBatterBall(g.ball);
  // Bat icon at the bottom corner — pictographic, indicates which side
  // the player is "batting from" (right-handed by default).
  drawBatterBat(g);
  // Swing reticle — appears when the player is mid-drag, anchored at
  // their drag origin. Shows where the swing will arrive.
  drawSwingReticle(g);
}

function drawBatterSky() {
  // Slightly warmer than the pitcher view — implies "facing the sun
  // setting over the outfield".
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#0e1726");
  sky.addColorStop(0.55, "#23314d");
  sky.addColorStop(1, "#3d6a48");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
}

function drawBatterField() {
  const horizon = fpHorizonY();
  ctx.fillStyle = "#3d6a48";
  ctx.fillRect(0, horizon, W, H - horizon);
  // Lateral perspective lines using batter projection.
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  for (let z = 1; z <= 18; z += 1.5) {
    const left  = projectFromBatter(-25, 0, z);
    const right = projectFromBatter( 25, 0, z);
    ctx.lineWidth = Math.max(0.6, 2 * left.scale);
    ctx.beginPath();
    ctx.moveTo(left.sx, left.sy); ctx.lineTo(right.sx, right.sy);
    ctx.stroke();
  }
  // Pitcher's mound — small brown disc in the middle of the frame.
  const mound = projectFromBatter(0, 0, 0);
  const moundTop = projectFromBatter(0, 0.25, 0);
  const r = Math.max(8, 90 * mound.scale);
  ctx.fillStyle = "#8a6a3a";
  ctx.beginPath();
  ctx.ellipse(mound.sx, mound.sy, r, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  // Rubber on the mound
  ctx.fillStyle = "#dcdcdc";
  ctx.fillRect(moundTop.sx - r * 0.45, moundTop.sy - 2, r * 0.9, 3);
}

function drawBatterFoulLines() {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.50)";
  ctx.lineWidth = 2;
  // Lines go from just behind home plate out into the outfield. From
  // the batter's view, the foul lines diverge to the corners.
  for (const x of [-28, 28]) {
    const a = projectFromBatter(0, 0, PLATE_Z - 0.10);   // near, at the plate
    const b = projectFromBatter(x, 0, -50);              // way behind the pitcher
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
  }
}

// Pitcher silhouette — shifts between WINDUP and RELEASE poses based
// on whether a ball is currently in flight. Mirrors the catcher figure
// from the pitcher view but bigger (pitcher is closer to the camera-
// at-plate frame's edge of the visible distance).
function drawPitcherFigure(g) {
  const z = 0.0;
  // Body sway when not pitching — sells the "windup".
  const sway = (g.ball ? 0 : Math.sin(performance.now() / 500) * 0.04);
  const head = projectFromBatter(sway, 1.85, z);
  const shoulderL = projectFromBatter(-0.45 + sway, 1.55, z);
  const shoulderR = projectFromBatter( 0.45 + sway, 1.55, z);
  const hip  = projectFromBatter(sway, 1.00, z);
  const r = Math.max(5, 18 * head.scale);
  // Body
  ctx.fillStyle = "#243454";
  ctx.beginPath();
  ctx.moveTo(shoulderL.sx, shoulderL.sy);
  ctx.lineTo(shoulderR.sx, shoulderR.sy);
  ctx.lineTo(hip.sx + r * 1.4, hip.sy);
  ctx.lineTo(hip.sx - r * 1.4, hip.sy);
  ctx.closePath();
  ctx.fill();
  // Head / cap
  ctx.fillStyle = "#1c2540";
  ctx.beginPath();
  ctx.arc(head.sx, head.sy, r, 0, Math.PI * 2);
  ctx.fill();
  // Cap brim
  ctx.fillStyle = "#0e1726";
  ctx.fillRect(head.sx - r, head.sy - r * 0.2, r * 2, r * 0.25);
}

function drawBatterStrikeZone() {
  // Same world-coords as the pitcher view's zone, but projected from
  // the batter side so it appears MUCH larger and easier to read.
  const corners = [
    projectFromBatter(-PLATE_HALF_W, PLATE_BOTTOM, PLATE_Z),
    projectFromBatter( PLATE_HALF_W, PLATE_BOTTOM, PLATE_Z),
    projectFromBatter( PLATE_HALF_W, PLATE_TOP,    PLATE_Z),
    projectFromBatter(-PLATE_HALF_W, PLATE_TOP,    PLATE_Z),
  ];
  const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 400);
  ctx.strokeStyle = `rgba(255, 235, 130, ${0.4 * pulse + 0.2})`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(corners[0].sx, corners[0].sy);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].sx, corners[i].sy);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = `rgba(255, 235, 130, ${0.04 * pulse})`;
  ctx.fill();
}

function drawBatterBallTrail(ball) {
  if (!ball.trail || ball.trail.length < 2) return;
  ctx.strokeStyle = ball.pitch.colorTrail;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < ball.trail.length; i++) {
    const t = ball.trail[i];
    const p = projectFromBatter(t.x, t.y, t.z);
    if (i === 0) ctx.moveTo(p.sx, p.sy);
    else ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
}

function drawBatterBall(ball) {
  const p = projectFromBatter(ball.x, ball.y, ball.z);
  const r = ballScreenRadius(ball.z);
  ctx.fillStyle = ball.pitch.colorPrimary;
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
  ctx.fill();
  drawBallSeam(p.sx, p.sy, r);
}

// Bat icon at the bottom-right corner of the screen — small, semi-
// transparent, sells the "first-person batter" feeling without taking
// up real estate.
function drawBatterBat(g) {
  const cx = W - 70;
  const cy = H - 70;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  // Brief swing animation when the player swings — `swingAnimT` is
  // counted up by the at-bat state machine and reset between swings.
  const swingT = g.swingAnimT || 0;
  if (swingT > 0 && swingT < 0.25) {
    const k = swingT / 0.25;
    ctx.rotate(-k * Math.PI * 0.7);
  }
  // Bat handle
  ctx.fillStyle = "#8a6a3a";
  ctx.fillRect(-6, -8, 12, 60);
  // Barrel
  ctx.fillStyle = "#c8a060";
  ctx.fillRect(-9, 50, 18, 50);
  // Knob
  ctx.fillStyle = "#5a4628";
  ctx.beginPath();
  ctx.arc(0, -8, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Swing reticle — appears on screen during a drag. Centered on the
// drag origin, indicates the swing's target zone.
function drawSwingReticle(g) {
  if (!g.dragStart || !g.dragNow) return;
  if (g.phase !== "pitch") return;     // Only meaningful when a pitch is incoming.
  const cx = g.dragNow.x;
  const cy = g.dragNow.y;
  // Crosshair
  ctx.strokeStyle = "rgba(255, 235, 130, 0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 17, cy);
  ctx.moveTo(cx + 17, cy); ctx.lineTo(cx + 26, cy);
  ctx.moveTo(cx, cy - 26); ctx.lineTo(cx, cy - 17);
  ctx.moveTo(cx, cy + 17); ctx.lineTo(cx, cy + 26);
  ctx.stroke();
  ctx.fillStyle = "rgba(248, 213, 106, 0.6)";
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();
}

// Cue prompt for the batter — guides the player on what to do.
// CPU mode: no "send the pitch" prompt — the CPU pitches automatically.
// PVP mode: presnap is the OTHER human's turn (handled by their pitcher
// view); the batter prompt only fires during the pitch.
export function drawBatterPrompt(g) {
  let msg = "";
  if (g.phase === "presnap" && g.mode === "cpu") msg = "Pitcher is winding up...";
  else if (g.phase === "pitch") msg = "Tap to swing  ·  drag to aim";
  if (!msg) return;
  ctx.save();
  ctx.fillStyle = "rgba(11, 13, 22, 0.65)";
  ctx.font = "bold 13px ui-monospace, monospace";
  const tw = ctx.measureText(msg).width + 24;
  const tx = W / 2 - tw / 2;
  const ty = H - 80;
  if (ctx.roundRect) {
    ctx.beginPath(); ctx.roundRect(tx, ty, tw, 24, 12); ctx.fill();
  } else {
    ctx.fillRect(tx, ty, tw, 24);
  }
  ctx.fillStyle = "#f8d56a";
  ctx.textAlign = "center";
  ctx.fillText(msg, W / 2, ty + 16);
  ctx.textAlign = "start";
  ctx.restore();
}

// ──────────────────────────────────────────────────────────────────────
// FIELD VIEW — wide angle showing the diamond + outfielders. Used
// during the "field" phase after contact so the player can watch the
// ball fly and see fielders react.
// ──────────────────────────────────────────────────────────────────────
// Camera sits well behind home plate at height — broadcast "CF view"
// rotated 180° (it's "behind home looking out" rather than "behind CF
// looking in"). This gives a clear view of the whole diamond.
export const FIELD_CAM_Z = -12;        // 12m behind home plate
const FIELD_EYE_H = 8.0;                // high enough to see all 9 fielders

function projectFromField(x, y, z) {
  const zz = Math.max(0.5, z - FIELD_CAM_Z);
  return {
    sx: W / 2 + (-x) * FP_FOCAL / zz,
    sy: fpHorizonY() + (FIELD_EYE_H - y) * FP_FOCAL / zz,
    scale: FP_FOCAL / zz / 60,
  };
}

export function drawFieldView(g) {
  drawFieldSky();
  drawFieldGround();
  drawFieldDiamond();
  drawFieldHomeRunWall();
  drawFieldFoulLines();
  drawAllFielders(g);
  // Ball trajectory (faint) + ball
  if (g.hitBall) {
    drawHitBallTrail(g.hitBall);
    drawHitBall(g.hitBall);
  }
  // Batter-runner — small figure jogging up the first-base line.
  if (g.runner) drawRunner(g.runner);
}

function drawFieldSky() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#0d1a2a");
  sky.addColorStop(0.5, "#1d3858");
  sky.addColorStop(1, "#3d6a48");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
}

function drawFieldGround() {
  const horizon = fpHorizonY();
  ctx.fillStyle = "#3d6a48";
  ctx.fillRect(0, horizon, W, H - horizon);
  // Lateral grass stripes for parallax.
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  for (let z = 0; z <= 120; z += 6) {
    const left  = projectFromField(-60, 0, z);
    const right = projectFromField( 60, 0, z);
    ctx.lineWidth = Math.max(0.5, 1.4 * left.scale);
    ctx.beginPath();
    ctx.moveTo(left.sx, left.sy); ctx.lineTo(right.sx, right.sy);
    ctx.stroke();
  }
}

// Draw the infield dirt diamond + bases.
function drawFieldDiamond() {
  // Infield dirt — rough trapezoidal area around the diamond. We
  // approximate as a polygon over the bases.
  const home = projectFromField(0, 0, 0);
  const first = projectFromField(9.0, 0, 9.0);     // ~27ft along the first-base line
  const second = projectFromField(0, 0, 18.0);
  const third = projectFromField(-9.0, 0, 9.0);
  // The infield is closer to "round" than the diamond — include a few
  // points along the arc.
  ctx.fillStyle = "#a87d3e";
  ctx.beginPath();
  const arcSamples = [];
  for (let i = -90; i <= 90; i += 15) {
    const a = i * Math.PI / 180;
    const r = 25;
    const px = Math.sin(a) * r;
    const pz = Math.cos(a) * r + 5;
    arcSamples.push(projectFromField(px, 0, pz));
  }
  // Build poly: home -> arc samples -> back to home
  ctx.moveTo(home.sx, home.sy);
  for (const p of arcSamples) ctx.lineTo(p.sx, p.sy);
  ctx.closePath();
  ctx.fill();
  // Bases — small white squares at the four corners.
  for (const base of [
    { x: 9.0, z: 9.0 },        // 1B
    { x: 0, z: 18.0 },         // 2B
    { x: -9.0, z: 9.0 },       // 3B
    { x: 0, z: 0 },            // home plate
  ]) {
    const p = projectFromField(base.x, 0.05, base.z);
    const r = Math.max(3, 18 * p.scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(p.sx - r / 2, p.sy - r / 2, r, r);
  }
  // Pitcher's mound — small disc in the middle of the infield.
  const mound = projectFromField(0, 0, 18.4);
  const moundTop = projectFromField(0, 0.25, 18.4);
  const r = Math.max(4, 120 * mound.scale);
  ctx.fillStyle = "#8a6a3a";
  ctx.beginPath();
  ctx.ellipse(mound.sx, mound.sy, r, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#dcdcdc";
  ctx.fillRect(moundTop.sx - r * 0.45, moundTop.sy - 2, r * 0.9, 3);
}

function drawFieldHomeRunWall() {
  // Outfield wall — a thin arc at radius HR_WALL_R. We approximate
  // with a polyline across the fair territory.
  ctx.strokeStyle = "#3a3a4a";
  ctx.lineWidth = 4;
  ctx.beginPath();
  let first = true;
  for (let ang = -45; ang <= 45; ang += 5) {
    const a = ang * Math.PI / 180;
    const wx = Math.sin(a) * 110;
    const wz = Math.cos(a) * 110;
    const p = projectFromField(wx, 1.5, wz);
    if (first) { ctx.moveTo(p.sx, p.sy); first = false; }
    else ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
  // Sub-wall — the "padded" portion, slightly thinner.
  ctx.strokeStyle = "#5a5a6a";
  ctx.lineWidth = 2;
  ctx.beginPath();
  first = true;
  for (let ang = -45; ang <= 45; ang += 5) {
    const a = ang * Math.PI / 180;
    const wx = Math.sin(a) * 110;
    const wz = Math.cos(a) * 110;
    const p = projectFromField(wx, 0.6, wz);
    if (first) { ctx.moveTo(p.sx, p.sy); first = false; }
    else ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
}

function drawFieldFoulLines() {
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 2.5;
  for (const xz of [{ x: 78, z: 78 }, { x: -78, z: 78 }]) {
    const home = projectFromField(0, 0, 0);
    const out  = projectFromField(xz.x, 0, xz.z);
    ctx.beginPath();
    ctx.moveTo(home.sx, home.sy); ctx.lineTo(out.sx, out.sy);
    ctx.stroke();
  }
}

function drawAllFielders(g) {
  if (!g.fielders) return;
  // Render fielders back-to-front so closer ones occlude further ones.
  const sorted = g.fielders.slice().sort((a, b) => b.z - a.z);
  for (const f of sorted) drawOneFielder(f);
}

function drawOneFielder(f) {
  const p = projectFromField(f.x, 1.0, f.z);
  const head = projectFromField(f.x, 1.85, f.z);
  const r = Math.max(2, 16 * p.scale);
  // Body — same dark navy as the pitcher/catcher silhouettes.
  ctx.fillStyle = "#243454";
  ctx.beginPath();
  ctx.moveTo(p.sx - r * 0.9, p.sy);
  ctx.lineTo(p.sx + r * 0.9, p.sy);
  ctx.lineTo(p.sx + r * 0.55, head.sy + r * 0.5);
  ctx.lineTo(p.sx - r * 0.55, head.sy + r * 0.5);
  ctx.closePath();
  ctx.fill();
  // Head
  ctx.fillStyle = "#1c2540";
  ctx.beginPath();
  ctx.arc(head.sx, head.sy, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
  // Glove — tiny brown patch
  ctx.fillStyle = "#7a4a1c";
  ctx.beginPath();
  ctx.arc(p.sx + r * 0.7, p.sy - r * 0.3, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  // Position label — only readable up close, fades out at distance
  const labelA = Math.max(0, Math.min(1, p.scale * 1.5));
  if (labelA > 0.1) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 235, 130, ${labelA})`;
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(f.id, p.sx, head.sy - r * 0.9);
    ctx.textAlign = "start";
    ctx.restore();
  }
}

function drawHitBallTrail(ball) {
  if (!ball.trail || ball.trail.length < 2) return;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < ball.trail.length; i++) {
    const t = ball.trail[i];
    const p = projectFromField(t.x, t.y, t.z);
    if (i === 0) ctx.moveTo(p.sx, p.sy);
    else ctx.lineTo(p.sx, p.sy);
  }
  ctx.stroke();
}

function drawHitBall(ball) {
  const p = projectFromField(ball.x, ball.y, ball.z);
  // Distance from camera = z - FIELD_CAM_Z. Scale ball with distance,
  // capped reasonably.
  const dist = Math.max(0.5, ball.z - FIELD_CAM_Z);
  const r = Math.max(2.5, Math.min(14, BALL_R * FP_FOCAL / dist));
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
  ctx.fill();
  if (r > 3) {
    ctx.strokeStyle = "rgba(220, 50, 50, 0.85)";
    ctx.lineWidth = Math.max(0.8, r * 0.18);
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r * 0.7, -Math.PI * 0.35, Math.PI * 0.35);
    ctx.stroke();
  }
}

function drawRunner(runner) {
  const p = projectFromField(runner.x, 1.0, runner.z);
  const head = projectFromField(runner.x, 1.85, runner.z);
  const r = Math.max(2, 14 * p.scale);
  // Body — bright red so the runner pops against the navy fielders.
  ctx.fillStyle = "#d04848";
  ctx.beginPath();
  ctx.moveTo(p.sx - r * 0.9, p.sy);
  ctx.lineTo(p.sx + r * 0.9, p.sy);
  ctx.lineTo(p.sx + r * 0.55, head.sy + r * 0.5);
  ctx.lineTo(p.sx - r * 0.55, head.sy + r * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#a02828";
  ctx.beginPath();
  ctx.arc(head.sx, head.sy, r * 0.7, 0, Math.PI * 2);
  ctx.fill();
}

// Outcome banner — large center text that fades in/out during the
// resolve phase. resolvedAt is when the resolve phase started; the
// banner fades in over 0.15s and holds for the duration set on the
// runtime.
export function drawOutcomeBanner(g) {
  if (!g.outcomeText || g.phase !== "resolve") return;
  const elapsed = g.phaseT;
  // Fade in, hold, fade out — uses a 0.15 / hold / 0.25 envelope.
  const total = g.outcomeHoldT || 1.4;
  const a = elapsed < 0.15 ? (elapsed / 0.15)
          : elapsed > total - 0.25 ? Math.max(0, (total - elapsed) / 0.25)
          : 1;
  if (a <= 0) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.globalAlpha = a;
  // Drop shadow behind the headline for readability over the field.
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.font = "bold 56px ui-monospace, monospace";
  ctx.fillText(g.outcomeText, W / 2 + 3, H * 0.42 + 3);
  ctx.fillStyle = g.outcomeColor || "#fff";
  ctx.fillText(g.outcomeText, W / 2, H * 0.42);
  if (g.outcomeSub) {
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillStyle = "rgba(207, 214, 227, 0.92)";
    ctx.fillText(g.outcomeSub, W / 2, H * 0.42 + 38);
  }
  ctx.restore();
  ctx.textAlign = "start";
}

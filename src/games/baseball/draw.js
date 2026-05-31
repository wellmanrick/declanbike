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
  const r = Math.max(2, BALL_R * 1200 * p.scale);
  // White ball with red stitching hint — render as a circle with a
  // small arc to imply seams.
  ctx.fillStyle = ball.pitch.colorPrimary;
  ctx.beginPath();
  ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
  ctx.fill();
  // Seam arc
  if (r > 3) {
    ctx.strokeStyle = "rgba(220, 50, 50, 0.85)";
    ctx.lineWidth = Math.max(0.8, r * 0.18);
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, r * 0.7, -Math.PI * 0.35, Math.PI * 0.35);
    ctx.stroke();
  }
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

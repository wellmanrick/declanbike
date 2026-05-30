// First-person flick view — shared pinhole projection + flick-input
// helpers used by Field Goal, Hoops, and QB Challenge. The world is
// described in meters; the camera sits behind the holder/QB looking
// down +z.
//
//   x = lateral (0 = straight ahead)
//   y = height above the ground
//   z = depth (positive = away from camera)
//
// Anything at the camera's eye height (y = FP_CAMERA_H) projects to
// the horizon. Tall things (uprights, light towers) project above it.
// Standard pinhole, no perspective surprises.

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

// Standard flick handler. Returns { dx, dy, dist, power, lateral, upward }
// on release of a real upward swipe, otherwise null.
export function fpProcessFlick(state, kind, x, y) {
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

export function fpDrawAimArc(state, originSX, originSY, color) {
  if (!state.dragStart || !state.dragNow) return;
  const dx = state.dragNow.x - state.dragStart.x;
  const dy = state.dragNow.y - state.dragStart.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 8) return;
  const power = Math.min(1, dist / 360);
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
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(W - 130, 20, 110, 10);
  ctx.fillStyle = color || "#ffb020";
  ctx.fillRect(W - 130, 20, 110 * power, 10);
}

// Canvas + viewport. The render area fills the device viewport with
// device-pixel-ratio scaling so we draw at native resolution.
//
// W / H are CSS-pixel logical dimensions; ctx is pre-transformed by DPR
// so callers draw in CSS coordinates as if the canvas were 1:1.
//
// VW / VH are the *world* visible dimensions, scaled by WORLD_ZOOM.
// Recomputed on every resize.

export const canvas = document.getElementById("game");
export const ctx = canvas.getContext("2d");

// Mutable. Imported as live bindings.
export let W = canvas.width;
export let H = canvas.height;
export let DPR = window.devicePixelRatio || 1;

export const WORLD_ZOOM = 1.55;
export let VW = (W || 0) / WORLD_ZOOM;
export let VH = (H || 0) / WORLD_ZOOM;

// Recompute the world viewport. Defaults to WORLD_ZOOM so resize at boot
// works; the per-frame render path passes its dynamic camera zoom so the
// camera follow + parallax stays correct.
export function updateViewport(zoom) {
  const z = zoom == null ? WORLD_ZOOM : zoom;
  VW = W / z;
  VH = H / z;
}

export function resizeCanvas() {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  DPR = window.devicePixelRatio || 1;
  W = cw; H = ch;
  canvas.width  = Math.round(cw * DPR);
  canvas.height = Math.round(ch * DPR);
  canvas.style.width  = cw + "px";
  canvas.style.height = ch + "px";
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  updateViewport();
  const app = document.getElementById("app");
  if (app) { app.style.width = cw + "px"; app.style.height = ch + "px"; }
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
resizeCanvas();

// Common math helpers shared by everyone.
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function wrapAngle(a) {
  while (a > Math.PI)  a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

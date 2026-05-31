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

// Aspect-adaptive base zoom. Landscape (~16:9) keeps the original 1.55;
// tall portrait phones (~9:19.5) zoom out so the player sees more terrain
// ahead. Floored at 0.95 so the bike never feels lost in the frame.
export function baseZoomForAspect(w, h) {
  if (!w || !h) return 1.55;
  const a = w / h;
  if (a >= 1.6) return 1.55;
  if (a >= 1.0) return 1.55 - (1.6 - a) * 0.5;
  return Math.max(0.95, 1.10 - (1.0 - a) * 0.30);
}

export let WORLD_ZOOM = baseZoomForAspect(W, H);
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
  WORLD_ZOOM = baseZoomForAspect(W, H);
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

// Tween curves. Takes a 0..1 progress value, returns a 0..1 curve value.
// Use to make a linear countdown FEEL like a release — applied at the
// site that converts time/max into a render parameter (radius, alpha,
// scale). Pure, deterministic, no allocation. `easeOutBack` can briefly
// exceed 1; safe for radius/scale, clamp before using as alpha.
export function ease(t, fn) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  switch (fn) {
    case "linear":       return t;
    case "smoothstep":   return t * t * (3 - 2 * t);
    case "easeOutCubic": return 1 - Math.pow(1 - t, 3);
    case "easeOutQuad":  return 1 - (1 - t) * (1 - t);
    case "easeOutQuint": return 1 - Math.pow(1 - t, 5);
    case "easeOutBack":  return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
    case "easeOutElastic": {
      const c4 = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    case "easeInOutQuad": return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    default:             return t * t * (3 - 2 * t); // smoothstep default
  }
}
export function wrapAngle(a) {
  while (a > Math.PI)  a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

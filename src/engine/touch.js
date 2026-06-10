// Mobile touch polish — haptics + visual press feedback + tap-vs-drag
// forgiveness. Shared across all mini-games + the main shell so every
// interactive surface feels the same.
//
// HAPTICS
//   haptic(kind) plays a named vibration pattern through navigator.vibrate.
//   Silent no-op on iOS Safari (no Vibration API) and when the player has
//   turned haptics off via save.prefs.haptics. The set of named kinds
//   covers the events the rest of the codebase actually cares about; one-
//   off patterns can be passed as a number/array directly.
//
// PRESS FEEDBACK
//   Each interactive rect tapped fires registerPressFx(rect, color) which
//   logs a fading scale-down + glow effect. drawPressFx() should be
//   called near the end of each frame so the effects overlay the UI
//   they came from. Effects auto-expire after 220ms; the list is short
//   and the per-frame allocation is one push + one prune.
//
// TAP-VS-DRAG FORGIVENESS
//   isTap(down, up) returns true if the gesture stayed within ~6px and
//   under 350ms — the threshold used by every meaningful tap target in
//   the canvas UI. Without this, a small thumb movement during a chip
//   tap or game-over button press would be misclassified as a drag and
//   the action would silently fail.

import { ctx } from "./canvas.js";
import { save } from "./save.js";

// ──────────────────────────────────────────────────────────────────────
// HAPTICS
// ──────────────────────────────────────────────────────────────────────
const HAPTIC_PATTERNS = {
  // A crisp single tick — chips, taps, button presses. Short enough to
  // feel like a piezo click rather than a buzz.
  tap:      10,
  // Slightly heavier — release / commit / fire-the-pitch.
  click:    18,
  // Double-pulse for state transitions (e.g. chip armed, ball received
  // by catcher).
  double:   [10, 40, 10],
  // Ascending triple — "you did the good thing" (HR contact, perfect
  // landing, made FG).
  success:  [10, 40, 20, 40, 40],
  // Long-short — failure / strikeout / miss / sack.
  fail:     [40, 30, 40],
  // Heavy single — big impact (HR contact, crash).
  heavy:    50,
};
export function haptic(kind) {
  if (!save || !save.prefs || save.prefs.haptics === false) return;
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  const pattern = typeof kind === "string"
    ? HAPTIC_PATTERNS[kind]
    : kind;
  if (pattern == null) return;
  try { navigator.vibrate(pattern); } catch (_) { /* iOS Safari throws sometimes */ }
}

// ──────────────────────────────────────────────────────────────────────
// PRESS FEEDBACK — fading overlay on a tapped rect
// ──────────────────────────────────────────────────────────────────────
const PRESS_DUR_MS = 220;
const _pressFx = [];

// Register a press feedback effect at the given canvas rect. `color`
// defaults to a soft white glow; pass a brand-specific gold/blue/etc.
// for chip selection.
export function registerPressFx(rect, color) {
  if (!rect) return;
  _pressFx.push({
    x: rect.x, y: rect.y, w: rect.w, h: rect.h,
    color: color || "rgba(255, 255, 255, 0.55)",
    start: performance.now(),
  });
  // Cap the list to prevent runaway memory if a frame dropped a click
  // event without rendering.
  if (_pressFx.length > 8) _pressFx.shift();
}

// Call once per frame after the UI is drawn. Renders the press effects
// over their source rect and prunes expired entries.
export function drawPressFx() {
  if (_pressFx.length === 0) return;
  const now = performance.now();
  for (let i = _pressFx.length - 1; i >= 0; i--) {
    const fx = _pressFx[i];
    const t = (now - fx.start) / PRESS_DUR_MS;
    if (t >= 1) { _pressFx.splice(i, 1); continue; }
    const a = 1 - t;
    // A subtle expanding glow + ring around the rect. The expansion
    // (3-6px) reads as "press registered" without obscuring what's
    // underneath.
    const expand = t * 6;
    ctx.save();
    ctx.strokeStyle = fx.color.replace(/[\d.]+\)$/, `${a * 0.85})`);
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(
        fx.x - expand, fx.y - expand,
        fx.w + expand * 2, fx.h + expand * 2,
        10
      );
    } else {
      ctx.rect(
        fx.x - expand, fx.y - expand,
        fx.w + expand * 2, fx.h + expand * 2
      );
    }
    ctx.stroke();
    // Faint inner fill so the pressed surface flashes.
    ctx.fillStyle = fx.color.replace(/[\d.]+\)$/, `${a * 0.12})`);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(fx.x, fx.y, fx.w, fx.h, 10);
    else ctx.rect(fx.x, fx.y, fx.w, fx.h);
    ctx.fill();
    ctx.restore();
  }
}

// ──────────────────────────────────────────────────────────────────────
// TAP-VS-DRAG FORGIVENESS
// ──────────────────────────────────────────────────────────────────────
const TAP_MAX_PX = 8;
const TAP_MAX_MS = 350;

// `down` and `up` are { x, y, t? } records. If `t` isn't given the
// caller is asking about the spatial component only.
export function isTap(down, up) {
  if (!down || !up) return false;
  const dx = up.x - down.x;
  const dy = up.y - down.y;
  if (dx * dx + dy * dy > TAP_MAX_PX * TAP_MAX_PX) return false;
  if (typeof down.t === "number" && typeof up.t === "number") {
    if (up.t - down.t > TAP_MAX_MS) return false;
  }
  return true;
}

// Convenience: hit-test a rect on canvas (x, y) coords.
export function hitRect(rect, x, y) {
  if (!rect) return false;
  return x >= rect.x && x <= rect.x + rect.w
      && y >= rect.y && y <= rect.y + rect.h;
}

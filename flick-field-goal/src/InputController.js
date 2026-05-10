// InputController — touch/mouse drag → kick parameters.
//
// Gesture model (mobile-first):
//   - touchstart: record start point, time. No kick yet.
//   - touchmove:  push (x, y, t) into history. Update power meter UI.
//   - touchend:   compute drag vector (start → release), curve from
//                 the deviation of the gesture path from a straight
//                 line, and finger speed (last ~120ms of motion).
//                 Convert to kick params and call game.fire(...).
//
// Kick params produced:
//   vx, vy, vz — initial velocity in world space
//   spin       — −1..+1 lateral spin (for Magnus-like curve)
//
// Aim:  drag direction angle relative to vertical → yaw (left/right)
// Power: drag length, capped + lerped
// Pitch: drag length also influences launch pitch via LevelManager
//        (longer kicks need higher launch).
//
// Curve is detected by comparing the dot of the gesture's mid-leg
// against the start→end vector. A bowed gesture (path curves left or
// right of the straight line) yields lateral spin.

const POWER_PIXELS_FULL = 540;       // drag length at full power
const MIN_POWER = 0.20;              // minimum power once a flick fires
const MAX_YAW = Math.PI / 6;         // ±30°

export class InputController {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    this.armed = false;
    this.dragging = false;
    this._reset();
    canvas.addEventListener("pointerdown", (e) => this._down(e), { passive: false });
    canvas.addEventListener("pointermove", (e) => this._move(e), { passive: false });
    canvas.addEventListener("pointerup",   (e) => this._up(e),   { passive: false });
    canvas.addEventListener("pointercancel",(e) => this._up(e),  { passive: false });
  }

  _reset() {
    this.history = [];
    this.start = null;
  }

  armForKick() { this.armed = true; this._reset(); }

  // Per-frame UI hook — currently just a no-op; kept so Game can poll.
  update(_game) { /* room for future aim-arrow rendering */ }

  _down(e) {
    if (!this.armed) return;
    e.preventDefault();
    this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
    this.dragging = true;
    const now = performance.now();
    this.start = { x: e.clientX, y: e.clientY, t: now };
    this.history = [{ x: e.clientX, y: e.clientY, t: now }];
    this.game.audio.ensure();
    this.game.ui.showPower(0);
  }

  _move(e) {
    if (!this.dragging) return;
    e.preventDefault();
    const now = performance.now();
    this.history.push({ x: e.clientX, y: e.clientY, t: now });
    // Trim history to last 250ms so finger-speed reading stays current.
    const cutoff = now - 250;
    while (this.history.length > 0 && this.history[0].t < cutoff) this.history.shift();
    // Update the power meter from drag length.
    const dx = e.clientX - this.start.x;
    const dy = e.clientY - this.start.y;
    const len = Math.hypot(dx, dy);
    const power = Math.min(1, Math.max(MIN_POWER, len / POWER_PIXELS_FULL));
    this.game.ui.showPower(power);
  }

  _up(e) {
    if (!this.dragging) return;
    e.preventDefault();
    this.dragging = false;
    if (!this.start) return;
    const dx = e.clientX - this.start.x;
    const dy = e.clientY - this.start.y;
    const len = Math.hypot(dx, dy);
    // Reject tiny taps.
    if (len < 40 || dy >= 0) {
      this.game.ui.hidePower();
      return;
    }
    const power = Math.min(1, Math.max(MIN_POWER, len / POWER_PIXELS_FULL));
    // Yaw: angle of the drag vector from vertical (-Y), clamped.
    const angle = Math.atan2(dx, -dy);  // 0 = straight up; +π/2 = right
    const yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, angle));
    // Curve: how much the mid-leg of the gesture deviated laterally
    // from the straight start→end line. Positive = bowed right →
    // spin curves the ball back to the left (Magnus); negative → opposite.
    const curve = this._extractCurve(this.history);
    // Hand off to LevelManager → Game to translate (power, yaw, curve)
    // into world-space initial velocity (which depends on the level's
    // distance and pitch settings).
    const params = this.game.level.computeKick(power, yaw, curve);
    this.armed = false;
    this.start = null;
    this.history = [];
    this.game.fire(params);
  }

  _extractCurve(hist) {
    if (hist.length < 4) return 0;
    const a = hist[0], b = hist[hist.length - 1];
    const ax = a.x, ay = a.y, bx = b.x, by = b.y;
    const ex = bx - ax, ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    // Sum signed perpendicular distance for each mid-point relative to
    // the start→end line. Positive = points are on the right side.
    let signedSum = 0;
    for (let i = 1; i < hist.length - 1; i++) {
      const p = hist[i];
      const px = p.x - ax, py = p.y - ay;
      // 2D cross / |line|
      const perp = (ex * py - ey * px) / len;
      signedSum += perp;
    }
    // Normalize so a tightly bowed gesture produces ~1, near-straight ~0.
    const avg = signedSum / Math.max(1, hist.length - 2);
    const curve = Math.max(-1, Math.min(1, avg / 24));
    return curve;
  }
}

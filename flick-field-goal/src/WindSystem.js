// WindSystem — lateral wind acceleration, randomized per kick.
//
// State:
//   x: +X (right) / -X (left) wind acceleration (m/s²)
//   z: usually 0; reserved for tail/headwind in later modes
//   speed (mph): for HUD display only — derived from x/z magnitude
//
// helped(drift): heuristic that returns true when the wind helped the
// player nail a difficult kick (e.g., wind was blowing toward where
// the ball ended up). ScoreSystem uses this for the wind bonus.

const MAX_X_ACCEL = 4.0;   // m/s² at the max-wind challenge cap
const MPH_PER_MS2 = 6;     // rough scaling for HUD readout

export class WindSystem {
  constructor() {
    this.x = 0;
    this.z = 0;
    this.targetX = 0;
    this.targetZ = 0;
  }

  randomize(cap) {
    // cap is 0..1 (level difficulty). 0 = calm; 1 = full wind challenge.
    const a = (Math.random() - 0.5) * 2 * MAX_X_ACCEL * cap;
    this.targetX = a;
    this.targetZ = 0;
    this.x = a; this.z = 0;
  }

  update(dt) {
    // Smooth slow drift toward target so the wind doesn't snap mid-flight.
    this.x += (this.targetX - this.x) * Math.min(1, dt * 0.5);
    this.z += (this.targetZ - this.z) * Math.min(1, dt * 0.5);
  }

  // For HUD: speed in mph and direction in degrees (0 = right, 90 = up).
  speedMph() {
    return Math.round(Math.hypot(this.x, this.z) * MPH_PER_MS2);
  }
  // Returns -1..+1: -1 strong-left, +1 strong-right.
  lateralBias() {
    return Math.max(-1, Math.min(1, this.x / MAX_X_ACCEL));
  }

  // Did the wind blow the ball toward the goal center? Caller passes
  // the ball's lateral drift at the moment it crossed the plane.
  helped(drift) {
    // If drift sign matches wind sign and the wind was at least 1.5 m/s²,
    // we say it helped (ball drifted along the wind direction).
    if (Math.abs(this.x) < 1.5) return false;
    return Math.sign(drift) === Math.sign(this.x) && Math.abs(drift) > 0.4;
  }
}

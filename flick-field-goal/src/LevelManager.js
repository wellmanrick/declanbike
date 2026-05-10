// LevelManager — owns the per-mode session: distance, ball count,
// wind cap, kicking-angle offset, uprights width, and the
// (power, yaw, curve) → world-space velocity translation.
//
// The translation lives here (rather than in InputController) because
// the relationship between drag inputs and world velocity depends on
// the current distance and angle — short kicks need less power and a
// shallower launch than long kicks.
//
// Modes:
//   classic — 3 balls, distance grows on each make.
//   timed   — 60-second clock, infinite balls, chase score.
//   sudden  — first miss ends.
//   wind    — windy from kick 1, three-strikes-out.

const PITCH_BASE = 36 * Math.PI / 180;     // 36° base launch pitch
const PITCH_LONG = 44 * Math.PI / 180;     // pitch at 50+ yards
const POWER_FLOOR_VEL = 18;                // m/s at 0% power
const POWER_RANGE_VEL = 18;                // adds up to +18 m/s at full power

export class LevelManager {
  constructor() {
    this.mode = "classic";
    this.distance = 20;            // yards (= world units)
    this.uprightsWidth = 1.83;     // half-width
    this.windCap = 0.0;            // 0..1 → WindSystem.randomize(cap)
    this.ballsLeft = 3;
    this.kickAngleOffset = 0;      // adds yaw bias on long kicks
  }

  startMode(mode) {
    this.mode = mode;
    this.distance = 20;
    this.uprightsWidth = 1.83;
    this.windCap = (mode === "wind") ? 0.7 : 0.0;
    this.kickAngleOffset = 0;
    if (mode === "timed") this.ballsLeft = 99;            // effectively infinite; clock limits
    else if (mode === "sudden") this.ballsLeft = 99;      // ditto; missing ends
    else if (mode === "wind") this.ballsLeft = 99;
    else this.ballsLeft = 3;                              // classic
  }

  // Called after each made kick. Distance up; wind kicks in around 35;
  // angle offset around 45; uprights shrink slightly past 60.
  advance() {
    this.distance += 5;
    if (this.distance >= 35) this.windCap = Math.max(this.windCap, 0.4 + (this.distance - 35) * 0.02);
    if (this.distance >= 45) this.kickAngleOffset = (this.distance - 45) * 0.005;
    if (this.distance >= 60) this.uprightsWidth = Math.max(1.30, 1.83 - (this.distance - 60) * 0.03);
    // Classic: regain 1 ball per made kick so the run can continue.
    if (this.mode === "classic") this.ballsLeft = Math.min(3, this.ballsLeft + 1);
  }

  consumeBall() { this.ballsLeft = Math.max(0, this.ballsLeft - 1); }

  // power: 0..1, yaw: radians (-π/6..+π/6), curve: -1..+1
  // Returns initial { vx, vy, vz, spin } for BallPhysics.fire.
  computeKick(power, yaw, curve) {
    // Speed scales with power; floor ensures even soft kicks reach 25-30 yards.
    // Distance bias: longer goals = slightly more starting speed so the
    // player isn't fighting power for every long kick.
    const distBoost = Math.max(0, (this.distance - 30) * 0.25);
    const speed = POWER_FLOOR_VEL + power * POWER_RANGE_VEL + distBoost;
    // Pitch — flatter on short kicks, higher on long ones.
    const t = Math.max(0, Math.min(1, (this.distance - 20) / 30));
    const pitch = PITCH_BASE + (PITCH_LONG - PITCH_BASE) * t;
    const totalYaw = yaw + this.kickAngleOffset;
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    const cosY = Math.cos(totalYaw), sinY = Math.sin(totalYaw);
    return {
      vx: speed * cosP * sinY,
      vy: speed * sinP,
      vz: speed * cosP * cosY,
      spin: curve,
    };
  }
}

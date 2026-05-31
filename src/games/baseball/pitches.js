// Pitch catalog + ball-flight physics.
//
// Distances are in meters. The pitcher's mound rubber sits at z=0
// (camera origin in pitcher view), home plate sits at z=PLATE_Z. The
// ball's vy is +up; gravity pulls vy negative. Magnus break is modeled
// as a constant per-axis acceleration applied for the duration of
// flight — not physically accurate (real Magnus depends on spin axis
// + speed) but it produces the right gameplay feel: curveballs drop,
// sliders sweep, changeups float a little, fastballs hold their line.
//
// Ball travel time ≈ 18.4 / vz0 seconds. A 92 mph fastball (~41 m/s)
// reaches the plate in ~0.45s; a 78 mph curve (~35 m/s) takes ~0.52s.

export const PLATE_Z   = 18.4;     // 60'6" — pitcher's rubber to plate
export const BALL_RELEASE_Y = 1.95; // pitcher's release point above the rubber
export const PLATE_TOP   = 1.04;    // top of MLB strike zone (~mid-chest)
export const PLATE_BOTTOM = 0.50;   // bottom of MLB strike zone (~knees)
export const PLATE_HALF_W = 0.215;  // half-width of home plate (17 in)
export const BALL_R = 0.037;        // 73mm baseball

// 1 mph in m/s
const MPH = 0.44704;

// Pitch types — `name` is the display label, `vMph` is the release
// speed, `breakX` and `breakY` are constant lateral / vertical
// accelerations in m/s² applied during flight (negative breakY = drop).
// `colorPrimary` and `colorTrail` drive the ball-trail rendering so
// the pitch type is visually distinguishable mid-flight.
export const PITCH_TYPES = [
  {
    id: "fastball", name: "Fastball", short: "FB",
    vMph: 92, breakX: 0, breakY: 0,
    colorPrimary: "#ffffff",
    colorTrail:   "rgba(255, 255, 255, 0.45)",
    desc: "Straight gas",
  },
  {
    id: "curveball", name: "Curveball", short: "CB",
    vMph: 78, breakX: 0, breakY: -12,
    colorPrimary: "#9fe8ff",
    colorTrail:   "rgba(110, 200, 255, 0.45)",
    desc: "Big drop",
  },
  {
    id: "slider", name: "Slider", short: "SL",
    vMph: 84, breakX: 6, breakY: -4,
    colorPrimary: "#d9a1ff",
    colorTrail:   "rgba(177, 130, 255, 0.45)",
    desc: "Sweeps across",
  },
  {
    id: "changeup", name: "Changeup", short: "CH",
    vMph: 80, breakX: 0, breakY: -3,
    colorPrimary: "#ffd07a",
    colorTrail:   "rgba(255, 200, 110, 0.45)",
    desc: "Disguised fastball",
  },
];

export function pitchById(id) {
  return PITCH_TYPES.find((p) => p.id === id) || PITCH_TYPES[0];
}

// Create a ball record. `aimX` / `aimY` are world coords at the plate
// the pitcher is aiming for (handed-frame: x=0 is dead center, y is
// height in meters). The release vector is computed so a Newtonian-
// integrated flight (with gravity + the pitch's break accel applied
// each step) hits roughly that target. For Phase 2 we use a closed-form
// approximation that ignores break-during-flight, then let the integrator
// finish the trajectory honestly — the result is close enough that the
// crosshair is meaningful but the ball still moves with the pitch's
// break, so the player can mentally compensate the same way real
// hitters do.
export function buildPitch(pitch, aimX, aimY) {
  const v   = pitch.vMph * MPH;             // total release speed (m/s)
  // Time of flight to the plate assuming straight-line travel — we
  // honor this for the initial vz, then resolve gravity + break by
  // adjusting vy at release so the ball reaches the aim point even
  // accounting for the half-tof drop from gravity.
  const tof = PLATE_Z / v;
  const dy  = aimY - BALL_RELEASE_Y;
  const dx  = aimX;
  // Gravity & break drop both pull the ball down by 0.5*a*t² over the
  // flight; pre-cancel that so the aim feels honest.
  const gravityDrop = 0.5 * 9.81 * tof * tof;
  const breakDropY  = 0.5 * pitch.breakY * tof * tof;
  const breakDropX  = 0.5 * pitch.breakX * tof * tof;
  return {
    pitchId: pitch.id,
    pitch,                                  // back-reference to the catalog entry
    x: 0, y: BALL_RELEASE_Y, z: 0,          // current position (m)
    vx: (dx - breakDropX) / tof,            // launch velocity (m/s)
    vy: (dy + gravityDrop - breakDropY) / tof,
    vz: v,                                  // assume all forward velocity (close enough)
    // Aim record — what the pitcher SAID they were going for. The
    // contact-quality code in Phase 3 reads ball.x / ball.y at the
    // plate plane to compare with the batter's swing point; aim* is
    // here mostly for diagnostics + showing a debug crosshair.
    aimX, aimY,
    // Phase flags used by the at-bat state machine.
    landedAtPlate: false,
    plateX: 0, plateY: 0,                   // populated when z crosses PLATE_Z
    age: 0,                                 // seconds since release (for trails)
    trail: [],                              // recent positions for the trail render
  };
}

// Single integration step. dt in seconds. Returns true if the ball has
// just crossed the plate plane (caller can read ball.plateX / plateY).
export function stepPitch(ball, dt) {
  if (ball.landedAtPlate) return false;
  ball.age += dt;
  // Apply break + gravity for the duration of the step. We approximate
  // as semi-implicit Euler — accurate enough at these speeds, no need
  // for RK4.
  ball.vy += (-9.81 + ball.pitch.breakY) * dt;
  ball.vx += ball.pitch.breakX * dt;
  // (vz is unchanged — air drag is folded into the initial vMph.)
  const prevZ = ball.z;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.z += ball.vz * dt;
  // Trail sample — every ~3 frames is fine.
  if ((ball.trail.length === 0) || (ball.age - (ball.trail[ball.trail.length - 1].t || 0)) > 0.02) {
    ball.trail.push({ x: ball.x, y: ball.y, z: ball.z, t: ball.age });
    if (ball.trail.length > 18) ball.trail.shift();
  }
  // Plate-crossing detection — interpolate so we get an accurate plate
  // (x, y) instead of an oversized step's worth of error.
  if (prevZ < PLATE_Z && ball.z >= PLATE_Z) {
    const t = (PLATE_Z - prevZ) / (ball.z - prevZ);
    ball.plateX = ball.x - ball.vx * dt * (1 - t);
    ball.plateY = ball.y - ball.vy * dt * (1 - t);
    ball.landedAtPlate = true;
    return true;
  }
  return false;
}

// Strike zone classification at the plate plane.
export function isStrike(plateX, plateY) {
  return Math.abs(plateX) <= PLATE_HALF_W
      && plateY >= PLATE_BOTTOM
      && plateY <= PLATE_TOP;
}

// ──────────────────────────────────────────────────────────────────────
// HIT BALL — physics after contact. Produces a trajectory the fielder
// AI + the renderer both walk through. Sampled at ~30hz so fielders
// can plan ahead without having to integrate themselves.
// ──────────────────────────────────────────────────────────────────────
const HIT_DT = 1 / 30;
const HIT_MAX_T = 8.0;
const HIT_AIR_DRAG = 0.06;       // light drag; tuned so HRs are possible

// Build a hit-ball record + pre-computed trajectory. exitVelMps is the
// speed off the bat, launchAngle is degrees above horizontal,
// sprayAngle is degrees relative to dead center field (+ = pull side
// for a right-handed batter = toward 3B/LF). Stored on the runtime
// during the "field" phase.
export function buildHitBall(exitVelMps, launchAngle, sprayAngle) {
  const launchRad = launchAngle * Math.PI / 180;
  const sprayRad  = sprayAngle * Math.PI / 180;
  const v = exitVelMps;
  // Translate spray into x/z components of the horizontal velocity.
  const vh = v * Math.cos(launchRad);
  const vx = vh * Math.sin(sprayRad);
  const vz = vh * Math.cos(sprayRad);
  const vy = v * Math.sin(launchRad);
  const ball = {
    // Start at home plate, contact height ~1m.
    x: 0, y: 1.0, z: 0,
    vx, vy, vz,
    age: 0,
    landed: false,
    trail: [],
    trajectory: [],
  };
  // Pre-compute the trajectory so fielder AI doesn't have to redo this
  // every frame. Each sample is {x, y, z, t}; we stop when the ball
  // hits the ground or leaves the field.
  let bx = ball.x, by = ball.y, bz = ball.z;
  let bvx = ball.vx, bvy = ball.vy, bvz = ball.vz;
  let bt = 0;
  ball.trajectory.push({ x: bx, y: by, z: bz, t: 0 });
  while (bt < HIT_MAX_T) {
    // Air drag — opposes motion. dv = -drag * v * dt.
    const speed = Math.hypot(bvx, bvy, bvz);
    const dragScale = 1 - HIT_AIR_DRAG * speed * HIT_DT * 0.0015;
    bvx *= dragScale; bvy *= dragScale; bvz *= dragScale;
    bvy -= 9.81 * HIT_DT;
    bx += bvx * HIT_DT;
    by += bvy * HIT_DT;
    bz += bvz * HIT_DT;
    bt += HIT_DT;
    if (by <= 0) {
      // Bounce / rolls — for fielder planning we cap at the landing
      // point. Phase 4 doesn't simulate the bounce; the fielder picks
      // up the ball where it landed.
      by = 0;
      ball.trajectory.push({ x: bx, y: by, z: bz, t: bt });
      break;
    }
    ball.trajectory.push({ x: bx, y: by, z: bz, t: bt });
    // Past the foul wall? Cap the trajectory.
    if (Math.hypot(bx, bz) > 130 || bz < -5) break;
  }
  return ball;
}

// Step a hit ball forward in time for the renderer. Mirrors the
// integrator used to build the trajectory so the rendered ball matches
// the AI plan exactly. Returns true when the ball lands.
export function stepHitBall(ball, dt) {
  if (ball.landed) return true;
  ball.age += dt;
  // Find the trajectory sample we're at right now by age.
  const traj = ball.trajectory;
  let lo = 0, hi = traj.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (traj[mid].t < ball.age) lo = mid; else hi = mid;
  }
  const a = traj[lo], b = traj[hi];
  const span = b.t - a.t || 1;
  const tt = Math.min(1, Math.max(0, (ball.age - a.t) / span));
  ball.x = a.x + (b.x - a.x) * tt;
  ball.y = a.y + (b.y - a.y) * tt;
  ball.z = a.z + (b.z - a.z) * tt;
  // Trail sample
  if (ball.trail.length === 0 || (ball.age - ball.trail[ball.trail.length - 1].t) > 0.04) {
    ball.trail.push({ x: ball.x, y: ball.y, z: ball.z, t: ball.age });
    if (ball.trail.length > 30) ball.trail.shift();
  }
  if (ball.age >= traj[traj.length - 1].t) {
    ball.landed = true;
    return true;
  }
  return false;
}

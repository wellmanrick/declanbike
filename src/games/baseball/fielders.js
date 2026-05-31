// Fielders — positions, catch/throw logic, hit-type classification.
//
// World frame matches pitches.js: home plate at (0, 0) on the ground,
// pitcher's mound at (0, 18.4). Positive z is "out to center field" —
// outfield is further away from the camera. Positive x is "to the
// pitcher's right" (right field side). Lateral foul lines are at
// |x| / z = tan(45°/2) ≈ 0.414 (fair territory is the wedge between).

// Default home positions for each defender. z values are tuned so the
// outfielders sit a comfortable distance back from the infield without
// crowding the home-run wall.
export const FIELDER_HOME = [
  { id: "P",  name: "Pitcher",  x:  0,    z:  18.4, role: "infield" },
  { id: "C",  name: "Catcher",  x:  0,    z:  -0.3, role: "catcher" },
  { id: "1B", name: "First",    x:  9.0,  z:  27,   role: "infield" },
  { id: "2B", name: "Second",   x:  4.5,  z:  32,   role: "infield" },
  { id: "SS", name: "Short",    x: -4.5,  z:  32,   role: "infield" },
  { id: "3B", name: "Third",    x: -9.0,  z:  27,   role: "infield" },
  { id: "LF", name: "Left",     x: -22,   z:  72,   role: "outfield" },
  { id: "CF", name: "Center",   x:  0,    z:  88,   role: "outfield" },
  { id: "RF", name: "Right",    x:  22,   z:  72,   role: "outfield" },
];

// Run / throw speeds (m/s). MLB fielders cover ~7 m/s sprinting; throws
// average ~30 m/s. We're playing fast and loose for game feel.
export const FIELDER_RUN_SPEED  = 7.5;
export const THROW_SPEED_MPS    = 30;
// Batter-runner sprint speed — slightly slower than fielders to give
// them a chance on the bang-bang plays.
export const BATTER_RUN_SPEED   = 7.0;
// Home-run wall radius (meters from home plate). Beyond this, the ball
// is over the wall and the batter circles the bases.
export const HR_WALL_R          = 110;

// Build the per-game fielders array from the home positions.
export function buildFielders() {
  return FIELDER_HOME.map((f) => ({
    id: f.id, name: f.name, role: f.role,
    homeX: f.x, homeZ: f.z,
    x: f.x, z: f.z,
    targetX: f.x, targetZ: f.z,
    state: "idle",        // "idle" | "chasing" | "fielding" | "throwing" | "returning"
    holdingBall: false,
  }));
}

// Reset fielders to their home positions at the start of a new at-bat.
export function resetFielders(fielders) {
  for (const f of fielders) {
    f.x = f.homeX; f.z = f.homeZ;
    f.targetX = f.homeX; f.targetZ = f.homeZ;
    f.state = "idle";
    f.holdingBall = false;
  }
}

// Find the fielder best-positioned to make the play on a ball whose
// trajectory we've pre-computed. Returns:
//   { fielder, canCatchAir, interceptX, interceptZ, interceptT }
// `canCatchAir` is true if the fielder reaches the ball while it's
// still in the air (a flyout / lineout). Otherwise the fielder reaches
// the landing point shortly after the ball lands (a grounder play).
export function chooseFielder(fielders, traj) {
  // For each fielder, find the earliest point on the trajectory they
  // could conceivably reach (where (distance / RUN_SPEED) <= t). Score
  // candidates by how comfortably they reach the ball.
  let bestFielder = null;
  let bestScore = -Infinity;
  let bestPoint = null;
  for (const f of fielders) {
    // Skip the catcher for batted balls — they don't field anything
    // outside foul territory.
    if (f.id === "C") continue;
    const pick = findFielderIntercept(f, traj);
    if (!pick) continue;
    // Score: prefer earlier intercepts AND a fielder whose home zone
    // is closer to the landing point (so we don't have a left fielder
    // sprinting across right field for a routine ball).
    const homeBias = -Math.hypot(f.homeX - pick.x, f.homeZ - pick.z) * 0.10;
    const earlyBias = -pick.t * 0.4;
    const score = homeBias + earlyBias + (pick.air ? 1.0 : 0);
    if (score > bestScore) {
      bestScore = score;
      bestFielder = f;
      bestPoint = pick;
    }
  }
  if (!bestFielder) return null;
  return {
    fielder: bestFielder,
    canCatchAir: bestPoint.air,
    interceptX: bestPoint.x,
    interceptZ: bestPoint.z,
    interceptT: bestPoint.t,
  };
}

// Walk the pre-computed trajectory sampling for an intercept point this
// fielder can reach. Returns the EARLIEST reach: in-air if possible,
// otherwise the post-bounce landing point.
function findFielderIntercept(fielder, traj) {
  for (let i = 0; i < traj.length; i++) {
    const s = traj[i];
    const dist = Math.hypot(s.x - fielder.x, s.z - fielder.z);
    const timeToReach = dist / FIELDER_RUN_SPEED;
    if (timeToReach <= s.t && s.y <= 2.4) {
      // 2.4m is roughly a max glove height including jump — generous
      // but not absurd. Above that the ball is over their head.
      return { x: s.x, z: s.z, t: s.t, air: s.y > 0.10 };
    }
  }
  // Couldn't catch the ball in the air. Try to reach the landing point
  // (or the last sample if it's gone over the wall / past the field).
  const last = traj[traj.length - 1];
  const dist = Math.hypot(last.x - fielder.x, last.z - fielder.z);
  const timeToReach = dist / FIELDER_RUN_SPEED;
  return { x: last.x, z: last.z, t: Math.max(last.t, timeToReach), air: false };
}

// Classify a hit's outcome from the fielder play. `intercept` is the
// result of chooseFielder; `traj` is the full trajectory; `lateral`
// is the lateral distance the ball cleared the infield (used to decide
// whether a grounder is a single or a double).
export function classifyHit(intercept, traj, batterArrival) {
  const last = traj[traj.length - 1];
  // Home run — ball went over the wall.
  if (Math.hypot(last.x, last.z) > HR_WALL_R && last.y > 0) {
    // Last sample is past the wall while still airborne; the wall
    // sampling capped at HR_WALL_R, so we treat the ball as gone.
    return { kind: "home-run", bases: 4, label: "HOME RUN!" };
  }
  // Caught in the air → flyout / lineout / popout.
  if (intercept && intercept.canCatchAir) {
    const flyHeight = traj.find((s) => s.t >= intercept.interceptT)?.y || 0;
    const isLow = flyHeight < 0.8;
    return { kind: "out", bases: 0, label: isLow ? "Lineout" : "Flyout" };
  }
  // Ground / past-the-infield play. Did the batter beat the throw?
  // throwToFirstTime = how long it takes the fielder to throw to 1B
  // after they reach the ball.
  if (!intercept) {
    return { kind: "double", bases: 2, label: "Off the wall!" };
  }
  const throwToFirst = throwTimeFromTo(intercept.interceptX, intercept.interceptZ, 9, 27);
  const totalDefenseTime = intercept.interceptT + 0.20 + throwToFirst;
  const beatTheThrow = batterArrival < totalDefenseTime;

  // Distance from home plate to the landing point — longer = more
  // bases possible if the ball gets past defenders.
  const reach = Math.hypot(last.x, last.z);
  if (reach > 75 && beatTheThrow) {
    // Way out in the outfield gap, batter cruises into a double.
    return { kind: "double", bases: 2, label: "DOUBLE" };
  }
  if (reach > 95 && beatTheThrow) {
    return { kind: "triple", bases: 3, label: "TRIPLE" };
  }
  if (beatTheThrow) {
    return { kind: "single", bases: 1, label: "SINGLE" };
  }
  return { kind: "out", bases: 0, label: "Groundout" };
}

function throwTimeFromTo(fromX, fromZ, toX, toZ) {
  const dist = Math.hypot(toX - fromX, toZ - fromZ);
  return dist / THROW_SPEED_MPS;
}

// Compute when the batter-runner would reach a given base if running
// at full speed from home plate. base 1B is ~27m from home, 2B ~54m,
// etc. (Diamond bases are 90 feet = ~27.4m apart.)
export const BASE_PATH_DIST = 27.4;
export function batterArrivalAtBase(baseIdx) {
  return (baseIdx * BASE_PATH_DIST) / BATTER_RUN_SPEED;
}

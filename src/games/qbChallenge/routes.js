// @ts-nocheck
// Parametric receiver routes for QB Challenge.
//
// Each route is a list of segments: `{ d: seconds, vx: m/s, vz: m/s }`.
// Receivers start at (x0, LOS) with z = LOS (~4m). At time `t` since
// snap, `routeSample(route, x0, t)` walks the segments cumulatively and
// returns the receiver's current position and velocity.
//
// The first segment is always a slow acceleration burst (the three-
// point-stance startup) so receivers don't teleport. After that the
// route shape kicks in.
//
// Conventions:
//   x0 is the receiver's starting lateral offset in meters. Positive x0
//   means lined up to the QB's right; negative is left. Routes that
//   break inward (slant, post) flip their vx sign to chase the middle
//   of the field automatically — see `mirrorIfInward()`.

// LOS sits 10m downfield of the camera, which is the perspective trick
// that keeps receivers visibly inside the screen frustum at the snap.
// The QB is implicitly at z=0; the receivers, defenders, and ball-tee
// all live at or near z=LOS_Z.
export const LOS_Z = 10;

// Segments tuned so receivers stay roughly inside x ∈ [-16, 16] for the
// full 3-3.5s pocket-pressure window. After a hard break each route
// coasts in a milder direction so the receiver doesn't fly off-screen.
const RAW_ROUTES = {
  drag:   [{ d: 0.50, vx: 0, vz: 5.5 },
           { d: 1.8,  vx: 6.0, vz: 1.5 },
           { d: 3.0,  vx: 1.0, vz: 1.0 }],
  slant:  [{ d: 0.40, vx: 0, vz: 5.5 },
           { d: 1.4,  vx: 4.5, vz: 5.0 },
           { d: 3.0,  vx: 1.5, vz: 3.5 }],
  curl:   [{ d: 0.55, vx: 0, vz: 7.5 },
           { d: 0.40, vx: 0, vz: 0.0 },
           { d: 4.0,  vx: 0, vz: -1.5 }],
  post:   [{ d: 0.80, vx: 0, vz: 8.0 },
           { d: 1.6,  vx: -3.5, vz: 6.5 },
           { d: 3.0,  vx: -0.8, vz: 5.0 }],
  fly:    [{ d: 0.40, vx: 0, vz: 6.0 },
           { d: 6.0,  vx: 0.0, vz: 9.0 }],
  screen: [{ d: 0.20, vx: 0, vz: 1.0 },
           { d: 1.6,  vx: 5.5, vz: 0.5 },
           { d: 3.0,  vx: 1.0, vz: 0.5 }],
};

export const ROUTE_NAMES = Object.keys(RAW_ROUTES);

// Routes whose lateral break should always chase the middle of the
// field rather than running off-screen. For these, vx sign is flipped
// when the receiver lines up on the right (x0 > 0).
const INWARD_BREAK = new Set(["slant", "post", "drag"]);

function mirrorIfInward(routeName, x0, vx) {
  if (vx === 0) return vx;
  if (!INWARD_BREAK.has(routeName)) return vx;
  return x0 > 0 ? -Math.abs(vx) : Math.abs(vx);
}

// Walk the segment list. Returns the position/velocity at time `t`.
// After the last segment the receiver coasts on the final velocity
// (game logic ends the play before this matters in practice).
export function routeSample(routeName, x0, t) {
  const segs = RAW_ROUTES[routeName] || RAW_ROUTES.drag;
  let x = x0;
  let z = LOS_Z;
  let elapsed = 0;
  let vx = 0, vz = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const segVx = mirrorIfInward(routeName, x0, s.vx);
    const segVz = s.vz;
    if (t <= elapsed + s.d) {
      const dt = t - elapsed;
      return { x: x + segVx * dt, z: z + segVz * dt, vx: segVx, vz: segVz };
    }
    x += segVx * s.d;
    z += segVz * s.d;
    elapsed += s.d;
    vx = segVx; vz = segVz;
  }
  // Past the route — coast on the last segment's velocity.
  const dt = t - elapsed;
  return { x: x + vx * dt, z: z + vz * dt, vx, vz };
}

// Produce a polyline (in world coords) for the pre-snap ghost-arrow
// preview. Steps ~0.1s up to `maxT` seconds.
export function routePath(routeName, x0, maxT) {
  const pts = [];
  const step = 0.12;
  for (let t = 0; t <= maxT; t += step) {
    const p = routeSample(routeName, x0, t);
    pts.push({ x: p.x, z: p.z });
  }
  return pts;
}

// Pick a formation for attempt #n. Returns an array of receiver specs
// — each one is { route, x0, jersey }. Tougher attempts get more
// receivers and faster routes. Defender count is in the index.js
// module since it owns pocket-pressure state.
export function pickFormation(attempt) {
  const a = attempt | 0;
  // x0 starts kept inside ±3.5 so the receivers project on-screen at
  // LOS_Z. Their routes break wider after the acceleration burst.
  if (a < 2) {
    return [pickOne(["drag", "curl"], -2 + Math.random() * 4, 11)];
  }
  if (a < 5) {
    return [
      pickOne(["drag", "slant", "curl"], -3 + Math.random() * 1.2, 88),
      pickOne(["post", "fly"],            1.8 + Math.random() * 1.5, 11),
    ];
  }
  return [
    pickOne(["drag", "slant"],  -3.2 + Math.random() * 0.8, 17),
    pickOne(["curl", "screen"], -0.5 + Math.random() * 1.0, 88),
    pickOne(["post", "fly"],     2.2 + Math.random() * 1.2, 11),
  ];
}

function pickOne(routePool, x0, jersey) {
  const route = routePool[Math.floor(Math.random() * routePool.length)];
  return { route, x0, jersey };
}

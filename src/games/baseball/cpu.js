// @ts-nocheck
// CPU opponents — batter (Phase 2) and pitcher (Phase 3).
//
// Difficulty knobs live here so the game's tuning is in one place.
// Right now everything is "Pro" tier. A future difficulty selector
// in the mode-select overlay can lerp these values.

import { PITCH_TYPES, isStrike, PLATE_HALF_W, PLATE_TOP, PLATE_BOTTOM, BALL_RELEASE_Y } from "./pitches.js";

// ──────────────────────────────────────────────────────────────────────
// CPU BATTER
// ──────────────────────────────────────────────────────────────────────
// Called once per pitch when the player is pitching. Decides whether
// the CPU swings, given the pitch's plate-crossing point + the current
// count. Returns an outcome string consumed by the at-bat state machine:
//
//   "take"         — let it pass; umpire calls ball or strike
//   "swing-miss"   — whiffs
//   "swing-foul"   — fouls it off (counts as a strike unless 2-strike)
//   "swing-weak"   — weak contact, almost always an out
//   "swing-solid"  — solid contact, ground or fly with hit potential
//   "swing-barrel" — barrelled, likely extra-base hit
//
// In Phase 2 the contact outcomes ("weak"/"solid"/"barrel") resolve to
// text-only descriptions of the at-bat result (out / single / double /
// HR). Phase 4 replaces this with real ball-off-bat physics + fielder
// resolution, so the CPU batter's swing intent is preserved but the
// outcome is computed from the ball's actual trajectory.
export function cpuBatterDecision(ball, count) {
  const inZone = isStrike(ball.plateX, ball.plateY);
  // Take rate — passes through about 38% of strikes overall, more
  // aggressive with two strikes (defensive swing) and more selective
  // ahead in the count.
  const protect2k = (count.strikes >= 2);
  // Base swing probability: in-zone strikes get swung at often;
  // chase rate is moderate but skews up with 2 strikes.
  let swingProb;
  if (inZone) {
    swingProb = protect2k ? 0.92 : 0.62;
  } else {
    // How far outside the zone — close pitches get chased more.
    const dx = Math.max(0, Math.abs(ball.plateX) - PLATE_HALF_W);
    const dy = Math.max(0,
      ball.plateY > PLATE_TOP ? ball.plateY - PLATE_TOP
      : ball.plateY < PLATE_BOTTOM ? PLATE_BOTTOM - ball.plateY
      : 0);
    const miss = dx + dy;                            // meters outside zone
    const chase = Math.max(0, 0.55 - miss * 2.0);    // 0 if way outside
    swingProb = protect2k ? Math.max(chase, 0.40) : chase;
  }
  if (Math.random() > swingProb) return "take";

  // Swung. Resolve quality. In-zone pitches generate better contact;
  // out-of-zone pitches mostly produce whiffs and weak contact. The
  // pitch type also matters: breaking balls (curve / slider) get
  // missed more than fastballs.
  const pitchHardness = ball.pitch.id === "curveball" ? 0.40
                      : ball.pitch.id === "slider"   ? 0.30
                      : ball.pitch.id === "changeup" ? 0.25
                      : 0.15;
  const missBoost = inZone ? pitchHardness : (pitchHardness + 0.50);
  const r = Math.random();
  if (r < missBoost * 0.6) return "swing-miss";
  if (r < missBoost * 0.6 + 0.20) return "swing-foul";
  // Contact distribution — most contact is weak; barreled balls are
  // rare. CPU at-bats produce a mix that feels like a real lineup.
  const cr = Math.random();
  if (cr < 0.55) return "swing-weak";
  if (cr < 0.92) return "swing-solid";
  return "swing-barrel";
}

// ──────────────────────────────────────────────────────────────────────
// CPU PITCHER (used in Phase 3 when the player is batting)
// ──────────────────────────────────────────────────────────────────────
// Returns { pitch, aimX, aimY }. Strategy: more breaking balls with two
// strikes, more fastballs early in the count; aim leans inside the
// strike zone but wanders to the edges so it isn't predictable.
export function cpuPitcherChoice(count) {
  // Pitch type weights by count
  let weights;
  if (count.strikes >= 2) {
    weights = { fastball: 1, curveball: 3, slider: 3, changeup: 2 };
  } else if (count.balls >= 3) {
    weights = { fastball: 4, curveball: 1, slider: 1, changeup: 1 };
  } else {
    weights = { fastball: 3, curveball: 2, slider: 2, changeup: 2 };
  }
  const pitch = weightedPick(weights);
  // Aim — mostly in the zone, with edge tendency on 2 strikes (try to
  // get the chase) and middle-zone tendency on 3 balls (don't walk).
  let aimX, aimY;
  if (count.strikes >= 2 && Math.random() < 0.45) {
    // Chase pitch — just off the edge.
    aimX = (Math.random() < 0.5 ? -1 : 1) * (PLATE_HALF_W + 0.05 + Math.random() * 0.10);
    aimY = lerp(PLATE_BOTTOM - 0.08, PLATE_TOP + 0.08, Math.random());
  } else {
    // In-zone, biased toward the corners.
    const corner = Math.random() < 0.6;
    aimX = corner
      ? (Math.random() < 0.5 ? -1 : 1) * (PLATE_HALF_W - 0.05 - Math.random() * 0.05)
      : (Math.random() - 0.5) * (PLATE_HALF_W * 1.0);
    aimY = lerp(PLATE_BOTTOM + 0.05, PLATE_TOP - 0.05, Math.random());
  }
  return { pitch, aimX, aimY };
}

function weightedPick(weights) {
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (const t of PITCH_TYPES) {
    const w = weights[t.id] || 0;
    r -= w;
    if (r <= 0) return t;
  }
  return PITCH_TYPES[0];
}

function lerp(a, b, t) { return a + (b - a) * t; }

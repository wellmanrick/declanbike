// Baseball rules — count handling, outs/innings advancement, and
// hit-type classification.
//
// Kept pure (no rendering, no state mutation of the runtime); the
// at-bat state machine in index.js calls these to advance the game.

// ──────────────────────────────────────────────────────────────────────
// COUNT — balls and strikes per at-bat.
// ──────────────────────────────────────────────────────────────────────
// Returns one of:
//   "in-play"      — atbat continues
//   "strikeout"    — three strikes (caller increments outs)
//   "walk"         — four balls (caller advances batter to 1B)
//   "hit-by-pitch" — Phase 6 placeholder, not produced today
//
// `outcome` strings come from the at-bat state machine: "ball",
// "called-strike", "swinging-strike", "foul", "contact-X".
export function applyPitchToCount(count, outcome) {
  switch (outcome) {
    case "ball":
      count.balls = Math.min(4, count.balls + 1);
      return count.balls >= 4 ? "walk" : "in-play";
    case "called-strike":
    case "swinging-strike":
      count.strikes = Math.min(3, count.strikes + 1);
      return count.strikes >= 3 ? "strikeout" : "in-play";
    case "foul":
      // Fouls advance to 2 strikes but never become the strikeout strike.
      if (count.strikes < 2) count.strikes += 1;
      return "in-play";
    case "contact-weak":
    case "contact-solid":
    case "contact-barrel":
      // Contact ends the atbat; the caller resolves hit-vs-out.
      return "contact";
    default:
      return "in-play";
  }
}

// ──────────────────────────────────────────────────────────────────────
// HIT-TYPE CLASSIFICATION (Phase 2 simplified)
// ──────────────────────────────────────────────────────────────────────
// Phase 2 doesn't have real fielders, so contact outcomes resolve via
// a probability roll based on contact quality + a touch of randomness.
// Phase 4 replaces this with a physics-driven path (ball trajectory ->
// nearest fielder -> catch / throw -> hit type).
//
// Returns { kind, label, bases } where:
//   kind  ∈ {"out", "single", "double", "triple", "home-run"}
//   bases  = how many bases the BATTER advances (0..4)
export function classifyPhase2Contact(qualityBucket) {
  // qualityBucket is the bucket string from the CPU batter (weak / solid
  // / barrel) OR a numeric 0..1 quality value (from the player batter
  // in Phase 3 — same buckets internally).
  const bucket = typeof qualityBucket === "number"
    ? (qualityBucket < 0.4 ? "weak" : qualityBucket < 0.75 ? "solid" : "barrel")
    : qualityBucket;
  const r = Math.random();
  switch (bucket) {
    case "barrel":
      // Barreled balls land for a hit ~85% of the time, HRs ~30%.
      if (r < 0.30) return { kind: "home-run", label: "HOME RUN!",   bases: 4 };
      if (r < 0.55) return { kind: "double",   label: "DOUBLE",      bases: 2 };
      if (r < 0.85) return { kind: "single",   label: "SINGLE",      bases: 1 };
      return                { kind: "out",     label: "Loud out",    bases: 0 };
    case "solid":
      if (r < 0.05) return { kind: "home-run", label: "HOME RUN!",   bases: 4 };
      if (r < 0.20) return { kind: "double",   label: "DOUBLE",      bases: 2 };
      if (r < 0.55) return { kind: "single",   label: "SINGLE",      bases: 1 };
      return                { kind: "out",     label: "Lineout",     bases: 0 };
    case "weak":
    default:
      if (r < 0.18) return { kind: "single",   label: "Bloop single", bases: 1 };
      return                { kind: "out",     label: "Groundout",    bases: 0 };
  }
}

// ──────────────────────────────────────────────────────────────────────
// RUNNER ADVANCEMENT (simplified)
// ──────────────────────────────────────────────────────────────────────
// Walk: forced advance only if needed.
// Hits: everyone moves up by `bases`, capped at home (which scores).
// Returns the number of runs scored from this play.
export function advanceRunners(state, bases) {
  let runs = 0;
  // Stack the current runners + the new batter into an ordered queue,
  // then drop the front of the queue onto home for each "extra slot"
  // needed.
  const queue = [
    state.bases.third ? "R3" : null,
    state.bases.second ? "R2" : null,
    state.bases.first ? "R1" : null,
    "BATTER",
  ].filter(Boolean);

  // Each runner advances `bases` if it's a hit. For a walk we only
  // advance forced runners. Walks call us with bases=0 (special-cased).
  const newBases = { first: null, second: null, third: null };
  if (bases === 0) {
    // Walk — push from 1B if anyone's there.
    let push = "BATTER";
    if (state.bases.first) {
      newBases.first = push;
      push = "R1";
      if (state.bases.second) {
        newBases.second = push;
        push = "R2";
        if (state.bases.third) {
          newBases.third = push;
          runs += 1; // R3 forced home
        } else {
          newBases.third = push;
        }
      } else {
        newBases.second = push;
        newBases.third = state.bases.third;
      }
    } else {
      newBases.first = push;
      newBases.second = state.bases.second;
      newBases.third = state.bases.third;
    }
    state.bases = newBases;
    return runs;
  }

  // Hits — each existing runner advances `bases`, batter advances `bases`.
  // queue order: R3 (third base), R2, R1, BATTER (still at home).
  // The "current base index" maps: R3=3, R2=2, R1=1, BATTER=0.
  const startBaseIdx = { R3: 3, R2: 2, R1: 1, BATTER: 0 };
  for (const runnerId of queue) {
    const finalBaseIdx = startBaseIdx[runnerId] + bases;
    if (finalBaseIdx >= 4) {
      runs += 1;
    } else {
      const slot = finalBaseIdx === 1 ? "first"
                 : finalBaseIdx === 2 ? "second"
                 : "third";
      // If the slot is already taken by someone behind them on the
      // queue (shouldn't happen with uniform `bases` advancement, but
      // guard anyway), push them home so nobody overlaps.
      if (newBases[slot]) { runs += 1; }
      else newBases[slot] = runnerId;
    }
  }
  state.bases = newBases;
  return runs;
}

// @ts-nocheck
// Declan Baseball — top-level baseball game.
//
// Reachable from the main menu (not the Mini-Games hub). Uses the
// existing MINIGAMES dispatch contract so the canvas pointer routing,
// pause/resume, and game-over hooks all light up automatically.
//
// State machine inside a single at-bat:
//
//   presnap → aim → pitch → resolve → presnap (loop)
//
//   presnap   pitcher picks a pitch type (chip tap) and starts a drag
//             to aim. Once a chip is armed AND the player has begun a
//             drag, we transition to "aim".
//   aim       drag in progress — the crosshair follows the finger.
//             On pointer release, the pitch fires from the active
//             aim point.
//   pitch     ball is in flight from mound to plate; integrated each
//             frame via stepPitch(). Phase 2 ends this when the ball
//             crosses the plate plane.
//   resolve   outcome decided. Phase 2 calls into rules.js to advance
//             the count / outs / bases. After outcomeHoldT seconds
//             we either flip to a new batter (presnap) or end the half-
//             inning / game (Phase 5 wiring).
//
// Phase 5 will add HALF_END and GAME_END as terminal phases between
// resolve and presnap. Phase 3 will fork the role: when the player is
// BATTING, the pitcher state machine runs on the CPU and a parallel
// batter input collects swing decisions.

import { ctx, W, H, ease } from "../../engine/canvas.js";
import { Sound } from "../../engine/audio.js";
import { save, persistSave } from "../../engine/save.js";
import { haptic, registerPressFx } from "../../engine/touch.js";
import {
  PITCH_TYPES, pitchById, buildPitch, stepPitch, isStrike,
  buildHitBall, stepHitBall,
  PLATE_Z, PLATE_TOP, PLATE_BOTTOM, PLATE_HALF_W, BALL_RELEASE_Y,
} from "./pitches.js";
import { applyPitchToCount, classifyPhase2Contact, advanceRunners } from "./rules.js";
import { cpuBatterDecision, cpuPitcherChoice } from "./cpu.js";
import {
  buildFielders, resetFielders, chooseFielder, classifyHit,
  FIELDER_RUN_SPEED, BATTER_RUN_SPEED, BASE_PATH_DIST, batterArrivalAtBase,
} from "./fielders.js";
import {
  drawPitcherView, drawPitchChips, drawPitcherPrompt, drawOutcomeBanner,
  drawBatterView, drawBatterPrompt,
  drawFieldView,
} from "./draw.js";

const DEFAULTS = { mode: "cpu", innings: 3 };

// Phase timing constants. Tuned by playtest — feel free to tweak.
const RESOLVE_HOLD_DEFAULT = 1.10;     // generic outcome (ball/strike)
const RESOLVE_HOLD_CONTACT = 1.40;     // contact + hit description
const RESOLVE_HOLD_BIG     = 1.80;     // HRs / strikeouts / inning end
// How long to wait after a pitch ball-plate crossing before deciding
// the CPU batter's call. Long enough that the swing decision FEELS
// like it's happening at contact, not in the resolve banner.
const SWING_DECIDE_T = 0.05;

// Player batting — how long before/after the ball arrives at the plate
// is the swing considered "in time"? Wider window = easier game.
const SWING_TIMING_TOLERANCE = 0.18;   // seconds either side of plate-time
// How far off (in meters at the plate plane) can the swing be from the
// ball's actual location and still count as contact?
const SWING_AIM_TOLERANCE_M = 0.45;

// CPU pitcher pacing — how long after the previous resolve before the
// CPU automatically fires its next pitch. Gives the player a beat to
// breathe between pitches.
const CPU_PITCH_DELAY = 0.55;

// Pass-device hold for PVP mode. Long enough for the device to
// physically change hands between players, short enough not to be
// annoying. Same overlay (shorter hold) gates CPU-mode half ends so
// the player sees the inning marker change before play resumes.
const PASS_HOLD_PVP = 3.0;
const PASS_HOLD_CPU = 1.6;

// Who's at the plate vs on the mound? In CPU mode the player is on
// the HOME team — they pitch in the top half and bat in the bottom
// half. In PVP mode both sides are human; we still return a role for
// the "active" view (Phase 5 wraps this with a pass-device interlude
// so both sides aren't visible at once).
function roleFor(mode, half) {
  if (mode === "pvp") {
    // Player 1 = AWAY, Player 2 = HOME. Top half → away batting (P1 bats,
    // P2 pitches); bottom half → home batting (P2 bats, P1 pitches).
    // We render the side that's currently up to bat — the same player
    // who pitched last half is now batting.
    return half === "top" ? "pitching" : "batting";
  }
  // CPU mode — player is HOME (pitches in top, bats in bottom).
  return half === "top" ? "pitching" : "batting";
}

// Outcome -> sub-text helper. Phase 5 will move the stat tracking
// into a proper logger.
function outcomeColor(kind) {
  switch (kind) {
    case "ball": return "#9fe8ff";
    case "called-strike":
    case "swinging-strike": return "#ff8a5b";
    case "foul": return "#cfd6e3";
    case "walk": return "#9fe8ff";
    case "strikeout": return "#ff5470";
    case "home-run": return "#f8d56a";
    case "double":
    case "triple":
    case "single": return "#4ddc8c";
    case "out": return "#ff8a5b";
    default: return "#fff";
  }
}

export const Baseball = {
  name: "Baseball",
  desc: "Pitch, hit, and field your way through a real ball game.",
  icon: "⚾",
  color: "#f8d56a",
  menuTarget: "menu",

  init(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    const innings = (cfg.innings === 5 || cfg.innings === 9) ? cfg.innings : 3;
    const mode = (cfg.mode === "pvp") ? "pvp" : "cpu";
    return {
      gameId: "baseball",
      mode, innings,
      time: 0,
      // ── Game-wide state (Phase 5 populates fully) ──
      // The "player" team is HOME (bats in the bottom half, pitches in
      // the top half). With mode=cpu, the role flips based on which
      // half it is. With mode=pvp, both halves are played by humans,
      // and a "PASS DEVICE" overlay (Phase 5) lets the device change
      // hands between halves. Phase 3 only fully wires CPU mode.
      role: roleFor(mode, "top"),
      score: 0,                      // legacy dispatcher field (flat)
      runs: { home: 0, away: 0 },
      inning: 1, half: "top",
      outs: 0,
      count: { balls: 0, strikes: 0 },
      bases: { first: null, second: null, third: null },
      stats: {
        hits: 0, homeRuns: 0,
        strikeoutsThrown: 0, strikeoutsTaken: 0,
        halvesPlayed: 0,
      },
      finished: false,
      finishHoldUntil: 0,
      // ── At-bat state machine ──
      phase: "presnap", phaseT: 0,
      armedPitch: null,              // selected PITCH_TYPES entry, or null
      aimX: 0, aimY: (PLATE_TOP + PLATE_BOTTOM) / 2,
      ball: null,                    // active pitch ball (or null)
      pendingSwing: null,            // CPU swing decision, fires near plate
      outcomeText: "", outcomeSub: "", outcomeColor: "#fff", outcomeHoldT: 0,
      // ── Input drag state ──
      dragStart: null, dragNow: null,
      // ── Hit-by-pitch HUD: ephemeral toast strip showing last result ──
      lastOutcomeKind: null,
      // ── Player-batter swing telemetry ──
      swingFiredAt: null,            // wall-time when the player tapped to swing
      swingScreenPos: null,          // {x,y} of the swing tap
      swingAnimT: 0,                 // 0..0.25 — drives the bat-icon swoosh
      // ── CPU pitcher pacing ──
      cpuPitchAt: null,              // performance.now() ms when CPU fires next
      // ── Hit physics (Phase 4) ──
      // Active when phase === "field". hitBall is the ball-in-flight
      // off the bat; fielders are the 9 defenders + their nav state;
      // runner is the batter-runner heading toward 1B; hitPlan is the
      // pre-resolved chooseFielder result so update() doesn't repeat
      // the search every frame.
      hitBall: null,
      fielders: buildFielders(),
      runner: null,
      hitPlan: null,
      hitOutcome: null,              // {kind, bases, label}
      fieldPhaseStart: 0,            // performance.now() when "field" started
      fieldHoldT: 0,                 // total duration of the field phase
    };
  },


  onPlayAgain(prev) {
    return Baseball.init({ mode: prev.mode, innings: prev.innings });
  },

  payout(g) {
    // Cash rewards favor winning + scoring + power.
    //   base:     10 per run scored by the player team (home in CPU, both in PVP)
    //   win:      +25 in CPU mode if the player won
    //   margin:   +5 per run-margin (capped at +25)
    //   power:    +10 per HR
    //   minimum:  1 — never insult the player with $0
    const playerRuns = g.mode === "pvp"
      ? (g.runs.home + g.runs.away)
      : g.runs.home;
    let cash = playerRuns * 10;
    if (g.mode === "cpu" && g.runs.home > g.runs.away) {
      cash += 25 + Math.min(25, (g.runs.home - g.runs.away) * 5);
    }
    cash += g.stats.homeRuns * 10;
    return Math.max(1, Math.floor(cash));
  },

  // ──────────────────────────────────────────────────────────────────
  // INPUT — dispatches by role.
  //   pitching: chip-tap + drag-aim + release-to-pitch (Phase 2 behavior)
  //   batting:  tap-anywhere to swing at the in-flight pitch. The tap
  //             X/Y is the swing target — close to ball's plate (x,y)
  //             at swing time = quality contact.
  // ──────────────────────────────────────────────────────────────────
  handlePointer(g, kind, x, y) {
    if (g.finished) return;
    if (g.role === "pitching") handlePointerPitching(g, kind, x, y);
    else if (g.role === "batting") handlePointerBatting(g, kind, x, y);
  },

  // ──────────────────────────────────────────────────────────────────
  // UPDATE — per-frame tick. Branches by phase; some phases also branch
  // by role (e.g. the pitch's swing source — CPU when player pitches,
  // player when player bats).
  // ──────────────────────────────────────────────────────────────────
  update(g, dt) {
    // Game over — the dispatcher draws the finished overlay; the game
    // state freezes. Without this, the at-bat state machine would loop
    // back to a new batter behind the overlay and the scoreboard would
    // keep changing.
    if (g.finished) return;
    g.time += dt;
    g.phaseT += dt;
    if (g.swingAnimT > 0) g.swingAnimT = Math.max(0, g.swingAnimT - dt);

    switch (g.phase) {
      case "presnap":
      case "aim":
        // Pitcher role idles waiting for the player to pick a pitch.
        // Batting role auto-pitches via the CPU after a short delay
        // so the player isn't left wondering what to do.
        if (g.role === "batting") tickBatterPresnap(g);
        break;
      case "pitch": {
        if (g.ball) {
          stepPitch(g.ball, dt);
          if (g.role === "pitching") {
            // CPU batter resolves the at-bat once the ball hits the plate.
            if (g.ball.landedAtPlate && !g.pendingSwing) {
              g.pendingSwing = cpuBatterDecision(g.ball, g.count);
              g.swingDecidedAt = g.phaseT;
            }
            if (g.pendingSwing && (g.phaseT - g.swingDecidedAt) >= SWING_DECIDE_T) {
              resolveAtBatPhase2(g);
            }
          } else {
            // Player batting — wait for them to either swing (handled
            // by handlePointerBatting -> resolveBatterSwing) or for the
            // pitch to pass without a swing.
            if (g.ball.landedAtPlate && !g.pendingSwing) {
              // Ball has crossed the plate. Give the batter a short
              // window AFTER the plate to still tap — that's their late
              // swing. If we don't see one within SWING_TIMING_TOLERANCE
              // of plate-time, register a take.
              g.batterTakeDeadline = g.phaseT + SWING_TIMING_TOLERANCE;
            }
            if (g.batterTakeDeadline != null && g.phaseT >= g.batterTakeDeadline && !g.pendingSwing) {
              // Pitch passed; the batter didn't swing.
              g.pendingSwing = "take";
              resolveAtBatPhase2(g);
            }
          }
        } else {
          g.phase = "presnap"; g.phaseT = 0;
        }
        break;
      }
      case "field": {
        // Animate the hit-ball + fielders + runner until the play
        // resolves. fieldHoldT was set at startFieldPhase based on the
        // longest of (ball flight + fielder pickup + throw) and
        // (batter sprint to the relevant base).
        tickFieldPhase(g, dt);
        if (g.phaseT >= g.fieldHoldT) {
          finalizeFieldPhase(g);
        }
        break;
      }
      case "resolve": {
        if (g.phaseT >= g.outcomeHoldT) {
          if (g.outs >= 3) endHalfInning(g);
          else if (g._endsAtBat === false) nextPitchSameBatter(g);
          else startNewBatter(g);
        }
        break;
      }
      case "half-end": {
        // Pass-device interlude (PVP) or short transition (CPU). After
        // PASS_HOLD seconds, we flip the half / inning / role and
        // start a new batter (or end the game if we're done).
        if (g.phaseT >= g.halfEndHoldT) advanceAfterHalfEnd(g);
        break;
      }
    }
  },

  // ──────────────────────────────────────────────────────────────────
  // RENDER — branches on role. The HUD strip + outcome banner are
  // shared between roles.
  // ──────────────────────────────────────────────────────────────────
  render(g) {
    // During the half-end interlude we draw the previous view as a
    // backdrop and overlay the pass-device card on top — feels more
    // grounded than going to a blank screen.
    if (g.phase === "field") {
      drawFieldView(g);
    } else if (g.role === "batting") {
      drawBatterView(g);
      drawBatterPrompt(g);
    } else {
      drawPitcherView(g);
      drawPitchChips(g, PITCH_TYPES);
      drawPitcherPrompt(g);
    }
    drawOutcomeBanner(g);
    drawHudStrip(g);
    if (g.phase === "half-end") drawHalfEndOverlay(g);
  },

  renderFinished(g) {
    drawBaseballFinishedOverlay(g);
  },
};

// ──────────────────────────────────────────────────────────────────────
// PITCHER-ROLE INPUT — chip-tap + drag-aim + release-to-pitch.
// ──────────────────────────────────────────────────────────────────────
function handlePointerPitching(g, kind, x, y) {
  if (kind === "down") {
    // Chip hit-test takes priority over starting a drag.
    if (g.phase === "presnap" || g.phase === "aim") {
      const hit = chipHit(g, x, y);
      if (hit) {
        g.armedPitch = pitchById(hit.pitchId);
        Sound.click && Sound.click();
        haptic("tap");
        // Tint the press fx with the pitch type's primary color so the
        // tap visually links to the type that just got armed.
        registerPressFx(hit, hexToRgba(g.armedPitch.colorPrimary, 0.85));
        g.aimX = 0;
        g.aimY = (PLATE_TOP + PLATE_BOTTOM) / 2;
        return;
      }
    }
    g.dragStart = { x, y, t: performance.now() };
    g.dragNow = { x, y };
    if (g.armedPitch && g.phase === "presnap") {
      g.phase = "aim";
      g.phaseT = 0;
    }
  } else if (kind === "move") {
    if (!g.dragStart) return;
    g.dragNow = { x, y };
    if (g.phase === "aim") {
      const aim = dragToAim(g);
      g.aimX = aim.x;
      g.aimY = aim.y;
    }
  } else if (kind === "up") {
    if (g.phase === "aim" && g.armedPitch) {
      const aim = dragToAim(g);
      g.aimX = aim.x;
      g.aimY = aim.y;
      firePitch(g);
    }
    g.dragStart = null;
    g.dragNow = null;
  }
}

// ──────────────────────────────────────────────────────────────────────
// BATTER-ROLE INPUT — tap-anywhere to swing. The tap (x, y) becomes
// the swing-target screen point; we compare it against the ball's
// projected screen position at swing time to get an "aim error".
// ──────────────────────────────────────────────────────────────────────
function handlePointerBatting(g, kind, x, y) {
  // Drag tracking — purely for the swing reticle render.
  if (kind === "down") {
    g.dragStart = { x, y, t: performance.now() };
    g.dragNow = { x, y };
    // The swing fires on the DOWN edge — committing to a swing at
    // the moment you tap feels right (tap = "go!"). Subsequent drag
    // tweaks the reticle but doesn't change the outcome.
    if (g.phase === "pitch" && !g.pendingSwing) {
      g.swingFiredAt = g.phaseT;
      g.swingScreenPos = { x, y };
      g.pendingSwing = "player-swing";
      g.swingAnimT = 0.40;     // matches BAT_SWING_DUR in draw.js
      // Swing-commit haptic — fires on the tap-down edge so the player
      // gets feedback BEFORE the swing outcome resolves. The contact
      // bucket later layers a heavier haptic on top (HR = heavy, K =
      // fail). resolveBatterSwing decides which.
      haptic("click");
      resolveBatterSwing(g);
    }
  } else if (kind === "move") {
    if (g.dragStart) g.dragNow = { x, y };
  } else if (kind === "up") {
    g.dragStart = null;
    g.dragNow = null;
  }
}

// CPU pitcher tick — in CPU mode only. When the player is batting and
// the CPU is pitching, the CPU picks + fires a pitch after a short
// delay between at-bats. In PVP mode the human pitcher uses the
// pitcher controls so this is a no-op (presnap waits for input).
function tickBatterPresnap(g) {
  if (g.mode === "pvp") return;
  if (g.cpuPitchAt == null) {
    g.cpuPitchAt = performance.now() + CPU_PITCH_DELAY * 1000;
    return;
  }
  if (performance.now() >= g.cpuPitchAt) {
    const choice = cpuPitcherChoice(g.count);
    g.armedPitch = choice.pitch;
    g.aimX = choice.aimX;
    g.aimY = choice.aimY;
    firePitch(g);
    g.cpuPitchAt = null;
  }
}

// Convert the player's swing tap to a world-space aim point at the
// plate plane, then compare it to where the ball was when the swing
// fired. Compute timing error + spatial error → contact quality →
// outcome bucket.
function resolveBatterSwing(g) {
  const b = g.ball;
  if (!b) return;
  // Where would the ball be at swing time? Two cases:
  //  - Swing fired BEFORE the ball reached the plate — we want where the
  //    ball was at swing time (we have b.x/y/z = current).
  //  - Swing fired AFTER the ball reached the plate — same idea, b is
  //    still in motion past the plate (we don't stop integrating it).
  // Either way, the ball's current position IS where it was at the
  // swing time, to within one frame. Good enough.
  // Project ball position into screen coords using batter projection.
  // We import that helper from draw.js.
  const ballScreen = ballScreenInBatterView(b);
  const dx = (g.swingScreenPos.x - ballScreen.sx);
  const dy = (g.swingScreenPos.y - ballScreen.sy);
  const screenDist = Math.hypot(dx, dy);
  // Convert screen distance to a 0..1 aim quality. 80px on a 390-wide
  // screen is roughly the ball's projected radius near the plate, so
  // <80px = direct hit, 80..240 = grazing, >240 = whiff.
  const aimQ = Math.max(0, 1 - screenDist / 200);

  // Timing — when did the ball cross the plate vs when we swung?
  // ball.age at landedAtPlate is the answer; otherwise we can predict
  // based on remaining z / vz.
  let plateAge;
  if (b.landedAtPlate) {
    plateAge = b.age;     // ball.age was frozen at landedAtPlate moment
  } else {
    plateAge = b.age + (PLATE_Z - b.z) / b.vz;
  }
  // g.swingFiredAt is g.phaseT at swing; b.age corresponds to g.phaseT
  // because both started at firePitch. So:
  const timingErr = Math.abs(g.swingFiredAt - plateAge);
  const timeQ = Math.max(0, 1 - timingErr / SWING_TIMING_TOLERANCE);

  // Combined contact quality. Both axes matter — a perfectly-timed
  // swing in the wrong location still misses, and vice versa.
  const contactQ = aimQ * 0.5 + timeQ * 0.5;

  // Bucket the quality into the same outcome strings the CPU branch
  // produces so we can reuse the resolveAtBatPhase2 logic.
  let outcome;
  if (contactQ < 0.05)      outcome = "swing-miss";
  else if (contactQ < 0.30) outcome = "swing-foul";
  else if (contactQ < 0.55) outcome = "swing-weak";
  else if (contactQ < 0.85) outcome = "swing-solid";
  else                      outcome = "swing-barrel";
  g.pendingSwing = outcome;
  // Stat — for player-batting strikeouts taken
  if (outcome === "swing-miss") g._lastSwingWasMiss = true;
  resolveAtBatPhase2(g);
}

// Re-project ball into batter view for the swing aim calc. MUST stay
// in sync with projectFromBatter() in draw.js — both use the same
// camera-Z and eye-height so the player's tap is compared against the
// SAME screen position the visual renderer drew the ball at.
const _BATTER_FOCAL = 600;
const _BATTER_CAM_H = 1.65;
const _BATTER_CAM_Z_LOCAL = PLATE_Z + 4.0;     // matches BATTER_CAM_Z in draw.js
function ballScreenInBatterView(b) {
  const zz = Math.max(0.5, _BATTER_CAM_Z_LOCAL - b.z);
  return {
    sx: W / 2 + (-b.x) * _BATTER_FOCAL / zz,
    sy: H * 0.55 + (_BATTER_CAM_H - b.y) * _BATTER_FOCAL / zz,
  };
}

// ──────────────────────────────────────────────────────────────────────
// FIELD PHASE — contact happens, the ball is in the air, fielders run,
// the batter sprints. The outcome (out / single / double / triple / HR)
// is pre-resolved by classifyHit() once we have the trajectory + the
// fielder plan, then we just animate until the play "looks done".
// ──────────────────────────────────────────────────────────────────────
function startFieldPhase(g, qualityBucket) {
  resetFielders(g.fielders);
  // Exit velocity is a function of contact quality. Weak contact is
  // soft; barreled balls leave the bat at ~50 m/s (≈110mph).
  const evMps = qualityBucket === "barrel" ? 42 + Math.random() * 10
              : qualityBucket === "solid"  ? 32 + Math.random() * 8
              : 20 + Math.random() * 10;
  // Launch angle — barreled balls drive at the sweet spot (15..35°);
  // weak grounders are mostly negative or low launch.
  const launchAng = qualityBucket === "barrel" ? 15 + Math.random() * 25
                  : qualityBucket === "solid"  ? 5  + Math.random() * 28
                  : -10 + Math.random() * 20;
  // Spray angle — uniform across fair territory with a slight pull
  // bias. The ball's plateX from the pitch also nudges spray (inside
  // pitches pull more), but for Phase 4 we keep it random.
  const sprayAng = (Math.random() - 0.5) * 70;

  const hb = buildHitBall(evMps, launchAng, sprayAng);
  g.hitBall = hb;

  // Decide which fielder plays this ball.
  const plan = chooseFielder(g.fielders, hb.trajectory);
  g.hitPlan = plan;

  // Pre-classify the outcome. We need the batter's projected arrival
  // at 1B (for a hit) — assume sprint speed all the way.
  const batterTo1B = batterArrivalAtBase(1);
  const outcome = classifyHit(plan, hb.trajectory, batterTo1B);
  g.hitOutcome = outcome;

  // The phase plays for the longer of (full ball trajectory + small
  // post-catch beat) and (batter sprint to wherever they're going).
  const trajEnd = hb.trajectory[hb.trajectory.length - 1].t;
  const sprintEnd = batterArrivalAtBase(Math.max(1, outcome.bases || 1));
  const baseHold = outcome.kind === "home-run" ? 3.5 : 2.6;
  g.fieldHoldT = Math.max(trajEnd + 0.8, sprintEnd + 0.2, baseHold);

  // Animate the batter-runner. Path: home (0,0) → 1B (9, 9) → 2B (0, 18)
  // → 3B (-9, 9) → home. We sample along the path by total distance
  // traveled = BATTER_RUN_SPEED * elapsedTime.
  g.runner = {
    x: 0, z: 0,
    bases: outcome.bases,
    pathT: 0,
  };

  // Set up the fielder chase. The chosen fielder gets a target at the
  // interception point; others hold their positions for Phase 4.
  // Track each chasing fielder's start position + total travel time so
  // tickFieldPhase can ease the motion (accelerate from rest, decelerate
  // into the catch) instead of constant-speed snapping.
  if (plan) {
    plan.fielder.state = "chasing";
    plan.fielder.targetX = plan.interceptX;
    plan.fielder.targetZ = plan.interceptZ;
    plan.fielder.chaseStartX = plan.fielder.x;
    plan.fielder.chaseStartZ = plan.fielder.z;
    plan.fielder.chaseT = 0;
    const chaseDist = Math.hypot(
      plan.interceptX - plan.fielder.x,
      plan.interceptZ - plan.fielder.z
    );
    // Total travel time at the configured run speed. easeInOutQuad
    // briefly exceeds this if we used average speed; we pad +5% so the
    // fielder reaches the ball at the right moment.
    plan.fielder.chaseTotalT = (chaseDist / FIELDER_RUN_SPEED) * 1.05;
  }

  // Phase transition.
  g.phase = "field";
  g.phaseT = 0;
  g.fieldPhaseStart = performance.now();
  // Bat crack sound — placeholder uses boostHit for the percussive
  // attack. Phase 6 will swap a real bat-on-ball sample in.
  Sound.boostHit && Sound.boostHit();
}

function tickFieldPhase(g, dt) {
  // Ball motion
  if (g.hitBall) stepHitBall(g.hitBall, dt);
  // Fielder motion — eased lerp from chaseStart to target over
  // chaseTotalT seconds. easeInOutQuad: gentle acceleration out of the
  // ready-stance + decel into the catch. Reads way better than the old
  // constant-speed slide.
  if (g.fielders) {
    for (const f of g.fielders) {
      if (f.state !== "chasing") continue;
      f.chaseT = (f.chaseT || 0) + dt;
      const total = f.chaseTotalT || 0.01;
      const u = Math.min(1, f.chaseT / total);
      const eased = ease(u, "easeInOutQuad");
      f.x = f.chaseStartX + (f.targetX - f.chaseStartX) * eased;
      f.z = f.chaseStartZ + (f.targetZ - f.chaseStartZ) * eased;
      if (u >= 1) { f.x = f.targetX; f.z = f.targetZ; f.state = "fielding"; }
    }
  }
  // Runner motion — accumulate eased distance per leg so the runner
  // accelerates out of home, holds top speed through the bag, decel-
  // erates into the next. Without easing they "snap" at each corner.
  if (g.runner) {
    g.runner.pathT += dt;
    const pos = runnerPathPos(g.runner.pathT * BATTER_RUN_SPEED, g.runner.bases);
    g.runner.x = pos.x;
    g.runner.z = pos.z;
  }
}

// Walk the basepath. Total distance = bases * 27.4m. Returns the
// world (x, z) of the runner. Each leg is eased with easeInOutQuad so
// the runner accelerates out of the bag, holds through the middle of
// the leg, and decelerates into the next corner — eliminates the snap
// at every base that pure-linear traversal produced.
function runnerPathPos(distTraveled, totalBases) {
  const waypoints = [
    { x: 0, z: 0 },           // home
    { x: 9.0, z: 9.0 },       // 1B
    { x: 0, z: 18.0 },        // 2B
    { x: -9.0, z: 9.0 },      // 3B
    { x: 0, z: 0 },           // home (scoring)
  ];
  const maxDist = totalBases * BASE_PATH_DIST;
  const d = Math.min(distTraveled, maxDist);
  let remaining = d;
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (remaining <= BASE_PATH_DIST) {
      const a = waypoints[i], b = waypoints[i + 1];
      const tLinear = remaining / BASE_PATH_DIST;
      // ease the SAMPLE point along the leg. Slight overall speedup
      // from the middle but still bounded by the basepath.
      const t = ease(tLinear, "easeInOutQuad");
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    remaining -= BASE_PATH_DIST;
  }
  return waypoints[totalBases] || waypoints[waypoints.length - 1];
}

function finalizeFieldPhase(g) {
  const outcome = g.hitOutcome || { kind: "out", bases: 0, label: "Out" };
  const label = outcome.label || (outcome.kind === "out" ? "OUT" : outcome.kind.toUpperCase());
  let sub = "";
  if (outcome.kind === "out") {
    g.outs += 1;
    sub = `${g.outs} out${g.outs === 1 ? "" : "s"}`;
  } else {
    const runs = advanceRunners(g, outcome.bases);
    const playerHit = (g.role === "batting");
    if (playerHit) {
      g.stats.hits += 1;
      if (outcome.kind === "home-run") g.stats.homeRuns += 1;
    }
    if (runs > 0) {
      const team = g.half === "top" ? "away" : "home";
      g.runs[team] += runs;
      g.score = g.runs.home;
      sub = `+${runs} run${runs === 1 ? "" : "s"}`;
      Sound.cheer && Sound.cheer(outcome.kind === "home-run");
      // Run-scoring haptic — HRs get the big ascending success pattern,
      // other scoring plays get the milder click. Only fires when the
      // PLAYER team scored (in CPU mode that's HOME). PVP fires for any
      // team since both sides are humans on the same device.
      const playerScored = (g.mode === "pvp")
        || (g.half === "bottom" && playerHit);
      if (playerScored) {
        haptic(outcome.kind === "home-run" ? "success" : "click");
      }
    } else {
      sub = "Runner on base";
    }
  }
  g.lastOutcomeKind = outcome.kind;
  // Clear hit state
  g.hitBall = null;
  g.runner = null;
  g.hitPlan = null;
  resetFielders(g.fielders);
  // Contact always ends the at-bat (next pitch is a new plate appearance).
  setResolve(g, label, sub, outcomeColor(outcome.kind),
    outcome.kind === "home-run" ? RESOLVE_HOLD_BIG : RESOLVE_HOLD_CONTACT,
    /* endsAtBat */ true);
}

// ──────────────────────────────────────────────────────────────────────
// At-bat helpers
// ──────────────────────────────────────────────────────────────────────

function startNewBatter(g) {
  g.count = { balls: 0, strikes: 0 };
  nextPitchSameBatter(g);
}

// Reset only the per-pitch state — count is PRESERVED so an at-bat
// can stretch across multiple pitches (the normal case). Called when
// the previous pitch resolved to a non-terminating outcome (ball,
// non-final strike, foul).
function nextPitchSameBatter(g) {
  g.phase = "presnap";
  g.phaseT = 0;
  g.armedPitch = null;
  g.ball = null;
  g.pendingSwing = null;
  g.swingFiredAt = null;
  g.swingScreenPos = null;
  g.batterTakeDeadline = null;
  g.cpuPitchAt = null;
  g.outcomeText = ""; g.outcomeSub = ""; g.outcomeColor = "#fff";
  g._endsAtBat = undefined;
  // PVP — flip control back to the pitcher for the next pitch.
  if (g.mode === "pvp") g.role = "pitching";
}

// ──────────────────────────────────────────────────────────────────────
// INNING STRUCTURE
// ──────────────────────────────────────────────────────────────────────
function endHalfInning(g) {
  // Common bookkeeping for any half ending.
  g.outs = 0;
  g.bases = { first: null, second: null, third: null };
  g.stats.halvesPlayed += 1;
  // Check the game-end conditions BEFORE advancing the inning so
  // walk-offs (home leading after the top of the final inning OR
  // home scoring the lead run in the bottom) trigger correctly.
  const halfDone = checkGameEnd(g);
  if (halfDone) { finishGame(g); return; }
  // Otherwise: pass-device overlay or short interlude.
  g.phase = "half-end";
  g.phaseT = 0;
  g.halfEndHoldT = (g.mode === "pvp") ? PASS_HOLD_PVP : PASS_HOLD_CPU;
  // Phase 5 pre-computes the NEXT half + inning + role so the overlay
  // can name the inning that's about to start ("Top of 2" etc).
  const nextHalf = g.half === "top" ? "bottom" : "top";
  const nextInning = g.half === "top" ? g.inning : g.inning + 1;
  g._nextHalf = nextHalf;
  g._nextInning = nextInning;
  g._nextRole = roleFor(g.mode, nextHalf);
}

function advanceAfterHalfEnd(g) {
  g.half = g._nextHalf;
  g.inning = g._nextInning;
  g.role = g._nextRole;
  g._nextHalf = null; g._nextInning = null; g._nextRole = null;
  startNewBatter(g);
}

// Game end checks at the END of a half-inning (post outs-cap, pre
// inning advance).
function checkGameEnd(g) {
  // Top half just ended? Game continues unless we've played a full
  // regulation game AND home is leading (no bottom needed).
  if (g.half === "top") {
    if (g.inning >= g.innings && g.runs.home > g.runs.away) {
      return true;  // home wins, no bottom half needed
    }
    return false;
  }
  // Bottom half just ended.
  if (g.inning >= g.innings) {
    // Game is over unless we're tied — then extra innings.
    if (g.runs.home !== g.runs.away) return true;
    return false;
  }
  // Walk-off: bottom half of an inning >= regulation with home leading
  // mid-inning isn't possible here (we only call endHalfInning at 3
  // outs), so we don't need a separate walk-off check.
  return false;
}

function finishGame(g) {
  g.finished = true;
  g.finishHoldUntil = performance.now() + 600;
  persistBaseballResults(g);
  // Debug hook for the smoke tests — set a window-global when the
  // game ends so the test can reliably detect it without trying to
  // read pixels from a partially-rendered overlay. Only fires if the
  // URL contains ?bbdebug — production users never see this.
  if (typeof window !== "undefined" && window.location && /bbdebug/.test(window.location.search)) {
    window.__bbFinished = {
      runs: { home: g.runs.home, away: g.runs.away },
      inning: g.inning, half: g.half,
      stats: Object.assign({}, g.stats),
      mode: g.mode,
    };
  }
}

// Save lifetime stats. Mirrors the QB Challenge / Field Goal patterns.
function persistBaseballResults(g) {
  const b = save.baseballBest = save.baseballBest || {};
  const playerWon = g.runs.home > g.runs.away;
  const playerLost = g.runs.home < g.runs.away;
  if (g.mode === "cpu") {
    // Win/loss only tracks CPU games (PVP doesn't have a "player team"
    // in a recordable sense).
    if (playerWon) {
      b.wins = (b.wins || 0) + 1;
      const margin = g.runs.home - g.runs.away;
      if (margin > (b.biggestWinMargin || 0)) b.biggestWinMargin = margin;
    } else if (playerLost) {
      b.losses = (b.losses || 0) + 1;
    }
  }
  const maxScore = Math.max(g.runs.home, g.runs.away);
  if (maxScore > (b.bestScore || 0)) b.bestScore = maxScore;
  b.hits = (b.hits || 0) + g.stats.hits;
  b.homeRuns = (b.homeRuns || 0) + g.stats.homeRuns;
  b.strikeoutsThrown = (b.strikeoutsThrown || 0) + g.stats.strikeoutsThrown;
  b.strikeoutsTaken = (b.strikeoutsTaken || 0) + g.stats.strikeoutsTaken;
  b.inningsPlayed = (b.inningsPlayed || 0) + g.stats.halvesPlayed;
  persistSave();
}

function firePitch(g) {
  if (!g.armedPitch) return;
  g.ball = buildPitch(g.armedPitch, g.aimX, g.aimY);
  g.phase = "pitch";
  g.phaseT = 0;
  g.pendingSwing = null;
  Sound.whistle && Sound.whistle();   // placeholder pitch "whoosh" — Phase 6 swaps
  // Release haptic — a single firm tick. Skipped for CPU-pitcher fires
  // (no human just acted) by checking role.
  if (g.role === "pitching") haptic("click");
  // PVP mode: the pitcher just fired; flip control to the batter for
  // the incoming swing. (In CPU mode the role stays as-is — the CPU
  // batter resolves itself in the update loop.) We remember the
  // pitching role so we can flip back for the NEXT pitch.
  if (g.mode === "pvp") {
    g._pvpPitcherRole = g.role;       // remember (always "pitching" in current impl)
    g.role = "batting";
  }
}

// Resolve a Phase-2 at-bat outcome from the CPU swing decision + the
// pitch's plate location. Updates count/outs/bases, sets the outcome
// banner, and transitions to "resolve".
function resolveAtBatPhase2(g) {
  const b = g.ball;
  const swing = g.pendingSwing;
  const inZone = isStrike(b.plateX, b.plateY);
  let outcome;                  // string consumed by applyPitchToCount
  let label, color, sub = "";
  if (swing === "take") {
    outcome = inZone ? "called-strike" : "ball";
    label = inZone ? "STRIKE" : "BALL";
    color = inZone ? outcomeColor("called-strike") : outcomeColor("ball");
    sub   = `${b.pitch.name}  ·  ${inZone ? "in the zone" : "outside"}`;
  } else if (swing === "swing-miss") {
    outcome = "swinging-strike";
    label = "SWING & MISS";
    color = outcomeColor("swinging-strike");
    sub = `${b.pitch.name}`;
  } else if (swing === "swing-foul") {
    outcome = "foul";
    label = "FOUL BALL";
    color = outcomeColor("foul");
  } else {
    // Contact — transition to the FIELD phase. The hit ball is built
    // from the swing quality bucket + a bit of randomness for the
    // launch / spray angles. The fielder simulation then runs in the
    // "field" phase, with the outcome (out / single / double / HR)
    // computed from where the ball lands and which fielder gets there
    // first.
    const bucket = swing === "swing-weak" ? "weak"
                  : swing === "swing-solid" ? "solid"
                  : "barrel";
    startFieldPhase(g, bucket);
    return;
  }

  // Non-contact branch — advance count + check for walk/strikeout.
  const status = applyPitchToCount(g.count, outcome);
  if (status === "strikeout") {
    g.outs += 1;
    if (g.role === "batting") g.stats.strikeoutsTaken += 1;
    else                      g.stats.strikeoutsThrown += 1;
    setResolve(g, "STRIKEOUT", `${g.outs} ${g.outs === 1 ? "out" : "outs"}`,
      outcomeColor("strikeout"), RESOLVE_HOLD_BIG, /* endsAtBat */ true);
    Sound.groan && Sound.groan();
    // Strikeout haptic depends on which side won: batting-side K = fail
    // pattern; pitching-side K = success pattern.
    haptic(g.role === "batting" ? "fail" : "success");
    g.lastOutcomeKind = "strikeout";
  } else if (status === "walk") {
    const walkRuns = advanceRunners(g, 0);
    let walkSub = "Runner on base";
    if (walkRuns > 0) {
      const team = g.half === "top" ? "away" : "home";
      g.runs[team] += walkRuns;
      g.score = g.runs.home;
      walkSub = `Bases loaded! +${walkRuns} run`;
      Sound.cheer && Sound.cheer(false);
    }
    setResolve(g, "WALK", walkSub, outcomeColor("walk"),
      RESOLVE_HOLD_CONTACT, /* endsAtBat */ true);
    g.lastOutcomeKind = "walk";
  } else {
    // Non-terminating pitch outcome — ball, called/swinging-strike with
    // <3, or foul. Count was already advanced; the at-bat continues.
    setResolve(g, label, sub, color,
      RESOLVE_HOLD_DEFAULT, /* endsAtBat */ false);
    g.lastOutcomeKind = outcome;
  }
}

function setResolve(g, label, sub, color, hold, endsAtBat) {
  g.outcomeText = label;
  g.outcomeSub = sub;
  g.outcomeColor = color;
  g.outcomeHoldT = hold;
  g.phase = "resolve";
  g.phaseT = 0;
  // endsAtBat distinguishes "this pitch finished the plate appearance"
  // (walk / strikeout / contact) from "pitch outcome doesn't end the
  // at-bat" (ball / strike / foul with <2 strikes). Default = true so
  // older callers don't accidentally cycle the at-bat forever.
  g._endsAtBat = (endsAtBat !== false);
}

// Pointer → pitch-chip hit-test.
function chipHit(g, x, y) {
  if (!g._pitchChipRects) return null;
  for (const r of g._pitchChipRects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
  }
  return null;
}

// Convert the player's drag to a plate-plane aim point. The drag start
// position becomes the origin; the delta steers the aim. The zone
// half-width / height set the gain so a comfortable thumb swipe covers
// the whole zone without needing the full screen.
function dragToAim(g) {
  const dx = (g.dragNow.x - g.dragStart.x);
  const dy = (g.dragNow.y - g.dragStart.y);
  // 220px of drag covers a meter at the plate — feels good on a phone.
  const gain = 1 / 220;
  // Y is screen-down = world-down (so dragging up raises the aim).
  return {
    x: clamp(dx * gain, -0.55, 0.55),
    y: clamp((PLATE_TOP + PLATE_BOTTOM) / 2 + (-dy) * gain, PLATE_BOTTOM - 0.20, PLATE_TOP + 0.20),
  };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// Convert "#rrggbb" to "rgba(r, g, b, a)". Used to tint press feedback
// to a chip's pitch-type color so the tap reads as "yes, this is now
// armed".
function hexToRgba(hex, alpha) {
  const m = (hex || "#ffffff").replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) || 255;
  const g = parseInt(m.slice(2, 4), 16) || 255;
  const b = parseInt(m.slice(4, 6), 16) || 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha ?? 1})`;
}

// ──────────────────────────────────────────────────────────────────────
// HUD — scoreboard strip. Each cell value is wrapped in a cheap "pop"
// animation: when the rendered string changes between frames, we
// kick the cell into a 0.40s scale-pulse (easeOutBack overshoot) so
// changes draw the eye instead of just swapping.
// ──────────────────────────────────────────────────────────────────────
const HUD_POP_DUR = 0.40;
function drawHudStrip(g) {
  const padX = 14;
  const padY = 12;
  const h = 38;
  const totalW = W - padX * 2;
  ctx.fillStyle = "rgba(11, 13, 22, 0.78)";
  ctx.fillRect(padX, padY, totalW, h);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, padY, totalW, h);

  ctx.textAlign = "center";
  const cells = [
    { key: "away",  label: "AWAY", value: String(g.runs.away) },
    { key: "home",  label: "HOME", value: String(g.runs.home) },
    { key: "inn",   label: "INN",  value: `${g.half === "top" ? "T" : "B"}${g.inning}` },
    { key: "outs",  label: "OUTS", value: outsGlyph(g.outs) },
    { key: "bs",    label: "B-S",  value: `${g.count.balls}-${g.count.strikes}` },
    { key: "bases", label: "BASES",value: basesGlyph(g.bases) },
  ];
  // Lazy-init pop tracker. Stores last-seen value per key and a
  // popUntil performance.now() for each freshly-changed cell.
  if (!g._hudPop) g._hudPop = {};
  const cellW = totalW / cells.length;
  const now = performance.now();
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const prev = g._hudPop[c.key];
    if (!prev || prev.value !== c.value) {
      g._hudPop[c.key] = { value: c.value, popStart: now };
    }
    const popT = (now - g._hudPop[c.key].popStart) / 1000;   // seconds
    const popK = popT < HUD_POP_DUR
      ? 1 + 0.25 * (1 - ease(popT / HUD_POP_DUR, "easeOutQuint"))
      : 1;
    const cx = padX + cellW * i;
    if (i > 0) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
      ctx.beginPath();
      ctx.moveTo(cx, padY + 4); ctx.lineTo(cx, padY + h - 4); ctx.stroke();
    }
    ctx.fillStyle = "rgba(190, 200, 220, 0.85)";
    ctx.font = "bold 9px ui-monospace, monospace";
    ctx.fillText(c.label, cx + cellW / 2, padY + 14);
    // Scale-pulse the value by drawing at a transient larger font.
    const fontPx = Math.round(16 * popK);
    ctx.fillStyle = popK > 1.01 ? "#ffe680" : "#fff";   // brief gold flash too
    ctx.font = `bold ${fontPx}px ui-monospace, monospace`;
    ctx.fillText(c.value, cx + cellW / 2, padY + 30);
  }
  ctx.textAlign = "start";
}

function outsGlyph(outs) {
  const n = Math.max(0, Math.min(3, outs));
  return "●".repeat(n) + "○".repeat(3 - n);
}

function basesGlyph(bases) {
  return (bases.third  ? "◆" : "◇")
       + (bases.second ? "◆" : "◇")
       + (bases.first  ? "◆" : "◇");
}

// ──────────────────────────────────────────────────────────────────────
// HALF-END overlay — pass-device card in PVP, short interlude in CPU.
// Shows the inning that's about to start so the player knows what's
// coming when control resumes.
// ──────────────────────────────────────────────────────────────────────
function drawHalfEndOverlay(g) {
  const total = g.halfEndHoldT || 1.6;
  const t = Math.min(1, g.phaseT / total);
  // Fade-in / fade-out envelope.
  const a = t < 0.15 ? (t / 0.15)
          : t > 0.85 ? Math.max(0, (1 - t) / 0.15)
          : 1;
  if (a <= 0) return;
  ctx.save();
  ctx.fillStyle = `rgba(7, 9, 18, ${0.78 * a})`;
  ctx.fillRect(0, 0, W, H);
  // Card
  const cardW = Math.min(330, W - 28);
  const cardH = 200;
  const cardX = W / 2 - cardW / 2;
  const cardY = H * 0.36;
  ctx.fillStyle = `rgba(11, 13, 22, ${0.92 * a})`;
  ctx.strokeStyle = `rgba(248, 213, 106, ${0.55 * a})`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(cardX, cardY, cardW, cardH, 12);
  else ctx.rect(cardX, cardY, cardW, cardH);
  ctx.fill(); ctx.stroke();
  ctx.textAlign = "center";
  // Header — PVP "pass device" vs CPU "next half"
  ctx.fillStyle = `rgba(248, 213, 106, ${a})`;
  ctx.font = "bold 22px ui-monospace, monospace";
  ctx.fillText(g.mode === "pvp" ? "PASS DEVICE" : "NEXT HALF", W / 2, cardY + 38);
  // Inning marker
  const nextHalf = g._nextHalf || g.half;
  const nextInning = g._nextInning || g.inning;
  ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
  ctx.font = "bold 30px ui-monospace, monospace";
  ctx.fillText(`${nextHalf === "top" ? "TOP" : "BOT"} ${nextInning}`, W / 2, cardY + 84);
  // Score
  ctx.fillStyle = `rgba(207, 214, 227, ${0.92 * a})`;
  ctx.font = "bold 14px ui-monospace, monospace";
  ctx.fillText(`AWAY ${g.runs.away}   ·   HOME ${g.runs.home}`, W / 2, cardY + 116);
  // Who's up next (PVP-specific)
  if (g.mode === "pvp") {
    ctx.fillStyle = `rgba(190, 200, 220, ${0.85 * a})`;
    ctx.font = "bold 12px ui-monospace, monospace";
    const upText = nextHalf === "top"
      ? "Player 1 bats  ·  Player 2 pitches"
      : "Player 2 bats  ·  Player 1 pitches";
    ctx.fillText(upText, W / 2, cardY + 144);
  } else {
    ctx.fillStyle = `rgba(190, 200, 220, ${0.85 * a})`;
    ctx.font = "bold 12px ui-monospace, monospace";
    const youAre = g._nextRole === "batting" ? "You bat" : "You pitch";
    ctx.fillText(youAre, W / 2, cardY + 144);
  }
  // Countdown ticks
  const ticksTotal = 3;
  const ticksElapsed = Math.floor(t * ticksTotal);
  for (let i = 0; i < ticksTotal; i++) {
    const tx = W / 2 - 30 + i * 30;
    const ty = cardY + 174;
    ctx.fillStyle = (i < ticksElapsed)
      ? `rgba(248, 213, 106, ${a})`
      : `rgba(248, 213, 106, ${0.18 * a})`;
    ctx.beginPath();
    ctx.arc(tx, ty, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = "start";
  ctx.restore();
}

// ──────────────────────────────────────────────────────────────────────
// GAME-END panel — final score, stat card with this-game / lifetime
// rows, NEW BEST badges, Play Again / Menu buttons. Mirrors the QB
// Challenge finale's layout.
// ──────────────────────────────────────────────────────────────────────
function drawBaseballFinishedOverlay(g) {
  const heldFor = Math.max(0, performance.now() - ((g.finishHoldUntil || 0) - 600));
  // Backdrop
  const bgA = Math.min(0.82, heldFor / 240 * 0.82);
  ctx.fillStyle = `rgba(7, 9, 18, ${bgA})`;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";

  // FINAL header
  const titleA = Math.min(1, heldFor / 240);
  const titleEase = ease(titleA, "easeOutBack");
  const titleY = H * 0.12 - (1 - titleEase) * 22;
  ctx.fillStyle = `rgba(248, 213, 106, ${titleA})`;
  ctx.font = "bold 28px ui-monospace, monospace";
  ctx.fillText("FINAL", W / 2, titleY);

  // Winner / loser sub-headline (CPU mode only).
  if (g.mode === "cpu") {
    const playerWon = g.runs.home > g.runs.away;
    const tied = g.runs.home === g.runs.away;
    const subText = tied ? "TIE GAME" : playerWon ? "VICTORY" : "DEFEAT";
    const subColor = tied ? "#cfd6e3" : playerWon ? "#4ddc8c" : "#ff5470";
    ctx.fillStyle = `rgba(${hexRgb(subColor)}, ${titleA})`;
    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.fillText(subText, W / 2, titleY + 26);
  }

  // Big score line
  const scoreA = Math.min(1, Math.max(0, (heldFor - 160) / 240));
  ctx.fillStyle = `rgba(255, 230, 138, ${scoreA})`;
  ctx.font = "bold 72px ui-monospace, monospace";
  ctx.fillText(`${g.runs.away}  -  ${g.runs.home}`, W / 2, H * 0.27);
  ctx.fillStyle = `rgba(190, 200, 220, ${scoreA})`;
  ctx.font = "bold 12px ui-monospace, monospace";
  ctx.fillText("AWAY                 HOME", W / 2, H * 0.30);

  // NEW BEST badge — checks ALL of bestScore / biggestWinMargin / etc.
  const b = save.baseballBest || {};
  const winMargin = g.runs.home - g.runs.away;
  const newBestScore = Math.max(g.runs.home, g.runs.away) >= (b.bestScore || 0);
  const newWinMargin = g.mode === "cpu" && winMargin > 0 && winMargin >= (b.biggestWinMargin || 0);
  const showBadge = newBestScore || newWinMargin;
  if (showBadge) {
    const badgeA = Math.min(1, Math.max(0, (heldFor - 400) / 240));
    const pulse = 1 + 0.06 * Math.sin(performance.now() / 220);
    ctx.save();
    ctx.translate(W / 2, H * 0.345);
    ctx.scale(pulse, pulse);
    const bw = 150, bh = 26;
    ctx.fillStyle = `rgba(248, 213, 106, ${badgeA * 0.18})`;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 6);
    else ctx.rect(-bw / 2, -bh / 2, bw, bh);
    ctx.fill();
    ctx.strokeStyle = `rgba(248, 213, 106, ${badgeA})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = `rgba(255, 230, 138, ${badgeA})`;
    ctx.font = "bold 12px ui-monospace, monospace";
    ctx.fillText("NEW PERSONAL BEST", 0, 4);
    ctx.restore();
  }

  // Stat card
  const cardY = H * 0.42;
  const cardH = 168;
  const cardW = Math.min(330, W - 28);
  const cardX = W / 2 - cardW / 2;
  const cardA = Math.min(1, Math.max(0, (heldFor - 500) / 240));
  ctx.save();
  ctx.globalAlpha = cardA;
  ctx.fillStyle = "rgba(11, 13, 22, 0.85)";
  ctx.strokeStyle = "rgba(248, 213, 106, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(cardX, cardY, cardW, cardH, 10);
  else ctx.rect(cardX, cardY, cardW, cardH);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(190, 200, 220, 0.75)";
  ctx.font = "bold 10px ui-monospace, monospace";
  ctx.fillText("THIS GAME",   cardX + cardW * 0.27, cardY + 18);
  ctx.fillText("LIFETIME",    cardX + cardW * 0.73, cardY + 18);
  ctx.strokeStyle = "rgba(248, 213, 106, 0.20)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX + cardW / 2, cardY + 28);
  ctx.lineTo(cardX + cardW / 2, cardY + cardH - 10);
  ctx.stroke();
  ctx.restore();

  // Stat rows
  const lt = save.baseballBest || {};
  const rows = [
    { label: "HITS",       round: String(g.stats.hits),             life: String(lt.hits || 0) },
    { label: "HOME RUNS",  round: String(g.stats.homeRuns),         life: String(lt.homeRuns || 0) },
    { label: "Ks (THROWN)",round: String(g.stats.strikeoutsThrown), life: String(lt.strikeoutsThrown || 0) },
    { label: g.mode === "cpu" ? "RECORD" : "INN PLAYED",
      round: g.mode === "cpu" ? `${(lt.wins || 0)}-${(lt.losses || 0)}` : String(g.stats.halvesPlayed),
      life:  g.mode === "cpu" ? `Best win +${lt.biggestWinMargin || 0}` : String(lt.inningsPlayed || 0) },
  ];
  const rowGap = 26;
  const rowY0 = cardY + 50;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowA = ease(
      Math.min(1, Math.max(0, (heldFor - 620 - i * 110) / 220)),
      "easeInOutQuad"
    );
    if (rowA <= 0) continue;
    const y = rowY0 + i * rowGap;
    ctx.fillStyle = `rgba(255, 255, 255, ${rowA})`;
    ctx.font = "bold 17px ui-monospace, monospace";
    ctx.fillText(r.round, cardX + cardW * 0.22, y);
    ctx.fillStyle = `rgba(190, 200, 220, ${rowA * 0.80})`;
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.fillText(r.label, W / 2, y - 1);
    ctx.fillStyle = `rgba(190, 200, 220, ${rowA})`;
    ctx.font = "bold 17px ui-monospace, monospace";
    ctx.fillText(r.life, cardX + cardW * 0.78, y);
  }

  // Buttons
  const bw = Math.min(190, W * 0.42);
  const bh = 56;
  const gap = 16;
  const cy = H * 0.78;
  g._btnPlayAgain = { x: W / 2 - bw - gap / 2, y: cy, w: bw, h: bh };
  g._btnMenu      = { x: W / 2 + gap / 2,      y: cy, w: bw, h: bh };
  const btnA = Math.min(1, Math.max(0, (heldFor - 1080) / 240));
  for (const [btn, label, fill] of [
    [g._btnPlayAgain, "Play Again ▶", "#f8d56a"],
    [g._btnMenu,      "Menu",          "#2a3350"],
  ]) {
    ctx.globalAlpha = btnA;
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 12);
    else ctx.rect(btn.x, btn.y, btn.w, btn.h);
    ctx.fill();
    ctx.fillStyle = label === "Menu" ? "#fff" : "#1a1206";
    ctx.font = "bold 18px ui-monospace, monospace";
    ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2 + 6);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "start";
}

// Hex -> "r,g,b" for use in rgba() strings.
function hexRgb(hex) {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const gg = parseInt(m.slice(2, 4), 16);
  const bb = parseInt(m.slice(4, 6), 16);
  return `${r}, ${gg}, ${bb}`;
}

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
import {
  PITCH_TYPES, pitchById, buildPitch, stepPitch, isStrike,
  PLATE_Z, PLATE_TOP, PLATE_BOTTOM, PLATE_HALF_W, BALL_RELEASE_Y,
} from "./pitches.js";
import { applyPitchToCount, classifyPhase2Contact, advanceRunners } from "./rules.js";
import { cpuBatterDecision, cpuPitcherChoice } from "./cpu.js";
import {
  drawPitcherView, drawPitchChips, drawPitcherPrompt, drawOutcomeBanner,
  drawBatterView, drawBatterPrompt,
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
    };
  },


  onPlayAgain(prev) {
    return Baseball.init({ mode: prev.mode, innings: prev.innings });
  },

  payout(g) {
    // Phase 5 turns this into a meaningful number based on win + margin.
    return 0;
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
      case "resolve": {
        if (g.phaseT >= g.outcomeHoldT) {
          // Phase 5 will transition to HALF_END / GAME_END here. Phase
          // 3 keeps Phase 2's behavior: cycle outs at 3, then in CPU
          // mode flip the role between pitching and batting so the
          // player sees both sides over the course of a session.
          if (g.outs >= 3) {
            g.outs = 0;
            g.bases = { first: null, second: null, third: null };
            g.stats.halvesPlayed += 1;
            // Flip half (top/bottom) and re-derive the role. Phase 5
            // will also handle inning advancement + the pass-device
            // overlay in PVP mode.
            g.half = g.half === "top" ? "bottom" : "top";
            g.role = roleFor(g.mode, g.half);
          }
          startNewBatter(g);
        }
        break;
      }
    }
  },

  // ──────────────────────────────────────────────────────────────────
  // RENDER — branches on role. The HUD strip + outcome banner are
  // shared between roles.
  // ──────────────────────────────────────────────────────────────────
  render(g) {
    if (g.role === "batting") {
      drawBatterView(g);
      drawBatterPrompt(g);
    } else {
      drawPitcherView(g);
      drawPitchChips(g, PITCH_TYPES);
      drawPitcherPrompt(g);
    }
    drawOutcomeBanner(g);
    drawHudStrip(g);
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
      g.swingAnimT = 0.25;
      resolveBatterSwing(g);
    }
  } else if (kind === "move") {
    if (g.dragStart) g.dragNow = { x, y };
  } else if (kind === "up") {
    g.dragStart = null;
    g.dragNow = null;
  }
}

// CPU pitcher tick — when the player is batting, the CPU picks a pitch
// + aim and fires after a short delay between at-bats so the player
// can read the situation.
function tickBatterPresnap(g) {
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

// Re-project ball into batter view. We can't import from draw.js
// without a circular dep risk, so we compute locally using the same
// formula as projectFromBatter().
const _BATTER_FOCAL = 600;
const _BATTER_CAM_H = 1.65;
const _BATTER_CAM_Z_LOCAL = PLATE_Z + 0.6;
function ballScreenInBatterView(b) {
  const zz = Math.max(0.5, _BATTER_CAM_Z_LOCAL - b.z);
  return {
    sx: W / 2 + (-b.x) * _BATTER_FOCAL / zz,
    sy: H * 0.55 + (_BATTER_CAM_H - b.y) * _BATTER_FOCAL / zz,
  };
}

// ──────────────────────────────────────────────────────────────────────
// At-bat helpers
// ──────────────────────────────────────────────────────────────────────

function startNewBatter(g) {
  g.count = { balls: 0, strikes: 0 };
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
}

function firePitch(g) {
  if (!g.armedPitch) return;
  g.ball = buildPitch(g.armedPitch, g.aimX, g.aimY);
  g.phase = "pitch";
  g.phaseT = 0;
  g.pendingSwing = null;
  Sound.whistle && Sound.whistle();   // placeholder pitch "whoosh" — Phase 6 swaps
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
    // Contact — Phase 2 resolves to a hit-type roll. Phase 4 replaces
    // this with the real ball-off-bat + fielder simulation.
    const bucket = swing === "swing-weak" ? "weak"
                  : swing === "swing-solid" ? "solid"
                  : "barrel";
    const result = classifyPhase2Contact(bucket);
    if (result.kind === "out") {
      g.outs += 1;
      label = "OUT";
      color = outcomeColor("out");
      sub = result.label;
    } else {
      const runs = advanceRunners(g, result.bases);
      // Stats credit the PLAYER team only — these surface on the
      // lifetime-best save record on the game-end panel.
      const playerHit = (g.role === "batting");
      if (playerHit) {
        g.stats.hits += 1;
        if (result.kind === "home-run") g.stats.homeRuns += 1;
      }
      label = result.label;
      color = outcomeColor(result.kind);
      if (runs > 0) {
        // The team batting this half-inning scores. Top = AWAY batting,
        // bottom = HOME batting.
        const team = g.half === "top" ? "away" : "home";
        g.runs[team] += runs;
        // Mirror into the legacy flat `score` field so the dispatcher's
        // settleMinigame / payout reads remain safe — keep it as the
        // PLAYER team's run total (home) so the cash payout reflects
        // how the player's side did.
        g.score = g.runs.home;
        sub = `+${runs} run${runs === 1 ? "" : "s"}`;
        Sound.cheer && Sound.cheer(result.kind === "home-run");
      } else {
        sub = "Runner on base";
      }
    }
    // Skip count handling — contact ends the atbat.
    g.lastOutcomeKind = result.kind;
    setResolve(g, label, sub, color,
      result.kind === "home-run" ? RESOLVE_HOLD_BIG : RESOLVE_HOLD_CONTACT);
    return;
  }

  // Non-contact branch — advance count + check for walk/strikeout.
  const status = applyPitchToCount(g.count, outcome);
  if (status === "strikeout") {
    g.outs += 1;
    // Stat goes to whoever DELIVERED the result. When the player is
    // batting, a K is a strikeoutTaken; when the player is pitching,
    // it's a strikeoutThrown.
    if (g.role === "batting") g.stats.strikeoutsTaken += 1;
    else                      g.stats.strikeoutsThrown += 1;
    setResolve(g, "STRIKEOUT", `${g.outs} ${g.outs === 1 ? "out" : "outs"}`,
      outcomeColor("strikeout"), RESOLVE_HOLD_BIG);
    Sound.groan && Sound.groan();
    g.lastOutcomeKind = "strikeout";
  } else if (status === "walk") {
    advanceRunners(g, 0);    // walk = forced advance only
    setResolve(g, "WALK", "Runner on base", outcomeColor("walk"), RESOLVE_HOLD_CONTACT);
    g.lastOutcomeKind = "walk";
  } else {
    setResolve(g, label, sub, color, RESOLVE_HOLD_DEFAULT);
    g.lastOutcomeKind = outcome;
  }
}

function setResolve(g, label, sub, color, hold) {
  g.outcomeText = label;
  g.outcomeSub = sub;
  g.outcomeColor = color;
  g.outcomeHoldT = hold;
  g.phase = "resolve";
  g.phaseT = 0;
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

// ──────────────────────────────────────────────────────────────────────
// HUD — scoreboard strip
// ──────────────────────────────────────────────────────────────────────
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
    { label: "AWAY", value: String(g.runs.away) },
    { label: "HOME", value: String(g.runs.home) },
    { label: "INN",  value: `${g.inning}${g.half === "top" ? "▲" : "▼"}` },
    { label: "OUTS", value: outsGlyph(g.outs) },
    { label: "B-S",  value: `${g.count.balls}-${g.count.strikes}` },
    { label: "BASES",value: basesGlyph(g.bases) },
  ];
  const cellW = totalW / cells.length;
  for (let i = 0; i < cells.length; i++) {
    const cx = padX + cellW * i;
    if (i > 0) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
      ctx.beginPath();
      ctx.moveTo(cx, padY + 4); ctx.lineTo(cx, padY + h - 4); ctx.stroke();
    }
    ctx.fillStyle = "rgba(190, 200, 220, 0.85)";
    ctx.font = "bold 9px ui-monospace, monospace";
    ctx.fillText(cells[i].label, cx + cellW / 2, padY + 14);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px ui-monospace, monospace";
    ctx.fillText(cells[i].value, cx + cellW / 2, padY + 30);
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
// Game-end overlay — phase 5 wires the real stats. Phase 2 reuses the
// stub from Phase 1.
// ──────────────────────────────────────────────────────────────────────
function drawBaseballFinishedOverlay(g) {
  const heldFor = Math.max(0, performance.now() - ((g.finishHoldUntil || 0) - 600));
  const bgA = Math.min(0.78, heldFor / 240 * 0.78);
  ctx.fillStyle = `rgba(7, 9, 18, ${bgA})`;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  const titleA = Math.min(1, heldFor / 240);
  const titleEase = ease(titleA, "easeOutBack");
  const titleY = H * 0.18 - (1 - titleEase) * 22;
  ctx.fillStyle = `rgba(248, 213, 106, ${titleA})`;
  ctx.font = "bold 30px ui-monospace, monospace";
  ctx.fillText("FINAL", W / 2, titleY);
  const scoreA = Math.min(1, Math.max(0, (heldFor - 120) / 240));
  ctx.fillStyle = `rgba(255, 230, 138, ${scoreA})`;
  ctx.font = "bold 64px ui-monospace, monospace";
  ctx.fillText(`${g.runs.away}  -  ${g.runs.home}`, W / 2, H * 0.32);
  ctx.fillStyle = `rgba(190, 200, 220, ${scoreA})`;
  ctx.font = "bold 12px ui-monospace, monospace";
  ctx.fillText("AWAY            HOME", W / 2, H * 0.36);
  const bw = Math.min(190, W * 0.42);
  const bh = 56;
  const gap = 16;
  const cy = H * 0.70;
  g._btnPlayAgain = { x: W / 2 - bw - gap / 2, y: cy, w: bw, h: bh };
  g._btnMenu      = { x: W / 2 + gap / 2,      y: cy, w: bw, h: bh };
  const btnA = Math.min(1, Math.max(0, (heldFor - 400) / 240));
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

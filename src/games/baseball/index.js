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
      // Phase 2: the player is always pitching. Phase 3 adds the
      // batter side and alternates based on inning + mode.
      role: "pitching",
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
  // INPUT
  // ──────────────────────────────────────────────────────────────────
  handlePointer(g, kind, x, y) {
    if (g.finished) return;
    // Drag tracking — used for the aim crosshair regardless of phase.
    if (kind === "down") {
      // Pitch chip hit-test takes priority over starting a drag.
      if (g.phase === "presnap" || g.phase === "aim") {
        const hit = chipHit(g, x, y);
        if (hit) {
          g.armedPitch = pitchById(hit.pitchId);
          Sound.click && Sound.click();
          // Pre-fill aim to a sensible default (top of zone, center)
          // so a quick tap+release without much drag still launches a
          // meaningful pitch.
          g.aimX = 0;
          g.aimY = (PLATE_TOP + PLATE_BOTTOM) / 2;
          return;
        }
      }
      g.dragStart = { x, y, t: performance.now() };
      g.dragNow = { x, y };
      // Begin aim phase only if a pitch is armed.
      if (g.armedPitch && g.phase === "presnap") {
        g.phase = "aim";
        g.phaseT = 0;
      }
    } else if (kind === "move") {
      if (!g.dragStart) return;
      g.dragNow = { x, y };
      if (g.phase === "aim") {
        // Translate the drag delta to a plate-plane aim point. The
        // crosshair starts at zone center; the drag biases it within
        // a generous aim window. We allow the aim to drift OUTSIDE
        // the strike zone so the player can intentionally throw balls.
        const aim = dragToAim(g);
        g.aimX = aim.x;
        g.aimY = aim.y;
      }
    } else if (kind === "up") {
      if (g.phase === "aim" && g.armedPitch) {
        // Final-aim sample before release.
        const aim = dragToAim(g);
        g.aimX = aim.x;
        g.aimY = aim.y;
        firePitch(g);
      }
      g.dragStart = null;
      g.dragNow = null;
    }
  },

  // ──────────────────────────────────────────────────────────────────
  // UPDATE — per-frame tick
  // ──────────────────────────────────────────────────────────────────
  update(g, dt) {
    g.time += dt;
    g.phaseT += dt;

    switch (g.phase) {
      case "presnap":
      case "aim":
        // Idle — wait for input.
        break;
      case "pitch": {
        // Integrate the ball. When it reaches the plate, generate a
        // CPU batter decision; resolve happens a tick later so the
        // ball is visibly AT the plate when the outcome locks in.
        if (g.ball) {
          stepPitch(g.ball, dt);
          if (g.ball.landedAtPlate && !g.pendingSwing) {
            g.pendingSwing = cpuBatterDecision(g.ball, g.count);
            g.swingDecidedAt = g.phaseT;
          }
          // Tiny pause after the swing decision before we transition,
          // so the ball renders at the plate for a beat.
          if (g.pendingSwing && (g.phaseT - g.swingDecidedAt) >= SWING_DECIDE_T) {
            resolveAtBatPhase2(g);
          }
        } else {
          // Defensive — shouldn't be in pitch with no ball; revert.
          g.phase = "presnap"; g.phaseT = 0;
        }
        break;
      }
      case "resolve": {
        if (g.phaseT >= g.outcomeHoldT) {
          // Phase 5 transitions to HALF_END / GAME_END here. Phase 2
          // just loops a new batter, capped at 3 outs (and we cycle
          // outs back to 0 without switching sides yet so the placeholder
          // half-inning marker isn't misleading).
          if (g.outs >= 3) {
            // Phase 5 will switch sides. For Phase 2 we just reset outs
            // and bases so the count cycle keeps the demo interesting.
            g.outs = 0;
            g.bases = { first: null, second: null, third: null };
            g.stats.halvesPlayed += 1;
          }
          startNewBatter(g);
        }
        break;
      }
    }
  },

  // ──────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────
  render(g) {
    drawPitcherView(g);
    drawPitchChips(g, PITCH_TYPES);
    drawPitcherPrompt(g);
    drawOutcomeBanner(g);
    drawHudStrip(g);
  },

  renderFinished(g) {
    drawBaseballFinishedOverlay(g);
  },
};

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
      g.stats.hits += 1;
      if (result.kind === "home-run") g.stats.homeRuns += 1;
      label = result.label;
      color = outcomeColor(result.kind);
      if (runs > 0) {
        g.runs.home += runs;
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
    g.stats.strikeoutsThrown += 1;
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

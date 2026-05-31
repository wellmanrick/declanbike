// Declan Baseball — top-level baseball game.
//
// Reachable from the main menu (not the Mini-Games hub). Uses the
// existing MINIGAMES dispatch contract so the canvas pointer routing,
// pause/resume, and game-over hooks all light up automatically. The
// only main.js touchpoints are: a Baseball button on the main menu, a
// `baseball-menu` overlay for mode + innings select, and a startBaseball
// helper that bypasses startMinigame's level-resolution path so the
// chosen config flows into init() cleanly.
//
// Phase 1 (this file): plumbing only.
//   - init({ mode, innings }) builds the runtime
//   - update() / render() draw a placeholder first-person field
//   - renderFinished() draws a stub FINAL panel with Play Again / Menu
//   - handlePointer() is wired but unused until Phase 2
//   - onPlayAgain() preserves the chosen mode + innings across replays
//   - menuTarget tells the dispatcher to return to the MAIN menu (not
//     the Mini-Games hub) when the player taps Menu after a game
//
// Phases 2-5 will fill in the actual pitcher / batter / fielding / scoring
// behind the same exported surface. See plans/smooth-exploring-wilkinson.md.

import { ctx, W, H, ease } from "../../engine/canvas.js";
import { Sound } from "../../engine/audio.js";
import { save, persistSave } from "../../engine/save.js";
import {
  fpSetCam, fpHorizonY, fpProject, fpDrawSky, fpDrawField,
} from "../../engine/fpView.js";

// Default config values. The mode-select overlay supplies these; this
// table guards against the (unexpected) case where init() is called
// with no config — e.g. someone wired the dispatcher's generic Play
// Again path before onPlayAgain landed.
const DEFAULTS = { mode: "cpu", innings: 3 };

export const Baseball = {
  // ----- MINIGAMES contract metadata. These are required so the
  // contract sanity check at module load doesn't warn; they're not
  // actually surfaced anywhere (baseball isn't in the Mini-Games hub).
  name: "Baseball",
  desc: "Pitch, hit, and field your way through a real ball game.",
  icon: "⚾",
  color: "#f8d56a",

  // The dispatcher routes the Menu game-over button to this destination
  // instead of the default (Mini-Games hub).
  menuTarget: "menu",

  init(config) {
    const cfg = Object.assign({}, DEFAULTS, config || {});
    const innings = (cfg.innings === 5 || cfg.innings === 9) ? cfg.innings : 3;
    const mode = (cfg.mode === "pvp") ? "pvp" : "cpu";
    return {
      gameId: "baseball",
      // Persisted config — read by render(), onPlayAgain(), the scoreboard,
      // and the game-end persistence step.
      mode, innings,
      // Wall-clock timer for animations. The MINIGAMES dispatcher does NOT
      // advance this for us; render() reads it for parallax / pulse effects.
      time: 0,
      // Top-level state machine. Phase 1 sits on "warmup" forever; Phase 2
      // adds PITCH / SWING / RESOLVE / HALF_END / GAME_END.
      phase: "warmup", phaseT: 0,
      // The dispatcher reads `g.score` as a flat number (settleMinigame
      // pushes `g.score` into save.minigameBest and computes the default
      // payout from it). We track runs as a {home,away} pair separately,
      // and Phase 5 will mirror the player-team total into `score` so the
      // legacy paths stay safe.
      score: 0,
      runs: { home: 0, away: 0 },
      inning: 1, half: "top",
      outs: 0,
      count: { balls: 0, strikes: 0 },
      bases: { first: null, second: null, third: null },
      // Per-half stats used by the game-end panel.
      stats: {
        hits: 0, homeRuns: 0,
        strikeoutsThrown: 0, strikeoutsTaken: 0,
        halvesPlayed: 0,
      },
      // Dispatcher hooks. `finished` flips when the final-inning game
      // ends in Phase 5; until then it stays false so the placeholder
      // boots into the play view immediately.
      finished: false,
      finishHoldUntil: 0,
      // Input drag state (Phase 2+).
      dragStart: null, dragNow: null,
    };
  },

  update(g, dt) {
    g.time += dt;
    g.phaseT += dt;
    // Phase 1 is a placeholder loop — no game progression yet. Phase 2
    // wires the pitcher state machine. Until then we just sit on the
    // warmup screen so the player can see the field render.
  },

  render(g) {
    // Camera at the pitcher's mound looking toward home plate. We set
    // the camera Z below ground level so the plate (z=18.4) projects
    // far enough downrange that the strike-zone box reads. Tuned to
    // taste once the pitcher gets implemented in Phase 2.
    fpSetCam(0);
    drawPlaceholderField(g);
    drawHudStrip(g);
    drawPlaceholderCallout(g);
  },

  // Called by the MINIGAMES dispatcher when the player taps Play Again
  // on the finished overlay. Without this hook the dispatcher would
  // re-call startMinigame("baseball") which routes through level-id
  // resolution — Baseball doesn't use levels, so we re-init manually
  // and preserve the mode/innings the player chose at the start.
  onPlayAgain(prev) {
    return Baseball.init({ mode: prev.mode, innings: prev.innings });
  },

  // Pointer plumbing is registered for Phase 2 onward. Phase 1 ignores
  // input entirely (taps go nowhere on the placeholder field).
  handlePointer(g, kind, x, y) {
    // Phase 2+ implementation forthcoming. Recording the drag state
    // here keeps fpProcessFlick happy if any helper accidentally peeks.
    if (kind === "down") g.dragStart = { x, y, t: performance.now() };
    else if (kind === "move" && g.dragStart) g.dragNow = { x, y };
    else if (kind === "up") { g.dragStart = null; g.dragNow = null; }
  },

  // Phase 5 will compute a real payout based on win margin + run scored.
  // Phase 1 returns zero so the dispatcher's settleMinigame() doesn't
  // hand out free cash on the placeholder.
  payout(g) { return 0; },

  // Used by the dispatcher's renderFinished branch — see main.js loop.
  renderFinished(g) {
    drawBaseballFinishedOverlay(g);
  },
};

// ──────────────────────────────────────────────────────────────────────
// Placeholder field render — sky gradient + grass + foul lines. Just
// enough to confirm Phase 1 plumbing works. Real composers land in
// src/games/baseball/draw.js during Phase 2.
// ──────────────────────────────────────────────────────────────────────
function drawPlaceholderField(g) {
  fpDrawSky("#0e1726", "#1e3454", "#3d6a48");
  // Grass + lateral perspective lines. The fpDrawField default looks
  // like a football field (white sidelines); for baseball we tone the
  // lines down so they read like mown grass stripes instead.
  fpDrawField("#3d6a48", "rgba(255,255,255,0.08)");
  // Two foul lines from home plate (z≈0) out to the corners of the
  // outfield. Z=0 puts the apex right at the bottom of the screen, so
  // we anchor the lines at z=0.5 to keep the math sane.
  drawFoulLine(-28, 95);
  drawFoulLine( 28, 95);
  // Pitcher's mound (~18.4 m from home, but the camera is conceptually
  // AT the mound — Phase 2 will swap this for the catcher silhouette).
  // Until then, draw a brown disc at the far end as a visual anchor.
  drawMound(0, 18.4);
}

function drawFoulLine(endX, endZ) {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 2;
  const a = fpProject(0, 0, 0.5);
  const b = fpProject(endX, 0, endZ);
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.stroke();
}

function drawMound(x, z) {
  const c = fpProject(x, 0, z);
  const top = fpProject(x, 0.25, z);
  const r = Math.max(8, 70 * c.scale);
  ctx.fillStyle = "#8a6a3a";
  ctx.beginPath();
  ctx.ellipse(c.sx, c.sy, r, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  // Rubber strip
  ctx.fillStyle = "#dcdcdc";
  ctx.fillRect(top.sx - r * 0.45, top.sy - 2, r * 0.9, 3);
}

// HUD strip across the top — scoreboard + count + outs + base diamond.
// Phase 1 shows zeros to confirm layout; Phase 5 wires real values.
function drawHudStrip(g) {
  const padX = 14;
  const padY = 12;
  const h = 38;
  const totalW = W - padX * 2;
  // Background
  ctx.fillStyle = "rgba(11, 13, 22, 0.78)";
  ctx.fillRect(padX, padY, totalW, h);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, padY, totalW, h);

  ctx.textAlign = "center";
  // Cells: AWAY | HOME | INN | OUTS | B-S | BASES
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

// Centered "Phase 1" callout so the placeholder is unambiguous during
// development. Removed in Phase 2 once the pitcher gameplay lands.
function drawPlaceholderCallout(g) {
  const pulse = 0.55 + 0.45 * Math.sin(g.time * 2.0);
  ctx.textAlign = "center";
  ctx.fillStyle = `rgba(248, 213, 106, ${pulse})`;
  ctx.font = "bold 22px ui-monospace, monospace";
  ctx.fillText("BASEBALL — warmup", W / 2, H * 0.46);
  ctx.fillStyle = "rgba(207, 214, 227, 0.85)";
  ctx.font = "bold 13px ui-monospace, monospace";
  const modeLabel = g.mode === "pvp" ? "Pass & Play" : "vs CPU";
  ctx.fillText(`${modeLabel}  •  ${g.innings}-inning game`, W / 2, H * 0.50);
  ctx.fillStyle = "rgba(160, 170, 190, 0.70)";
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.fillText("Pitching, batting, and fielding land in Phase 2-4.", W / 2, H * 0.54);
  ctx.fillText("Tap Esc to return to the menu.", W / 2, H * 0.565);
  ctx.textAlign = "start";
}

// ──────────────────────────────────────────────────────────────────────
// Game-end overlay — mirrors drawQbFinishedOverlay's structure so the
// finale feels consistent across Declan's games. Phase 1 just shows a
// "Coming soon" message + Play Again + Menu buttons; Phase 5 fills in
// the real scoreboard / lifetime stats / NEW BEST badge.
// ──────────────────────────────────────────────────────────────────────
function drawBaseballFinishedOverlay(g) {
  const heldFor = Math.max(0, performance.now() - ((g.finishHoldUntil || 0) - 600));
  // Backdrop
  const bgA = Math.min(0.78, heldFor / 240 * 0.78);
  ctx.fillStyle = `rgba(7, 9, 18, ${bgA})`;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";

  // FINAL header
  const titleA = Math.min(1, heldFor / 240);
  const titleEase = ease(titleA, "easeOutBack");
  const titleY = H * 0.18 - (1 - titleEase) * 22;
  ctx.fillStyle = `rgba(248, 213, 106, ${titleA})`;
  ctx.font = "bold 30px ui-monospace, monospace";
  ctx.fillText("FINAL", W / 2, titleY);

  // Big score
  const scoreA = Math.min(1, Math.max(0, (heldFor - 120) / 240));
  ctx.fillStyle = `rgba(255, 230, 138, ${scoreA})`;
  ctx.font = "bold 64px ui-monospace, monospace";
  ctx.fillText(`${g.runs.away}  -  ${g.runs.home}`, W / 2, H * 0.32);
  ctx.fillStyle = `rgba(190, 200, 220, ${scoreA})`;
  ctx.font = "bold 12px ui-monospace, monospace";
  ctx.fillText("AWAY            HOME", W / 2, H * 0.36);

  // Buttons. The dispatcher's routeGameOverPointer reads _btnPlayAgain
  // and _btnMenu; same convention as every other minigame.
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

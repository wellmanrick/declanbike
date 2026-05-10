// ScoreSystem — score, streak, multipliers, persistence.
//
// Scoring rules (per spec):
//   Made kick               +100
//   Distance bonus          +distance × 5
//   Perfect center kick     +250
//   Wind bonus              +100 (if WindSystem.helped(drift))
//   Streak multiplier       ×1, ×2, ×3, ×5
//   Long kick (>= 50 yards) +150
//
// Streak ladder: 0..2 = ×1, 3..4 = ×2, 5..7 = ×3, 8+ = ×5.
//
// Persistence: best score per mode in localStorage under fgf.best.<mode>.

const SAVE_PREFIX = "fgf.best.";

export class ScoreSystem {
  constructor() {
    this.score = 0;
    this.streak = 0;
    this.lastDelta = 0;
    this.lastBreakdown = null;  // for the game-over screen
    this._lifetimeMakes = 0;
  }

  reset() {
    this.score = 0;
    this.streak = 0;
    this.lastDelta = 0;
    this.lastBreakdown = null;
    this._lifetimeMakes = 0;
  }

  multiplier() {
    if (this.streak >= 8) return 5;
    if (this.streak >= 5) return 3;
    if (this.streak >= 3) return 2;
    return 1;
  }

  applyMadeKick({ distance, perfect, windHelp }) {
    this._lifetimeMakes++;
    const breakdown = {};
    breakdown.base = 100;
    breakdown.distanceBonus = Math.round(distance * 5);
    if (perfect) breakdown.perfect = 250;
    if (windHelp) breakdown.windBonus = 100;
    if (distance >= 50) breakdown.longKick = 150;
    const subtotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
    this.streak++;
    const mult = this.multiplier();
    breakdown.multiplier = mult;
    breakdown.total = subtotal * mult;
    this.score += breakdown.total;
    this.lastDelta = breakdown.total;
    this.lastBreakdown = breakdown;
    return breakdown;
  }

  // Returns true when this miss ENDS the run (mode-specific):
  //   sudden    — first miss ends.
  //   classic   — never ends from a single miss (uses ball count).
  //   timed     — never ends from a miss; clock is the limiter.
  //   wind      — three-strikes; sets a counter on `this`.
  applyMissedKick(mode) {
    this.streak = 0;
    this.lastDelta = 0;
    this.lastBreakdown = null;
    if (mode === "sudden") return true;
    if (mode === "wind") {
      this._windMisses = (this._windMisses || 0) + 1;
      return this._windMisses >= 3;
    }
    return false;
  }

  bestKey(mode) { return SAVE_PREFIX + (mode || "classic"); }

  bestFor(mode) {
    try { return parseInt(localStorage.getItem(this.bestKey(mode)) || "0", 10) || 0; }
    catch { return 0; }
  }

  // Save best at end of run. Caller passes the active mode.
  commitBest(mode) {
    const m = mode || "classic";
    const prev = this.bestFor(m);
    if (this.score > prev) {
      try { localStorage.setItem(this.bestKey(m), String(this.score)); } catch {}
      return true;
    }
    return false;
  }
}

// UIManager — DOM overlay updates. Pure DOM mutation; no game logic.
//
// All DOM IDs are queried once at construction. The Game tells the UI
// what to display via small explicit methods (showHud, updateHud,
// showGameOver, etc.).

export class UIManager {
  constructor() {
    this.menu = document.getElementById("menu");
    this.hud = document.getElementById("hud");
    this.gameover = document.getElementById("gameover");
    this.score = document.getElementById("hud-score");
    this.streak = document.getElementById("hud-streak");
    this.best = document.getElementById("hud-best");
    this.distance = document.getElementById("hud-distance");
    this.balls = document.getElementById("hud-balls");
    this.windArrow = document.getElementById("wind-arrow");
    this.windText = document.getElementById("wind-text");
    this.power = document.getElementById("power-meter");
    this.powerFill = document.getElementById("power-fill");
    this.feedback = document.getElementById("kick-feedback");
    this.gameoverTitle = document.getElementById("gameover-title");
    this.gameoverBody = document.getElementById("gameover-body");
    this._feedbackTimer = 0;
  }

  showMenu()  { this.menu.classList.remove("hidden"); }
  hideMenu()  { this.menu.classList.add("hidden"); }
  showHud()   { this.hud.classList.remove("hidden"); }
  hideHud()   { this.hud.classList.add("hidden"); }
  showPower(p){ this.power.classList.remove("hidden"); this.powerFill.style.width = (p * 100).toFixed(1) + "%"; }
  hidePower() { this.power.classList.add("hidden"); }

  updateHud(game) {
    this.score.textContent    = String(game.score.score);
    this.streak.textContent   = String(game.score.multiplier());
    this.best.textContent     = String(game.score.bestFor(game.level.mode));
    if (game.level.mode === "timed") {
      this.distance.textContent = Math.max(0, Math.ceil(game.timeLeft));
      // Repurpose "yd" unit slot as "s" for timed mode.
      const unit = this.distance.nextElementSibling;
      if (unit && unit.classList.contains("unit")) unit.textContent = "s";
    } else {
      this.distance.textContent = String(game.level.distance);
      const unit = this.distance.nextElementSibling;
      if (unit && unit.classList.contains("unit")) unit.textContent = "yd";
    }
    this.balls.textContent    = String(Math.max(0, game.level.ballsLeft));
    // Wind: arrow rotation + text. lateralBias gives -1..+1 (left/right).
    const lb = game.wind.lateralBias();
    const rot = lb * 90; // ±90° rotation; -1 → -90° (points left)
    this.windArrow.style.transform = `rotate(${rot}deg)`;
    this.windText.textContent = `${game.wind.speedMph()} mph`;
  }

  flashFeedback(text, cls) {
    this.feedback.textContent = text;
    this.feedback.className = "kick-feedback show" + (cls ? " " + cls : "");
    clearTimeout(this._feedbackTimer);
    this._feedbackTimer = setTimeout(() => {
      this.feedback.className = "kick-feedback";
    }, 900);
  }

  showGameOver(game) {
    const s = game.score;
    const best = s.bestFor(game.level.mode);
    const isNew = s.score >= best && s.score > 0;
    this.gameoverTitle.textContent = isNew ? "New Best!" : "Game Over";
    const rows = [
      ["Mode", game.level.mode.toUpperCase()],
      ["Score", String(s.score)],
      ["Best", String(best)],
      ["Made kicks", String(s._lifetimeMakes)],
    ];
    this.gameoverBody.innerHTML = rows
      .map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`)
      .join("");
    this.gameoverBody.innerHTML +=
      `<div class="row total"><span>Final</span><span>${s.score}</span></div>`;
    this.gameover.classList.remove("hidden");
  }
  hideGameOver() { this.gameover.classList.add("hidden"); }
}

// Flick Field Goal — entry point. Boots the Game and wires the
// menu actions. All game logic lives under src/.
import { Game } from "./src/Game.js";

const game = new Game(document.getElementById("scene"));
game.start();

document.querySelectorAll("[data-action]").forEach((el) => {
  el.addEventListener("click", () => {
    const action = el.dataset.action;
    switch (action) {
      case "play-classic": game.startMode("classic"); break;
      case "play-timed":   game.startMode("timed"); break;
      case "play-sudden":  game.startMode("sudden"); break;
      case "play-wind":    game.startMode("wind"); break;
      case "restart":      game.restart(); break;
      case "menu":         game.toMenu(); break;
    }
  });
});

// Pause when the tab is hidden so the loop doesn't burn battery in the
// background, and resume on visibility return.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) game.pause();
  else game.resume();
});

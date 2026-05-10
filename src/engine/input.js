// Keyboard + touch button input. Synthesizes a uniform key set so the
// game logic doesn't care whether a press came from a hardware key or
// an on-screen button.
//
// keys      — currently-held keys (Set of KeyboardEvent.code values)
// justPressed — keys that transitioned to pressed this frame; cleared
//               at the end of each loop tick.
import { Sound } from "./audio.js";

export const keys = new Set();
export const justPressed = new Set();

window.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) justPressed.add(e.code);
  keys.add(e.code);
  Sound.ensure(); // unlock audio on first user gesture
});
window.addEventListener("keyup", (e) => { keys.delete(e.code); });
window.addEventListener("pointerdown", () => Sound.ensure(), { once: false });

// High-level intent of the held keys (for the bike physics).
export function input() {
  return {
    throttle: keys.has("ArrowRight") || keys.has("KeyD"),
    brake:    keys.has("ArrowLeft")  || keys.has("KeyA"),
    leanFwd:  keys.has("ArrowUp")    || keys.has("KeyW"),
    leanBack: keys.has("ArrowDown")  || keys.has("KeyS"),
    boost:    keys.has("Space"),
    preload:  keys.has("ShiftLeft")  || keys.has("ShiftRight"),
  };
}

const isTouchDevice = (("ontouchstart" in window) || (navigator.maxTouchPoints > 0));

export function setupTouchControls() {
  const touchEl = document.getElementById("touch");
  if (!touchEl) return;
  if (isTouchDevice) touchEl.classList.add("show");

  const muteBtn = document.getElementById("mute-btn");
  if (muteBtn) {
    const updateMuteUi = () => {
      muteBtn.textContent = Sound.isMuted() ? "🔇" : "♪";
      muteBtn.classList.toggle("muted", Sound.isMuted());
    };
    updateMuteUi();
    muteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      Sound.ensure();
      Sound.toggleMute();
      updateMuteUi();
    });
  }

  const buttons = touchEl.querySelectorAll(".tbtn, .tpad");
  for (const btn of buttons) {
    const code = btn.dataset.key;
    if (!code) continue;
    const press = (e) => {
      e.preventDefault();
      btn.classList.add("held");
      Sound.ensure();
      if (code === "Escape") {
        if (!keys.has("Escape")) justPressed.add("Escape");
        keys.add("Escape");
        setTimeout(() => keys.delete("Escape"), 50);
        return;
      }
      if (!keys.has(code)) justPressed.add(code);
      keys.add(code);
    };
    const release = (e) => {
      e.preventDefault();
      btn.classList.remove("held");
      if (code === "Escape") return;
      keys.delete(code);
    };
    btn.addEventListener("touchstart", press, { passive: false });
    btn.addEventListener("touchend", release, { passive: false });
    btn.addEventListener("touchcancel", release, { passive: false });
    btn.addEventListener("mousedown", press);
    btn.addEventListener("mouseup", release);
    btn.addEventListener("mouseleave", release);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}

// Juice helpers — toasts (DOM popups), particle spawners, floating
// world text. Pure helpers; rely on the run-time game state for the
// active particle / text lists.
import { G } from "../state.js";

export function pushToast(text, kind = "gold", ttl = 1500) {
  const stack = document.getElementById("toast-stack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  stack.appendChild(el);
  setTimeout(() => el.remove(), ttl + 400);
}

export function pushFloating(text, x, y, color) {
  if (!G.runtime) return;
  G.runtime.floatingTexts.push({ text, x, y, vy: -60, life: 1.2, maxLife: 1.2, color });
}

export function spawnExhaustParticles(isBoost) {
  const r = G.runtime;
  if (!r) return;
  const b = r.bike;
  const offsetX = -Math.cos(b.angle) * 22 - Math.sin(b.angle) * 6;
  const offsetY = -Math.sin(b.angle) * 22 + Math.cos(b.angle) * -2;
  for (let i = 0; i < (isBoost ? 3 : 1); i++) {
    r.particles.push({
      x: b.x + offsetX, y: b.y + offsetY,
      vx: -b.vx * 0.1 - 60 + Math.random() * -40,
      vy: -20 + Math.random() * -60,
      life: 0.6, maxLife: 0.6,
      color: isBoost ? "#6ee7ff" : "#776655",
      size: 4 + Math.random() * (isBoost ? 6 : 3),
    });
  }
}

export function spawnSmashParticles(x, y, type) {
  if (!G.runtime) return;
  const r = G.runtime;
  const palette = type === "rock"
    ? ["#9aa3b3", "#666e80", "#3d4150", "#cccccc"]
    : type === "log"
    ? ["#925a2c", "#6a3e1f", "#3b2412", "#d8a13a"]
    : ["#1a1a1a", "#3b3b3b", "#888"];
  for (let i = 0; i < 18; i++) {
    r.particles.push({
      x: x + (Math.random() - 0.5) * 14,
      y: y + (Math.random() - 0.5) * 14,
      vx: (Math.random() - 0.4) * 480,
      vy: -120 - Math.random() * 240,
      life: 0.6 + Math.random() * 0.4, maxLife: 1.0,
      color: palette[Math.floor(Math.random() * palette.length)],
      size: 2 + Math.random() * 4,
    });
  }
  for (let i = 0; i < 6; i++) {
    r.particles.push({
      x: x, y: y - 14,
      vx: (Math.random() - 0.5) * 200,
      vy: -60 - Math.random() * 80,
      life: 0.25, maxLife: 0.25,
      color: "rgba(255, 230, 120, 0.9)",
      size: 5 + Math.random() * 4,
    });
  }
}

// terrainHeightAt is injected at boot to break a circular dep with
// the world/terrain module.
let _terrainHeightAt = (_, x) => 540;
export function _setTerrainHeightFn(fn) { _terrainHeightAt = fn; }

export function spawnLandingDust(intensity) {
  if (!G.runtime) return;
  const r = G.runtime;
  const b = r.bike;
  const groundY = _terrainHeightAt(r.terrain, b.x);
  const n = Math.floor(8 + intensity * 14);
  for (let i = 0; i < n; i++) {
    const dir = i < n / 2 ? -1 : 1;
    r.particles.push({
      x: b.x + (Math.random() - 0.5) * 30,
      y: groundY,
      vx: dir * (40 + Math.random() * 200) * intensity,
      vy: -40 - Math.random() * 120 * intensity,
      life: 0.7 + Math.random() * 0.4,
      maxLife: 1.0,
      color: "rgba(180, 150, 100, " + (0.45 + Math.random() * 0.3).toFixed(2) + ")",
      size: 3 + Math.random() * 5,
    });
  }
}

export function spawnCrashParticles() {
  if (!G.runtime) return;
  const r = G.runtime;
  const b = r.bike;
  for (let i = 0; i < 24; i++) {
    r.particles.push({
      x: b.x, y: b.y,
      vx: (Math.random() - 0.5) * 400,
      vy: -100 - Math.random() * 200,
      life: 0.9, maxLife: 0.9,
      color: ["#ffb020","#ff5a3a","#776655","#cccccc"][Math.floor(Math.random()*4)],
      size: 3 + Math.random() * 4,
    });
  }
}

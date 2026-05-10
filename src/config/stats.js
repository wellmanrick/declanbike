// Compose the bike's effective stats from equipped parts + the active
// character. Pulls from the live save profile.
import { save } from "../engine/save.js";
import { PARTS, partById } from "./parts.js";
import { characterById } from "./characters.js";

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function getEquippedStats() {
  const base = {
    topSpeed: 60, accel: 1.0, grip: 0.55, suspension: 0.35,
    boostCap: 100, boostRegen: 8, durability: 100, weight: 1.0, paint: "#e94c3a",
  };
  for (const cat of ["engine", "tire", "suspension", "frame", "paint"]) {
    const p = partById(save.equipped[cat]);
    if (!p) continue;
    const s = p.stats;
    if (s.speedBoost) base.topSpeed += s.speedBoost;
    if (s.accel) base.accel = s.accel;
    if (s.grip != null) base.grip = s.grip;
    if (s.suspension != null) base.suspension = s.suspension;
    if (s.boostCap != null) base.boostCap = s.boostCap;
    if (s.boostRegen != null) base.boostRegen = s.boostRegen;
    if (s.durability != null) base.durability = s.durability;
    if (s.weight != null) base.weight = s.weight;
    if (s.paint) base.paint = s.paint;
  }
  // Character modifiers — additive on top of bike parts.
  const ch = characterById(save.equipped.character || "char_declan");
  if (ch) {
    const cs = ch.stats || {};
    if (cs.topSpeed)   base.topSpeed += cs.topSpeed;
    if (cs.accel)      base.accel += cs.accel;
    if (cs.grip)       base.grip = clamp(base.grip + cs.grip, 0.1, 1);
    if (cs.suspension) base.suspension = clamp(base.suspension + cs.suspension, 0.1, 1);
    if (cs.boostRegen) base.boostRegen += cs.boostRegen;
    if (cs.durability) base.durability += cs.durability;
    if (cs.weight)     base.weight = Math.max(0.6, base.weight + cs.weight);
    base.charAccent = ch.accent || "#ffb020";
    base.charBoots = ch.boots || "#0a0a0e";
    base.charName = ch.name;
  }
  return base;
}

// Selectable rider characters. Each one carries a stat delta on top of
// whatever the bike parts provide, plus a visual accent (jacket stripe)
// and boot color used by the bike renderer.
export const CHARACTERS = [
  { id: "char_declan", name: "Declan",  cost: 0,    desc: "All-around. Reliable.",
    stats: {}, accent: "#ffb020", boots: "#0a0a0e" },
  { id: "char_maya",   name: "Maya",    cost: 600,  desc: "Lightweight speedster. Fast but fragile.",
    stats: { topSpeed: 8, accel: 0.08, durability: -25 }, accent: "#ff5a3a", boots: "#1d2030" },
  { id: "char_brick",  name: "Brick",   cost: 800,  desc: "Heavy. Tank-spec. Slower off the line.",
    stats: { durability: 50, weight: 0.10, accel: -0.05 }, accent: "#888", boots: "#3a3a3a" },
  { id: "char_pixie",  name: "Pixie",   cost: 1200, desc: "Acrobat. Spins fast, lands soft.",
    stats: { weight: -0.18, suspension: 0.10 }, accent: "#c2ff3a", boots: "#0a0a0e" },
  { id: "char_ace",    name: "Ace",     cost: 1800, desc: "Pro rider. Boost regen + grip bonus.",
    stats: { boostRegen: 4, grip: 0.06 }, accent: "#6ee7ff", boots: "#1a1a1a" },
];

export function characterById(id) { return CHARACTERS.find(c => c.id === id); }

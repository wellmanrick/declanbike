// Bike part catalog. Each part lives in a category (engine, tire, etc.)
// and carries its stats. Stat semantics:
//   speedBoost (engine):  added top-speed (mph)
//   accel:                acceleration multiplier (1.0 baseline)
//   grip:                 how fast bike conforms to slope (0..1)
//   suspension:           vertical impact absorption (0..1)
//   boostCap:             max boost meter
//   boostRegen:           boost regen / sec
//   durability:           bike health
//   weight:               heavier = slower accel + more stable in air
//   paint:                color string

export const PARTS = {
  engine: [
    { id: "engine_stock",  name: "Stock 125cc",     cost: 0,    desc: "What it came with. Reliable enough.",
      stats: { speedBoost: 0,  accel: 1.0, boostCap: 100, boostRegen: 8 } },
    { id: "engine_250",    name: "Trailshredder 250", cost: 400, desc: "More cubes, more grunt off the line.",
      stats: { speedBoost: 8,  accel: 1.15, boostCap: 110, boostRegen: 10 } },
    { id: "engine_450",    name: "Big Bore 450",    cost: 1100, desc: "Punchy mid-range, eats hills.",
      stats: { speedBoost: 16, accel: 1.30, boostCap: 130, boostRegen: 11 } },
    { id: "engine_turbo",  name: "Turbo 600",       cost: 2400, desc: "Forced induction. Hold on.",
      stats: { speedBoost: 26, accel: 1.45, boostCap: 150, boostRegen: 13 } },
    { id: "engine_nitro",  name: "Nitro Beast",     cost: 5000, desc: "Stupidly fast. Tries to throw you.",
      stats: { speedBoost: 40, accel: 1.65, boostCap: 200, boostRegen: 18 } },
  ],
  tire: [
    { id: "tire_stock",   name: "Hard Compound",   cost: 0,    desc: "Lasts forever, slips a little.",
      stats: { grip: 0.55 } },
    { id: "tire_knobby",  name: "Knobby MX",       cost: 250,  desc: "Bites into dirt. Standard issue.",
      stats: { grip: 0.72 } },
    { id: "tire_mud",     name: "Mud Slingers",    cost: 600,  desc: "Aggressive lugs. Better recovery.",
      stats: { grip: 0.82 } },
    { id: "tire_paddle",  name: "Sand Paddles",    cost: 1300, desc: "Insane grip on every surface, somehow.",
      stats: { grip: 0.92 } },
  ],
  suspension: [
    { id: "suspension_stock", name: "Old Forks",     cost: 0,   desc: "Bouncy. Not in a fun way.",
      stats: { suspension: 0.35 } },
    { id: "suspension_sport", name: "Sport Forks",   cost: 350, desc: "Soaks up small chatter.",
      stats: { suspension: 0.55 } },
    { id: "suspension_long",  name: "Long Travel",   cost: 900, desc: "Eat the big hits.",
      stats: { suspension: 0.75 } },
    { id: "suspension_works", name: "Works Edition", cost: 1900,desc: "Pro-level damping. Stick the landing.",
      stats: { suspension: 0.92 } },
  ],
  frame: [
    { id: "frame_stock",   name: "Steel Frame",     cost: 0,   desc: "Heavy. Tanky.",
      stats: { durability: 100, weight: 1.10 } },
    { id: "frame_alu",     name: "Aluminum Frame",  cost: 500, desc: "Lighter, bit more fragile.",
      stats: { durability: 110, weight: 0.95 } },
    { id: "frame_carbon",  name: "Carbon Fiber",    cost: 1600,desc: "Featherweight, stiff as a board.",
      stats: { durability: 130, weight: 0.80 } },
    { id: "frame_titan",   name: "Titanium Pro",    cost: 3500,desc: "The good stuff. Light AND tough.",
      stats: { durability: 180, weight: 0.85 } },
  ],
  paint: [
    { id: "paint_red",    name: "Factory Red",      cost: 0,   desc: "Classic.",            stats: { paint: "#e94c3a" } },
    { id: "paint_blue",   name: "Cobalt Blue",      cost: 100, desc: "Cool & calm.",        stats: { paint: "#3a7be9" } },
    { id: "paint_black",  name: "Midnight Black",   cost: 150, desc: "Stealth mode.",       stats: { paint: "#1d2030" } },
    { id: "paint_lime",   name: "Acid Lime",        cost: 200, desc: "Look at me.",         stats: { paint: "#c2ff3a" } },
    { id: "paint_gold",   name: "Champion Gold",    cost: 500, desc: "Earned, not bought.", stats: { paint: "#ffc940" } },
  ],
};

export function partById(id) {
  for (const cat of Object.keys(PARTS)) {
    const p = PARTS[cat].find(p => p.id === id);
    if (p) return { ...p, category: cat };
  }
  return null;
}

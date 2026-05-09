# Declan Bike — Excite Trails

A side-scrolling dirt bike game inspired by Excitebike, built as a single static page.
Build your bike. Hit the trails. Land flips. Eat dirt occasionally.

## Run it

Open `index.html` in any modern browser. No build step, no server required.

## Controls

| Key | Action |
| --- | --- |
| `→` / `D` | Throttle |
| `←` / `A` | Brake / lean back |
| `↑` / `W` | Lean forward — in air, front-flip rotation |
| `↓` / `S` | Lean back — in air, back-flip rotation |
| `Space` | Boost (drains the boost meter) |
| `Shift` | Preload — charge a hop at takeoff |
| `R` | Restart current run |
| `Esc` | Pause / quit to menu |

## What's in the game

- **6 procedurally generated trails**, unlocking as you complete them.
- **The Garage**: bike-builder with **5 categories** of parts — engine, tires,
  suspension, frame, paint — totaling 21 swappable components, each with its
  own stats and price.
- **14 side quests** with auto-paying cash rewards: flip totals, distance,
  combos, perfect landings, completion goals, and more.
- **Combo & trick scoring** with multipliers, perfect-landing bonuses, and
  cash-per-flip payouts.
- **Persistent save** via `localStorage` (cash, parts owned, equipped loadout,
  best times, lifetime quest progress).

## Files

- `index.html` — page shell, HUD, and overlay UIs
- `style.css` — all styling
- `game.js` — game loop, physics, terrain generation, rendering, UI wiring

That's it — three files, no dependencies.

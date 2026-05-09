# Declan Bike — Excite Trails

A side-scrolling dirt bike game inspired by Excitebike, built as a single static page.
Build your bike. Hit the trails. Land flips. Eat dirt occasionally.

## Run it

**Locally:** open `index.html` in any modern browser, or run `python3 -m http.server 8000` and visit `http://localhost:8000`. No build step.

**On your phone:** push to `main` (or any `claude/**` branch) and the included
GitHub Actions workflow at `.github/workflows/pages.yml` builds and deploys to
GitHub Pages. First-time setup: in the repo settings, **Settings → Pages → Build and deployment → Source: GitHub Actions**.
After the first successful run, your game lives at
`https://<username>.github.io/<repo>/`.

## Controls

| Key | Action |
| --- | --- |
| `→` / `D` | Throttle |
| `←` / `A` | Brake / lean back |
| `↑` / `W` | Lean forward — in air, front-flip rotation |
| `↓` / `S` | Lean back — in air, back-flip rotation |
| `Space` | Boost (drains the boost meter) |
| `Shift` | **Jump** — tap to launch off the ground (air = stop charging gravity) |
| `M` | Mute / unmute sound |
| `R` | Restart current run |
| `Esc` | Pause / quit to menu |

**Touch / phone controls** (auto-shown on touch devices):
on-screen ◀ (brake / back-flip), ▶ (throttle), ⤴ (jump), ↻ (front-flip),
⚡ (boost), `II` pause and `♪` mute buttons in the top-right.

## Audio

All sounds are synthesized live with Web Audio API — no asset files. The engine
hum modulates with throttle/speed/boost; landings, flips, pickups, and crashes
each have their own procedural blip. Tap any key/button to enable audio (browser
gesture requirement). Mute with `M` or the `♪` button.

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

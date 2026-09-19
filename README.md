# Declan Bike — Excite Trails

Side-scrolling dirt-bike + true-flick arcade. Browser game, no server.

Snap Field Goal, Hoops, Can Bash, Party Pong, and QB Challenge — power
comes from finger speed, not how far you drag. Baseball stays drag-aim
for batting and pitching. Ride the trails, wrench the garage, spend the
cash.

## Run it locally

Open `index.html` in any modern browser, or `python3 -m http.server` and
visit `http://localhost:8000`. The game loads as ES modules so the file
must be served (not opened via `file://`) for the imports to resolve.

## Deploy

`.github/workflows/pages.yml` runs on every push to `main` or
`claude/**` — it lints the JS, stamps a build hash into the asset
URLs for cache-busting, and publishes to GitHub Pages.

## Architecture

The codebase is split into ES modules under `src/`. Browsers load
`index.html` → `<script type="module" src="src/main.js">` and ES module
imports resolve the rest.

```
src/
├─ main.js                  Entry. Bike physics, world rendering, UI flow,
│                           mini-games, and the RAF loop.
├─ state.js                 STATE enum + G mutable runtime container.
├─ engine/
│  ├─ canvas.js             Canvas + ctx + W/H/DPR + viewport + helpers
│  │                        (clamp, lerp, wrapAngle). Resize-safe.
│  ├─ audio.js              Procedural Web Audio engine: SFX, engine
│  │                        drone, background music scheduler. Mute
│  │                        persisted to localStorage.
│  ├─ input.js              Keyboard + on-screen touch buttons. Synthesizes
│  │                        a uniform key set + an `input()` view of held
│  │                        intent. setupTouchControls() wires DOM buttons.
│  ├─ fpView.js             First-person projection + true-flick impulse
│  │                        (peak finger speed, snap-to-launch).
│  ├─ rng.js                Seedable mulberry32 PRNG.
│  ├─ save.js               Profile, localStorage-backed, with safe
│  │                        defaults for failed reads (Safari Private).
│  └─ juice.js              Toasts, particle spawners, floating world
│                           text. Reads the active runtime via the G
│                           container.
├─ config/
│  ├─ parts.js              Bike parts catalog + lookup.
│  ├─ characters.js         Rider catalog + lookup.
│  ├─ stats.js              Compose effective stats from parts + character.
│  ├─ themes.js             Visual themes per biome (sky/mountains/grass).
│  ├─ levels.js             Trail catalog + medal helpers + unlock check.
│  └─ quests.js             Lifetime quest catalog + progress + auto-claim.
├─ games/                   Arcade modes (field goal, hoops, can bash,
│                           party pong, QB, duck hunt, block bash, baseball).
└─ world/
   └─ terrain.js            Procedural heightmap generator + sample
                            helpers.
```

## Adding a new mode

1. Add a config to `src/config/levels.js` (or a sibling list).
2. Implement game-specific logic in a new module under `src/games/`.
3. Register from `src/main.js`.

## Controls

- `→`/`D` (or GAS paddle): throttle. In air: front flip.
- `←`/`A` (or BRAKE paddle): brake. In air: back flip.
- `↑`/`W`: lean forward (extra rotation in air).
- `↓`/`S`: lean back.
- `Shift`: jump.
- `Space`: boost.
- `M`: mute / unmute.
- `R`: restart run. `Esc`: pause / quit.

Arcade flicks: snap toward the target. A slow drag does nothing.

Touch devices: the on-screen Brake / Gas paddles + Jump + Boost
buttons appear automatically.

// Field Goal level catalog. Each level fixes the kicking distance and
// describes the per-attempt randomness ranges (wind, off-center placement)
// plus the attempts budget and star thresholds.
//
// Schema:
//   id              — unique slug used as save key
//   name            — display name in the level grid
//   subtitle        — short flavor line
//   attempts        — kicks awarded for this level
//   distance        — z-distance to the uprights (meters)
//   gap             — width between uprights (meters)
//   windRange       — wind magnitude is uniform in [-windRange, +windRange]
//   offCenterRange  — uprights are placed at uniform x in [-r, +r]
//   parStars        — makes-needed thresholds for each star tier:
//                       { 3: 5, 2: 4, 1: 2 } means
//                       3★ if made >= 5, 2★ if made >= 4, 1★ if made >= 2,
//                       0★ otherwise.
//
// Each level may carry a `condition` flag (defaults to "standard") that
// modifies physics, scoring, or rendering. See FG_CONDITION_INFO below
// for the full list and the first-encounter tutorial labels.

export const FG_LEVELS = [
  {
    id: "fg_01_warmup",
    name: "Warm Up",
    subtitle: "Chip shot. Find your flick.",
    attempts: 5,
    distance: 16,
    gap: 6.4,
    windRange: 0,
    offCenterRange: 0,
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_02_easy_pickings",
    name: "Easy Pickings",
    subtitle: "Same idea. A little farther.",
    attempts: 5,
    distance: 20,
    gap: 6.0,
    windRange: 0,
    offCenterRange: 0,
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_03_find_your_range",
    name: "Find Your Range",
    subtitle: "Light wind. Read the flag.",
    attempts: 5,
    distance: 25,
    gap: 5.6,
    windRange: 2,
    offCenterRange: 1,
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_04_crosswind",
    name: "Crosswind",
    subtitle: "A gust shifts mid-flight. Trust the read.",
    attempts: 5,
    distance: 26,
    gap: 5.4,
    windRange: 4,
    offCenterRange: 0,
    condition: "crosswind",
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_05_off_angle",
    name: "Off-Angle",
    subtitle: "Posts swing wide. Aim true.",
    attempts: 5,
    distance: 28,
    gap: 5.2,
    windRange: 2,
    offCenterRange: 3,
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_06_mid_range",
    name: "Mid-Range",
    subtitle: "Wind and angle both. Calm in your pocket.",
    attempts: 5,
    distance: 33,
    gap: 5.0,
    windRange: 3,
    offCenterRange: 2,
    powerup: "calm",
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
  {
    id: "fg_07_narrow_gate",
    name: "Narrow Gate",
    subtitle: "Tight uprights. Surgical only.",
    attempts: 4,
    distance: 32,
    gap: 4.4,
    windRange: 2,
    offCenterRange: 2,
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
  {
    id: "fg_08_long_bomb",
    name: "Long Bomb",
    subtitle: "46-yard. Trust the line — Scope locks the goal.",
    attempts: 4,
    distance: 42,
    gap: 5.0,
    windRange: 3,
    offCenterRange: 3,
    powerup: "scope",
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
  {
    id: "fg_09_storm_day",
    name: "Storm Day",
    subtitle: "Snowstorm — low vis, drag through the snow.",
    attempts: 5,
    distance: 34,
    gap: 4.8,
    windRange: 5,
    offCenterRange: 4,
    condition: "snowstorm",
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
  {
    id: "fg_10_iron_foot",
    name: "Iron Foot",
    subtitle: "50-yard, narrow, swirling. Earn it.",
    attempts: 5,
    distance: 46,
    gap: 4.6,
    windRange: 4,
    offCenterRange: 5,
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
  {
    id: "fg_11_doink_city",
    name: "Doink City",
    subtitle: "Hit the upright = +3. Double down — literally.",
    attempts: 5,
    distance: 30,
    gap: 5.0,
    windRange: 3,
    offCenterRange: 3,
    condition: "doink",
    powerup: "double",
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_12_gold_standard",
    name: "Gold Standard",
    subtitle: "Thread the gold ring above the bar = +5.",
    attempts: 5,
    distance: 32,
    gap: 5.2,
    windRange: 2,
    offCenterRange: 2,
    condition: "bullseye",
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
  {
    id: "fg_13_three_doors",
    name: "Three Doors",
    subtitle: "One live goal. Wide opens it up.",
    attempts: 5,
    distance: 32,
    gap: 4.8,
    windRange: 2,
    offCenterRange: 0,
    condition: "triple",
    powerup: "wide",
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
  {
    id: "fg_14_razor_wire",
    name: "Razor Wire",
    subtitle: "Must clear the bar by 1m or less.",
    attempts: 5,
    distance: 38,
    gap: 4.6,
    windRange: 3,
    offCenterRange: 3,
    condition: "two_point",
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
];

// Per-condition catalog. The label is shown as a one-time tutorial toast
// the first time a player encounters a level with that condition. Adding
// a new condition means: an entry here, a branch in FieldGoal physics
// (update + render), and a level that uses it.
//   crosswind  — wind direction flips once mid-flight (gust)
//   snowstorm  — visual whiteout + ball drag through the air
//   doink      — clipping the upright = +3 instead of a miss
//   bullseye   — gold ring above the crossbar = +5 bonus on top of the make
//   triple     — three goal sets, only the gold one scores; others are walls
//   two_point  — must clear the crossbar by 1m or less
export const FG_CONDITION_INFO = {
  crosswind: { label: "Crosswind — a gust will shift mid-flight" },
  snowstorm: { label: "Snowstorm — low visibility and drag through the snow" },
  doink:     { label: "Doink Bonus — clip the upright for +3" },
  bullseye:  { label: "Gold Ring — clear the bar through the ring for +5" },
  triple:    { label: "Three Doors — only the gold uprights score" },
  two_point: { label: "Razor Wire — clear the bar by 1m or less" },
};

// Power-up catalog. Each level may carry a `powerup` slug; if set, the
// player starts the level with one charge of that power. Tap the badge
// to arm; the next kick consumes it. Effects:
//   calm   — wind = 0 for the armed kick
//   wide   — uprights gap +50% for the armed kick
//   double — armed kick scores 2x (incl. doink/bullseye bonuses)
//   scope  — draws a sight line from the kicker to the goal center
export const FG_POWERUP_INFO = {
  calm:   { icon: "🍃", label: "Calm — no wind on the next kick" },
  wide:   { icon: "📏", label: "Wide — uprights +50% on the next kick" },
  double: { icon: "✕2", label: "Double — next kick scores 2x" },
  scope:  { icon: "🎯", label: "Scope — sight line locks on the goal" },
};

// Stars earned for a finished level given the makes count.
export function starsFor(level, made) {
  const par = level.parStars || { 3: level.attempts, 2: level.attempts - 1, 1: 1 };
  if (made >= par[3]) return 3;
  if (made >= par[2]) return 2;
  if (made >= par[1]) return 1;
  return 0;
}

export function levelById(id) {
  return FG_LEVELS.find(l => l.id === id) || null;
}

// Levels unlock in order. Level 1 is always playable; level N+1 unlocks
// when level N has at least one star.
export function isLevelUnlocked(saveProgress, levelId) {
  const idx = FG_LEVELS.findIndex(l => l.id === levelId);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i++) {
    const rec = saveProgress && saveProgress[FG_LEVELS[i].id];
    if (!rec || (rec.stars || 0) < 1) return false;
  }
  return true;
}

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
    distance: 18,
    gap: 6.0,
    windRange: 0,
    offCenterRange: 0,
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_02_easy_pickings",
    name: "Easy Pickings",
    subtitle: "Light wind, slight angle. Settle in.",
    attempts: 5,
    distance: 22,
    gap: 5.6,
    windRange: 2,
    offCenterRange: 1,
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_03_find_your_range",
    name: "Find Your Range",
    subtitle: "30-yard test. Power and angle.",
    attempts: 5,
    distance: 27,
    gap: 5.4,
    windRange: 3,
    offCenterRange: 2,
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_04_crosswind",
    name: "Crosswind",
    subtitle: "A gust shifts mid-flight. Trust the read.",
    attempts: 5,
    distance: 25,
    gap: 5.4,
    windRange: 5,
    offCenterRange: 0,
    condition: "crosswind",
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_05_off_angle",
    name: "Off-Angle",
    subtitle: "Posts swing wide. Aim true.",
    attempts: 5,
    distance: 30,
    gap: 5.0,
    windRange: 2,
    offCenterRange: 4,
    parStars: { 3: 5, 2: 4, 1: 2 },
  },
  {
    id: "fg_06_mid_range",
    name: "Mid-Range",
    subtitle: "38-yard. Wind and angle both.",
    attempts: 5,
    distance: 35,
    gap: 5.0,
    windRange: 3,
    offCenterRange: 2,
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
    subtitle: "46-yard. Gas and trust the line.",
    attempts: 4,
    distance: 42,
    gap: 5.0,
    windRange: 3,
    offCenterRange: 3,
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
  {
    id: "fg_09_storm_day",
    name: "Storm Day",
    subtitle: "Snowstorm — low vis, drag through the snow.",
    attempts: 5,
    distance: 36,
    gap: 4.8,
    windRange: 7,
    offCenterRange: 4,
    condition: "snowstorm",
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
  {
    id: "fg_10_iron_foot",
    name: "Iron Foot",
    subtitle: "55-yard, narrow, swirling. Earn it.",
    attempts: 5,
    distance: 50,
    gap: 4.4,
    windRange: 5,
    offCenterRange: 6,
    parStars: { 3: 4, 2: 3, 1: 1 },
  },
  {
    id: "fg_11_doink_city",
    name: "Doink City",
    subtitle: "Hit the upright = +3. Get aggressive.",
    attempts: 5,
    distance: 30,
    gap: 5.0,
    windRange: 3,
    offCenterRange: 3,
    condition: "doink",
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
    subtitle: "Three goals, one is live. Pick the gold posts.",
    attempts: 5,
    distance: 32,
    gap: 4.8,
    windRange: 2,
    offCenterRange: 0,
    condition: "triple",
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

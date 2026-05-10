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
// Phase 1 keeps every level as standard mechanics. Phase 2 introduces
// per-level kick conditions (crosswind gust, snowstorm, doink-bonus, etc.).

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
    subtitle: "Hard wind, no angle. Read the flag.",
    attempts: 5,
    distance: 25,
    gap: 5.4,
    windRange: 5,
    offCenterRange: 0,
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
    subtitle: "Real wind. The flag's going sideways.",
    attempts: 5,
    distance: 36,
    gap: 4.8,
    windRange: 7,
    offCenterRange: 4,
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
];

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

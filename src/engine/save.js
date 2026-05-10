// Save / load for the player profile. localStorage-backed with graceful
// fallbacks for browsers that throw on storage access (Safari Private).
const SAVE_KEY = "declanbike.save.v1";

export const DEFAULT_SAVE = {
  cash: 250,
  best: {},                       // levelId -> { time, score, distance, completed, medal }
  ownedParts: {                   // partId -> true for owned
    engine_stock: true, tire_stock: true, suspension_stock: true,
    frame_stock: true, paint_red: true,
    char_declan: true,
  },
  equipped: {
    engine: "engine_stock",
    tire: "tire_stock",
    suspension: "suspension_stock",
    frame: "frame_stock",
    paint: "paint_red",
    character: "char_declan",
  },
  tutorialsSeen: {},
  quests: {},                     // questId -> { progress, done, claimed }
  unlockedLevels: { trail_01: true },
  totals: {
    distance: 0, flips: 0, airtime: 0, crashes: 0, runs: 0, jumps: 0,
    cleanLandings: 0, perfectLandings: 0, gems: 0, cleanRuns: 0,
  },
  minigameBest: {},
  canBashLevels: {},              // levelId -> { stars, ballsUsed, score, cleared }
  canBashSeenTypes: {},           // canType -> true once the player has seen
                                  // a level containing it (drives the first-
                                  // encounter tutorial toast).
  canBashSeenPowers: {},          // power-up type -> true once the player
                                  // has collected one (drives the use-it
                                  // tutorial toast).
  fieldGoalLevels: {},            // levelId -> { stars, made, attempts, score }
  fieldGoalSeenConditions: {},    // condition slug -> true once the player has
                                  // played a level featuring that condition
                                  // (drives the first-encounter tutorial).
  fieldGoalSeenPowers: {},        // power-up slug -> true once the player has
                                  // collected one (drives the use-it tutorial).
  fieldGoalBest: {                // Lifetime Field Goal records.
    longestMake: 0,               //   farthest converted kick in yards
    bestStreak: 0,                //   longest in-round consecutive-make streak
    totalMakes: 0,                //   lifetime makes across all rounds
  },
  partyPongLevels: {},            // levelId -> { stars, ballsUsed, score, cleared }
  partyPongBest: {                // Lifetime Party Pong records.
    bestStreak: 0,                //   longest in-round consecutive-make streak
    totalMakes: 0,                //   lifetime cups sunk across all rounds
    rackClears: 0,                //   total racks cleared
  },
};

function _load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(DEFAULT_SAVE), parsed, {
      ownedParts: Object.assign({}, DEFAULT_SAVE.ownedParts, parsed.ownedParts || {}),
      equipped: Object.assign({}, DEFAULT_SAVE.equipped, parsed.equipped || {}),
      totals: Object.assign({}, DEFAULT_SAVE.totals, parsed.totals || {}),
      best: parsed.best || {},
      quests: parsed.quests || {},
      unlockedLevels: Object.assign({}, DEFAULT_SAVE.unlockedLevels, parsed.unlockedLevels || {}),
      minigameBest: parsed.minigameBest || {},
      canBashLevels: parsed.canBashLevels || {},
      canBashSeenTypes: parsed.canBashSeenTypes || {},
      canBashSeenPowers: parsed.canBashSeenPowers || {},
      fieldGoalLevels: parsed.fieldGoalLevels || {},
      fieldGoalSeenConditions: parsed.fieldGoalSeenConditions || {},
      fieldGoalSeenPowers: parsed.fieldGoalSeenPowers || {},
      fieldGoalBest: Object.assign({}, DEFAULT_SAVE.fieldGoalBest, parsed.fieldGoalBest || {}),
      partyPongLevels: parsed.partyPongLevels || {},
      partyPongBest: Object.assign({}, DEFAULT_SAVE.partyPongBest, parsed.partyPongBest || {}),
    });
  } catch (e) {
    console.warn("Save load failed", e);
    return structuredClone(DEFAULT_SAVE);
  }
}

// `save` is the live profile. Mutate it freely; call persistSave() to write.
// Exported as `let` so internal reassignment (reset) propagates to imports.
export let save = _load();

export function persistSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
}

export function resetSave() {
  save = structuredClone(DEFAULT_SAVE);
  persistSave();
  return save;
}

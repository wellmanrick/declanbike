// Party Pong level catalog. Each level fixes the cup formation, ball
// budget, table distance, and the par-stars thresholds.
//
// Schema:
//   id              — unique slug used as save key
//   name            — display name in the level grid
//   subtitle        — short flavor line under the name
//   balls           — number of ping pong balls awarded
//   rack            — formation descriptor:
//                       { type: "triangle", rows, zBack }
//                       { type: "diamond",  zBack }
//                       { type: "line",     count, zBack }
//                       { type: "v",        rows, zBack }
//                     zBack is the z-distance to the back row (meters).
//   cupScale        — visual + physical scale multiplier on cup radius
//                     (1.0 = standard arcade cup ~12cm radius)
//   parStars        — balls-used thresholds for each star tier:
//                       { 3: 6, 2: 8, 1: 10 } means
//                       3★ if cleared with ≤6 balls used,
//                       2★ if cleared with ≤8 balls used,
//                       1★ if cleared at all,
//                       0★ if not cleared.
//
// Phase 1 keeps every level as a standard rack (no moving cups, no
// bounce-only, no obstacles). Phase 2 introduces per-level conditions
// that modify gameplay (moving cups, fan, bounce-only, obstacles).

export const PP_LEVELS = [
  {
    id: "pp_01_warmup",
    name: "Warm Up",
    subtitle: "Close rack, big cups. Get the feel.",
    balls: 6,
    rack: { type: "triangle", rows: 3, zBack: 1.5 },  // 6 cups
    cupScale: 1.25,
    parStars: { 3: 4, 2: 5, 1: 6 },
  },
  {
    id: "pp_02_classic",
    name: "Classic Rack",
    subtitle: "Ten cups, standard distance.",
    balls: 8,
    rack: { type: "triangle", rows: 4, zBack: 1.8 },  // 10 cups
    cupScale: 1.15,
    parStars: { 3: 6, 2: 8, 1: 10 },
  },
  {
    id: "pp_03_distance",
    name: "Long Table",
    subtitle: "Same rack, farther away.",
    balls: 8,
    rack: { type: "triangle", rows: 4, zBack: 2.2 },
    cupScale: 1.15,
    parStars: { 3: 6, 2: 8, 1: 10 },
  },
  {
    id: "pp_04_thin_line",
    name: "Six Pack",
    subtitle: "Six cups in a line. Pick them off.",
    balls: 5,
    rack: { type: "line", count: 6, zBack: 2.0 },
    cupScale: 1.10,
    parStars: { 3: 4, 2: 5, 1: 6 },
  },
  {
    id: "pp_05_diamond",
    name: "Diamond",
    subtitle: "Nine in a diamond. Hit the gold center.",
    balls: 7,
    rack: { type: "diamond", zBack: 2.0 },             // 9 cups
    cupScale: 1.10,
    parStars: { 3: 5, 2: 7, 1: 9 },
  },
  {
    id: "pp_06_pyramid",
    name: "Big Stack",
    subtitle: "Fifteen cups. Bring extra balls.",
    balls: 10,
    rack: { type: "triangle", rows: 5, zBack: 2.0 },  // 15 cups
    cupScale: 1.05,
    parStars: { 3: 8, 2: 10, 1: 13 },
  },
  {
    id: "pp_07_tight_throw",
    name: "Tight Throw",
    subtitle: "Ten cups, only five balls. Make them count.",
    balls: 5,
    rack: { type: "triangle", rows: 4, zBack: 1.9 },
    cupScale: 1.10,
    parStars: { 3: 4, 2: 5, 1: 5 },
  },
  {
    id: "pp_08_v_split",
    name: "V Split",
    subtitle: "Two columns flank a middle gap. Aim around it.",
    balls: 8,
    rack: { type: "v", rows: 4, zBack: 2.0 },         // 9 cups (8 + gold center)
    cupScale: 1.10,
    parStars: { 3: 6, 2: 8, 1: 10 },
  },
  {
    id: "pp_09_far_diamond",
    name: "Far Diamond",
    subtitle: "Diamond at the back of the table.",
    balls: 7,
    rack: { type: "diamond", zBack: 2.4 },
    cupScale: 1.00,
    parStars: { 3: 5, 2: 7, 1: 9 },
  },
  {
    id: "pp_10_finale",
    name: "House Cup",
    subtitle: "Twenty-one cups. Run the table.",
    balls: 14,
    rack: { type: "triangle", rows: 6, zBack: 2.1 },  // 21 cups
    cupScale: 1.00,
    parStars: { 3: 12, 2: 15, 1: 18 },
  },
];

// Cup geometry constants — kept in one place so render and physics
// stay in sync. Units are meters.
export const CUP_BASE_R    = 0.12;   // outer rim radius at scale 1.0
export const CUP_HEIGHT    = 0.28;
export const CUP_LIP       = 0.012;  // rim thickness (rim hit zone)
export const TABLE_Y       = 0.10;
export const TABLE_W       = 1.6;    // lateral table width (meters)
export const TABLE_Z_NEAR  = 0.4;    // front edge of table (closest to thrower)

// Resolve a level's rack descriptor into a list of cup specs that
// physics + render consume. Each cup is { x, z, r, gold? }, with
// y implied (= TABLE_Y; cup top at TABLE_Y + CUP_HEIGHT).
//
// Spacing keeps cups touching with a tiny gap so the rack reads as a
// single unit. zBack pins the FAR row (highest z); rows step toward
// the thrower in -z increments of (2 * cupR).
export function buildCups(level) {
  const r = CUP_BASE_R * (level.cupScale || 1);
  const stride = r * 2.05;
  const cups = [];
  const f = level.rack;
  if (f.type === "triangle") {
    // Standard beer pong rack: rows decrease as they near the thrower.
    // Back row has `rows` cups; front (apex) row has 1.
    for (let row = 0; row < f.rows; row++) {
      const count = f.rows - row;
      const z = f.zBack - row * stride * 0.95;
      for (let i = 0; i < count; i++) {
        const x = (i - (count - 1) / 2) * stride;
        cups.push({ x, z, r, gold: false });
      }
    }
  } else if (f.type === "line") {
    const z = f.zBack;
    for (let i = 0; i < f.count; i++) {
      const x = (i - (f.count - 1) / 2) * stride;
      cups.push({ x, z, r, gold: false });
    }
  } else if (f.type === "diamond") {
    // 9-cup diamond: 1-2-3-2-1 across rows. Gold center.
    const layout = [1, 2, 3, 2, 1];
    for (let row = 0; row < layout.length; row++) {
      const count = layout[row];
      const z = f.zBack - row * stride * 0.95;
      for (let i = 0; i < count; i++) {
        const x = (i - (count - 1) / 2) * stride;
        const gold = row === 2 && i === 1; // dead center
        cups.push({ x, z, r, gold });
      }
    }
  } else if (f.type === "v") {
    // Two parallel columns split by a center gap, mirroring beer-pong
    // "V" formation. Each row has 2 cups.
    for (let row = 0; row < f.rows; row++) {
      const z = f.zBack - row * stride * 0.95;
      const offset = stride * 1.4;
      cups.push({ x: -offset, z, r, gold: false });
      cups.push({ x:  offset, z, r, gold: false });
    }
    // Add a gold "money cup" in the middle of the back row.
    cups.push({ x: 0, z: f.zBack, r, gold: true });
  }
  return cups;
}

// Stars earned given balls used and whether the rack cleared.
export function starsFor(level, ballsUsed, cleared) {
  if (!cleared) return 0;
  const par = level.parStars || { 3: level.balls, 2: level.balls, 1: level.balls };
  if (ballsUsed <= par[3]) return 3;
  if (ballsUsed <= par[2]) return 2;
  if (ballsUsed <= par[1]) return 1;
  return 0;
}

export function levelById(id) {
  return PP_LEVELS.find(l => l.id === id) || null;
}

// Levels unlock in order. Level 1 is always playable; level N+1 unlocks
// when level N has at least one star.
export function isLevelUnlocked(saveProgress, levelId) {
  const idx = PP_LEVELS.findIndex(l => l.id === levelId);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i++) {
    const rec = saveProgress && saveProgress[PP_LEVELS[i].id];
    if (!rec || (rec.stars || 0) < 1) return false;
  }
  return true;
}

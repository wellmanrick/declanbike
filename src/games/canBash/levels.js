// Can Bash level catalog. Each level is a small data record describing
// the can formation, ball budget, and the par-star thresholds.
//
// Schema:
//   id         — unique level slug (used as save key)
//   name       — display name shown in the level grid
//   subtitle   — short flavor line under the name
//   balls      — number of balls the player gets
//   formation  — declarative description of the can stack:
//                  { type: "pyramid", rows: 5, gold: "top" }
//                  { type: "tower",   rows: 4 }
//                  { type: "split",   rows: 3, gap: 0.6 }
//                  { type: "wall",    rows: 3, cols: 4 }
//                  { type: "custom",  cans: [{ x, y, gold? }, ...] }
//   parStars   — balls-used thresholds for each star tier:
//                  { 3: 1, 2: 2, 1: 3 } means
//                  3 stars if cleared with ≤1 ball used,
//                  2 stars if cleared with ≤2 balls,
//                  1 star  if cleared at all (within the level's ball budget),
//                  0 stars if not cleared.
//   theme      — currently only "carnival"; reserved for future skins.
//
// Layouts are resolved into raw cans by buildCans() below. The renderer
// and physics consume that raw can list, so adding a new formation type
// only needs a new branch here.

export const CAN_LEVELS = [
  {
    id: "cb_01_warmup",
    name: "Warm Up",
    subtitle: "A small stack to find your flick.",
    balls: 3,
    formation: { type: "pyramid", rows: 3 },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_02_first_pyramid",
    name: "First Pyramid",
    subtitle: "Knock 'em all to clear.",
    balls: 3,
    formation: { type: "pyramid", rows: 4 },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_03_tower",
    name: "Tower",
    subtitle: "Tall stack — aim low or high.",
    balls: 3,
    formation: { type: "tower", rows: 5 },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_04_classic",
    name: "Classic Stack",
    subtitle: "The carnival favorite. One gold up top.",
    balls: 3,
    formation: { type: "pyramid", rows: 5, gold: "top" },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_05_split",
    name: "Split Pair",
    subtitle: "Two stacks. Pick your side or split it.",
    balls: 3,
    formation: { type: "split", rows: 3, gap: 1.2 },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_06_wall",
    name: "Brick Wall",
    subtitle: "A wide wall — the keystone matters.",
    balls: 3,
    formation: { type: "wall", rows: 3, cols: 5 },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_07_big_pyramid",
    name: "Big Pyramid",
    subtitle: "Six rows. Hit it where it lives.",
    balls: 3,
    formation: { type: "pyramid", rows: 6, gold: "top" },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_08_double_tower",
    name: "Twin Towers",
    subtitle: "Two narrow stacks — surgical flicks only.",
    balls: 3,
    formation: { type: "split", rows: 4, gap: 0.9, narrow: true },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_09_keystone",
    name: "Keystone",
    subtitle: "Drop the keystone, watch it cascade.",
    balls: 2,
    formation: { type: "custom", cans: [
      // Bottom row of 4 — close enough together to support the keystone
      // above. Spacing matches the support tolerance (dx < 0.85 * canW).
      { x: -0.74, row: 0 },
      { x: -0.25, row: 0 },
      { x:  0.25, row: 0 },
      { x:  0.74, row: 0 },
      // Keystone — held up by the two inner bottom cans.
      { x:  0,    row: 1, gold: true },
      // The stack riding the keystone. If the keystone falls, these go too.
      { x: -0.25, row: 2 },
      { x:  0.25, row: 2 },
      { x:  0,    row: 3 },
    ] },
    parStars: { 3: 1, 2: 2, 1: 2 },
    theme: "carnival",
  },
  {
    id: "cb_10_grandstand",
    name: "Grandstand",
    subtitle: "Master challenge. Make every flick count.",
    balls: 3,
    formation: { type: "wall", rows: 4, cols: 5, gold: "center" },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
];

const CAN_W = 0.45;
const CAN_H = 0.55;
const TABLE_TOP_Y = 0.6;

// Resolve a level's formation into a raw list of can specs the physics
// layer consumes. Returns { cans, tableTopY }.
//
// Each can has world-space x (lateral), y (vertical, table-top is y=tableTopY,
// and rows stack upward), and an optional `gold` flag.
export function buildCans(level) {
  const f = level.formation;
  const cans = [];
  const tableTopY = TABLE_TOP_Y;

  function addRowed(row, x, gold) {
    const y = tableTopY + row * CAN_H + CAN_H / 2;
    cans.push({ x, y, gold: !!gold });
  }

  function pyramid(rows, originX, narrow, goldMode) {
    const stride = (narrow ? 1.0 : 1.1);
    let topIdx = -1;
    for (let row = 0; row < rows; row++) {
      const count = rows - row;
      for (let i = 0; i < count; i++) {
        const x = originX + (i - (count - 1) / 2) * CAN_W * stride;
        addRowed(row, x, false);
      }
    }
    if (goldMode === "top") {
      // Last can pushed at top is the apex.
      topIdx = cans.length - 1;
      cans[topIdx].gold = true;
    }
  }

  function tower(rows, originX) {
    for (let row = 0; row < rows; row++) {
      addRowed(row, originX, false);
    }
  }

  function wall(rows, cols, originX, goldMode) {
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < cols; i++) {
        const x = originX + (i - (cols - 1) / 2) * CAN_W * 1.1;
        addRowed(row, x, false);
      }
    }
    if (goldMode === "center") {
      // Pick the middle of the top row.
      const topRowStart = (rows - 1) * cols;
      const mid = Math.floor(cols / 2);
      cans[topRowStart + mid].gold = true;
    }
  }

  if (f.type === "pyramid") {
    pyramid(f.rows, 0, !!f.narrow, f.gold);
  } else if (f.type === "tower") {
    tower(f.rows, 0);
  } else if (f.type === "split") {
    const halfGap = (f.gap || 1.0) * 0.5;
    pyramid(f.rows, -halfGap - (f.rows - 1) * CAN_W * 0.55, !!f.narrow, null);
    pyramid(f.rows,  halfGap + (f.rows - 1) * CAN_W * 0.55, !!f.narrow, null);
  } else if (f.type === "wall") {
    wall(f.rows, f.cols, 0, f.gold);
  } else if (f.type === "custom") {
    for (const c of f.cans) {
      addRowed(c.row, c.x, c.gold);
    }
  } else {
    // Fallback: classic 5-row pyramid.
    pyramid(5, 0, false, "top");
  }

  return { cans, tableTopY };
}

// Compute star count from balls used and cleared status.
//   balls = number of balls thrown that hit the table region
//   cleared = whether all cans were knocked
export function starsFor(level, ballsUsed, cleared) {
  if (!cleared) return 0;
  const par = level.parStars || { 3: 1, 2: 2, 1: 3 };
  if (ballsUsed <= par[3]) return 3;
  if (ballsUsed <= par[2]) return 2;
  if (ballsUsed <= par[1]) return 1;
  return 0;
}

export function levelById(id) {
  return CAN_LEVELS.find(l => l.id === id) || null;
}

// True when all earlier levels in the catalog have at least 1 star.
// Level 1 is always unlocked.
export function isLevelUnlocked(saveProgress, levelId) {
  const idx = CAN_LEVELS.findIndex(l => l.id === levelId);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i++) {
    const rec = saveProgress && saveProgress[CAN_LEVELS[i].id];
    if (!rec || (rec.stars || 0) < 1) return false;
  }
  return true;
}

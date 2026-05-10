// Can Bash level catalog. Each level is a small data record describing
// the can formation, ball budget, and the par-star thresholds.
//
// Schema:
//   id         — unique level slug (used as save key)
//   name       — display name shown in the level grid
//   subtitle   — short flavor line under the name
//   balls      — number of balls the player gets
//   formation  — declarative description of the can stack. Types:
//                  { type: "pyramid", rows: 5, gold: "top" }
//                  { type: "tower",   rows: 4 }
//                  { type: "split",   rows: 3, gap: 0.6 }
//                  { type: "wall",    rows: 3, cols: 4 }
//                  { type: "custom",  cans: [{ x, row, gold?, type? }, ...] }
//                Optional: formation.types = [{ row, col?, type }] applies
//                per-can type overrides after layout. row = "all" or index;
//                col = index, [from,to] range, or omitted (whole row).
//                Optional: formation.powerups = [{ type, row, col? }] binds
//                pickups to specific cans. type = "bomb"/"multi"/"slow".
//                Knock the host can to collect the pickup; it arms the
//                next throw and is consumed when fired.
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
    subtitle: "Slow-time pickup on the apex — try it.",
    balls: 3,
    formation: {
      type: "pyramid", rows: 4,
      // Apex of a 4-row pyramid is row=3, col=0. Knocking it grants
      // slow-time for the next throw.
      powerups: [{ type: "slow", row: 3, col: 0 }],
    },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_03_tower",
    name: "Tower",
    subtitle: "Bomb-ball pickup on top — wreck the column.",
    balls: 3,
    formation: {
      type: "tower", rows: 5,
      // Top of the tower (row 4) carries the bomb pickup.
      powerups: [{ type: "bomb", row: 4 }],
    },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_04_classic",
    name: "Classic Stack",
    subtitle: "Glass middle — fragile pieces, careful aim.",
    balls: 3,
    formation: {
      type: "pyramid", rows: 5, gold: "top",
      // Row 2 (middle) is glass — shatters on any hit, easy support break.
      types: [{ row: 2, type: "glass" }],
    },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_05_split",
    name: "Split Pair",
    subtitle: "Multi-ball on the right pyramid apex — clear both stacks.",
    balls: 3,
    formation: {
      type: "split", rows: 3, gap: 1.2,
      // Pickup binds to the LEFT pyramid apex (split-layout cans are
      // appended left-then-right, and the row+col scanner picks the
      // first match).
      powerups: [{ type: "multi", row: 2, col: 0 }],
    },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_06_wall",
    name: "Brick Wall",
    subtitle: "Lead center column — flick HARD to break through.",
    balls: 3,
    formation: {
      type: "wall", rows: 3, cols: 5,
      // Center column on every row is lead. Soft tosses bounce off; only
      // a hard flick into the middle takes them down.
      types: [{ row: "all", col: 2, type: "lead" }],
    },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_07_big_pyramid",
    name: "Big Pyramid",
    subtitle: "Bomb-ball on the third row — drop the keystone.",
    balls: 3,
    formation: {
      type: "pyramid", rows: 6, gold: "top",
      // Mid-row outer can — within reach of a routine flick, payoff is
      // a bomb-ball that takes a huge bite of the next throw.
      powerups: [{ type: "bomb", row: 2, col: 0 }],
    },
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
      // above. Inner pair is LEAD: weak hits bounce off, forcing the
      // player to commit to a hard flick at the gold keystone above.
      { x: -0.74, row: 0 },
      { x: -0.25, row: 0, type: "lead" },
      { x:  0.25, row: 0, type: "lead" },
      { x:  0.74, row: 0 },
      // Keystone — held up by the lead pair.
      { x:  0,    row: 1, gold: true },
      // Stack riding the keystone. If the keystone drops, these go too.
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
    subtitle: "Explosive in the bottom-center — hit it for a chain.",
    balls: 3,
    formation: {
      type: "wall", rows: 4, cols: 5, gold: "center",
      // Bottom-center is explosive. A clean hit clears the whole middle
      // column instantly and shaves the wall in half.
      types: [{ row: 0, col: 2, type: "explosive" }],
    },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_11_glasshouse",
    name: "Glass House",
    subtitle: "Slow-time for precision — most cans are glass.",
    balls: 2,
    formation: {
      type: "wall", rows: 3, cols: 5,
      types: [{ row: 1, type: "glass" }, { row: 2, type: "glass" }],
      // Center of the bottom row carries the slow-time pickup.
      powerups: [{ type: "slow", row: 0, col: 2 }],
    },
    parStars: { 3: 1, 2: 2, 1: 2 },
    theme: "carnival",
  },
  {
    id: "cb_12_lead_lord",
    name: "Lead Lord",
    subtitle: "Lead apex guards a gold core. Don't waste a ball.",
    balls: 2,
    formation: { type: "custom", cans: [
      // 5-can wide base
      { x: -0.99, row: 0 },
      { x: -0.495, row: 0 },
      { x:  0,    row: 0, gold: true },
      { x:  0.495, row: 0 },
      { x:  0.99, row: 0 },
      // Row 1 inner pair (over the gold)
      { x: -0.2475, row: 1 },
      { x:  0.2475, row: 1 },
      // Lead apex on top — only a hard flick takes it.
      { x:  0,    row: 2, type: "lead" },
    ] },
    parStars: { 3: 1, 2: 2, 1: 2 },
    theme: "carnival",
  },
  {
    id: "cb_13_powderkeg",
    name: "Powder Keg",
    subtitle: "Multi-ball + a center detonator. Make it count.",
    balls: 3,
    formation: {
      type: "wall", rows: 3, cols: 5,
      // Dead-center is the explosive. It's surrounded on every side by
      // standard cans so the AoE on detonation hits ~6-8 neighbors.
      types: [{ row: 1, col: 2, type: "explosive" }],
      // Multi-ball pickup on a corner — collecting it on throw 1 lets
      // throw 2 spread three balls into the explosive.
      powerups: [{ type: "multi", row: 0, col: 0 }],
    },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
  {
    id: "cb_14_stackers",
    name: "Stack 'em High",
    subtitle: "Coin stacks. Every can counts.",
    balls: 3,
    formation: {
      type: "wall", rows: 4, cols: 4,
      types: [{ row: "all", type: "stacker" }],
    },
    parStars: { 3: 1, 2: 2, 1: 3 },
    theme: "carnival",
  },
];

// Can-type catalog. Keep this list narrow — every type costs physics,
// render, and balance work to introduce. Phase 2 adds four:
//   "standard" — silver (default)
//   "glass"    — fragile, knocks on any contact, shatters
//   "lead"     — heavy, only the hardest flicks knock it
//   "explosive"— knock triggers a small radius blast that takes nearby cans
//   "stacker"  — visual variant; same physics as standard
export const CAN_TYPES = ["standard", "glass", "lead", "explosive", "stacker"];

// Per-type tuning. Read by physics + render layers. Adding a type means
// adding an entry here and a render branch in CanBash.render's can loop.
export const CAN_TYPE_INFO = {
  standard:  { score: 10, knockSpeed:  9, label: "Standard" },
  glass:     { score:  5, knockSpeed:  0, label: "Glass — shatters on any hit" },
  lead:      { score: 25, knockSpeed: 16, label: "Lead — needs a hard flick" },
  explosive: { score: 30, knockSpeed:  9, label: "Explosive — clears nearby cans" },
  stacker:   { score: 12, knockSpeed:  9, label: "Coin stack" },
};

// Power-up catalog. Three types share one inventory slot — collecting a
// new pickup overwrites the previous one. The active power applies to
// the NEXT throw and is consumed when that throw fires.
//   bomb  — next ball detonates on impact (1.0m AoE, ignores support)
//   multi — next throw splits into 3 balls in a tight yaw spread
//   slow  — next throw plays in slow-motion for the entire flight
export const POWER_TYPES = ["bomb", "multi", "slow"];
export const POWER_INFO = {
  bomb:  { icon: "💣", label: "Bomb-ball collected — next throw explodes" },
  multi: { icon: "✕3", label: "Multi-ball collected — next throw splits into 3" },
  slow:  { icon: "⏱",  label: "Slow-time collected — next throw plays in slow-mo" },
};

const CAN_W = 0.45;
const CAN_H = 0.55;
const TABLE_TOP_Y = 0.6;

// Resolve a level's formation into a raw list of can specs the physics
// layer consumes. Returns { cans, tableTopY }.
//
// Each can has world-space x (lateral), y (vertical, table-top is y=tableTopY,
// and rows stack upward), an optional `gold` flag, and a `type` from
// CAN_TYPES (defaults to "standard").
//
// Formations support optional per-row overrides:
//   formation.types: { row: index_or_"all", type: "glass"/"lead"/... }[]
// applied after layout. `custom` formations may also pin a type per can.
export function buildCans(level) {
  const f = level.formation;
  const cans = [];
  const tableTopY = TABLE_TOP_Y;

  function addRowed(row, x, gold, type) {
    const y = tableTopY + row * CAN_H + CAN_H / 2;
    cans.push({ x, y, row, gold: !!gold, type: type || "standard" });
  }

  function pyramid(rows, originX, narrow, goldMode) {
    const stride = (narrow ? 1.0 : 1.1);
    for (let row = 0; row < rows; row++) {
      const count = rows - row;
      for (let i = 0; i < count; i++) {
        const x = originX + (i - (count - 1) / 2) * CAN_W * stride;
        addRowed(row, x, false, "standard");
      }
    }
    if (goldMode === "top") {
      cans[cans.length - 1].gold = true;
    }
  }

  function tower(rows, originX) {
    for (let row = 0; row < rows; row++) {
      addRowed(row, originX, false, "standard");
    }
  }

  function wall(rows, cols, originX, goldMode) {
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < cols; i++) {
        const x = originX + (i - (cols - 1) / 2) * CAN_W * 1.1;
        addRowed(row, x, false, "standard");
      }
    }
    if (goldMode === "center") {
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
      addRowed(c.row, c.x, c.gold, c.type || "standard");
    }
  } else {
    pyramid(5, 0, false, "top");
  }

  // Powerup pickups. Each entry is { type: "bomb"|"multi"|"slow", row, col? }
  // and is bound to the specified can by index. Collecting that can hands
  // the pickup to the player's inventory. The pickup floats above the can
  // visually until taken.
  const pickups = [];
  const powerups = f.powerups || [];
  for (const p of powerups) {
    const matchRow = p.row;
    const matchCol = p.col == null ? 0 : p.col;
    let colIdx = 0;
    let lastRow = -1;
    let bound = -1;
    for (let i = 0; i < cans.length; i++) {
      const c = cans[i];
      if (c.row !== lastRow) { colIdx = 0; lastRow = c.row; }
      else colIdx++;
      if (c.row === matchRow && colIdx === matchCol) { bound = i; break; }
    }
    if (bound >= 0) pickups.push({ type: p.type, canIdx: bound });
  }

  // Apply formation-level type overrides. Each entry is { match, type } where
  // `match` selects cans by row ("all" or a row index) plus optional col
  // index/range. Applied in order so later rules can override earlier ones.
  const overrides = f.types || [];
  for (const rule of overrides) {
    const matchRow = rule.row;
    const matchCol = rule.col; // optional: can-index within row, or [from,to]
    let colIdx = 0;
    let lastRow = -1;
    for (let i = 0; i < cans.length; i++) {
      const c = cans[i];
      if (c.row !== lastRow) { colIdx = 0; lastRow = c.row; }
      else colIdx++;
      const rowMatch = matchRow === "all" || matchRow === c.row;
      let colMatch = matchCol == null;
      if (Array.isArray(matchCol)) colMatch = colIdx >= matchCol[0] && colIdx <= matchCol[1];
      else if (typeof matchCol === "number") colMatch = colIdx === matchCol;
      if (rowMatch && colMatch) c.type = rule.type;
    }
  }

  return { cans, tableTopY, pickups };
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

// Trail catalog. Each entry sets terrain seed + difficulty knobs (hills,
// gaps), the visual theme, gold/silver/bronze medal time targets, and
// optional flags like lowGravity for special variants.
import { save } from "../engine/save.js";

export const LEVELS = [
  { id: "trail_01", name: "Backyard Trail",  length: 3300, seed: 11,  difficulty: 1, hills: 0.6, gaps: 0.2, theme: "day",
    medals: { gold: 38, silver: 57, bronze: 83 },
    objective: { metric: "cleanLandings", target: 2, label: "Land 2 clean jumps" },
    desc: "An easy warm-up loop. Learn the controls." },
  { id: "trail_02", name: "Pine Ridge",      length: 4200, seed: 23,  difficulty: 2, hills: 1.0, gaps: 0.5, theme: "day",
    medals: { gold: 48, silver: 72, bronze: 102 },
    objective: { metric: "maxCombo", target: 3, label: "Reach a 3x combo" },
    desc: "Rolling hills with the first real ramps.", unlockAfter: "trail_01" },
  { id: "trail_03", name: "Quarry Run",      length: 5100, seed: 47,  difficulty: 3, hills: 1.4, gaps: 0.8, theme: "sunset",
    medals: { gold: 63, silver: 90, bronze: 123 },
    objective: { metric: "flips", target: 2, label: "Land 2 flips" },
    desc: "Wide gaps under sunset glow. Bring boost.", unlockAfter: "trail_02" },
  { id: "trail_04", name: "Dunes",           length: 4500, seed: 71,  difficulty: 3, hills: 2.0, gaps: 0.4, theme: "desert",
    medals: { gold: 57, silver: 81, bronze: 111 },
    objective: { metric: "airtime", target: 8, label: "Rack up 8s airtime" },
    desc: "Smooth and rolling. Catch air on every crest.", unlockAfter: "trail_02" },
  { id: "trail_05", name: "Twilight Pass",   length: 5400, seed: 91,  difficulty: 4, hills: 1.4, gaps: 1.0, theme: "dusk",
    medals: { gold: 69, silver: 96, bronze: 132 },
    objective: { metric: "perfectLandings", target: 3, label: "Nail 3 perfect landings" },
    desc: "Dusk roller doubles and tight gaps. Quick reactions.", unlockAfter: "trail_03" },
  { id: "trail_06", name: "Sunset Ridge",    length: 4800, seed: 113, difficulty: 4, hills: 1.6, gaps: 1.0, theme: "sunset",
    medals: { gold: 63, silver: 87, bronze: 120 },
    objective: { metric: "topSpeed", target: 85, label: "Hit 85 mph" },
    desc: "Cresting ridges and long gaps in the sunset light.", unlockAfter: "trail_04" },
  { id: "trail_07", name: "Lunar Loop",      length: 5700, seed: 131, difficulty: 4, hills: 2.4, gaps: 1.2, theme: "night",
    medals: { gold: 78, silver: 105, bronze: 143 },
    objective: { metric: "longestAir", target: 4, label: "Hold one 4s jump" },
    desc: "Low gravity. Big floaty jumps under starlight.", unlockAfter: "trail_05", lowGravity: true },
  { id: "trail_08", name: "Canyon Run",      length: 5400, seed: 157, difficulty: 5, hills: 1.8, gaps: 1.6, theme: "desert",
    medals: { gold: 72, silver: 99, bronze: 135 },
    objective: { metric: "crashes", target: 0, label: "Finish with no crashes", compare: "lte" },
    desc: "Long red ridges and yawning gaps. Time it or eat sand.", unlockAfter: "trail_06" },
  { id: "trail_09", name: "Midnight Mile",   length: 6000, seed: 179, difficulty: 5, hills: 1.4, gaps: 1.8, theme: "night",
    medals: { gold: 81, silver: 108, bronze: 147 },
    objective: { metric: "gems", target: 3, label: "Collect 3 gems" },
    desc: "Wide gaps in the dark. Pure send.", unlockAfter: "trail_07" },
  { id: "trail_10", name: "Mt. Send-It",     length: 6600, seed: 137, difficulty: 5, hills: 2.4, gaps: 1.4, theme: "dusk",
    medals: { gold: 87, silver: 117, bronze: 158 },
    objective: { metric: "score", target: 2500, label: "Score 2,500 pts" },
    desc: "Final boss. Big air, big gaps, no margin.", unlockAfter: "trail_08" },
];

export function medalForTime(level, time) {
  if (!level.medals) return null;
  if (time <= level.medals.gold)   return "gold";
  if (time <= level.medals.silver) return "silver";
  if (time <= level.medals.bronze) return "bronze";
  return null;
}
export function medalRank(m) { return m === "gold" ? 3 : m === "silver" ? 2 : m === "bronze" ? 1 : 0; }
export function medalIcon(m) { return m === "gold" ? "🥇" : m === "silver" ? "🥈" : m === "bronze" ? "🥉" : "—"; }

export function levelUnlocked(lvl) {
  if (!lvl.unlockAfter) return true;
  if (save.unlockedLevels[lvl.id]) return true;
  return !!(save.best[lvl.unlockAfter] && save.best[lvl.unlockAfter].completed);
}

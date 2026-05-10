// Lifetime quest catalog. Quests track totals from save.totals or
// per-run "best" metrics stored on the quest itself, and pay out cash
// automatically when their target is reached.
import { save, persistSave } from "../engine/save.js";
import { LEVELS } from "./levels.js";
import { pushToast } from "../engine/juice.js";

export const QUESTS = [
  { id: "q_first_run",    name: "First Run",        desc: "Complete any trail.",                      target: 1,             metric: "completions",     reward: 100 },
  { id: "q_distance_1",   name: "Long Hauler",      desc: "Cover 5 km total distance.",               target: 5000,          metric: "distance",        reward: 200 },
  { id: "q_distance_2",   name: "Cross-Country",    desc: "Cover 25 km total.",                       target: 25000,         metric: "distance",        reward: 800 },
  { id: "q_flips_1",      name: "Backflipper",      desc: "Land 5 flips total.",                      target: 5,             metric: "flips",           reward: 150 },
  { id: "q_flips_2",      name: "Trick Master",     desc: "Land 50 flips total.",                     target: 50,            metric: "flips",           reward: 600 },
  { id: "q_air_1",        name: "Bird Brain",       desc: "Rack up 60 seconds of air time.",          target: 60,            metric: "airtime",         reward: 250 },
  { id: "q_combo_1",      name: "Combo Cook",       desc: "Hit a 5x combo in a single run.",          target: 5,             metric: "maxCombo",        reward: 300 },
  { id: "q_combo_2",      name: "Combo Chef",       desc: "Hit a 10x combo in a single run.",         target: 10,            metric: "maxCombo",        reward: 800 },
  { id: "q_clean_1",      name: "Stick the Landing",desc: "Stick 25 clean landings.",                 target: 25,            metric: "cleanLandings",   reward: 250 },
  { id: "q_perfect",      name: "Perfectionist",    desc: "Nail 10 perfect landings (within 3°).",    target: 10,            metric: "perfectLandings", reward: 500 },
  { id: "q_jumps",        name: "Send It",          desc: "Catch 50 jumps total.",                    target: 50,            metric: "jumps",           reward: 350 },
  { id: "q_crashes",      name: "Tough Skin",       desc: "Survive 10 crashes. Painful but fair.",    target: 10,            metric: "crashes",         reward: 200 },
  { id: "q_complete_3",   name: "Trail Boss",       desc: "Complete 3 different trails.",             target: 3,             metric: "uniqueTrails",    reward: 600 },
  { id: "q_complete_all", name: "Excite Champion",  desc: "Complete every trail.",                    target: LEVELS.length, metric: "uniqueTrails",    reward: 1500 },
  { id: "q_speed_1",      name: "Need for Speed",   desc: "Hit 80 mph in a single run.",              target: 80,            metric: "topSpeed",        reward: 300 },
  { id: "q_speed_2",      name: "Ludicrous Speed",  desc: "Hit 110 mph in a single run.",             target: 110,           metric: "topSpeed",        reward: 700 },
  { id: "q_gem",          name: "Gem Collector",    desc: "Collect 20 gems total.",                   target: 20,            metric: "gemsTotal",       reward: 400 },
  { id: "q_air_2",        name: "Skydiver",         desc: "Rack up 5 minutes of air time total.",     target: 300,           metric: "airtime",         reward: 700 },
  { id: "q_air_single",   name: "Hang Time",        desc: "Get 5s of airtime on one jump.",           target: 5,             metric: "longestAir",      reward: 350 },
  { id: "q_no_crash",     name: "Clean Run",        desc: "Finish any trail without crashing.",       target: 1,             metric: "cleanRuns",       reward: 500 },
  { id: "q_perfect_3",    name: "Stick Three",      desc: "Three perfect landings in one run.",       target: 3,             metric: "runPerfects",     reward: 400 },
  { id: "q_runs",         name: "Frequent Flyer",   desc: "Finish 25 runs.",                          target: 25,            metric: "runs",            reward: 500 },
];

export function getQuestProgress(q) {
  const t = save.totals;
  switch (q.metric) {
    case "distance":         return Math.floor(t.distance);
    case "flips":            return t.flips;
    case "airtime":          return Math.floor(t.airtime);
    case "cleanLandings":    return t.cleanLandings;
    case "perfectLandings":  return t.perfectLandings;
    case "jumps":            return t.jumps;
    case "crashes":          return t.crashes;
    case "runs":             return t.runs || 0;
    case "completions":      return Object.values(save.best).filter(b => b.completed).length;
    case "uniqueTrails":     return Object.values(save.best).filter(b => b.completed).length;
    case "gemsTotal":        return t.gems || 0;
    case "cleanRuns":        return t.cleanRuns || 0;
    case "maxCombo":
    case "topSpeed":
    case "longestAir":
    case "runPerfects":
      return save.quests[q.id]?.progress || 0;
    default: return 0;
  }
}

export function refreshQuestStates(runStats = null) {
  const perRunMetrics = ["maxCombo", "topSpeed", "longestAir", "runPerfects"];
  for (const q of QUESTS) {
    const state = save.quests[q.id] || (save.quests[q.id] = { progress: 0, done: false, claimed: false });
    if (perRunMetrics.includes(q.metric) && runStats) {
      const v = runStats[q.metric];
      if (typeof v === "number" && v > state.progress) state.progress = v;
    }
    const prog = getQuestProgress(q);
    if (!state.done && prog >= q.target) {
      state.done = true;
      pushToast(`Quest done: ${q.name}`, "gold");
    }
  }
  for (const q of QUESTS) {
    const s = save.quests[q.id];
    if (s.done && !s.claimed) {
      save.cash += q.reward;
      s.claimed = true;
      pushToast(`+$${q.reward} — ${q.name}`, "green");
    }
  }
  persistSave();
}

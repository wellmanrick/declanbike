// Shared mutable game state.
// G is a single mutable container so consumers can read and write
// `G.state`, `G.runtime`, `G.minigameRuntime` from any module without
// needing setter functions everywhere.
export const STATE = Object.freeze({
  MENU: "menu",
  LEVELS: "levels",
  GARAGE: "garage",
  QUESTS: "quests",       // doubles as mini-games hub
  HOW: "how",
  PLAY: "play",
  PAUSE: "pause",
  RESULT: "result",
  MINIGAME: "minigame",
  CB_LEVELS: "cb-levels", // Can Bash level select
  FG_LEVELS: "fg-levels", // Field Goal level select
});

export const G = {
  state: STATE.MENU,
  runtime: null,         // active trail run
  minigameRuntime: null, // active mini-game
};

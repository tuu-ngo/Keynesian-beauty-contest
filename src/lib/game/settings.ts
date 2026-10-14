import type { GameSettings } from "./types";

export const DEFAULT_SETTINGS: GameSettings = {
  p: 0.8,
  min: 0,
  max: 100,
  step: 0.1,
  rounds: 3,
  timerSeconds: 60,
  allowChangeUntilLock: true,
  showNamesOnReveal: false,
  pointsForWin: 10,
  closeCallBonus: 0,
  maxPlayers: 200,
  escalationEnabled: true,
  ruleList: [1, 2],
};

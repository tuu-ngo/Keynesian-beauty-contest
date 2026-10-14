export type GameState =
  | "LOBBY"
  | "ROUND_OPEN"
  | "ROUND_LOCKED"
  | "ROUND_REVEALED"
  | "FINISHED";

export type Phase = "NORMAL" | "ESCALATION";

export type PlayerStatus = "ACTIVE" | "ELIMINATED";

export interface GameSettings {
  /** Target multiplier: target = p * average. */
  p: number;
  min: number;
  max: number;
  /** Pick granularity (1, 0.1, 0.01). */
  step: number;
  /** Rounds in the normal phase; null = unlimited until the host ends it. */
  rounds: number | null;
  /** Seconds per round; null = no timer. */
  timerSeconds: number | null;
  allowChangeUntilLock: boolean;
  showNamesOnReveal: boolean;
  pointsForWin: number;
  /** Bonus for non-winners within CLOSE_CALL_DISTANCE of the target. 0 = off. */
  closeCallBonus: number;
  maxPlayers: number;
  /** Host can disable the escalation phase entirely. */
  escalationEnabled: boolean;
  /** Ordered rule ids: the Nash trigger activates the first, each elimination the next. */
  ruleList: number[];
}

export interface Player {
  token: string;
  name: string;
  status: PlayerStatus;
  eliminatedInRound: number | null;
  score: number;
}

export interface RoundRecord {
  round: number;
  /** Phase in force while this round was played. */
  phase: Phase;
  /** Rules in force while this round was played. */
  rulesInForce: number[];
  /** Pick values keyed by player token (active players only). */
  picks: Record<string, number>;
  average: number | null;
  target: number | null;
  winners: string[];
  /** Players who lost automatically (Rule 1 duplicates). */
  disqualified: string[];
  /** Rule id that decided the winners outright (Rule 2), if any. */
  overrideRule: number | null;
  pointsAwarded: Record<string, number>;
  nashReached: boolean;
  eliminated: string | null;
  eliminationCandidates: string[];
  eliminationSeed: string | null;
  /** Rule activated at the end of this round (Nash trigger or elimination). */
  newRule: number | null;
}

export interface Game {
  code: string;
  hostToken: string;
  version: number;
  state: GameState;
  phase: Phase;
  settings: GameSettings;
  activeRules: number[];
  /** 0 before the first round. */
  currentRound: number;
  players: Record<string, Player>;
  rounds: RoundRecord[];
  roundOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

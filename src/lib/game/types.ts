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
  /** Rounds in the normal phase. */
  rounds: number;
  /** Seconds per round; null = no timer. */
  timerSeconds: number | null;
  allowChangeUntilLock: boolean;
  showNamesOnReveal: boolean;
  pointsForWin: number;
  closeCallBonus: number;
  maxPlayers: number;
  /** Host can disable the escalation phase entirely. */
  escalationEnabled: boolean;
  /** Ordered rule ids activated by the Nash trigger and then by each elimination. */
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
  /** Pick values keyed by player token; scaled integers are used for arithmetic, see scale(). */
  picks: Record<string, number>;
  average: number | null;
  target: number | null;
  winners: string[];
  eliminated: string | null;
  eliminationSeed: string | null;
}

export interface Game {
  code: string;
  hostToken: string;
  version: number;
  state: GameState;
  phase: Phase;
  settings: GameSettings;
  activeRules: number[];
  currentRound: number;
  players: Record<string, Player>;
  rounds: RoundRecord[];
  roundOpenedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

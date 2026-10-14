import { chooseEliminated, isNashReached } from "./escalation";
import { fromUnits, toUnits } from "./numeric";
import { computeRound, toPickEntries } from "./scoring";
import { DEFAULT_SETTINGS } from "./settings";
import type { Game, GameSettings, Player, RoundRecord } from "./types";

/**
 * State machine. Every function is pure: it takes a game and returns a new one
 * (or throws GameError). Time and randomness are passed in by the caller.
 *
 * LOBBY -> ROUND_OPEN -> ROUND_LOCKED -> ROUND_REVEALED -> (ROUND_OPEN | FINISHED)
 */

export type GameErrorCode =
  | "INVALID_STATE"
  | "INVALID_NAME"
  | "NAME_TAKEN"
  | "GAME_FULL"
  | "UNKNOWN_PLAYER"
  | "PLAYER_ELIMINATED"
  | "INVALID_PICK"
  | "ROUND_CLOSED"
  | "ALREADY_SUBMITTED"
  | "ROUNDS_EXHAUSTED"
  | "NOT_ENOUGH_PLAYERS"
  | "INVALID_SETTINGS"
  | "ESCALATION_DISABLED";

export class GameError extends Error {
  constructor(
    public readonly code: GameErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "GameError";
  }
}

export const MAX_NAME_LENGTH = 20;

const clone = <T>(value: T): T => structuredClone(value);

export function activePlayers(game: Game): Player[] {
  return Object.values(game.players).filter((p) => p.status === "ACTIVE");
}

export function currentRoundRecord(game: Game): RoundRecord | undefined {
  return game.rounds[game.rounds.length - 1];
}

/** Absolute time (ms) at which the open round locks itself, or null if untimed. */
export function roundDeadline(game: Game): number | null {
  if (game.roundOpenedAt === null || game.settings.timerSeconds === null) return null;
  return game.roundOpenedAt + game.settings.timerSeconds * 1000;
}

export function createGame(args: {
  code: string;
  hostToken: string;
  now: number;
  settings?: Partial<GameSettings>;
}): Game {
  const settings = { ...DEFAULT_SETTINGS, ...args.settings };
  validateSettings(settings);
  return {
    code: args.code,
    hostToken: args.hostToken,
    version: 0,
    state: "LOBBY",
    phase: "NORMAL",
    settings,
    activeRules: [],
    currentRound: 0,
    players: {},
    rounds: [],
    roundOpenedAt: null,
    createdAt: args.now,
    updatedAt: args.now,
  };
}

export function sanitizeName(raw: string): string {
  return raw.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

export function joinGame(game: Game, args: { token: string; name: string }): Game {
  if (game.state !== "LOBBY") throw new GameError("INVALID_STATE", "Game already started");
  const name = sanitizeName(args.name);
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    throw new GameError("INVALID_NAME", `Name must be 1-${MAX_NAME_LENGTH} characters`);
  }
  const players = Object.values(game.players);
  if (players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new GameError("NAME_TAKEN");
  if (players.length >= game.settings.maxPlayers) throw new GameError("GAME_FULL");
  if (game.players[args.token]) throw new GameError("NAME_TAKEN", "Token already joined");

  const next = clone(game);
  next.players[args.token] = { token: args.token, name, status: "ACTIVE", eliminatedInRound: null, score: 0 };
  return next;
}

export function kickPlayer(game: Game, token: string): Game {
  if (!game.players[token]) throw new GameError("UNKNOWN_PLAYER");
  const next = clone(game);
  delete next.players[token];
  const round = currentRoundRecord(next);
  if (round && next.state === "ROUND_OPEN") delete round.picks[token];
  return next;
}

export function updateSettings(game: Game, patch: Partial<GameSettings>): Game {
  if (game.state !== "LOBBY" && game.state !== "ROUND_REVEALED") {
    throw new GameError("INVALID_STATE", "Settings can only change between rounds");
  }
  const settings = { ...game.settings, ...patch };
  validateSettings(settings);
  const next = clone(game);
  next.settings = settings;
  return next;
}

export function validateSettings(s: GameSettings): void {
  const bad = (message: string) => {
    throw new GameError("INVALID_SETTINGS", message);
  };
  if (!(s.p > 0 && s.p < 2)) bad("p must be between 0 and 2");
  if (!(s.step > 0)) bad("step must be positive");
  if (!(s.max > s.min)) bad("max must be greater than min");
  if (toUnits(s.min, s.step) === null || toUnits(s.max, s.step) === null) bad("min and max must be multiples of step");
  if (s.rounds !== null && !(Number.isInteger(s.rounds) && s.rounds >= 1 && s.rounds <= 10)) bad("rounds must be 1-10 or null");
  if (s.timerSeconds !== null && !(s.timerSeconds >= 5)) bad("timer must be at least 5 seconds or null");
  if (!(Number.isInteger(s.maxPlayers) && s.maxPlayers >= 2 && s.maxPlayers <= 500)) bad("maxPlayers must be 2-500");
  if (s.pointsForWin < 0 || s.closeCallBonus < 0) bad("points cannot be negative");
}

export function openRound(game: Game, now: number): Game {
  if (game.state === "ROUND_OPEN") return game; // idempotent
  if (game.state !== "LOBBY" && game.state !== "ROUND_REVEALED") throw new GameError("INVALID_STATE");

  const active = activePlayers(game);
  if (active.length < 2) throw new GameError("NOT_ENOUGH_PLAYERS");
  const { rounds } = game.settings;
  if (game.phase === "NORMAL" && rounds !== null && game.currentRound >= rounds) {
    throw new GameError("ROUNDS_EXHAUSTED");
  }

  const next = clone(game);
  next.currentRound += 1;
  next.state = "ROUND_OPEN";
  next.roundOpenedAt = now;
  next.rounds.push({
    round: next.currentRound,
    phase: next.phase,
    rulesInForce: [...next.activeRules],
    picks: {},
    average: null,
    target: null,
    winners: [],
    disqualified: [],
    overrideRule: null,
    pointsAwarded: {},
    nashReached: false,
    eliminated: null,
    eliminationCandidates: [],
    eliminationSeed: null,
    newRule: null,
  });
  return next;
}

export function submitPick(game: Game, args: { token: string; value: number; now: number }): Game {
  const player = game.players[args.token];
  if (!player) throw new GameError("UNKNOWN_PLAYER");
  if (player.status !== "ACTIVE") throw new GameError("PLAYER_ELIMINATED");
  if (game.state !== "ROUND_OPEN") throw new GameError("ROUND_CLOSED");
  const deadline = roundDeadline(game);
  if (deadline !== null && args.now >= deadline) throw new GameError("ROUND_CLOSED", "Time is up");

  const { min, max, step } = game.settings;
  const units = toUnits(args.value, step);
  if (units === null || args.value < min || args.value > max) {
    throw new GameError("INVALID_PICK", `Pick must be a multiple of ${step} between ${min} and ${max}`);
  }

  const next = clone(game);
  const round = currentRoundRecord(next)!;
  if (round.picks[args.token] !== undefined && !next.settings.allowChangeUntilLock) {
    throw new GameError("ALREADY_SUBMITTED");
  }
  round.picks[args.token] = fromUnits(units, step);
  return next;
}

/** Lock the open round (host action or timer). Idempotent. */
export function lockRound(game: Game): Game {
  if (game.state === "ROUND_LOCKED") return game;
  if (game.state !== "ROUND_OPEN") throw new GameError("INVALID_STATE");
  const next = clone(game);
  next.state = "ROUND_LOCKED";
  return next;
}

/** Apply timer expiry. Call on every read/write so a lapsed timer locks the round. */
export function syncTimer(game: Game, now: number): Game {
  const deadline = roundDeadline(game);
  if (game.state === "ROUND_OPEN" && deadline !== null && now >= deadline) return lockRound(game);
  return game;
}

/**
 * Reveal a locked round: score it, check the Nash trigger, and (in ESCALATION)
 * eliminate one player and activate the next rule. `seed` drives elimination ties.
 */
export function revealRound(game: Game, args: { seed: string }): Game {
  if (game.state === "ROUND_REVEALED") return game; // idempotent
  if (game.state !== "ROUND_LOCKED") throw new GameError("INVALID_STATE");

  const next = clone(game);
  const round = currentRoundRecord(next)!;
  const active = activePlayers(next).map((p) => p.token);

  const result = computeRound(toPickEntries(round.picks, next.settings.step), next.settings, round.rulesInForce);
  round.average = result.average;
  round.target = result.target;
  round.winners = result.winners;
  round.disqualified = result.disqualified;
  round.overrideRule = result.overrideRule;
  round.pointsAwarded = result.points;
  for (const [token, pts] of Object.entries(result.points)) next.players[token].score += pts;

  if (round.phase === "NORMAL") {
    if (isNashReached(active, round.picks, next.settings)) {
      round.nashReached = true;
      round.newRule = next.settings.ruleList[0];
      next.phase = "ESCALATION";
      next.activeRules = [round.newRule];
    }
  } else {
    const rule1InForce = round.rulesInForce.includes(1);
    const outcome = chooseEliminated({
      activeTokens: active,
      submitted: Object.keys(round.picks),
      winners: result.winners,
      disqualified: rule1InForce ? result.disqualified : [],
      exactDistance: result.exactDistance,
      seed: args.seed,
    });
    round.eliminationSeed = args.seed;
    round.eliminationCandidates = outcome.candidates;
    round.eliminated = outcome.eliminated;
    if (outcome.eliminated) {
      const loser = next.players[outcome.eliminated];
      loser.status = "ELIMINATED";
      loser.eliminatedInRound = round.round;
    }
    const upcoming = next.settings.ruleList.find((id) => !next.activeRules.includes(id));
    if (upcoming !== undefined) {
      round.newRule = upcoming;
      next.activeRules = [...next.activeRules, upcoming];
    }
  }

  next.state = "ROUND_REVEALED";
  return next;
}

/** True when the game has a winner: escalation with at most one active player. */
export function hasWinner(game: Game): boolean {
  return game.phase === "ESCALATION" && activePlayers(game).length <= 1;
}

/**
 * Host "next": after a reveal, either finish (a lone survivor remains) or open
 * the next round. FINISHED is entered here, not in revealRound, so the Portal can
 * still show the final elimination first.
 */
export function advance(game: Game, now: number): Game {
  if (game.state !== "ROUND_REVEALED") throw new GameError("INVALID_STATE");
  if (hasWinner(game)) return finishGame(game);
  return openRound(game, now);
}

/** Force the escalation phase (e.g. the normal rounds are used up without a Nash trigger). */
export function startEscalation(game: Game): Game {
  if (!game.settings.escalationEnabled || game.settings.ruleList.length === 0) {
    throw new GameError("ESCALATION_DISABLED");
  }
  if (game.state !== "ROUND_REVEALED") throw new GameError("INVALID_STATE");
  if (game.phase === "ESCALATION") return game;
  const next = clone(game);
  next.phase = "ESCALATION";
  next.activeRules = [next.settings.ruleList[0]];
  return next;
}

export function finishGame(game: Game): Game {
  if (game.state === "FINISHED") return game;
  const next = clone(game);
  next.state = "FINISHED";
  return next;
}

/** Back to the lobby: keep players, clear rounds, scores and eliminations. */
export function resetGame(game: Game): Game {
  const next = clone(game);
  next.state = "LOBBY";
  next.phase = "NORMAL";
  next.activeRules = [];
  next.currentRound = 0;
  next.rounds = [];
  next.roundOpenedAt = null;
  for (const p of Object.values(next.players)) {
    p.status = "ACTIVE";
    p.eliminatedInRound = null;
    p.score = 0;
  }
  return next;
}

export interface LeaderboardRow {
  token: string;
  name: string;
  score: number;
  status: Player["status"];
  eliminatedInRound: number | null;
  rank: number;
}

/**
 * Survivors first (score desc), then eliminated players, later elimination = better.
 * Players equal on every sort key share a rank.
 */
export function leaderboard(game: Game): LeaderboardRow[] {
  const key = (p: Player) => [p.status === "ACTIVE" ? 1 : 0, p.eliminatedInRound ?? 0, p.score];
  const sorted = Object.values(game.players).sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return a.name.localeCompare(b.name);
  });
  let rank = 0;
  return sorted.map((p, i) => {
    const same = i > 0 && key(sorted[i - 1]).every((v, j) => v === key(p)[j]);
    if (!same) rank = i + 1;
    return {
      token: p.token,
      name: p.name,
      score: p.score,
      status: p.status,
      eliminatedInRound: p.eliminatedInRound,
      rank,
    };
  });
}

import { randomUUID } from "crypto";
import type {
  Account,
  HostCommand,
  Participant,
  Round,
  RoundResult,
  RoundSettings,
  Team,
} from "@/contracts";

export type RunStatus = "LOBBY" | "ROUND_OPEN" | "ROUND_LOCKED" | "ROUND_REVEALED" | "FINISHED";
export type RunPhase = "NORMAL" | "ESCALATION";


export interface InternalRound extends Round {
  /** Server-only until the round has been revealed. Values are integer tenths. */
  picks: Record<string, number>;
  /** Server-only while open. Values are whole virtual points and are settled at reveal. */
  stakes: Record<string, number>;
  /** Rule 1 needs this audit field; it is intentionally not part of the public result. */
  disqualifiedUsernames: string[];
  /** State changed by REVEAL_ROUND; retained only so the Host can undo that reveal safely. */
  revealStateBefore: Pick<Run, "phase" | "escalationReason" | "activeRules"> | null;
}

export interface Run {
  id: string;
  number: number;
  status: RunStatus;
  phase: RunPhase;
  escalationReason: "NASH" | "HOST" | null;
  activeRules: Array<1 | 2>;
  participants: Record<string, Participant>;
  participationLocked: boolean;
  settingsForNextRound: RoundSettings;
  rounds: InternalRound[];
  createdAt: string;
  finishedAt: string | null;
  /** Distinguishes an automatic final reveal from an explicit Host finish. */
  finishedBy: "REVEAL" | "HOST" | null;
  archivedAt: string | null;
}

export interface PlayerSession {
  tokenHash: string;
  username: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface CommandReceipt {
  runId: string;
  response: CommandResult;
}

export interface PickReceipt {
  runId: string;
  response: PickResult;
}

export interface RoomArchive {
  runId: string;
  runNumber: number;
  endedAt: string;
  reason: "FINISH" | "RESET";
  expiresAt: string;
  archive: PublicArchive;
}

export interface Room {
  schemaVersion: 1;
  code: string;
  version: number;
  teams: Team[];
  /** Everyone who has joined this room by name, kept across runs so tokens survive RESET. */
  accounts: Account[];
  run: Run;
  sessions: Record<string, PlayerSession>;
  commandReceipts: Record<string, CommandReceipt>;
  pickReceipts: Record<string, Record<string, PickReceipt>>;
  archives: RoomArchive[];
  createdAt: string;
  updatedAt: string;
}

export interface CommandResult {
  version: number;
  status: RunStatus;
  runId: string;
}

export interface PickResult {
  acceptedVersion: number;
  pick: number;
  stake: number;
}

export interface PublicArchive {
  schemaVersion: 1;
  code: string;
  run: PublicRun;
  teams: Team[];
  individualLeaderboard: LeaderboardRow[];
  teamLeaderboard: TeamLeaderboardRow[];
}

export interface PublicRun {
  id: string;
  number: number;
  status: RunStatus;
  phase: RunPhase;
  escalationReason: "NASH" | "HOST" | null;
  activeRules: Array<1 | 2>;
  participants: Participant[];
  participationLocked: boolean;
  settingsForNextRound: RoundSettings;
  rounds: Array<Omit<InternalRound, "disqualifiedUsernames" | "revealStateBefore">>;
  createdAt: string;
  finishedAt: string | null;
}

export interface LeaderboardRow {
  username: string;
  rank: number;
  points: number;
}

export interface TeamLeaderboardRow {
  teamId: string;
  rank: number;
  points: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_ROUND_SETTINGS: RoundSettings = {
  roundMode: "STANDARD",
  p: "0.8",
  min: 0,
  max: 100,
  step: 1,
  timerSeconds: 60,
  winPoints: 10,
  losePoints: 0,
  startPoints: 100,
};

export class RoomError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = "RoomError";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function iso(now: number): string {
  return new Date(now).toISOString();
}

function currentRound(run: Run): InternalRound | null {
  return run.rounds.at(-1) ?? null;
}

function activeParticipants(run: Run): Participant[] {
  return Object.values(run.participants).filter((participant) => participant.status === "ACTIVE");
}

/** Before round 1 everyone sits at the configured starting points, so the lobby leaderboard already shows them. */
function syncStartPoints(run: Run): void {
  if (run.rounds.length > 0) return;
  const start = run.settingsForNextRound.startPoints ?? 0;
  for (const participant of Object.values(run.participants)) participant.totalPoints = start;
}

function activeUsernames(run: Run): string[] {
  return activeParticipants(run).map((participant) => participant.username);
}

function deadline(settings: RoundSettings, now: number): string | null {
  return settings.timerSeconds === null ? null : iso(now + settings.timerSeconds * 1000);
}

function factor(p: RoundSettings["p"]): readonly [bigint, bigint] {
  switch (p) {
    case "0.8": return [4n, 5n];
    case "2/3": return [2n, 3n];
    case "1/2": return [1n, 2n];
  }
}

function decimal(numerator: bigint, denominator: bigint, digits = 10): string {
  if (denominator === 0n) return "0";
  const negative = numerator < 0n !== denominator < 0n;
  let n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const whole = n / d;
  n %= d;
  if (n === 0n) return `${negative ? "-" : ""}${whole}`;
  let fraction = "";
  for (let index = 0; index < digits && n !== 0n; index += 1) {
    n *= 10n;
    fraction += (n / d).toString();
    n %= d;
  }
  fraction = fraction.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Picks are whole numbers 0-100; they are stored as integer tenths so scoring and archives stay exact. */
function exactTenths(value: number): number | null {
  if (!Number.isInteger(value) || value < 0 || value > 100) return null;
  return value * 10;
}

function rank<T extends { points: number }>(rows: T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort((left, right) => right.points - left.points);
  let lastPoints: number | undefined;
  let lastRank = 0;
  return sorted.map((row, index) => {
    if (row.points !== lastPoints) lastRank = index + 1;
    lastPoints = row.points;
    return { ...row, rank: lastRank };
  });
}

export function individualLeaderboard(run: Run): LeaderboardRow[] {
  return rank(Object.values(run.participants).map((participant) => ({ username: participant.username, points: participant.totalPoints })))
    .map(({ username, points, rank: position }) => ({ username, points, rank: position }));
}

export function teamLeaderboard(room: Pick<Room, "teams" | "run">): TeamLeaderboardRow[] {
  const points = new Map(room.teams.map((team) => [team.id, 0]));
  for (const participant of Object.values(room.run.participants)) {
    points.set(participant.teamId, (points.get(participant.teamId) ?? 0) + participant.totalPoints);
  }
  return rank([...points].map(([teamId, total]) => ({ teamId, points: total })))
    .map(({ teamId, points: total, rank: position }) => ({ teamId, points: total, rank: position }));
}

export function createRoom(args: { code: string; teams: Team[]; now: number }): Room {
  if (args.teams.length === 0) throw new RoomError("INVALID_ROSTER", "Roster must contain at least one team.");
  const teamIds = new Set(args.teams.map((team) => team.id.toLowerCase()));
  if (teamIds.size !== args.teams.length) throw new RoomError("INVALID_ROSTER", "Team IDs must be unique regardless of case.");
  const timestamp = iso(args.now);
  return {
    schemaVersion: 1,
    code: args.code,
    version: 0,
    teams: clone(args.teams),
    accounts: [],
    run: newRun(1, args.now),
    sessions: {},
    commandReceipts: {},
    pickReceipts: {},
    archives: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function newRun(number: number, now: number): Run {
  return {
    id: randomUUID(),
    number,
    status: "LOBBY",
    phase: "NORMAL",
    escalationReason: null,
    activeRules: [],
    participants: {},
    participationLocked: false,
    settingsForNextRound: clone(DEFAULT_ROUND_SETTINGS),
    rounds: [],
    createdAt: iso(now),
    finishedAt: null,
    finishedBy: null,
    archivedAt: null,
  };
}

export function purgeExpiredArchives(room: Room, now: number): Room {
  const current = iso(now);
  const expiredArchive = room.archives.some((archive) => archive.expiresAt <= current);
  const expiredSession = Object.values(room.sessions).some((session) => session.expiresAt <= current || session.revokedAt !== null);
  if (!expiredArchive && !expiredSession) return room;
  const next = clone(room);
  if (expiredArchive) next.archives = next.archives.filter((archive) => archive.expiresAt > current);
  if (expiredSession) {
    for (const [hash, session] of Object.entries(next.sessions)) {
      if (session.expiresAt <= current || session.revokedAt !== null) delete next.sessions[hash];
    }
  }
  return next;
}

/** The pick form starts at 50, so an active player who never pressed Save is counted at 50 (stored as tenths). */
export const DEFAULT_PICK_TENTHS = 500;

function fillDefaultPicks(run: Run, round: InternalRound): void {
  for (const participant of activeParticipants(run)) {
    round.picks[participant.username] ??= DEFAULT_PICK_TENTHS;
    (round.stakes ??= {})[participant.username] ??= 0;
  }
}

export function resolveDeadline(room: Room, now: number): Room {
  const round = currentRound(room.run);
  if (room.run.status !== "ROUND_OPEN" || !round?.deadlineAt || round.timerPaused || round.deadlineAt > iso(now)) return room;
  const next = clone(room);
  next.run.status = "ROUND_LOCKED";
  const nextRound = currentRound(next.run)!;
  nextRound.lockedAt = iso(now);
  fillDefaultPicks(next.run, nextRound);
  return next;
}

export function joinRun(room: Room, username: string, runId: string, now: number): { room: Room; joined: boolean } {
  if (room.run.id !== runId) throw new RoomError("RUN_MISMATCH");
  const existing = room.run.participants[username];
  if (existing) return { room, joined: false };
  if (room.run.status !== "LOBBY" || room.run.participationLocked) throw new RoomError("INVALID_TRANSITION", "Participation is locked for this run.");
  const account = room.accounts.find((candidate) => candidate.username === username);
  if (!account) throw new RoomError("FORBIDDEN");
  const next = clone(room);
  next.run.participants[username] = {
    username: account.username,
    displayName: account.displayName,
    teamId: account.teamId,
    joinedAt: iso(now),
    status: "ACTIVE",
    eliminatedInRound: null,
    totalPoints: 0,
  };
  syncStartPoints(next.run);
  return { room: next, joined: true };
}

export const MAX_PLAYER_NAME_LENGTH = 20;
export const MAX_ROOM_ACCOUNTS = 200;

/** Names are rendered as plain text; this only removes markup and normalizes spacing. */
export function normalizePlayerName(raw: string): string {
  return raw.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

/** Seeded team with the fewest accounts; ties go to the earlier team. */
function leastFilledTeam(room: Room): Team {
  const counts = new Map(room.teams.map((team) => [team.id, 0]));
  for (const account of room.accounts) counts.set(account.teamId, (counts.get(account.teamId) ?? 0) + 1);
  return room.teams.reduce((best, team) => counts.get(team.id)! < counts.get(best.id)! ? team : best);
}

/**
 * Kahoot-style entry: players type a nickname and the room code, nothing else;
 * the Host is the only signed-in role. Teams are assigned automatically. A name
 * is claimed for the whole room (all runs), so a stored token keeps working
 * after RESET and nobody can take over a participant by reusing their name.
 */
export function registerPlayer(room: Room, args: { name: string; now: number }): { room: Room; account: Account } {
  if (room.run.status !== "LOBBY" || room.run.participationLocked) throw new RoomError("INVALID_TRANSITION", "This game has already started.");
  const displayName = normalizePlayerName(args.name);
  if (displayName.length === 0 || displayName.length > MAX_PLAYER_NAME_LENGTH) {
    throw new RoomError("VALIDATION_ERROR", `Name must be 1 to ${MAX_PLAYER_NAME_LENGTH} characters.`);
  }
  const team = leastFilledTeam(room);
  const username = displayName.toLowerCase();
  if (room.accounts.some((account) => account.username === username)) throw new RoomError("NAME_TAKEN", "That name is already taken in this game.");
  if (room.accounts.length >= MAX_ROOM_ACCOUNTS) throw new RoomError("ROOM_FULL", "This game is full.");
  const account: Account = { username, displayName, teamId: team.id };
  const next = clone(room);
  next.accounts.push(account);
  return { room: joinRun(next, username, next.run.id, args.now).room, account };
}

function ensureVersion(room: Room, command: HostCommand): CommandResult | null {
  const receipt = room.commandReceipts[command.commandId];
  if (receipt) return receipt.response;
  if (command.expectedVersion !== room.version) throw new RoomError("VERSION_CONFLICT", "State changed; refresh and retry.");
  return null;
}

function score(round: InternalRound, run: Run): RoundResult {
  const entries = Object.entries(round.picks).filter(([username]) => run.participants[username]?.status === "ACTIVE");
  if (entries.length === 0) {
    round.disqualifiedUsernames = [];
    return {
      average: null, target: null, winners: [], eliminatedUsername: null, eliminationSeed: null,
      eliminationCandidates: [], pointEliminatedUsernames: [], pointsByUsername: {},
      basePointsByUsername: {}, wagerPointsByUsername: {}, payoutsByUsername: {}, wagerPot: 0, wagerRefunded: false,
    };
  }
  const sum = entries.reduce((total, [, value]) => total + value, 0);
  const numberOfPicks = BigInt(entries.length);
  const [factorNumerator, factorDenominator] = factor(round.settings.p);
  // Values are integer tenths. The target numerator uses those same units.
  const targetNumerator = factorNumerator * BigInt(sum);
  const targetDenominator = factorDenominator * numberOfPicks;
  const distances = new Map(entries.map(([username, value]) => [username, value < 0 ? 0n : (BigInt(value) * targetDenominator - targetNumerator < 0n ? -(BigInt(value) * targetDenominator - targetNumerator) : BigInt(value) * targetDenominator - targetNumerator)]));

  const duplicateGroups = new Map<number, string[]>();
  for (const [username, value] of entries) {
    const group = duplicateGroups.get(value) ?? [];
    group.push(username);
    duplicateGroups.set(value, group);
  }
  const ruleOne = run.activeRules.includes(1);
  const disqualified = ruleOne ? [...duplicateGroups.values()].filter((group) => group.length > 1).flat() : [];
  const disqualifiedSet = new Set(disqualified);
  const eligible = entries.filter(([username]) => !disqualifiedSet.has(username));

  let winners: string[] = [];
  const ruleTwo = run.activeRules.includes(2);
  const containsZero = entries.some(([, value]) => value === 0);
  const maxPickers = eligible.filter(([, value]) => value === 1000).map(([username]) => username);
  if (ruleTwo && containsZero && maxPickers.length === 1) {
    winners = maxPickers;
  } else if (eligible.length > 0) {
    let smallest: bigint | null = null;
    for (const [username] of eligible) {
      const distance = distances.get(username)!;
      if (smallest === null || distance < smallest) smallest = distance;
    }
    winners = eligible.filter(([username]) => distances.get(username) === smallest).map(([username]) => username);
  }
  round.disqualifiedUsernames = disqualified;
  // Snapshots saved before these settings existed lack them, hence the fallbacks.
  const winPoints = round.settings.winPoints ?? DEFAULT_ROUND_SETTINGS.winPoints;
  const losePoints = round.settings.losePoints ?? DEFAULT_ROUND_SETTINGS.losePoints;
  const winnerSet = new Set(winners);
  const stakes = round.stakes ?? {};
  const wagerRound = (round.settings.roundMode ?? "STANDARD") === "WAGER";
  const wagerPot = wagerRound
    ? activeParticipants(run).reduce((total, participant) => total + (stakes[participant.username] ?? 0), 0)
    : 0;
  const stakedWinners = winners.filter((username) => (stakes[username] ?? 0) > 0).sort();
  const payoutsByUsername: Record<string, number> = {};
  const wagerRefunded = wagerRound && wagerPot > 0 && stakedWinners.length === 0;

  if (wagerRefunded) {
    for (const participant of activeParticipants(run)) {
      const stake = stakes[participant.username] ?? 0;
      if (stake > 0) payoutsByUsername[participant.username] = stake;
    }
  } else if (wagerRound && wagerPot > 0 && stakedWinners.length > 0) {
    const winningStake = stakedWinners.reduce((total, username) => total + (stakes[username] ?? 0), 0);
    const shares = stakedWinners.map((username) => {
      const numerator = wagerPot * (stakes[username] ?? 0);
      const payout = Math.floor(numerator / winningStake);
      return { username, payout, remainder: numerator % winningStake };
    });
    let remaining = wagerPot - shares.reduce((total, share) => total + share.payout, 0);
    shares.sort((left, right) => right.remainder - left.remainder || left.username.localeCompare(right.username));
    for (const share of shares) {
      if (remaining > 0) { share.payout += 1; remaining -= 1; }
      payoutsByUsername[share.username] = share.payout;
    }
  }

  const pointsByUsername: Record<string, number> = {};
  const basePointsByUsername: Record<string, number> = {};
  const wagerPointsByUsername: Record<string, number> = {};
  for (const participant of activeParticipants(run)) {
    const stake = wagerRound ? (stakes[participant.username] ?? 0) : 0;
    const payout = payoutsByUsername[participant.username] ?? 0;
    const total = participant.totalPoints;
    const afterWager = total - stake + payout;
    const rawBase = winnerSet.has(participant.username) ? winPoints : winners.length > 0 ? -losePoints : 0;
    // Stake was validated against the pre-round balance. Apply base scoring
    // after the conserved pot settlement, with the existing zero floor.
    const next = Math.max(0, afterWager + rawBase);
    const wagerDelta = afterWager - total;
    const baseDelta = next - afterWager;
    if (wagerDelta !== 0) wagerPointsByUsername[participant.username] = wagerDelta;
    if (baseDelta !== 0) basePointsByUsername[participant.username] = baseDelta;
    if (next !== total) pointsByUsername[participant.username] = next - total;
  }
  return {
    average: decimal(BigInt(sum), numberOfPicks * 10n),
    target: decimal(targetNumerator, targetDenominator * 10n),
    winners,
    eliminatedUsername: null,
    eliminationSeed: null,
    eliminationCandidates: [],
    pointEliminatedUsernames: [],
    pointsByUsername,
    basePointsByUsername,
    wagerPointsByUsername,
    payoutsByUsername,
    wagerPot,
    wagerRefunded,
  };
}

function seededIndex(seed: string, count: number): number {
  // FNV-1a is deterministic and is only used after the cryptographically random
  // seed has been persisted. It is not used to generate the seed itself.
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % count;
}

function eliminate(room: Room, round: InternalRound, seed: string): void {
  const run = room.run;
  const result = round.result!;
  const winners = new Set(result.winners);
  const active = activeUsernames(run);
  const submitted = new Set(Object.keys(round.picks));
  const disqualified = new Set(round.disqualifiedUsernames);
  const groups = [
    active.filter((username) => !submitted.has(username) && !winners.has(username)),
    active.filter((username) => submitted.has(username) && disqualified.has(username) && !winners.has(username)),
    active.filter((username) => submitted.has(username) && !disqualified.has(username) && !winners.has(username)),
  ];
  const candidates = groups.find((group) => group.length > 0) ?? [];
  if (candidates.length === 0) return;
  // Exact distance is only needed to choose among submitters. Recreate it from
  // the immutable round settings/picks without using floating point values.
  const submittedEntries = Object.entries(round.picks).filter(([username]) => run.participants[username]?.status === "ACTIVE");
  let finalists = candidates;
  if (submittedEntries.length > 0 && candidates.every((username) => submitted.has(username))) {
    const sum = submittedEntries.reduce((total, [, value]) => total + value, 0);
    const [numerator, denominator] = factor(round.settings.p);
    const targetNumerator = numerator * BigInt(sum);
    const targetDenominator = denominator * BigInt(submittedEntries.length);
    const distances = new Map(submittedEntries.map(([username, value]) => {
      const distance = BigInt(value) * targetDenominator - targetNumerator;
      return [username, distance < 0n ? -distance : distance];
    }));
    let largest = -1n;
    for (const username of candidates) {
      const distance = distances.get(username) ?? 0n;
      if (distance > largest) largest = distance;
    }
    finalists = candidates.filter((username) => (distances.get(username) ?? 0n) === largest);
  }
  finalists.sort();
  const eliminated = finalists[seededIndex(seed, finalists.length)];
  result.eliminationSeed = seed;
  result.eliminationCandidates = finalists;
  result.eliminatedUsername = eliminated;
  run.participants[eliminated].status = "ELIMINATED";
  run.participants[eliminated].eliminatedInRound = round.number;
}

/** Undo the effects of the current revealed round before allowing the Host to reveal it again. */
function cancelRoundResult(run: Run): void {
  const round = currentRound(run)!;
  const result = round.result!;
  for (const [username, points] of Object.entries(result.pointsByUsername)) {
    run.participants[username].totalPoints -= points;
  }
  for (const username of [...result.pointEliminatedUsernames, result.eliminatedUsername].filter((value): value is string => value !== null)) {
    const participant = run.participants[username];
    participant.status = "ACTIVE";
    participant.eliminatedInRound = null;
  }
  // The state snapshot prevents an undo of a later escalation round from
  // accidentally erasing the Nash transition that happened in an earlier one.
  if (round.revealStateBefore) {
    run.phase = round.revealStateBefore.phase;
    run.escalationReason = round.revealStateBefore.escalationReason;
    run.activeRules = clone(round.revealStateBefore.activeRules);
  }
  round.result = null;
  round.revealedAt = null;
  round.disqualifiedUsernames = [];
  round.revealStateBefore = null;
  run.status = "ROUND_LOCKED";
}

function archive(room: Room, reason: "FINISH" | "RESET", now: number): void {
  if (room.run.archivedAt !== null || room.run.rounds.length === 0) return;
  const timestamp = iso(now);
  room.run.archivedAt = timestamp;
  room.archives.push({
    runId: room.run.id,
    runNumber: room.run.number,
    endedAt: timestamp,
    reason,
    expiresAt: iso(now + 7 * DAY_MS),
    archive: publicArchive(room),
  });
}

export function applyCommand(room: Room, command: HostCommand, now: number, seed: string): { room: Room; result: CommandResult; changed: boolean } {
  const existing = ensureVersion(room, command);
  if (existing) return { room, result: existing, changed: false };
  const next = resolveDeadline(clone(room), now);
  let changed = next !== room;
  const run = next.run;
  switch (command.type) {
    case "OPEN_ROUND": {
      if (run.status !== "LOBBY" && run.status !== "ROUND_REVEALED") throw new RoomError("INVALID_TRANSITION");
      if (activeParticipants(run).length < 2) throw new RoomError("INVALID_TRANSITION", "At least two participants are required.");
      run.participationLocked = true;
      syncStartPoints(run);
      // Pick receipts only make retries of the open round idempotent. Dropping
      // earlier rounds' receipts keeps the persisted snapshot from growing all game.
      next.pickReceipts = {};
      const settings = clone(run.settingsForNextRound);
      const openedAt = iso(now);
      run.rounds.push({ number: run.rounds.length + 1, settings, openedAt, deadlineAt: deadline(settings, now), timerPaused: false, pausedRemainingMs: null, lockedAt: null, revealedAt: null, result: null, picks: {}, stakes: {}, disqualifiedUsernames: [], revealStateBefore: null });
      run.status = "ROUND_OPEN";
      changed = true;
      break;
    }
    case "LOCK_ROUND": {
      if (run.status !== "ROUND_OPEN") throw new RoomError("INVALID_TRANSITION");
      run.status = "ROUND_LOCKED";
      currentRound(run)!.lockedAt = iso(now);
      fillDefaultPicks(run, currentRound(run)!);
      changed = true;
      break;
    }
    case "PAUSE_TIMER": {
      if (run.status !== "ROUND_OPEN") throw new RoomError("INVALID_TRANSITION");
      const round = currentRound(run)!;
      if (!round.deadlineAt || round.timerPaused) throw new RoomError("INVALID_TRANSITION", "The round timer cannot be paused.");
      round.pausedRemainingMs = Math.max(0, Date.parse(round.deadlineAt) - now);
      round.timerPaused = true;
      changed = true;
      break;
    }
    case "RESUME_TIMER": {
      if (run.status !== "ROUND_OPEN") throw new RoomError("INVALID_TRANSITION");
      const round = currentRound(run)!;
      if (!round.deadlineAt || !round.timerPaused || round.pausedRemainingMs === null) throw new RoomError("INVALID_TRANSITION", "The round timer cannot be resumed.");
      round.deadlineAt = iso(now + round.pausedRemainingMs);
      round.timerPaused = false;
      round.pausedRemainingMs = null;
      changed = true;
      break;
    }
    case "RESET_TIMER": {
      if (run.status !== "ROUND_OPEN") throw new RoomError("INVALID_TRANSITION");
      const round = currentRound(run)!;
      if (round.settings.timerSeconds === null) throw new RoomError("INVALID_TRANSITION", "This round has no timer to reset.");
      round.deadlineAt = deadline(round.settings, now);
      round.timerPaused = false;
      round.pausedRemainingMs = null;
      changed = true;
      break;
    }
    case "REVEAL_ROUND": {
      if (run.status !== "ROUND_LOCKED") throw new RoomError("INVALID_TRANSITION");
      const round = currentRound(run)!;
      round.revealStateBefore = { phase: run.phase, escalationReason: run.escalationReason, activeRules: clone(run.activeRules) };
      round.result = score(round, run);
      for (const [username, points] of Object.entries(round.result.pointsByUsername)) run.participants[username].totalPoints += points;
      if (run.phase === "NORMAL") {
        const active = activeUsernames(run);
        if (active.length >= 2 && active.every((username) => round.picks[username] === 0)) {
          run.phase = "ESCALATION";
          run.escalationReason = "NASH";
          run.activeRules = [1];
        }
      } else {
        eliminate(next, round, seed);
        if (round.result.eliminatedUsername && !run.activeRules.includes(2)) run.activeRules.push(2);
      }
      round.revealedAt = iso(now);
      // Points elimination runs in both phases: anyone whose total hit 0 is out (rooms saved before this setting have it off).
      if ((round.settings.startPoints ?? 0) > 0) {
        for (const participant of activeParticipants(run)) {
          if (participant.totalPoints > 0) continue;
          participant.status = "ELIMINATED";
          participant.eliminatedInRound = round.number;
          round.result.pointEliminatedUsernames.push(participant.username);
        }
      }
      if (activeParticipants(run).length <= 1) {
        run.status = "FINISHED";
        run.finishedAt = iso(now);
        run.finishedBy = "REVEAL";
        archive(next, "FINISH", now);
      }
      if (run.status !== "FINISHED") run.status = "ROUND_REVEALED";
      changed = true;
      break;
    }
    case "CANCEL_ROUND_RESULT": {
      const canCancelFinishedResult = run.status === "FINISHED" && run.finishedBy === "REVEAL";
      if ((run.status !== "ROUND_REVEALED" && !canCancelFinishedResult) || !currentRound(run)?.result) throw new RoomError("INVALID_TRANSITION");
      const round = currentRound(run)!;
      if (run.escalationReason === "HOST" && round.revealStateBefore?.escalationReason !== "HOST") {
        throw new RoomError("INVALID_TRANSITION", "The result cannot be cancelled after escalation has started.");
      }
      cancelRoundResult(run);
      if (canCancelFinishedResult) {
        run.finishedAt = null;
        run.finishedBy = null;
        run.archivedAt = null;
        next.archives = next.archives.filter((archive) => archive.runId !== run.id);
      }
      changed = true;
      break;
    }
    case "START_ESCALATION": {
      if (run.status !== "ROUND_REVEALED" || run.phase !== "NORMAL") throw new RoomError("INVALID_TRANSITION");
      run.phase = "ESCALATION";
      run.escalationReason = "HOST";
      run.activeRules = [1];
      changed = true;
      break;
    }
    case "UPDATE_SETTINGS": {
      if (run.status !== "LOBBY" && run.status !== "ROUND_REVEALED") throw new RoomError("INVALID_TRANSITION");
      run.settingsForNextRound = { ...run.settingsForNextRound, ...command.payload };
      syncStartPoints(run);
      changed = true;
      break;
    }
    case "FINISH": {
      if (run.status === "FINISHED") throw new RoomError("INVALID_TRANSITION");
      run.status = "FINISHED";
      run.finishedAt = iso(now);
      run.finishedBy = "HOST";
      archive(next, "FINISH", now);
      changed = true;
      break;
    }
    case "RESET": {
      archive(next, "RESET", now);
      next.run = newRun(run.number + 1, now);
      // Receipts from the finished run can no longer apply; this command's own
      // receipt is recorded below so a retried RESET stays idempotent.
      next.commandReceipts = {};
      next.pickReceipts = {};
      changed = true;
      break;
    }
  }
  if (changed) {
    next.version += 1;
    next.updatedAt = iso(now);
  }
  const result = { version: next.version, status: next.run.status, runId: next.run.id };
  next.commandReceipts[command.commandId] = { runId: next.run.id, response: result };
  return { room: next, result, changed };
}

export function submitPick(room: Room, args: { username: string; runId: string; round: number; value: number; stake?: number; requestId: string; now: number }): { room: Room; result: PickResult; changed: boolean } {
  const duplicate = room.pickReceipts[args.username]?.[args.requestId];
  if (duplicate) {
    if (duplicate.runId !== args.runId) throw new RoomError("RUN_MISMATCH", "This request id belongs to an earlier run.");
    // Receipts persisted before wager rounds did not include a stake.
    return { room, result: { ...duplicate.response, stake: duplicate.response.stake ?? 0 }, changed: false };
  }
  const next = resolveDeadline(clone(room), args.now);
  if (next.run.id !== args.runId) throw new RoomError("RUN_MISMATCH");
  if (next.run.status !== "ROUND_OPEN") throw new RoomError("INVALID_TRANSITION", "This round is not open.");
  const round = currentRound(next.run);
  const participant = next.run.participants[args.username];
  if (!round || round.number !== args.round) throw new RoomError("RUN_MISMATCH", "This is not the current round.");
  if (!participant || participant.status !== "ACTIVE") throw new RoomError("FORBIDDEN", "Only active participants may submit a pick.");
  const valueTenths = exactTenths(args.value);
  if (valueTenths === null) throw new RoomError("VALIDATION_ERROR", "Pick must be a whole number from 0 to 100.");
  const stake = args.stake ?? 0;
  if (!Number.isInteger(stake) || stake < 0) throw new RoomError("VALIDATION_ERROR", "Stake must be a non-negative whole number.");
  const wagerRound = (round.settings.roundMode ?? "STANDARD") === "WAGER";
  if (!wagerRound && stake !== 0) throw new RoomError("VALIDATION_ERROR", "A stake is only allowed in a wager round.");
  if (stake > participant.totalPoints) throw new RoomError("VALIDATION_ERROR", "Stake cannot exceed your current points.");
  round.picks[args.username] = valueTenths;
  (round.stakes ??= {})[args.username] = wagerRound ? stake : 0;
  next.version += 1;
  next.updatedAt = iso(args.now);
  const result = { acceptedVersion: next.version, pick: valueTenths, stake: wagerRound ? stake : 0 };
  (next.pickReceipts[args.username] ??= {})[args.requestId] = { runId: args.runId, response: result };
  return { room: next, result, changed: true };
}

export function publicArchive(room: Room, options: { hideOpenRoundPicks?: boolean } = {}): PublicArchive {
  const run = room.run;
  // The Host may only see other players' picks once a round is locked. A live
  // export taken while a round is open must not reveal its picks early.
  const hiddenRound = options.hideOpenRoundPicks && run.status === "ROUND_OPEN" ? currentRound(run)?.number : undefined;
  return {
    schemaVersion: 1,
    code: room.code,
    run: {
      id: run.id,
      number: run.number,
      status: run.status,
      phase: run.phase,
      escalationReason: run.escalationReason,
      activeRules: clone(run.activeRules),
      participants: Object.values(run.participants).map(clone),
      participationLocked: run.participationLocked,
      settingsForNextRound: clone(run.settingsForNextRound),
      rounds: run.rounds.map(({ disqualifiedUsernames, revealStateBefore, ...round }) => {
        void disqualifiedUsernames;
        void revealStateBefore;
        const exported = { ...clone(round), stakes: clone(round.stakes ?? {}) };
        return round.number === hiddenRound ? { ...exported, picks: {}, stakes: {} } : exported;
      }),
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
    },
    teams: clone(room.teams),
    individualLeaderboard: individualLeaderboard(run),
    teamLeaderboard: teamLeaderboard(room),
  };
}

export function csvForArchive(archive: PublicArchive): string {
  const escape = (value: string | number | boolean | null | undefined): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const rows = [["runId", "round", "roundMode", "username", "displayName", "teamId", "pick", "distance", "stake", "payout", "wagerPoints", "basePoints", "points", "winner", "eliminated"]];
  for (const round of archive.run.rounds.filter((candidate) => candidate.result !== null)) {
    const result = round.result!;
    const submitted = Object.values(round.picks);
    const sum = submitted.reduce((total, value) => total + value, 0);
    const [factorNumerator, factorDenominator] = factor(round.settings.p);
    const targetNumerator = factorNumerator * BigInt(sum);
    const targetDenominator = factorDenominator * BigInt(submitted.length || 1);
    for (const participant of archive.run.participants) {
      const pick = round.picks[participant.username];
      const rawDistance = pick === undefined || result.target === null ? null : BigInt(pick) * targetDenominator - targetNumerator;
      const distance = rawDistance === null ? null : decimal(rawDistance < 0n ? -rawDistance : rawDistance, targetDenominator * 10n);
      rows.push([
        archive.run.id,
        String(round.number),
        round.settings.roundMode ?? "STANDARD",
        participant.username,
        participant.displayName,
        participant.teamId,
        pick === undefined ? "" : String(pick / 10),
        distance ?? "",
        String(round.stakes?.[participant.username] ?? 0),
        String(result.payoutsByUsername?.[participant.username] ?? 0),
        String(result.wagerPointsByUsername?.[participant.username] ?? 0),
        String(result.basePointsByUsername?.[participant.username] ?? result.pointsByUsername[participant.username] ?? 0),
        String(result.pointsByUsername[participant.username] ?? 0),
        String(result.winners.includes(participant.username)),
        String(result.eliminatedUsername === participant.username),
      ]);
    }
  }
  return rows.map((row) => row.map(escape).join(",")).join("\r\n");
}

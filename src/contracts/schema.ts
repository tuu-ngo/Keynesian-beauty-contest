import { z } from "zod";

/** The versioned boundary shared by route handlers and the server model. */
export const SCHEMA_VERSION = 1 as const;

export const phaseSchema = z.enum(["NORMAL", "ESCALATION"]);
export const statusSchema = z.enum(["LOBBY", "ROUND_OPEN", "ROUND_LOCKED", "ROUND_REVEALED", "FINISHED"]);
export const participantStatusSchema = z.enum(["ACTIVE", "ELIMINATED"]);
export const pSchema = z.enum(["0.8", "2/3", "1/2"]);
export const roundModeSchema = z.enum(["STANDARD", "WAGER", "HOST_TARGET"]);
export const ruleIdSchema = z.union([z.literal(1), z.literal(2)]);
export const roomCodeSchema = z.string().regex(/^[A-Z]{4}$/, "Code must contain four uppercase letters.");
export const uuidSchema = z.string().uuid();

export const teamSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  image: z.string().regex(/^\/teams\//).optional(),
  color: z.string().max(64).optional(),
}).strict();

export const accountSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  displayName: z.string().trim().min(1).max(64),
  teamId: z.string().trim().min(1).max(64),
}).strict();

export const participantSchema = accountSchema.extend({
  joinedAt: z.string().datetime(),
  status: participantStatusSchema,
  eliminatedInRound: z.number().int().positive().nullable(),
  totalPoints: z.number().int().nonnegative(),
}).strict();

export const roundSettingsSchema = z.object({
  /** STANDARD keeps the original scoring; WAGER adds a fixed-odds virtual-points stake. */
  roundMode: roundModeSchema.default("STANDARD"),
  p: pSchema,
  min: z.literal(0),
  max: z.literal(100),
  /** Picks are whole numbers now (step 1); 0.1 is kept so rooms and archives saved earlier still parse. */
  step: z.union([z.literal(1), z.literal(0.1)]),
  timerSeconds: z.number().int().min(5).max(60 * 60).nullable(),
  /** Points a winner earns, points every non-winner loses (only in rounds that have a winner). */
  winPoints: z.number().int().min(0).max(1000).default(10),
  losePoints: z.number().int().min(0).max(1000).default(0),
  /** Points every player starts the run with; a player whose total reaches 0 is eliminated. 0 turns this off. */
  startPoints: z.number().int().min(0).max(100000).default(100),
}).strict();

export const timerOptionSchema = z.union([z.literal(60), z.literal(90), z.literal(120)]).nullable();

export const roundResultSchema = z.object({
  average: z.string().nullable(),
  target: z.string().nullable(),
  winners: z.array(z.string()),
  eliminatedUsername: z.string().nullable(),
  eliminationSeed: z.string().nullable(),
  eliminationCandidates: z.array(z.string()),
  /** Players eliminated this round because their points reached 0. */
  pointEliminatedUsernames: z.array(z.string()).default([]),
  /** Signed points actually applied this round (after the zero floor). */
  pointsByUsername: z.record(z.number().int()),
  /** The basic win/loss component actually applied after wager settlement. */
  basePointsByUsername: z.record(z.number().int()).default({}),
  /** Signed wager component: +stake for winners and -stake for non-winners. */
  wagerPointsByUsername: z.record(z.number().int()).default({}),
  payoutsByUsername: z.record(z.number().int().nonnegative()).default({}),
  wagerPot: z.number().int().nonnegative().default(0),
  wagerRefunded: z.boolean().default(false),
}).strict();

export const roundSchema = z.object({
  number: z.number().int().positive(),
  settings: roundSettingsSchema,
  openedAt: z.string().datetime(),
  deadlineAt: z.string().datetime().nullable(),
  /** A paused timer keeps its precise remaining time until the Host resumes or resets it. */
  timerPaused: z.boolean().default(false),
  pausedRemainingMs: z.number().int().nonnegative().nullable().default(null),
  lockedAt: z.string().datetime().nullable(),
  revealedAt: z.string().datetime().nullable(),
  result: roundResultSchema.nullable(),
}).strict();

export const publicPlayerSchema = z.object({
  username: z.string(),
  displayName: z.string(),
  teamId: z.string(),
  hasSubmitted: z.boolean(),
  status: participantStatusSchema,
  eliminatedInRound: z.number().int().positive().nullable(),
  totalPoints: z.number().int().nonnegative(),
  finalPlacement: z.number().int().positive().nullable(),
}).strict();

export const revealedRoundSchema = z.object({
  number: z.number().int().positive(),
  settings: roundSettingsSchema,
  average: z.string().nullable(),
  target: z.string().nullable(),
  picks: z.array(z.object({ valueTenths: z.number().int().min(0).max(1000) }).strict()),
  winners: z.array(z.object({ username: z.string(), valueTenths: z.number().int().min(0).max(1000), points: z.number().int().nonnegative() }).strict()),
  eliminatedUsername: z.string().nullable(),
  pointsByUsername: z.record(z.number().int()).default({}),
  basePointsByUsername: z.record(z.number().int()).default({}),
  wagerPointsByUsername: z.record(z.number().int()).default({}),
  stakesByUsername: z.record(z.number().int().nonnegative()).default({}),
  payoutsByUsername: z.record(z.number().int().nonnegative()).default({}),
  wagerPot: z.number().int().nonnegative().default(0),
  wagerRefunded: z.boolean().default(false),
  pointEliminatedUsernames: z.array(z.string()).default([]),
}).strict();

export const leaderboardRowSchema = z.object({
  username: z.string(),
  rank: z.number().int().positive(),
  points: z.number().int().nonnegative(),
}).strict();

export const teamLeaderboardRowSchema = z.object({
  teamId: z.string(),
  rank: z.number().int().positive(),
  points: z.number().int().nonnegative(),
}).strict();

export const publicProjectionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  view: z.literal("public"),
  code: roomCodeSchema,
  runId: uuidSchema,
  runNumber: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  serverNow: z.string().datetime(),
  status: statusSchema,
  phase: phaseSchema,
  escalationReason: z.enum(["NASH", "HOST"]).nullable(),
  activeRules: z.array(ruleIdSchema),
  teams: z.array(teamSchema),
  players: z.array(publicPlayerSchema),
  currentRound: z.object({
    number: z.number().int().positive(),
    settings: roundSettingsSchema,
    deadlineAt: z.string().datetime().nullable(),
    timerPaused: z.boolean(),
    pausedRemainingMs: z.number().int().nonnegative().nullable(),
  }).strict().nullable(),
  nextRoundSettings: roundSettingsSchema,
  submittedCount: z.number().int().nonnegative(),
  activeCount: z.number().int().nonnegative(),
  revealedRounds: z.array(revealedRoundSchema),
  individualLeaderboard: z.array(leaderboardRowSchema),
  teamLeaderboard: z.array(teamLeaderboardRowSchema),
}).strict();

export const playerProjectionSchema = publicProjectionSchema.extend({
  view: z.literal("player"),
  self: z.object({
    username: z.string(),
    currentPickTenths: z.number().int().min(0).max(1000).nullable(),
    currentStakePoints: z.number().int().nonnegative(),
    totalPoints: z.number().int().nonnegative(),
    status: participantStatusSchema,
    eliminatedInRound: z.number().int().positive().nullable(),
  }).strict(),
}).strict();

export const hostProjectionSchema = publicProjectionSchema.extend({
  view: z.literal("host"),
  canCancelRoundResult: z.boolean(),
  /** Secret target values are available only in the authenticated Host projection. */
  nextHostTarget: z.number().int().min(0).max(100).nullable(),
  currentHostTarget: z.number().int().min(0).max(100).nullable(),
  hostPicks: z.array(z.object({ username: z.string(), valueTenths: z.number().int().min(0).max(1000), stakePoints: z.number().int().nonnegative() }).strict()).nullable(),
}).strict();

export const stateResponseSchema = z.discriminatedUnion("view", [publicProjectionSchema, playerProjectionSchema, hostProjectionSchema]);

export const hostCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("OPEN_ROUND"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("LOCK_ROUND"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("PAUSE_TIMER"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("RESUME_TIMER"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("RESET_TIMER"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("REVEAL_ROUND"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("CANCEL_ROUND_RESULT"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("START_ESCALATION"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("FINISH"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("RESET"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative() }).strict(),
  z.object({
    type: z.literal("UPDATE_SETTINGS"), commandId: uuidSchema, expectedVersion: z.number().int().nonnegative(),
    payload: z.object({
      p: pSchema.optional(),
      roundMode: roundModeSchema.optional(),
      hostTarget: z.number().int().min(0).max(100).optional(),
      timerSeconds: timerOptionSchema.optional(),
      winPoints: z.number().int().min(0).max(1000).optional(),
      losePoints: z.number().int().min(0).max(1000).optional(),
      startPoints: z.number().int().min(0).max(100000).optional(),
      /** Rules the Host ticks for the rest of the run, from the next round. Escalation turns both on. */
      activeRules: z.array(ruleIdSchema).max(2).optional(),
    }).strict(),
  }).strict(),
]);

/** Players join by name; the server normalizes it and enforces the final length. */
export const playerJoinByNameSchema = z.object({
  code: roomCodeSchema,
  name: z.string().min(1).max(200),
}).strict();

export const joinSchema = z.object({ runId: uuidSchema }).strict();
export const pickSchema = z.object({
  runId: uuidSchema,
  round: z.number().int().positive(),
  value: z.number().finite().min(0).max(100),
  /** Atomic with value so a saved number and its virtual-points stake cannot diverge. */
  stake: z.number().int().nonnegative().default(0),
  requestId: uuidSchema,
}).strict();

export type Team = z.infer<typeof teamSchema>;
export type Account = z.infer<typeof accountSchema>;
export type Participant = z.infer<typeof participantSchema>;
export type RoundSettings = z.infer<typeof roundSettingsSchema>;
export type RoundResult = z.infer<typeof roundResultSchema>;
export type Round = z.infer<typeof roundSchema>;
export type RevealedRound = z.infer<typeof revealedRoundSchema>;
export type HostCommand = z.infer<typeof hostCommandSchema>;
export type StateResponse = z.infer<typeof stateResponseSchema>;
export type PublicProjection = Extract<StateResponse, { view: "public" }>;
export type PlayerProjection = Extract<StateResponse, { view: "player" }>;
export type HostProjection = Extract<StateResponse, { view: "host" }>;

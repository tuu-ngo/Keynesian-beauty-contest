import type { GameSettings } from "./types";

/** True when at least 2 active players all submitted exactly the range minimum. */
export function isNashReached(
  activeTokens: string[],
  picks: Record<string, number>,
  settings: GameSettings,
): boolean {
  if (!settings.escalationEnabled || settings.ruleList.length === 0) return false;
  if (activeTokens.length < 2) return false;
  return activeTokens.every((t) => picks[t] !== undefined && picks[t] === settings.min);
}

export interface EliminationInput {
  activeTokens: string[];
  /** Tokens that submitted a pick this round. */
  submitted: string[];
  winners: string[];
  /** Rule 1 duplicates, only passed when Rule 1 is in force. */
  disqualified: string[];
  exactDistance: Record<string, number>;
  seed: string;
}

export interface EliminationResult {
  eliminated: string | null;
  candidates: string[];
}

/**
 * Pick exactly one player to eliminate; never a winner. Tiers, worst first:
 * 1) did not submit, 2) lost through Rule 1 duplicates, 3) other non-winners.
 * Within a tier the largest distance goes; remaining ties are broken by a seeded draw.
 */
export function chooseEliminated(input: EliminationInput): EliminationResult {
  const winners = new Set(input.winners);
  const submitted = new Set(input.submitted);
  const dup = new Set(input.disqualified);

  const nonSubmitters = input.activeTokens.filter((t) => !submitted.has(t) && !winners.has(t));
  const duplicates = input.activeTokens.filter((t) => submitted.has(t) && dup.has(t) && !winners.has(t));
  const others = input.activeTokens.filter((t) => submitted.has(t) && !dup.has(t) && !winners.has(t));

  const tier = [nonSubmitters, duplicates, others].find((g) => g.length > 0);
  if (!tier) return { eliminated: null, candidates: [] };

  const farthest = Math.max(...tier.map((t) => input.exactDistance[t] ?? 0));
  const candidates = tier.filter((t) => (input.exactDistance[t] ?? 0) === farthest).sort();
  if (candidates.length === 1) return { eliminated: candidates[0], candidates };

  const rng = seededRandom(input.seed);
  return { eliminated: candidates[Math.floor(rng() * candidates.length)], candidates };
}

/** Deterministic PRNG from a string seed (xmur3 hash feeding mulberry32). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

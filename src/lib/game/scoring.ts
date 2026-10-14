import { fromUnits, toFraction, toUnits } from "./numeric";
import { rulesInPrecedenceOrder } from "./rules";
import type { GameSettings } from "./types";

export interface PickEntry {
  token: string;
  /** Pick as an integer number of `settings.step` units. */
  units: number;
}

export interface RoundComputation {
  average: number | null;
  target: number | null;
  winners: string[];
  disqualified: string[];
  overrideRule: number | null;
  /**
   * Exact, mutually comparable distances to the target (all share one denominator).
   * Compare these, never the float distances.
   */
  exactDistance: Record<string, number>;
  points: Record<string, number>;
}

/** Close-call bonus applies to non-winners within this many value units of the target. */
export const CLOSE_CALL_DISTANCE = 2;

export function toPickEntries(picks: Record<string, number>, step: number): PickEntry[] {
  return Object.entries(picks).map(([token, value]) => {
    const units = toUnits(value, step);
    if (units === null) throw new Error(`Pick ${value} is not a multiple of step ${step}`);
    return { token, units };
  });
}

/**
 * Score one round. Precedence: Rule 2 override -> Rule 1 filtering -> closest to target.
 * The average always includes every submitted pick, before any rule filtering.
 */
export function computeRound(
  entries: PickEntry[],
  settings: GameSettings,
  activeRules: number[],
): RoundComputation {
  const empty: RoundComputation = {
    average: null,
    target: null,
    winners: [],
    disqualified: [],
    overrideRule: null,
    exactDistance: {},
    points: {},
  };
  if (entries.length === 0) return empty;

  const n = entries.length;
  const sum = entries.reduce((acc, e) => acc + e.units, 0);
  const { num: pn, den: pd } = toFraction(settings.p);
  const { step } = settings;

  // distance_i = |u_i - p*sum/n| in units  ==  |u_i*n*pd - pn*sum| / (n*pd)
  const denominator = n * pd;
  const exactDistance: Record<string, number> = {};
  for (const e of entries) exactDistance[e.token] = Math.abs(e.units * denominator - pn * sum);

  const average = fromUnits(sum, step) / n;
  const target = settings.p * average;

  const rules = rulesInPrecedenceOrder(activeRules);
  const disqualified = new Set<string>();
  for (const rule of rules) for (const token of rule.disqualify?.(entries) ?? []) disqualified.add(token);

  const minUnits = toUnits(settings.min, step) ?? 0;
  const maxUnits = toUnits(settings.max, step) ?? 0;

  let winners: string[] = [];
  let overrideRule: number | null = null;
  for (const rule of rules) {
    const forced = rule.override?.({ entries, minUnits, maxUnits, disqualified }) ?? [];
    if (forced.length > 0) {
      winners = forced;
      overrideRule = rule.id;
      break;
    }
  }

  if (overrideRule === null) {
    const eligible = entries.filter((e) => !disqualified.has(e.token));
    if (eligible.length > 0) {
      const best = Math.min(...eligible.map((e) => exactDistance[e.token]));
      winners = eligible.filter((e) => exactDistance[e.token] === best).map((e) => e.token);
    }
  }

  const points: Record<string, number> = {};
  const winnerSet = new Set(winners);
  for (const token of winners) points[token] = settings.pointsForWin;
  if (overrideRule === null && settings.closeCallBonus > 0) {
    const closeLimit = (CLOSE_CALL_DISTANCE / step) * denominator;
    for (const e of entries) {
      if (winnerSet.has(e.token) || disqualified.has(e.token)) continue;
      if (exactDistance[e.token] <= closeLimit) points[e.token] = settings.closeCallBonus;
    }
  }

  return {
    average,
    target,
    winners,
    disqualified: [...disqualified],
    overrideRule,
    exactDistance,
    points,
  };
}

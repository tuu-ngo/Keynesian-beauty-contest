import type { PickEntry } from "./scoring";

export interface RuleContext {
  entries: PickEntry[];
  minUnits: number;
  maxUnits: number;
  /** Tokens already disqualified by the active `disqualify` rules. */
  disqualified: Set<string>;
}

export interface Rule {
  id: number;
  /** Higher precedence is applied first (Rule 2 -> Rule 1 -> base). */
  precedence: number;
  /** Tokens that automatically lose the round. */
  disqualify?(entries: PickEntry[]): string[];
  /** Tokens that win the round outright; an empty array means "no override". */
  override?(ctx: RuleContext): string[];
}

/** Rule 1: any value picked by 2+ players makes all of those players lose the round. */
const noDuplicates: Rule = {
  id: 1,
  precedence: 1,
  disqualify(entries) {
    const byValue = new Map<number, string[]>();
    for (const e of entries) {
      const group = byValue.get(e.units) ?? [];
      group.push(e.token);
      byValue.set(e.units, group);
    }
    return [...byValue.values()].filter((g) => g.length > 1).flat();
  },
};

/**
 * Rule 2: if someone picked the range minimum and someone picked the range maximum,
 * the max pickers win outright. Max pickers disqualified by Rule 1 cannot win.
 */
const zeroBeatenByMax: Rule = {
  id: 2,
  precedence: 2,
  override({ entries, minUnits, maxUnits, disqualified }) {
    if (!entries.some((e) => e.units === minUnits)) return [];
    return entries.filter((e) => e.units === maxUnits && !disqualified.has(e.token)).map((e) => e.token);
  },
};

export const RULES: Record<number, Rule> = {
  [noDuplicates.id]: noDuplicates,
  [zeroBeatenByMax.id]: zeroBeatenByMax,
};

export function rulesInPrecedenceOrder(ids: number[]): Rule[] {
  return ids
    .map((id) => RULES[id])
    .filter((r): r is Rule => Boolean(r))
    .sort((a, b) => b.precedence - a.precedence);
}

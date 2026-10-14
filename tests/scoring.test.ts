import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, computeRound, type GameSettings, type PickEntry } from "@/lib/game";

const settings = (patch: Partial<GameSettings> = {}): GameSettings => ({
  ...DEFAULT_SETTINGS,
  step: 1,
  ...patch,
});

const entries = (picks: Record<string, number>): PickEntry[] =>
  Object.entries(picks).map(([token, units]) => ({ token, units }));

describe("base scoring", () => {
  it("p = 0.8: 50/40/30/20 -> average 35, target 28, winner is 30", () => {
    const r = computeRound(entries({ a: 50, b: 40, c: 30, d: 20 }), settings(), []);
    expect(r.average).toBe(35);
    expect(r.target).toBeCloseTo(28);
    expect(r.winners).toEqual(["c"]);
    expect(r.points).toEqual({ c: 10 });
  });

  it("p = 2/3 works with exact fractions", () => {
    // average 30, target 20 exactly -> pick 20 wins
    const r = computeRound(entries({ a: 10, b: 20, c: 60 }), settings({ p: 2 / 3 }), []);
    expect(r.target).toBeCloseTo(20);
    expect(r.winners).toEqual(["b"]);
  });

  it("p = 1/2 and p = 4/3", () => {
    const half = computeRound(entries({ a: 0, b: 40, c: 80 }), settings({ p: 0.5 }), []);
    expect(half.target).toBeCloseTo(20);
    expect(half.winners.sort()).toEqual(["a", "b"]);
    const big = computeRound(entries({ a: 30, b: 60, c: 90 }), settings({ p: 4 / 3 }), []);
    expect(big.target).toBeCloseTo(80);
    expect(big.winners).toEqual(["c"]);
  });

  it("ties: all tied players win with full points", () => {
    const exactTie = computeRound(entries({ a: 10, b: 30 }), settings({ p: 1 }), []);
    // average 20, target 20 -> both 10 away
    expect(exactTie.winners.sort()).toEqual(["a", "b"]);
    expect(exactTie.points).toEqual({ a: 10, b: 10 });
  });

  it("decimal steps give deterministic results", () => {
    const s = settings({ step: 0.1, p: 0.8 });
    // units of 0.1: picks 12.3, 4.5, 20.1
    const r = computeRound(entries({ a: 123, b: 45, c: 201 }), s, []);
    expect(r.average).toBeCloseTo((12.3 + 4.5 + 20.1) / 3);
    expect(r.winners).toHaveLength(1);
  });

  it("no picks: no winners", () => {
    const r = computeRound([], settings(), []);
    expect(r.winners).toEqual([]);
    expect(r.average).toBeNull();
  });

  it("close-call bonus goes to non-winners within 2 of the target", () => {
    const r = computeRound(entries({ a: 24, b: 26, c: 40 }), settings({ closeCallBonus: 3 }), []);
    // average 30, target 24 -> a distance 0 wins; b distance 2 close; c 16 far
    expect(r.winners).toEqual(["a"]);
    expect(r.points).toEqual({ a: 10, b: 3 });
  });
});

describe("Rule 1: no duplicates", () => {
  it("duplicates lose, closest unique wins, duplicates still in average", () => {
    // picks 10,10,40,70 -> average 32.5, target 26 (p 0.8)
    const r = computeRound(entries({ a: 10, b: 10, c: 40, d: 70 }), settings(), [1]);
    expect(r.average).toBe(32.5);
    expect(r.disqualified.sort()).toEqual(["a", "b"]);
    expect(r.winners).toEqual(["c"]);
  });

  it("three-way duplicate is disqualified entirely", () => {
    const r = computeRound(entries({ a: 30, b: 30, c: 30, d: 90 }), settings(), [1]);
    expect(r.disqualified.sort()).toEqual(["a", "b", "c"]);
    expect(r.winners).toEqual(["d"]);
  });

  it("everyone duplicated -> no winner", () => {
    const r = computeRound(entries({ a: 5, b: 5, c: 9, d: 9 }), settings(), [1]);
    expect(r.winners).toEqual([]);
  });

  it("is ignored when the rule is not active", () => {
    const r = computeRound(entries({ a: 30, b: 30, c: 90 }), settings(), []);
    expect(r.disqualified).toEqual([]);
    expect(r.winners.sort()).toEqual(["a", "b"]);
  });
});

describe("Rule 2: zero is beaten by the maximum", () => {
  it("single 100 wins when someone picked 0", () => {
    const r = computeRound(entries({ a: 0, b: 100, c: 30 }), settings(), [2]);
    expect(r.winners).toEqual(["b"]);
    expect(r.overrideRule).toBe(2);
  });

  it("needs a 0: 100 alone does not win by this rule", () => {
    const r = computeRound(entries({ a: 100, b: 30, c: 40 }), settings(), [2]);
    expect(r.overrideRule).toBeNull();
    expect(r.winners).not.toContain("a");
  });

  it("two 100s without Rule 1 both win", () => {
    const r = computeRound(entries({ a: 0, b: 100, c: 100 }), settings(), [2]);
    expect(r.winners.sort()).toEqual(["b", "c"]);
  });

  it("two 100s with Rule 1 active -> duplicates lose, falls back to Rule 1 / base", () => {
    const r = computeRound(entries({ a: 0, b: 100, c: 100, d: 35 }), settings(), [1, 2]);
    expect(r.overrideRule).toBeNull();
    expect(r.disqualified.sort()).toEqual(["b", "c"]);
    // average 58.75, target 47; a distance 47, d distance 12 -> d wins
    expect(r.winners).toEqual(["d"]);
  });

  it("single 100 beats Rule 1 and base distance (precedence)", () => {
    const r = computeRound(entries({ a: 0, b: 100, c: 30, d: 30 }), settings(), [1, 2]);
    expect(r.winners).toEqual(["b"]);
    expect(r.overrideRule).toBe(2);
  });
});

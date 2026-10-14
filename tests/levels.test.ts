import { describe, expect, it } from "vitest";
import { levelValues, nearestLevel } from "@/lib/game";

describe("level-k values", () => {
  it("derives levels from p = 0.8", () => {
    const [l0, l1, l2, l3] = levelValues(0.8);
    expect(l0).toBe(50);
    expect(l1).toBeCloseTo(40);
    expect(l2).toBeCloseTo(32);
    expect(l3).toBeCloseTo(25.6);
  });

  it("derives levels from p = 2/3", () => {
    const [, l1, l2] = levelValues(2 / 3);
    expect(l1).toBeCloseTo(33.33, 1);
    expect(l2).toBeCloseTo(22.22, 1);
  });

  it("classifies a pick to the nearest level", () => {
    expect(nearestLevel(41, 0.8)).toBe(1);
    expect(nearestLevel(31, 0.8)).toBe(2);
    expect(nearestLevel(0, 0.8)).toBe(5);
  });
});

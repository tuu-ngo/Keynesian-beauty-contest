/**
 * Level-k reasoning values: Lk = 50 * p^k (L0 = 50 is the naive random average).
 * Always derived from p; never hard-coded.
 */
export function levelValues(p: number, count = 6): number[] {
  return Array.from({ length: count }, (_, k) => 50 * Math.pow(p, k));
}

/** Index of the level whose value is nearest to the pick. */
export function nearestLevel(pick: number, p: number, count = 6): number {
  const values = levelValues(p, count);
  let best = 0;
  for (let k = 1; k < values.length; k++) {
    if (Math.abs(values[k] - pick) < Math.abs(values[best] - pick)) best = k;
  }
  return best;
}

/**
 * Exact arithmetic helpers. Picks are handled as integer multiples of `step`
 * ("units") and `p` as a fraction, so ties and equality never depend on float error.
 */

export interface Fraction {
  num: number;
  den: number;
}

export function toFraction(x: number, maxDen = 1000): Fraction {
  for (let den = 1; den <= maxDen; den++) {
    const num = Math.round(x * den);
    if (Math.abs(num / den - x) < 1e-9) return { num, den };
  }
  return { num: Math.round(x * 1e6), den: 1e6 };
}

/** Value to integer units of `step`, or null if it is not a multiple of `step`. */
export function toUnits(value: number, step: number): number | null {
  if (!Number.isFinite(value)) return null;
  const units = Math.round(value / step);
  return Math.abs(value / step - units) < 1e-6 ? units : null;
}

export function fromUnits(units: number, step: number): number {
  // Round to the step's decimals to drop float noise (0.1 * 3 = 0.30000000000000004).
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  return Number((units * step).toFixed(decimals));
}

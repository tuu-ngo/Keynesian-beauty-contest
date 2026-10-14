import type { RoundSettings } from "@/contracts";

export function decimal(value: number | string | null | undefined, digits = 1) {
  if (value === null || value === undefined) return "No valid picks";
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return "No valid picks";
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(digits).replace(/\.0$/, "");
}

export function tenths(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : decimal(value / 10);
}

export function multiplier(p: RoundSettings["p"]) {
  return p === "0.8" ? "80%" : p === "2/3" ? "2/3" : "1/2";
}

export function ruleSentence(p: RoundSettings["p"]) {
  return `Choose a number closest to ${multiplier(p)} of the group’s average.`;
}

export function shortDate(iso: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

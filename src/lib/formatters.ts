import type { PublicProjection, RoundSettings } from "@/contracts";

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

/** Team escape mode: who escaped in this round, and the losing team once the run is over. */
export function teamEscapeNotice(game: Pick<PublicProjection, "teams" | "teamEscape">, escapedTeamIds: string[] = []): string | null {
  if (!game.teamEscape) return null;
  const name = (teamId: string) => game.teams.find((team) => team.id === teamId)?.name ?? teamId;
  const parts: string[] = [];
  if (escapedTeamIds.length) parts.push(`${escapedTeamIds.map(name).join(", ")} reached ${game.teamEscape.escapePoints} points and escaped.`);
  if (game.teamEscape.losingTeamId) parts.push(`${name(game.teamEscape.losingTeamId)} is the last team left and loses.`);
  return parts.length ? parts.join(" ") : null;
}

export function ruleSentence(p: RoundSettings["p"]) {
  return `Choose a number closest to ${multiplier(p)} of the group’s average.`;
}

export function shortDate(iso: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

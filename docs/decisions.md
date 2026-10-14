# Decisions

Record choices the README leaves open. One entry per decision, newest last.

## 2026-10-14: npm instead of pnpm
pnpm is not installed on the dev machine, so the scaffold uses npm (`package-lock.json`). Scripts are the same: `dev`, `build`, `lint`, `test`, `typecheck`.

## 2026-10-14: Tailwind CSS 4
Configured through `@tailwindcss/postcss` and `@import "tailwindcss"` in `globals.css`; no `tailwind.config` file.

## 2026-10-14: Game logic details the README left open
- Picks are handled as integer multiples of `step` and `p` as a fraction (`numeric.ts`), so ties and equality are exact.
- Close-call bonus (when `closeCallBonus > 0`) goes to non-winning, non-disqualified players within 2 value units of the target; it is skipped when Rule 2 decides the round.
- Rule 2 needs a pick equal to the range minimum and picks equal to the range maximum; max pickers disqualified by Rule 1 cannot win through it.
- If nobody can be eliminated in an escalation round (every active player won), no one is eliminated that round.
- `FINISHED` is entered by `advance` after the final reveal, not by `revealRound`.
- Opening a round needs at least 2 active players. Rounds are capped by `settings.rounds` in the normal phase (`null` = unlimited); `startEscalation` forces the phase once they are used up.
- `sanitizeName` strips `<` and `>` and collapses whitespace; output is still rendered as text only.

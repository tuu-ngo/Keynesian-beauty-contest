# Decisions

Record choices the README leaves open. One entry per decision, newest last.

## 2026-10-14: npm instead of pnpm
pnpm is not installed on the dev machine, so the scaffold uses npm (`package-lock.json`). Scripts are the same: `dev`, `build`, `lint`, `test`, `typecheck`.

## 2026-10-14: Tailwind CSS 4
Configured through `@tailwindcss/postcss` and `@import "tailwindcss"` in `globals.css`; no `tailwind.config` file.

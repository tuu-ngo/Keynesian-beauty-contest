# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Live host for the Keynesian beauty contest ("guess 80% of the average", default `p = 0.8`). Players join from phones, the host controls rounds on a laptop, and a read-only Portal is projected on a big screen.

`README.md` is the original full spec (Vietnamese). MVP scope is narrower and is fixed by `docs/decisions.md`, `docs/contracts.md` and `docs/mvp-plan.md`; when they disagree with the README, the docs win. Record new open choices in `docs/decisions.md` (newest last). MVP highlights: exactly one room per deployment, reset keeps the room code and roster and starts a new `runId`, finished/reset runs are archived for 7 days, `p` is one of `0.8 | 2/3 | 1/2`, range `0–100`, step `0.1`, English-only UI, 1 s polling (no WebSocket).

## Commands

```
cp .env.example .env   # HOST_USERNAME / HOST_PASSWORD / HOST_SESSION_SECRET, TURSO_*
npm run seed-db        # apply db/seed.sql (roster) to the database; required before creating the room
npm run dev            # next dev, uses the local SQLite file db/keynesian-beauty-contest.dev.db
npm run build
npm run lint           # eslint .
npm run typecheck      # tsc --noEmit
npm test               # vitest run, tests/**/*.test.ts
npm run test:contracts # tests/room-model.test.ts only
npx vitest run tests/room-model.test.ts        # one file
npx vitest run -t "name of test"               # one test by name
```

Node >= 20, npm (not pnpm). Tailwind CSS 4 is configured through `@tailwindcss/postcss` and `@import "tailwindcss"` in `globals.css`; there is no `tailwind.config`. The `@` alias maps to `src/` (set in both `tsconfig.json` and `vitest.config.ts`). UI follows the neobrutalism skill in `.claude/skills/neobrutalism-design/`.

## Architecture

Request flow: route handler in `src/app/api/**` -> auth/validation -> `src/lib/server/room-service.ts` -> `RoomStore.mutateRoom` with a pure mutator from `src/lib/room/model.ts` -> role projection in `src/lib/room/projection.ts`.

**Contracts in `src/contracts/schema.ts`.** Zod schemas and types shared by routes, model and UI (`HostCommand`, `StateResponse` with `public | player | host` projections, room code `^[A-Z]{4}$`, etc.). Change the schema and its tests before changing a public shape.

**Game model in `src/lib/room/model.ts`.** This is the engine the app runs. Pure functions over a whole `Room` snapshot (teams, accounts with server-only passwords, current `run`, player sessions, command/pick receipts, archives); they clone with `structuredClone` and throw `RoomError(code)`. `now` and the elimination `seed` are passed in.
- Run state: `LOBBY -> ROUND_OPEN -> ROUND_LOCKED -> ROUND_REVEALED -> (ROUND_OPEN | FINISHED)`, plus `phase: NORMAL | ESCALATION` and `escalationReason: NASH | HOST`.
- Host actions are `applyCommand` with `OPEN_ROUND | LOCK_ROUND | REVEAL_ROUND | START_ESCALATION | UPDATE_SETTINGS | FINISH | RESET`. Each command carries `commandId` (receipt makes retries idempotent) and `expectedVersion` (mismatch is `VERSION_CONFLICT`). Picks go through `submitPick` with a per-player `requestId` receipt.
- Opening round 1 locks participation; only players who joined in `LOBBY` belong to the run. Needs at least two active participants.
- Picks are stored as integer tenths and `p` as a `bigint` fraction; average, target and distance are exact. Never compare floats.
- Every round snapshots `roundMode: STANDARD | WAGER | HOST_TARGET`. In a wager round, a pick and whole-point stake are saved atomically; stake is capped by the player's current balance. At reveal, a winner receives `2 * stake` back (net `+stake`) and a non-winner loses the stake, then ordinary win/loss scoring applies. There is no shared pot or refund. `HOST_TARGET` is NORMAL-only: the Host saves a secret whole-number target from 0 to 100 before opening, the round snapshots it in integer tenths, and the public/player projections hide it until reveal.
- Reveal in `NORMAL`: closest to `p * average` wins in STANDARD/WAGER; closest to the fixed Host target wins in HOST_TARGET. Ordinary win/loss points apply in all modes. All-zero picks trigger Nash only outside HOST_TARGET. Host can also `START_ESCALATION` after any normal reveal.
- Reveal in `ESCALATION`: Rule 1 disqualifies duplicate picks; Rule 2 (activated after the first elimination) makes a single 100-picker win when someone picked 0. Exactly one player is eliminated: Rule 1 duplicates, then largest distance; ties are broken by the seed, which is stored in the round result. When one active player remains the run becomes `FINISHED` in the same reveal.
- `FINISH` and `RESET` archive the run (only if it has rounds) as a `PublicArchive`, kept 7 days. `csvForArchive` builds the export, including wager settlement columns. Team score is the sum of member points, eliminated players included.
- Deadlines: there is no background job. `resolveDeadline` locks a lapsed open round lazily; `room-service` runs it (plus `purgeExpiredArchives`) on every read and before every write.

**Projections in `src/lib/room/projection.ts`** are the security boundary. `public` and `player` views never contain other players' pick/stake values or a HOST_TARGET secret before reveal; `player` adds only its own `self` pick/stake; `host` gets named picks/stakes only from `ROUND_LOCKED` on and is the only live projection with the current/next Host target. Live host exports hide picks, stakes and the Host target of an open round. Enforce on the server and cover with tests, never in the UI. Passwords and tokens must never reach a projection or archive.

**Store in `src/lib/store/`.** `RoomStore` (`room-types.ts`) is the only persistence interface; `getRoomStore()` returns a `LibsqlStore` singleton on `globalThis`. The whole room is one JSON row in `room_snapshots` (`id = 1`). `mutateRoom` does read -> pure mutator -> `UPDATE ... WHERE version = ?` compare-and-swap with up to 12 jittered retries; a mutator must either return the same object (no-op) or increment `version` exactly once. The same DB holds `rate_limit_buckets` and the `seed_teams` / `seed_users` roster from `db/seed.sql`; creating the room snapshots that roster. Dev uses `file:db/keynesian-beauty-contest.dev.db` (gitignored); production requires a remote Turso `libsql://`/`https://` URL with `TURSO_AUTH_TOKEN` and an HTTPS `NEXT_PUBLIC_BASE_URL`.

**Auth in `src/lib/auth/`.** Host: single account from env, HMAC-signed `HttpOnly` `SameSite=Strict` cookie (`host-session.ts`); host writes also check Origin (`validHostOrigin`). Player: plaintext roster password checked with a timing-safe compare, then a random bearer token whose hash is stored in `room.sessions` (`player-session.ts`). Rate limits are durable (`src/lib/server/rate-limit.ts`). Error code to HTTP status mapping is in `src/lib/server/http.ts`.

**API routes** (all `runtime = "nodejs"`): `/api/host/{login,logout,session}`, `/api/room` (create singleton room), `/api/room/{state,login,join,pick,command,export,archives}`. `GET /api/room/state?code=&view=` serves the projections with an ETag built from version, view, run and token.

**UI.** Pages: `/` (redirect), `/login`, `/host`, `/host/[code]`, `/play/[code]`, `/portal/[code]`. Clients live in `src/components/{player,host,portal,room}`; `room/use-room-state.ts` is the shared 1 s polling hook (ETag/`If-None-Match`, abort, backoff, player pauses while the tab is hidden); `src/lib/api/room-client.ts` wraps fetch.

**Legacy code, not used at runtime.** `src/lib/game/` is the earlier pure engine (`Game`, `RULES` registry, `syncTimer`); only `tests/engine.test.ts`, `tests/scoring.test.ts` and `tests/levels.test.ts` import it. `src/lib/i18n/` (English dictionary only) is not wired into the UI. Make gameplay changes in `src/lib/room/model.ts` and test them in `tests/room-model.test.ts`; do not assume a passing `engine.test.ts` covers the running app.

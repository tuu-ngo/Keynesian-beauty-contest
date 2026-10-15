# Backend implementation specification

> Status: proposed implementation plan for MVP  
> Owner: backend  
> Source of truth: [`../decisions.md`](../decisions.md) and
> [`../contracts.md`](../contracts.md). If this document conflicts with either,
> those two documents win.

## 1. Purpose and scope

Implement the server-authoritative backend for the Keynesian Beauty Contest
MVP. It owns identity, room state, state transitions, exact scoring, data
privacy, persistence, archives, and exports. Browser clients are projections of
this state; they must never decide whether a pick, winner, elimination, or
transition is valid.

The MVP has exactly one persistent **room**. A reset starts a new **run** in the
same room, with a new `runId`; it does not create a second room. The system is
designed for roughly 50 concurrent polling clients and has no WebSocket or
background scheduler requirement.

Included:

- host and player authentication;
- SQL roster-seed validation and a one-time room creation flow;
- normal and escalation game rules, exact arithmetic, scores and leaderboards;
- role-specific public/player/host projections;
- one-second polling with `ETag`, versioning, idempotency and deadline checks;
- local SQLite development persistence and Turso/libSQL production persistence;
- reset, seven-day archives, and CSV/JSON export.

Not included in this backend MVP:

- multi-room tenancy, self-service roster management, player registration;
- WebSockets, cron-triggered lock when absolutely nobody polls, or 200-player
  load certification;
- `p = 4/3`, configurable domain/step, bonus scoring, or i18n;
- analytics beyond export, staff accounts, and a public archive browser.

## 2. Current baseline and required replacement

The repository currently has a scaffold-era `Game` model and
`/api/games/route.ts`. They do not model accounts, runs, projections, archives,
or the MVP concurrency requirements. Treat `/api/games/**` as obsolete: remove
or replace it as part of integration, and do not expose both API families.

The target public API is `/api/host/**` and `/api/room/**`, as defined below and
in `contracts.md`. Backend work begins by creating shared runtime schemas in
`src/contracts/`; code outside that directory imports those contracts rather
than recreating request or response types.

## 3. Architecture and ownership

```text
Next.js route handlers
  ├─ parse body/query + authenticate + Origin/rate-limit checks
  ├─ call application service with a validated command
  └─ map domain/store outcomes to HTTP and a safe projection

Application service (server only)
  ├─ load one consistent room snapshot
  ├─ evaluate deadline before read/mutation when applicable
  ├─ call pure game engine transitions
  └─ persist one atomic outcome; publish incremented room version

Pure game engine (no I/O, Date, crypto, HTTP, or environment)
  ├─ transition and invariant validation
  ├─ exact fractional arithmetic, scoring, rules and ranking
  └─ returns new state plus auditable event/result data

Store adapter
  ├─ SQLite file through libSQL for local development
  └─ remote Turso/libSQL + SQL transactions for production
```

Suggested file layout:

```text
src/contracts/
  schema.ts              # Zod schemas and inferred public types
  commands.ts            # Host/pick/join request schemas
  projections.ts         # StateResponse schemas/types
  fixtures/              # valid and invalid examples for UI/tests
src/lib/game/
  model.ts               # internal persisted model; not client contracts
  fractions.ts           # bigint rational operations and formatting
  transition.ts          # open, lock, reveal, finish, reset
  rules.ts               # ordered rule registry (1, 2)
  projection.ts          # Public/Player/Host transformations
  export.ts              # stable CSV/JSON archive serialization
src/lib/auth/
  host-session.ts        # signed HttpOnly cookie
  player-session.ts      # opaque player-token creation/verification
  rate-limit.ts
src/lib/store/
  types.ts
  sqlite.ts             # shared libSQL repository implementation
  migrations.ts         # ordered, idempotent schema migrations
  index.ts
src/lib/server/
  room-service.ts        # auth-neutral application operations
  http.ts                # API error and response helpers
src/app/api/{host,room}/.../route.ts
tests/{contracts,game,store,api}/
```

`RoomState` remains a logical contract, not a directly returned JSON record.
Credentials, session records, raw picks while hidden, command receipts, and
archive metadata are server-only fields.

## 4. Persisted state and SQLite schema

The backend uses SQLite-compatible SQL through `@libsql/client`. Local
development opens `file:db/keynesian-beauty-contest.dev.db`; production connects
to a remote Turso/libSQL database using `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN`. Do not deploy a local `.db` file to Vercel: Function files
are not a shared durable database. Turso is the production SQLite deployment,
not an optional cache. [Vercel's guidance](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel)
explains why local SQLite cannot persist across serverless instances; Vercel
offers [Turso Cloud](https://vercel.com/marketplace/tursocloud/database) for this
SQLite-compatible use case.

Migrations live in source control and are recorded in `schema_migrations`. The
application runs pending migrations before serving requests in development. In
production, run the same migration command once in CI/CD before the deployment;
do not let concurrent Functions race to migrate the database.

| Table | Primary key / essential columns | Purpose |
|---|---|---|
| `schema_migrations` | `id`, `applied_at` | records ordered migrations |
| `rooms` | singleton `id = 1`, `code`, `version`, state/settings fields | durable room shell and compare-and-swap version |
| `accounts` | `(room_id, username)`, team/display fields | players who joined by nickname; kept across runs |
| `runs` | `run_id`, `room_id`, status/phase/rules/settings, timestamps | one resettable game run |
| `participants` | `(run_id, username)`, status, points, placement | active/eliminated status and totals |
| `rounds` | `(run_id, number)`, settings, timestamps, result JSON | round snapshot and audited result |
| `picks` | `(run_id, round_number, username)`, `value_tenths` | private input until its round is revealed |
| `player_sessions` | `token_hash`, username, expiry/revoked timestamps | opaque player-session lookup |
| `command_receipts` | `command_id`, run/version, response JSON | Host command idempotency |
| `pick_receipts` | `(username, request_id)`, response JSON | Player retry idempotency |
| `archives` | `run_id`, `expires_at`, immutable `archive_json` | seven-day export snapshot |
| `rate_limit_buckets` | `(scope, bucket)`, count, expires_at | best-effort persistent rate limiting |

`rounds.result_json`, `command_receipts.response_json`, and
`archives.archive_json` are deliberately immutable audit documents. Core query
fields remain relational so constraints and indexes protect identity, uniqueness,
and fast current-state reads. Required indexes include `runs(room_id, created_at
DESC)`, `participants(run_id, status)`, `picks(run_id, round_number)`, and
`archives(expires_at)`.

Do not persist JavaScript floating-point values for a pick. A pick is an integer
in `[0, 1000]`, representing tenths. `p` is one of the exact fractions `4/5`,
`2/3`, or `1/2`. Round output strings are formatted only at the projection or
export boundary.

### Transaction and concurrency protocol

The SQL adapter loads a consistent run snapshot, invokes the pure transition,
then writes all affected rows in one database transaction. Its final mutation is
conceptually:

```sql
UPDATE rooms
SET version = :nextVersion, updated_at = :now
WHERE id = 1 AND version = :expectedVersion;
```

If this updates zero rows, roll back and return `VERSION_CONFLICT` (or re-read
to find an existing command/pick receipt). The `rooms.version` check prevents
lost updates across separate Vercel Functions. SQLite's single-writer behavior
serializes accepted mutations; do not replace it with an in-memory mutex or
client-side state.

Use libSQL's transactional batch/write facility for a remote Turso mutation;
use a standard write transaction for the local file. The service must not issue
an independent read followed by later writes outside that transaction. Unique
keys on command and pick receipts make retry behavior durable. On contention,
retry only a short bounded number of serialization/busy failures; surface an
actionable `409` or `503` afterwards, never rerun a command blindly.

Archive retention is logical: every archive read/write deletes rows where
`expires_at <= now`; a scheduled maintenance job is optional, not required for
correct access control. This avoids relying on a Redis key TTL.

### Local development adapter

The SQLite dev database is gitignored, uses WAL mode with foreign keys enabled,
and survives a dev-server restart. Startup validates migration state and fails
with an actionable message if the database schema is incompatible. It supports
one local writer process. Tests create a temporary SQLite database per suite so
they never mutate `db/keynesian-beauty-contest.dev.db`.

## 5. Identity, authorization, and request safety

### Host

`POST /api/host/login` compares submitted credentials with
`HOST_USERNAME`/`HOST_PASSWORD` using a timing-safe comparison. On success it
sets a signed session cookie:

- `HttpOnly`, `Path=/`, `SameSite=Strict`;
- `Secure` in production;
- signed with `HOST_SESSION_SECRET` (at least 128 bits of entropy);
- short, explicit expiry (recommended: 12 hours) and renewed only through a
  successful login.

All host routes verify this cookie server-side. The host identity is never
accepted from a query parameter or request body.

### Player

Players do not sign in (Kahoot-style). `POST /api/room/login` takes
`{code, name}`, normalizes the nickname (strip markup and control characters,
collapse whitespace, 1–20 characters) and registers it as a new account whose
username is the lowercased nickname. Nicknames are unique per room; a duplicate
is `409 NAME_TAKEN`. The server assigns the team with the fewest accounts.
Generate a
cryptographically random opaque token (minimum 256 bits); return it once to the
browser, which may keep it in local storage. Persist only a SHA-256 hash of the
token with username and expiry. The API receives the raw player token in an
`Authorization: Bearer` header, never in a URL or cookie.

Joining by nickname is allowed only in `LOBBY`; after participation is locked
new nicknames are rejected with `409 INVALID_TRANSITION` and returning players
rely on their stored token. A lost token cannot reclaim a nickname. After reset,
an existing valid token may call `join` for the new `runId` while that run is in
the lobby. Tokens do not grant Host privileges.

### Mutating requests

- Validate `Content-Type: application/json` and each body with Zod before any
  domain work.
- Check a same-origin `Origin` value for cookie-authenticated host writes. In
  development, permit the configured localhost origin only.
- Apply rate limits before registering a nickname and before accepting picks. A
  practical initial policy is 240 joins/minute per IP (classrooms share an IP),
  120 pick requests/minute per player, and 30 host commands/minute per host.
- Never log a Host password, raw player token, host cookie, or unredacted internal
  room envelope.
- Use `Cache-Control: no-store` on authenticated responses. Public state may
  use `private, no-cache` so the client still revalidates its ETag.

## 6. API surface

All errors use the following stable shape:

```json
{ "error": { "code": "VERSION_CONFLICT", "message": "State changed; refresh and retry." } }
```

Codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403),
`ROOM_NOT_FOUND`/`RUN_NOT_FOUND` (404), `INVALID_TRANSITION`,
`VERSION_CONFLICT`, `ROOM_EXISTS`, `RUN_MISMATCH` (409), `RUN_EXPIRED` (410),
`RATE_LIMITED` (429), and `INTERNAL_ERROR` (500). For 409 version conflicts,
include the latest version and run id in non-secret error metadata.

| Route | Auth | Main requirements |
|---|---|---|
| `POST /api/host/login` | none | set host cookie |
| `POST /api/host/logout` | host | expire host cookie |
| `GET /api/room` | host | active room metadata, else 404 |
| `POST /api/room` | host | validate seed files and create exactly one room |
| `GET /api/room/state?code=&view=public\|player\|host` | varies by `view` | authenticate first, resolve deadline, then return safe projection or 304 |
| `POST /api/room/login` | roster credentials | issue player token; join only where allowed |
| `POST /api/room/join` | player token | body `{ runId }`, idempotent join/restore |
| `PUT /api/room/pick` | active player token | body `{ runId, round, value, requestId }` |
| `POST /api/room/command` | host | validated host command, `commandId`, `expectedVersion` |
| `GET /api/room/archives` | host | summaries of unexpired archives |
| `GET /api/room/export?runId=&format=csv\|json` | host | download active/retained archive only |

### State reads, projection, and ETag

`view` asks for a data shape; it is not proof of a role. For example, a Portal
always asks for `view=public`, even if the browser also has a host cookie.

The state handler performs this order:

1. Parse `code` and requested view.
2. Authenticate the minimum role required by that view.
3. Load one consistent snapshot and opportunistically lock the round if the
   deadline has passed (via the same atomic transition used by Host).
4. Build the requested projection from that resulting snapshot.
5. Compare `If-None-Match` only after steps 1--4; return `304` only if the
   caller is entitled to the projection.

Use `ETag: "<version>-<view>-<runId>"`. A player-specific ETag must include a
player discriminator or token-session hash in addition to this documented base
form, because the `self` field differs between players. Keep that discriminator
opaque (for example a hash prefix), never a raw token.

Projection rules are security boundaries:

| State | Public / Portal | Player | Host |
|---|---|---|---|
| Lobby | roster only | roster + own identity | roster |
| Open | submitted flags/count, never values | own current pick only | submitted flags/count, never values |
| Locked | no unrevealed values | own pick only | all picks for the locked round |
| Revealed/finished | anonymous revealed picks + named winners/results | public result + own pick | public result + all permitted history |

Projection tests must assert field absence, not merely that a UI does not render
the field.

## 7. Domain commands and invariants

The state machine is:

```text
LOBBY -> ROUND_OPEN -> ROUND_LOCKED -> ROUND_REVEALED -> (ROUND_OPEN | FINISHED)
  ^                                                                  |
  +----------------------------- RESET ------------------------------+
```

The pure transition layer receives an explicit clock and a random seed supplied
by its caller, which makes every transition testable. It rejects invalid
commands rather than trying to repair state.

| Command | Preconditions | Atomic outcome |
|---|---|---|
| `OPEN_ROUND` | Lobby or revealed; first round has >=2 participants | lock roster on first open; snapshot next-round settings; add round with deadline |
| `LOCK_ROUND` | open | set `lockedAt`; no future pick can win a race |
| `REVEAL_ROUND` | locked | calculate result exactly once, score, enter escalation/eliminate when applicable |
| `START_ESCALATION` | normal and a round is revealed | enable Rule 1 for next round; reason `HOST` |
| `UPDATE_SETTINGS` | lobby or revealed | change only `p`/timer for the next round |
| `FINISH` | not finished | freeze final state and archive it once |
| `RESET` | any state | archive eligible old run once; make a new lobby run; preserve room roster and valid sessions |

Every host command has a UUID `commandId` and `expectedVersion`. The store
returns the saved receipt if `commandId` was already applied, even if the
request is retried after a network failure. A different command against an old
version gets `409 VERSION_CONFLICT`; it must not advance the game. Pick retries
behave the same with a per-player `requestId`, while a new request id may update
the pick until lock.

An expired deadline is evaluated at the start of every state read and mutation.
The first request after expiry locks the round; an incoming pick in that same
race loses. This satisfies the MVP without a scheduler and means a truly idle
room can remain visually open until a later request observes it.

## 8. Scoring and escalation implementation

Put arithmetic and rule evaluation in pure functions with table-driven tests.

1. Convert submitted `value` to `valueTenths` only after proving it is a
   decimal multiple of `0.1` in `0..100`; reject rather than round it.
2. Average all submitted **active** picks. Missing picks are not zero and do not
   enter the average. If none were submitted, average/target/winners are `null`
   or empty as appropriate.
3. Calculate `target = p * average` as a reduced fraction. Compare distances by
   cross multiplication; use `bigint`, not IEEE floating point.
4. In normal play, every tied nearest pick wins and gets ten points.
5. In escalation, run the ordered registry: Rule 2 proposes the unique eligible
   `100` winner only when a `0` exists; Rule 1 disqualifies duplicate picks;
   otherwise choose all nearest eligible picks. Duplicate picks still influence
   the average. If nobody is eligible, winners are empty.
6. In normal play, trigger Nash only when at least two active participants all
   submitted exactly zero. Enable Rule 1 for the *next* round and save reason
   `NASH`. Manual escalation does the same with reason `HOST`.
7. In every escalation reveal, eliminate exactly one active non-winner. Priority
   groups are missing pick, Rule-1-disqualified pick, then other non-winners.
   Within a group select the greatest exact distance; when no target exists or
   distance ties, choose deterministically from a cryptographically generated
   seed saved with the candidate list and result. After the first elimination,
   enable Rule 2. If one active participant remains, finish automatically.

The result stores all audit values necessary to explain a reveal: winner list,
points per username, candidates, seed, and eliminated username. It must never
need to recompute a historical result from changed settings.

## 9. Archive and export

Archive at `FINISH`, and when `RESET` discards a run that has at least one
round. Use a stable archive identifier `runId`; an `archivedAt` marker prevents
duplicate archive creation on repeated commands. The archived data includes
particular round settings and unfinished locked/open rounds if reset occurred,
but no credentials, session records, or tokens.

`results.csv` emits one row per participant per **revealed** round:

```text
runId,round,username,displayName,teamId,pick,distance,points,winner,eliminated
```

`game.json` is a versioned archive document containing room-safe metadata, the
run snapshot, results, and both leaderboards. Generate both from the archived
snapshot rather than live state. Escape CSV according to RFC 4180 and set a
download content type and filename. Host authorization is mandatory for every
archive list or download.

## 10. Delivery plan

### M0 — contracts and fixtures

1. Create `src/contracts` Zod schemas for seed files, room/run/round internal
   shapes, commands, errors, and three projections.
2. Add valid/invalid fixtures for each status, no-pick reveal, Nash,
   escalation, finished, reset and archive.
3. Add `test:contracts` to `package.json`; all later modules import this layer.
4. Add and validate `db/seed.sql`, gitignore `db/keynesian-beauty-contest.dev.db`, and fail room
   creation with clear roster diagnostics.

Exit: schemas, API examples, and contract tests lock `schemaVersion: 1`.

### M1 — deterministic core and persistence

1. Replace scaffold `Game` types with an internal model aligned with contracts.
2. Implement fractions, state transitions, rule registry, score/ranking,
   projections and exports as pure modules.
3. Implement SQLite migrations and the `file:` adapter with restart recovery.
4. Implement the remote Turso/libSQL configuration, sharing the same adapter
   suite and transaction contract.

Exit: table tests cover all rule cases; 50 simultaneous pick attempts, lock vs
pick, repeated reveal, and reset vs poll preserve invariants.

### M2 — routes and security integration

1. Build host/player auth and rate-limit helpers.
2. Implement routes in API-table order, followed by ETag/deadline behavior.
3. Delete/redirect the obsolete `/api/games` scaffold only once replacement
   routes are covered by route tests.
4. Exercise a full HTTP run: login -> room -> join -> normal -> escalation ->
   finish -> export -> reset -> old archive export.

Exit: security tests prove Portal and players cannot receive other players'
unrevealed picks; host cannot see them before lock.

### M3 — deployment validation

1. Verify required env at server startup and reject a `file:` database URL in
   production.
2. Provision Turso, grant a least-privilege database token, and select a region
   near the Vercel Functions.
3. Run 50-client polling/load simulation, restart development server and
   deployed Function tests, and record measured latency/cost.
4. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

## 11. Test matrix and acceptance criteria

| Layer | Must prove |
|---|---|
| Contracts | invalid roster relations/casing/assets fail; fixtures validate against schemas |
| Game | exact `0.8`, `2/3`, `1/2`; tie; missing/all-missing picks; rules 1/2/fallback; Nash/manual escalation; seeded elimination; finish/reset |
| Store | atomic version increment; duplicate IDs replay result; snapshot recovery; 50 concurrent picks; pick-vs-lock/reveal/reset races |
| API/auth | all validation/error mapping; cookie/token authorization; rate limit; origin protection; ETag 304 after authorization |
| Projection | no password/token ever; public/player no unrevealed foreign picks; host no picks before lock; archive remains host-only |
| Integration | run/reset/archive/export sequence; deadline observed server-side; exact run mismatch behavior |

The backend is ready for UI integration only when all of these are green and a
public response serializes no sensitive field even under a malformed query,
stale token, or repeated request.

## 12. Configuration and operational checks

Required server-only variables:

```dotenv
HOST_USERNAME=
HOST_PASSWORD=
HOST_SESSION_SECRET=
TURSO_DATABASE_URL=file:db/keynesian-beauty-contest.dev.db
TURSO_AUTH_TOKEN=
NEXT_PUBLIC_BASE_URL=
```

Use a distinct Turso database for each preview/staging/production environment.
Validate configuration on the first server-side store use. Production requires a
remote `libsql://` or `https://` URL, `TURSO_AUTH_TOKEN`, a non-default session
secret, and an HTTPS public base URL. Do not place secrets in `NEXT_PUBLIC_*`
variables.

Log structured, redacted events with `requestId`, `roomCode`, `runId`, version,
command type, outcome, and latency. Metrics should at least count mutation
conflicts, rejected picks, login/rate-limit failures, projection response size,
and state-read latency. They are operational aids, not part of the client
contract.

## 13. Decisions to confirm before implementation

The existing documents are sufficient to start M0. These choices are not
currently fixed and should be confirmed before M2/M3:

1. Is a 12-hour Host session and a 7-day Player-token lifetime acceptable, or
   do you want different expiry/revocation behavior?
2. Should a 4-character room code be generated randomly with collision retries,
   or supplied/chosen by the Host? (This specification assumes random.)
3. Will preview/staging and production use separate Turso databases? This
   specification assumes separate databases rather than a shared namespace.
4. (Resolved) Players join with a nickname and room code, no password; only the
   Host signs in.

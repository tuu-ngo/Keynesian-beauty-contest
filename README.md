# Keynesian Beauty Contest — Live Game Host

A web app to run the **Keynesian beauty contest** (the "guess 80% of the average" game; the classic version uses 2/3) live with a group. Players join from their phones via a link; the host projects a **portal** on a big screen so the whole room watches the game unfold. Hosted on **Vercel**.

This README is the product and technical specification. Build exactly what it describes; where something is unspecified, choose the simplest option that satisfies the requirements and note the decision in `docs/decisions.md`.

---

## 1. The game

### Background
John Maynard Keynes (*General Theory*, 1936, ch. 12) compared stock picking to a newspaper contest in which entrants choose the 6 prettiest faces out of 100 photos, and win by picking the faces *most others* pick. Level-1 players choose what they find prettiest; level-2 players choose what they think the average person finds prettiest; level-3 players guess what the average person thinks the average person thinks, and so on.

The standard lab/classroom version is the **p-beauty contest** (Nagel 1995):

1. Every player secretly picks a number in `[0, 100]`.
2. The average of all picks is computed.
3. The **target** is `p × average` (default `p = 0.8`, i.e. **80% of the average**; the textbook version uses `p = 2/3`).
4. The player whose pick is **closest to the target** wins the round.

### Theory (shown to the audience in the debrief)
- If everyone picks uniformly at random, average ≈ 50, so target ≈ 40 (`0.8 × 50`). A "level-1" player picks ~40.
- A "level-2" player expects others to pick 40 and picks ~32; level-3 picks ~25.6; level-4 ~20.5; and so on (`50 · 0.8ᵏ`). Convergence is slower than with `p = 2/3` (where the steps are 33, 22, 15…), so more rounds are useful.
- Iterating forever converges to **0**, the unique Nash equilibrium (for real-valued picks).
- Real groups do not play 0. Typical first-round results for the classic `p = 2/3` game: picks cluster near **33** and **22**, with spikes at 50 and 0/1; averages roughly 25–40 depending on the crowd (e.g. reported ≈ 40 for general business audiences, ≈ 25–30 for economics PhDs / Caltech undergraduates). These figures are for `p = 2/3`; with `p = 0.8` expect clusters near **40** and **32** and a higher average.
- With repeated rounds, averages fall toward 0 as players learn.

### Escalation phase (elimination rules)
The game has two phases.

**Phase A — Normal.** The base rules above. Everyone plays every round. No eliminations.

**Phase B — Escalation.** Starts when the room reaches the **Nash equilibrium**, and from then on the game gets harsher: players are eliminated one by one and each step adds a new rule.

- **Nash trigger.** After a round is revealed, if **every active player submitted exactly the range minimum (`0` by default)**, the equilibrium is reached. (Needs ≥ 2 active players. Phase B never ends once started; it is irreversible for that game.)
- **At the trigger:** announce "Nash equilibrium reached" and activate **Rule 1**. Phase B begins with the **next** round.
- **Every round in Phase B eliminates exactly one player** (see "Who is eliminated" below). **After each elimination, the next rule in the rule list is activated** (the first elimination activates **Rule 2**). Rules stay active once added (they accumulate).
- The game ends when **one active player remains** (the winner) or the host ends it. Eliminated players become spectators: they keep seeing the Portal-style view, cannot submit, and are ranked by elimination order (later out = higher rank).

**Rule list** (ordered, extensible; v1 ships these two):

| # | Rule | Effect |
|---|------|--------|
| 1 | **No duplicates** | Any value picked by **2 or more** players: all of those players **automatically lose the round** (cannot win it). Players whose pick is **unique** are eligible; the winner is the eligible player closest to the target. Duplicate picks **still count** in the average. |
| 2 | **Zero is beaten by 100** | If at least one player picked `0` **and** at least one picked `100` (range minimum / maximum), the player who picked `100` **definitely wins** the round, regardless of distance to the target. If several players picked `100` and Rule 1 is active, they are duplicates and lose, so this rule gives no winner and the round falls back to Rule 1 / base scoring. |

**Precedence when rules overlap:** Rule 2 outcome → Rule 1 filtering → base "closest to target". A rule never overrides one with a higher precedence.

**Who is eliminated** (one per Phase B round, never a winner of that round). Candidates are ordered worst-first by tiers:
1. Active players who did **not submit**.
2. Players who lost automatically through Rule 1 (duplicates), if Rule 1 is active.
3. All other non-winners.

Within a tier, the player with the **largest distance to the target** is eliminated. If still tied, pick **randomly with a stored seed**, and record the seed and the candidates in the round history so the outcome is auditable. Exactly one player is eliminated per round.

### Sources
- Wikipedia: <https://en.wikipedia.org/wiki/Keynesian_beauty_contest>
- Nagel (1995), "Unraveling in Guessing Games: An Experimental Study", *American Economic Review*.
- Classroom protocol: <https://en.wikiversity.org/wiki/Economic_Classroom_Experiments/Guessing_Game>
- Lecture notes with the Nagel histogram: <https://cs.brown.edu/courses/csci1440/lectures/2025/beauty_contest.pdf>

---

## 2. Roles and screens

| Role | Device | URL | Purpose |
|------|--------|-----|---------|
| **Player** | Phone (portrait) | `/` and `/play/[code]` | Join a game, submit a number, see own result |
| **Host** | Laptop | `/host/[code]` | Create the game, control rounds, see all data |
| **Portal** | Projector / big screen (16:9, 1920×1080) | `/portal/[code]` | Read-only spectator view of the live game |

The host opens the Portal in a second browser window and projects it. Host controls and the Portal are **separate pages**: the Portal must never show controls or anything the audience should not see (e.g. individual picks during the submission phase).

### 2.1 Player flow
1. Open the shared link (`/` or `/play/ABCD`). Enter the **game code** (4 uppercase letters) and a **display name** (max 20 chars, unique within the game; duplicates get rejected with a clear message).
2. Wait in lobby ("Waiting for host…").
3. When a round opens: see the rules reminder, a number input (slider + numeric field, `0–100`, step `0.1` by default, configurable), a **Submit** button, and a countdown if a timer is set. Submit is final unless the host enables "allow change until lock" (default: allowed until the round locks).
4. After submission: "Locked in ✓ — waiting for others". Show how many have submitted (count only).
5. After reveal: show own pick, the average, the target, the winner(s), own rank and distance to target.
6. Between rounds: cumulative score and leaderboard position.
7. In `ESCALATION`: the active rules are shown above the input at all times. If the player is eliminated they see an "Eliminated in round N" screen and become a spectator (no input).

Players can rejoin after closing the tab (session token stored in `localStorage`, tied to the display name). A player who loses connection must not lose their submitted pick.

### 2.2 Host flow
1. **Create game**: choose settings (see §3.3). Receive a game code, a player join link, a QR code, and a Portal link. No account system; the host is identified by a secret **host token** (random, ≥128 bits) stored in `localStorage` and in the host URL fragment so the host can reopen the page.
2. **Lobby**: see joined players live; can kick a player.
3. **Round control** (state machine, §3.1): `Open round` → (timer or manual) `Lock` → `Reveal` → `Next round` / `Finish game`.
4. Can edit the pick `p`, timer, and range **between** rounds only.
5. Can export results as CSV/JSON at any time after round 1.
6. Can **end the game** and show the final podium.

### 2.3 Portal (the projected screen) — the core requirement
Read-only, auto-updating, readable from the back of a room (large type, high contrast, minimum 28 px for secondary text at 1080p). Dark theme by default. No scrolling; everything fits one 16:9 viewport and scales with `vw`/`vh`. Designed so a player never needs to look at their phone to follow what is happening.

States and what the Portal shows:

| Game state | Portal content |
|------------|----------------|
| **Lobby** | Huge game code, join URL and **QR code**, live list/grid of joined player names animating in, player count. Short rules panel (the 4 steps from §1). |
| **Round open** | Round number, the rule ("Pick a number 0–100. Closest to **80% of the average** wins." (text derived from the configured `p`)), big **countdown** (if timer), live progress ring "23 / 31 submitted", and names of players who have submitted shown as ticks (**names only, never values**). |
| **Round locked** | "Picks are in!" with a short suspense animation (≈3 s, skippable by host). |
| **Reveal** | Animated sequence: (1) histogram of all picks builds up bin by bin on a 0–100 axis; (2) a vertical marker sweeps in for the **average**; (3) a second marker for the **target** (`p × average`); (4) winner(s) highlighted with name, pick and distance. Anonymous picks are shown as dots by default; the host can toggle "show names on reveal". |
| **Between rounds** | Leaderboard (top 10, cumulative points), plus a **trend chart** of average and target across rounds so far. |
| **Nash reached** | Full-screen dramatic announcement "Nash equilibrium reached — everyone chose 0", then a card revealing **Rule 1** with a short plain-language explanation and example. Held until the host advances. |
| **Escalation round** | Same as Round open/Reveal, plus a persistent **Active rules** sidebar (numbered cards for each rule in force), the **players remaining** counter, and eliminated players greyed out with their elimination round. Reveal sequence adds a step: highlight duplicates (Rule 1), show the `0` / `100` interaction (Rule 2), and finish with the **elimination moment** (name of the eliminated player, animated). The newly added rule is announced after the elimination. |
| **Final** | Podium (top 3), the all-rounds trend chart with a dashed line at the theoretical equilibrium `0`, and the **debrief panel**: "Level-k reasoning" explainer plotting where the room's picks fell relative to the level-k values `50 · pᵏ` (for `p = 0.8`: 50 / 40 / 32 / 25.6 / 20.5 … 0; see §3.5). |

Portal requirements:
- Updates within **≤ 2 s** of any state change (see §4.2 on transport).
- Reconnects silently after a network drop; shows a small "reconnecting…" badge, never a blank or error screen.
- Fullscreen friendly (hides cursor after 3 s idle; `F` key toggles fullscreen).
- Audience-safe: individual picks are **never** sent to the Portal client before the Reveal state (enforce on the server, not just in the UI).
- Works with up to **200 players** without layout breaking (name grid switches to compact mode / count only above ~60 names).

---

## 3. Functional requirements

### 3.1 Game state machine
```
LOBBY → ROUND_OPEN → ROUND_LOCKED → ROUND_REVEALED → (ROUND_OPEN | FINISHED)
```
- Transitions are triggered only by the host (or by the timer expiring for `ROUND_OPEN → ROUND_LOCKED`, evaluated server-side).
- Server is the single source of truth. Clients never compute results.
- All transitions are idempotent (repeated host clicks must not double-advance).
- Game also carries `phase: NORMAL | ESCALATION`, `activeRules: number[]`, and per-player `status: ACTIVE | ELIMINATED` (with `eliminatedInRound`). On `ROUND_OPEN → ROUND_LOCKED → ROUND_REVEALED` the server evaluates, in order: round result (§3.2 with rules), Nash trigger (if `NORMAL`), elimination (if `ESCALATION`) and rule activation. The `FINISHED` state is also entered automatically when one active player remains.
- Only `ACTIVE` players may submit picks and are counted in "N / M submitted".

### 3.2 Scoring and winner rules
- `average = mean(all valid picks)`; `target = p × average`.
- Winner = pick(s) with minimum `|pick − target|`. **Ties**: all tied players win and each gets full points (do not split randomly).
- In `ESCALATION`, apply the active rules from §1 with their precedence (Rule 2 → Rule 1 → base). Implement each rule as a pure function `(picks, ctx) → { winners?, disqualified? }` registered in an ordered rule list, so adding Rule 3+ needs no change to the state machine.
- Only `ACTIVE` players' picks enter the average. The average is computed **before** any rule filtering.
- Rule 1 compares picks after rounding to the configured step (so `12.0` and `12` are duplicates); exact decimal-safe comparison, no float epsilon.
- Players who did not submit in a round get no pick and 0 points; they are excluded from the average (do not auto-fill).
- Points per round (configurable): winner(s) `10`; optional "close call" bonus `3` for within 2 units of target; default scoring is winner-only. Cumulative score decides the leaderboard; ties on the leaderboard share rank.
- Picks are clamped/validated server-side to `[min, max]` and rounded to the configured step. Invalid input is rejected with a message, never silently altered.
- Use exact decimal-safe arithmetic (e.g. work in integers scaled by 10 or 100) so that results are deterministic and tie detection is reliable.

### 3.3 Game settings (host, at creation; some editable between rounds)
| Setting | Default | Notes |
|---------|---------|-------|
| `p` (multiplier) | `0.8` | Presets: `0.8`, `2/3`, `1/2`, `4/3` (the `>1` variant has interesting dynamics; equilibrium is 0 *or* the max), custom |
| Range | `0–100` | Integers or decimals (`step` 1, 0.1, 0.01) |
| Rounds (Phase A) | `3` | 1–10; "unlimited until host ends" option. The game stays in Phase A until the Nash trigger or the round limit (then the host may end the game or force Phase B) |
| Nash trigger | `all active players pick the range minimum` | Host can disable Phase B entirely |
| Rule list | `[1, 2]` | Rules activated in order: Nash → Rule 1, then one more rule per elimination |
| Timer per round | `60 s` | `off` allowed |
| Allow changing pick until lock | on | |
| Show names on reveal | off | |
| Points for win / close-call bonus | `10` / `0` | |
| Max players | `200` | |

### 3.4 Players, identity, abuse
- No login. Identity = (game code, display name) + a random player token in `localStorage`.
- One pick per player per round. Re-submission replaces the previous pick until lock if allowed.
- Basic profanity-agnostic safety: strip HTML, trim, collapse whitespace; render names as text only (no HTML injection into Portal).
- Rate-limit join and submit endpoints per IP and per token.
- Games expire automatically **24 h after the last activity**.

### 3.5 Debrief analytics (final screen and host dashboard)
Computed from stored data:
- Histogram of all picks per round and combined.
- Average and target per round (trend chart; shows convergence toward 0 if it happens).
- **Level-k classification** (informational): bin each first-round pick into the nearest level `Lk = 50·pᵏ` for the configured `p`. For the default `p = 0.8`: `L0 = 50` (random/naive), `L1 = 40`, `L2 = 32`, `L3 = 25.6`, `L4 = 20.5`, `L5 = 16.4`, … down to `≈ 0` (equilibrium). Compute levels from `p`; never hard-code them. Show the share of the room at each level as a bar chart.
- Share of players who picked exactly `0`, exactly `50`, and `> 100·p` (`> 80` for the default; strictly dominated because the target can never exceed `100·p` — show as "dominated picks").
- Compare the room's first-round average with reference values (≈ 36 in Nagel-style lab results; ≈ 40 business audiences; ≈ 25–30 economics experts — all for `p = 2/3`) as small footnote text labelled "typical results for p = 2/3", shown only when `p = 2/3`, not as exact claims.

### 3.6 Host dashboard extras
- Live table of players with submitted/not-submitted per round (host sees picks only after lock).
- Export: `results.csv` (player, round, pick, distance, points) and `game.json` (full state).
- "Reset game" returns to LOBBY keeping players; "End game" goes to FINISHED.

---

## 4. Technical requirements

### 4.1 Stack
- **Next.js (App Router) + TypeScript**, deployed on **Vercel**. Tailwind CSS for styling. Charts via a lightweight library (e.g. Recharts or visx) or hand-rolled SVG — the reveal animation should be SVG/CSS (e.g. Framer Motion), not a canvas screenshot.
- **State store: Upstash Redis** (Vercel Marketplace / Vercel KV-compatible). Chosen because Vercel serverless functions are stateless and have no persistent WebSocket support. Keep a thin `Store` interface (`getGame`, `mutateGame`, …) so the backend can be swapped (e.g. Supabase) without touching game logic.
- Pure game logic (state machine, scoring, level-k bins) lives in `src/lib/game/` with **no framework or I/O imports** so it is fully unit-testable.
- Node ≥ 20, `npm`.

### 4.2 Real-time transport
Vercel functions cannot hold long-lived WebSocket connections, so:
- Clients (Portal, Host, Players) **poll** `GET /api/games/[code]/state?role=…&v=<version>` every **1 s** (Portal/Host) and **2 s** (Players) with `ETag` / version so unchanged state returns `304` cheaply. Add jitter ±200 ms to avoid thundering herd with 200 players.
- Each game carries a monotonically increasing `version`.
- Pause polling when the tab is hidden (players only; **never** pause the Portal).
- The role determines which **projection** of the state the server returns (see §4.4).
- If time allows, an SSE upgrade path is acceptable but polling must remain the fallback.

### 4.3 API (all JSON, under `/api`)
| Method & path | Auth | Purpose |
|---------------|------|---------|
| `POST /games` | none | Create game → `{ code, hostToken }` |
| `POST /games/[code]/join` | none | `{ name }` → `{ playerToken }` |
| `GET /games/[code]/state` | role query + token | Role-specific projection of state |
| `POST /games/[code]/pick` | player token | `{ round, value }` |
| `POST /games/[code]/host/[action]` | host token | `open`, `lock`, `reveal`, `next`, `finish`, `reset`, `settings`, `kick` |
| `GET /games/[code]/export` | host token | CSV / JSON |

- Portal access needs only the game code (it is public, read-only, and receives the audience-safe projection).
- Validate every body with a schema validator (e.g. Zod). Return structured errors `{ error: { code, message } }`.
- Concurrency: use Redis atomic operations or optimistic versioning (`WATCH`/Lua) so concurrent picks and host transitions cannot corrupt state.

### 4.4 Data projections (security-critical)
| Role | Receives |
|------|----------|
| Portal | Game settings, state, player names, **submitted flags**, counts; picks/aggregates **only** in `ROUND_REVEALED` and `FINISHED` |
| Player | Same as Portal plus their **own** pick at all times |
| Host | Everything, but other players' picks only after `ROUND_LOCKED` |

Tests must assert that a Portal or Player response during `ROUND_OPEN` contains no other player's pick value.

### 4.5 Non-functional
- 200 concurrent players, 1 s polling ⇒ ~200–250 req/s peak: responses must be small (< 5 KB typical, gzip) and cheap (one Redis read). Use CDN-uncacheable but `ETag`-based 304s.
- Mobile-first for the Player UI (≥ 360 px wide, large tap targets, no zoom on input focus: font-size ≥ 16 px). Portal is desktop-only, 16:9.
- Accessibility: sufficient contrast (WCAG AA), `aria-live` for status changes on the Player view, no information conveyed by color alone on the Portal.
- i18n: all UI strings in a dictionary; ship **Vietnamese (default)** and **English**, switchable on the host page and per player.
- No analytics, no third-party trackers, no personal data beyond a chosen display name.

---

## 5. Suggested project layout
```
.
├─ src/
│  ├─ app/
│  │  ├─ page.tsx                 # Join screen
│  │  ├─ play/[code]/page.tsx     # Player
│  │  ├─ host/page.tsx            # Create game
│  │  ├─ host/[code]/page.tsx     # Host console
│  │  ├─ portal/[code]/page.tsx   # Projected screen
│  │  └─ api/games/...            # Route handlers (§4.3)
│  ├─ lib/
│  │  ├─ game/                    # Pure logic: state machine, scoring, levelK
│  │  ├─ store/                   # Store interface + Upstash implementation + in-memory (tests/dev)
│  │  └─ i18n/
│  └─ components/                 # Histogram, Podium, Countdown, QR, Leaderboard, TrendChart …
├─ tests/                         # Vitest unit + API tests; Playwright for the full flow
├─ docs/decisions.md
└─ README.md
```

## 6. Environment and deployment
```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
NEXT_PUBLIC_BASE_URL=        # used for the join link and QR code
```
- Local dev must work with **no external services** using the in-memory store (`STORE=memory`).
- Deploy: push to GitHub, import the repo in Vercel, attach an Upstash Redis integration, set env vars. No build-time secrets beyond those above.
- Add `npm run dev`, `npm test`, `npm run lint`, `npm run build` scripts.

## 7. Acceptance criteria
1. Host creates a game, a second browser (Portal) and ≥ 3 simulated phones join; lobby shows names live on the Portal within 2 s.
2. Full round: open → picks → lock → reveal produces the correct average, target and winner(s), verified by unit tests including ties, no-shows, `p = 0.8` (default), `p = 2/3`, `p = 1/2`, `p = 4/3`, decimal steps.
   - Escalation: Nash trigger fires only when all active players picked the minimum; Rule 1 (duplicates lose, including a three-way duplicate, duplicates still counted in the average); Rule 2 (`0` + single `100` → `100` wins; `0` + two `100`s with Rule 1 active → fallback); precedence Rule 2 → Rule 1 → base; exactly one elimination per Phase B round and never a winner; elimination tiers (non-submitter, then duplicate, then largest distance) and seeded tie-break; the game ends when one active player remains; eliminated players cannot submit.
3. During `ROUND_OPEN`, network inspection of Portal and other Players' responses reveals **no** pick values (automated test).
4. Closing and reopening a Player or Host tab restores the session; Portal survives a 30 s offline period and resyncs.
5. 200 simulated players (script in `tests/load/`) complete a round with p95 state-poll latency < 500 ms.
6. Final screen shows leaderboard, convergence chart, and the level-k debrief.
7. `npm run build` passes and the app runs on Vercel with Upstash; `STORE=memory npm run dev` runs offline.

## 8. Out of scope (v1)
Accounts and persistent profiles, payments, multi-host/co-host, video/voice, moderation dashboards, native apps, long-term game history beyond the 24 h expiry.

## 9. Nice-to-have (v2)
Sound effects on reveal; team mode; "predict the average" side question; replay of a finished game; other guessing-game variants (e.g. Keynes's original "pick the most popular option" with multiple-choice answers).

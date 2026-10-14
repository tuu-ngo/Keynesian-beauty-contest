# Frontend specification

> Status: proposed MVP UI specification
>
> Scope: Player, Host, and Portal clients for one persistent room.
>
> Source of truth: [contracts.md](../contracts.md) and [decisions.md](../decisions.md). If a UI detail conflicts with either document, those documents win.

## 1. Product read and boundaries

**Design read:** A live classroom game application for players, facilitators, and a projected audience, with a calm, high-contrast, game-show language built with Tailwind CSS variables and restrained, state-led motion.

This is an operational game interface, not a marketing site. The frontend applies the design skill's typography, colour, accessibility, responsive-layout, and state-feedback guidance. It does not use landing-page conventions such as a promotional hero, logo wall, decorative imagery, or scroll storytelling.

### Design dials

| Dial | Value | Reason |
| --- | ---: | --- |
| `DESIGN_VARIANCE` | 5 | A clear app shell comes first. Portal can use an asymmetric composition without compromising scanability. |
| `MOTION_INTENSITY` | 3 | Motion communicates a saved pick, timer urgency, and a newly revealed result. It must never distract from a live round. |
| `VISUAL_DENSITY` | 6 | Host and Portal need to surface live information, while Player remains focused and touch-friendly. |

### Product constraints

- The MVP has exactly one language: **English**. There is no locale picker, locale route segment, or runtime language switcher.
- User-facing strings, validation errors, loading text, empty states, and accessible labels are English.
- Keep a single English message catalog if centralising copy. Do not maintain a parallel Vietnamese catalog for the MVP.
- The game server is authoritative. The browser displays projections and sends commands. It never calculates winners, elimination, Nash, or access rights.
- The UI is built for up to 50 concurrent polling clients in the MVP. It must remain usable with a long roster and collapse gracefully on a phone.

## 2. Information architecture

| Route | Audience | Purpose |
| --- | --- | --- |
| `/` | Player | Redirect to `/login`, or to `/play/[code]` when a valid restored player session identifies one current room. |
| `/login` | Player | Player sign-in with room code and seeded account credentials. |
| `/play/[code]` | Player | Personal game experience: lobby, pick submission, result, spectator state, and final result. |
| `/host` | Host | Host sign-in, then first-time room creation or redirect to the active room console. |
| `/host/[code]` | Host | Authenticated room control console, including settings, commands, roster, export, and reset. |
| `/portal/[code]` | Public audience | Fullscreen 16:9 public display. Shows QR join, lobby, live progress, revealed results, and leaderboards. |

`/login` is the player login route. Host authentication belongs only to `/host`. Any legacy login route should redirect according to this table after migration.

### Navigation rules

- Player pages show the game code, player display name, and a compact `View portal` link. They do not show Host controls.
- The Host console has a single-line desktop top bar: room code, portal link, archive/export menu, and sign out.
- The Portal has no conventional navigation. It is a read-only screen with a keyboard-accessible fullscreen control and a visible recovery status only when reconnecting.
- Do not add a public landing page or a role-selection page. The sign-in and Host routes are the entry points.

## 3. Shared visual system

### Theme and tokens

Use CSS custom properties for a single semantic token system. Respect `prefers-color-scheme` and provide an in-app theme toggle only if testing shows the Portal needs a fixed presentation theme. The page remains in one theme at a time. Do not invert arbitrary sections.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--surface` | `#F6F8FB` | `#111827` | Application background |
| `--surface-raised` | `#FFFFFF` | `#182235` | Forms, dialogs, important panels |
| `--surface-subtle` | `#E8EEF4` | `#223047` | Selected or supporting surfaces |
| `--text` | `#172033` | `#F1F5F9` | Primary text |
| `--text-muted` | `#526174` | `#AAB8CA` | Supporting text |
| `--border` | `#C9D4E0` | `#33445F` | Inputs and structural separators |
| `--accent` | `#006B5D` | `#36C5A8` | Primary action, focus ring, selected state |
| `--danger` | `#B42318` | `#FF8C82` | Destructive action and error state |

`--accent` is the only brand accent. Status meaning must also be present in text or iconography, not encoded by colour alone. Team colours come from the seeded `Team.color` data and are data visualisation values, not page accents.

### Typography and shape

- Use `Geist` through `next/font` for UI text and `Geist Mono` only for codes, values, countdowns, and compact telemetry.
- Use a type scale of 14, 16, 20, 28, 40, and 56px. Portal may use fluid `clamp()` values inside its fixed 16:9 presentation layout.
- Use 16px radius for panels, 12px for inputs and buttons, and fully rounded only for compact status chips and avatars. Do not mix arbitrary radii.
- Body text meets WCAG AA contrast. Large Portal metrics target AAA contrast against their background.
- Never rely on a glowing effect, a gradient headline, or a decorative grid to establish hierarchy.

### Core interaction patterns

- Primary buttons use accent background with high-contrast text, have a minimum 44px target, and depress by `translateY(1px)` or `scale(0.98)` on active.
- Labels sit above every input. Placeholder text is an example, never the label.
- Use inline error text directly below its relevant control. Use a toast only for transient confirmation after a successful action.
- Loading placeholders mirror the final layout. Do not use a blocking spinner for a full page that already has cached data.
- Error and empty states preserve the page frame and offer the next useful action, such as `Try again`, `Return to sign in`, or `Refresh state`.
- At `MOTION_INTENSITY: 3`, only opacity and transform transitions are permitted. Respect `prefers-reduced-motion` by rendering changes immediately.

### Responsive rules

| Surface | Primary viewport | Responsive behaviour |
| --- | --- | --- |
| Player | 360px and above | Single column. Fixed actions remain above the mobile browser edge using safe-area padding. |
| Host | 1024px and above | Two-column console at desktop. Collapse to a single column below 768px. Command controls stay at the top. |
| Portal | 16:9 desktop display | Fixed no-scroll canvas. Below 1024px, preserve all essential states in a safe scaled layout but show a small `Best viewed fullscreen` hint. |

Use `min-h-[100dvh]`, never `h-screen`, for browser clients. Multi-column regions become `grid-cols-1` below `md`. No function depends on hover alone.

## 4. Shared state, transport, and security

### Projection contract

All screens consume the discriminated `StateResponse` from:

```text
GET /api/room/state?code={CODE}&view=public|player|host
```

The selected `view` is intentional data scope, not permission evidence. Authentication is validated server-side before a `200` or `304` response.

| Client | Allowed private fields | Explicitly forbidden before reveal |
| --- | --- | --- |
| Portal | None | Any individual pick, average, target, or host-only data |
| Player | Its own current pick and own status | Other players' current picks |
| Host | Submission state during open round; named picks only after lock | Named picks while round is open |

Never fetch a more privileged projection and hide fields only in React. The network response itself must be safe for the viewer.

### Polling client

Create one shared `useRoomState` client hook, parameterised by `code` and `view`.

1. Keep the latest `ETag` per `code`, `view`, and `runId`.
2. Request every second plus a small random jitter. Send `If-None-Match` when an ETag is available.
3. Allow only one request in flight. Abort an obsolete request when `code`, `view`, or authenticated player token changes.
4. A `304` keeps current data without causing a loading flash. A `200` atomically replaces the projection and ETag.
5. Refetch immediately when the tab becomes visible or the browser comes back online. Player may pause the interval while hidden. Host and Portal do not pause while open.
6. On a transient error, retain the last safe projection, mark the connection as reconnecting, and retry with capped exponential backoff. Do not replace the screen with an error page.
7. Use `serverNow` and `deadlineAt` to render countdowns. The browser countdown is illustrative only. The next server response determines whether a round is actually locked.

The hook must not use `window.addEventListener("scroll")`, continuous React state for animation values, or overlapping intervals.

### Mutation behaviour

- Player pick requests carry `runId`, `round`, `value`, and a per-submission `requestId`.
- Host commands carry a new `commandId` and the displayed `expectedVersion`.
- Disable only the control being submitted. Keep other read-only information available.
- On `409 VERSION_CONFLICT`, refresh the projection, explain that game state changed elsewhere, and derive the next action from the refreshed status. Never retry a Host command silently with a new version.
- On a run change after reset, Player uses its retained token to call `POST /api/room/join` with the new `runId`, then lands in the new lobby. A post-lock join error is explained plainly.
- Treat `401`, `403`, `404`, `410 RUN_EXPIRED`, and `429` as distinct messages. Do not expose server internals.

## 5. Player sign-in: `/login`

### Purpose

Authenticate a player from the seeded roster and enter the correct run without exposing roster credentials or a player token in the URL.

### Layout

Use an asymmetric but quiet two-part desktop layout:

```text
┌───────────────────────────┬────────────────────────────────┐
│ Game identity and rule    │ Sign-in form                    │
│ One-sentence explanation  │ Room code                       │
│ Link: Host sign in        │ Username                        │
│                           │ Password                        │
│                           │ [Join game]                     │
└───────────────────────────┴────────────────────────────────┘
```

On mobile, form content appears first, followed by the concise rule explanation and Host link. Do not use a hero illustration or a decorative product mockup.

### Form and flow

| Element | Requirement |
| --- | --- |
| Room code | Required. Four uppercase letters. Auto-uppercase visually but validate on submit. A portal QR pre-fills this field through `?code=ABCD`. |
| Username | Required seeded account name. Trim whitespace. Use `autocomplete="username"`. |
| Password | Required. Use `autocomplete="current-password"`. Never persist it. |
| Submit | Label: `Join game`. Disabled only while request is active. |
| Host link | Label: `Host sign in`. Routes to `/host`. |

Submit calls `POST /api/room/login`. Store only the opaque player token in local storage, scoped by room code. Then navigate to `/play/[code]`. If a valid scoped token already exists, attempt the player projection first and skip the password form only after the server confirms it.

### States

- **Initial:** Focus on Room code. Explain, in one line, `Choose a number closest to the target based on the group's average.`
- **Invalid credentials:** Inline message: `We could not sign you in. Check the room code, username, and password.`
- **Roster locked:** Explain that only participants who joined before round one can return to the game. Keep the portal link available.
- **Network failure:** Keep field values. Offer `Try again`.
- **Expired run:** Explain that this game is no longer available and link to the portal only when its public state is still available.

## 6. Player experience: `/play/[code]`

### Persistent frame

The Player screen is a focused mobile-first column, maximum 640px wide. It includes:

- a compact header with game code, display name, and connection state;
- a state-specific main panel;
- a small team attribution using the team name and optional team colour;
- a polite `aria-live` region for state transitions, pick saved feedback, lock notices, and elimination;
- a text link to the public Portal in a new tab.

Do not show a running list of other players' pick values, even if local UI state accidentally receives them. The player projection should not contain them.

### State matrix

| Server status | Main content | Player action |
| --- | --- | --- |
| `LOBBY` | Joined confirmation, team, number of participants, and waiting message | No game action. Player can refresh or open Portal. |
| `ROUND_OPEN` and active | Round number, exact rule text, countdown, submitted count, numerical picker, saved-pick state | Save or update own pick. |
| `ROUND_OPEN` and eliminated | Spectator notice, submitted count, countdown | No pick control. |
| `ROUND_LOCKED` | Pick lock acknowledgement and last saved own pick | Wait for result. |
| `ROUND_REVEALED` | Average, target, own pick, own points, winner names, elimination result, rules in force | Review result. |
| `FINISHED` | Final placement, individual rank, team result, final summary | Open Portal or wait for a reset. |

### Pick interaction

The number picker consists of one visible `number` input plus increment and decrement buttons. It enforces the displayed round settings, such as 0 to 100 at 0.1 increments. A range input may be provided as an enhancement, but the number input is the accessible source of truth.

| Condition | UI response |
| --- | --- |
| No pick saved | Primary button: `Save pick` |
| Pick saved and still open | Confirmation: `Your pick is saved. You can update it until the round is locked.` Primary button: `Update pick` |
| Invalid step or range | Inline error below the input. Do not round automatically. |
| Deadline passed locally | Disable the action and state `Time is up. Waiting for the game to lock.` The server remains authoritative. |
| Request pending | Keep the selected value visible. Disable the save button and announce `Saving pick`. |
| Server rejects pick | Keep the entered value and show the server-safe reason. Refetch state. |

The public submitted count may update as other players submit. It communicates participation but never reveals who chose which value.

### Result content

Use a vertical hierarchy rather than a dense table:

1. `Round N result` heading.
2. Paired metrics for average and target. Show `No valid picks` when a metric is null.
3. Personal result: own pick, points earned, and outcome.
4. Winners and any newly active rules.
5. Elimination notice when applicable. An eliminated player remains a spectator and can still read future revealed results.

If the server marks `escalationReason` as `NASH`, say `The group reached Nash equilibrium. Escalation rules apply next round.` If it is `HOST`, say `The host started escalation. Escalation rules apply next round.` These messages must not be conflated.

## 7. Host entry and console

### `/host`: sign-in and room creation

Host authentication uses the secure, HttpOnly Host cookie. The initial Host page has two server-determined modes:

| Mode | Content | Action |
| --- | --- | --- |
| Signed out | Username and password form | `Sign in` posts to `/api/host/login`. |
| Signed in, no room | Seed readiness summary, room creation action | `Create room` posts to `/api/room`. |
| Signed in, room exists | Brief loading state | Redirect to `/host/[code]`. |

Room creation does not expose seeded passwords. If seed validation fails, show a plain error with the invalid data category and a link to operator documentation. Do not show raw SQL or credentials.

### `/host/[code]`: console layout

Host uses a responsive app shell rather than a dashboard card wall:

```text
┌───────────────────────────────────────────────────────────────────┐
│ Room ABCD  |  Lobby  |  Open Portal  |  Export  |  Sign out       │
├───────────────────────┬───────────────────────────────────────────┤
│ Command rail          │ Live room view                            │
│ Current legal action  │ Roster and team summaries                 │
│ Settings for next round│ Round information and result explanation │
└───────────────────────┴───────────────────────────────────────────┘
```

Below 768px, command rail appears before live data. The current legal command remains within the first viewport. On desktop, the top bar remains one line and no more than 72px high.

### Command rail

Render only commands legal for the current status. Labels use player-facing verbs, not API enum names.

| Status | Primary action | Secondary actions |
| --- | --- | --- |
| `LOBBY` | `Open round` | Edit next-round settings, reset only if a run needs replacement |
| `ROUND_OPEN` | `Lock round` | None |
| `ROUND_LOCKED` | `Reveal result` | None |
| `ROUND_REVEALED`, normal | `Open next round` | `Start escalation`, `Finish game`, edit next-round settings |
| `ROUND_REVEALED`, escalation | `Open next round` | `Finish game`, edit next-round settings |
| `FINISHED` | `Start new run` | Export current or archived run |

`Finish game` and `Start new run` require a confirmation dialog that names the effect. The dialog uses a native accessible dialog primitive or an installed accessible component primitive. It has a clear cancel action and focuses the least-destructive option first.

### Console content

#### Live roster

- Group players by team, showing participant count, active count, submitted count, total points, and eliminated players.
- In `ROUND_OPEN`, show only submitted or not submitted state for each active player. Do not show their values.
- After `ROUND_LOCKED`, reveal named picks in the Host-only round detail and preserve them through result review.
- Use compact rows with team colour as a supplemental marker. Text states such as `Submitted`, `Not submitted`, `Active`, and `Eliminated` remain visible.
- With a long roster, use team sections with collapsible details, not a large scrollable nested card collection.

#### Settings for the next round

Show these controls only in `LOBBY` and `ROUND_REVEALED`:

- Target multiplier: `80%`, `2/3`, or `1/2` of the average.
- Timer: 60 seconds by default or off.
- Clear helper text: `Changes apply to the next round. The open round keeps its saved settings.`

The UI only offers values in the MVP contract. It does not offer free-form `p`, a new player cap, or a custom range.

#### Result and analytics

After a reveal, show the just-revealed round first:

- average and target;
- winners, points, and elimination;
- rules currently in force and whether escalation was Nash-triggered or Host-triggered;
- anonymous histogram of revealed picks;
- simple trend chart of revealed average and target over rounds;
- individual and team leaderboard summaries.

Charts must have a textual summary and an accessible table or list alternative. They must not imply accuracy before a result is revealed.

#### Archive and export

The export menu lists the current run and unexpired archive entries from `GET /api/room/archives`. A Host chooses CSV or JSON explicitly. The UI shows `Expired` for `410 RUN_EXPIRED` and does not offer a fake download.

## 8. Portal: `/portal/[code]`

### Purpose and presentation

Portal is a public, read-only, 16:9 presentation surface. It must work well from a projector or shared screen, update in no more than two seconds under normal polling, and never reveal unrevealed picks.

The page uses a dark presentation theme with the same teal accent token. It has no vertical scrollbars, no mouse-dependent controls, and no hidden controls required for comprehension. `F` toggles fullscreen when browser permission allows; the explicit fullscreen button remains focusable. The cursor may fade after inactivity but returns on movement or keyboard use.

### Structural layout

```text
┌───────────────────────────────────────────────────────────────────┐
│ Keynesian Beauty Contest            Game ABCD       Connection    │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│                    State-specific main stage                      │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│ Round / active players / submitted count          Team standings  │
└───────────────────────────────────────────────────────────────────┘
```

The stage layout changes by game state. The fixed header and footer preserve orientation for the audience. The Portal is not a static page that requires scrolling to find a result.

### Lobby view and QR code

Lobby is the audience onboarding state. It must include all of the following:

- an actual QR code encoding `${NEXT_PUBLIC_BASE_URL}/login?code={CODE}`;
- the room code in large selectable text as a non-camera alternative;
- a concise English instruction: `Scan to sign in with your roster account.`;
- a live participant total and team-aware roster;
- the game rule using the configured next-round multiplier;
- a waiting message: `The host will open the first round when everyone is ready.`

The QR code has high contrast, a fixed quiet zone, an accessible text alternative containing the destination URL, and a responsive minimum rendered size of 200px on a presentation display. Generate it from the actual public URL at runtime or server render. Never use a decorative placeholder QR image.

For up to about 60 participants, render display names grouped by team. Above that threshold, show team totals and a compact participant count by default, with no attempt to force all names into unreadable columns.

### Open round view

- Dominant content: round number, exact multiplier rule, and server-clock countdown when a deadline exists.
- Supporting content: `N of M submitted`, with a live roster state that shows submitted status but no values.
- If the timer is off, replace the countdown with `No time limit` rather than an empty area.
- When a player is eliminated, roster treatment changes from `Active` to `Eliminated`; it must remain legible without relying on muted colour alone.

### Locked view

Show a clear state transition: `Picks are locked.` Explain that the result will be revealed by the Host. Retain submitted count and roster, but show no current values, average, target, or predictive chart.

### Revealed result view

Use the full stage for the outcome:

1. Large paired average and target metrics.
2. Winner name or names, including their revealed values and points.
3. An anonymous histogram of revealed values, labelled with axes and a textual summary.
4. The player eliminated in escalation, if any.
5. A short rule notice when Rule 1 or Rule 2 applies next round.
6. A small average and target trend chart after two or more revealed rounds.

Reveal motion is allowed only as a single opacity and scale transition from locked state to results. It exists to acknowledge a state transition. Under reduced motion, render the final state immediately. Do not animate individual participant picks before the result is safe to render.

### Escalation and final views

- **Nash escalation:** show `Nash equilibrium reached` and explain that Rule 1 begins next round.
- **Host escalation:** show `Escalation started by host` and the same next-round rule statement. Do not call it Nash.
- **Finished:** show the final individual podium as ordered text, a team leaderboard, and a final message. Individual final placement is based on survival when escalation completes, or score ranking if Host finishes early.

### Leaderboards

Both leaderboards are public after their projection is available.

| Leaderboard | Rows | Required fields |
| --- | --- | --- |
| Individual | Top five at a glance, then compact continuation when needed | Rank, display name, team, total points, active or eliminated state, final placement when available |
| Team | All teams | Rank, team name, total points, tied rank where applicable |

Use numerical rank and points as text, not colour or bar length alone. Teams tied on points share a rank. Highlighting the current winner does not remove the remaining rows.

## 9. Component boundaries

Use Server Components for page frames and Client Components only where browser state, input, polling, mutation, fullscreen, or motion is required.

```text
src/
  app/
    login/page.tsx
    play/[code]/page.tsx
    host/page.tsx
    host/[code]/page.tsx
    portal/[code]/page.tsx
  components/
    room/
      room-state-provider.tsx
      use-room-state.ts
      connection-status.tsx
      countdown.tsx
    player/
      player-login-form.tsx
      player-lobby.tsx
      pick-form.tsx
      player-result.tsx
    host/
      host-login-form.tsx
      room-create.tsx
      command-rail.tsx
      roster-by-team.tsx
      next-round-settings.tsx
      export-menu.tsx
    portal/
      portal-stage.tsx
      join-qr.tsx
      portal-lobby.tsx
      portal-progress.tsx
      reveal-stage.tsx
      leaderboard-panel.tsx
      histogram.tsx
      trend-chart.tsx
  lib/
    api/room-client.ts
    i18n/en.ts
    formatters.ts
```

`use-room-state.ts` owns transport lifecycle, ETag handling, reconnect state, and projection replacement. Role components consume its typed result. A Portal component must accept only `PublicProjection`; a Player component only `PlayerProjection`; a Host component only `HostProjection`. This boundary prevents accidental use of privileged fields.

Use icons from one installed library only. The current dependency set does not include an icon package, so implementation must either use accessible text controls or install one approved icon package before importing it. Do not hand-draw SVG icons.

## 10. Accessibility requirements

- Keyboard access reaches every input, action, QR link alternative, dialog, export option, and fullscreen control in a logical order.
- Visible focus uses the accent token with a high-contrast outline. Focus is never removed without an equivalent replacement.
- Player state changes use a concise polite live region. Destructive Host dialog opening and completion receive explicit announcements.
- Countdown output is not announced every second. Announce at meaningful thresholds such as 30 seconds, 10 seconds, and expiry, plus the actual locked status from the server.
- Every chart has a semantic title, axes or labels, and a text alternative that conveys the key conclusion.
- Team colour, submitted status, winner state, and error state always have a text label or icon with accessible name.
- Form controls have labels, associated errors, and `aria-describedby` for supporting text.
- The Portal must be understandable from a distance. Do not rely on fine text smaller than 18px at its intended display scale.

## 11. Error, loading, and empty-state copy

All copy below is English and should be stored in the single English catalog.

| Situation | Copy | Action |
| --- | --- | --- |
| State loading | `Loading game state` | Use layout-shaped skeletons. |
| Reconnecting | `Reconnecting. Showing the latest confirmed state.` | Retry automatically. |
| Player token missing | `Sign in to join this game.` | `Go to sign in` |
| Room not found | `We could not find this game.` | `Go to sign in` |
| Run expired | `This game is no longer available.` | Host sees `Start new run`; public users see portal return guidance. |
| No participants in lobby | `No players have joined yet.` | Host can keep the portal open. |
| No valid picks revealed | `No valid picks were submitted this round.` | Show no average or target. |
| No winner | `No eligible winner this round.` | Explain active escalation rules when relevant. |
| Version conflict | `Game state changed in another session. The latest state is now shown.` | Derive next command from refreshed state. |
| Rate limit | `Too many requests. Please wait a moment and try again.` | Do not retry mutations automatically. |

## 12. Acceptance criteria

### Role and privacy

- A Player can sign in with code, username, and password, restore a valid token, and rejoin the next lobby after reset.
- Portal and Player network payloads during `ROUND_OPEN` contain no other player's pick, average, target, or Host-only data.
- Host sees named picks only after `ROUND_LOCKED`.
- A player cannot submit after lock, deadline, elimination, or a run change.

### Player and Host workflow

- Player can save and update an exact 0.1-step pick before lock and receives clear feedback.
- Host can create the single room after sign-in, alter only next-round settings at legal times, drive every valid state transition, finish, reset, and export.
- A stale Host command refreshes safely after `409 VERSION_CONFLICT` and never causes an unreviewed repeat action.

### Portal workflow

- Lobby renders an actual join QR code, room code, team-aware roster, and live participant count.
- Open and locked Portal states show no current pick values.
- Reveal displays result metrics, an anonymous histogram, winners, escalation or elimination, and leaderboards without scrolling on 16:9.
- Nash and Host-initiated escalation use different copy.
- Portal retains the last confirmed screen while reconnecting and returns to current state within two seconds under normal conditions.

### Quality gates

- Every page supports system light and dark preference, except the intentionally fixed Portal presentation theme.
- Player is usable at 360px width with 44px touch targets and 16px input text.
- Host and Portal are keyboard reachable and meet the accessibility requirements in section 10.
- Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` after implementation.
- Add component tests for every status and projection type, plus browser tests for player sign-in, pick update, lock, reveal, escalation, finish, reset, QR login prefill, and export.

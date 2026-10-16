"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { PlayerProjection } from "@/contracts";
import { RoomClientError, authHeaders, getPlayerToken, removePlayerToken, roomRequest, stateUrl } from "@/lib/api/room-client";
import { decimal, ruleSentence, teamEscapeNotice, tenths } from "@/lib/formatters";
import { ConnectionStatus, Countdown, Metric, ScreenSkeleton, TeamMark } from "@/components/room/room-ui";
import { useRoomState } from "@/components/room/use-room-state";

function teamFor(game: PlayerProjection, teamId: string) {
  return game.teams.find((team) => team.id === teamId);
}

function latestResult(game: PlayerProjection) {
  return game.revealedRounds.at(-1) ?? null;
}

export function PlayerClient({ code }: { code: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  useEffect(() => { setToken(getPlayerToken(code)); setTokenReady(true); }, [code]);
  const room = useRoomState({ code, view: "player", playerToken: token });
  const { data, error, connection, refresh } = room;
  const [announcement, setAnnouncement] = useState("");
  const lastRun = useRef<string | null>(null);
  const activeRunId = data?.runId;
  const errorCode = error?.problem.code;

  useEffect(() => {
    if (!activeRunId) return;
    if (lastRun.current && lastRun.current !== activeRunId && token) {
      void roomRequest<{ joined: boolean }>("/api/room/join", { method: "POST", headers: authHeaders(token), body: { runId: activeRunId } })
        .then(() => { setAnnouncement("A new run has started. You are back in the lobby."); void refresh(); })
        .catch(() => setAnnouncement("A new run has started. Refresh to join its lobby."));
    }
    lastRun.current = activeRunId;
  }, [activeRunId, refresh, token]);

  useEffect(() => {
    if (errorCode !== "FORBIDDEN" || !token) return;
    let active = true;
    void fetch(stateUrl(code, "public"), { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ runId: string }> : null)
      .then((projection) => projection && roomRequest("/api/room/join", { method: "POST", headers: authHeaders(token), body: { runId: projection.runId } }))
      .then((joined) => { if (joined && active) { setAnnouncement("A new run has started. You are back in the lobby."); void refresh(); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, [code, errorCode, refresh, token]);

  if (!tokenReady) return <ScreenSkeleton />;
  if (token === null) return <main className="app-page empty-state"><p>Enter your name to join this game.</p><Link className="button button--primary" href={`/login?code=${code}`}>Join game</Link></main>;
  if (error?.problem.status === 401) {
    removePlayerToken(code);
    return <main className="app-page empty-state"><p>Enter your name to join this game.</p><Link className="button button--primary" href={`/login?code=${code}`}>Join game</Link></main>;
  }
  if (!data && error?.problem.status === 404) return <main className="app-page empty-state"><p>We could not find this game.</p><Link className="button button--primary" href="/login">Join another game</Link></main>;
  if (!data && error?.problem.status === 410) return <main className="app-page empty-state"><p>This game is no longer available.</p><Link className="button button--primary" href={`/portal/${code}`}>Open Portal</Link></main>;
  if (!data) return <ScreenSkeleton />;
  const game = data;
  const player = game.players.find((item) => item.username === game.self.username);
  const team = player ? teamFor(game, player.teamId) : undefined;

  return <main className="player-page">
    <header className="player-header">
      <div className="player-header__identity"><span className="eyeline">Game {game.code}</span><strong>{player?.displayName ?? game.self.username}</strong></div>
      <div className="player-header__status"><span className="player-points" aria-label={`${game.self.totalPoints} points available`}><small>Points</small><b>{game.self.totalPoints}</b></span><ConnectionStatus state={connection} /></div>
    </header>
    <div className="player-main">
      {team && <p className="team-line"><TeamMark name={team.name} color={team.color} />{team.name}</p>}
      <PlayerStage game={game} token={token} onAnnouncement={setAnnouncement} refresh={refresh} />
      <Link className="text-link portal-link" href={`/portal/${game.code}`} target="_blank" rel="noreferrer">View portal</Link>
    </div>
    <p className="sr-only" aria-live="polite">{announcement || (connection === "reconnecting" ? "Reconnecting. Showing the latest confirmed state." : "")}</p>
  </main>;
}

function PlayerStage({ game, token, onAnnouncement, refresh }: { game: PlayerProjection; token: string; onAnnouncement: (value: string) => void; refresh: () => Promise<void> }) {
  const result = latestResult(game);
  if (game.status === "LOBBY") return <section className="player-stage"><p className="eyeline">You&apos;re in</p><h1>Waiting in the lobby</h1><p>{game.players.length ? `${game.players.length} participant${game.players.length === 1 ? "" : "s"} joined. The host will open round one when everyone is ready.` : "No players have joined yet."}</p></section>;
  if (game.self.status === "ELIMINATED" && game.status !== "FINISHED") return <EliminatedScreen game={game} />;
  if (game.self.status === "ESCAPED" && game.status !== "FINISHED") return <section className="player-stage" aria-live="polite"><p className="eyeline">Round {game.self.eliminatedInRound ?? "—"}</p><h1>Your team escaped!</h1><p>Your team reached {game.teamEscape?.escapePoints ?? 100} points, so you are safe and stop playing. The remaining teams play on until one is left.</p><p>Follow the rest on the <Link className="text-link" href={`/portal/${game.code}`} target="_blank" rel="noreferrer">portal</Link>.</p></section>;
  if (game.status === "ROUND_OPEN" && game.self.status === "ACTIVE" && game.currentRound) return <PickForm game={game} token={token} refresh={refresh} onAnnouncement={onAnnouncement} />;
  if (game.status === "ROUND_OPEN" && game.currentRound) return <section className="player-stage"><p className="eyeline">Round {game.currentRound.number}</p><h1>You&apos;re spectating</h1><p>You were eliminated, but you can follow every result here.</p><p className="countdown"><Countdown deadlineAt={game.currentRound.deadlineAt} serverNow={game.serverNow} paused={game.currentRound.timerPaused} pausedRemainingMs={game.currentRound.pausedRemainingMs} /></p><p>{game.currentRound.timerPaused ? "Timer stopped by the Host. " : ""}{game.submittedCount} of {game.activeCount} active players have submitted.</p></section>;
  if (game.status === "ROUND_LOCKED") return <section className="player-stage"><p className="eyeline">Round {game.currentRound?.number ?? ""}</p><h1>Picks are locked.</h1><p>{game.self.currentPickTenths === null ? "You did not save a pick this round." : `Your last saved pick was ${tenths(game.self.currentPickTenths)}${game.currentRound?.settings.roundMode === "WAGER" ? ` with a ${game.self.currentStakePoints}-point stake` : ""}.`} The host will reveal the result shortly.</p></section>;
  if (result) return <PlayerResult game={game} />;
  return <section className="player-stage"><h1>Waiting for the result</h1><p>The latest confirmed game state is shown here.</p></section>;
}

function EliminatedScreen({ game }: { game: PlayerProjection }) {
  const outRound = game.self.eliminatedInRound;
  const round = game.revealedRounds.find((candidate) => candidate.number === outRound);
  const ranOutOfPoints = Boolean(round?.pointEliminatedUsernames.includes(game.self.username));
  const live = game.currentRound?.deadlineAt ?? null;
  return <section className="player-stage player-stage--out" aria-live="polite">
    <p className="eyeline">Round {outRound ?? "—"}</p>
    <h1>You&apos;ve been eliminated</h1>
    <p>{ranOutOfPoints ? "You ran out of points, so you can't play any more." : "You were knocked out in the escalation rounds, so you can't play any more."}</p>
    <div className="metric-pair"><Metric label="Final points" value={String(game.self.totalPoints)} /><Metric label="Players left" value={String(game.activeCount)} /></div>
    <p>You can keep watching on the <Link className="text-link" href={`/portal/${game.code}`} target="_blank" rel="noreferrer">portal</Link>. The next game will start from the lobby.</p>
    {live && game.status === "ROUND_OPEN" && <p className="countdown"><Countdown deadlineAt={live} serverNow={game.serverNow} paused={game.currentRound?.timerPaused} pausedRemainingMs={game.currentRound?.pausedRemainingMs} /></p>}
  </section>;
}

function PickForm({ game, token, refresh, onAnnouncement }: { game: PlayerProjection; token: string; refresh: () => Promise<void>; onAnnouncement: (value: string) => void }) {
  const round = game.currentRound!;
  const saved = game.self.currentPickTenths;
  const wagerRound = round.settings.roundMode === "WAGER";
  const hostTargetRound = round.settings.roundMode === "HOST_TARGET";
  const savedStake = game.self.currentStakePoints;
  const [value, setValue] = useState(saved === null ? "50" : String(saved / 10));
  const [stake, setStake] = useState(String(savedStake));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [savedOk, setSavedOk] = useState(false);
  const [now, setNow] = useState(Date.parse(game.serverNow));
  // `touched` keeps a late server refresh from snapping the slider back while the player is still dragging.
  const touched = useRef(false);
  const lastSent = useRef<{ pick: number; stake: number } | null>(saved === null ? null : { pick: saved / 10, stake: savedStake });
  const queue = useRef<Promise<void>>(Promise.resolve());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { touched.current = false; setValue(saved === null ? "50" : String(saved / 10)); setStake(String(savedStake)); lastSent.current = saved === null ? null : { pick: saved / 10, stake: savedStake }; }, [round.number]);
  useEffect(() => {
    lastSent.current = saved === null ? null : { pick: saved / 10, stake: savedStake };
    if (!touched.current) { setValue(saved === null ? "50" : String(saved / 10)); setStake(String(savedStake)); }
  }, [saved, savedStake]);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(id); }, []);
  const timeUp = Boolean(round.deadlineAt && !round.timerPaused && now >= Date.parse(round.deadlineAt));
  const numeric = Number(value);
  const numericStake = wagerRound ? Number(stake) : 0;
  const validPick = Number.isInteger(numeric) && numeric >= round.settings.min && numeric <= round.settings.max;
  const validStake = Number.isInteger(numericStake) && numericStake >= 0 && numericStake <= game.self.totalPoints;
  const valid = validPick && validStake;
  function change(next: string) { touched.current = true; setValue(next); }
  function changeStake(next: string) { touched.current = true; setStake(next); }

  /** Sends the pick; requests are chained so the last value the player chose is always the last one the server sees. */
  function send(target: number, targetStake: number): Promise<boolean> {
    const run = queue.current.then(async () => {
      try {
        await roomRequest("/api/room/pick", { method: "PUT", headers: authHeaders(token), body: { runId: game.runId, round: round.number, value: target, stake: targetStake, requestId: crypto.randomUUID() } });
        lastSent.current = { pick: target, stake: targetStake };
        return true;
      } catch (error) {
        setMessage(error instanceof RoomClientError ? error.problem.message : "Could not save your pick. Try again.");
        setSavedOk(false);
        return false;
      }
    });
    queue.current = run.then(() => undefined);
    return run;
  }

  // Auto-save: whatever the player last chose is stored shortly after they stop moving it, and right away near the deadline.
  useEffect(() => {
    if (!touched.current || !valid || timeUp || (lastSent.current?.pick === numeric && lastSent.current.stake === numericStake)) return;
    const msLeft = round.deadlineAt ? Date.parse(round.deadlineAt) - Date.now() : Infinity;
    const delay = Math.max(0, Math.min(600, msLeft - 1500));
    const id = window.setTimeout(() => {
      void send(numeric, numericStake).then((ok) => { if (ok) { setMessage(`${wagerRound ? "Your pick and stake are" : "Your pick is"} saved automatically. You can change ${wagerRound ? "them" : "it"} until the round is locked.`); setSavedOk(true); void refresh(); } });
    }, delay);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeric, numericStake, valid, timeUp, value, stake]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validPick) { setSavedOk(false); setMessage(`Enter a whole number from ${round.settings.min} to ${round.settings.max}.`); return; }
    if (!validStake) { setSavedOk(false); setMessage(`Stake a whole number from 0 to ${game.self.totalPoints}.`); return; }
    setBusy(true); setMessage(""); setSavedOk(false); onAnnouncement("Saving pick");
    touched.current = true;
    const ok = await send(numeric, numericStake);
    if (ok) { setMessage(`${wagerRound ? "Your pick and stake are" : "Your pick is"} saved. You can update ${wagerRound ? "them" : "it"} until the round is locked.`); setSavedOk(true); onAnnouncement(wagerRound ? "Pick and stake saved" : "Pick saved"); await refresh(); } else void refresh();
    setBusy(false);
  }
  return <form className="pick-form" onSubmit={submit}>
    <div><p className="eyeline">Round {round.number}{wagerRound ? " · Wager" : hostTargetRound ? " · Secret target" : ""}</p><h1>{wagerRound ? "Pick and stake" : "Make your pick"}</h1><p>{hostTargetRound ? "Choose the number you think is closest to the Host’s secret target." : ruleSentence(round.settings.p)}{wagerRound ? " Win to receive double your stake; lose and the stake is gone." : ""}</p></div>
    <div className="round-detail"><span>{game.submittedCount} of {game.activeCount} submitted{round.timerPaused ? " · Timer stopped" : ""}</span><Countdown deadlineAt={round.deadlineAt} serverNow={game.serverNow} paused={round.timerPaused} pausedRemainingMs={round.pausedRemainingMs} /></div>
    <label className="pick-number"><span>Your number</span><div><button type="button" aria-label="Decrease pick" onClick={() => change(String(Math.max(round.settings.min, (Number.isFinite(numeric) ? Math.round(numeric) : 50) - 1)))} disabled={busy || timeUp}>−</button><input type="number" inputMode="numeric" min={round.settings.min} max={round.settings.max} step={1} value={value} onChange={(event) => change(event.target.value)} aria-describedby="pick-help pick-message" /><button type="button" aria-label="Increase pick" onClick={() => change(String(Math.min(round.settings.max, (Number.isFinite(numeric) ? Math.round(numeric) : 50) + 1)))} disabled={busy || timeUp}>+</button></div><small id="pick-help">Choose from {round.settings.min} to {round.settings.max}, as a whole number.</small></label>
    <input className="pick-range" type="range" min={round.settings.min} max={round.settings.max} step={1} value={Number.isFinite(numeric) ? numeric : 50} onChange={(event) => change(event.target.value)} aria-label="Adjust pick" disabled={busy || timeUp} />
    {wagerRound && <label className="stake-number"><span className="stake-number__heading"><span>Your stake</span><strong>Available: {game.self.totalPoints} pts</strong></span><input type="number" inputMode="numeric" min={0} max={game.self.totalPoints} step={1} value={stake} onChange={(event) => changeStake(event.target.value)} aria-describedby="stake-help pick-message" disabled={busy || timeUp} /><small id="stake-help">Enter a whole number from 0 to {game.self.totalPoints}. A zero stake has no wager gain or loss.</small></label>}
    {timeUp && <p className="form-message" id="pick-message">Time is up. Waiting for the game to lock.</p>}
    {!timeUp && message && <p className={`form-message ${savedOk ? "form-message--ok" : ""}`} id="pick-message">{message}</p>}
    <button className="button button--primary" disabled={busy || timeUp}>{busy ? "Saving…" : saved === null ? wagerRound ? "Save pick & stake" : "Save pick" : wagerRound ? "Update pick & stake" : "Update pick"}</button>
  </form>;
}

function PlayerResult({ game }: { game: PlayerProjection }) {
  const result = latestResult(game)!;
  const roundDelta = result.pointsByUsername[game.self.username] ?? 0;
  const wagerDelta = result.wagerPointsByUsername[game.self.username] ?? 0;
  const baseDelta = result.basePointsByUsername[game.self.username] ?? 0;
  const stake = result.stakesByUsername[game.self.username] ?? 0;
  const payout = result.payoutsByUsername[game.self.username] ?? 0;
  const self = game.players.find((player) => player.username === game.self.username);
  return <section className="player-result"><p className="eyeline">Round {result.number} result</p><h1>{game.status === "FINISHED" ? "The game is finished" : "Here’s what the room chose"}</h1>
    <div className="metric-pair"><Metric label="Average" value={decimal(result.average)} /><Metric label="Target" value={decimal(result.target)} /></div>
    <div className="personal-result"><p>Your pick <strong>{tenths(game.self.currentPickTenths)}</strong></p>{result.settings.roundMode === "WAGER" && <><p>Your stake <strong>{stake}</strong></p><p>Wager return <strong>{payout}</strong></p><p>Wager change <strong>{wagerDelta > 0 ? `+${wagerDelta}` : wagerDelta}</strong></p><p>Basic score <strong>{baseDelta > 0 ? `+${baseDelta}` : baseDelta}</strong></p></>}<p>Points this round <strong>{roundDelta > 0 ? `+${roundDelta}` : roundDelta}</strong></p><p>Total points <strong>{game.self.totalPoints}</strong></p></div>
    {result.settings.roundMode === "WAGER" && <p>Winning stakes return 2×. Losing stakes are forfeited.</p>}
    <p>{result.winners.length ? `Winner${result.winners.length === 1 ? "" : "s"}: ${result.winners.map((winner) => winner.username).join(", ")}.` : "No eligible winner this round."}</p>
    {result.pointEliminatedUsernames.includes(game.self.username) && <p className="notice notice--danger">You ran out of points and are out of the game. You can keep following as a spectator.</p>}
    {result.eliminatedUsername && <p className="notice notice--danger">{result.eliminatedUsername} was eliminated. {game.self.status === "ELIMINATED" ? "You can keep following as a spectator." : ""}</p>}
    {game.escalationReason === "NASH" && <p className="notice">The group reached Nash equilibrium. From the next round, duplicate picks lose the round (Rule 1) and a lone 100 beats 0 (Rule 2).</p>}
    {game.escalationReason === "HOST" && <p className="notice">The host started escalation. From the next round, duplicate picks lose the round (Rule 1) and a lone 100 beats 0 (Rule 2).</p>}
    {teamEscapeNotice(game, result.escapedTeamIds) && <p className="notice">{teamEscapeNotice(game, result.escapedTeamIds)}</p>}
    {game.status === "FINISHED" && <p className="notice">{self?.finalPlacement ? `Your final placement: ${self.finalPlacement}.` : "Final scores are shown on the Portal."}</p>}
  </section>;
}

"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { PlayerProjection } from "@/contracts";
import { RoomClientError, authHeaders, getPlayerToken, removePlayerToken, roomRequest, stateUrl } from "@/lib/api/room-client";
import { decimal, ruleSentence, tenths } from "@/lib/formatters";
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
      <div><span className="eyeline">Game {game.code}</span><strong>{player?.displayName ?? game.self.username}</strong></div>
      <ConnectionStatus state={connection} />
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
  if (game.status === "ROUND_OPEN" && game.self.status === "ACTIVE" && game.currentRound) return <PickForm game={game} token={token} refresh={refresh} onAnnouncement={onAnnouncement} />;
  if (game.status === "ROUND_OPEN" && game.currentRound) return <section className="player-stage"><p className="eyeline">Round {game.currentRound.number}</p><h1>You&apos;re spectating</h1><p>You were eliminated, but you can follow every result here.</p><p className="countdown"><Countdown deadlineAt={game.currentRound.deadlineAt} serverNow={game.serverNow} /></p><p>{game.submittedCount} of {game.activeCount} active players have submitted.</p></section>;
  if (game.status === "ROUND_LOCKED") return <section className="player-stage"><p className="eyeline">Round {game.currentRound?.number ?? ""}</p><h1>Picks are locked.</h1><p>{game.self.currentPickTenths === null ? "You did not save a pick this round." : `Your last saved pick was ${tenths(game.self.currentPickTenths)}.`} The host will reveal the result shortly.</p></section>;
  if (result) return <PlayerResult game={game} />;
  return <section className="player-stage"><h1>Waiting for the result</h1><p>The latest confirmed game state is shown here.</p></section>;
}

function PickForm({ game, token, refresh, onAnnouncement }: { game: PlayerProjection; token: string; refresh: () => Promise<void>; onAnnouncement: (value: string) => void }) {
  const round = game.currentRound!;
  const saved = game.self.currentPickTenths;
  const [value, setValue] = useState(saved === null ? "50" : String(saved / 10));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [savedOk, setSavedOk] = useState(false);
  const [now, setNow] = useState(Date.parse(game.serverNow));
  useEffect(() => { setValue(saved === null ? "50" : String(saved / 10)); }, [round.number, saved]);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(id); }, []);
  const timeUp = Boolean(round.deadlineAt && now >= Date.parse(round.deadlineAt));
  const numeric = Number(value);
  const valid = Number.isInteger(numeric) && numeric >= round.settings.min && numeric <= round.settings.max;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) { setSavedOk(false); setMessage(`Enter a whole number from ${round.settings.min} to ${round.settings.max}.`); return; }
    setBusy(true); setMessage(""); setSavedOk(false); onAnnouncement("Saving pick");
    try {
      await roomRequest("/api/room/pick", { method: "PUT", headers: authHeaders(token), body: { runId: game.runId, round: round.number, value: numeric, requestId: crypto.randomUUID() } });
      setMessage("Your pick is saved. You can update it until the round is locked."); setSavedOk(true); onAnnouncement("Pick saved"); await refresh();
    } catch (error) {
      setMessage(error instanceof RoomClientError ? error.problem.message : "Could not save your pick. Try again.");
      void refresh();
    } finally { setBusy(false); }
  }
  return <form className="pick-form" onSubmit={submit}>
    <div><p className="eyeline">Round {round.number}</p><h1>Make your pick</h1><p>{ruleSentence(round.settings.p)}</p></div>
    <div className="round-detail"><span>{game.submittedCount} of {game.activeCount} submitted</span><Countdown deadlineAt={round.deadlineAt} serverNow={game.serverNow} /></div>
    <label className="pick-number"><span>Your number</span><div><button type="button" aria-label="Decrease pick" onClick={() => setValue(String(Math.max(round.settings.min, (Number.isFinite(numeric) ? Math.round(numeric) : 50) - 1)))} disabled={busy || timeUp}>−</button><input type="number" inputMode="numeric" min={round.settings.min} max={round.settings.max} step={1} value={value} onChange={(event) => setValue(event.target.value)} aria-describedby="pick-help pick-message" /><button type="button" aria-label="Increase pick" onClick={() => setValue(String(Math.min(round.settings.max, (Number.isFinite(numeric) ? Math.round(numeric) : 50) + 1)))} disabled={busy || timeUp}>+</button></div><small id="pick-help">Choose from {round.settings.min} to {round.settings.max}, as a whole number.</small></label>
    <input className="pick-range" type="range" min={round.settings.min} max={round.settings.max} step={1} value={Number.isFinite(numeric) ? numeric : 50} onChange={(event) => setValue(event.target.value)} aria-label="Adjust pick" disabled={busy || timeUp} />
    {timeUp && <p className="form-message" id="pick-message">Time is up. Waiting for the game to lock.</p>}
    {!timeUp && message && <p className={`form-message ${savedOk ? "form-message--ok" : ""}`} id="pick-message">{message}</p>}
    <button className="button button--primary" disabled={busy || timeUp}>{busy ? "Saving pick…" : saved === null ? "Save pick" : "Update pick"}</button>
  </form>;
}

function PlayerResult({ game }: { game: PlayerProjection }) {
  const result = latestResult(game)!;
  const roundDelta = result.pointsByUsername[game.self.username] ?? 0;
  const self = game.players.find((player) => player.username === game.self.username);
  return <section className="player-result"><p className="eyeline">Round {result.number} result</p><h1>{game.status === "FINISHED" ? "The game is finished" : "Here’s what the room chose"}</h1>
    <div className="metric-pair"><Metric label="Average" value={decimal(result.average)} /><Metric label="Target" value={decimal(result.target)} /></div>
    <div className="personal-result"><p>Your pick <strong>{tenths(game.self.currentPickTenths)}</strong></p><p>Points this round <strong>{roundDelta > 0 ? `+${roundDelta}` : roundDelta}</strong></p><p>Total points <strong>{game.self.totalPoints}</strong></p></div>
    <p>{result.winners.length ? `Winner${result.winners.length === 1 ? "" : "s"}: ${result.winners.map((winner) => winner.username).join(", ")}.` : "No eligible winner this round."}</p>
    {result.eliminatedUsername && <p className="notice notice--danger">{result.eliminatedUsername} was eliminated. {game.self.status === "ELIMINATED" ? "You can keep following as a spectator." : ""}</p>}
    {game.escalationReason === "NASH" && <p className="notice">The group reached Nash equilibrium. Escalation rules apply next round.</p>}
    {game.escalationReason === "HOST" && <p className="notice">The host started escalation. Escalation rules apply next round.</p>}
    {game.status === "FINISHED" && <p className="notice">{self?.finalPlacement ? `Your final placement: ${self.finalPlacement}.` : "Final scores are shown on the Portal."}</p>}
  </section>;
}

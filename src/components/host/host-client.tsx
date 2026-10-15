"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { HostCommand, HostProjection } from "@/contracts";
import { RoomClientError, roomRequest } from "@/lib/api/room-client";
import { decimal, shortDate, tenths } from "@/lib/formatters";
import { ConnectionStatus, Countdown, Metric, ScreenSkeleton, TeamMark } from "@/components/room/room-ui";
import { useRoomState } from "@/components/room/use-room-state";

type Archive = { runId: string; runNumber: number; endedAt: string; reason: string; expiresAt: string };
type PendingCommand = "FINISH" | "RESET" | null;
type SettingsPayload = Extract<HostCommand, { type: "UPDATE_SETTINGS" }>["payload"];
type PrimaryCommand = "OPEN_ROUND" | "LOCK_ROUND" | "REVEAL_ROUND" | "CANCEL_ROUND_RESULT" | "START_ESCALATION" | "FINISH" | "RESET";
type TimerCommand = "PAUSE_TIMER" | "RESUME_TIMER" | "RESET_TIMER";

const actionLabel: Record<string, string> = {
  OPEN_ROUND: "Open round", LOCK_ROUND: "Lock round", REVEAL_ROUND: "Reveal result", CANCEL_ROUND_RESULT: "Cancel round result", START_ESCALATION: "Start escalation", FINISH: "Finish game", RESET: "Start new run",
};

function roundModeLabel(mode: HostProjection["nextRoundSettings"]["roundMode"]): string {
  if (mode === "WAGER") return "Wager round";
  if (mode === "HOST_TARGET") return "Host target round";
  return "Standard round";
}

function actionsFor(game: HostProjection): PrimaryCommand[] {
  switch (game.status) {
    case "LOBBY": return ["OPEN_ROUND"];
    case "ROUND_OPEN": return ["LOCK_ROUND"];
    case "ROUND_LOCKED": return ["REVEAL_ROUND"];
    case "ROUND_REVEALED": {
      const cancel = game.canCancelRoundResult ? ["CANCEL_ROUND_RESULT" as const] : [];
      return game.phase === "ESCALATION" ? ["OPEN_ROUND", ...cancel, "FINISH"] : ["OPEN_ROUND", ...cancel, "START_ESCALATION", "FINISH"];
    }
    case "FINISHED": return game.canCancelRoundResult ? ["CANCEL_ROUND_RESULT", "RESET"] : ["RESET"];
  }
}

export function HostClient({ code }: { code: string }) {
  const room = useRoomState({ code, view: "host", pauseWhenHidden: false });
  const [notice, setNotice] = useState("");
  const [noticeOk, setNoticeOk] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCommand>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [exportsOpen, setExportsOpen] = useState(false);

  useEffect(() => { if (pending) dialog.current?.showModal(); else dialog.current?.close(); }, [pending]);
  const activeRunId = room.data?.runId;
  const activeStatus = room.data?.status;
  useEffect(() => {
    if (!activeRunId) return;
    void roomRequest<Archive[]>("/api/room/archives").then(setArchives).catch(() => setArchives([]));
  }, [activeRunId, activeStatus]);

  async function command(type: PrimaryCommand | TimerCommand, payload?: SettingsPayload) {
    if (!room.data) return;
    if (type === "FINISH" || type === "RESET") { setPending(type); return; }
    await send(type, payload);
  }
  async function send(type: HostCommand["type"], payload?: SettingsPayload) {
    if (!room.data) return;
    setSubmitting(type); setNotice(""); setNoticeOk(false);
    const base = { type, commandId: crypto.randomUUID(), expectedVersion: room.data.version };
    const body = type === "UPDATE_SETTINGS" ? { ...base, payload: payload ?? {} } : base;
    try {
      await roomRequest("/api/room/command", { method: "POST", body });
      if (type === "RESET") { setNotice("A new run has started. Players with retained sessions can join the lobby again."); setNoticeOk(true); }
      await room.refresh();
    } catch (error) {
      if (error instanceof RoomClientError && error.problem.code === "VERSION_CONFLICT") {
        setNotice("Game state changed in another session. The latest state is now shown."); await room.refresh();
      } else setNotice(error instanceof RoomClientError ? error.problem.message : "Command failed. Try again.");
    } finally { setSubmitting(null); setPending(null); }
  }
  async function logout() { await roomRequest("/api/host/logout", { method: "POST" }).catch(() => undefined); window.location.assign("/host"); }

  if (!room.data) return <ScreenSkeleton />;
  const game = room.data;
  return <main className="host-page">
    <header className="host-topbar"><Link href="/host" className="wordmark">Keynesian Beauty Contest</Link><span>Room <strong>{game.code}</strong></span><span className="topbar-state">{game.status.replaceAll("_", " ")}</span><a className="text-link" href={`/portal/${game.code}`} target="_blank" rel="noreferrer">Open Portal</a><div className="export-wrap"><button className="text-button" onClick={() => setExportsOpen((open) => !open)} aria-expanded={exportsOpen}>Export</button>{exportsOpen && <ExportMenu currentRun={game.runId} archives={archives} />}</div><button className="text-button" onClick={() => void logout()}>Sign out</button></header>
    <div className="host-layout">
      <aside className="command-rail"><ConnectionStatus state={room.connection} /><p className="eyeline">Current action</p><h1>{actionLabel[actionsFor(game)[0]]}</h1>{actionsFor(game).map((action) => <button key={action} className={action === actionsFor(game)[0] ? "button button--primary" : "button button--secondary"} disabled={submitting !== null} onClick={() => void command(action)}>{submitting === action ? "Working…" : actionLabel[action]}</button>)}{game.status === "ROUND_OPEN" && game.currentRound && <HostTimerControls game={game} busy={submitting !== null} submitting={submitting} onCommand={command} />}{game.status !== "FINISHED" && <button className="button button--secondary" disabled={submitting !== null} onClick={() => void command("RESET")}>Start new run</button>}
        {(game.status === "LOBBY" || game.status === "ROUND_REVEALED") && <NextRoundSettings game={game} busy={submitting === "UPDATE_SETTINGS"} onSave={(payload) => send("UPDATE_SETTINGS", payload)} />}
        {notice && <p className={`form-message ${noticeOk ? "form-message--ok" : ""}`} role="status">{notice}</p>}
      </aside>
      <section className="host-live"><header><div><p className="eyeline">Live room</p><h2>{game.status === "ROUND_OPEN" ? `Round ${game.currentRound?.number}` : game.status.replaceAll("_", " ")}</h2></div><p>{game.currentRound ? `${roundModeLabel(game.currentRound.settings.roundMode)} · ` : ""}{game.submittedCount} of {game.activeCount} active players submitted</p></header>
        <LiveLeaderboard game={game} />
        <RosterByTeam game={game} />
        <HostRoundDetail game={game} />
      </section>
    </div>
    <dialog className="confirm-dialog" ref={dialog} onCancel={(event) => { event.preventDefault(); setPending(null); }}><form method="dialog"><h2>{pending === "FINISH" ? "Finish this game?" : "Start a new run?"}</h2><p>{pending === "FINISH" ? "This records the current run and stops further rounds." : "This archives the current run and returns every signed-in player to a new lobby."}</p><div><button className="button button--secondary" autoFocus onClick={() => setPending(null)}>Cancel</button><button className="button button--danger" onClick={() => pending && void send(pending)}>{pending === "FINISH" ? "Finish game" : "Start new run"}</button></div></form></dialog>
  </main>;
}

function HostTimerControls({ game, busy, submitting, onCommand }: { game: HostProjection; busy: boolean; submitting: string | null; onCommand: (type: TimerCommand) => Promise<void> }) {
  const round = game.currentRound!;
  if (round.settings.timerSeconds === null) return <section className="host-timer host-timer--off"><p className="eyeline">Round timer</p><strong>No time limit</strong></section>;
  const primary: TimerCommand = round.timerPaused ? "RESUME_TIMER" : "PAUSE_TIMER";
  return <section className="host-timer" aria-label="Round timer controls">
    <div><p className="eyeline">Round timer{round.timerPaused ? " · stopped" : ""}</p><Countdown className="host-timer__clock" deadlineAt={round.deadlineAt} serverNow={game.serverNow} paused={round.timerPaused} pausedRemainingMs={round.pausedRemainingMs} /></div>
    <div className="host-timer__actions"><button className="button button--secondary" disabled={busy} onClick={() => void onCommand(primary)}>{submitting === primary ? "Working…" : round.timerPaused ? "Resume timer" : "Stop timer"}</button><button className="button button--secondary" disabled={busy} onClick={() => void onCommand("RESET_TIMER")}>{submitting === "RESET_TIMER" ? "Working…" : `Reset to ${round.settings.timerSeconds}s`}</button></div>
  </section>;
}

function NextRoundSettings({ game, busy, onSave }: { game: HostProjection; busy: boolean; onSave: (payload: SettingsPayload) => Promise<void> }) {
  const saved = game.nextRoundSettings;
  const [roundMode, setRoundMode] = useState(saved.roundMode ?? "STANDARD");
  const [hostTarget, setHostTarget] = useState(String(game.nextHostTarget ?? 50));
  const [p, setP] = useState(saved.p);
  const timerText = (seconds: number | null) => seconds === null ? "off" : String(seconds);
  const [timer, setTimer] = useState<string>(timerText(saved.timerSeconds));
  const [winPoints, setWinPoints] = useState(String(saved.winPoints ?? 10));
  const [losePoints, setLosePoints] = useState(String(saved.losePoints ?? 0));
  const [startPoints, setStartPoints] = useState(String(saved.startPoints ?? 0));
  useEffect(() => {
    setRoundMode(saved.roundMode ?? "STANDARD"); setHostTarget(String(game.nextHostTarget ?? 50)); setP(saved.p); setTimer(timerText(saved.timerSeconds));
    setWinPoints(String(saved.winPoints ?? 10)); setLosePoints(String(saved.losePoints ?? 0)); setStartPoints(String(saved.startPoints ?? 0));
  }, [game.nextHostTarget, saved.roundMode, saved.p, saved.timerSeconds, saved.winPoints, saved.losePoints, saved.startPoints]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const seconds = timer === "off" ? null : (Number(timer) as 60 | 90 | 120);
    void onSave({ roundMode, ...(roundMode === "HOST_TARGET" ? { hostTarget: Number(hostTarget) } : {}), p, timerSeconds: seconds, winPoints: Number(winPoints), losePoints: Number(losePoints), startPoints: Number(startPoints) });
  }
  return <form className="next-settings" onSubmit={submit}><h2>Next round</h2><label><span>Round type</span><select value={roundMode} onChange={(event) => setRoundMode(event.target.value as typeof roundMode)}><option value="STANDARD">Standard round</option><option value="WAGER">Wager round</option><option value="HOST_TARGET" disabled={game.phase === "ESCALATION"}>Host target round</option></select></label>{roundMode === "HOST_TARGET" ? <label><span>Secret Host target</span><input type="number" inputMode="numeric" min={0} max={100} step={1} required value={hostTarget} onChange={(event) => setHostTarget(event.target.value)} /><small>Whole number from 0 to 100. Players will see it only after reveal.</small></label> : <label><span>Target multiplier</span><select value={p} onChange={(event) => setP(event.target.value as typeof p)}><option value="0.8">80% of average</option><option value="2/3">2/3 of average</option><option value="1/2">1/2 of average</option></select></label>}<label><span>Timer</span><select value={timer} onChange={(event) => setTimer(event.target.value)}><option value="60">60 seconds</option><option value="90">90 seconds</option><option value="120">120 seconds</option><option value="off">Off</option></select></label>
    <label><span>Starting points (0 = no elimination by points)</span><input type="number" inputMode="numeric" min={0} max={100000} step={1} required value={startPoints} onChange={(event) => setStartPoints(event.target.value)} disabled={game.status !== "LOBBY"} /></label>
    <label><span>Points per win</span><input type="number" inputMode="numeric" min={0} max={1000} step={1} required value={winPoints} onChange={(event) => setWinPoints(event.target.value)} /></label>
    <label><span>Points lost per loss</span><input type="number" inputMode="numeric" min={0} max={1000} step={1} required value={losePoints} onChange={(event) => setLosePoints(event.target.value)} /></label>
    <p>{roundMode === "HOST_TARGET" ? "The player closest to your secret target wins. This round type is available only during normal play." : roundMode === "WAGER" ? "A winning stake returns double; a losing stake is forfeited." : "The player closest to the configured fraction of the average wins."} Basic win/loss points still apply.</p><button className="button button--secondary" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button></form>;
}

function LiveLeaderboard({ game }: { game: HostProjection }) {
  const rows = game.individualLeaderboard.slice(0, 10);
  const player = (username: string) => game.players.find((candidate) => candidate.username === username);
  const teamOf = (teamId: string) => game.teams.find((team) => team.id === teamId);
  return <section className="live-board" aria-label="Leaderboard">
    <div className="live-board__players"><h2>Leaderboard</h2>
      {rows.length === 0 ? <p>No players yet.</p> : <ol>{rows.map((row) => { const entry = player(row.username); const team = entry ? teamOf(entry.teamId) : undefined; return <li key={row.username} className={entry?.status === "ELIMINATED" ? "is-out" : undefined}><span className="live-board__rank">#{row.rank}</span><span className="live-board__name">{entry?.displayName ?? row.username}{team && <small><TeamMark name={team.name} color={team.color} />{team.name}</small>}</span><strong>{row.points}<small> pts</small></strong></li>; })}</ol>}
    </div>
    <div className="live-board__teams"><h2>Teams</h2>
      <ol>{game.teamLeaderboard.map((row) => { const team = teamOf(row.teamId); return <li key={row.teamId}><span className="live-board__rank">#{row.rank}</span><span className="live-board__name">{team && <TeamMark name={team.name} color={team.color} />}{team?.name ?? row.teamId}</span><strong>{row.points}<small> pts</small></strong></li>; })}</ol>
    </div>
  </section>;
}

function RosterByTeam({ game }: { game: HostProjection }) {
  const [openTeams, setOpenTeams] = useState<Record<string, boolean>>({});
  return <section className="roster"><h2>Roster</h2>{game.teams.map((team) => { const people = game.players.filter((player) => player.teamId === team.id); const active = people.filter((player) => player.status === "ACTIVE"); const submitted = active.filter((player) => player.hasSubmitted); const points = people.reduce((sum, player) => sum + player.totalPoints, 0); const expanded = openTeams[team.id] ?? true; return <details key={team.id} open={expanded} onToggle={(event) => setOpenTeams((current) => ({ ...current, [team.id]: (event.target as HTMLDetailsElement).open }))}><summary><span><TeamMark name={team.name} color={team.color} />{team.name}</span><span>{people.length} players · {active.length} active · {submitted.length} submitted · {points} pts</span></summary><ul>{people.map((player) => <li key={player.username}><span>{player.displayName}</span><span>{player.status === "ELIMINATED" ? "Eliminated" : game.status === "ROUND_OPEN" ? player.hasSubmitted ? "Submitted" : "Not submitted" : "Active"} · {player.totalPoints} pts</span></li>)}</ul></details>; })}</section>;
}

function HostRoundDetail({ game }: { game: HostProjection }) {
  const result = game.revealedRounds.at(-1);
  return <section className="host-round-detail"><h2>Round detail</h2>{game.currentRound?.settings.roundMode === "HOST_TARGET" && game.currentHostTarget !== null && <p className="host-secret-target"><span>Secret Host target</span><strong>{game.currentHostTarget}</strong><small>Only the Host can see this before reveal.</small></p>}{game.hostPicks ? <ul className="host-picks">{game.hostPicks.map((pick) => <li key={pick.username}><span>{game.players.find((player) => player.username === pick.username)?.displayName ?? pick.username}</span><strong>{tenths(pick.valueTenths)}{game.currentRound?.settings.roundMode === "WAGER" ? ` · ${pick.stakePoints} pts staked` : ""}</strong></li>)}</ul> : <p>{game.status === "ROUND_OPEN" ? "Names show submitted state only until the round locks." : "Round detail will appear after the first lock."}</p>}{result && <><div className="metric-pair"><Metric label="Average" value={decimal(result.average)} /><Metric label={result.settings.roundMode === "HOST_TARGET" ? "Host target" : "Target"} value={decimal(result.target)} /></div><p>{result.winners.length ? `Winners: ${result.winners.map((winner) => winner.username).join(", ")}.` : "No eligible winner this round."}</p>{result.settings.roundMode === "WAGER" && <p><strong>Fixed 2× wager returns.</strong> {Object.entries(result.payoutsByUsername).map(([username, payout]) => `${username}: ${payout} pts returned`).join(", ") || "No winning stake to return."}</p>}<p>{game.activeRules.length ? `Rules in force: ${game.activeRules.map((rule) => `Rule ${rule}`).join(", ")}.` : "No escalation rules are in force."}</p><p>{game.escalationReason === "NASH" ? "Nash-triggered escalation." : game.escalationReason === "HOST" ? "Host-triggered escalation." : "Normal round."}</p><Analytics game={game} /></>}</section>;
}

function Analytics({ game }: { game: HostProjection }) {
  const latest = game.revealedRounds.at(-1);
  if (!latest) return null;
  const values = latest.picks.map((pick) => pick.valueTenths / 10);
  const summary = values.length ? `Revealed picks range from ${Math.min(...values)} to ${Math.max(...values)}.` : "No valid picks were submitted this round.";
  return <div className="analytics"><h3>Result summary</h3><p>{summary}</p><ol>{game.individualLeaderboard.slice(0, 5).map((row) => <li key={row.username}>#{row.rank} {row.username}: {row.points} pts</li>)}</ol><ul>{game.teamLeaderboard.map((row) => <li key={row.teamId}>#{row.rank} {game.teams.find((team) => team.id === row.teamId)?.name}: {row.points} pts</li>)}</ul></div>;
}

function ExportMenu({ currentRun, archives }: { currentRun: string; archives: Archive[] }) {
  const entries = [{ runId: currentRun, label: "Current run" }, ...archives.map((archive) => ({ runId: archive.runId, label: `Run ${archive.runNumber} · ${shortDate(archive.endedAt)}` }))];
  return <div className="export-menu" role="menu"><p>Choose a format</p>{entries.map((entry) => <div key={entry.runId}><span>{entry.label}</span><a href={`/api/room/export?runId=${encodeURIComponent(entry.runId)}&format=csv`} role="menuitem">CSV</a><a href={`/api/room/export?runId=${encodeURIComponent(entry.runId)}&format=json`} role="menuitem">JSON</a></div>)}</div>;
}

"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { HostCommand, HostProjection } from "@/contracts";
import { RoomClientError, roomRequest } from "@/lib/api/room-client";
import { decimal, shortDate, tenths } from "@/lib/formatters";
import { ConnectionStatus, Metric, ScreenSkeleton, TeamMark } from "@/components/room/room-ui";
import { useRoomState } from "@/components/room/use-room-state";

type Archive = { runId: string; runNumber: number; endedAt: string; reason: string; expiresAt: string };
type PendingCommand = "FINISH" | "RESET" | null;

const actionLabel: Record<string, string> = {
  OPEN_ROUND: "Open round", LOCK_ROUND: "Lock round", REVEAL_ROUND: "Reveal result", START_ESCALATION: "Start escalation", FINISH: "Finish game", RESET: "Start new run",
};

function actionsFor(game: HostProjection): Array<Exclude<HostCommand["type"], "UPDATE_SETTINGS">> {
  switch (game.status) {
    case "LOBBY": return ["OPEN_ROUND"];
    case "ROUND_OPEN": return ["LOCK_ROUND"];
    case "ROUND_LOCKED": return ["REVEAL_ROUND"];
    case "ROUND_REVEALED": return game.phase === "ESCALATION" ? ["OPEN_ROUND", "FINISH"] : ["OPEN_ROUND", "START_ESCALATION", "FINISH"];
    case "FINISHED": return ["RESET"];
  }
}

export function HostClient({ code }: { code: string }) {
  const room = useRoomState({ code, view: "host", pauseWhenHidden: false });
  const [notice, setNotice] = useState("");
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

  async function command(type: Exclude<HostCommand["type"], "UPDATE_SETTINGS">, payload?: { p?: "0.8" | "2/3" | "1/2"; timerSeconds?: number | null }) {
    if (!room.data) return;
    if (type === "FINISH" || type === "RESET") { setPending(type); return; }
    await send(type, payload);
  }
  async function send(type: HostCommand["type"], payload?: { p?: "0.8" | "2/3" | "1/2"; timerSeconds?: number | null }) {
    if (!room.data) return;
    setSubmitting(type); setNotice("");
    const base = { type, commandId: crypto.randomUUID(), expectedVersion: room.data.version };
    const body = type === "UPDATE_SETTINGS" ? { ...base, payload: payload ?? {} } : base;
    try {
      await roomRequest("/api/room/command", { method: "POST", body });
      if (type === "RESET") setNotice("A new run has started. Players with retained sessions can join the lobby again.");
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
      <aside className="command-rail"><ConnectionStatus state={room.connection} /><p className="eyeline">Current action</p><h1>{actionLabel[actionsFor(game)[0]]}</h1>{actionsFor(game).map((action) => <button key={action} className={action === actionsFor(game)[0] ? "button button--primary" : "button button--secondary"} disabled={submitting !== null} onClick={() => void command(action)}>{submitting === action ? "Working…" : actionLabel[action]}</button>)}{game.status !== "FINISHED" && <button className="button button--secondary" disabled={submitting !== null} onClick={() => void command("RESET")}>Start new run</button>}
        {(game.status === "LOBBY" || game.status === "ROUND_REVEALED") && <NextRoundSettings game={game} busy={submitting === "UPDATE_SETTINGS"} onSave={(payload) => send("UPDATE_SETTINGS", payload)} />}
        {notice && <p className="form-message" role="status">{notice}</p>}
      </aside>
      <section className="host-live"><header><div><p className="eyeline">Live room</p><h2>{game.status === "ROUND_OPEN" ? `Round ${game.currentRound?.number}` : game.status.replaceAll("_", " ")}</h2></div><p>{game.submittedCount} of {game.activeCount} active players submitted</p></header>
        <RosterByTeam game={game} />
        <HostRoundDetail game={game} />
      </section>
    </div>
    <dialog className="confirm-dialog" ref={dialog} onCancel={(event) => { event.preventDefault(); setPending(null); }}><form method="dialog"><h2>{pending === "FINISH" ? "Finish this game?" : "Start a new run?"}</h2><p>{pending === "FINISH" ? "This records the current run and stops further rounds." : "This archives the current run and returns every signed-in player to a new lobby."}</p><div><button className="button button--secondary" autoFocus onClick={() => setPending(null)}>Cancel</button><button className="button button--danger" onClick={() => pending && void send(pending)}>{pending === "FINISH" ? "Finish game" : "Start new run"}</button></div></form></dialog>
  </main>;
}

function NextRoundSettings({ game, busy, onSave }: { game: HostProjection; busy: boolean; onSave: (payload: { p?: "0.8" | "2/3" | "1/2"; timerSeconds?: number | null }) => Promise<void> }) {
  const [p, setP] = useState(game.currentRound?.settings.p ?? "0.8");
  const [timer, setTimer] = useState<string>(String(game.currentRound?.settings.timerSeconds ?? 60));
  useEffect(() => { setP(game.currentRound?.settings.p ?? "0.8"); setTimer(String(game.currentRound?.settings.timerSeconds ?? 60)); }, [game.currentRound?.settings.p, game.currentRound?.settings.timerSeconds]);
  function submit(event: FormEvent) { event.preventDefault(); const parsed = timer === "off" ? null : Number(timer); void onSave({ p, timerSeconds: Number.isFinite(parsed) ? parsed : null }); }
  return <form className="next-settings" onSubmit={submit}><h2>Next round</h2><label><span>Target multiplier</span><select value={p} onChange={(event) => setP(event.target.value as typeof p)}><option value="0.8">80% of average</option><option value="2/3">2/3 of average</option><option value="1/2">1/2 of average</option></select></label><label><span>Timer</span><select value={timer} onChange={(event) => setTimer(event.target.value)}><option value="60">60 seconds</option><option value="off">Off</option></select></label><p>Changes apply to the next round. The open round keeps its saved settings.</p><button className="button button--secondary" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button></form>;
}

function RosterByTeam({ game }: { game: HostProjection }) {
  const [openTeams, setOpenTeams] = useState<Record<string, boolean>>({});
  return <section className="roster"><h2>Roster</h2>{game.teams.map((team) => { const people = game.players.filter((player) => player.teamId === team.id); const active = people.filter((player) => player.status === "ACTIVE"); const submitted = active.filter((player) => player.hasSubmitted); const points = people.reduce((sum, player) => sum + player.totalPoints, 0); const expanded = openTeams[team.id] ?? true; return <details key={team.id} open={expanded} onToggle={(event) => setOpenTeams((current) => ({ ...current, [team.id]: (event.target as HTMLDetailsElement).open }))}><summary><span><TeamMark name={team.name} color={team.color} />{team.name}</span><span>{people.length} players · {active.length} active · {submitted.length} submitted · {points} pts</span></summary><ul>{people.map((player) => <li key={player.username}><span>{player.displayName}</span><span>{player.status === "ELIMINATED" ? "Eliminated" : game.status === "ROUND_OPEN" ? player.hasSubmitted ? "Submitted" : "Not submitted" : "Active"} · {player.totalPoints} pts</span></li>)}</ul></details>; })}</section>;
}

function HostRoundDetail({ game }: { game: HostProjection }) {
  const result = game.revealedRounds.at(-1);
  return <section className="host-round-detail"><h2>Round detail</h2>{game.hostPicks ? <ul className="host-picks">{game.hostPicks.map((pick) => <li key={pick.username}><span>{game.players.find((player) => player.username === pick.username)?.displayName ?? pick.username}</span><strong>{tenths(pick.valueTenths)}</strong></li>)}</ul> : <p>{game.status === "ROUND_OPEN" ? "Names show submitted state only until the round locks." : "Round detail will appear after the first lock."}</p>}{result && <><div className="metric-pair"><Metric label="Average" value={decimal(result.average)} /><Metric label="Target" value={decimal(result.target)} /></div><p>{result.winners.length ? `Winners: ${result.winners.map((winner) => winner.username).join(", ")}.` : "No eligible winner this round."}</p><p>{game.activeRules.length ? `Rules in force: ${game.activeRules.map((rule) => `Rule ${rule}`).join(", ")}.` : "No escalation rules are in force."}</p><p>{game.escalationReason === "NASH" ? "Nash-triggered escalation." : game.escalationReason === "HOST" ? "Host-triggered escalation." : "Normal round."}</p><Analytics game={game} /></>}</section>;
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

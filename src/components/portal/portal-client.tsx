"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { toDataURL } from "qrcode";
import type { PublicProjection, RevealedRound } from "@/contracts";
import { decimal, multiplier, ruleSentence, tenths } from "@/lib/formatters";
import { ConnectionStatus, Countdown, Metric, ScreenSkeleton, TeamMark } from "@/components/room/room-ui";
import { useRoomState } from "@/components/room/use-room-state";

export function PortalClient({ code }: { code: string }) {
  const room = useRoomState({ code, view: "public", pauseWhenHidden: false });
  const [fullscreen, setFullscreen] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    const keyboard = (event: KeyboardEvent) => { if (event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); void toggleFullscreen(); } };
    let timeout: number | undefined;
    const showCursor = () => { setCursorVisible(true); if (timeout) window.clearTimeout(timeout); timeout = window.setTimeout(() => setCursorVisible(false), 2200); };
    document.addEventListener("fullscreenchange", update);
    window.addEventListener("keydown", keyboard);
    window.addEventListener("pointermove", showCursor);
    showCursor();
    return () => { document.removeEventListener("fullscreenchange", update); window.removeEventListener("keydown", keyboard); window.removeEventListener("pointermove", showCursor); if (timeout) window.clearTimeout(timeout); };
  }, []);
  async function toggleFullscreen() { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen?.(); }
  if (!room.data && (room.error?.problem.status === 404 || room.error?.problem.status === 410)) return <main className="portal"><div className="portal-frame"><section className="portal-stage portal-error"><p className="eyeline">Game unavailable</p><h1>{room.error.problem.status === 410 ? "This game is no longer available." : "We could not find this game."}</h1><p>Check the room code with the Host and try again.</p></section></div></main>;
  if (!room.data) return <ScreenSkeleton portal />;
  const game = room.data;
  return <main className={`portal ${cursorVisible ? "" : "portal--cursor-hidden"}`}>
    <div className="portal-frame">
      <header className="portal-header"><p>Keynesian Beauty Contest</p><span>Game <strong>{game.code}</strong></span><ConnectionStatus state={room.connection} /><button className="fullscreen-button" onClick={() => void toggleFullscreen()}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button></header>
      <PortalStage game={game} />
      <footer className="portal-footer"><span>{game.currentRound ? `Round ${game.currentRound.number}` : game.status === "LOBBY" ? "Lobby" : "Final"}</span><span>{game.activeCount} active players · {game.submittedCount} submitted</span><TeamStandings game={game} compact /></footer>
    </div>
    <p className="portal-hint">Best viewed fullscreen</p>
  </main>;
}

function PortalStage({ game }: { game: PublicProjection }) {
  if (game.status === "LOBBY") return <Lobby game={game} />;
  if (game.status === "ROUND_OPEN") return <OpenRound game={game} />;
  if (game.status === "ROUND_LOCKED") return <Locked game={game} />;
  if (game.status === "FINISHED") return <Finished game={game} />;
  return <Reveal game={game} />;
}

function JoinQr({ code }: { code: string }) {
  const destination = useMemo(() => typeof window === "undefined" ? `/login?code=${code}` : new URL(`/login?code=${code}`, window.location.origin).toString(), [code]);
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => { void toDataURL(destination, { errorCorrectionLevel: "M", margin: 3, width: 480, color: { dark: "#F1F5F9", light: "#111827" } }).then(setImage); }, [destination]);
  return <div className="join-qr">{image ? <Image src={image} width={240} height={240} unoptimized alt={`QR code linking to ${destination}`} /> : <div className="qr-placeholder" aria-label="Preparing QR code" />}<a href={destination}>{destination}</a></div>;
}

function Lobby({ game }: { game: PublicProjection }) {
  const p = game.currentRound?.settings.p ?? "0.8";
  return <section className="portal-stage portal-lobby"><div className="lobby-copy"><p className="eyeline">The room is gathering</p><h1>Scan to join.</h1><p>Scan to sign in with your roster account.</p><p className="portal-code" aria-label={`Game code ${game.code}`}>{game.code}</p><p className="rule-copy">{ruleSentence(p)}</p><p>The host will open the first round when everyone is ready.</p></div><JoinQr code={game.code} /><RosterWall game={game} /></section>;
}

function OpenRound({ game }: { game: PublicProjection }) {
  const round = game.currentRound;
  if (!round) return null;
  return <section className="portal-stage portal-open"><p className="eyeline">Round {round.number}</p><h1>Choose for the room.</h1><p className="stage-rule">Closest to {multiplier(round.settings.p)} of the average wins.</p><Countdown className="portal-countdown" deadlineAt={round.deadlineAt} serverNow={game.serverNow} /><p className="portal-progress"><strong>{game.submittedCount}</strong> of {game.activeCount} submitted</p><RosterWall game={game} progress /></section>;
}

function Locked({ game }: { game: PublicProjection }) {
  return <section className="portal-stage portal-locked"><p className="eyeline">Round {game.currentRound?.number}</p><h1>Picks are locked.</h1><p>The Host will reveal the result shortly. {game.submittedCount} of {game.activeCount} active players submitted.</p><RosterWall game={game} progress /></section>;
}

function Reveal({ game }: { game: PublicProjection }) {
  const result = game.revealedRounds.at(-1);
  if (!result) return <section className="portal-stage"><h1>Preparing the result</h1></section>;
  return <section className="portal-stage portal-reveal"><div className="reveal-heading"><p className="eyeline">Round {result.number} result</p><h1>The room has spoken.</h1></div><div className="reveal-metrics"><Metric prominent label="Average" value={decimal(result.average)} /><Metric prominent label="Target" value={decimal(result.target)} /></div><WinnerLine game={game} result={result} /><Histogram result={result} /><EscalationNotice game={game} result={result} />{game.revealedRounds.length > 1 && <TrendChart rounds={game.revealedRounds} />}</section>;
}

function Finished({ game }: { game: PublicProjection }) {
  return <section className="portal-stage portal-finished"><div><p className="eyeline">Final result</p><h1>That&apos;s the game.</h1><p>{game.phase === "ESCALATION" ? "Final placement is based on survival through escalation." : "Final placement is based on points."}</p></div><Leaderboard game={game} /><TeamStandings game={game} /></section>;
}

function WinnerLine({ game, result }: { game: PublicProjection; result: RevealedRound }) {
  if (!result.winners.length) return <p className="winner-line">No eligible winner this round.</p>;
  return <p className="winner-line">Winner{result.winners.length === 1 ? "" : "s"}: <strong>{result.winners.map((winner) => `${game.players.find((player) => player.username === winner.username)?.displayName ?? winner.username} · ${tenths(winner.valueTenths)} · ${winner.points} pts`).join(" / ")}</strong></p>;
}

function RosterWall({ game, progress = false }: { game: PublicProjection; progress?: boolean }) {
  const names = game.players.length <= 60;
  return <section className="roster-wall" aria-label="Team roster"><h2>{progress ? "Live roster" : `${game.players.length} participants`}</h2>{game.teams.map((team) => { const players = game.players.filter((player) => player.teamId === team.id); if (!players.length) return null; return <div key={team.id}><h3><TeamMark name={team.name} color={team.color} />{team.name} <span>{players.length}</span></h3>{names ? <ul>{players.map((player) => <li key={player.username}><span>{player.displayName}</span><span>{player.status === "ELIMINATED" ? "Eliminated" : progress ? player.hasSubmitted ? "Submitted" : "Waiting" : "Joined"}</span></li>)}</ul> : <p>{players.filter((player) => player.status === "ACTIVE").length} active · {players.filter((player) => player.hasSubmitted).length} submitted</p>}</div>; })}</section>;
}

function Histogram({ result }: { result: RevealedRound }) {
  const bins = Array.from({ length: 10 }, (_, index) => ({ start: index * 10, count: 0 }));
  for (const pick of result.picks) bins[Math.min(9, Math.floor((pick.valueTenths / 10) / 10))].count += 1;
  const max = Math.max(1, ...bins.map((bin) => bin.count));
  const summary = result.picks.length ? `${result.picks.length} revealed picks. The highest bin contains ${max} pick${max === 1 ? "" : "s"}.` : "No valid picks were submitted this round.";
  return <figure className="histogram"><figcaption>Anonymous revealed picks</figcaption><div className="histogram-bars" role="img" aria-label={summary}>{bins.map((bin) => <div key={bin.start}><span style={{ height: `${(bin.count / max) * 100}%` }} aria-hidden="true" /><small>{bin.start}–{bin.start + 9.9}</small></div>)}</div><p>{summary}</p></figure>;
}

function TrendChart({ rounds }: { rounds: RevealedRound[] }) {
  const points = rounds.filter((round) => round.average !== null && round.target !== null).map((round) => ({ round: round.number, average: Number(round.average), target: Number(round.target) }));
  if (points.length < 2) return null;
  const highest = Math.max(...points.flatMap((point) => [point.average, point.target]), 1);
  return <figure className="trend-chart"><figcaption>Average and target by round</figcaption><div role="img" aria-label={points.map((point) => `Round ${point.round}: average ${decimal(point.average)}, target ${decimal(point.target)}`).join(". ")}>{points.map((point) => <div key={point.round}><span>R{point.round}</span><i style={{ width: `${(point.average / highest) * 100}%` }}>A {decimal(point.average)}</i><b style={{ width: `${(point.target / highest) * 100}%` }}>T {decimal(point.target)}</b></div>)}</div><p>Average and target are shown as labelled bars for each revealed round.</p></figure>;
}

function EscalationNotice({ game, result }: { game: PublicProjection; result: RevealedRound }) {
  return <div className="escalation-notice">{result.eliminatedUsername && <p>{game.players.find((player) => player.username === result.eliminatedUsername)?.displayName ?? result.eliminatedUsername} was eliminated.</p>}{game.escalationReason === "NASH" && <p>Nash equilibrium reached. Rule 1 begins next round.</p>}{game.escalationReason === "HOST" && <p>Escalation started by host. Rule 1 begins next round.</p>}</div>;
}

function Leaderboard({ game }: { game: PublicProjection }) {
  return <section className="leaderboard"><h2>Individual leaderboard</h2><ol>{game.individualLeaderboard.map((row) => { const player = game.players.find((item) => item.username === row.username); return <li key={row.username}><span>#{row.rank}</span><strong>{player?.displayName ?? row.username}</strong><span>{game.teams.find((team) => team.id === player?.teamId)?.name ?? ""}</span><span>{row.points} pts · {player?.status === "ELIMINATED" ? "Eliminated" : "Active"}{player?.finalPlacement ? ` · Place ${player.finalPlacement}` : ""}</span></li>; })}</ol></section>;
}

function TeamStandings({ game, compact = false }: { game: PublicProjection; compact?: boolean }) {
  return <section className={`team-standings ${compact ? "team-standings--compact" : ""}`}><h2>Team standings</h2><ol>{game.teamLeaderboard.map((row) => <li key={row.teamId}><span>#{row.rank}</span><span><TeamMark name={game.teams.find((team) => team.id === row.teamId)?.name ?? "Team"} color={game.teams.find((team) => team.id === row.teamId)?.color} />{game.teams.find((team) => team.id === row.teamId)?.name}</span><strong>{row.points} pts</strong></li>)}</ol></section>;
}

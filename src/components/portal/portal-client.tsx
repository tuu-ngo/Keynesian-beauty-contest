"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import { toDataURL } from "qrcode";
import type { PublicProjection, RevealedRound } from "@/contracts";
import { decimal, multiplier, ruleSentence, teamEscapeNotice, tenths } from "@/lib/formatters";
import { ConnectionStatus, Countdown, ScreenSkeleton, TeamMark } from "@/components/room/room-ui";
import { useRoomState } from "@/components/room/use-room-state";

export function PortalClient({ code }: { code: string }) {
  const room = useRoomState({ code, view: "public", pauseWhenHidden: false });
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement));
    const keyboard = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "f" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    document.addEventListener("fullscreenchange", update);
    window.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      window.removeEventListener("keydown", keyboard);
    };
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen?.();
  }

  if (!room.data && (room.error?.problem.status === 404 || room.error?.problem.status === 410)) {
    return <main className="portal"><div className="portal-frame portal-frame--error"><section className="portal-stage portal-error"><p className="eyeline">Game unavailable</p><h1>{room.error.problem.status === 410 ? "This game is no longer available." : "We could not find this game."}</h1><p>Check the room code with the Host and try again.</p></section></div></main>;
  }
  if (!room.data) return <ScreenSkeleton portal />;

  const game = room.data;
  return <main className="portal">
    <div className="portal-frame">
      <header className="portal-header">
        <p className="portal-brand"><span className="portal-brand-long">Keynesian Beauty Contest</span><span className="portal-brand-short">KBC</span></p>
        <span className="portal-header-code">Game <strong>{game.code}</strong></span>
        <ConnectionStatus state={room.connection} />
        <button className="fullscreen-button" onClick={() => void toggleFullscreen()}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
      </header>
      <PortalStage game={game} />
    </div>
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
  useEffect(() => {
    void toDataURL(destination, { errorCorrectionLevel: "M", margin: 3, width: 480, color: { dark: "#000000", light: "#FFFFFF" } }).then(setImage);
  }, [destination]);
  return <div className="join-qr">
    {image ? <Image src={image} width={240} height={240} unoptimized alt={`QR code linking to ${destination}`} /> : <div className="qr-placeholder" aria-label="Preparing QR code" />}
    <a href={destination} title={destination}>Open join page</a>
  </div>;
}

function Lobby({ game }: { game: PublicProjection }) {
  return <section className="portal-stage portal-lobby">
    <div className="lobby-copy">
      <p className="eyeline">Waiting for the Host</p>
      <h1>Join the room.</h1>
      <p className="portal-code" aria-label={`Game code ${game.code}`}>{game.code}</p>
      <p className="rule-copy">{game.nextRoundSettings.roundMode === "HOST_TARGET" ? "Get closest to the Host’s secret target." : ruleSentence(game.nextRoundSettings.p)}</p>
      <p className="lobby-count"><strong>{game.players.length}</strong> players joined</p>
    </div>
    <JoinQr code={game.code} />
  </section>;
}

function OpenRound({ game }: { game: PublicProjection }) {
  const round = game.currentRound;
  if (!round) return null;
  const hostTargetRound = round.settings.roundMode === "HOST_TARGET";
  const progress = game.activeCount ? Math.min(100, game.submittedCount / game.activeCount * 100) : 0;
  return <section className="portal-stage portal-open">
    <div className="round-copy">
      <p className="eyeline">Round {round.number}{round.settings.roundMode === "WAGER" ? " · Wager" : hostTargetRound ? " · Host target" : ""}</p>
      <h1>Make your pick.</h1>
      <p className="stage-rule">{hostTargetRound ? "Closest to the Host’s secret target wins." : `Closest to ${multiplier(round.settings.p)} of the average wins.`}{round.settings.roundMode === "WAGER" ? " Winning stakes return 2×." : ""}</p>
    </div>
    <div className="round-status">
      <span className="round-status-label">{round.deadlineAt ? "Time remaining" : "Round timer"}</span>
      <Countdown className={`portal-countdown ${round.deadlineAt ? "" : "portal-countdown--untimed"}`} deadlineAt={round.deadlineAt} serverNow={game.serverNow} paused={round.timerPaused} pausedRemainingMs={round.pausedRemainingMs} />
      <p className="portal-progress"><strong>{game.submittedCount}</strong><span> / {game.activeCount} submitted</span></p>
      <div className="portal-progress-track" role="progressbar" aria-valuenow={game.submittedCount} aria-valuemin={0} aria-valuemax={Math.max(1, game.activeCount)} aria-label="Submitted picks"><span style={{ width: `${progress}%` }} /></div>
      {round.timerPaused && <p className="round-status-note">Timer paused by the Host</p>}
    </div>
  </section>;
}

function Locked({ game }: { game: PublicProjection }) {
  return <section className="portal-stage portal-locked">
    <div>
      <p className="eyeline">Round {game.currentRound?.number}</p>
      <h1>Picks are locked.</h1>
      <p>The Host will reveal the result shortly.</p>
    </div>
    <div className="locked-count"><strong>{game.submittedCount}<span> / {game.activeCount}</span></strong><p>players in this round</p></div>
  </section>;
}

function Reveal({ game }: { game: PublicProjection }) {
  const result = game.revealedRounds.at(-1);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!result) return <section className="portal-stage portal-error"><h1>Preparing the result</h1></section>;
  const rows = buildRoundResultRows(game, result);
  const featuredRows = rows.filter((row) => row.pick).slice(0, 5);
  const teamNotice = teamEscapeNotice(game, result.escapedUsernames);
  const hasNotice = Boolean(result.eliminatedUsername || game.escalationReason || teamNotice);
  return <section className={`portal-stage portal-reveal ${hasNotice ? "portal-reveal--notice" : ""}`}>
    <header className="round-result-header">
      <div><p className="eyeline">Results</p><h1>Round {result.number}</h1></div>
      <WinnerLine game={game} result={result} />
    </header>
    <div className="round-results-layout">
      <DistributionChart result={result} />
      <RoundHighlights rows={featuredRows} total={rows.length} pickCount={result.picks.length} onOpen={() => setDetailsOpen(true)} />
    </div>
    {hasNotice && <p className="reveal-notice">{game.escalationReason && "Escalation phase. "}{result.eliminatedUsername && `${game.players.find((player) => player.username === result.eliminatedUsername)?.displayName ?? result.eliminatedUsername} was eliminated.`}{teamNotice}</p>}
    <RoundResultsDialog open={detailsOpen} onClose={() => setDetailsOpen(false)} result={result} rows={rows} />
  </section>;
}

function WinnerLine({ game, result }: { game: PublicProjection; result: RevealedRound }) {
  if (!result.winners.length) return <p className="winner-line">No eligible winner this round.</p>;
  const names = result.winners.map((winner) => game.players.find((player) => player.username === winner.username)?.displayName ?? winner.username);
  return <p className="winner-line"><span>{result.winners.length === 1 ? "Round winner" : `${result.winners.length} round winners`}</span><strong>{names.length <= 2 ? names.join(" · ") : `${names.slice(0, 2).join(" · ")} +${names.length - 2} more`}</strong></p>;
}

function buildRoundResultRows(game: PublicProjection, result: RevealedRound) {
  const picks = new Map(result.picks.map((pick) => [pick.username, pick]));
  const winners = new Set(result.winners.map((winner) => winner.username));
  const target = result.target === null ? null : Number(result.target);
  return game.players.map((player) => {
    const pick = picks.get(player.username) ?? null;
    const won = winners.has(player.username);
    const eliminated = result.eliminatedUsername === player.username || result.pointEliminatedUsernames.includes(player.username);
    return {
      player,
      pick,
      won,
      points: pick ? result.pointsByUsername[player.username] ?? 0 : null,
      distance: pick && target !== null ? Math.abs(pick.valueTenths / 10 - target) : null,
      status: won ? "Winner" : eliminated ? "Eliminated" : pick?.defaulted ? "Default pick" : pick ? "Played" : player.status === "ESCAPED" ? "Escaped" : "Did not play",
    };
  }).sort((a, b) => {
    const aOrder = !a.pick ? 3 : a.won ? 0 : a.pick.defaulted ? 2 : 1;
    const bOrder = !b.pick ? 3 : b.won ? 0 : b.pick.defaulted ? 2 : 1;
    if (aOrder !== bOrder) return aOrder - bOrder;
    if (a.distance !== null && b.distance !== null && a.distance !== b.distance) return a.distance - b.distance;
    return a.player.displayName.localeCompare(b.player.displayName);
  });
}

function DistributionChart({ result }: { result: RevealedRound }) {
  const bins = Array.from({ length: 10 }, (_, index) => ({ start: index * 10, end: index === 9 ? 100 : index * 10 + 10, count: 0 }));
  for (const pick of result.picks) bins[Math.min(9, Math.floor(pick.valueTenths / 100))].count += 1;
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
  const average = result.average === null ? null : Number(result.average);
  const target = result.target === null ? null : Number(result.target);
  const markersOverlap = average !== null && target !== null && Math.abs(average - target) < 12;
  const targetLabel = result.settings.roundMode === "HOST_TARGET" ? "Host target" : "Target";
  return <section className="distribution-panel" aria-labelledby={`distribution-title-${result.number}`}>
    <header className="distribution-heading">
      <div><p className="eyeline">How the room picked</p><h2 id={`distribution-title-${result.number}`}>Number distribution</h2></div>
      <span>{result.picks.length} {result.picks.length === 1 ? "pick" : "picks"}</span>
    </header>
    {result.picks.length ? <div className="distribution-plot">
      <div className="distribution-y-axis" aria-hidden="true"><span>{maxCount}</span><span>{Math.ceil(maxCount / 2)}</span><span /></div>
      <div className="distribution-canvas">
        <div className="distribution-grid" aria-hidden="true"><i /><i /><i /></div>
        <div className="distribution-bars" role="list" aria-label="Pick counts by number range">
          {bins.map((bin) => <div key={bin.start} className="distribution-bin" role="listitem" aria-label={`${bin.start} to ${bin.end}: ${bin.count} picks`}>
            <strong>{bin.count || ""}</strong>
            <i style={{ "--bar-size": `${Math.max(bin.count ? 5 : 0, bin.count / maxCount * 100)}%` } as CSSProperties} />
            <span>{bin.start}</span>
          </div>)}
        </div>
        <span className="distribution-axis-end" aria-hidden="true">100</span>
        {average !== null && <ChartMarker kind="average" label="Average" value={average} offset={markersOverlap} />}
        {target !== null && <ChartMarker kind="target" label={targetLabel} value={target} />}
      </div>
    </div> : <div className="distribution-empty"><strong>No picks to plot</strong><span>The chart will appear when a round has valid picks.</span></div>}
    <div className="distribution-legend">
      <span className="distribution-key distribution-key--average">Average <strong>{decimal(result.average)}</strong></span>
      <span className="distribution-key distribution-key--target">{targetLabel} <strong>{decimal(result.target)}</strong></span>
    </div>
  </section>;
}

function ChartMarker({ kind, label, value, offset = false }: { kind: "average" | "target"; label: string; value: number; offset?: boolean }) {
  const safeValue = Math.max(0, Math.min(100, value));
  const edge = safeValue < 12 ? "chart-marker--start" : safeValue > 88 ? "chart-marker--end" : "";
  return <span className={`chart-marker chart-marker--${kind} ${offset ? "chart-marker--offset" : ""} ${edge}`} style={{ "--marker-position": `${safeValue}%` } as CSSProperties} aria-label={`${label}: ${decimal(value)}`}>
    <span>{label} <strong>{decimal(value)}</strong></span>
  </span>;
}

function RoundHighlights({ rows, total, pickCount, onOpen }: { rows: ReturnType<typeof buildRoundResultRows>; total: number; pickCount: number; onOpen: () => void }) {
  return <aside className="round-highlights">
    <header><div><p className="eyeline">Round highlights</p><h2>Player results</h2></div><span>{pickCount} played</span></header>
    {rows.length ? <ol className="highlight-list">{rows.map((row) => <li key={row.player.username} className={row.won ? "highlight-row highlight-row--winner" : "highlight-row"}>
      <span className="highlight-player"><strong title={row.player.displayName}>{row.player.displayName}</strong><small>{row.status}</small></span>
      <span><small>Pick</small><strong>{row.pick ? tenths(row.pick.valueTenths) : "—"}</strong></span>
      <span><small>Round</small><strong>{row.points === null ? "—" : row.points > 0 ? `+${row.points}` : row.points}</strong></span>
      <span><small>Total</small><strong>{row.player.totalPoints}</strong></span>
    </li>)}</ol> : <div className="highlight-empty">No player submitted a pick.</div>}
    <button className="portal-detail-button" onClick={onOpen}>View all {total} results <span aria-hidden="true">↗</span></button>
  </aside>;
}

function buildLeaderboardRows(game: PublicProjection) {
  return game.individualLeaderboard.map((row) => {
    const player = game.players.find((item) => item.username === row.username);
    const placement = game.phase === "ESCALATION" ? player?.finalPlacement ?? row.rank : row.rank;
    return { ...row, placement, player, team: game.teams.find((team) => team.id === player?.teamId) };
  }).sort((a, b) => a.placement - b.placement || b.points - a.points || (a.player?.displayName ?? a.username).localeCompare(b.player?.displayName ?? b.username));
}

function Finished({ game }: { game: PublicProjection }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const rows = buildLeaderboardRows(game);
  const leaders = rows.filter((row) => row.placement === 1);
  const leaderNames = leaders.map((row) => row.player?.displayName ?? row.username);
  const winnerLabel = leaderNames.length === 1 ? leaderNames[0] : leaderNames.length > 1 ? `${leaderNames.length} joint winners` : "Game complete";
  return <section className="portal-stage portal-finished">
    <header className="final-header">
      <div><p className="eyeline">Game complete</p><h1>Final leaderboard</h1></div>
      <div className="final-winner"><span>{leaderNames.length === 1 ? "Champion" : "Top result"}</span><strong title={leaderNames.join(", ")}>{winnerLabel}</strong></div>
    </header>
    {teamEscapeNotice(game) && <p className="reveal-notice">{teamEscapeNotice(game)}</p>}
    <section className="final-leaderboard" aria-labelledby="final-standings-title">
      <header><div><p className="eyeline">Final standings</p><h2 id="final-standings-title">Top players</h2></div><span>{game.players.length} players · {game.revealedRounds.length} rounds</span></header>
      <div className="final-list-head" aria-hidden="true"><span>Place</span><span>Player</span><span>Team</span><span>Points</span></div>
      <ol className="final-leader-list">{rows.slice(0, 5).map((row) => <FinalLeaderboardRow key={row.username} row={row} />)}</ol>
      <button className="portal-detail-button" onClick={() => setDetailsOpen(true)}>View full leaderboard <span aria-hidden="true">↗</span></button>
    </section>
    <FinalDetailsDialog open={detailsOpen} onClose={() => setDetailsOpen(false)} game={game} rows={rows} />
  </section>;
}

function FinalLeaderboardRow({ row }: { row: ReturnType<typeof buildLeaderboardRows>[number] }) {
  const name = row.player?.displayName ?? row.username;
  return <li className={row.placement === 1 ? "final-leader-row final-leader-row--winner" : "final-leader-row"}>
    <span className="final-rank">#{row.placement}</span>
    <span className="final-player"><strong title={name}>{name}</strong>{row.placement === 1 && <small>Champion</small>}</span>
    <span className="final-team">{row.team && <TeamMark name={row.team.name} color={row.team.color} />}<span>{row.team?.name ?? "—"}</span></span>
    <strong className="final-points">{row.points} <small>pts</small></strong>
  </li>;
}

function PortalDialog({ open, onClose, title, eyebrow, children }: { open: boolean; onClose: () => void; title: string; eyebrow: string; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    let focusFrame = 0;
    if (!dialog.open) {
      dialog.showModal();
      focusFrame = window.requestAnimationFrame(() => dialog.querySelector<HTMLInputElement>(".portal-search input")?.focus());
    }
    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog.open) dialog.close();
    };
  }, [open]);
  if (!open) return null;
  return <dialog ref={dialogRef} className="portal-dialog" onClose={onClose} onMouseDown={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
    <div className="portal-dialog-panel">
      <header className="portal-dialog-header"><div><p className="eyeline">{eyebrow}</p><h2>{title}</h2></div><button className="portal-dialog-close" onClick={() => dialogRef.current?.close()} aria-label="Close details">Close <span aria-hidden="true">×</span></button></header>
      <div className="portal-dialog-content">{children}</div>
    </div>
  </dialog>;
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="portal-search"><span className="sr-only">Search</span><span aria-hidden="true">⌕</span><input autoFocus value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function RoundResultsDialog({ open, onClose, result, rows }: { open: boolean; onClose: () => void; result: RevealedRound; rows: ReturnType<typeof buildRoundResultRows> }) {
  const [query, setQuery] = useState("");
  const filtered = rows.filter((row) => row.player.displayName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <PortalDialog open={open} onClose={onClose} eyebrow={`Round ${result.number}`} title="All player results">
    <div className="portal-dialog-tools"><SearchField value={query} onChange={setQuery} placeholder="Search player name" /><span>{filtered.length} of {rows.length}</span></div>
    <RoundResultsTable result={result} rows={filtered} />
  </PortalDialog>;
}

function RoundResultsTable({ result, rows }: { result: RevealedRound; rows: ReturnType<typeof buildRoundResultRows> }) {
  return <div className="portal-data-scroll"><table className="portal-data-table">
    <thead><tr><th>Player</th><th>Pick</th><th>Distance</th><th>Round</th><th>Total</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.player.username} className={row.won ? "portal-data-row--winner" : ""}>
      <td><strong title={row.player.displayName}>{row.player.displayName}</strong><small>{row.status}{result.settings.roundMode === "WAGER" && row.pick ? ` · ${result.stakesByUsername[row.player.username] ?? 0} staked` : ""}</small></td>
      <td>{row.pick ? tenths(row.pick.valueTenths) : "—"}</td><td>{row.distance === null ? "—" : decimal(row.distance)}</td><td>{row.points === null ? "—" : row.points > 0 ? `+${row.points}` : row.points}</td><td>{row.player.totalPoints}</td>
    </tr>)}</tbody>
  </table>{!rows.length && <p className="portal-table-empty">No players match this search.</p>}</div>;
}

function FinalDetailsDialog({ open, onClose, game, rows }: { open: boolean; onClose: () => void; game: PublicProjection; rows: ReturnType<typeof buildLeaderboardRows> }) {
  const [tab, setTab] = useState<"players" | "teams" | "round">("players");
  const [query, setQuery] = useState("");
  const lastRound = game.revealedRounds.at(-1);
  const roundRows = lastRound ? buildRoundResultRows(game, lastRound) : [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const playerRows = rows.filter((row) => (row.player?.displayName ?? row.username).toLocaleLowerCase().includes(normalizedQuery));
  const teamRows = game.teamLeaderboard.filter((row) => (game.teams.find((team) => team.id === row.teamId)?.name ?? row.teamId).toLocaleLowerCase().includes(normalizedQuery));
  const filteredRoundRows = roundRows.filter((row) => row.player.displayName.toLocaleLowerCase().includes(normalizedQuery));
  return <PortalDialog open={open} onClose={onClose} eyebrow="Game complete" title="Full results">
    <div className="portal-dialog-tabs" role="tablist" aria-label="Full result views">
      <button role="tab" aria-selected={tab === "players"} onClick={() => { setTab("players"); setQuery(""); }}>Players</button>
      <button role="tab" aria-selected={tab === "teams"} onClick={() => { setTab("teams"); setQuery(""); }}>Teams</button>
      {lastRound && <button role="tab" aria-selected={tab === "round"} onClick={() => { setTab("round"); setQuery(""); }}>Last round</button>}
    </div>
    <div className="portal-dialog-tools"><SearchField value={query} onChange={setQuery} placeholder={tab === "teams" ? "Search team name" : "Search player name"} /><span>{tab === "players" ? `${playerRows.length} players` : tab === "teams" ? `${teamRows.length} teams` : `${filteredRoundRows.length} results`}</span></div>
    {tab === "players" ? <div className="portal-data-scroll"><table className="portal-data-table"><thead><tr><th>Place</th><th>Player</th><th>Team</th><th>Points</th></tr></thead><tbody>{playerRows.map((row) => <tr key={row.username} className={row.placement === 1 ? "portal-data-row--winner" : ""}><td>#{row.placement}</td><td><strong>{row.player?.displayName ?? row.username}</strong></td><td>{row.team?.name ?? "—"}</td><td>{row.points}</td></tr>)}</tbody></table>{!playerRows.length && <p className="portal-table-empty">No players match this search.</p>}</div> : tab === "teams" ? <div className="portal-data-scroll"><table className="portal-data-table"><thead><tr><th>Place</th><th>Team</th><th>Points</th></tr></thead><tbody>{teamRows.map((row) => { const team = game.teams.find((item) => item.id === row.teamId); return <tr key={row.teamId} className={row.rank === 1 ? "portal-data-row--winner" : ""}><td>#{row.rank}</td><td><strong className="dialog-team-name"><TeamMark name={team?.name ?? "Team"} color={team?.color} />{team?.name ?? "Team"}</strong></td><td>{row.points}</td></tr>; })}</tbody></table>{!teamRows.length && <p className="portal-table-empty">No teams match this search.</p>}</div> : lastRound ? <RoundResultsTable result={lastRound} rows={filteredRoundRows} /> : null}
  </PortalDialog>;
}

import type { StateResponse } from "@/contracts";
import type { Room } from "./model";
import { individualLeaderboard, teamLeaderboard } from "./model";

function currentRound(room: Room) {
  return room.run.rounds.at(-1) ?? null;
}

function finalPlacement(room: Room, username: string): number | null {
  const participant = room.run.participants[username];
  if (!participant || room.run.status !== "FINISHED") return null;
  const active = Object.values(room.run.participants).filter((other) => other.status === "ACTIVE");
  if (active.length === 1) {
    if (participant.status === "ACTIVE") return 1;
    if (participant.eliminatedInRound === null) return null;
    return Object.values(room.run.participants).filter((other) => (other.eliminatedInRound ?? -1) > participant.eliminatedInRound!).length + 2;
  }
  return individualLeaderboard(room.run).find((row) => row.username === username)?.rank ?? null;
}

export function project(room: Room, view: "public" | "player" | "host", now: number, username?: string): StateResponse {
  const round = currentRound(room);
  const isOpen = room.run.status === "ROUND_OPEN";
  const hasCurrentSubmissions = round !== null && room.run.status !== "LOBBY";
  const canCancelRoundResult = Boolean(round?.result) && (
    (room.run.status === "ROUND_REVEALED" && !(room.run.escalationReason === "HOST" && round?.revealStateBefore?.escalationReason !== "HOST"))
    || (room.run.status === "FINISHED" && room.run.finishedBy === "REVEAL")
  );
  const active = Object.values(room.run.participants).filter((participant) => participant.status === "ACTIVE");
  const base = {
    schemaVersion: 1 as const,
    code: room.code,
    runId: room.run.id,
    runNumber: room.run.number,
    version: room.version,
    serverNow: new Date(now).toISOString(),
    status: room.run.status,
    phase: room.run.phase,
    escalationReason: room.run.escalationReason,
    activeRules: room.run.activeRules,
    teams: room.teams,
    players: Object.values(room.run.participants).map((participant) => ({
      username: participant.username,
      displayName: participant.displayName,
      teamId: participant.teamId,
      hasSubmitted: hasCurrentSubmissions && participant.status === "ACTIVE" && round.picks[participant.username] !== undefined,
      status: participant.status,
      eliminatedInRound: participant.eliminatedInRound,
      totalPoints: participant.totalPoints,
      finalPlacement: finalPlacement(room, participant.username),
    })),
    currentRound: round ? {
      number: round.number,
      settings: round.settings,
      deadlineAt: isOpen ? round.deadlineAt : null,
      timerPaused: isOpen && round.timerPaused === true,
      pausedRemainingMs: isOpen && round.timerPaused === true ? round.pausedRemainingMs : null,
    } : null,
    nextRoundSettings: room.run.settingsForNextRound,
    submittedCount: hasCurrentSubmissions ? active.filter((participant) => round.picks[participant.username] !== undefined).length : 0,
    activeCount: active.length,
    revealedRounds: room.run.rounds.filter((candidate) => candidate.result !== null).map((candidate) => ({
      number: candidate.number,
      settings: candidate.settings,
      average: candidate.result!.average,
      target: candidate.result!.target,
      picks: Object.values(candidate.picks).map((valueTenths) => ({ valueTenths })),
      winners: candidate.result!.winners.map((winner) => ({ username: winner, valueTenths: candidate.picks[winner], points: candidate.result!.pointsByUsername[winner] ?? 0 })),
      eliminatedUsername: candidate.result!.eliminatedUsername,
      pointEliminatedUsernames: candidate.result!.pointEliminatedUsernames ?? [],
      pointsByUsername: candidate.result!.pointsByUsername,
    })),
    individualLeaderboard: individualLeaderboard(room.run),
    teamLeaderboard: teamLeaderboard(room),
  };
  if (view === "public") return { ...base, view };
  if (view === "host") {
    return {
      ...base,
      view,
      canCancelRoundResult,
      hostPicks: room.run.status === "ROUND_LOCKED" || room.run.status === "ROUND_REVEALED" || room.run.status === "FINISHED"
        ? Object.entries(round?.picks ?? {}).map(([pickUsername, valueTenths]) => ({ username: pickUsername, valueTenths }))
        : null,
    };
  }
  if (!username) throw new Error("Authenticated player is required.");
  if (view !== "player") throw new Error("Unknown projection view.");
  const participant = room.run.participants[username];
  // After RESET a valid session needs to discover the new run id before it can
  // submit the idempotent join request. It receives only its own safe default
  // state in the lobby; a non-participant never gains access after the roster
  // has been locked.
  if (!participant && room.run.status !== "LOBBY") throw new Error("Authenticated player is not a participant in this run.");
  return {
    ...base,
    view,
    self: {
      username,
      currentPickTenths: round?.picks[username] ?? null,
      totalPoints: participant?.totalPoints ?? 0,
      status: participant?.status ?? "ACTIVE",
      eliminatedInRound: participant?.eliminatedInRound ?? null,
    },
  };
}

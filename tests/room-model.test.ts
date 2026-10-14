import { describe, expect, it } from "vitest";
import { stateResponseSchema, type HostCommand } from "@/contracts";
import { applyCommand, createRoom, project, submitPick, type Room } from "@/lib/room";

const NOW = 1_700_000_000_000;

function room(): Room {
  return createRoom({
    code: "TEST",
    teams: [{ id: "red", name: "Red" }, { id: "blue", name: "Blue" }],
    accounts: [
      { username: "ada", password: "one", displayName: "Ada", teamId: "red" },
      { username: "bea", password: "two", displayName: "Bea", teamId: "blue" },
      { username: "cy", password: "three", displayName: "Cy", teamId: "blue" },
    ],
    now: NOW,
  });
}

function joinAll(input: Room): Room {
  const next = structuredClone(input);
  for (const [username, account] of Object.entries({ ada: next.accounts[0], bea: next.accounts[1], cy: next.accounts[2] })) {
    next.run.participants[username] = {
      username,
      displayName: account.displayName,
      teamId: account.teamId,
      joinedAt: new Date(NOW).toISOString(),
      status: "ACTIVE",
      eliminatedInRound: null,
      totalPoints: 0,
    };
  }
  return next;
}

function command(input: Room, type: HostCommand["type"], version = input.version): { room: Room; response: ReturnType<typeof applyCommand> } {
  const base = { type, commandId: crypto.randomUUID(), expectedVersion: version } as HostCommand;
  const response = applyCommand(input, base, NOW, "test-seed");
  return { room: response.room, response };
}

describe("room model", () => {
  it("replays a host command receipt without applying the transition twice", () => {
    const game = joinAll(room());
    const commandId = crypto.randomUUID();
    const command: HostCommand = { type: "OPEN_ROUND", commandId, expectedVersion: game.version };
    const first = applyCommand(game, command, NOW, "first-seed");
    const replay = applyCommand(first.room, { ...command, expectedVersion: 999 }, NOW + 1, "different-seed");

    expect(first.room.run.rounds).toHaveLength(1);
    expect(replay.room).toBe(first.room);
    expect(replay.result).toEqual(first.result);
  });

  it("does not expose other players' picks before reveal", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    game = submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 12.3, requestId: crypto.randomUUID(), now: NOW }).room;
    game = submitPick(game, { username: "bea", runId: game.run.id, round: 1, value: 20, requestId: crypto.randomUUID(), now: NOW }).room;

    const publicState = project(game, "public", NOW);
    const playerState = project(game, "player", NOW, "ada");
    const hostState = project(game, "host", NOW);
    if (hostState.view !== "host") throw new Error("Expected host projection.");

    expect(stateResponseSchema.safeParse(publicState).success).toBe(true);
    expect(stateResponseSchema.safeParse(playerState).success).toBe(true);
    expect(stateResponseSchema.safeParse(hostState).success).toBe(true);

    expect(JSON.stringify(publicState)).not.toContain("12.3");
    expect(JSON.stringify(publicState)).not.toContain("123");
    expect(JSON.stringify(playerState)).toContain("123");
    expect(JSON.stringify(playerState)).not.toContain("200");
    expect(hostState.hostPicks).toBeNull();

    game = command(game, "LOCK_ROUND").room;
    const lockedPublic = project(game, "public", NOW);
    expect(lockedPublic.submittedCount).toBe(2);
    expect(lockedPublic.players.filter((player) => player.hasSubmitted)).toHaveLength(2);
  });

  it("scores exact fractional targets, records command receipts, and only reveals after lock", () => {
    let game = joinAll(room());
    game.run.settingsForNextRound.p = "2/3";
    const opened = command(game, "OPEN_ROUND");
    game = opened.room;
    game = submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 10, requestId: crypto.randomUUID(), now: NOW }).room;
    game = submitPick(game, { username: "bea", runId: game.run.id, round: 1, value: 20, requestId: crypto.randomUUID(), now: NOW }).room;
    game = submitPick(game, { username: "cy", runId: game.run.id, round: 1, value: 60, requestId: crypto.randomUUID(), now: NOW }).room;
    game = command(game, "LOCK_ROUND").room;
    const revealed = command(game, "REVEAL_ROUND");
    game = revealed.room;

    expect(game.run.rounds[0].result?.target).toBe("20");
    expect(game.run.rounds[0].result?.winners).toEqual(["bea"]);
    expect(game.run.participants.bea.totalPoints).toBe(10);
    const hostState = project(game, "host", NOW);
    if (hostState.view !== "host") throw new Error("Expected host projection.");
    expect(hostState.hostPicks).toEqual(expect.arrayContaining([{ username: "bea", valueTenths: 200 }]));

    // A distinct id must not re-score an already revealed round.
    expect(() => applyCommand(game, { type: "REVEAL_ROUND", commandId: crypto.randomUUID(), expectedVersion: game.version }, NOW, "different")).toThrow("INVALID_TRANSITION");
  });

  it("moves from a Nash result into escalation, archives on reset, and issues a new run id", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    for (const username of ["ada", "bea", "cy"]) {
      game = submitPick(game, { username, runId: game.run.id, round: 1, value: 0, requestId: crypto.randomUUID(), now: NOW }).room;
    }
    game = command(game, "LOCK_ROUND").room;
    const revealed = command(game, "REVEAL_ROUND");
    game = revealed.room;
    const originalRun = game.run.id;

    expect(game.run.phase).toBe("ESCALATION");
    expect(game.run.escalationReason).toBe("NASH");
    expect(game.run.activeRules).toEqual([1]);

    game = command(game, "RESET").room;
    expect(game.run.id).not.toBe(originalRun);
    expect(game.run.status).toBe("LOBBY");
    expect(game.run.participants).toEqual({});
    expect(game.archives).toHaveLength(1);
    expect(game.archives[0].archive.run.rounds[0].result?.winners).toEqual(["ada", "bea", "cy"]);

    const resetPlayerView = project(game, "player", NOW, "ada");
    expect(resetPlayerView.view).toBe("player");
    if (resetPlayerView.view === "player") expect(resetPlayerView.self.currentPickTenths).toBeNull();
  });

  it("ranks by points when the host finishes early", () => {
    let game = joinAll(room());
    game.run.participants.ada.totalPoints = 20;
    game.run.participants.bea.totalPoints = 10;
    game.run.participants.cy.totalPoints = 10;
    game = command(game, "FINISH").room;
    const state = project(game, "public", NOW);

    expect(state.players.find((player) => player.username === "ada")?.finalPlacement).toBe(1);
    expect(state.players.find((player) => player.username === "bea")?.finalPlacement).toBe(2);
    expect(state.players.find((player) => player.username === "cy")?.finalPlacement).toBe(2);
  });
});

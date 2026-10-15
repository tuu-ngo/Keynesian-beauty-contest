import { describe, expect, it } from "vitest";
import { hostCommandSchema, stateResponseSchema, type HostCommand } from "@/contracts";
import { applyCommand, createRoom, project, publicArchive, registerPlayer, resolveDeadline, submitPick, type Room } from "@/lib/room";

const NOW = 1_700_000_000_000;

function room(): Room {
  return createRoom({
    code: "TEST",
    teams: [{ id: "red", name: "Red" }, { id: "blue", name: "Blue" }],
    now: NOW,
  });
}

function joinAll(input: Room): Room {
  let next = input;
  for (const name of ["Ada", "Bea", "Cy"]) next = registerPlayer(next, { name, now: NOW }).room;
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
    game = submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 13, requestId: crypto.randomUUID(), now: NOW }).room;
    game = submitPick(game, { username: "bea", runId: game.run.id, round: 1, value: 20, requestId: crypto.randomUUID(), now: NOW }).room;

    const publicState = project(game, "public", NOW);
    const playerState = project(game, "player", NOW, "ada");
    const hostState = project(game, "host", NOW);
    if (hostState.view !== "host") throw new Error("Expected host projection.");

    expect(stateResponseSchema.safeParse(publicState).success).toBe(true);
    expect(stateResponseSchema.safeParse(playerState).success).toBe(true);
    expect(stateResponseSchema.safeParse(hostState).success).toBe(true);

    expect(JSON.stringify(publicState)).not.toContain('"currentPickTenths"');
    expect(JSON.stringify(publicState)).not.toContain('"valueTenths":130');
    expect(JSON.stringify(playerState)).toContain('"currentPickTenths":130');
    expect(JSON.stringify(playerState)).not.toContain('"valueTenths":200');
    expect(hostState.hostPicks).toBeNull();

    game = command(game, "LOCK_ROUND").room;
    const lockedPublic = project(game, "public", NOW);
    expect(lockedPublic.submittedCount).toBe(2);
    expect(lockedPublic.players.filter((player) => player.hasSubmitted)).toHaveLength(2);
  });

  it("scores exact fractional targets, records command receipts, and only reveals after lock", () => {
    let game = joinAll(room());
    game.run.settingsForNextRound.p = "2/3";
    game.run.settingsForNextRound.startPoints = 0;
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

  it("lets the host cancel a revealed result and restores the prior round state", () => {
    let game = joinAll(room());
    game.run.settingsForNextRound.startPoints = 20;
    game.run.settingsForNextRound.losePoints = 10;
    game = command(game, "OPEN_ROUND").room;
    for (const [username, value] of Object.entries({ ada: 15, bea: 20, cy: 25 })) {
      game = submitPick(game, { username, runId: game.run.id, round: 1, value, requestId: crypto.randomUUID(), now: NOW }).room;
    }
    game = command(game, "LOCK_ROUND").room;
    game = command(game, "REVEAL_ROUND").room;
    expect(game.run.participants.ada.totalPoints).toBe(30);

    game = command(game, "CANCEL_ROUND_RESULT").room;
    expect(game.run.status).toBe("ROUND_LOCKED");
    expect(game.run.rounds[0].result).toBeNull();
    expect(game.run.rounds[0].revealedAt).toBeNull();
    expect(game.run.participants.ada.totalPoints).toBe(20);
    expect(game.run.participants.bea).toMatchObject({ totalPoints: 20, status: "ACTIVE", eliminatedInRound: null });
    expect(project(game, "public", NOW).revealedRounds).toEqual([]);
  });

  it("cancels a Nash result and restores normal play", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    for (const username of ["ada", "bea", "cy"]) {
      game = submitPick(game, { username, runId: game.run.id, round: 1, value: 0, requestId: crypto.randomUUID(), now: NOW }).room;
    }
    game = command(game, "LOCK_ROUND").room;
    game = command(game, "REVEAL_ROUND").room;
    expect(game.run).toMatchObject({ phase: "ESCALATION", escalationReason: "NASH", activeRules: [1] });

    game = command(game, "CANCEL_ROUND_RESULT").room;
    expect(game.run).toMatchObject({ status: "ROUND_LOCKED", phase: "NORMAL", escalationReason: null, activeRules: [] });
  });

  it("cancels an escalation result without undoing an earlier escalation transition", () => {
    let game = joinAll(room());
    game.run.settingsForNextRound.startPoints = 0;
    game = command(game, "OPEN_ROUND").room;
    for (const [username, value] of Object.entries({ ada: 10, bea: 20, cy: 60 })) {
      game = submitPick(game, { username, runId: game.run.id, round: 1, value, requestId: crypto.randomUUID(), now: NOW }).room;
    }
    game = command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
    game = command(game, "START_ESCALATION").room;
    game = command(game, "OPEN_ROUND").room;
    for (const [username, value] of Object.entries({ ada: 0, bea: 100, cy: 50 })) {
      game = submitPick(game, { username, runId: game.run.id, round: 2, value, requestId: crypto.randomUUID(), now: NOW }).room;
    }
    game = command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
    const eliminated = game.run.rounds[1].result?.eliminatedUsername;
    expect(eliminated).not.toBeNull();
    expect(game.run.activeRules).toEqual([1, 2]);

    game = command(game, "CANCEL_ROUND_RESULT").room;
    expect(game.run).toMatchObject({ status: "ROUND_LOCKED", phase: "ESCALATION", escalationReason: "HOST", activeRules: [1] });
    expect(game.run.participants[eliminated!]).toMatchObject({ status: "ACTIVE", eliminatedInRound: null });
  });

  it("does not offer cancellation after the host starts escalation from a revealed result", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    game = command(game, "LOCK_ROUND").room;
    game = command(game, "REVEAL_ROUND").room;
    game = command(game, "START_ESCALATION").room;
    const host = project(game, "host", NOW);
    if (host.view !== "host") throw new Error("Expected host projection.");
    expect(host.canCancelRoundResult).toBe(false);
  });

  it("lets the host cancel an automatically finishing result", () => {
    let game = joinAll(room());
    game.run.settingsForNextRound = { ...game.run.settingsForNextRound, startPoints: 10, losePoints: 10 };
    game = command(game, "OPEN_ROUND").room;
    for (const [username, value] of Object.entries({ ada: 15, bea: 20, cy: 25 })) {
      game = submitPick(game, { username, runId: game.run.id, round: 1, value, requestId: crypto.randomUUID(), now: NOW }).room;
    }
    game = command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
    expect(game.run).toMatchObject({ status: "FINISHED", finishedBy: "REVEAL" });
    const host = project(game, "host", NOW);
    if (host.view !== "host") throw new Error("Expected host projection.");
    expect(host.canCancelRoundResult).toBe(true);
    expect(game.archives).toHaveLength(1);

    game = command(game, "CANCEL_ROUND_RESULT").room;
    expect(game.run).toMatchObject({ status: "ROUND_LOCKED", finishedAt: null, finishedBy: null, archivedAt: null });
    expect(game.archives).toEqual([]);
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

  it("publishes the saved next-round settings before the round opens", () => {
    let game = joinAll(room());
    game = applyCommand(game, { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: game.version, payload: { p: "2/3", timerSeconds: null } }, NOW, "seed").room;
    const lobby = project(game, "public", NOW);
    expect(stateResponseSchema.safeParse(lobby).success).toBe(true);
    expect(lobby.currentRound).toBeNull();
    expect(lobby.nextRoundSettings).toMatchObject({ p: "2/3", timerSeconds: null });
  });

  it("hides open-round picks from a live Host export until the round locks", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    game = submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 13, requestId: crypto.randomUUID(), now: NOW }).room;
    expect(publicArchive(game, { hideOpenRoundPicks: true }).run.rounds[0].picks).toEqual({});
    game = command(game, "LOCK_ROUND").room;
    expect(publicArchive(game, { hideOpenRoundPicks: true }).run.rounds[0].picks).toEqual({ ada: 130 });
  });

  it("lets the host stop, resume, and reset an open round timer", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    const deadline = game.run.rounds[0].deadlineAt;

    game = applyCommand(game, { type: "PAUSE_TIMER", commandId: crypto.randomUUID(), expectedVersion: game.version }, NOW + 10_000, "seed").room;
    expect(game.run.rounds[0]).toMatchObject({ timerPaused: true, pausedRemainingMs: 50_000, deadlineAt: deadline });
    expect(resolveDeadline(game, NOW + 120_000).run.status).toBe("ROUND_OPEN");
    const paused = project(game, "host", NOW + 120_000);
    expect(paused.currentRound).toMatchObject({ timerPaused: true, pausedRemainingMs: 50_000 });

    game = applyCommand(game, { type: "RESUME_TIMER", commandId: crypto.randomUUID(), expectedVersion: game.version }, NOW + 120_000, "seed").room;
    expect(game.run.rounds[0]).toMatchObject({ timerPaused: false, pausedRemainingMs: null, deadlineAt: new Date(NOW + 170_000).toISOString() });

    game = applyCommand(game, { type: "RESET_TIMER", commandId: crypto.randomUUID(), expectedVersion: game.version }, NOW + 130_000, "seed").room;
    expect(game.run.rounds[0]).toMatchObject({ timerPaused: false, pausedRemainingMs: null, deadlineAt: new Date(NOW + 190_000).toISOString() });
  });

  it("drops stale pick and command receipts so the snapshot does not grow all game", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    const requestId = crypto.randomUUID();
    game = submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 10, requestId, now: NOW }).room;
    expect(submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 10, requestId, now: NOW }).changed).toBe(false);
    game = command(game, "LOCK_ROUND").room;
    game = command(game, "REVEAL_ROUND").room;
    game = command(game, "OPEN_ROUND").room;
    expect(game.pickReceipts).toEqual({});

    const reset: HostCommand = { type: "RESET", commandId: crypto.randomUUID(), expectedVersion: game.version };
    const first = applyCommand(game, reset, NOW, "seed");
    expect(Object.keys(first.room.commandReceipts)).toEqual([reset.commandId]);
    expect(applyCommand(first.room, reset, NOW + 1, "seed").room).toBe(first.room);
  });

  it("registers players by nickname alone and balances them across teams", () => {
    const game = joinAll(room());
    expect(game.accounts).toEqual([
      { username: "ada", displayName: "Ada", teamId: "red" },
      { username: "bea", displayName: "Bea", teamId: "blue" },
      { username: "cy", displayName: "Cy", teamId: "red" },
    ]);
    expect(Object.keys(game.run.participants)).toEqual(["ada", "bea", "cy"]);
  });

  it("normalizes nicknames and rejects duplicates, blanks, and late joins", () => {
    const game = joinAll(room());
    const code = (fn: () => unknown) => { try { fn(); return null; } catch (error) { return (error as { code?: string }).code; } };
    expect(registerPlayer(game, { name: "  <b>Dee</b>   Dee ", now: NOW }).account).toEqual({ username: "dee dee", displayName: "Dee Dee", teamId: "blue" });
    expect(code(() => registerPlayer(game, { name: "ADA", now: NOW }))).toBe("NAME_TAKEN");
    expect(code(() => registerPlayer(game, { name: "   ", now: NOW }))).toBe("VALIDATION_ERROR");
    expect(code(() => registerPlayer(game, { name: "x".repeat(21), now: NOW }))).toBe("VALIDATION_ERROR");
    const started = command(game, "OPEN_ROUND").room;
    expect(code(() => registerPlayer(started, { name: "Eve", now: NOW }))).toBe("INVALID_TRANSITION");
  });

  describe("configurable points", () => {
    function playRound(input: Room, picks: Record<string, number>, payload?: Extract<HostCommand, { type: "UPDATE_SETTINGS" }>["payload"]): Room {
      let game = input;
      if (payload) game = applyCommand(game, { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: game.version, payload }, NOW, "s").room;
      game = command(game, "OPEN_ROUND").room;
      for (const [username, value] of Object.entries(picks)) {
        game = submitPick(game, { username, runId: game.run.id, round: game.run.rounds.length, value, requestId: crypto.randomUUID(), now: NOW }).room;
      }
      game = command(game, "LOCK_ROUND").room;
      return command(game, "REVEAL_ROUND").room;
    }

    it("awards win points, deducts loss points and never drops below zero", () => {
      // avg 20, target 16 -> Ada (15) wins; Bea and Cy lose.
      let game = playRound(joinAll(room()), { ada: 15, bea: 20, cy: 25 }, { winPoints: 7, losePoints: 3, startPoints: 0 });
      expect(game.run.participants.ada.totalPoints).toBe(7);
      expect(game.run.participants.bea.totalPoints).toBe(0);
      expect(game.run.rounds[0].result!.pointsByUsername).toEqual({ ada: 7 });
      game = playRound(game, { ada: 25, bea: 15, cy: 20 });
      expect(game.run.participants.bea.totalPoints).toBe(7);
      expect(game.run.participants.ada.totalPoints).toBe(4);
      expect(game.run.rounds[1].result!.pointsByUsername).toMatchObject({ bea: 7, ada: -3 });
    });

    it("caps a player's total at maxPoints", () => {
      let game = playRound(joinAll(room()), { ada: 15, bea: 20, cy: 25 }, { winPoints: 10, maxPoints: 15, startPoints: 0 });
      game = playRound(game, { ada: 15, bea: 20, cy: 25 });
      expect(game.run.participants.ada.totalPoints).toBe(15);
      expect(game.run.rounds[1].result!.pointsByUsername.ada).toBe(5);
    });

    it("only accepts 60, 90, 120 or off as timer options", () => {
      const game = joinAll(room());
      const update = (timerSeconds: number | null) => ({ type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: game.version, payload: { timerSeconds } });
      for (const ok of [60, 90, 120, null]) expect(hostCommandSchema.safeParse(update(ok)).success).toBe(true);
      expect(hostCommandSchema.safeParse(update(45)).success).toBe(false);
    });
  });
  it("rejects picks that are not whole numbers between 0 and 100", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    const pick = (value: number) => () => submitPick(game, { username: "ada", runId: game.run.id, round: 1, value, requestId: crypto.randomUUID(), now: NOW });
    for (const bad of [12.5, 0.1, -1, 101]) expect(pick(bad)).toThrow();
    expect(pick(0)().result.pick).toBe(0);
    expect(pick(100)().result.pick).toBe(1000);
  });
  describe("elimination by points", () => {
    function playRound(input: Room, picks: Record<string, number>, payload?: Extract<HostCommand, { type: "UPDATE_SETTINGS" }>["payload"]): Room {
      let game = input;
      if (payload) game = applyCommand(game, { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: game.version, payload }, NOW, "s").room;
      game = command(game, "OPEN_ROUND").room;
      for (const [username, value] of Object.entries(picks)) {
        game = submitPick(game, { username, runId: game.run.id, round: game.run.rounds.length, value, requestId: crypto.randomUUID(), now: NOW }).room;
      }
      return command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
    }
    // avg 20, target 16: Ada (15) wins, Bea and Cy lose.
    const picks = { ada: 15, bea: 20, cy: 25 };

    it("gives everyone the starting points in the lobby", () => {
      const joined = joinAll(room());
      const game = applyCommand(joined, { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: joined.version, payload: { startPoints: 30 } }, NOW, "s").room;
      expect(Object.values(game.run.participants).map((p) => p.totalPoints)).toEqual([30, 30, 30]);
    });

    it("eliminates a player whose points reach 0 and keeps the game going", () => {
      let game = playRound(joinAll(room()), picks, { startPoints: 20, losePoints: 10, winPoints: 10 });
      expect(game.run.status).toBe("ROUND_REVEALED");
      expect(game.run.participants.bea.totalPoints).toBe(10);
      game = playRound(game, { ada: 15, bea: 20, cy: 25, });
      // Ada wins again; Bea and Cy hit 0 together, so both are out and Ada is last.
      expect(game.run.participants.bea.status).toBe("ELIMINATED");
      expect(game.run.participants.cy.status).toBe("ELIMINATED");
      expect(game.run.rounds[1].result!.pointEliminatedUsernames.sort()).toEqual(["bea", "cy"]);
      expect(game.run.status).toBe("FINISHED");
      const state = project(game, "public", NOW);
      expect(state.players.find((p) => p.username === "ada")!.finalPlacement).toBe(1);
    });

    it("eliminates only the player who reached 0", () => {
      let game = playRound(joinAll(room()), picks, { startPoints: 20, losePoints: 10, winPoints: 10 });
      // Round 2: avg 29.3, target 23.5 -> Bea (18) wins; Ada drops 30 -> 20, Cy drops 10 -> 0.
      game = playRound(game, { ada: 40, bea: 18, cy: 30 });
      expect(game.run.rounds[1].result!.pointEliminatedUsernames).toEqual(["cy"]);
      expect(game.run.participants.cy.status).toBe("ELIMINATED");
      expect(game.run.participants.ada.status).toBe("ACTIVE");
      expect(game.run.participants.ada.totalPoints).toBe(20);
      expect(game.run.status).toBe("ROUND_REVEALED");
    });

    it("is off when starting points are 0", () => {
      let game = playRound(joinAll(room()), picks, { startPoints: 0, losePoints: 10 });
      game = playRound(game, picks);
      expect(game.run.participants.bea.totalPoints).toBe(0);
      expect(game.run.participants.bea.status).toBe("ACTIVE");
    });
  });
});

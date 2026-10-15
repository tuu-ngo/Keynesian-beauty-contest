import { describe, expect, it } from "vitest";
import { hostCommandSchema, stateResponseSchema, type HostCommand } from "@/contracts";
import { applyCommand, createRoom, csvForArchive, project, publicArchive, registerPlayer, resolveDeadline, submitPick, type Room } from "@/lib/room";

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
  const response = applyCommand(input, base, NOW);
  return { room: response.room, response };
}

function settings(input: Room, payload: Extract<HostCommand, { type: "UPDATE_SETTINGS" }>["payload"]): Room {
  return applyCommand(input, { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: input.version, payload }, NOW).room;
}

describe("room model", () => {
  it("replays a host command receipt without applying the transition twice", () => {
    const game = joinAll(room());
    const commandId = crypto.randomUUID();
    const command: HostCommand = { type: "OPEN_ROUND", commandId, expectedVersion: game.version };
    const first = applyCommand(game, command, NOW);
    const replay = applyCommand(first.room, { ...command, expectedVersion: 999 }, NOW + 1);

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
    // Cy never saved a pick, so the default of 50 is applied at lock.
    expect(lockedPublic.submittedCount).toBe(3);
    expect(lockedPublic.players.filter((player) => player.hasSubmitted)).toHaveLength(3);
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
    expect(hostState.hostPicks).toEqual(expect.arrayContaining([{ username: "bea", valueTenths: 200, stakePoints: 0 }]));

    // A distinct id must not re-score an already revealed round.
    expect(() => applyCommand(game, { type: "REVEAL_ROUND", commandId: crypto.randomUUID(), expectedVersion: game.version }, NOW)).toThrow("INVALID_TRANSITION");
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
    expect(game.run.activeRules).toEqual([1, 2]);

    game = command(game, "RESET").room;
    expect(game.run.id).not.toBe(originalRun);
    expect(game.run.status).toBe("LOBBY");
    expect(game.run.participants).toEqual({});
    expect(game.archives).toHaveLength(1);
    // Rule 1 only starts after Nash, so the all-zero Nash round itself is a three-way win.
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
    expect(game.run).toMatchObject({ phase: "ESCALATION", escalationReason: "NASH", activeRules: [1, 2] });

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
    // Rule 2: a lone 100 beats the 0. Nobody is knocked out.
    expect(game.run.rounds[1].result?.winners).toEqual(["bea"]);
    expect(game.run.rounds[1].result?.eliminatedUsername).toBeNull();
    expect(game.run.participants.bea.totalPoints).toBe(20);

    game = command(game, "CANCEL_ROUND_RESULT").room;
    expect(game.run).toMatchObject({ status: "ROUND_LOCKED", phase: "ESCALATION", escalationReason: "HOST", activeRules: [1, 2] });
    expect(game.run.participants.bea.totalPoints).toBe(10);
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
    game = applyCommand(game, { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: game.version, payload: { p: "2/3", timerSeconds: null } }, NOW).room;
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
    expect(publicArchive(game, { hideOpenRoundPicks: true }).run.rounds[0].picks).toEqual({ ada: 130, bea: 500, cy: 500 });
  });

  it("lets the host stop, resume, and reset an open round timer", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    const deadline = game.run.rounds[0].deadlineAt;

    game = applyCommand(game, { type: "PAUSE_TIMER", commandId: crypto.randomUUID(), expectedVersion: game.version }, NOW + 10_000).room;
    expect(game.run.rounds[0]).toMatchObject({ timerPaused: true, pausedRemainingMs: 50_000, deadlineAt: deadline });
    expect(resolveDeadline(game, NOW + 120_000).run.status).toBe("ROUND_OPEN");
    const paused = project(game, "host", NOW + 120_000);
    expect(paused.currentRound).toMatchObject({ timerPaused: true, pausedRemainingMs: 50_000 });

    game = applyCommand(game, { type: "RESUME_TIMER", commandId: crypto.randomUUID(), expectedVersion: game.version }, NOW + 120_000).room;
    expect(game.run.rounds[0]).toMatchObject({ timerPaused: false, pausedRemainingMs: null, deadlineAt: new Date(NOW + 170_000).toISOString() });

    game = applyCommand(game, { type: "RESET_TIMER", commandId: crypto.randomUUID(), expectedVersion: game.version }, NOW + 130_000).room;
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
    const first = applyCommand(game, reset, NOW);
    expect(Object.keys(first.room.commandReceipts)).toEqual([reset.commandId]);
    expect(applyCommand(first.room, reset, NOW + 1).room).toBe(first.room);
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
      if (payload) game = applyCommand(game, { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: game.version, payload }, NOW).room;
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

    it("only accepts 60, 90, 120 or off as timer options", () => {
      const game = joinAll(room());
      const update = (timerSeconds: number | null) => ({ type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: game.version, payload: { timerSeconds } });
      for (const ok of [60, 90, 120, null]) expect(hostCommandSchema.safeParse(update(ok)).success).toBe(true);
      expect(hostCommandSchema.safeParse(update(45)).success).toBe(false);
    });
  });
  describe("wager rounds", () => {
    // Ada (30) and Bea (50) tie at distance 10 from the target of 40 without
    // picking the same number, which Rule 1 would turn into a loss.
    function wagerRound(input: Room, submissions: Record<string, { value: number; stake: number }>, payload: Extract<HostCommand, { type: "UPDATE_SETTINGS" }>["payload"] = {}): Room {
      let game = applyCommand(input, {
        type: "UPDATE_SETTINGS",
        commandId: crypto.randomUUID(),
        expectedVersion: input.version,
        payload: { roundMode: "WAGER", ...payload },
      }, NOW).room;
      game = command(game, "OPEN_ROUND").room;
      for (const [username, submission] of Object.entries(submissions)) {
        game = submitPick(game, { username, runId: game.run.id, round: game.run.rounds.length, ...submission, requestId: crypto.randomUUID(), now: NOW }).room;
      }
      return command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
    }

    it("doubles each winner's stake, forfeits losing stakes, then applies basic scoring", () => {
      const game = wagerRound(joinAll(room()), {
        ada: { value: 30, stake: 10 },
        bea: { value: 50, stake: 20 },
        cy: { value: 70, stake: 10 },
      }, { startPoints: 100, winPoints: 10, losePoints: 5 });
      const result = game.run.rounds[0].result!;

      expect(result.winners).toEqual(["ada", "bea"]);
      expect(result.wagerPot).toBe(40);
      expect(result.payoutsByUsername).toEqual({ ada: 20, bea: 40 });
      expect(result.wagerPointsByUsername).toEqual({ ada: 10, bea: 20, cy: -10 });
      expect(result.basePointsByUsername).toEqual({ ada: 10, bea: 10, cy: -5 });
      expect(result.pointsByUsername).toEqual({ ada: 20, bea: 30, cy: -15 });
      expect(Object.fromEntries(Object.entries(game.run.participants).map(([username, player]) => [username, player.totalPoints]))).toEqual({ ada: 120, bea: 130, cy: 85 });
    });

    it("pays every tied winner at the same fixed two-times odds", () => {
      const game = wagerRound(joinAll(room()), {
        ada: { value: 30, stake: 1 },
        bea: { value: 50, stake: 1 },
        cy: { value: 70, stake: 1 },
      }, { winPoints: 0, losePoints: 0 });
      expect(game.run.rounds[0].result?.payoutsByUsername).toEqual({ ada: 2, bea: 2 });
      expect(game.run.rounds[0].result?.wagerPointsByUsername).toEqual({ ada: 1, bea: 1, cy: -1 });
    });

    it("does not refund a loser's stake when the winners staked zero", () => {
      const game = wagerRound(joinAll(room()), {
        ada: { value: 30, stake: 0 },
        bea: { value: 50, stake: 0 },
        cy: { value: 70, stake: 30 },
      }, { winPoints: 0, losePoints: 0 });
      const result = game.run.rounds[0].result!;
      expect(result).toMatchObject({ wagerPot: 30, wagerRefunded: false, payoutsByUsername: {}, wagerPointsByUsername: { cy: -30 }, pointsByUsername: { cy: -30 } });
      expect(game.run.participants.cy.totalPoints).toBe(70);
    });

    it("keeps stakes private while open and reveals them after lock/reveal", () => {
      let game = applyCommand(joinAll(room()), { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: 0, payload: { roundMode: "WAGER" } }, NOW).room;
      game = command(game, "OPEN_ROUND").room;
      game = submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 10, stake: 25, requestId: crypto.randomUUID(), now: NOW }).room;

      const publicOpen = project(game, "public", NOW);
      const playerOpen = project(game, "player", NOW, "ada");
      const hostOpen = project(game, "host", NOW);
      expect(JSON.stringify(publicOpen)).not.toContain('"stakePoints":25');
      expect(playerOpen.view === "player" && playerOpen.self.currentStakePoints).toBe(25);
      expect(hostOpen.view === "host" && hostOpen.hostPicks).toBeNull();
      expect(publicArchive(game, { hideOpenRoundPicks: true }).run.rounds[0].stakes).toEqual({});

      game = command(game, "LOCK_ROUND").room;
      const hostLocked = project(game, "host", NOW);
      expect(hostLocked.view === "host" && hostLocked.hostPicks).toEqual(expect.arrayContaining([{ username: "ada", valueTenths: 100, stakePoints: 25 }]));
      game = command(game, "REVEAL_ROUND").room;
      expect(project(game, "public", NOW).revealedRounds[0].stakesByUsername).toMatchObject({ ada: 25, bea: 0, cy: 0 });
    });

    it("rejects invalid stakes and defaults non-submitters to a zero stake", () => {
      let standard = joinAll(room());
      standard = command(standard, "OPEN_ROUND").room;
      expect(() => submitPick(standard, { username: "ada", runId: standard.run.id, round: 1, value: 10, stake: 1, requestId: crypto.randomUUID(), now: NOW })).toThrow("A stake is only allowed");

      let game = applyCommand(joinAll(room()), { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: 0, payload: { roundMode: "WAGER", startPoints: 20 } }, NOW).room;
      game = command(game, "OPEN_ROUND").room;
      expect(() => submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 10, stake: 21, requestId: crypto.randomUUID(), now: NOW })).toThrow("Stake cannot exceed");
      game = submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 10, stake: 20, requestId: crypto.randomUUID(), now: NOW }).room;
      game = command(game, "LOCK_ROUND").room;
      expect(game.run.rounds[0].picks).toMatchObject({ bea: 500, cy: 500 });
      expect(game.run.rounds[0].stakes).toEqual({ ada: 20, bea: 0, cy: 0 });
    });

    it("restores every wager and basic point change when the host cancels a result", () => {
      let game = wagerRound(joinAll(room()), {
        ada: { value: 10, stake: 10 },
        bea: { value: 10, stake: 20 },
        cy: { value: 70, stake: 30 },
      }, { startPoints: 100, winPoints: 10, losePoints: 5 });
      game = command(game, "CANCEL_ROUND_RESULT").room;
      expect(Object.values(game.run.participants).map((player) => player.totalPoints)).toEqual([100, 100, 100]);
      expect(game.run.rounds[0].result).toBeNull();
      expect(game.run.rounds[0].stakes).toEqual({ ada: 10, bea: 20, cy: 30 });
    });

    it("snapshots mode per round so the host can switch back to standard", () => {
      let game = wagerRound(joinAll(room()), {
        ada: { value: 10, stake: 10 }, bea: { value: 20, stake: 10 }, cy: { value: 30, stake: 10 },
      });
      game = applyCommand(game, { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: game.version, payload: { roundMode: "STANDARD" } }, NOW).room;
      game = command(game, "OPEN_ROUND").room;
      expect(game.run.rounds[0].settings.roundMode).toBe("WAGER");
      expect(game.run.rounds[1].settings.roundMode).toBe("STANDARD");
    });

    it("keeps projections compatible with snapshots created before wager fields existed", () => {
      let game = joinAll(room());
      game = command(game, "OPEN_ROUND").room;
      game = command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
      const legacy = game as unknown as {
        run: { settingsForNextRound: { roundMode?: string }; rounds: Array<{ settings: { roundMode?: string }; stakes?: Record<string, number>; result: Record<string, unknown> | null }> };
      };
      delete legacy.run.settingsForNextRound.roundMode;
      delete legacy.run.rounds[0].settings.roundMode;
      delete legacy.run.rounds[0].stakes;
      const legacyResult = legacy.run.rounds[0].result!;
      for (const key of ["basePointsByUsername", "wagerPointsByUsername", "payoutsByUsername", "wagerPot", "wagerRefunded"]) delete legacyResult[key];

      const state = project(game, "player", NOW, "ada");
      expect(stateResponseSchema.safeParse(state).success).toBe(true);
      expect(state.currentRound?.settings.roundMode).toBe("STANDARD");
      expect(state.nextRoundSettings.roundMode).toBe("STANDARD");
      expect(state.view === "player" && state.self.currentStakePoints).toBe(0);
    });

    it("includes wager settlement columns in CSV exports", () => {
      const game = wagerRound(joinAll(room()), {
        ada: { value: 10, stake: 10 }, bea: { value: 10, stake: 20 }, cy: { value: 70, stake: 30 },
      });
      const csv = csvForArchive(publicArchive(game));
      expect(csv.split("\r\n")[0]).toBe("runId,round,roundMode,username,displayName,teamId,pick,distance,stake,payout,wagerPoints,basePoints,points,winner,eliminated");
      expect(csv).toContain(",WAGER,ada,Ada,red,10,");
    });
  });
  describe("Host target rounds", () => {
    function prepare(input: Room, target: number): Room {
      return applyCommand(input, {
        type: "UPDATE_SETTINGS",
        commandId: crypto.randomUUID(),
        expectedVersion: input.version,
        payload: { roundMode: "HOST_TARGET", hostTarget: target },
      }, NOW).room;
    }

    it("keeps the fixed target secret until reveal and awards equally close players", () => {
      let game = prepare(joinAll(room()), 37);
      const lobbyPublic = project(game, "public", NOW);
      const lobbyHost = project(game, "host", NOW);
      expect("nextHostTarget" in lobbyPublic).toBe(false);
      expect(lobbyHost.view === "host" && lobbyHost.nextHostTarget).toBe(37);

      game = command(game, "OPEN_ROUND").room;
      expect(game.run.rounds[0].hostTargetTenths).toBe(370);
      const publicOpen = project(game, "public", NOW);
      const playerOpen = project(game, "player", NOW, "ada");
      const hostOpen = project(game, "host", NOW);
      expect(JSON.stringify(publicOpen)).not.toContain("hostTarget");
      expect(JSON.stringify(playerOpen)).not.toContain("hostTarget");
      expect(hostOpen.view === "host" && hostOpen.currentHostTarget).toBe(37);
      expect(publicArchive(game, { hideOpenRoundPicks: true }).run.rounds[0].hostTargetTenths).toBeNull();

      for (const [username, value] of Object.entries({ ada: 35, bea: 39, cy: 80 })) {
        game = submitPick(game, { username, runId: game.run.id, round: 1, value, requestId: crypto.randomUUID(), now: NOW }).room;
      }
      game = command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
      expect(game.run.rounds[0].result).toMatchObject({ target: "37", winners: ["ada", "bea"] });
      expect(project(game, "public", NOW).revealedRounds[0]).toMatchObject({ target: "37", winners: [{ username: "ada" }, { username: "bea" }] });
    });

    it("does not trigger Nash when everyone chooses zero", () => {
      let game = prepare(joinAll(room()), 10);
      game = command(game, "OPEN_ROUND").room;
      for (const username of ["ada", "bea", "cy"]) {
        game = submitPick(game, { username, runId: game.run.id, round: 1, value: 0, requestId: crypto.randomUUID(), now: NOW }).room;
      }
      game = command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
      expect(game.run).toMatchObject({ status: "ROUND_REVEALED", phase: "NORMAL", escalationReason: null, activeRules: [] });
    });

    it("requires a valid saved target and excludes this mode from escalation", () => {
      const joined = joinAll(room());
      expect(() => applyCommand(joined, {
        type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: joined.version, payload: { roundMode: "HOST_TARGET" },
      }, NOW)).toThrow("Choose a Host target");
      expect(hostCommandSchema.safeParse({
        type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: joined.version, payload: { roundMode: "HOST_TARGET", hostTarget: 37.5 },
      }).success).toBe(false);

      let game = prepare(joined, 37);
      game = command(game, "OPEN_ROUND").room;
      game = command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
      game = command(game, "START_ESCALATION").room;
      expect(game.run.settingsForNextRound.roundMode).toBe("STANDARD");
      expect(game.run.nextHostTargetTenths).toBeNull();
      expect(() => applyCommand(game, {
        type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: game.version, payload: { roundMode: "HOST_TARGET", hostTarget: 20 },
      }, NOW)).toThrow("only available during normal play");
    });

    it("keeps the snapshotted target when a result is cancelled and revealed again", () => {
      let game = prepare(joinAll(room()), 42);
      game = command(game, "OPEN_ROUND").room;
      for (const [username, value] of Object.entries({ ada: 40, bea: 44, cy: 80 })) {
        game = submitPick(game, { username, runId: game.run.id, round: 1, value, requestId: crypto.randomUUID(), now: NOW }).room;
      }
      game = command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
      const first = game.run.rounds[0].result?.winners;
      game = command(game, "CANCEL_ROUND_RESULT").room;
      expect(game.run.rounds[0].hostTargetTenths).toBe(420);
      game = command(game, "REVEAL_ROUND").room;
      expect(game.run.rounds[0].result).toMatchObject({ target: "42", winners: first });
    });

    it("uses the fixed target for CSV distances while default picks remain ineligible", () => {
      let game = prepare(joinAll(room()), 50);
      game = command(game, "OPEN_ROUND").room;
      game = command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
      expect(game.run.rounds[0].result?.winners).toEqual([]);
      const csv = csvForArchive(publicArchive(game));
      expect(csv).toContain(",HOST_TARGET,ada,Ada,red,50,0,");
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
      if (payload) game = applyCommand(game, { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: game.version, payload }, NOW).room;
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
      const game = applyCommand(joined, { type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: joined.version, payload: { startPoints: 30 } }, NOW).room;
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

  it("counts the default pick of 50 for players who never pressed save", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    game = submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 20, requestId: crypto.randomUUID(), now: NOW }).room;
    game = command(game, "LOCK_ROUND").room;
    expect(game.run.rounds[0].picks).toEqual({ ada: 200, bea: 500, cy: 500 });
    game = command(game, "REVEAL_ROUND").room;
    expect(game.run.rounds[0].result!.average).toBe("40");
  });

  it("applies the default pick when the round deadline locks it", () => {
    let game = joinAll(room());
    game = command(game, "OPEN_ROUND").room;
    const deadline = Date.parse(game.run.rounds[0].deadlineAt!);
    game = submitPick(game, { username: "ada", runId: game.run.id, round: 1, value: 10, requestId: crypto.randomUUID(), now: NOW }).room;
    game = resolveDeadline(game, deadline + 1);
    expect(game.run.status).toBe("ROUND_LOCKED");
    expect(game.run.rounds[0].picks).toEqual({ ada: 100, bea: 500, cy: 500 });
  });

  describe("default picks", () => {
    function pick(game: Room, username: string, value: number): Room {
      const round = game.run.rounds.at(-1)!.number;
      return submitPick(game, { username, runId: game.run.id, round, value, requestId: crypto.randomUUID(), now: NOW }).room;
    }

    function escalated(): Room {
      let game = command(joinAll(room()), "OPEN_ROUND").room;
      game = command(game, "LOCK_ROUND").room;
      game = command(game, "REVEAL_ROUND").room;
      return command(game, "START_ESCALATION").room;
    }

    it("counts a default pick in the average but never lets it win", () => {
      let game = command(joinAll(room()), "OPEN_ROUND").room;
      game = pick(game, "ada", 90);
      game = pick(game, "bea", 10);
      game = command(game, "LOCK_ROUND").room;
      expect(game.run.rounds[0].defaultedUsernames).toEqual(["cy"]);
      game = command(game, "REVEAL_ROUND").room;
      const result = game.run.rounds[0].result!;
      // Cy's default 50 sits exactly 10 from the target of 40, closer than Bea's 30.
      expect(result.average).toBe("50");
      expect(result.target).toBe("40");
      expect(result.winners).toEqual(["bea"]);
      expect(result.pointsByUsername.cy).toBeUndefined();
    });

    it("gives no winner and no points when nobody pressed save", () => {
      let game = command(joinAll(room()), "OPEN_ROUND").room;
      game = command(game, "LOCK_ROUND").room;
      game = command(game, "REVEAL_ROUND").room;
      const result = game.run.rounds[0].result!;
      expect(result.average).toBe("50");
      expect(result.winners).toEqual([]);
      expect(result.pointsByUsername).toEqual({});
      expect(game.run.phase).toBe("NORMAL");
    });

    it("treats a non-submitter as a loser in escalation without knocking anyone out", () => {
      let game = command(settings(escalated(), { losePoints: 5 }), "OPEN_ROUND").room;
      game = pick(game, "ada", 90);
      game = pick(game, "bea", 10);
      game = command(game, "LOCK_ROUND").room;
      game = command(game, "REVEAL_ROUND").room;
      const result = game.run.rounds[1].result!;
      expect(result.winners).toEqual(["bea"]);
      expect(result.pointsByUsername).toEqual({ ada: -5, bea: 10, cy: -5 });
      expect(result.eliminatedUsername).toBeNull();
      expect(Object.values(game.run.participants).map((player) => player.status)).toEqual(["ACTIVE", "ACTIVE", "ACTIVE"]);
    });

    it("does not make a real pick of 50 a Rule 1 duplicate of a default", () => {
      let game = command(escalated(), "OPEN_ROUND").room;
      game = pick(game, "ada", 50);
      game = pick(game, "bea", 10);
      game = command(game, "LOCK_ROUND").room;
      game = command(game, "REVEAL_ROUND").room;
      expect(game.run.rounds[1].disqualifiedUsernames).toEqual([]);
      expect(game.run.rounds[1].result!.winners).toEqual(["bea"]);
    });
  });

  describe("Rule 1", () => {
    function pick(game: Room, username: string, value: number): Room {
      const round = game.run.rounds.at(-1)!.number;
      return submitPick(game, { username, runId: game.run.id, round, value, requestId: crypto.randomUUID(), now: NOW }).room;
    }

    function playRound(input: Room, picks: Record<string, number>): Room {
      let game = command(input, "OPEN_ROUND").room;
      for (const [username, value] of Object.entries(picks)) game = pick(game, username, value);
      return command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
    }

    function escalated(input = joinAll(room())): Room {
      let game = command(input, "OPEN_ROUND").room;
      game = command(command(game, "LOCK_ROUND").room, "REVEAL_ROUND").room;
      return command(game, "START_ESCALATION").room;
    }

    it("is not active before escalation, so duplicate picks can win a normal round", () => {
      // Target 29.33: Ada and Bea share the closest pick.
      const game = playRound(settings(joinAll(room()), { losePoints: 5 }), { ada: 20, bea: 20, cy: 70 });
      expect(game.run.activeRules).toEqual([]);
      expect(game.run.rounds[0].disqualifiedUsernames).toEqual([]);
      expect(game.run.rounds[0].result!.winners).toEqual(["ada", "bea"]);
    });

    it("makes duplicate picks lose once escalation starts", () => {
      const game = playRound(escalated(settings(joinAll(room()), { losePoints: 5 })), { ada: 20, bea: 20, cy: 70 });
      const result = game.run.rounds[1].result!;
      expect(game.run.activeRules).toEqual([1, 2]);
      expect(game.run.rounds[1].disqualifiedUsernames).toEqual(["ada", "bea"]);
      expect(result.winners).toEqual(["cy"]);
      expect(result.pointsByUsername).toEqual({ ada: -5, bea: -5, cy: 10 });
      expect(result.eliminatedUsername).toBeNull();
    });

    it("only eliminates players whose points run out", () => {
      const game = playRound(escalated(settings(joinAll(room()), { startPoints: 5, losePoints: 5 })), { ada: 20, bea: 20, cy: 70 });
      const result = game.run.rounds[1].result!;
      expect(result.eliminatedUsername).toBeNull();
      expect(result.pointEliminatedUsernames).toEqual(["ada", "bea"]);
      expect(game.run.status).toBe("FINISHED");
      expect(game.run.participants.cy.status).toBe("ACTIVE");
    });

    it("lets the host tick Rule 1 in normal play and untick it during escalation", () => {
      let game = settings(joinAll(room()), { activeRules: [1] });
      expect(game.run.activeRules).toEqual([1]);
      game = playRound(game, { ada: 20, bea: 20, cy: 70 });
      expect(game.run.phase).toBe("NORMAL");
      expect(game.run.rounds[0].result!.winners).toEqual(["cy"]);

      game = command(game, "START_ESCALATION").room;
      expect(game.run.activeRules).toEqual([1, 2]);
      game = settings(game, { activeRules: [2] });
      game = playRound(game, { ada: 20, bea: 20, cy: 70 });
      expect(game.run.rounds[1].disqualifiedUsernames).toEqual([]);
      expect(game.run.rounds[1].result!.winners).toEqual(["ada", "bea"]);
    });

    it("lets the host turn Rule 2 off and normalizes the saved rule list", () => {
      let game = settings(escalated(), { activeRules: [2, 1, 2] });
      expect(game.run.activeRules).toEqual([1, 2]);
      game = settings(game, { activeRules: [1] });
      // Without Rule 2 the lone 100 no longer beats the 0; 30 is closest to the target of 34.67.
      game = playRound(game, { ada: 0, bea: 100, cy: 30 });
      expect(game.run.rounds[1].result!.winners).toEqual(["cy"]);
      expect(project(game, "public", NOW).activeRules).toEqual([1]);
    });

    it("rejects rule changes while a round is open", () => {
      const game = command(joinAll(room()), "OPEN_ROUND").room;
      expect(() => settings(game, { activeRules: [1] })).toThrow("INVALID_TRANSITION");
      expect(hostCommandSchema.safeParse({ type: "UPDATE_SETTINGS", commandId: crypto.randomUUID(), expectedVersion: 0, payload: { activeRules: [3] } }).success).toBe(false);
    });

    it("leaves an all-duplicate escalation round without a winner or an elimination", () => {
      const game = playRound(escalated(), { ada: 0, bea: 0, cy: 0 });
      const result = game.run.rounds[1].result!;
      expect(result.winners).toEqual([]);
      expect(result.pointsByUsername).toEqual({});
      expect(result.eliminatedUsername).toBeNull();
      expect(game.run.status).toBe("ROUND_REVEALED");
      expect(Object.values(game.run.participants).every((player) => player.status === "ACTIVE")).toBe(true);
    });
  });
});

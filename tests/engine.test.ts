import { describe, expect, it } from "vitest";
import {
  GameError,
  activePlayers,
  advance,
  chooseEliminated,
  createGame,
  isNashReached,
  joinGame,
  kickPlayer,
  leaderboard,
  lockRound,
  openRound,
  resetGame,
  revealRound,
  seededRandom,
  startEscalation,
  submitPick,
  syncTimer,
  updateSettings,
  DEFAULT_SETTINGS,
  type Game,
  type GameSettings,
} from "@/lib/game";

const T0 = 1_000_000;

function lobby(names: string[], settings: Partial<GameSettings> = {}): Game {
  let g = createGame({ code: "ABCD", hostToken: "host", now: T0, settings: { step: 1, timerSeconds: null, ...settings } });
  for (const n of names) g = joinGame(g, { token: n, name: n });
  return g;
}

/** Play one full round with the given picks; players not listed do not submit. */
function play(g: Game, picks: Record<string, number>, seed = "s"): Game {
  g = g.state === "ROUND_REVEALED" ? advance(g, T0) : openRound(g, T0);
  for (const [token, value] of Object.entries(picks)) g = submitPick(g, { token, value, now: T0 });
  return revealRound(lockRound(g), { seed });
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof GameError ? e.code : "OTHER";
  }
  return null;
};

describe("lobby", () => {
  it("rejects duplicate names (case-insensitive), empty and long names, and strips markup", () => {
    const g = lobby(["Ann"]);
    expect(code(() => joinGame(g, { token: "x", name: "ann" }))).toBe("NAME_TAKEN");
    expect(code(() => joinGame(g, { token: "x", name: "   " }))).toBe("INVALID_NAME");
    expect(code(() => joinGame(g, { token: "x", name: "a".repeat(21) }))).toBe("INVALID_NAME");
    const g2 = joinGame(g, { token: "y", name: "  <b>Bob</b>   Lee " });
    expect(g2.players.y.name).toBe("bBob/b Lee");
  });

  it("enforces max players and no joining after start", () => {
    const g = lobby(["a", "b"], { maxPlayers: 2 });
    expect(code(() => joinGame(g, { token: "c", name: "c" }))).toBe("GAME_FULL");
    const started = openRound(g, T0);
    expect(code(() => joinGame(started, { token: "c", name: "c" }))).toBe("INVALID_STATE");
  });

  it("needs two players to open a round", () => {
    expect(code(() => openRound(lobby(["a"]), T0))).toBe("NOT_ENOUGH_PLAYERS");
  });
});

describe("round flow", () => {
  it("open -> pick -> lock -> reveal scores the round (p = 0.8)", () => {
    const g = play(lobby(["a", "b", "c", "d"]), { a: 50, b: 40, c: 30, d: 20 });
    expect(g.state).toBe("ROUND_REVEALED");
    expect(g.rounds[0].average).toBe(35);
    expect(g.rounds[0].winners).toEqual(["c"]);
    expect(g.players.c.score).toBe(10);
  });

  it("validates picks and respects allowChangeUntilLock", () => {
    let g = openRound(lobby(["a", "b"]), T0);
    expect(code(() => submitPick(g, { token: "a", value: 101, now: T0 }))).toBe("INVALID_PICK");
    expect(code(() => submitPick(g, { token: "a", value: -1, now: T0 }))).toBe("INVALID_PICK");
    expect(code(() => submitPick(g, { token: "a", value: 1.5, now: T0 }))).toBe("INVALID_PICK");
    expect(code(() => submitPick(g, { token: "a", value: Number.NaN, now: T0 }))).toBe("INVALID_PICK");
    g = submitPick(g, { token: "a", value: 10, now: T0 });
    g = submitPick(g, { token: "a", value: 20, now: T0 });
    expect(g.rounds[0].picks.a).toBe(20);

    const strict = submitPick(openRound(lobby(["a", "b"], { allowChangeUntilLock: false }), T0), { token: "a", value: 5, now: T0 });
    expect(code(() => submitPick(strict, { token: "a", value: 6, now: T0 }))).toBe("ALREADY_SUBMITTED");
  });

  it("rejects picks after lock, from unknown players, and after the timer", () => {
    const g = openRound(lobby(["a", "b"], { timerSeconds: 30 }), T0);
    expect(code(() => submitPick(g, { token: "zzz", value: 1, now: T0 }))).toBe("UNKNOWN_PLAYER");
    expect(code(() => submitPick(g, { token: "a", value: 1, now: T0 + 30_000 }))).toBe("ROUND_CLOSED");
    expect(code(() => submitPick(lockRound(g), { token: "a", value: 1, now: T0 }))).toBe("ROUND_CLOSED");
  });

  it("timer locks the round via syncTimer", () => {
    const g = openRound(lobby(["a", "b"], { timerSeconds: 30 }), T0);
    expect(syncTimer(g, T0 + 29_999).state).toBe("ROUND_OPEN");
    expect(syncTimer(g, T0 + 30_000).state).toBe("ROUND_LOCKED");
  });

  it("transitions are idempotent", () => {
    const open = openRound(lobby(["a", "b"]), T0);
    expect(openRound(open, T0 + 5)).toBe(open);
    const locked = lockRound(open);
    expect(lockRound(locked)).toBe(locked);
    const revealed = revealRound(locked, { seed: "s" });
    expect(revealRound(revealed, { seed: "other" })).toBe(revealed);
  });

  it("no-shows are excluded from the average and get no points", () => {
    const g = play(lobby(["a", "b", "c"]), { a: 10, b: 30 });
    expect(g.rounds[0].average).toBe(20);
    expect(g.players.c.score).toBe(0);
  });

  it("stops after the configured rounds unless escalated", () => {
    let g = lobby(["a", "b"], { rounds: 1 });
    g = play(g, { a: 10, b: 50 });
    expect(code(() => advance(g, T0))).toBe("ROUNDS_EXHAUSTED");
    g = startEscalation(g);
    expect(g.phase).toBe("ESCALATION");
    expect(g.activeRules).toEqual([1]);
    expect(advance(g, T0).state).toBe("ROUND_OPEN");
  });

  it("settings can change between rounds only", () => {
    const open = openRound(lobby(["a", "b"]), T0);
    expect(code(() => updateSettings(open, { p: 0.5 }))).toBe("INVALID_STATE");
    expect(updateSettings(lobby(["a", "b"]), { p: 0.5 }).settings.p).toBe(0.5);
    expect(code(() => updateSettings(lobby(["a", "b"]), { p: 0 }))).toBe("INVALID_SETTINGS");
  });
});

describe("Nash trigger", () => {
  it("fires only when every active player picked the minimum", () => {
    const active = ["a", "b", "c"];
    const s = { ...DEFAULT_SETTINGS };
    expect(isNashReached(active, { a: 0, b: 0, c: 0 }, s)).toBe(true);
    expect(isNashReached(active, { a: 0, b: 0, c: 1 }, s)).toBe(false);
    expect(isNashReached(active, { a: 0, b: 0 }, s)).toBe(false); // c did not submit
    expect(isNashReached(["a"], { a: 0 }, s)).toBe(false); // needs 2+ players
    expect(isNashReached(active, { a: 0, b: 0, c: 0 }, { ...s, escalationEnabled: false })).toBe(false);
  });

  it("starts the escalation phase with Rule 1, eliminating no one that round", () => {
    const g = play(lobby(["a", "b", "c"]), { a: 0, b: 0, c: 0 });
    expect(g.rounds[0].nashReached).toBe(true);
    expect(g.rounds[0].eliminated).toBeNull();
    expect(g.phase).toBe("ESCALATION");
    expect(g.activeRules).toEqual([1]);
    expect(g.rounds[0].newRule).toBe(1);
    expect(activePlayers(g)).toHaveLength(3);
  });

  it("does not fire when escalation is disabled", () => {
    const g = play(lobby(["a", "b"], { escalationEnabled: false }), { a: 0, b: 0 });
    expect(g.phase).toBe("NORMAL");
  });
});

describe("escalation rounds", () => {
  const escalated = () => play(lobby(["a", "b", "c", "d"]), { a: 0, b: 0, c: 0, d: 0 });

  it("eliminates exactly one player per round and activates the next rule", () => {
    let g = escalated();
    g = play(g, { a: 10, b: 20, c: 30, d: 90 });
    const round = g.rounds[1];
    expect(round.phase).toBe("ESCALATION");
    expect(round.rulesInForce).toEqual([1]);
    expect(round.eliminated).not.toBeNull();
    expect(round.winners).not.toContain(round.eliminated);
    expect(activePlayers(g)).toHaveLength(3);
    expect(g.activeRules).toEqual([1, 2]);
    expect(round.newRule).toBe(2);
    expect(g.players[round.eliminated!].status).toBe("ELIMINATED");
    expect(g.players[round.eliminated!].eliminatedInRound).toBe(2);
  });

  it("eliminates the farthest non-winner when nobody is disqualified or missing", () => {
    const g = play(escalated(), { a: 10, b: 20, c: 30, d: 90 });
    // average 37.5, target 30 -> c wins; d (90) is farthest
    expect(g.rounds[1].winners).toEqual(["c"]);
    expect(g.rounds[1].eliminated).toBe("d");
  });

  it("non-submitters are eliminated before anyone who submitted", () => {
    const g = play(escalated(), { a: 10, b: 20, c: 30 });
    expect(g.rounds[1].eliminated).toBe("d");
  });

  it("duplicates are eliminated before non-duplicates, even if closer to the target", () => {
    // a,b duplicate on 30; c=20 unique and farther from target than they are
    const g = play(escalated(), { a: 30, b: 30, c: 20, d: 25 });
    expect(g.rounds[1].disqualified.sort()).toEqual(["a", "b"]);
    expect(["a", "b"]).toContain(g.rounds[1].eliminated);
    expect(g.rounds[1].winners).not.toContain(g.rounds[1].eliminated);
  });

  it("seeded tie-break is deterministic and recorded", () => {
    const a = play(escalated(), { a: 30, b: 30, c: 70, d: 70 }, "seed-1");
    const b = play(escalated(), { a: 30, b: 30, c: 70, d: 70 }, "seed-1");
    expect(a.rounds[1].eliminated).toBe(b.rounds[1].eliminated);
    expect(a.rounds[1].eliminationSeed).toBe("seed-1");
    expect(a.rounds[1].eliminationCandidates.length).toBeGreaterThan(1);
  });

  it("Rule 2 comes into force after the first elimination", () => {
    let g = play(escalated(), { a: 10, b: 20, c: 30, d: 90 }); // d out, Rule 2 now active
    g = play(g, { a: 0, b: 100, c: 30 });
    expect(g.rounds[2].rulesInForce).toEqual([1, 2]);
    expect(g.rounds[2].winners).toEqual(["b"]);
    expect(g.rounds[2].overrideRule).toBe(2);
    expect(g.rounds[2].eliminated).not.toBe("b");
  });

  it("eliminated players cannot submit", () => {
    const g = play(escalated(), { a: 10, b: 20, c: 30, d: 90 });
    const next = advance(g, T0);
    expect(code(() => submitPick(next, { token: "d", value: 5, now: T0 }))).toBe("PLAYER_ELIMINATED");
  });

  it("ends with one survivor: reveal first, FINISHED on advance", () => {
    let g = escalated();
    g = play(g, { a: 10, b: 20, c: 30, d: 90 }); // d out
    g = play(g, { a: 10, b: 20, c: 60 }); // one more out
    g = play(g, { a: 10, b: 50 }); // one more out -> 1 left
    expect(activePlayers(g)).toHaveLength(1);
    expect(g.state).toBe("ROUND_REVEALED");
    expect(advance(g, T0).state).toBe("FINISHED");
  });
});

describe("chooseEliminated", () => {
  it("never eliminates a winner", () => {
    const r = chooseEliminated({
      activeTokens: ["a", "b"],
      submitted: ["a", "b"],
      winners: ["a", "b"],
      disqualified: [],
      exactDistance: { a: 0, b: 0 },
      seed: "x",
    });
    expect(r.eliminated).toBeNull();
  });

  it("seededRandom is stable for a seed and varies across seeds", () => {
    expect(seededRandom("a")()).toBe(seededRandom("a")());
    expect(seededRandom("a")()).not.toBe(seededRandom("b")());
  });
});

describe("reset, kick, leaderboard", () => {
  it("reset returns to the lobby keeping players", () => {
    const g = resetGame(play(lobby(["a", "b"]), { a: 10, b: 50 }));
    expect(g.state).toBe("LOBBY");
    expect(g.rounds).toEqual([]);
    expect(Object.keys(g.players)).toEqual(["a", "b"]);
    expect(g.players.a.score).toBe(0);
  });

  it("kick removes a player and their pick", () => {
    let g = openRound(lobby(["a", "b", "c"]), T0);
    g = submitPick(g, { token: "c", value: 5, now: T0 });
    g = kickPlayer(g, "c");
    expect(g.players.c).toBeUndefined();
    expect(g.rounds[0].picks.c).toBeUndefined();
  });

  it("leaderboard ranks survivors by score, then eliminated later-out first", () => {
    let g = play(lobby(["a", "b", "c", "d"]), { a: 0, b: 0, c: 0, d: 0 });
    g = play(g, { a: 10, b: 20, c: 30, d: 90 });
    const rows = leaderboard(g);
    expect(rows[0].status).toBe("ACTIVE");
    expect(rows[rows.length - 1].token).toBe("d");
    expect(rows.map((r) => r.rank)[0]).toBe(1);
  });
});

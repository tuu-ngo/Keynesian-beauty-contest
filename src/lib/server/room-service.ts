import { randomInt, randomUUID } from "crypto";
import type { Account, HostCommand } from "@/contracts";
import { createPlayerToken, PLAYER_SESSION_MS, tokenHash } from "@/lib/auth/player-session";
import { applyCommand, createRoom, joinRun, purgeExpiredArchives, registerPlayer, resolveDeadline, submitPick, type CommandResult, type PickResult, type Room } from "@/lib/room";
import { getRoomStore } from "@/lib/store";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function roomCode(): string {
  return Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

function bumpForDeadline(room: Room, now: number): Room {
  const resolved = resolveDeadline(room, now);
  const purged = purgeExpiredArchives(resolved, now);
  if (purged === room) return room;
  // Both helpers preserve identity when no work is necessary. A deadline lock is
  // visible state; archive/session pruning is safe to publish at the same time.
  purged.version += 1;
  purged.updatedAt = new Date(now).toISOString();
  return purged;
}

export async function roomForRead(code: string, now = Date.now()): Promise<Room | null> {
  const store = getRoomStore();
  const result = await store.mutateRoom(code, (room) => ({ room: bumpForDeadline(room, now), value: undefined }));
  return result?.room ?? null;
}

export async function currentRoomForRead(now = Date.now()): Promise<Room | null> {
  const existing = await getRoomStore().getRoom();
  return existing ? roomForRead(existing.code, now) : null;
}

export async function createSingletonRoom(now = Date.now()): Promise<Room> {
  const store = getRoomStore();
  if (await store.getRoom()) throw new Error("ROOM_EXISTS");
  const teams = await store.loadSeedTeams();
  const room = createRoom({ code: roomCode(), teams, now });
  // The singleton primary key is the final authority if two host requests race.
  await store.createRoom(room);
  return room;
}

export async function authenticatePlayer(code: string, rawToken: string, now = Date.now()): Promise<{ room: Room; username: string; tokenHash: string } | null> {
  const room = await roomForRead(code, now);
  if (!room) return null;
  const hash = tokenHash(rawToken);
  const session = room.sessions[hash];
  if (!session || session.revokedAt !== null || session.expiresAt <= new Date(now).toISOString()) return null;
  if (!room.accounts.some((account) => account.username === session.username)) return null;
  return { room, username: session.username, tokenHash: hash };
}

export async function joinByName(args: { code: string; name: string; now?: number }): Promise<{ playerToken: string; account: Account; room: Room }> {
  const now = args.now ?? Date.now();
  const token = createPlayerToken();
  const hash = tokenHash(token);
  const result = await getRoomStore().mutateRoom(args.code, (room) => {
    const { room: next, account } = registerPlayer(room, { name: args.name, now });
    next.sessions[hash] = { tokenHash: hash, username: account.username, expiresAt: new Date(now + PLAYER_SESSION_MS).toISOString(), revokedAt: null };
    next.version += 1;
    next.updatedAt = new Date(now).toISOString();
    return { room: next, value: account };
  });
  if (!result) throw new Error("ROOM_NOT_FOUND");
  return { playerToken: token, account: result.value, room: result.room };
}

export async function joinPlayer(code: string, username: string, runId: string, now = Date.now()): Promise<{ room: Room; joined: boolean }> {
  const result = await getRoomStore().mutateRoom(code, (room) => {
    const join = joinRun(room, username, runId, now);
    if (!join.joined) return { room, value: join };
    join.room.version += 1;
    join.room.updatedAt = new Date(now).toISOString();
    return { room: join.room, value: { room: join.room, joined: true } };
  });
  if (!result) throw new Error("ROOM_NOT_FOUND");
  return result.value;
}

export async function putPick(code: string, username: string, args: { runId: string; round: number; value: number; stake?: number; requestId: string }, now = Date.now()): Promise<{ room: Room; result: PickResult }> {
  // Persist a lapsed deadline before evaluating the pick, so the first request
  // after expiry cannot slip a pick in or leave the room visually open.
  await roomForRead(code, now);
  const result = await getRoomStore().mutateRoom(code, (room) => {
    const outcome = submitPick(room, { username, ...args, now });
    return { room: outcome.room, value: outcome.result };
  });
  if (!result) throw new Error("ROOM_NOT_FOUND");
  return { room: result.room, result: result.value };
}

export async function commandRoom(code: string, command: HostCommand, now = Date.now()): Promise<{ room: Room; result: CommandResult }> {
  await roomForRead(code, now);
  const result = await getRoomStore().mutateRoom(code, (room) => {
    const outcome = applyCommand(room, command, now, randomUUID());
    return { room: outcome.room, value: outcome.result };
  });
  if (!result) throw new Error("ROOM_NOT_FOUND");
  return { room: result.room, result: result.value };
}

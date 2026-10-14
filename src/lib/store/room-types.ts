import type { Team } from "@/contracts";
import type { AccountSecret, Room } from "@/lib/room";

export interface SeedRoster {
  teams: Team[];
  accounts: AccountSecret[];
}

/**
 * The durable boundary for the v1 single-room backend. Mutators receive a
 * snapshot and must return that exact snapshot unchanged when they are a retry
 * receipt/no-op. Every persisted snapshot change increments the version exactly
 * once so compare-and-swap also protects concurrent session updates.
 */
export interface RoomStore {
  getRoom(): Promise<Room | null>;
  getRoomByCode(code: string): Promise<Room | null>;
  createRoom(room: Room): Promise<void>;
  mutateRoom<T>(code: string, mutator: (room: Room) => { room: Room; value: T }): Promise<{ room: Room; value: T } | null>;
  loadSeedRoster(): Promise<SeedRoster>;
  consumeRateLimit(scope: string, limit: number, windowMs: number, now?: number): Promise<boolean>;
}

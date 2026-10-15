import { LibsqlStore } from "./libsql";
import type { RoomStore } from "./room-types";

export type { RoomStore } from "./room-types";

const globalForStore = globalThis as unknown as { __store?: LibsqlStore };

export function getRoomStore(): RoomStore {
  if (!globalForStore.__store) {
    globalForStore.__store = new LibsqlStore();
  }
  return globalForStore.__store;
}

import { MemoryStore } from "./memory";
import type { Store } from "./types";

export type { Store } from "./types";

const globalForStore = globalThis as unknown as { __store?: Store };

/**
 * Scaffold fallback only. M1 replaces it with the SQLite/libSQL repository
 * described in docs/specs/BACKEND.md.
 */
export function getStore(): Store {
  if (!globalForStore.__store) {
    globalForStore.__store = new MemoryStore();
  }
  return globalForStore.__store;
}

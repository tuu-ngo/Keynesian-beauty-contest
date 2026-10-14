import { MemoryStore } from "./memory";
import type { Store } from "./types";

export type { Store } from "./types";

const globalForStore = globalThis as unknown as { __store?: Store };

/**
 * STORE=memory (default in dev) or STORE=upstash.
 * TODO: add the Upstash implementation (src/lib/store/upstash.ts) and select it here.
 */
export function getStore(): Store {
  if (!globalForStore.__store) {
    globalForStore.__store = new MemoryStore();
  }
  return globalForStore.__store;
}

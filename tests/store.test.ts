import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createRoom } from "@/lib/room";
import { LibsqlStore } from "@/lib/store/libsql";

const directory = mkdtempSync(join(tmpdir(), "keynesian-store-test-"));
const database = join(directory, "room.db");
const previousUrl = process.env.TURSO_DATABASE_URL;
process.env.TURSO_DATABASE_URL = `file:${database}`;
const store = new LibsqlStore();

afterAll(() => {
  store.close();
  if (previousUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = previousUrl;
  rmSync(directory, { recursive: true, force: true });
});

describe("libSQL room store", () => {
  it("uses a compare-and-swap version to preserve concurrent mutations", async () => {
    await store.createRoom(createRoom({
      code: "TEST",
      teams: [{ id: "team", name: "Team" }],
      accounts: [{ username: "alice", password: "secret", displayName: "Alice", teamId: "team" }],
      now: 1_700_000_000_000,
    }));

    await Promise.all(Array.from({ length: 50 }, async () => {
      const saved = await store.mutateRoom("TEST", (current) => {
        const next = structuredClone(current);
        next.version += 1;
        next.updatedAt = new Date(Date.parse(current.updatedAt) + 1).toISOString();
        return { room: next, value: next.version };
      });
      expect(saved).not.toBeNull();
    }));

    expect((await store.getRoom())?.version).toBe(50);
  });

  it("persists rate-limit buckets and renews them after their window", async () => {
    const now = 1_700_000_000_000;
    await expect(store.consumeRateLimit("login:alice", 2, 60_000, now)).resolves.toBe(true);
    await expect(store.consumeRateLimit("login:alice", 2, 60_000, now)).resolves.toBe(true);
    await expect(store.consumeRateLimit("login:alice", 2, 60_000, now)).resolves.toBe(false);
    await expect(store.consumeRateLimit("login:alice", 2, 60_000, now + 60_001)).resolves.toBe(true);

    const burst = await Promise.all(Array.from({ length: 20 }, () => store.consumeRateLimit("pick:burst", 5, 60_000, now)));
    expect(burst.filter(Boolean)).toHaveLength(5);
  });
});

import { createClient } from "@libsql/client";
import type { Room } from "@/lib/room";
import type { RoomStore, SeedRoster } from "./room-types";

/**
 * Small durable repository for the MVP.  The game engine owns the shape of the
 * snapshot; SQLite owns durability and the compare-and-swap version check.
 */
export class LibsqlStore implements RoomStore {
  private readonly client = createClient({
    url: process.env.TURSO_DATABASE_URL ?? "file:db/keynesian-beauty-contest.dev.db",
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
  private readonly ready = this.migrate();

  private async migrate() {
    const url = process.env.TURSO_DATABASE_URL ?? "file:db/keynesian-beauty-contest.dev.db";
    if (process.env.NODE_ENV === "production") {
      if ((!url.startsWith("libsql://") && !url.startsWith("https://")) || !process.env.TURSO_AUTH_TOKEN) {
        throw new Error("Production requires a remote libsql:// or https:// TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
      }
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
      if (!baseUrl || new URL(baseUrl).protocol !== "https:") throw new Error("Production requires an HTTPS NEXT_PUBLIC_BASE_URL.");
    }
    if (url.startsWith("file:")) await this.client.execute("PRAGMA journal_mode = WAL");
    await this.client.execute("PRAGMA foreign_keys = ON");
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `);
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS room_snapshots (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        version INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        scope TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    await this.client.execute({
      sql: "INSERT INTO schema_migrations (id, applied_at) VALUES (1, ?) ON CONFLICT(id) DO NOTHING",
      args: [Date.now()],
    });
  }

  async getRoom(): Promise<Room | null> {
    await this.ready;
    const result = await this.client.execute("SELECT snapshot FROM room_snapshots WHERE id = 1");
    const snapshot = result.rows[0]?.snapshot;
    return typeof snapshot === "string" ? this.decodeRoom(snapshot) : null;
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    await this.ready;
    const result = await this.client.execute({ sql: "SELECT snapshot FROM room_snapshots WHERE id = 1 AND code = ?", args: [code.toUpperCase()] });
    const snapshot = result.rows[0]?.snapshot;
    return typeof snapshot === "string" ? this.decodeRoom(snapshot) : null;
  }

  private decodeRoom(snapshot: string): Room {
    const value = JSON.parse(snapshot) as Partial<Room>;
    if (value.schemaVersion !== 1 || typeof value.code !== "string" || typeof value.version !== "number" || !value.run) {
      throw new Error("The persisted room schema is incompatible with this application version.");
    }
    return value as Room;
  }

  async createRoom(room: Room): Promise<void> {
    await this.ready;
    try {
      await this.client.execute({
        sql: "INSERT INTO room_snapshots (id, code, version, snapshot, updated_at) VALUES (1, ?, ?, ?, ?)",
        args: [room.code, room.version, JSON.stringify(room), Date.parse(room.updatedAt)],
      });
    } catch (error) {
      if (String(error).toLowerCase().includes("unique") || String(error).toLowerCase().includes("constraint")) throw new Error("ROOM_EXISTS");
      throw error;
    }
  }

  async mutateRoom<T>(code: string, mutator: (room: Room) => { room: Room; value: T }): Promise<{ room: Room; value: T } | null> {
    await this.ready;
    // A burst of phone submissions commonly starts from the same version. CAS
    // makes that safe; a short jittered retry lets the losing writers re-read
    // the winner instead of needlessly returning a conflict under normal load.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const current = await this.getRoomByCode(code);
      if (!current) return null;
      const outcome = mutator(current);
      const next = outcome.room;
      if (next === current) return outcome;
      if (next.version !== current.version + 1) throw new Error("Room mutator must increment version exactly once.");
      const result = await this.client.execute({
        sql: "UPDATE room_snapshots SET version = ?, snapshot = ?, updated_at = ? WHERE id = 1 AND code = ? AND version = ?",
        args: [next.version, JSON.stringify(next), Date.parse(next.updatedAt), code.toUpperCase(), current.version],
      });
      if (result.rowsAffected === 1) return outcome;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2 ** attempt, 32) + Math.floor(Math.random() * 4)));
    }
    throw new Error("VERSION_CONFLICT");
  }

  async loadSeedRoster(): Promise<SeedRoster> {
    await this.ready;
    try {
      const [teamResult, accountResult] = await Promise.all([
        this.client.execute("SELECT id, name, image, color FROM seed_teams ORDER BY id"),
        this.client.execute("SELECT username, password, display_name, team_id FROM seed_users ORDER BY username"),
      ]);
      const teams = teamResult.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        ...(typeof row.image === "string" ? { image: row.image } : {}),
        ...(typeof row.color === "string" ? { color: row.color } : {}),
      }));
      const accounts = accountResult.rows.map((row) => ({
        username: String(row.username).trim().toLowerCase(),
        password: String(row.password),
        displayName: typeof row.display_name === "string" && row.display_name.trim() ? row.display_name.trim() : String(row.username),
        teamId: String(row.team_id),
      }));
      if (teams.length === 0 || accounts.length === 0) throw new Error("Seed roster is empty.");
      return { teams, accounts };
    } catch (error) {
      if (error instanceof Error && error.message === "Seed roster is empty.") throw error;
      throw new Error("Roster seed is unavailable. Run `npm run seed-db` before creating the room.");
    }
  }

  async consumeRateLimit(scope: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
    await this.ready;
    // Each write is conditional in SQL, so concurrent Functions cannot push a
    // bucket past its limit. A few immediate passes let concurrent creators or
    // renewers observe the row that won the preceding race.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const active = await this.client.execute({
        sql: "UPDATE rate_limit_buckets SET count = count + 1 WHERE scope = ? AND expires_at > ? AND count < ?",
        args: [scope, now, limit],
      });
      if (active.rowsAffected === 1) return true;
      const created = await this.client.execute({
        sql: "INSERT INTO rate_limit_buckets (scope, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(scope) DO NOTHING",
        args: [scope, now + windowMs],
      });
      if (created.rowsAffected === 1) return true;
      const renewed = await this.client.execute({
        sql: "UPDATE rate_limit_buckets SET count = 1, expires_at = ? WHERE scope = ? AND expires_at <= ?",
        args: [now + windowMs, scope, now],
      });
      if (renewed.rowsAffected === 1) return true;
    }
    return false;
  }

  close(): void {
    this.client.close();
  }
}

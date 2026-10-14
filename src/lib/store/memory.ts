import type { Game } from "@/lib/game";
import type { Store } from "./types";

/** In-memory store for local dev and tests. Not shared across serverless instances. */
export class MemoryStore implements Store {
  private games = new Map<string, Game>();

  async getGame(code: string) {
    return this.games.get(code) ?? null;
  }

  async createGame(game: Game) {
    this.games.set(game.code, game);
  }

  async mutateGame(code: string, mutator: (game: Game) => Game) {
    const current = this.games.get(code);
    if (!current) return null;
    const next = mutator(structuredClone(current));
    next.version = current.version + 1;
    next.updatedAt = Date.now();
    this.games.set(code, next);
    return next;
  }
}

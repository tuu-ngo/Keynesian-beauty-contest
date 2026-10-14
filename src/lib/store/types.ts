import type { Game } from "@/lib/game";

/**
 * Persistence boundary. Game logic never touches the SQLite/libSQL driver
 * directly, so the backend can be swapped without changing the rules.
 */
export interface Store {
  getGame(code: string): Promise<Game | null>;
  /**
   * Atomically read-modify-write a game. Returns the updated game, or null if it
   * does not exist. The mutator must be pure; implementations may retry it on a
   * version conflict.
   */
  mutateGame(code: string, mutator: (game: Game) => Game): Promise<Game | null>;
  createGame(game: Game): Promise<void>;
}

-- Roster source for the single room.
--
-- Add your teams and users in the two INSERT sections below, then run this file
-- against the local SQLite database or the target Turso database before the
-- Host creates the room for the first time. The create-room flow snapshots this
-- roster into the room; changing this file later does not alter an existing room.
--
-- `password` is deliberately plaintext only for the current MVP contract.
-- Keep this repository private and move to password hashes before public
-- deployment if the roster contains real credentials.

PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE IF NOT EXISTS seed_teams (
  id TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  image TEXT CHECK (image IS NULL OR image LIKE '/teams/%'),
  color TEXT,
  CHECK (id = trim(id) AND length(id) BETWEEN 1 AND 64)
);

CREATE TABLE IF NOT EXISTS seed_users (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  password TEXT NOT NULL CHECK (length(password) >= 1),
  display_name TEXT,
  team_id TEXT NOT NULL COLLATE NOCASE,
  FOREIGN KEY (team_id) REFERENCES seed_teams(id),
  CHECK (username = trim(username) AND length(username) BETWEEN 1 AND 64),
  CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 20)
);

-- Replace these commented examples with your real teams. `id` is stable and
-- referenced by users; `name`, `image`, and `color` are displayed to clients.
--
-- INSERT INTO seed_teams (id, name, image, color) VALUES
--   ('alpha', 'Alpha', '/teams/alpha.png', '#2563EB'),
--   ('beta',  'Beta',  '/teams/beta.png',  '#DC2626')
-- ON CONFLICT(id) DO UPDATE SET
--   name = excluded.name,
--   image = excluded.image,
--   color = excluded.color;

-- Add users only after their teams exist. `display_name = NULL` makes the UI
-- fall back to `username`. Each username is case-insensitive and must be unique.
--
-- INSERT INTO seed_users (username, password, display_name, team_id) VALUES
--   ('alice', 'replace-with-a-password', 'Alice', 'alpha'),
--   ('bob',   'replace-with-a-password', NULL,    'beta')
-- ON CONFLICT(username) DO UPDATE SET
--   password = excluded.password,
--   display_name = excluded.display_name,
--   team_id = excluded.team_id;

COMMIT;

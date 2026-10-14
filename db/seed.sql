-- Roster source for the single room.
--
-- Edit the two INSERT sections below, then run `npm run seed-db` before the
-- Host creates the room for the first time. The create-room flow snapshots this
-- roster, so later seed changes do not alter an existing room.
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

-- Teams must be inserted before users because users reference team IDs.
INSERT INTO seed_teams (id, name, image, color) VALUES
  ('classroom', 'Classroom', NULL, '#2563EB')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  image = excluded.image,
  color = excluded.color;

-- Change the sample passwords before a real event.
INSERT INTO seed_users (username, password, display_name, team_id) VALUES
  ('alice', 'contest123', 'Alice', 'classroom'),
  ('bob', 'contest123', 'Bob', 'classroom'),
  ('chloe', 'contest123', 'Chloe', 'classroom')
ON CONFLICT(username) DO UPDATE SET
  password = excluded.password,
  display_name = excluded.display_name,
  team_id = excluded.team_id;

COMMIT;

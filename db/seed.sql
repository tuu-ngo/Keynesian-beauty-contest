-- Team source for the single room.
--
-- Players do not have accounts: they join from the lobby by entering a name and
-- choosing one of these teams. Only the Host signs in (HOST_USERNAME /
-- HOST_PASSWORD in the environment).
--
-- Edit the INSERT section below, then run `npm run seed-db` before the Host
-- creates the room for the first time. The create-room flow snapshots these
-- teams, so later seed changes do not alter an existing room.

PRAGMA foreign_keys = ON;

BEGIN;

CREATE TABLE IF NOT EXISTS seed_teams (
  id TEXT PRIMARY KEY COLLATE NOCASE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  image TEXT CHECK (image IS NULL OR image LIKE '/teams/%'),
  color TEXT,
  CHECK (id = trim(id) AND length(id) BETWEEN 1 AND 64)
);

INSERT INTO seed_teams (id, name, image, color) VALUES
  ('classroom', 'Classroom', NULL, '#2563EB')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  image = excluded.image,
  color = excluded.color;

COMMIT;

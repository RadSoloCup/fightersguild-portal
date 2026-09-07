CREATE TABLE game_servers (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  game           TEXT NOT NULL DEFAULT '',       -- "Hytale", "Minecraft", …
  host           TEXT NOT NULL,
  port           INTEGER,
  description    TEXT NOT NULL DEFAULT '',
  connect_hint   TEXT NOT NULL DEFAULT '',       -- how to join / modpack / version
  check_type     TEXT NOT NULL DEFAULT 'tcp' CHECK (check_type IN ('tcp', 'minecraft', 'none')),
  position       INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- live status, refreshed by the background poller
  status         TEXT NOT NULL DEFAULT 'unknown', -- online | offline | unknown
  players_online INTEGER,
  players_max    INTEGER,
  status_detail  TEXT NOT NULL DEFAULT '',        -- MOTD / version / error
  checked_at     TIMESTAMPTZ
);
CREATE INDEX game_servers_pos_idx ON game_servers (position, id);

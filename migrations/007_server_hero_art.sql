-- Optional faded background image per game server (box art / key art). When
-- empty, the card falls back to a gradient derived from the game name.
ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS hero_url TEXT NOT NULL DEFAULT '';

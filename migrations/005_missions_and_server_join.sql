-- Game servers: an optional one-click join target (steam://, minecraft://, http…)
ALTER TABLE game_servers ADD COLUMN IF NOT EXISTS connect_url TEXT NOT NULL DEFAULT '';

-- ── Mission board ──────────────────────────────────────────────────────────
CREATE TABLE missions (
  id                SERIAL PRIMARY KEY,
  creator_id        TEXT NOT NULL REFERENCES users(id),
  title             TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT '',        -- what the mission needs (e.g. "gunners, medic")
  crew_size         TEXT NOT NULL DEFAULT '',
  mission_type      TEXT NOT NULL DEFAULT '',
  objective         TEXT NOT NULL,
  pay               TEXT NOT NULL DEFAULT '',
  launch_at         TIMESTAMPTZ,
  voice_channel_id  TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',

  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'complete', 'cancelled')),
  outcome           TEXT CHECK (outcome IN ('passed', 'failed')),

  fluxer_message_id TEXT,   -- id of the cross-posted message in the Fluxer board

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,

  -- After-action report (filled when the creator marks it complete)
  aar_reason        TEXT NOT NULL DEFAULT '',   -- why it passed / failed
  aar_corrective    TEXT NOT NULL DEFAULT '',   -- future corrective actions
  aar_paid          BOOLEAN,                    -- paid out the amount described?
  aar_by            TEXT REFERENCES users(id)
);
CREATE INDEX missions_status_idx ON missions (status, launch_at NULLS LAST, created_at DESC);

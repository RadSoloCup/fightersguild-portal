-- Link a completed mission's after-action report to its discussion thread,
-- and record how the mission was created (portal form vs. Fluxer !mission).
ALTER TABLE missions ADD COLUMN IF NOT EXISTS aar_thread_id INTEGER
  REFERENCES forum_threads(id) ON DELETE SET NULL;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'portal';

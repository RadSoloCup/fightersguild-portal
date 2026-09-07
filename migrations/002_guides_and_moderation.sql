-- Guides category + a moderation audit log

INSERT INTO forum_categories (slug, name, description, position) VALUES
  ('guides', 'Guides', 'How-tos, references, and SOPs. Keep them evergreen.', 3)
ON CONFLICT (slug) DO NOTHING;

-- push Star Citizen / Off-topic down so Guides sits after Recruitment
UPDATE forum_categories SET position = 4 WHERE slug = 'star-citizen';
UPDATE forum_categories SET position = 5 WHERE slug = 'off-topic';

CREATE TABLE IF NOT EXISTS mod_actions (
  id           SERIAL PRIMARY KEY,
  actor_id     TEXT NOT NULL REFERENCES users(id),
  action       TEXT NOT NULL,               -- pin, unpin, lock, unlock, delete_thread, move_thread, delete_post, grant_admin, revoke_admin, revoke_access, restore_access, category_*
  target_type  TEXT NOT NULL,               -- thread | post | category | user
  target_id    TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mod_actions_created_idx ON mod_actions (created_at DESC);

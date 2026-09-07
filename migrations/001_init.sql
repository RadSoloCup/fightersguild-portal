-- Fighters Guild Portal — initial schema

CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- Fluxer user snowflake
  username      TEXT NOT NULL,
  global_name   TEXT,
  avatar        TEXT,                      -- avatar hash
  email         TEXT,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  membership_checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ                 -- set when they leave the guild
);

CREATE TABLE oauth_tokens (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  scope         TEXT NOT NULL,
  access_expires_at TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Forum ────────────────────────────────────────────────────────────────────
CREATE TABLE forum_categories (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  locked      BOOLEAN NOT NULL DEFAULT FALSE,   -- only admins can start threads
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE forum_threads (
  id            SERIAL PRIMARY KEY,
  category_id   INTEGER NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL,
  pinned        BOOLEAN NOT NULL DEFAULT FALSE,
  locked        BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_post_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  post_count    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX forum_threads_category_idx ON forum_threads (category_id, pinned DESC, last_post_at DESC);

CREATE TABLE forum_posts (
  id          SERIAL PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id),
  body_md     TEXT NOT NULL,
  body_html   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at   TIMESTAMPTZ,
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX forum_posts_thread_idx ON forum_posts (thread_id, created_at);

CREATE TABLE forum_reads (
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id         INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  last_read_post_id INTEGER NOT NULL DEFAULT 0,
  read_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, thread_id)
);

-- ── Events ───────────────────────────────────────────────────────────────────
CREATE TABLE events (
  id               SERIAL PRIMARY KEY,
  creator_id       TEXT NOT NULL REFERENCES users(id),
  title            TEXT NOT NULL,
  body_md          TEXT NOT NULL DEFAULT '',
  body_html        TEXT NOT NULL DEFAULT '',
  location         TEXT NOT NULL DEFAULT '',
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ,
  cancelled        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_starts_idx ON events (starts_at);

CREATE TABLE event_rsvps (
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status    TEXT NOT NULL CHECK (status IN ('going','interested','declined')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- Seed a starting set of forum categories.
INSERT INTO forum_categories (slug, name, description, position) VALUES
  ('announcements', 'Announcements', 'Official guild news. Admins post, everyone reads.', 0),
  ('operations',    'Operations',    'Planning ops, fleet movements, after-action reports.', 1),
  ('recruitment',   'Recruitment',   'Looking for members, looking for a guild.', 2),
  ('star-citizen',  'Star Citizen',  'Patch talk, ship builds, the &lsquo;verse in general.', 3),
  ('off-topic',     'Off-topic',     'Everything else.', 4);

UPDATE forum_categories SET locked = TRUE WHERE slug = 'announcements';

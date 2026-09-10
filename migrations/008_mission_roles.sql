-- Structured crew roles for a mission + per-role sign-ups.
CREATE TABLE mission_roles (
  id          SERIAL PRIMARY KEY,
  mission_id  INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slots       INTEGER NOT NULL DEFAULT 1,   -- 0 = unlimited
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX mission_roles_mission_idx ON mission_roles (mission_id, position, id);

CREATE TABLE mission_signups (
  mission_id  INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES mission_roles(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, user_id)          -- one role per person per mission
);
CREATE INDEX mission_signups_role_idx ON mission_signups (role_id);

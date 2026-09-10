-- Roll-call time (be ready: in voice, in game), in-game meet-up point, and a
-- list of ship types the mission wants — with each crew member picking which
-- of those ships they can bring.
ALTER TABLE missions ADD COLUMN IF NOT EXISTS roll_call_at TIMESTAMPTZ;
ALTER TABLE missions ADD COLUMN IF NOT EXISTS meetup TEXT NOT NULL DEFAULT '';

CREATE TABLE mission_ships (
  id          SERIAL PRIMARY KEY,
  mission_id  INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,   -- how many wanted; 0 = unspecified
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX mission_ships_mission_idx ON mission_ships (mission_id, position, id);

-- Which requested ships a signed-up person can supply (many per person).
CREATE TABLE mission_signup_ships (
  mission_id  INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  ship_id     INTEGER NOT NULL REFERENCES mission_ships(id) ON DELETE CASCADE,
  PRIMARY KEY (mission_id, user_id, ship_id),
  FOREIGN KEY (mission_id, user_id) REFERENCES mission_signups (mission_id, user_id) ON DELETE CASCADE
);
CREATE INDEX mission_signup_ships_ship_idx ON mission_signup_ships (ship_id);

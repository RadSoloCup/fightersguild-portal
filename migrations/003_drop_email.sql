-- The Portal never reads email — stop storing it. (Scope also drops to
-- "identify guilds" in the app; existing grants keep working.)
ALTER TABLE users DROP COLUMN IF EXISTS email;

-- Stored refresh tokens are encrypted at rest from here on (AES-256-GCM,
-- src/lib/crypto.js). Existing plaintext rows are re-encrypted on their next
-- membership-sweep refresh — no migration needed for that.

import { one, query } from '../db.js'
import { config } from '../config.js'
import { encryptToken } from './crypto.js'

const adminSet = new Set(config.adminIds)

// Create or update the Portal user record from a Fluxer userinfo payload,
// and persist the OAuth token set. Refresh token is encrypted at rest; no
// email is stored (the Portal doesn't use it).
//
// Only called from the OAuth callback, after a fresh login has already been
// confirmed as a guild member (see routes/auth.js) — so a call here always
// means "this person just proved they belong", and clears any earlier
// revocation (membership-sweep false positive, or an admin revoke) the same
// way the admin "Restore" action does. Previously this left revoked_at
// untouched, so anyone revoked could never sign back in even after Fluxer
// approved them: loadUser would see the stale revoked_at on the very next
// request and immediately clear their new session.
export async function upsertUser(info, tokenSet) {
  const isAdmin = adminSet.has(info.id)
  const user = await one(
    `INSERT INTO users (id, username, global_name, avatar, is_admin, last_seen, membership_checked_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       global_name = EXCLUDED.global_name,
       avatar = EXCLUDED.avatar,
       is_admin = EXCLUDED.is_admin,
       last_seen = now(),
       membership_checked_at = now(),
       revoked_at = NULL
     RETURNING *`,
    [info.id, info.username, info.global_name ?? null, info.avatar ?? null, isAdmin],
  )

  if (tokenSet) {
    const expiresAt = new Date(Date.now() + (tokenSet.expires_in || 3600) * 1000)
    await query(
      `INSERT INTO oauth_tokens (user_id, refresh_token, scope, access_expires_at, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET
         refresh_token = EXCLUDED.refresh_token,
         scope = EXCLUDED.scope,
         access_expires_at = EXCLUDED.access_expires_at,
         updated_at = now()`,
      [info.id, encryptToken(tokenSet.refresh_token), tokenSet.scope || config.oauth.scope, expiresAt],
    )
  }
  return user
}

export async function touchSeen(userId) {
  try { await query('UPDATE users SET last_seen = now() WHERE id = $1', [userId]) } catch {}
}

export async function removeUserAccess(userId) {
  await query('DELETE FROM oauth_tokens WHERE user_id = $1', [userId])
}

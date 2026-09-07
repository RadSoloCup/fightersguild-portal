import { config } from '../config.js'
import { many, query } from '../db.js'
import { refresh, isGuildMember, userinfo } from '../auth/oauth.js'
import { encryptToken, decryptToken } from './crypto.js'

// Periodically re-verify that Portal users are still in the Fighters Guild
// server. On leaving, mark the user revoked (loadUser then kills their session)
// and drop their stored tokens.
export async function sweepMembership() {
  const stale = await many(
    `SELECT t.user_id, t.refresh_token
     FROM oauth_tokens t JOIN users u ON u.id = t.user_id
     WHERE u.revoked_at IS NULL
       AND u.membership_checked_at < now() - ($1 || ' seconds')::interval
     ORDER BY u.membership_checked_at
     LIMIT 50`,
    [String(config.session.recheckSeconds)],
  )

  for (const row of stale) {
    try {
      const tok = await refresh(decryptToken(row.refresh_token))
      const ok = await isGuildMember(tok.access_token)
      if (ok) {
        // Also pull the current profile so avatars/names track the chat app.
        let profile = null
        try { profile = await userinfo(tok.access_token) } catch {}
        if (profile) {
          await query(
            `UPDATE users SET username = $2, global_name = $3, avatar = $4,
               membership_checked_at = now() WHERE id = $1`,
            [row.user_id, profile.username, profile.global_name ?? null, profile.avatar ?? null],
          )
        } else {
          await query(`UPDATE users SET membership_checked_at = now() WHERE id = $1`, [row.user_id])
        }
        await query(
          `UPDATE oauth_tokens SET refresh_token = $2, access_expires_at = now() + ($3 || ' seconds')::interval, updated_at = now() WHERE user_id = $1`,
          [row.user_id, encryptToken(tok.refresh_token), String(tok.expires_in || 3600)],
        )
      } else {
        await revokeUser(row.user_id, 'left guild')
      }
    } catch (e) {
      // A hard refresh failure (revoked upstream) also means they're gone.
      if (/→ 4\d\d/.test(e.message)) await revokeUser(row.user_id, 'token revoked')
      else console.error('membership sweep:', row.user_id, e.message)
    }
  }
}

async function revokeUser(userId, why) {
  console.log(new Date().toISOString(), `revoking portal access for ${userId} (${why})`)
  await query('UPDATE users SET revoked_at = now() WHERE id = $1', [userId])
  await query('DELETE FROM oauth_tokens WHERE user_id = $1', [userId])
}

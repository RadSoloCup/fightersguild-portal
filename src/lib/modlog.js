import { many, query } from '../db.js'

export function logMod(actorId, action, targetType, targetId, detail = '') {
  return query(
    `INSERT INTO mod_actions (actor_id, action, target_type, target_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, targetType, String(targetId), detail],
  ).catch(e => console.error('modlog:', e.message))
}

export function recentModActions(limit = 100) {
  return many(
    `SELECT m.*, u.username, u.global_name
     FROM mod_actions m JOIN users u ON u.id = m.actor_id
     ORDER BY m.created_at DESC LIMIT $1`,
    [limit],
  )
}

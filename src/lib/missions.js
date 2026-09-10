import { one, many, query, tx } from '../db.js'

export const MISSION_MAX = { title: 140, objective: 8000, field: 200, aar: 4000, roleName: 60 }

// Keys accepted in a `!mission` command.
const KEY_MAP = {
  title: 'title',
  type: 'mission_type', kind: 'mission_type',
  crew: 'roles', role: 'roles', roles: 'roles', needs: 'roles',
  size: 'crew_size', 'crew size': 'crew_size', 'crew_size': 'crew_size',
  pay: 'pay', reward: 'pay', payout: 'pay',
  launch: 'launch_at', when: 'launch_at', eta: 'launch_at', time: 'launch_at', 'launch time': 'launch_at',
  voice: 'voice_channel_id', vc: 'voice_channel_id', channel: 'voice_channel_id',
  objective: 'objective', brief: 'objective', briefing: 'objective', details: 'objective',
}

export const MISSION_COMMAND_HELP = [
  '**Post a mission** — start a message with `!mission` then a title, and add any of these lines:',
  '```',
  '!mission Escort run to Pyro',
  'type: escort',
  'role: Fighter escort x2',
  'role: Medic x1',
  'pay: 50k aUEC each',
  'launch: 2026-09-10 20:00Z',
  '',
  'Meet at Seraphim Station. Escort the C2 through the',
  'Pyro gateway — expect pirates at the jump point.',
  '```',
  '`role:` lines (or `crew: 2 fighters, 1 medic`) become sign-up slots on the board.',
  'Everything after the keyed lines is the objective / briefing. Title and objective are required.',
].join('\n')

function parseLaunch(v) {
  if (!v) return null
  const d = new Date(v.trim())
  return isNaN(d.getTime()) ? null : d
}

// "Fighter x2" / "2x Fighter" / "2 fighters" / "Medic"  ->  { name, slots }
export function parseRoleSpec(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  let m = s.match(/^(.+?)\s*[x×*]\s*(\d{1,2})$/i)          // Fighter x2
  if (m) return { name: m[1].trim(), slots: Number(m[2]) }
  m = s.match(/^(\d{1,2})\s*[x×*]?\s+(.+)$/i)              // 2x Fighter / 2 fighters
  if (m) return { name: m[2].trim(), slots: Number(m[1]) }
  return { name: s, slots: 1 }
}

// Comma / newline separated -> [{name, slots}]
function parseRoleList(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map(parseRoleSpec)
    .filter(r => r && r.name)
    .map(r => ({ name: r.name.slice(0, MISSION_MAX.roleName), slots: Math.min(Math.max(r.slots | 0, 0), 99) }))
}

// Short summary string for the legacy `role` column / card / embed.
export function rolesSummary(roles) {
  return (roles || [])
    .map(r => (r.slots ? `${r.slots}× ${r.name}` : r.name))
    .join(', ')
    .slice(0, MISSION_MAX.field)
}

// Parse a `!mission …` message body. Returns { ok, fields } or { ok:false, error }.
export function parseMissionCommand(content) {
  const stripped = String(content || '').replace(/^\s*!mission\b[ \t]*/i, '')
  const lines = stripped.split(/\r?\n/)

  const fields = { title: '', roles: [], crew_size: '', mission_type: '', pay: '', objective: '', launch_at: null, voice_channel_id: '' }
  const objectiveLines = []
  let inObjective = false

  const first = lines[0]?.trim() || ''
  let startIdx = 0
  const firstKey = first.match(/^([A-Za-z][A-Za-z _]*?)\s*[:=]\s*(.*)$/)
  if (first && (!firstKey || !KEY_MAP[firstKey[1].toLowerCase().trim()])) {
    fields.title = first.slice(0, MISSION_MAX.title)
    startIdx = 1
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]
    if (inObjective) { objectiveLines.push(line); continue }
    if (!line.trim()) continue

    const m = line.match(/^([A-Za-z][A-Za-z _]*?)\s*[:=]\s*(.*)$/)
    const key = m && KEY_MAP[m[1].toLowerCase().trim()]
    if (key) {
      const val = m[2].trim()
      if (key === 'launch_at') fields.launch_at = parseLaunch(val)
      else if (key === 'voice_channel_id') fields.voice_channel_id = val.replace(/\D/g, '').slice(0, 32)
      else if (key === 'objective') { fields.objective = val; inObjective = true }
      else if (key === 'title') fields.title = val.slice(0, MISSION_MAX.title)
      else if (key === 'roles') fields.roles.push(...parseRoleList(val))
      else fields[key] = val.slice(0, MISSION_MAX.field)
    } else {
      inObjective = true
      objectiveLines.push(line)
    }
  }

  const tail = objectiveLines.join('\n').trim()
  fields.objective = [fields.objective, tail].filter(Boolean).join('\n').trim().slice(0, MISSION_MAX.objective)

  if (!fields.title) return { ok: false, error: 'Give the mission a title on the first line after `!mission`.' }
  if (!fields.objective) return { ok: false, error: 'Add an objective / briefing — the lines after the keyed fields.' }
  return { ok: true, fields }
}

// Insert a mission + its roles. `fields.roles` is [{name, slots}]. Returns the
// mission row with `.roles` attached.
export async function createMission({ creatorId, fields, source = 'portal' }) {
  const roles = (fields.roles || [])
    .map(r => ({ name: String(r.name || '').trim().slice(0, MISSION_MAX.roleName), slots: Math.min(Math.max(r.slots | 0, 0), 99) }))
    .filter(r => r.name)
    .slice(0, 20)

  return tx(async client => {
    const m = (await client.query(
      `INSERT INTO missions
         (creator_id, title, role, crew_size, mission_type, objective, pay, launch_at, voice_channel_id, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        creatorId,
        fields.title.slice(0, MISSION_MAX.title),
        rolesSummary(roles) || (fields.role || '').slice(0, MISSION_MAX.field),
        (fields.crew_size || '').slice(0, MISSION_MAX.field),
        (fields.mission_type || '').slice(0, MISSION_MAX.field),
        fields.objective.slice(0, MISSION_MAX.objective),
        (fields.pay || '').slice(0, MISSION_MAX.field),
        fields.launch_at || null,
        (fields.voice_channel_id || '').replace(/\D/g, '').slice(0, 32),
        source,
      ],
    )).rows[0]

    for (let i = 0; i < roles.length; i++) {
      await client.query(
        'INSERT INTO mission_roles (mission_id, name, slots, position) VALUES ($1,$2,$3,$4)',
        [m.id, roles[i].name, roles[i].slots, i],
      )
    }
    m.roles = (await client.query('SELECT * FROM mission_roles WHERE mission_id = $1 ORDER BY position, id', [m.id])).rows
    return m
  })
}

// Roles for a mission with the members signed up to each.
export async function missionRoster(missionId) {
  const roles = await many('SELECT * FROM mission_roles WHERE mission_id = $1 ORDER BY position, id', [missionId])
  if (!roles.length) return []
  const signups = await many(`
    SELECT s.role_id, s.user_id, u.username, u.global_name, u.avatar, s.created_at
    FROM mission_signups s JOIN users u ON u.id = s.user_id
    WHERE s.mission_id = $1 ORDER BY s.created_at`, [missionId])
  return roles.map(r => ({
    ...r,
    members: signups.filter(s => s.role_id === r.id),
  }))
}

// The role this user is signed up to for a mission, or null.
export function userSignup(missionId, userId) {
  if (!userId) return Promise.resolve(null)
  return one('SELECT role_id FROM mission_signups WHERE mission_id = $1 AND user_id = $2', [missionId, userId])
}

// Sign a user up to a role (moving them off any other role on the mission).
// Returns { ok } or { ok:false, error }.
export async function signUp(missionId, roleId, userId) {
  const role = await one('SELECT * FROM mission_roles WHERE id = $1 AND mission_id = $2', [roleId, missionId])
  if (!role) return { ok: false, error: 'Unknown role.' }
  if (role.slots > 0) {
    const taken = await one('SELECT count(*)::int AS n FROM mission_signups WHERE role_id = $1 AND user_id <> $2', [roleId, userId])
    if (taken.n >= role.slots) return { ok: false, error: 'That role is full.' }
  }
  await query(
    `INSERT INTO mission_signups (mission_id, role_id, user_id) VALUES ($1,$2,$3)
     ON CONFLICT (mission_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id, created_at = now()`,
    [missionId, roleId, userId],
  )
  return { ok: true }
}

export function leaveMission(missionId, userId) {
  return query('DELETE FROM mission_signups WHERE mission_id = $1 AND user_id = $2', [missionId, userId])
}

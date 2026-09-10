import { one, many, query, tx } from '../db.js'

export const MISSION_MAX = { title: 140, objective: 8000, field: 200, aar: 4000, roleName: 60, shipName: 60 }

// Keys accepted in a `!mission` command.
const KEY_MAP = {
  title: 'title',
  type: 'mission_type', kind: 'mission_type',
  crew: 'roles', role: 'roles', roles: 'roles', needs: 'roles',
  ship: 'ships', ships: 'ships', fleet: 'ships',
  pay: 'pay', reward: 'pay', payout: 'pay',
  launch: 'launch_at', when: 'launch_at', eta: 'launch_at', time: 'launch_at',
  'mission time': 'launch_at', mission: 'launch_at', 'launch time': 'launch_at',
  rollcall: 'roll_call_at', 'roll call': 'roll_call_at', roll_call: 'roll_call_at', ready: 'roll_call_at', muster: 'roll_call_at',
  meetup: 'meetup', 'meet up': 'meetup', meet: 'meetup', rv: 'meetup', rally: 'meetup',
  rendezvous: 'meetup', location: 'meetup', loc: 'meetup', where: 'meetup',
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
  'ship: Heavy fighter x2, Medical',
  'pay: 50k aUEC each',
  'rollcall: 2026-09-10 19:45Z',
  'mission time: 2026-09-10 20:00Z',
  'meetup: Seraphim Station, hangar 3',
  '',
  'Escort the C2 through the Pyro gateway — expect pirates.',
  '```',
  '`role:` lines become crew slots; `ship:` lines are the fleet the mission wants.',
  'Everything after the keyed lines is the objective / briefing. Title and objective are required.',
].join('\n')

function parseWhen(v) {
  if (!v) return null
  const d = new Date(String(v).trim())
  return isNaN(d.getTime()) ? null : d
}

// Tidy a role/ship name: collapse whitespace, drop a dangling unmatched
// bracket or trailing punctuation left over from parsing.
export function cleanSpecName(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[([{]\s*$/, '')     // "Hornet (Mk1 or Mk2) (" -> "Hornet (Mk1 or Mk2)"
    .replace(/^[)\]}\s]+/, '')
    .trim()
}

// "Fighter x2" / "2x Fighter" / "2 fighters" / "Medic"  ->  { name, n }
// The multiplier must be space-separated so it doesn't eat a name like
// "Hornet (Mk1 or Mk2)".
export function parseCountSpec(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  let m = s.match(/^(.+?)\s+[x×*]\s*(\d{1,2})$/i)   // Fighter x2
  if (m) return { name: cleanSpecName(m[1]), n: Number(m[2]) }
  m = s.match(/^(\d{1,2})\s*[x×*]?\s+(.+)$/i)       // 2x Fighter / 2 fighters
  if (m) return { name: cleanSpecName(m[2]), n: Number(m[1]) }
  return { name: cleanSpecName(s), n: 1 }
}

function parseSpecList(value, maxName) {
  return String(value || '')
    .split(/[,\n]/)
    .map(parseCountSpec)
    .filter(r => r && r.name)
    .map(r => ({ name: r.name.slice(0, maxName), n: Math.min(Math.max(r.n | 0, 0), 99) }))
}

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

  const fields = {
    title: '', roles: [], ships: [], mission_type: '', pay: '', objective: '',
    launch_at: null, roll_call_at: null, meetup: '', voice_channel_id: '',
  }
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
      if (key === 'launch_at') fields.launch_at = parseWhen(val)
      else if (key === 'roll_call_at') fields.roll_call_at = parseWhen(val)
      else if (key === 'voice_channel_id') fields.voice_channel_id = val.replace(/\D/g, '').slice(0, 32)
      else if (key === 'objective') { fields.objective = val; inObjective = true }
      else if (key === 'title') fields.title = val.slice(0, MISSION_MAX.title)
      else if (key === 'roles') fields.roles.push(...parseSpecList(val, MISSION_MAX.roleName))
      else if (key === 'ships') fields.ships.push(...parseSpecList(val, MISSION_MAX.shipName))
      else if (key === 'meetup') fields.meetup = val.slice(0, MISSION_MAX.field)
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

// Insert a mission + its roles + its requested ships. `fields.roles` /
// `fields.ships` are [{name, n}] (n = slot count / wanted count). Returns the
// mission row with `.roles` and `.ships` attached.
export async function createMission({ creatorId, fields, source = 'portal' }) {
  const clean = (list, maxName) => (list || [])
    .map(r => ({ name: cleanSpecName(r.name).slice(0, maxName), n: Math.min(Math.max((r.n ?? r.slots) | 0, 0), 99) }))
    .filter(r => r.name)
    .slice(0, 20)
  const roles = clean(fields.roles, MISSION_MAX.roleName)
  const ships = clean(fields.ships, MISSION_MAX.shipName)

  return tx(async client => {
    const m = (await client.query(
      `INSERT INTO missions
         (creator_id, title, role, crew_size, mission_type, objective, pay,
          launch_at, roll_call_at, meetup, voice_channel_id, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        creatorId,
        fields.title.slice(0, MISSION_MAX.title),
        rolesSummary(roles.map(r => ({ name: r.name, slots: r.n }))) || (fields.role || '').slice(0, MISSION_MAX.field),
        (fields.crew_size || '').slice(0, MISSION_MAX.field),
        (fields.mission_type || '').slice(0, MISSION_MAX.field),
        fields.objective.slice(0, MISSION_MAX.objective),
        (fields.pay || '').slice(0, MISSION_MAX.field),
        fields.launch_at || null,
        fields.roll_call_at || null,
        (fields.meetup || '').slice(0, MISSION_MAX.field),
        (fields.voice_channel_id || '').replace(/\D/g, '').slice(0, 32),
        source,
      ],
    )).rows[0]

    for (let i = 0; i < roles.length; i++)
      await client.query('INSERT INTO mission_roles (mission_id, name, slots, position) VALUES ($1,$2,$3,$4)',
        [m.id, roles[i].name, roles[i].n, i])
    for (let i = 0; i < ships.length; i++)
      await client.query('INSERT INTO mission_ships (mission_id, name, count, position) VALUES ($1,$2,$3,$4)',
        [m.id, ships[i].name, ships[i].n, i])

    m.roles = (await client.query('SELECT * FROM mission_roles WHERE mission_id = $1 ORDER BY position, id', [m.id])).rows
    m.ships = (await client.query('SELECT * FROM mission_ships WHERE mission_id = $1 ORDER BY position, id', [m.id])).rows
    return m
  })
}

export function missionShips(missionId) {
  return many('SELECT * FROM mission_ships WHERE mission_id = $1 ORDER BY position, id', [missionId])
}

// Update a mission's fields and reconcile its roles / ships against the
// submitted list. Rows carrying an existing id are kept (and their sign-ups
// with them); rows with no id are added; existing rows not in the list are
// removed (their sign-ups cascade away). `fields.roles` / `fields.ships` are
// [{ id?, name, n }].
export async function updateMission({ missionId, fields }) {
  const shape = (list, maxName) => (list || [])
    .map(r => ({ id: r.id ? Number(r.id) : null, name: cleanSpecName(r.name).slice(0, maxName), n: Math.min(Math.max((r.n ?? r.slots) | 0, 0), 99) }))
    .filter(r => r.name)
    .slice(0, 20)
  const roles = shape(fields.roles, MISSION_MAX.roleName)
  const ships = shape(fields.ships, MISSION_MAX.shipName)

  return tx(async client => {
    await client.query(
      `UPDATE missions SET
         title = $2, role = $3, mission_type = $4, objective = $5, pay = $6,
         launch_at = $7, roll_call_at = $8, meetup = $9, voice_channel_id = $10
       WHERE id = $1`,
      [
        missionId,
        fields.title.slice(0, MISSION_MAX.title),
        rolesSummary(roles.map(r => ({ name: r.name, slots: r.n }))),
        (fields.mission_type || '').slice(0, MISSION_MAX.field),
        fields.objective.slice(0, MISSION_MAX.objective),
        (fields.pay || '').slice(0, MISSION_MAX.field),
        fields.launch_at || null,
        fields.roll_call_at || null,
        (fields.meetup || '').slice(0, MISSION_MAX.field),
        (fields.voice_channel_id || '').replace(/\D/g, '').slice(0, 32),
      ],
    )
    await reconcile(client, 'mission_roles', 'slots', missionId, roles)
    await reconcile(client, 'mission_ships', 'count', missionId, ships)

    const m = (await client.query('SELECT * FROM missions WHERE id = $1', [missionId])).rows[0]
    m.roles = (await client.query('SELECT * FROM mission_roles WHERE mission_id = $1 ORDER BY position, id', [missionId])).rows
    m.ships = (await client.query('SELECT * FROM mission_ships WHERE mission_id = $1 ORDER BY position, id', [missionId])).rows
    return m
  })
}

const RECONCILE_TABLES = { mission_roles: 'slots', mission_ships: 'count' }

async function reconcile(client, table, countCol, missionId, items) {
  if (RECONCILE_TABLES[table] !== countCol) throw new Error('bad reconcile target')
  const existing = (await client.query(`SELECT id FROM ${table} WHERE mission_id = $1`, [missionId])).rows.map(r => r.id)
  const keep = items.map(it => (existing.includes(it.id) ? it.id : null)).filter(Boolean)

  await client.query(
    `DELETE FROM ${table} WHERE mission_id = $1 AND NOT (id = ANY($2::int[]))`,
    [missionId, keep],
  )
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (existing.includes(it.id)) {
      await client.query(
        `UPDATE ${table} SET name = $2, ${countCol} = $3, position = $4 WHERE id = $1 AND mission_id = $5`,
        [it.id, it.name, it.n, i, missionId],
      )
    } else {
      await client.query(
        `INSERT INTO ${table} (mission_id, name, ${countCol}, position) VALUES ($1, $2, $3, $4)`,
        [missionId, it.name, it.n, i],
      )
    }
  }
}

// Roles for a mission with the members signed up to each, and the ships each
// member is bringing.
export async function missionRoster(missionId) {
  const roles = await many('SELECT * FROM mission_roles WHERE mission_id = $1 ORDER BY position, id', [missionId])
  if (!roles.length) return []
  const signups = await many(`
    SELECT s.role_id, s.user_id, u.username, u.global_name, u.avatar, s.created_at
    FROM mission_signups s JOIN users u ON u.id = s.user_id
    WHERE s.mission_id = $1 ORDER BY s.created_at`, [missionId])
  const ships = await many(`
    SELECT ss.user_id, sh.id, sh.name
    FROM mission_signup_ships ss JOIN mission_ships sh ON sh.id = ss.ship_id
    WHERE ss.mission_id = $1 ORDER BY sh.position, sh.id`, [missionId])
  return roles.map(r => ({
    ...r,
    members: signups.filter(s => s.role_id === r.id).map(s => ({
      ...s,
      ships: ships.filter(sh => sh.user_id === s.user_id),
    })),
  }))
}

export function userSignup(missionId, userId) {
  if (!userId) return Promise.resolve(null)
  return one('SELECT role_id FROM mission_signups WHERE mission_id = $1 AND user_id = $2', [missionId, userId])
}

// Ship ids this user has said they can bring.
export async function userShipIds(missionId, userId) {
  if (!userId) return []
  const rows = await many('SELECT ship_id FROM mission_signup_ships WHERE mission_id = $1 AND user_id = $2', [missionId, userId])
  return rows.map(r => r.ship_id)
}

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

// Replace the set of ships this (signed-up) user can bring.
export async function setSignupShips(missionId, userId, shipIds) {
  const signed = await one('SELECT 1 FROM mission_signups WHERE mission_id = $1 AND user_id = $2', [missionId, userId])
  if (!signed) return { ok: false, error: 'Sign up for a role first.' }
  const valid = (await many('SELECT id FROM mission_ships WHERE mission_id = $1', [missionId])).map(r => r.id)
  const wanted = [...new Set(shipIds.map(Number).filter(id => valid.includes(id)))]
  return tx(async client => {
    await client.query('DELETE FROM mission_signup_ships WHERE mission_id = $1 AND user_id = $2', [missionId, userId])
    for (const id of wanted)
      await client.query('INSERT INTO mission_signup_ships (mission_id, user_id, ship_id) VALUES ($1,$2,$3)', [missionId, userId, id])
    return { ok: true }
  })
}

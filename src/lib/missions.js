import { one } from '../db.js'

export const MISSION_MAX = { title: 140, objective: 8000, field: 200, aar: 4000 }

// Keys accepted in a `!mission` command (and their target column).
const KEY_MAP = {
  title: 'title',
  type: 'mission_type', kind: 'mission_type',
  crew: 'role', role: 'role', roles: 'role', needs: 'role',
  size: 'crew_size', 'crew size': 'crew_size', 'crew_size': 'crew_size', slots: 'crew_size',
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
  'crew: 2 fighters, 1 medic',
  'size: 4',
  'pay: 50k aUEC each',
  'launch: 2026-09-10 20:00Z',
  '',
  'Meet at Seraphim Station. Escort the C2 through the',
  'Pyro gateway — expect pirates at the jump point.',
  '```',
  'Everything after the keyed lines is the objective / briefing. Title and objective are required.',
].join('\n')

function parseLaunch(v) {
  if (!v) return null
  const d = new Date(v.trim())
  return isNaN(d.getTime()) ? null : d
}

// Parse a `!mission …` message body. Returns { ok, fields } or { ok:false, error }.
export function parseMissionCommand(content) {
  const stripped = String(content || '').replace(/^\s*!mission\b[ \t]*/i, '')
  const lines = stripped.split(/\r?\n/)

  const fields = { title: '', role: '', crew_size: '', mission_type: '', pay: '', objective: '', launch_at: null, voice_channel_id: '' }
  const objectiveLines = []
  let inObjective = false

  // First line, if it isn't a key:value, is the title.
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
    if (!line.trim()) continue  // skip blank lines between the keyed fields

    const m = line.match(/^([A-Za-z][A-Za-z _]*?)\s*[:=]\s*(.*)$/)
    const key = m && KEY_MAP[m[1].toLowerCase().trim()]
    if (key) {
      const val = m[2].trim()
      if (key === 'launch_at') fields.launch_at = parseLaunch(val)
      else if (key === 'voice_channel_id') fields.voice_channel_id = val.replace(/\D/g, '').slice(0, 32)
      else if (key === 'objective') { fields.objective = val; inObjective = true }
      else if (key === 'title') fields.title = val.slice(0, MISSION_MAX.title)
      else fields[key] = val.slice(0, MISSION_MAX.field)
    } else {
      // First non-key, non-blank line — the rest is the objective.
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

// Insert a mission row. `source` is 'portal' or 'fluxer'.
export function createMission({ creatorId, fields, source = 'portal' }) {
  return one(
    `INSERT INTO missions
       (creator_id, title, role, crew_size, mission_type, objective, pay, launch_at, voice_channel_id, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      creatorId,
      fields.title.slice(0, MISSION_MAX.title),
      (fields.role || '').slice(0, MISSION_MAX.field),
      (fields.crew_size || '').slice(0, MISSION_MAX.field),
      (fields.mission_type || '').slice(0, MISSION_MAX.field),
      fields.objective.slice(0, MISSION_MAX.objective),
      (fields.pay || '').slice(0, MISSION_MAX.field),
      fields.launch_at || null,
      (fields.voice_channel_id || '').replace(/\D/g, '').slice(0, 32),
      source,
    ],
  )
}

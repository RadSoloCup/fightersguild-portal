import { config } from '../config.js'
import { query, one } from '../db.js'
import { GatewayClient } from './gateway.js'
import { announceMission, postMessage } from './announce.js'
import { parseMissionCommand, createMission, MISSION_COMMAND_HELP } from '../lib/missions.js'

const log = (...a) => console.log(new Date().toISOString(), '[missionbot]', ...a)

let client = null

// Create/refresh a lightweight user row for a Fluxer author. They're posting in
// the guild's mission channel, so they're a member; a full profile + guild
// re-check happens if/when they sign into the portal on the web.
async function upsertAuthor(a) {
  await query(
    `INSERT INTO users (id, username, global_name, avatar, last_seen, membership_checked_at)
     VALUES ($1, $2, $3, $4, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       global_name = EXCLUDED.global_name,
       avatar = EXCLUDED.avatar,
       last_seen = now()`,
    [a.id, a.username || 'member', a.global_name ?? null, a.avatar ?? null],
  )
}

async function handleMessage(d) {
  if (d.channel_id !== config.bot.missionChannelId) return
  const content = String(d.content || '')
  if (!/^\s*!mission\b/i.test(content)) return

  if (/^\s*!mission\s+help\s*$/i.test(content)) {
    await postMessage(d.channel_id, { content: MISSION_COMMAND_HELP })
    return
  }

  const parsed = parseMissionCommand(content)
  if (!parsed.ok) {
    await postMessage(d.channel_id, { content: `⚠️ ${parsed.error}\n\n${MISSION_COMMAND_HELP}` })
    return
  }

  try {
    const author = d.author || {}
    await upsertAuthor(author)
    const creator = { id: author.id, name: author.global_name || author.username || 'member' }
    const mission = await createMission({ creatorId: author.id, fields: parsed.fields, source: 'fluxer' })

    let mid = null
    try { mid = await announceMission({ mission, creator }) } catch (e) { log('announce:', e.message) }
    if (mid) {
      await query('UPDATE missions SET fluxer_message_id = $1 WHERE id = $2', [mid, mission.id])
    } else {
      // Rich embed didn't post — give at least a plain-text confirmation + link.
      await postMessage(d.channel_id, {
        content: `✅ Mission **#${mission.id} — ${mission.title}** is on the board: ${config.baseUrl}/missions/${mission.id}`,
      })
    }
    log(`created mission #${mission.id} from ${creator.name}`)
  } catch (e) {
    log('create failed:', e.stack || e.message)
    await postMessage(d.channel_id, { content: '❌ Something went wrong posting that mission — try again or use the web form.' })
  }
}

export function startMissionBot() {
  if (!config.bot.token) { log('no PORTAL_BOT_TOKEN — mission bot disabled'); return }
  if (!config.bot.missionChannelId) { log('no MISSION_BOARD_CHANNEL_ID — mission bot disabled'); return }

  client = new GatewayClient()
  client.on('message', d => handleMessage(d).catch(e => log('handler:', e.stack || e.message)))
  client.on('ready', () => log(`listening for !mission in channel ${config.bot.missionChannelId}`))
  client.on('fatal', code => log(`gateway fatal (${code}) — mission bot offline until restart`))
  client.start().catch(e => log('start failed:', e.message))
}

export function stopMissionBot() {
  try { client?.stop() } catch {}
}

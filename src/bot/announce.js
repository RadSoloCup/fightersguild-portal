import { config } from '../config.js'
import { excerpt } from '../lib/markdown.js'

// Outbound-only bot: POST a message to a Fluxer channel with the bot token.
// No gateway connection needed for announcements. Returns the created message
// (so callers can keep its id) or null.
async function post(channelId, payload) {
  if (!config.bot.token || !channelId) return null
  try {
    const res = await fetch(`${config.fluxerApiInternal}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bot ${config.bot.token}`,
        'content-type': 'application/json',
        'user-agent': config.userAgent,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      console.error('announce failed', res.status, (await res.text()).slice(0, 200))
      return null
    }
    return await res.json().catch(() => null)
  } catch (e) {
    console.error('announce error', e.message)
    return null
  }
}

// Post an arbitrary message to a channel (used by the mission bot for replies).
// Returns the created message or null.
export function postMessage(channelId, payload) {
  return post(channelId, payload)
}

// Edit a message the bot previously posted.
async function edit(channelId, messageId, payload) {
  if (!config.bot.token || !channelId || !messageId) return null
  try {
    const res = await fetch(`${config.fluxerApiInternal}/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bot ${config.bot.token}`,
        'content-type': 'application/json',
        'user-agent': config.userAgent,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    })
    return res.ok ? await res.json().catch(() => null) : null
  } catch { return null }
}

export function announceThread({ thread, category, author, body }) {
  const url = `${config.baseUrl}/forum/t/${thread.id}/${thread.slug}`
  return post(config.bot.forumChannelId, {
    embeds: [{
      title: thread.title,
      url,
      description: excerpt(body, 300),
      color: 0x22d3ee,
      author: { name: `${author.name} · new thread in ${category.name}` },
      footer: { text: 'Fighters Guild Portal · Forum' },
    }],
  })
}

function missionEmbed(mission, authorName) {
  const url = `${config.baseUrl}/missions/${mission.id}`
  const fields = []
  if (mission.roles?.length) {
    fields.push({
      name: 'Roles, sign up on the board',
      value: mission.roles.map(r => `• ${r.slots ? `${r.slots}× ` : ''}${r.name}`).join('\n').slice(0, 1024),
    })
  } else if (mission.role) {
    fields.push({ name: 'Crew needed', value: mission.role, inline: true })
  }
  if (mission.ships?.length) {
    fields.push({
      name: 'Ships wanted',
      value: mission.ships.map(s => `• ${s.count ? `${s.count}× ` : ''}${s.name}`).join('\n').slice(0, 1024),
    })
  }
  if (mission.mission_type) fields.push({ name: 'Type', value: mission.mission_type, inline: true })
  if (mission.pay) fields.push({ name: 'Pay', value: mission.pay, inline: true })
  const ts = v => { const u = Math.floor(new Date(v).getTime() / 1000); return `<t:${u}:F> (<t:${u}:R>)` }
  if (mission.roll_call_at) fields.push({ name: 'Roll call', value: ts(mission.roll_call_at), inline: true })
  if (mission.launch_at) fields.push({ name: 'Mission time', value: ts(mission.launch_at), inline: true })
  if (mission.meetup) fields.push({ name: 'Meet-up point', value: mission.meetup, inline: true })
  if (mission.voice_channel_id) fields.push({ name: 'Voice', value: `<#${mission.voice_channel_id}>`, inline: true })
  return {
    title: mission.title,
    url,
    description: `${mission.objective}\n\n**Sign up / details:** ${url}`,
    color: 0x22d3ee,
    author: { name: authorName },
    fields,
    footer: { text: 'Fighters Guild Portal · Mission board' },
  }
}

// Post a mission to the board channel. Returns the message id, or null.
export async function announceMission({ mission, creator }) {
  const msg = await post(config.bot.missionChannelId, {
    content: `🎯 **New mission** — ${mission.title}`,
    embeds: [missionEmbed(mission, `${creator.name} posted a mission`)],
  })
  return msg?.id || null
}

// Re-render the board message after an edit (best effort).
export function editMissionAnnounce({ mission }) {
  if (!mission.fluxer_message_id) return Promise.resolve(null)
  return edit(config.bot.missionChannelId, mission.fluxer_message_id, {
    content: `🎯 **Mission** — ${mission.title}`,
    embeds: [missionEmbed(mission, 'Mission updated')],
  })
}

export function announceMissionResult({ mission }) {
  const url = `${config.baseUrl}/missions/${mission.id}`
  const passed = mission.outcome === 'passed'
  return post(config.bot.missionChannelId, {
    content: `${passed ? '✅' : '❌'} **Mission ${passed ? 'complete — PASSED' : 'closed — FAILED'}** — ${mission.title}`,
    embeds: [{
      description: `${mission.aar_reason ? `${mission.aar_reason}\n\n` : ''}**AAR:** ${url}`,
      color: passed ? 0x2ec16a : 0xe0483d,
      footer: { text: 'Fighters Guild Portal · Mission board' },
    }],
  })
}

export function announceEvent({ event, creator }) {
  const url = `${config.baseUrl}/events/${event.id}`
  const when = new Date(event.starts_at)
  const unix = Math.floor(when.getTime() / 1000)
  return post(config.bot.eventsChannelId, {
    content: `📅 **${event.title}** — <t:${unix}:F> (<t:${unix}:R>)`,
    embeds: [{
      title: event.title,
      url,
      description: [
        event.location ? `**Where:** ${event.location}` : null,
        `**RSVP:** ${url}`,
      ].filter(Boolean).join('\n'),
      color: 0x22d3ee,
      author: { name: `${creator.name} scheduled an event` },
      footer: { text: 'Fighters Guild Portal · Events' },
    }],
  })
}

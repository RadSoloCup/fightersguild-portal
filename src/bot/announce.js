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

// Post a mission to the board channel. Returns the message id, or null.
export async function announceMission({ mission, creator }) {
  const url = `${config.baseUrl}/missions/${mission.id}`
  const fields = []
  if (mission.roles?.length) {
    fields.push({
      name: 'Roles — sign up on the board',
      value: mission.roles.map(r => `• ${r.slots ? `${r.slots}× ` : ''}${r.name}`).join('\n').slice(0, 1024),
    })
  } else if (mission.role) {
    fields.push({ name: 'Crew needed', value: mission.role, inline: true })
  }
  if (mission.crew_size) fields.push({ name: 'Crew size', value: mission.crew_size, inline: true })
  if (mission.mission_type) fields.push({ name: 'Type', value: mission.mission_type, inline: true })
  if (mission.pay) fields.push({ name: 'Pay', value: mission.pay, inline: true })
  if (mission.launch_at) {
    const unix = Math.floor(new Date(mission.launch_at).getTime() / 1000)
    fields.push({ name: 'Launch', value: `<t:${unix}:F> (<t:${unix}:R>)`, inline: true })
  }
  if (mission.voice_channel_id) fields.push({ name: 'Voice', value: `<#${mission.voice_channel_id}>`, inline: true })
  const msg = await post(config.bot.missionChannelId, {
    content: `🎯 **New mission** — ${mission.title}`,
    embeds: [{
      title: mission.title,
      url,
      description: `${mission.objective}\n\n**Sign up / details:** ${url}`,
      color: 0x22d3ee,
      author: { name: `${creator.name} posted a mission` },
      fields,
      footer: { text: 'Fighters Guild Portal · Mission board' },
    }],
  })
  return msg?.id || null
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

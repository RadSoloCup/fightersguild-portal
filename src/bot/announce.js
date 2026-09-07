import { config } from '../config.js'
import { excerpt } from '../lib/markdown.js'

// Outbound-only bot: POST a message to a Fluxer channel with the bot token.
// No gateway connection needed for announcements.
async function post(channelId, payload) {
  if (!config.bot.token || !channelId) return
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
    if (!res.ok) console.error('announce failed', res.status, (await res.text()).slice(0, 200))
  } catch (e) {
    console.error('announce error', e.message)
  }
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

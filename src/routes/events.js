import { Hono } from 'hono'
import { config } from '../config.js'
import { one, many, query } from '../db.js'
import { layout, html, raw, avatarUrl, fmtDate, fmtDay } from '../lib/html.js'
import { renderMarkdown } from '../lib/markdown.js'
import { requireAuth } from '../auth/session.js'
import { announceEvent } from '../bot/announce.js'

export const eventRoutes = new Hono()
const B = config.basePath
const MAX_BODY = 8000

// Anyone signed in can create events; tighten to admins by flipping this.
const canCreateEvent = user => !!user

eventRoutes.get('/', async c => {
  const user = c.get('user')
  const upcoming = await many(`
    SELECT e.*, u.username, u.global_name,
      (SELECT count(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going,
      (SELECT count(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'interested') AS interested
    FROM events e JOIN users u ON u.id = e.creator_id
    WHERE e.cancelled = FALSE AND e.starts_at > now() - interval '3 hours'
    ORDER BY e.starts_at
    LIMIT 60`)
  const past = await many(`
    SELECT e.*, u.username, u.global_name
    FROM events e JOIN users u ON u.id = e.creator_id
    WHERE e.cancelled = FALSE AND e.starts_at <= now() - interval '3 hours'
    ORDER BY e.starts_at DESC LIMIT 10`)

  return c.html(layout({
    title: 'Events', user, active: 'events',
    body: html`
      <div class="spread"><h1>Events</h1>
        ${canCreateEvent(user) ? html`<a class="btn" href="${B}/events/new">New event</a>` : ''}</div>
      ${upcoming.length === 0
        ? html`<div class="empty">Nothing on the calendar.${canCreateEvent(user) ? ' Schedule something.' : ''}</div>`
        : html`<div class="stack">${upcoming.map(e => eventRow(e))}</div>`}
      ${past.length ? html`<h3 style="margin-top:34px">Past</h3><div class="list">
        ${past.map(e => html`<a class="list-item" href="${B}/events/${e.id}">
          <div class="spread"><span class="title">${e.title}</span><span class="meta">${fmtDate(e.starts_at)}</span></div></a>`)}
      </div>` : ''}`,
  }))
})

function eventRow(e) {
  const day = fmtDay(e.starts_at)
  return html`
    <a class="card row" style="text-decoration:none" href="${B}/events/${e.id}">
      <div class="event-date"><div class="d">${day.d}</div><div class="m">${day.m}</div></div>
      <div style="flex:1">
        <div class="title" style="color:var(--text-0);font-weight:650">${e.title}</div>
        <div class="meta">${fmtDate(e.starts_at)}${e.location ? html` · ${e.location}` : ''}</div>
        <div class="rsvp-counts"><span>✅ ${e.going} going</span><span>👀 ${e.interested} interested</span></div>
      </div>
    </a>`
}

eventRoutes.get('/new', requireAuth, c => {
  const user = c.get('user')
  return c.html(layout({
    title: 'New event', user, active: 'events',
    body: html`
      <h1>New event</h1>
      <form method="post" action="${B}/events/new" class="stack">
        <div class="field"><label>Title</label><input type="text" name="title" maxlength="140" required autofocus></div>
        <div class="row">
          <div class="field" style="flex:1"><label>Starts</label><input type="datetime-local" name="starts_at" required></div>
          <div class="field" style="flex:1"><label>Ends (optional)</label><input type="datetime-local" name="ends_at"></div>
        </div>
        <div class="field"><label>Location / voice channel (optional)</label><input type="text" name="location" maxlength="200"></div>
        <div class="field"><label>Details — markdown</label><textarea name="body" maxlength="${MAX_BODY}"></textarea></div>
        <div class="btn-row"><button class="btn" type="submit">Create event</button>
          <a class="btn ghost" href="${B}/events">Cancel</a></div>
      </form>
      <p class="dim" style="margin-top:10px">Times are read in your browser's timezone.</p>`,
  }))
})

eventRoutes.post('/new', requireAuth, async c => {
  const user = c.get('user')
  const form = await c.req.parseBody()
  const title = String(form.title || '').trim().slice(0, 140)
  const startsAt = parseLocal(form.starts_at)
  const endsAt = parseLocal(form.ends_at)
  const location = String(form.location || '').trim().slice(0, 200)
  const body = String(form.body || '').trim().slice(0, MAX_BODY)
  if (!title || !startsAt) return c.text('Title and start time are required.', 400)

  const e = await one(`
    INSERT INTO events (creator_id, title, body_md, body_html, location, starts_at, ends_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [user.id, title, body, body ? renderMarkdown(body) : '', location, startsAt, endsAt])

  announceEvent({ event: e, creator: user }).catch(() => {})
  return c.redirect(`${B}/events/${e.id}`)
})

eventRoutes.get('/:id', async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const e = await one(`
    SELECT e.*, u.username, u.global_name, u.avatar
    FROM events e JOIN users u ON u.id = e.creator_id WHERE e.id = $1`, [id])
  if (!e) return c.notFound()

  const rsvps = await many(`
    SELECT r.status, u.id, u.username, u.global_name, u.avatar
    FROM event_rsvps r JOIN users u ON u.id = r.user_id
    WHERE r.event_id = $1 ORDER BY r.updated_at`, [id])
  const mine = user ? rsvps.find(r => r.id === user.id)?.status : null
  const group = s => rsvps.filter(r => r.status === s)

  return c.html(layout({
    title: e.title, user, active: 'events',
    body: html`
      <div class="crumbs"><a href="${B}/events">Events</a> / ${e.title}</div>
      <div class="spread">
        <h1>${e.cancelled ? '[cancelled] ' : ''}${e.title}</h1>
        ${user && (user.id === e.creator_id || user.admin) ? html`
          <form method="post" action="${B}/events/${e.id}/cancel" onsubmit="return confirm('Cancel this event?')">
            <button class="btn ghost sm">${e.cancelled ? 'Un-cancel' : 'Cancel event'}</button></form>` : ''}
      </div>
      <div class="card stack">
        <div><strong>When</strong><br>${fmtDate(e.starts_at)}${e.ends_at ? ` – ${fmtDate(e.ends_at)}` : ''}</div>
        ${e.location ? html`<div><strong>Where</strong><br>${linkify(e.location)}</div>` : ''}
        <div class="dim">Created by ${e.global_name || e.username}</div>
      </div>
      ${e.body_html ? html`<div class="card post-body">${raw(e.body_html)}</div>` : ''}

      ${user && !e.cancelled ? html`
        <form method="post" action="${B}/events/${e.id}/rsvp" class="btn-row" style="margin-top:18px">
          ${['going', 'interested', 'declined'].map(s => html`
            <button class="btn ${mine === s ? '' : 'ghost'}" name="status" value="${s}">
              ${s === 'going' ? 'Going' : s === 'interested' ? 'Interested' : "Can't"}</button>`)}
        </form>` : ''}

      <div class="row" style="margin-top:22px;align-items:flex-start;gap:34px">
        ${['going', 'interested'].map(s => html`
          <div>
            <h3>${s === 'going' ? 'Going' : 'Interested'} (${group(s).length})</h3>
            ${group(s).length
              ? group(s).map(r => html`<div class="row" style="gap:8px;margin:4px 0">
                  <img src="${avatarUrl(r, 40)}" style="width:22px;height:22px;border-radius:50%" alt="">
                  ${r.global_name || r.username}</div>`)
              : html`<div class="dim">—</div>`}
          </div>`)}
      </div>`,
  }))
})

eventRoutes.post('/:id/rsvp', requireAuth, async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const status = String(form.status || '')
  if (!['going', 'interested', 'declined'].includes(status)) return c.text('bad status', 400)
  await query(`
    INSERT INTO event_rsvps (event_id, user_id, status, updated_at)
    VALUES ($1, $2, $3, now())
    ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3, updated_at = now()`,
    [id, user.id, status])
  return c.redirect(`${B}/events/${id}`)
})

eventRoutes.post('/:id/cancel', requireAuth, async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const e = await one('SELECT * FROM events WHERE id = $1', [id])
  if (!e) return c.notFound()
  if (user.id !== e.creator_id && !user.admin) return c.text('Forbidden', 403)
  await query('UPDATE events SET cancelled = NOT cancelled WHERE id = $1', [id])
  return c.redirect(`${B}/events/${id}`)
})

function parseLocal(v) {
  if (!v) return null
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

function linkify(s) {
  const str = String(s)
  if (/^https?:\/\//i.test(str)) return html`<a href="${str}" target="_blank" rel="noopener">${str}</a>`
  return str
}

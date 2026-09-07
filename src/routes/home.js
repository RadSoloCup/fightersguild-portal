import { Hono } from 'hono'
import { config } from '../config.js'
import { many } from '../db.js'
import { layout, html, timeAgo, fmtDate, fmtDay } from '../lib/html.js'

export const homeRoutes = new Hono()
const B = config.basePath

homeRoutes.get('/', async c => {
  const user = c.get('user')

  const missions = await many(`
    SELECT m.id, m.title, m.mission_type, m.role, m.pay, m.launch_at, m.created_at,
      u.username, u.global_name
    FROM missions m JOIN users u ON u.id = m.creator_id
    WHERE m.status = 'open'
    ORDER BY m.launch_at NULLS LAST, m.created_at DESC LIMIT 5`)

  const events = await many(`
    SELECT e.id, e.title, e.starts_at, e.location,
      (SELECT count(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going
    FROM events e
    WHERE e.cancelled = FALSE AND e.starts_at > now() - interval '2 hours'
    ORDER BY e.starts_at LIMIT 5`)

  const threads = await many(`
    SELECT t.id, t.title, t.slug, t.last_post_at, t.post_count,
      c.name AS cat_name, c.slug AS cat_slug,
      u.username, u.global_name
    FROM forum_threads t
    JOIN forum_categories c ON c.id = t.category_id
    JOIN users u ON u.id = t.author_id
    WHERE t.deleted_at IS NULL
    ORDER BY t.last_post_at DESC LIMIT 8`)

  return c.html(layout({
    title: '', user, active: '',
    body: html`
      <div class="stack">
        <div class="card">
          <h1 style="margin-bottom:.2em">Operations Center</h1>
          <p class="muted" style="margin:0">
            ${user ? html`Signed in as <strong>${user.name}</strong>.`
                   : html`<a href="${B}/auth/login">Sign in</a> to post.`}
          </p>
        </div>

        <div class="spread"><h2>Open missions</h2><a class="dim" href="${B}/missions">Mission board →</a></div>
        ${missions.length === 0
          ? html`<div class="empty">No open missions.${user ? html` <a href="${B}/missions/new">Post one</a>.` : ''}</div>`
          : html`<div class="list">${missions.map(m => {
              const bits = [m.mission_type, m.role && `crew: ${m.role}`, m.pay && `pay: ${m.pay}`].filter(Boolean)
              return html`<a class="list-item" href="${B}/missions/${m.id}">
                <div class="spread">
                  <div><div class="title">${m.title}</div>
                    <div class="meta">${bits.join(' · ')}${bits.length ? ' · ' : ''}by ${m.global_name || m.username}</div></div>
                  <div class="meta" style="text-align:right">${m.launch_at ? fmtDate(m.launch_at) : timeAgo(m.created_at)}</div>
                </div></a>`
            })}</div>`}

        <div class="spread" style="margin-top:10px"><h2>Next up</h2><a class="dim" href="${B}/events">All events →</a></div>
        ${events.length === 0
          ? html`<div class="empty">No upcoming events.</div>`
          : html`<div class="stack">${events.map(e => {
              const d = fmtDay(e.starts_at)
              return html`<a class="card row" style="text-decoration:none" href="${B}/events/${e.id}">
                <div class="event-date"><div class="d">${d.d}</div><div class="m">${d.m}</div></div>
                <div style="flex:1"><div class="title" style="color:var(--text-0);font-weight:650">${e.title}</div>
                  <div class="meta">${fmtDate(e.starts_at)}${e.location ? ` · ${e.location}` : ''} · ${e.going} going</div></div>
              </a>`
            })}</div>`}

        <div class="spread" style="margin-top:10px"><h2>Latest in the forum</h2><a class="dim" href="${B}/forum">All →</a></div>
        ${threads.length === 0
          ? html`<div class="empty">No threads yet.</div>`
          : html`<div class="list">${threads.map(t => html`
              <a class="list-item" href="${B}/forum/t/${t.id}/${t.slug}">
                <div class="spread">
                  <div><div class="title">${t.title}</div>
                    <div class="meta">${t.cat_name} · by ${t.global_name || t.username}</div></div>
                  <div class="meta" style="text-align:right">${t.post_count} repl${Number(t.post_count) === 1 ? 'y' : 'ies'}<br>
                    <span class="dim">${timeAgo(t.last_post_at)}</span></div>
                </div></a>`)}</div>`}
      </div>`,
  }))
})

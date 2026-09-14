import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config, assertConfig } from './config.js'
import { pool, one } from './db.js'
import { migrate } from './migrate.js'
import { loadUser } from './auth/session.js'
import { layout, html, gatePage } from './lib/html.js'
import { renderMarkdown } from './lib/markdown.js'
import { sweepMembership } from './lib/membership.js'
import { pollGameServers } from './lib/gameservers.js'
import { startMissionBot } from './bot/missionbot.js'
import { pollStatus } from './lib/status.js'
import { setCrosstalkStatus } from './lib/crosstalkStatus.js'
import { announceEvent } from './bot/announce.js'
import { homeRoutes } from './routes/home.js'
import { authRoutes } from './routes/auth.js'
import { forumRoutes } from './routes/forum.js'
import { eventRoutes } from './routes/events.js'
import { serverRoutes } from './routes/servers.js'
import { missionRoutes } from './routes/missions.js'
import { adminRoutes } from './routes/admin.js'

const B = config.basePath

const app = new Hono()

// Collapse trailing slashes with a scheme-relative redirect (behind a TLS proxy
// an absolute redirect would downgrade to http).
app.use('*', async (c, next) => {
  const { pathname, search } = new URL(c.req.url)
  if (pathname.length > 1 && pathname.endsWith('/') && c.req.method === 'GET') {
    return c.redirect(pathname.replace(/\/+$/, '') + search, 301)
  }
  await next()
})

// Static assets: <base>/static/* -> public/
app.use(`${B}/static/*`, serveStatic({
  root: './public',
  rewriteRequestPath: p => p.replace(`${B}/static`, ''),
}))

// Uploaded forum/mission images.
app.get(`${B}/uploads/:name`, async c => {
  const name = c.req.param('name')
  if (!/^[\w.-]+\.(png|jpe?g|gif|webp)$/i.test(name)) return c.notFound()
  try {
    const buf = await readFile(join(config.uploadDir, name))
    const ext = name.split('.').pop().toLowerCase()
    const type = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    return c.body(buf, 200, { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' })
  } catch { return c.notFound() }
})

// Launcher distribution: distribution.json + the packaged mod/config files it
// references (built by Nebula). No portal session required — the desktop
// launcher has no browser session to gate on, so this is public, same as any
// other unlisted download link. Uses serveStatic (not readFile) since these
// files can be GB-scale; serveStatic streams and supports range requests,
// which readFile-into-memory (as used for small forum image uploads below)
// would not handle well.
app.use('/downloads/*', serveStatic({
  root: config.downloadsDir,
  rewriteRequestPath: p => p.replace('/downloads', ''),
}))

// Modpack update pages: public changelog/announcement pages, styled as
// standalone one-off HTML (not the portal's Hono layout). No sign-in
// required — these are meant to be shareable with anyone, guild member
// or not.
app.get('/updates', c => c.redirect('/updates/modpack-1-3'))
app.get('/updates/modpack-1-3', async c => {
  const html = await readFile('./public/updates/modpack-1-3.html', 'utf8')
  return c.html(html)
})
app.use('/updates/assets/*', serveStatic({
  root: './public/updates/assets',
  rewriteRequestPath: p => p.replace('/updates/assets', ''),
}))

// The Minecraft hub: download, updates (blog style, each post keeps its own
// page under /updates/*), full mod list, and keybinds — all in one public
// page with client-side tabs. Linked from the portal's nav (see
// lib/html.js), but reachable and fully functional without signing in,
// same as the update pages above. The mod list and keybind data here are
// generated from the actual installed mods (mods.toml metadata + options.txt)
// rather than hand-maintained, so they won't drift as mods change.
app.get('/minecraft', async c => {
  const html = await readFile('./public/minecraft/index.html', 'utf8')
  return c.html(html)
})
app.get('/updates/mods', c => c.redirect('/minecraft#mods'))
app.use('/minecraft/*', serveStatic({
  root: './public/minecraft',
  rewriteRequestPath: p => p.replace('/minecraft', ''),
}))

// Machine-to-machine: the Crosstalk bridge POSTs its health snapshot here.
// Bearer-authenticated, outside the sign-in gate.
app.post(`${B}/api/status/crosstalk`, async c => {
  if (!config.status.ingestToken) return c.text('not configured', 404)
  if (c.req.header('authorization') !== `Bearer ${config.status.ingestToken}`) return c.text('unauthorized', 401)
  let body
  try { body = await c.req.json() } catch { return c.text('bad json', 400) }
  setCrosstalkStatus(body)
  return c.body(null, 204)
})

// Machine-to-machine: other services (e.g. fightersguild-mc-events, for a
// seasonal battlepass launch) POST here to create an Events-page entry —
// same shape as the human "new event" form, minus the browser session.
// Reuses the normal insert path, so it also cross-posts to Fluxer via
// announceEvent() exactly like a human-created event does.
app.post(`${B}/api/events/ingest`, async c => {
  if (!config.events.ingestToken) return c.text('not configured', 404)
  if (c.req.header('authorization') !== `Bearer ${config.events.ingestToken}`) return c.text('unauthorized', 401)

  let body
  try { body = await c.req.json() } catch { return c.text('bad json', 400) }
  const title = String(body.title || '').trim().slice(0, 140)
  const startsAt = body.startsAt ? new Date(body.startsAt) : null
  const endsAt = body.endsAt ? new Date(body.endsAt) : null
  const location = String(body.location || '').trim().slice(0, 200)
  const bodyMd = String(body.body || '').trim().slice(0, 8000)
  if (!title || !startsAt || isNaN(startsAt.getTime())) return c.text('title and a valid startsAt are required', 400)

  const creatorId = body.creatorId || config.events.defaultCreatorId
  const creator = creatorId ? await one('SELECT * FROM users WHERE id = $1', [creatorId]) : null
  if (!creator) {
    return c.text('no creator user found — set EVENTS_INGEST_DEFAULT_CREATOR_ID to a user id that has signed into the Portal at least once, or pass creatorId', 400)
  }

  const e = await one(`
    INSERT INTO events (creator_id, title, body_md, body_html, location, starts_at, ends_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [creator.id, title, bodyMd, bodyMd ? renderMarkdown(bodyMd) : '', location, startsAt, endsAt])

  announceEvent({ event: e, creator }).catch(() => {})
  return c.json({ id: e.id, url: `${config.baseUrl}/events/${e.id}` })
})

// Everything below the base path.
const portal = new Hono()
portal.use('*', loadUser)

// Auth gate: nothing under /portal is visible without a signed-in guild member.
// Only the /auth/* flow is open.
portal.use('*', async (c, next) => {
  if (c.get('user')) return next()
  if (c.req.path.startsWith(`${B}/auth`)) return next()
  if (c.req.method === 'GET') return c.html(gatePage())
  return c.text('Sign in required', 401)
})

portal.route('/auth', authRoutes)
portal.route('/servers', serverRoutes)
portal.route('/forum', forumRoutes)
portal.route('/missions', missionRoutes)
portal.route('/events', eventRoutes)
portal.route('/admin', adminRoutes)
portal.route('/', homeRoutes)

app.route(B, portal)

// Bare "/" -> the portal home (handy when hit directly).
app.get('/', c => c.redirect(B))
app.get('/healthz', c => c.text('ok'))

app.notFound(c => {
  if (!c.get('user')) return c.redirect(B)
  return c.html(layout({
    title: 'Not found', user: c.get('user'),
    body: html`<div class="empty"><h1>404</h1><p>Nothing here.</p><p><a href="${B}">Portal home</a></p></div>`,
  }), 404)
})

app.onError((err, c) => {
  console.error(new Date().toISOString(), 'unhandled:', err.stack || err)
  return c.html(layout({
    title: 'Error', user: c.get('user'),
    body: html`<div class="empty"><h1>Something broke</h1><p class="muted">The error's been logged.</p>
      <p><a href="${B}">Portal home</a></p></div>`,
  }), 500)
})

async function main() {
  assertConfig()
  await migrate()

  serve({ fetch: app.fetch, port: config.port }, info => {
    console.log(new Date().toISOString(), `portal listening on :${info.port}  base=${B}  origin=${config.publicOrigin}`)
  })

  // Membership + profile re-sync loop.
  const tick = () => sweepMembership().catch(e => console.error('sweep:', e.message))
  setTimeout(tick, 20_000)
  setInterval(tick, 5 * 60_000)

  // Game-server status poll.
  const pollServers = () => pollGameServers().catch(e => console.error('server poll:', e.message))
  setTimeout(pollServers, 8_000)
  setInterval(pollServers, 2 * 60_000)

  // Mission board: listen for `!mission` in the Fluxer channel.
  startMissionBot()

  // Service + bot status board (Servers page).
  const pollSvc = () => pollStatus().catch(e => console.error('status poll:', e.message))
  setTimeout(pollSvc, 12_000)
  setInterval(pollSvc, 60_000)

  const shutdown = async () => {
    console.log('shutting down')
    try { await pool.end() } catch {}
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('unhandledRejection', e => console.error('unhandledRejection', e?.stack || e))
}

main().catch(err => { console.error('fatal:', err.stack || err); process.exit(1) })

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config, assertConfig } from './config.js'
import { pool } from './db.js'
import { migrate } from './migrate.js'
import { loadUser } from './auth/session.js'
import { layout, html, gatePage } from './lib/html.js'
import { sweepMembership } from './lib/membership.js'
import { pollGameServers } from './lib/gameservers.js'
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

// Everything below the base path.
const portal = new Hono()
portal.use('*', loadUser)

// Auth gate — nothing under /portal is visible without a signed-in guild member.
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

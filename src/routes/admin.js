import { Hono } from 'hono'
import { config } from '../config.js'
import { one, many, query } from '../db.js'
import { layout, html, avatarUrl, fmtDate, timeAgo } from '../lib/html.js'
import { slugify } from '../lib/slug.js'
import { requireAdmin } from '../auth/session.js'
import { logMod, recentModActions } from '../lib/modlog.js'

export const adminRoutes = new Hono()
const B = config.basePath

adminRoutes.use('*', requireAdmin)

// ── Dashboard ──────────────────────────────────────────────────────────────
adminRoutes.get('/', async c => {
  const user = c.get('user')
  const stats = await one(`
    SELECT
      (SELECT count(*) FROM users WHERE revoked_at IS NULL) AS members,
      (SELECT count(*) FROM users WHERE is_admin) AS admins,
      (SELECT count(*) FROM forum_threads WHERE deleted_at IS NULL) AS threads,
      (SELECT count(*) FROM forum_posts WHERE deleted_at IS NULL) AS posts,
      (SELECT count(*) FROM events WHERE cancelled = FALSE) AS events`)
  const log = await recentModActions(12)

  return c.html(layout({
    title: 'Admin', user, active: 'admin',
    body: html`
      <h1>Admin</h1>
      <div class="row" style="gap:10px;margin-bottom:8px">
        <a class="btn ghost" href="${B}/admin/categories">Categories</a>
        <a class="btn ghost" href="${B}/admin/users">Members</a>
        <a class="btn ghost" href="${B}/admin/log">Mod log</a>
      </div>
      <div class="card">
        <div class="rsvp-counts" style="gap:26px;font-size:.95rem">
          <span><strong style="color:var(--text-0)">${stats.members}</strong> members</span>
          <span><strong style="color:var(--text-0)">${stats.admins}</strong> admins</span>
          <span><strong style="color:var(--text-0)">${stats.threads}</strong> threads</span>
          <span><strong style="color:var(--text-0)">${stats.posts}</strong> posts</span>
          <span><strong style="color:var(--text-0)">${stats.events}</strong> events</span>
        </div>
      </div>
      <h3 style="margin-top:26px">Recent moderation</h3>
      ${logTable(log)}`,
  }))
})

// ── Categories ─────────────────────────────────────────────────────────────
adminRoutes.get('/categories', async c => {
  const user = c.get('user')
  const cats = await many(`
    SELECT c.*, (SELECT count(*) FROM forum_threads t WHERE t.category_id = c.id AND t.deleted_at IS NULL) AS threads
    FROM forum_categories c ORDER BY c.position, c.id`)

  return c.html(layout({
    title: 'Categories', user, active: 'admin',
    body: html`
      <div class="crumbs"><a href="${B}/admin">Admin</a> / Categories</div>
      <h1>Forum categories</h1>
      <div class="stack">
        ${cats.map(cat => html`
          <form method="post" action="${B}/admin/categories/${cat.id}" class="card stack">
            <div class="row" style="gap:10px">
              <div class="field" style="flex:2;margin:0"><label>Name</label>
                <input type="text" name="name" value="${cat.name}" required></div>
              <div class="field" style="flex:0 0 90px;margin:0"><label>Order</label>
                <input type="text" name="position" value="${cat.position}"></div>
            </div>
            <div class="field" style="margin:0"><label>Description</label>
              <input type="text" name="description" value="${cat.description}"></div>
            <div class="row" style="justify-content:space-between">
              <label style="text-transform:none;letter-spacing:0;color:var(--text-1)">
                <input type="checkbox" name="locked" value="1" ${cat.locked ? 'checked' : ''} style="width:auto;margin-right:6px">
                Read-only (admins post only)</label>
              <div class="btn-row">
                <span class="dim" style="align-self:center">${cat.threads} threads</span>
                <button class="btn sm" type="submit">Save</button>
                <button class="btn ghost sm" formaction="${B}/admin/categories/${cat.id}/delete"
                  onclick="return confirm('Delete &quot;${cat.name}&quot; and all ${cat.threads} of its threads?')">Delete</button>
              </div>
            </div>
          </form>`)}
      </div>

      <h3 style="margin-top:26px">New category</h3>
      <form method="post" action="${B}/admin/categories" class="card stack">
        <div class="field" style="margin:0"><label>Name</label><input type="text" name="name" required></div>
        <div class="field" style="margin:0"><label>Description</label><input type="text" name="description"></div>
        <div class="btn-row"><button class="btn" type="submit">Create</button></div>
      </form>`,
  }))
})

adminRoutes.post('/categories', async c => {
  const user = c.get('user')
  const f = await c.req.parseBody()
  const name = String(f.name || '').trim().slice(0, 60)
  if (!name) return c.text('Name required', 400)
  const maxPos = (await one('SELECT COALESCE(max(position), -1) AS m FROM forum_categories')).m
  const cat = await one(
    `INSERT INTO forum_categories (slug, name, description, position)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [slugify(name), name, String(f.description || '').trim().slice(0, 200), maxPos + 1],
  )
  await logMod(user.id, 'category_create', 'category', cat.id, name)
  return c.redirect(`${B}/admin/categories`)
})

adminRoutes.post('/categories/:id', async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const f = await c.req.parseBody()
  const name = String(f.name || '').trim().slice(0, 60)
  if (!name) return c.text('Name required', 400)
  const pos = Number.parseInt(f.position, 10)
  await query(
    `UPDATE forum_categories SET name = $1, description = $2, locked = $3,
       position = COALESCE($4, position) WHERE id = $5`,
    [name, String(f.description || '').trim().slice(0, 200), f.locked === '1',
     Number.isFinite(pos) ? pos : null, id],
  )
  await logMod(user.id, 'category_update', 'category', id, name)
  return c.redirect(`${B}/admin/categories`)
})

adminRoutes.post('/categories/:id/delete', async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const cat = await one('SELECT name FROM forum_categories WHERE id = $1', [id])
  const remaining = await one('SELECT count(*) AS n FROM forum_categories')
  if (Number(remaining.n) <= 1) return c.text('Cannot delete the last category.', 400)
  await query('DELETE FROM forum_categories WHERE id = $1', [id]) // threads cascade
  await logMod(user.id, 'category_delete', 'category', id, cat?.name || '')
  return c.redirect(`${B}/admin/categories`)
})

// ── Members ────────────────────────────────────────────────────────────────
adminRoutes.get('/users', async c => {
  const user = c.get('user')
  const users = await many(`
    SELECT u.*,
      (SELECT count(*) FROM forum_posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS posts
    FROM users u ORDER BY u.is_admin DESC, u.last_seen DESC LIMIT 500`)

  return c.html(layout({
    title: 'Members', user, active: 'admin',
    body: html`
      <div class="crumbs"><a href="${B}/admin">Admin</a> / Members</div>
      <h1>Members <span class="dim" style="font-weight:400">(${users.length})</span></h1>
      <div class="list">
        ${users.map(u => html`
          <div class="list-item" style="cursor:default">
            <div class="spread">
              <div class="row" style="gap:10px">
                <img src="${avatarUrl(u, 40)}" alt="" style="width:30px;height:30px;border-radius:50%">
                <div>
                  <div class="title">${u.global_name || u.username}
                    ${u.is_admin ? html`<span class="pill interested">admin</span>` : ''}
                    ${u.revoked_at ? html`<span class="pill lock">revoked</span>` : ''}
                    ${u.id === user.id ? html`<span class="pill">you</span>` : ''}</div>
                  <div class="meta">@${u.username} · ${u.posts} posts · seen ${timeAgo(u.last_seen)}</div>
                </div>
              </div>
              ${u.id === user.id ? '' : html`
                <form method="post" action="${B}/admin/users/${u.id}" class="btn-row">
                  ${u.is_admin
                    ? html`<button class="btn ghost sm" name="action" value="revoke_admin">Remove admin</button>`
                    : html`<button class="btn ghost sm" name="action" value="grant_admin">Make admin</button>`}
                  ${u.revoked_at
                    ? html`<button class="btn ghost sm" name="action" value="restore_access">Restore</button>`
                    : html`<button class="btn ghost sm" name="action" value="revoke_access"
                        onclick="return confirm('Revoke ${u.username}&#39;s access? They lose the Portal until they sign in again as a guild member.')">Revoke</button>`}
                </form>`}
            </div>
          </div>`)}
      </div>
      <p class="dim" style="margin-top:12px">Admins in <code>PORTAL_ADMIN_IDS</code> are re-granted admin on every sign-in.</p>`,
  }))
})

adminRoutes.post('/users/:id', async c => {
  const user = c.get('user')
  const id = c.req.param('id')
  if (id === user.id) return c.text("Can't moderate yourself.", 400)
  const target = await one('SELECT username FROM users WHERE id = $1', [id])
  if (!target) return c.notFound()
  const action = (await c.req.parseBody()).action

  const map = {
    grant_admin: ['UPDATE users SET is_admin = TRUE WHERE id = $1', 'grant_admin'],
    revoke_admin: ['UPDATE users SET is_admin = FALSE WHERE id = $1', 'revoke_admin'],
    revoke_access: ['UPDATE users SET revoked_at = now() WHERE id = $1', 'revoke_access'],
    restore_access: ['UPDATE users SET revoked_at = NULL, membership_checked_at = now() WHERE id = $1', 'restore_access'],
  }
  const entry = map[action]
  if (!entry) return c.text('Unknown action', 400)
  await query(entry[0], [id])
  if (action === 'revoke_access') await query('DELETE FROM oauth_tokens WHERE user_id = $1', [id])
  await logMod(user.id, entry[1], 'user', id, target.username)
  return c.redirect(`${B}/admin/users`)
})

// ── Mod log ────────────────────────────────────────────────────────────────
adminRoutes.get('/log', async c => {
  const user = c.get('user')
  const log = await recentModActions(200)
  return c.html(layout({
    title: 'Mod log', user, active: 'admin',
    body: html`
      <div class="crumbs"><a href="${B}/admin">Admin</a> / Mod log</div>
      <h1>Moderation log</h1>
      ${logTable(log)}`,
  }))
})

function logTable(log) {
  if (!log.length) return html`<div class="empty">Nothing logged yet.</div>`
  return html`<div class="list">
    ${log.map(m => html`
      <div class="list-item" style="cursor:default">
        <div class="spread">
          <div><span class="title">${(m.global_name || m.username)}</span>
            <span class="meta">${m.action.replace(/_/g, ' ')} · ${m.target_type}${m.detail ? ` · ${m.detail}` : ''}</span></div>
          <div class="meta dim">${fmtDate(m.created_at)}</div>
        </div>
      </div>`)}
  </div>`
}

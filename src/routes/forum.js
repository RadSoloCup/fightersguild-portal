import { Hono } from 'hono'
import { config } from '../config.js'
import { one, many, query, tx } from '../db.js'
import { layout, html, raw, avatarUrl, timeAgo, fmtDate } from '../lib/html.js'
import { renderMarkdown, excerpt } from '../lib/markdown.js'
import { slugify } from '../lib/slug.js'
import { requireAuth } from '../auth/session.js'
import { announceThread } from '../bot/announce.js'
import { logMod } from '../lib/modlog.js'

export const forumRoutes = new Hono()
const B = config.basePath

const MAX_TITLE = 140
const MAX_BODY = 20_000

// ── Index: categories ──────────────────────────────────────────────────────
forumRoutes.get('/', async c => {
  const user = c.get('user')
  const cats = await many(`
    SELECT c.*,
      (SELECT count(*) FROM forum_threads t WHERE t.category_id = c.id AND t.deleted_at IS NULL) AS thread_count,
      (SELECT max(t.last_post_at) FROM forum_threads t WHERE t.category_id = c.id AND t.deleted_at IS NULL) AS last_activity
    FROM forum_categories c
    ORDER BY c.position, c.id`)

  return c.html(layout({
    title: 'Forum', user, active: 'forum',
    body: html`
      <h1>Forum</h1>
      <div class="list">
        ${cats.map(cat => html`
          <a class="list-item" href="${B}/forum/c/${cat.slug}">
            <div class="spread">
              <div>
                <div class="title">${cat.name} ${cat.locked ? html`<span class="pill lock">read-only</span>` : ''}</div>
                <div class="meta">${cat.description}</div>
              </div>
              <div class="meta" style="text-align:right">
                ${cat.thread_count} thread${Number(cat.thread_count) === 1 ? '' : 's'}
                ${cat.last_activity ? html`<br><span class="dim">${timeAgo(cat.last_activity)}</span>` : ''}
              </div>
            </div>
          </a>`)}
      </div>`,
  }))
})

// ── Category: threads ──────────────────────────────────────────────────────
forumRoutes.get('/c/:slug', async c => {
  const user = c.get('user')
  const cat = await one('SELECT * FROM forum_categories WHERE slug = $1', [c.req.param('slug')])
  if (!cat) return c.notFound()

  const threads = await many(`
    SELECT t.*, u.username, u.global_name, u.avatar,
      lp.username AS lp_username, lp.global_name AS lp_global_name,
      r.read_at
    FROM forum_threads t
    JOIN users u ON u.id = t.author_id
    LEFT JOIN LATERAL (
      SELECT au.username, au.global_name FROM forum_posts p
      JOIN users au ON au.id = p.author_id
      WHERE p.thread_id = t.id AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC LIMIT 1
    ) lp ON true
    LEFT JOIN forum_reads r ON r.thread_id = t.id AND r.user_id = $2
    WHERE t.category_id = $1 AND t.deleted_at IS NULL
    ORDER BY t.pinned DESC, t.last_post_at DESC
    LIMIT 100`, [cat.id, user?.id ?? '0'])

  const canPost = user && (!cat.locked || user.admin)

  return c.html(layout({
    title: cat.name, user, active: 'forum',
    body: html`
      <div class="crumbs"><a href="${B}/forum">Forum</a> / ${cat.name}</div>
      <div class="spread"><h1>${cat.name}</h1>
        ${canPost ? html`<a class="btn" href="${B}/forum/c/${cat.slug}/new">New thread</a>` : ''}</div>
      <p class="muted">${cat.description}</p>
      ${threads.length === 0
        ? html`<div class="empty">No threads yet.${canPost ? ' Start one.' : ''}</div>`
        : html`<div class="list">${threads.map(t => {
            const unread = user && (!t.read_at || new Date(t.last_post_at) > new Date(t.read_at))
            return html`
              <a class="list-item ${unread ? 'unread' : ''}" href="${B}/forum/t/${t.id}/${t.slug}">
                <div class="spread">
                  <div>
                    <div class="title">
                      ${t.pinned ? html`<span class="pill pin">pinned</span> ` : ''}
                      ${t.locked ? html`<span class="pill lock">locked</span> ` : ''}
                      ${t.title}
                    </div>
                    <div class="meta">by ${t.global_name || t.username} · ${timeAgo(t.created_at)}</div>
                  </div>
                  <div class="meta" style="text-align:right">
                    ${t.post_count} repl${Number(t.post_count) === 1 ? 'y' : 'ies'}<br>
                    <span class="dim">last ${timeAgo(t.last_post_at)}</span>
                  </div>
                </div>
              </a>`
          })}</div>`}`,
  }))
})

// ── New thread ─────────────────────────────────────────────────────────────
forumRoutes.get('/c/:slug/new', requireAuth, async c => {
  const user = c.get('user')
  const cat = await one('SELECT * FROM forum_categories WHERE slug = $1', [c.req.param('slug')])
  if (!cat) return c.notFound()
  if (cat.locked && !user.admin) return c.text('This category is read-only.', 403)

  return c.html(layout({
    title: `New thread — ${cat.name}`, user, active: 'forum',
    body: html`
      <div class="crumbs"><a href="${B}/forum">Forum</a> / <a href="${B}/forum/c/${cat.slug}">${cat.name}</a> / new</div>
      <h1>New thread</h1>
      <form method="post" action="${B}/forum/c/${cat.slug}/new" class="stack">
        <div class="field"><label>Title</label>
          <input type="text" name="title" maxlength="${MAX_TITLE}" required autofocus></div>
        <div class="field"><label>Message — markdown</label>
          <textarea name="body" maxlength="${MAX_BODY}" required></textarea></div>
        <div class="btn-row">
          <button class="btn" type="submit">Post thread</button>
          <a class="btn ghost" href="${B}/forum/c/${cat.slug}">Cancel</a>
        </div>
      </form>`,
  }))
})

forumRoutes.post('/c/:slug/new', requireAuth, async c => {
  const user = c.get('user')
  const cat = await one('SELECT * FROM forum_categories WHERE slug = $1', [c.req.param('slug')])
  if (!cat) return c.notFound()
  if (cat.locked && !user.admin) return c.text('This category is read-only.', 403)

  const form = await c.req.parseBody()
  const title = String(form.title || '').trim().slice(0, MAX_TITLE)
  const body = String(form.body || '').trim().slice(0, MAX_BODY)
  if (!title || !body) return c.text('Title and message are required.', 400)

  const thread = await tx(async client => {
    const t = (await client.query(
      `INSERT INTO forum_threads (category_id, author_id, title, slug)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [cat.id, user.id, title, slugify(title)],
    )).rows[0]
    await client.query(
      `INSERT INTO forum_posts (thread_id, author_id, body_md, body_html)
       VALUES ($1, $2, $3, $4)`,
      [t.id, user.id, body, renderMarkdown(body)],
    )
    await client.query('UPDATE forum_threads SET post_count = 0 WHERE id = $1', [t.id])
    return t
  })

  announceThread({ thread, category: cat, author: user, body }).catch(() => {})
  return c.redirect(`${B}/forum/t/${thread.id}/${thread.slug}`)
})

// ── Thread view ────────────────────────────────────────────────────────────
forumRoutes.get('/t/:id/:slug?', async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const t = await one(`
    SELECT t.*, c.slug AS cat_slug, c.name AS cat_name
    FROM forum_threads t JOIN forum_categories c ON c.id = t.category_id
    WHERE t.id = $1 AND t.deleted_at IS NULL`, [id])
  if (!t) return c.notFound()

  const posts = await many(`
    SELECT p.*, u.username, u.global_name, u.avatar
    FROM forum_posts p JOIN users u ON u.id = p.author_id
    WHERE p.thread_id = $1
    ORDER BY p.created_at`, [id])

  const cats = user?.admin
    ? await many('SELECT id, name FROM forum_categories ORDER BY position, id')
    : []

  if (user && posts.length) {
    const lastId = posts[posts.length - 1].id
    await query(`
      INSERT INTO forum_reads (user_id, thread_id, last_read_post_id, read_at)
      VALUES ($1, $2, $3, now())
      ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_post_id = $3, read_at = now()`,
      [user.id, id, lastId])
  }

  const canReply = user && (!t.locked || user.admin)

  return c.html(layout({
    title: t.title, user, active: 'forum',
    body: html`
      <div class="crumbs"><a href="${B}/forum">Forum</a> / <a href="${B}/forum/c/${t.cat_slug}">${t.cat_name}</a></div>
      <div class="spread">
        <h1>${t.pinned ? html`<span class="pill pin">pinned</span> ` : ''}${t.locked ? html`<span class="pill lock">locked</span> ` : ''}${t.title}</h1>
        ${user?.admin ? html`
          <details class="mod-menu">
            <summary class="btn ghost sm">Moderate</summary>
            <div class="card stack" style="margin-top:8px;min-width:230px">
              <form method="post" action="${B}/forum/t/${t.id}/mod" class="btn-row">
                <button class="btn ghost sm" name="action" value="pin">${t.pinned ? 'Unpin' : 'Pin'}</button>
                <button class="btn ghost sm" name="action" value="lock">${t.locked ? 'Unlock' : 'Lock'}</button>
              </form>
              <form method="post" action="${B}/forum/t/${t.id}/mod" class="row" style="gap:6px">
                <input type="hidden" name="action" value="move">
                <select name="category_id" style="flex:1">
                  ${cats.map(cc => html`<option value="${cc.id}" ${cc.id === t.category_id ? 'selected' : ''}>${cc.name}</option>`)}
                </select>
                <button class="btn ghost sm" type="submit">Move</button>
              </form>
              <form method="post" action="${B}/forum/t/${t.id}/mod"
                onsubmit="return confirm('Delete this whole thread?')">
                <button class="btn ghost sm" name="action" value="delete" style="color:var(--danger)">Delete thread</button>
              </form>
            </div>
          </details>` : ''}
      </div>

      <div class="card">
        ${posts.filter(p => !p.deleted_at || user?.admin).map(p => renderPost(p, t, user))}
      </div>

      ${canReply
        ? html`
          <form method="post" action="${B}/forum/t/${t.id}/reply" class="stack" style="margin-top:20px">
            <div class="field"><label>Reply — markdown</label>
              <textarea name="body" maxlength="${MAX_BODY}" required></textarea></div>
            <div class="btn-row"><button class="btn" type="submit">Post reply</button></div>
          </form>`
        : user
          ? html`<p class="muted" style="margin-top:20px">This thread is locked.</p>`
          : html`<p class="muted" style="margin-top:20px"><a href="${B}/auth/login">Sign in</a> to reply.</p>`}`,
  }))
})

function renderPost(p, t, user) {
  const name = p.global_name || p.username
  const canEdit = user && (user.id === p.author_id || user.admin)
  if (p.deleted_at) {
    return html`<div class="post"><div class="avatar"></div>
      <div><div class="who dim">deleted</div><div class="post-body muted"><em>This post was removed.</em></div></div></div>`
  }
  return html`
    <div class="post" id="p${p.id}">
      <img class="avatar" src="${avatarUrl({ id: p.author_id, avatar: p.avatar }, 88)}" alt="">
      <div>
        <div class="spread">
          <div><span class="who">${name}</span>
            <span class="when">· ${fmtDate(p.created_at)}${p.edited_at ? ' · edited' : ''}</span></div>
          ${canEdit ? html`
            <div class="btn-row">
              <a class="dim" href="${B}/forum/t/${t.id}/edit/${p.id}" style="font-size:.8rem">edit</a>
              <form method="post" action="${B}/forum/t/${t.id}/delete/${p.id}" onsubmit="return confirm('Delete this post?')">
                <button class="dim" style="background:none;border:0;cursor:pointer;font:inherit;font-size:.8rem">delete</button>
              </form>
            </div>` : ''}
        </div>
        <div class="post-body">${raw(p.body_html)}</div>
      </div>
    </div>`
}

// ── Reply ──────────────────────────────────────────────────────────────────
forumRoutes.post('/t/:id/reply', requireAuth, async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const t = await one('SELECT * FROM forum_threads t WHERE id = $1 AND deleted_at IS NULL', [id])
  if (!t) return c.notFound()
  if (t.locked && !user.admin) return c.text('Thread is locked.', 403)

  const form = await c.req.parseBody()
  const body = String(form.body || '').trim().slice(0, MAX_BODY)
  if (!body) return c.redirect(`${B}/forum/t/${id}/${t.slug}`)

  await tx(async client => {
    await client.query(
      `INSERT INTO forum_posts (thread_id, author_id, body_md, body_html) VALUES ($1, $2, $3, $4)`,
      [id, user.id, body, renderMarkdown(body)],
    )
    await client.query(
      `UPDATE forum_threads SET last_post_at = now(),
         post_count = (SELECT count(*) - 1 FROM forum_posts WHERE thread_id = $1 AND deleted_at IS NULL)
       WHERE id = $1`, [id])
  })
  return c.redirect(`${B}/forum/t/${id}/${t.slug}`)
})

// ── Edit own post ──────────────────────────────────────────────────────────
forumRoutes.get('/t/:id/edit/:postId', requireAuth, async c => {
  const user = c.get('user')
  const p = await one('SELECT * FROM forum_posts WHERE id = $1 AND thread_id = $2', [c.req.param('postId'), c.req.param('id')])
  if (!p || p.deleted_at) return c.notFound()
  if (user.id !== p.author_id && !user.admin) return c.text('Not your post.', 403)
  return c.html(layout({
    title: 'Edit post', user, active: 'forum',
    body: html`
      <h1>Edit post</h1>
      <form method="post" action="${B}/forum/t/${c.req.param('id')}/edit/${p.id}" class="stack">
        <div class="field"><textarea name="body" maxlength="${MAX_BODY}" required>${p.body_md}</textarea></div>
        <div class="btn-row">
          <button class="btn" type="submit">Save</button>
          <a class="btn ghost" href="${B}/forum/t/${c.req.param('id')}">Cancel</a>
        </div>
      </form>`,
  }))
})

forumRoutes.post('/t/:id/edit/:postId', requireAuth, async c => {
  const user = c.get('user')
  const p = await one('SELECT * FROM forum_posts WHERE id = $1 AND thread_id = $2', [c.req.param('postId'), c.req.param('id')])
  if (!p || p.deleted_at) return c.notFound()
  if (user.id !== p.author_id && !user.admin) return c.text('Not your post.', 403)
  const form = await c.req.parseBody()
  const body = String(form.body || '').trim().slice(0, MAX_BODY)
  if (body) {
    await query('UPDATE forum_posts SET body_md = $1, body_html = $2, edited_at = now() WHERE id = $3',
      [body, renderMarkdown(body), p.id])
  }
  const t = await one('SELECT slug FROM forum_threads WHERE id = $1', [c.req.param('id')])
  return c.redirect(`${B}/forum/t/${c.req.param('id')}/${t?.slug ?? ''}#p${p.id}`)
})

forumRoutes.post('/t/:id/delete/:postId', requireAuth, async c => {
  const user = c.get('user')
  const p = await one('SELECT * FROM forum_posts WHERE id = $1 AND thread_id = $2', [c.req.param('postId'), c.req.param('id')])
  if (!p) return c.notFound()
  const isMod = user.id !== p.author_id && user.admin
  if (user.id !== p.author_id && !user.admin) return c.text('Not your post.', 403)
  await query('UPDATE forum_posts SET deleted_at = now() WHERE id = $1', [p.id])
  await query(`UPDATE forum_threads SET post_count = GREATEST(0,
      (SELECT count(*) - 1 FROM forum_posts WHERE thread_id = $1 AND deleted_at IS NULL)) WHERE id = $1`,
    [c.req.param('id')])
  if (isMod) await logMod(user.id, 'delete_post', 'post', p.id, `thread ${c.req.param('id')}`)
  const t = await one('SELECT slug FROM forum_threads WHERE id = $1', [c.req.param('id')])
  return c.redirect(`${B}/forum/t/${c.req.param('id')}/${t?.slug ?? ''}`)
})

// ── Moderate a thread (admin) ──────────────────────────────────────────────
forumRoutes.post('/t/:id/mod', requireAuth, async c => {
  const user = c.get('user')
  if (!user.admin) return c.text('Forbidden', 403)
  const id = Number(c.req.param('id'))
  const form = await c.req.parseBody()
  const t = await one('SELECT * FROM forum_threads WHERE id = $1', [id])
  if (!t) return c.notFound()

  switch (form.action) {
    case 'pin':
      await query('UPDATE forum_threads SET pinned = NOT pinned WHERE id = $1', [id])
      await logMod(user.id, t.pinned ? 'unpin' : 'pin', 'thread', id, t.title)
      break
    case 'lock':
      await query('UPDATE forum_threads SET locked = NOT locked WHERE id = $1', [id])
      await logMod(user.id, t.locked ? 'unlock' : 'lock', 'thread', id, t.title)
      break
    case 'move': {
      const catId = Number(form.category_id)
      const cat = await one('SELECT name FROM forum_categories WHERE id = $1', [catId])
      if (cat && catId !== t.category_id) {
        await query('UPDATE forum_threads SET category_id = $1 WHERE id = $2', [catId, id])
        await logMod(user.id, 'move_thread', 'thread', id, `${t.title} → ${cat.name}`)
      }
      break
    }
    case 'delete':
      await query('UPDATE forum_threads SET deleted_at = now() WHERE id = $1', [id])
      await logMod(user.id, 'delete_thread', 'thread', id, t.title)
      return c.redirect(`${B}/forum/c/${(await one('SELECT slug FROM forum_categories WHERE id = $1', [t.category_id]))?.slug ?? ''}`)
  }
  const slug = (await one('SELECT slug FROM forum_threads WHERE id = $1', [id]))?.slug ?? ''
  return c.redirect(`${B}/forum/t/${id}/${slug}`)
})

export { excerpt }

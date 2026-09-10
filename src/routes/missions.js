import { Hono } from 'hono'
import { config } from '../config.js'
import { one, many, query } from '../db.js'
import { layout, html, raw, avatarUrl, fmtDate, timeAgo, markdownGuide } from '../lib/html.js'
import { renderMarkdown } from '../lib/markdown.js'
import { requireAuth } from '../auth/session.js'
import { logMod } from '../lib/modlog.js'
import { announceMission, announceMissionResult, editMissionAnnounce } from '../bot/announce.js'
import {
  createMission, updateMission, MISSION_MAX as MAX,
  missionRoster, missionShips, userSignup, userShipIds, signUp, leaveMission, setSignupShips,
} from '../lib/missions.js'
import { createThread } from '../lib/forum.js'

export const missionRoutes = new Hono()
const B = config.basePath

function parseLocal(v) {
  if (!v) return null
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

function specRowHtml(kind, placeholder, item) {
  const count = item ? (item.slots ?? item.count ?? 0) : 1
  const signed = item?.members?.length || 0
  return html`
    <div class="role-row">
      <input type="hidden" name="${kind}_id[]" value="${item?.id ?? 'new'}">
      <input type="text" name="${kind}_name[]" maxlength="${MAX.roleName}" placeholder="${placeholder}" value="${item?.name || ''}">
      <input type="number" name="${kind}_slots[]" value="${count}" min="0" max="99" title="how many; 0 = unspecified">
      ${signed ? html`<span class="dim spec-signed" style="font-size:.74rem">${signed} in</span>` : ''}
      <button type="button" class="btn ghost sm" data-role-remove aria-label="remove">&times;</button>
    </div>`
}

// A datetime-local value from a stored timestamp.
function dtLocal(v) {
  if (!v) return ''
  try { return new Date(v).toISOString().slice(0, 16) } catch { return '' }
}

// The shared new / edit mission form. `m`, `roles`, `ships` pre-fill it.
function missionForm({ action, submitLabel, cancelHref, m = {}, roles = [], ships = [] }) {
  const roleRows = roles.length ? roles.map(r => specRowHtml('role', 'e.g. Fighter escort', r))
    : [0, 1].map(() => specRowHtml('role', 'e.g. Fighter escort'))
  const shipRows = ships.length ? ships.map(s => specRowHtml('ship', 'e.g. Heavy fighter', s))
    : [0, 1].map(() => specRowHtml('ship', 'e.g. Heavy fighter'))
  return html`
    <form method="post" action="${action}" class="stack">
      <div class="field"><label>Title</label>
        <input type="text" name="title" maxlength="${MAX.title}" required value="${m.title || ''}" ${m.title ? '' : 'autofocus'}></div>
      <div class="field">
        <label>Roles / crew needed</label>
        <div id="role-rows" class="stack">${roleRows}</div>
        <div class="md-tools">
          <button type="button" class="btn ghost sm" id="role-add">+ Add role</button>
          <span class="dim" style="font-size:.8rem">People pick one role from the mission page. Count <code>0</code> = unlimited.</span>
        </div>
      </div>
      <div class="field">
        <label>Ships wanted</label>
        <div id="ship-rows" class="stack">${shipRows}</div>
        <div class="md-tools">
          <button type="button" class="btn ghost sm" id="ship-add">+ Add ship</button>
          <span class="dim" style="font-size:.8rem">Crew tick which of these they can bring when they sign up.</span>
        </div>
      </div>
      <div class="row" style="gap:10px">
        <div class="field" style="flex:1;margin:0"><label>Mission type</label>
          <input type="text" name="mission_type" maxlength="${MAX.field}" value="${m.mission_type || ''}" placeholder="Bounty / cargo / salvage"></div>
        <div class="field" style="flex:1;margin:0"><label>Pay</label>
          <input type="text" name="pay" maxlength="${MAX.field}" value="${m.pay || ''}" placeholder="Split evenly after fees"></div>
      </div>
      <div class="row" style="gap:10px">
        <div class="field" style="flex:1;margin:0"><label>Roll-call time (optional)</label>
          <input type="datetime-local" name="roll_call_at" value="${dtLocal(m.roll_call_at)}">
          <span class="dim" style="font-size:.78rem">be in voice, logged in, spawned</span></div>
        <div class="field" style="flex:1;margin:0"><label>Mission time (optional)</label>
          <input type="datetime-local" name="launch_at" value="${dtLocal(m.launch_at)}">
          <span class="dim" style="font-size:.78rem">wheels-up, mission start</span></div>
      </div>
      <div class="row" style="gap:10px">
        <div class="field" style="flex:2;margin:0"><label>Meet-up point (optional)</label>
          <input type="text" name="meetup" maxlength="${MAX.field}" value="${m.meetup || ''}" placeholder="Seraphim Station, hangar 3"></div>
        <div class="field" style="flex:1;margin:0"><label>Voice channel ID (optional)</label>
          <input type="text" name="voice_channel_id" maxlength="32" value="${m.voice_channel_id || ''}" placeholder="#channel link"></div>
      </div>
      <div class="field"><label>Objective / briefing (markdown)</label>
        <textarea name="objective" maxlength="${MAX.objective}" required>${m.objective || ''}</textarea>
        ${markdownGuide()}</div>
      <div class="btn-row">
        <button class="btn" type="submit">${submitLabel}</button>
        <a class="btn ghost" href="${cancelHref}">Cancel</a>
      </div>
    </form>`
}

// Read a role / ship spec list from a parsed edit-or-new form body.
function readSpecs(f, kind, existingIds = []) {
  const arr = k => [].concat(f[`${kind}_${k}[]`] ?? f[`${kind}_${k}`] ?? [])
  const ids = arr('id'), names = arr('name'), counts = arr('slots')
  return names.map((n, i) => {
    const rid = Number.parseInt(ids[i], 10)
    const cnt = Number.parseInt(counts[i], 10)
    return {
      id: Number.isFinite(rid) && existingIds.includes(rid) ? rid : null,
      name: String(n || '').trim(),
      n: Number.isFinite(cnt) ? cnt : 1,
    }
  }).filter(r => r.name)
}

// ── List: open missions ────────────────────────────────────────────────────
missionRoutes.get('/', async c => {
  const user = c.get('user')
  const open = await many(`
    SELECT m.*, u.username, u.global_name, u.avatar,
      (SELECT count(*) FROM mission_signups s WHERE s.mission_id = m.id) AS signup_count,
      (SELECT count(*) FROM mission_roles r WHERE r.mission_id = m.id) AS role_count,
      (SELECT coalesce(sum(r.slots), 0) FROM mission_roles r WHERE r.mission_id = m.id) AS slot_count
    FROM missions m JOIN users u ON u.id = m.creator_id
    WHERE m.status = 'open'
    ORDER BY m.launch_at NULLS LAST, m.created_at DESC`)
  const recent = await many(`
    SELECT m.id, m.title, m.outcome, m.completed_at
    FROM missions m WHERE m.status = 'complete'
    ORDER BY m.completed_at DESC LIMIT 5`)

  return c.html(layout({
    title: 'Missions', user, active: 'missions',
    body: html`
      <div class="spread">
        <h1>Mission board</h1>
        ${user ? html`<a class="btn" href="${B}/missions/new">Post a mission</a>` : ''}
      </div>
      <p class="muted">Open contracts for the guild. Posting one here drops it in the
        Fluxer mission channel — and posting <code>!mission</code> in that channel
        adds it here.</p>

      ${open.length === 0
        ? html`<div class="empty">No open missions.${user ? ' Post the first.' : ''}</div>`
        : html`<div class="stack">${open.map(m => missionCard(m))}</div>`}

      ${recent.length ? html`
        <div class="spread" style="margin-top:30px"><h3>Recently completed</h3>
          <a class="dim" href="${B}/missions/completed">All completed →</a></div>
        <div class="list">
          ${recent.map(m => html`<a class="list-item" href="${B}/missions/${m.id}">
            <div class="spread"><span class="title">${m.title}</span>
              <span class="pill ${m.outcome === 'passed' ? 'going' : 'lock'}">${m.outcome || '—'}</span></div></a>`)}
        </div>` : ''}`,
  }))
})

function missionCard(m) {
  const crew = Number(m.role_count) > 0
    ? `Crew ${m.signup_count}${Number(m.slot_count) > 0 ? `/${m.slot_count}` : ''}`
    : (m.role && `Crew: ${m.role}`)
  const bits = [
    crew,
    m.mission_type,
    m.pay && `Pay: ${m.pay}`,
  ].filter(Boolean)
  return html`
    <a class="card stack" style="text-decoration:none;display:block" href="${B}/missions/${m.id}">
      <div class="spread">
        <div class="title" style="color:var(--text-0);font-weight:650;font-size:1.05rem">${m.title}</div>
        ${m.launch_at ? html`<span class="meta">${fmtDate(m.launch_at)}</span>` : ''}
      </div>
      <div class="muted" style="margin:0">${m.objective.length > 180 ? m.objective.slice(0, 179) + '…' : m.objective}</div>
      <div class="meta">${bits.join(' · ')}${bits.length ? ' · ' : ''}by ${m.global_name || m.username} · ${timeAgo(m.created_at)}</div>
    </a>`
}

function rosterCard(m, roster, user, myRole) {
  const open = m.status === 'open'
  return html`
    <h3 style="margin-top:24px">Crew</h3>
    <div class="card">
      <div class="roster">
        ${roster.map(r => {
          const full = r.slots > 0 && r.members.length >= r.slots
          const iAmHere = myRole === r.id
          return html`
            <div class="roster-row">
              <span class="roster-name">${r.name}</span>
              <span class="roster-count">${r.members.length}${r.slots > 0 ? `/${r.slots}` : ''}</span>
              <span class="roster-members">
                ${r.members.length
                  ? r.members.map(mem => html`<span class="roster-member">
                      <img src="${avatarUrl({ id: mem.user_id, avatar: mem.avatar }, 48)}" alt="" title="${mem.global_name || mem.username}">
                      <span class="who">${mem.global_name || mem.username}</span>
                      ${mem.ships?.length ? html`<span class="ship-tags">${mem.ships.map(s => html`<span class="ship-tag">${s.name}</span>`)}</span>` : ''}
                    </span>`)
                  : html`<span class="dim" style="font-size:.82rem">no one yet</span>`}
              </span>
              ${!open || !user ? ''
                : iAmHere
                  ? html`<form method="post" action="${B}/missions/${m.id}/leave">
                      <button class="btn ghost sm">Leave</button></form>`
                  : full
                    ? html`<button class="btn ghost sm" disabled>Full</button>`
                    : html`<form method="post" action="${B}/missions/${m.id}/signup">
                        <input type="hidden" name="role_id" value="${r.id}">
                        <button class="btn sm">${myRole ? 'Switch here' : 'Sign up'}</button></form>`}
            </div>`
        })}
      </div>
      ${open && user && !myRole ? html`<p class="dim" style="font-size:.82rem;margin:10px 0 0">Pick the role you'll fill.</p>` : ''}
      ${open && !user ? html`<p class="dim" style="font-size:.82rem;margin:10px 0 0"><a href="${B}/auth/login">Sign in</a> to claim a role.</p>` : ''}
    </div>`
}

function shipsCard(m, ships, roster, user, myRole, myShipIds) {
  const open = m.status === 'open'
  // count how many people offered each ship
  const offered = new Map()
  for (const r of roster) for (const mem of r.members) for (const s of mem.ships || []) offered.set(s.id, (offered.get(s.id) || 0) + 1)
  const mine = new Set(myShipIds)
  return html`
    <h3 style="margin-top:24px">Ships</h3>
    <div class="card stack">
      <div class="roster">
        ${ships.map(s => html`
          <div class="roster-row">
            <span class="roster-name">${s.name}${s.count > 0 ? html` <span class="dim">×${s.count}</span>` : ''}</span>
            <span class="roster-count">${offered.get(s.id) || 0} offered</span>
          </div>`)}
      </div>
      ${open && user && myRole ? html`
        <form method="post" action="${B}/missions/${m.id}/ships" class="stack ship-mine">
          <div class="dim" style="font-size:.82rem">Which of these can you bring?</div>
          <div class="ship-picker">
            ${ships.map(s => html`
              <label class="ship-check">
                <input type="checkbox" name="ship_id[]" value="${s.id}" ${mine.has(s.id) ? 'checked' : ''}>
                ${s.name}</label>`)}
          </div>
          <div><button class="btn sm">Save my ships</button></div>
        </form>`
        : open && user ? html`<p class="dim ship-mine" style="font-size:.82rem">Claim a crew role above, then pick which ships you can bring.</p>` : ''}
    </div>`
}

// ── Completed ──────────────────────────────────────────────────────────────
missionRoutes.get('/completed', async c => {
  const user = c.get('user')
  const rows = await many(`
    SELECT m.*, u.username AS creator_name, u.global_name AS creator_global,
      a.username AS aar_name, a.global_name AS aar_global
    FROM missions m
    JOIN users u ON u.id = m.creator_id
    LEFT JOIN users a ON a.id = m.aar_by
    WHERE m.status = 'complete'
    ORDER BY m.completed_at DESC LIMIT 100`)

  return c.html(layout({
    title: 'Completed missions', user, active: 'missions',
    body: html`
      <div class="crumbs"><a href="${B}/missions">Missions</a> / completed</div>
      <h1>Completed missions</h1>
      ${rows.length === 0
        ? html`<div class="empty">Nothing completed yet.</div>`
        : html`<div class="stack">${rows.map(m => html`
          <div class="card stack">
            <div class="spread">
              <a class="title" style="color:var(--text-0);font-weight:650" href="${B}/missions/${m.id}">${m.title}</a>
              <span class="pill ${m.outcome === 'passed' ? 'going' : 'lock'}">${(m.outcome || '—').toUpperCase()}</span>
            </div>
            <div class="meta">by ${m.creator_global || m.creator_name} · completed ${fmtDate(m.completed_at)}</div>
            ${m.aar_reason ? html`<div><strong>Why:</strong> ${m.aar_reason}</div>` : ''}
            ${m.aar_corrective ? html`<div><strong>Corrective actions:</strong> ${m.aar_corrective}</div>` : ''}
            ${m.aar_paid != null ? html`<div class="dim">Paid out as described: ${m.aar_paid ? 'yes' : 'no'}</div>` : ''}
          </div>`)}</div>`}`,
  }))
})

// ── New ────────────────────────────────────────────────────────────────────
missionRoutes.get('/new', requireAuth, c => {
  const user = c.get('user')
  return c.html(layout({
    title: 'Post a mission', user, active: 'missions',
    body: html`
      <div class="crumbs"><a href="${B}/missions">Missions</a> / new</div>
      <h1>Post a mission</h1>
      <p class="muted">Prefer chat? Post <code>!mission</code> in the Fluxer mission
        channel (<code>!mission help</code> for the format) and it shows up here.</p>
      ${missionForm({ action: `${B}/missions/new`, submitLabel: 'Post mission', cancelHref: `${B}/missions` })}`,
  }))
})

missionRoutes.post('/new', requireAuth, async c => {
  const user = c.get('user')
  const f = await c.req.parseBody({ all: true })
  const g = k => String((Array.isArray(f[k]) ? f[k][0] : f[k]) || '').trim()
  const title = g('title').slice(0, MAX.title)
  const objective = g('objective').slice(0, MAX.objective)
  if (!title || !objective) return c.text('Title and objective are required.', 400)

  const m = await createMission({
    creatorId: user.id,
    source: 'portal',
    fields: {
      title, objective,
      roles: readSpecs(f, 'role'), ships: readSpecs(f, 'ship'),
      mission_type: g('mission_type'), pay: g('pay'),
      launch_at: parseLocal(g('launch_at')),
      roll_call_at: parseLocal(g('roll_call_at')),
      meetup: g('meetup'),
      voice_channel_id: g('voice_channel_id'),
    },
  })

  try {
    const mid = await announceMission({ mission: m, creator: user })
    if (mid) await query('UPDATE missions SET fluxer_message_id = $1 WHERE id = $2', [mid, m.id])
  } catch (e) { console.error('mission announce:', e.message) }

  return c.redirect(`${B}/missions/${m.id}`)
})

// ── Edit (creator / admin, while open) ─────────────────────────────────────
async function loadEditable(c) {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const m = await one('SELECT * FROM missions WHERE id = $1', [id])
  if (!m) return { err: c.notFound() }
  if (m.creator_id !== user.id && !user.admin) return { err: c.text('Only the mission author can edit it.', 403) }
  if (m.status !== 'open') return { err: c.redirect(`${B}/missions/${id}`) }
  return { user, id, m }
}

missionRoutes.get('/:id/edit', requireAuth, async c => {
  const { err, user, id, m } = await loadEditable(c)
  if (err) return err
  const roles = await missionRoster(id)
  const ships = await missionShips(id)
  return c.html(layout({
    title: `Edit ${m.title}`, user, active: 'missions',
    body: html`
      <div class="crumbs"><a href="${B}/missions/${id}">${m.title}</a> / edit</div>
      <h1>Edit mission</h1>
      <p class="muted">Removing a role or ship also removes anyone signed up to it.</p>
      ${missionForm({ action: `${B}/missions/${id}/edit`, submitLabel: 'Save changes', cancelHref: `${B}/missions/${id}`, m, roles, ships })}`,
  }))
})

missionRoutes.post('/:id/edit', requireAuth, async c => {
  const { err, id, m } = await loadEditable(c)
  if (err) return err
  const f = await c.req.parseBody({ all: true })
  const g = k => String((Array.isArray(f[k]) ? f[k][0] : f[k]) || '').trim()
  const title = g('title').slice(0, MAX.title)
  const objective = g('objective').slice(0, MAX.objective)
  if (!title || !objective) return c.text('Title and objective are required.', 400)

  const roleIds = (await many('SELECT id FROM mission_roles WHERE mission_id = $1', [id])).map(r => r.id)
  const shipIds = (await many('SELECT id FROM mission_ships WHERE mission_id = $1', [id])).map(r => r.id)

  const updated = await updateMission({
    missionId: id,
    fields: {
      title, objective,
      roles: readSpecs(f, 'role', roleIds), ships: readSpecs(f, 'ship', shipIds),
      mission_type: g('mission_type'), pay: g('pay'),
      launch_at: parseLocal(g('launch_at')),
      roll_call_at: parseLocal(g('roll_call_at')),
      meetup: g('meetup'),
      voice_channel_id: g('voice_channel_id'),
    },
  })
  updated.fluxer_message_id = m.fluxer_message_id
  editMissionAnnounce({ mission: updated }).catch(() => {})
  return c.redirect(`${B}/missions/${id}`)
})

// ── Detail ─────────────────────────────────────────────────────────────────
missionRoutes.get('/:id', async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const m = await one(`
    SELECT m.*, u.username, u.global_name, u.avatar
    FROM missions m JOIN users u ON u.id = m.creator_id WHERE m.id = $1`, [id])
  if (!m) return c.notFound()
  const mine = user && user.id === m.creator_id
  const roster = await missionRoster(id)
  const ships = await missionShips(id)
  const myRole = user ? (await userSignup(id, user.id))?.role_id ?? null : null
  const myShipIds = user && myRole ? await userShipIds(id, user.id) : []

  return c.html(layout({
    title: m.title, user, active: 'missions',
    flash: c.req.query('full') ? { error: true, text: 'That role filled up before you claimed it — pick another.' } : undefined,
    body: html`
      <div class="crumbs"><a href="${B}/missions">Missions</a> / ${m.title}</div>
      <div class="spread">
        <h1>${m.title}
          ${m.status === 'complete' ? html`<span class="pill ${m.outcome === 'passed' ? 'going' : 'lock'}">${(m.outcome || 'complete').toUpperCase()}</span>` : ''}
          ${m.status === 'cancelled' ? html`<span class="pill lock">cancelled</span>` : ''}</h1>
        ${user?.admin ? html`
          <form method="post" action="${B}/missions/${m.id}/delete" onsubmit="return confirm('Delete this mission?')">
            <button class="btn ghost sm" style="color:var(--danger)">Delete</button></form>` : ''}
      </div>

      <div class="card stack">
        ${roster.length === 0 && m.role ? html`<div><strong>Crew needed</strong><br>${m.role}</div>` : ''}
        ${m.crew_size ? html`<div><strong>Crew size</strong><br>${m.crew_size}</div>` : ''}
        ${m.mission_type ? html`<div><strong>Type</strong><br>${m.mission_type}</div>` : ''}
        ${m.pay ? html`<div><strong>Pay</strong><br>${m.pay}</div>` : ''}
        ${m.roll_call_at ? html`<div><strong>Roll call</strong><br>${fmtDate(m.roll_call_at)}</div>` : ''}
        ${m.launch_at ? html`<div><strong>Mission time</strong><br>${fmtDate(m.launch_at)}</div>` : ''}
        ${m.meetup ? html`<div><strong>Meet-up point</strong><br>${m.meetup}</div>` : ''}
        ${m.voice_channel_id ? html`<div><strong>Voice</strong><br><code>#${m.voice_channel_id}</code></div>` : ''}
        <div class="dim">Posted by ${m.global_name || m.username} · ${timeAgo(m.created_at)}</div>
      </div>

      ${roster.length ? rosterCard(m, roster, user, myRole) : ''}
      ${ships.length ? shipsCard(m, ships, roster, user, myRole, myShipIds) : ''}

      <div class="card post-body">${raw(renderMarkdown(m.objective))}</div>

      ${m.status === 'open' && (mine || user?.admin) ? html`
        <div class="btn-row" style="margin-top:18px">
          <a class="btn" href="${B}/missions/${m.id}/edit">Edit</a>
          <a class="btn ghost" href="${B}/missions/${m.id}/complete">Mark complete + AAR</a>
          <form method="post" action="${B}/missions/${m.id}/cancel" onsubmit="return confirm('Cancel this mission?')">
            <button class="btn ghost">Cancel mission</button></form>
        </div>` : ''}

      ${m.status === 'complete' ? html`
        <h3 style="margin-top:24px">After-action report</h3>
        <div class="card stack">
          <div><strong>Outcome:</strong> ${(m.outcome || '—').toUpperCase()}</div>
          ${m.aar_reason ? html`<div><strong>Why it ${m.outcome === 'passed' ? 'passed' : 'failed'}:</strong><br>${m.aar_reason}</div>` : ''}
          ${m.aar_corrective ? html`<div><strong>Future corrective actions:</strong><br>${m.aar_corrective}</div>` : ''}
          ${m.aar_paid != null ? html`<div><strong>Paid out the amount described:</strong> ${m.aar_paid ? 'Yes' : 'No'}</div>` : ''}
          <div class="dim">Filed ${m.completed_at ? fmtDate(m.completed_at) : ''}</div>
          ${m.aar_thread_id ? html`<div><a class="btn ghost sm" href="${B}/forum/t/${m.aar_thread_id}">Discuss this AAR →</a></div>` : ''}
        </div>` : ''}`,
  }))
})

// ── Crew sign-up ───────────────────────────────────────────────────────────
missionRoutes.post('/:id/signup', requireAuth, async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const m = await one('SELECT status FROM missions WHERE id = $1', [id])
  if (!m) return c.notFound()
  if (m.status !== 'open') return c.redirect(`${B}/missions/${id}`)
  const f = await c.req.parseBody()
  const res = await signUp(id, Number(f.role_id), user.id)
  // On a lost race for the last slot just bounce back — the re-rendered page
  // shows the role as full.
  return c.redirect(`${B}/missions/${id}${res.ok ? '' : '?full=1'}`)
})

missionRoutes.post('/:id/leave', requireAuth, async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  await leaveMission(id, user.id)
  return c.redirect(`${B}/missions/${id}`)
})

missionRoutes.post('/:id/ships', requireAuth, async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const m = await one('SELECT status FROM missions WHERE id = $1', [id])
  if (!m) return c.notFound()
  if (m.status !== 'open') return c.redirect(`${B}/missions/${id}`)
  const f = await c.req.parseBody({ all: true })
  const ids = [].concat(f['ship_id[]'] ?? f['ship_id'] ?? [])
  await setSignupShips(id, user.id, ids)
  return c.redirect(`${B}/missions/${id}`)
})

// ── Cancel (creator) ───────────────────────────────────────────────────────
missionRoutes.post('/:id/cancel', requireAuth, async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const m = await one('SELECT * FROM missions WHERE id = $1', [id])
  if (!m) return c.notFound()
  if (m.creator_id !== user.id && !user.admin) return c.text('Not your mission.', 403)
  if (m.status !== 'open') return c.redirect(`${B}/missions/${id}`)
  await query("UPDATE missions SET status = 'cancelled' WHERE id = $1", [id])
  return c.redirect(`${B}/missions/${id}`)
})

// ── Complete + AAR (creator) ───────────────────────────────────────────────
missionRoutes.get('/:id/complete', requireAuth, async c => {
  const user = c.get('user')
  const m = await one('SELECT * FROM missions WHERE id = $1', [c.req.param('id')])
  if (!m) return c.notFound()
  if (m.creator_id !== user.id && !user.admin) return c.text('Only the mission author can close it.', 403)
  if (m.status !== 'open') return c.redirect(`${B}/missions/${m.id}`)

  return c.html(layout({
    title: 'Complete mission', user, active: 'missions',
    body: html`
      <div class="crumbs"><a href="${B}/missions/${m.id}">${m.title}</a> / complete</div>
      <h1>Mission complete — after-action report</h1>
      <form method="post" action="${B}/missions/${m.id}/complete" class="stack">
        <div class="field"><label>Outcome</label>
          <div class="btn-row">
            <label style="text-transform:none;letter-spacing:0;color:var(--text-1)">
              <input type="radio" name="outcome" value="passed" required style="width:auto;margin-right:6px"> Passed</label>
            <label style="text-transform:none;letter-spacing:0;color:var(--text-1)">
              <input type="radio" name="outcome" value="failed" style="width:auto;margin-right:6px"> Failed</label>
          </div>
        </div>
        <div id="aar-fields" hidden class="stack">
          <div class="field" style="margin:0"><label>Why did it pass / fail?</label>
            <textarea name="aar_reason" maxlength="${MAX.aar}"></textarea></div>
          <div class="field" style="margin:0"><label>Future corrective actions</label>
            <textarea name="aar_corrective" maxlength="${MAX.aar}"></textarea></div>
          <div class="field" style="margin:0">
            <label style="text-transform:none;letter-spacing:0;color:var(--text-1)">
              <input type="checkbox" name="aar_paid" value="1" style="width:auto;margin-right:6px">
              Paid out the amount described in the mission</label>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn" type="submit">File report + close mission</button>
          <a class="btn ghost" href="${B}/missions/${m.id}">Cancel</a>
        </div>
      </form>`,
  }))
})

missionRoutes.post('/:id/complete', requireAuth, async c => {
  const user = c.get('user')
  const id = Number(c.req.param('id'))
  const m = await one('SELECT * FROM missions WHERE id = $1', [id])
  if (!m) return c.notFound()
  if (m.creator_id !== user.id && !user.admin) return c.text('Only the mission author can close it.', 403)
  if (m.status !== 'open') return c.redirect(`${B}/missions/${id}`)

  const f = await c.req.parseBody()
  const outcome = f.outcome === 'passed' ? 'passed' : f.outcome === 'failed' ? 'failed' : null
  if (!outcome) return c.text('Pick an outcome.', 400)

  const updated = await one(`
    UPDATE missions SET status = 'complete', outcome = $2, completed_at = now(),
      aar_reason = $3, aar_corrective = $4, aar_paid = $5, aar_by = $6
    WHERE id = $1 RETURNING *`,
    [id, outcome,
     String(f.aar_reason || '').trim().slice(0, MAX.aar),
     String(f.aar_corrective || '').trim().slice(0, MAX.aar),
     f.aar_paid === '1', user.id])

  // Spin up a discussion thread in Operations for the after-action report.
  try {
    const thread = await createThread({
      authorId: user.id,
      categorySlug: 'operations',
      title: `AAR: #${updated.id} ${updated.title}`,
      body: aarThreadBody(updated),
    })
    if (thread) await query('UPDATE missions SET aar_thread_id = $1 WHERE id = $2', [thread.id, updated.id])
  } catch (e) { console.error('aar thread:', e.message) }

  announceMissionResult({ mission: updated }).catch(() => {})
  return c.redirect(`${B}/missions/${id}`)
})

function aarThreadBody(m) {
  const url = `${config.baseUrl}/missions/${m.id}`
  const passed = m.outcome === 'passed'
  return [
    `**Mission #${m.id} — ${m.title}** closed as **${passed ? 'PASSED' : 'FAILED'}**.`,
    '',
    m.aar_reason ? `**Why it ${passed ? 'passed' : 'failed'}:**\n${m.aar_reason}` : null,
    m.aar_corrective ? `**Future corrective actions:**\n${m.aar_corrective}` : null,
    m.aar_paid != null ? `**Paid out the amount described:** ${m.aar_paid ? 'Yes' : 'No'}` : null,
    '',
    `Full mission & AAR: ${url}`,
    '',
    'Discuss below — lessons learned, follow-ups, anything for next time.',
  ].filter(v => v !== null).join('\n')
}

// ── Delete (admin) ─────────────────────────────────────────────────────────
missionRoutes.post('/:id/delete', requireAuth, async c => {
  const user = c.get('user')
  if (!user.admin) return c.text('Forbidden', 403)
  const id = Number(c.req.param('id'))
  const m = await one('SELECT title FROM missions WHERE id = $1', [id])
  await query('DELETE FROM missions WHERE id = $1', [id])
  await logMod(user.id, 'mission_delete', 'mission', id, m?.title || '')
  return c.redirect(`${B}/missions`)
})

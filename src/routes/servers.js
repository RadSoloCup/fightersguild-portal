import { Hono } from 'hono'
import { config } from '../config.js'
import { many } from '../db.js'
import { layout, html, timeAgo } from '../lib/html.js'

export const serverRoutes = new Hono()
const B = config.basePath

serverRoutes.get('/', async c => {
  const user = c.get('user')
  const servers = await many('SELECT * FROM game_servers ORDER BY position, id')

  return c.html(layout({
    title: 'Servers', user, active: 'servers',
    body: html`
      <div class="spread">
        <h1>Game servers</h1>
        ${user?.admin ? html`<a class="btn ghost" href="${B}/admin/servers">Manage</a>` : ''}
      </div>
      ${servers.length === 0
        ? html`<div class="empty">No servers listed yet.${user?.admin ? ' Add one from Manage.' : ''}</div>`
        : html`<div class="stack">${servers.map(s => serverCard(s))}</div>`}`,
  }))
})

export function serverCard(s) {
  const addr = s.port ? `${s.host}:${s.port}` : s.host
  const dot = s.status === 'online' ? 'var(--success)' : s.status === 'offline' ? 'var(--danger)' : 'var(--text-3)'
  const players = s.status === 'online' && s.players_online != null
    ? `${s.players_online}${s.players_max != null ? ` / ${s.players_max}` : ''} online`
    : null
  return html`
    <div class="card stack">
      <div class="spread">
        <div>
          <div class="title" style="color:var(--text-0);font-weight:650;font-size:1.05rem">
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${dot};margin-right:8px;vertical-align:1px"></span>
            ${s.name}
          </div>
          <div class="meta">${s.game ? `${s.game} · ` : ''}${s.status}${players ? ` · ${players}` : ''}${s.checked_at ? ` · checked ${timeAgo(s.checked_at)}` : ''}</div>
        </div>
      </div>
      <div class="row" style="gap:8px">
        <code style="background:var(--bg-0);border:1px solid var(--border);border-radius:6px;padding:4px 9px">${addr}</code>
      </div>
      ${s.description ? html`<div class="muted" style="margin:0">${s.description}</div>` : ''}
      ${s.connect_hint ? html`<div class="dim" style="font-size:.85rem">${s.connect_hint}</div>` : ''}
      ${s.status_detail ? html`<div class="dim" style="font-size:.8rem">${s.status_detail}</div>` : ''}
    </div>`
}

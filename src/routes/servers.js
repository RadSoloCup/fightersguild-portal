import { Hono } from 'hono'
import { config } from '../config.js'
import { many } from '../db.js'
import { layout, html, raw, timeAgo } from '../lib/html.js'
import { heroLayerStyle } from '../lib/gameart.js'
import { getStatus } from '../lib/status.js'

export const serverRoutes = new Hono()
const B = config.basePath

serverRoutes.get('/', async c => {
  const user = c.get('user')
  const servers = await many('SELECT * FROM game_servers ORDER BY position, id')
  const status = getStatus()

  return c.html(layout({
    title: 'Servers', user, active: 'servers',
    body: html`
      <div class="spread">
        <h1>Game servers</h1>
        ${user?.admin ? html`<a class="btn ghost" href="${B}/admin/servers">Manage</a>` : ''}
      </div>
      ${servers.length === 0
        ? html`<div class="empty">No servers listed yet.${user?.admin ? ' Add one from Manage.' : ''}</div>`
        : html`<div class="stack">${servers.map(s => serverCard(s))}</div>`}

      ${statusBoard(status)}`,
  }))
})

export function serverCard(s) {
  const addr = s.port ? `${s.host}:${s.port}` : s.host
  const dot = s.status === 'online' ? 'var(--success)' : s.status === 'offline' ? 'var(--danger)' : 'var(--text-3)'
  const players = s.status === 'online' && s.players_online != null
    ? `${s.players_online}${s.players_max != null ? ` / ${s.players_max}` : ''} online`
    : null
  return html`
    <div class="card stack server-card">
      <div class="server-hero" style="${raw(heroLayerStyle(s))}" aria-hidden="true"></div>
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
        <code class="server-addr">${addr}</code>
        <button class="btn ghost sm" type="button" data-copy="${addr}">Copy address</button>
        ${s.connect_url ? html`<a class="btn sm" href="${s.connect_url}">Join</a>` : ''}
      </div>
      ${s.description ? html`<div class="muted" style="margin:0">${s.description}</div>` : ''}
      ${s.connect_hint ? html`<div class="dim" style="font-size:.85rem">${s.connect_hint}</div>` : ''}
      ${s.status_detail ? html`<div class="dim" style="font-size:.8rem">${s.status_detail}</div>` : ''}
    </div>`
}

function statusRow({ label, status, detail }) {
  const map = {
    up: ['var(--success)', 'up'],
    down: ['var(--danger)', 'down'],
    unknown: ['var(--text-3)', 'unknown'],
  }
  const [colour, word] = map[status] || map.unknown
  return html`
    <div class="status-row">
      <span class="status-dot" style="background:${colour}"></span>
      <span class="status-label">${label}</span>
      <span class="status-word" style="color:${colour}">${word}${detail ? html` <span class="dim">· ${detail}</span>` : ''}</span>
    </div>`
}

function statusBoard(status) {
  const { services = [], bots = [], checkedAt } = status || {}
  if (!services.length && !bots.length) return ''
  return html`
    <h2 style="margin-top:34px">Service status</h2>
    <div class="card">
      ${services.map(statusRow)}
      ${bots.length ? html`
        <div class="status-sep">Bots</div>
        ${bots.map(statusRow)}` : ''}
    </div>
    ${checkedAt ? html`<p class="dim" style="font-size:.78rem;margin-top:6px">Checked ${timeAgo(checkedAt)} · refreshes every minute</p>` : ''}`
}

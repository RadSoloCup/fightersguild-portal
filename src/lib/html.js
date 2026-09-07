import { html, raw } from 'hono/html'
import { config } from '../config.js'

const B = config.basePath

// Match how the Fluxer client resolves avatars:
//  - custom:  <media>/avatars/<id>/<hash>.webp?size=N   (media-proxy, /media/*)
//  - default: <cdn>/avatars/<index>.png?v=1  where index = id % 6  (static-proxy)
const DEFAULT_AVATAR_COUNT = 6n

export function avatarUrl(u, size = 64) {
  const id = u?.id || u?.uid || u?.user_id || u?.author_id || u?.creator_id
  if (!id) return `${B}/static/default-avatar.svg`
  const hash = u?.avatar
  if (!hash) {
    let idx = 0
    try { idx = Number(BigInt(String(id)) % DEFAULT_AVATAR_COUNT) } catch {}
    return `${config.fluxerPublic}/avatars/${idx}.png?v=1`
  }
  const animated = hash.startsWith('a_')
  const bare = animated ? hash.slice(2) : hash
  const q = animated ? `size=${size}&animated=true` : `size=${size}`
  return `${config.fluxerPublic}/media/avatars/${id}/${bare}.webp?${q}`
}

export function fmtDate(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return dt.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtDay(d) {
  const dt = d instanceof Date ? d : new Date(d)
  return { d: dt.getDate(), m: dt.toLocaleString('en-GB', { month: 'short' }) }
}

export function timeAgo(d) {
  const dt = d instanceof Date ? d : new Date(d)
  const s = Math.floor((Date.now() - dt.getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const day = Math.floor(h / 24); if (day < 30) return `${day}d ago`
  return fmtDate(dt)
}

export function layout({ title, user, active = '', flash, body, bare = false }) {
  const nav = [
    ['', 'Home', B || '/'],
    ['forum', 'Forum', `${B}/forum`],
    ['missions', 'Missions', `${B}/missions`],
    ['events', 'Events', `${B}/events`],
    ['servers', 'Servers', `${B}/servers`],
  ]
  if (user?.admin) nav.push(['admin', 'Admin', `${B}/admin`])
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title ? `${title} · ` : ''}Fighters Guild</title>
<link rel="stylesheet" href="${B}/static/portal.css">
<link rel="icon" href="${B}/static/favicon.svg">
</head>
<body>
<header class="top"><div class="top-inner">
  <a class="brand" href="${bare ? config.fluxerPublic : B}"><span class="dot"></span> Fighters Guild</a>
  ${bare ? '' : html`<nav class="nav">
    ${nav.map(([key, label, href]) => html`<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`)}
  </nav>`}
  ${bare
    ? ''
    : user
      ? html`<span class="me"><img src="${avatarUrl(user, 48)}" alt=""><span>${user.name}</span>
          <a class="dim" href="${B}/auth/logout" title="Sign out">&#x23FB;</a></span>`
      : html`<a class="btn sm" href="${B}/auth/login">Sign in</a>`}
</div></header>
<main class="wrap">
  ${flash ? html`<div class="notice ${flash.error ? 'error' : ''}">${flash.text}</div>` : ''}
  ${body}
</main>
<footer class="foot">Fighters Guild · Operations Center ·
  <a href="${config.fluxerPublic}">back to chat</a> ·
  <a href="${config.sourceUrl}" rel="noopener">source (AGPL-3.0)</a></footer>
<script src="${B}/static/portal.js" defer></script>
</body>
</html>`
}

// Landing page for anyone not signed in — reveals nothing about the guild.
export function gatePage() {
  return layout({
    title: 'Sign in', user: null, bare: true,
    body: html`
      <div class="stack" style="max-width:460px;margin:8vh auto 0;text-align:center">
        <h1 style="font-size:1.9rem">Operations Center</h1>
        <p class="muted">This is a private space for <strong>Fighters Guild</strong> members.
          Sign in with the account you use on the <strong>Fighters Guild chat server</strong>
          (our self-hosted Fluxer) to continue.</p>
        <p><a class="btn" href="${B}/auth/login" style="padding:11px 22px">Sign in with Fighters Guild</a></p>
        <p class="dim" style="font-size:.85rem">You'll be sent to <code>${config.fluxerPublic.replace(/^https?:\/\//, '')}</code> to authorise.</p>
      </div>`,
  })
}

// Collapsible "how to format" panel for markdown text areas.
export function markdownGuide() {
  const rows = [
    ['**bold**  ·  *italic*  ·  ~~strike~~', 'bold · italic · strike'],
    ['# Heading  ·  ## Subheading', 'headings'],
    ['- bullet\\n- list', 'bullet list'],
    ['1. step\\n2. step', 'numbered list'],
    ['> quoted text', 'blockquote'],
    ['`inline code`', 'inline code'],
    ['```\\ncode block\\n```', 'code block'],
    ['[link text](https://…)', 'link'],
    ['![alt](image-url)  — or just paste / drop an image', 'image'],
    ['| a | b |\\n|---|---|\\n| 1 | 2 |', 'table'],
  ]
  return html`
    <details class="md-guide">
      <summary>Formatting help (markdown)</summary>
      <table>
        ${rows.map(([code, what]) => html`<tr>
          <td><code>${code.replace(/\\n/g, '↵ ')}</code></td>
          <td class="dim">${what}</td></tr>`)}
      </table>
      <p class="dim">Links open in a new tab. Raw HTML is stripped.</p>
    </details>`
}

export { html, raw }

import { Hono } from 'hono'
import { config } from '../config.js'
import { layout, html } from '../lib/html.js'
import { upsertUser, removeUserAccess } from '../lib/users.js'
import { decryptToken } from '../lib/crypto.js'
import { one } from '../db.js'
import {
  authorizeUrl, pkcePair, randomState,
  exchangeCode, userinfo, isGuildMember, revoke,
} from '../auth/oauth.js'
import { issueSession, clearSession, setFlow, takeFlow } from '../auth/session.js'

export const authRoutes = new Hono()
const B = config.basePath

function safeNext(n) {
  if (typeof n !== 'string' || !n.startsWith(B) || n.startsWith(`${B}/auth`)) return B
  return n
}

authRoutes.get('/login', async c => {
  const next = safeNext(c.req.query('next'))
  const state = randomState()
  const { verifier, challenge } = pkcePair()
  await setFlow(c, { state, verifier, next })
  return c.redirect(authorizeUrl({ state, challenge }))
})

authRoutes.get('/callback', async c => {
  const err = c.req.query('error')
  const code = c.req.query('code')
  const state = c.req.query('state')
  const flow = await takeFlow(c)

  if (err) return c.html(errorPage(c, `Fluxer returned "${err}". Try signing in again.`), 400)
  if (!flow || !code || !state || state !== flow.state) {
    return c.html(errorPage(c, 'That sign-in link expired or was tampered with. Start again.'), 400)
  }

  let tokenSet, info
  try {
    tokenSet = await exchangeCode({ code, verifier: flow.verifier })
    info = await userinfo(tokenSet.access_token)
  } catch (e) {
    console.error('oauth callback:', e.message)
    return c.html(errorPage(c, 'Could not complete sign-in with Fluxer.'), 502)
  }

  let member = false
  try { member = await isGuildMember(tokenSet.access_token) } catch (e) { console.error('guild check:', e.message) }
  if (!member) {
    try { await revoke(tokenSet.refresh_token) } catch {}
    return c.html(notMemberPage(c), 403)
  }

  const user = await upsertUser(info, tokenSet)
  await issueSession(c, user)
  return c.redirect(safeNext(flow.next))
})

authRoutes.get('/logout', async c => {
  const u = c.get('user')
  if (u) {
    const row = await one('SELECT refresh_token FROM oauth_tokens WHERE user_id = $1', [u.id])
    if (row) { await revoke(decryptToken(row.refresh_token)); await removeUserAccess(u.id) }
  }
  clearSession(c)
  return c.redirect(B)
})

function errorPage(c, msg) {
  return layout({
    title: 'Sign-in problem', user: c.get('user'),
    body: html`<div class="stack"><h1>Sign-in problem</h1>
      <div class="notice error">${msg}</div>
      <p><a class="btn" href="${B}/auth/login">Try again</a></p></div>`,
  })
}

function notMemberPage(c) {
  return layout({
    title: 'Members only', user: null,
    body: html`<div class="stack"><h1>Members only</h1>
      <p class="muted">The Portal is for members of the <strong>Fighters Guild</strong> server.
      Your Fluxer account isn't in that server yet.</p>
      <p><a class="btn ghost" href="${config.fluxerPublic}">Open the chat server</a></p></div>`,
  })
}

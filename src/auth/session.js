import { sign as jwtSign, verify as jwtVerify } from 'hono/jwt'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { config } from '../config.js'
import { one, query } from '../db.js'

const ALG = 'HS256'
const sign = payload => jwtSign(payload, config.session.secret, ALG)
const verify = token => jwtVerify(token, config.session.secret, ALG)

const COOKIE = config.session.cookieName
const FLOW = config.session.flowCookieName

const baseCookie = {
  path: config.basePath || '/',
  httpOnly: true,
  secure: config.publicOrigin.startsWith('https'),
  sameSite: 'Lax',
}

// ── Main session ────────────────────────────────────────────────────────────
export async function issueSession(c, user) {
  const now = Math.floor(Date.now() / 1000)
  const token = await sign({
    uid: user.id,
    name: user.global_name || user.username,
    avatar: user.avatar || null,
    admin: !!user.is_admin,
    iat: now,
    exp: now + config.session.ttlSeconds,
  })
  setCookie(c, COOKIE, token, { ...baseCookie, maxAge: config.session.ttlSeconds })
}

export function clearSession(c) {
  deleteCookie(c, COOKIE, { path: baseCookie.path })
}

// Hono middleware: populate c.get('user') from a valid session cookie, backed
// by the DB row so admin changes and guild-membership revocation take effect
// without waiting for the 7-day JWT to expire.
export async function loadUser(c, next) {
  const raw = getCookie(c, COOKIE)
  if (raw) {
    try {
      const p = await verify(raw)
      const row = await one(
        'SELECT id, username, global_name, avatar, is_admin, revoked_at FROM users WHERE id = $1',
        [p.uid],
      )
      if (row && !row.revoked_at) {
        c.set('user', {
          id: row.id,
          name: row.global_name || row.username,
          avatar: row.avatar,
          admin: row.is_admin,
        })
        query('UPDATE users SET last_seen = now() WHERE id = $1', [row.id]).catch(() => {})
      } else {
        clearSession(c)
      }
    } catch {
      clearSession(c)
    }
  }
  await next()
}

export function requireAuth(c, next) {
  if (!c.get('user')) {
    const returnTo = c.req.path + (c.req.url.includes('?') ? `?${c.req.url.split('?')[1]}` : '')
    return c.redirect(`${config.basePath}/auth/login?next=${encodeURIComponent(returnTo)}`)
  }
  return next()
}

export function requireAdmin(c, next) {
  const u = c.get('user')
  if (!u) return c.redirect(`${config.basePath}/auth/login`)
  if (!u.admin) return c.text('Forbidden', 403)
  return next()
}

// ── Short-lived flow cookie (state + PKCE verifier during the redirect) ─────
export async function setFlow(c, data) {
  const now = Math.floor(Date.now() / 1000)
  const token = await sign({ ...data, iat: now, exp: now + 600 })
  setCookie(c, FLOW, token, { ...baseCookie, maxAge: 600 })
}

export async function takeFlow(c) {
  const raw = getCookie(c, FLOW)
  deleteCookie(c, FLOW, { path: baseCookie.path })
  if (!raw) return null
  try {
    return await verify(raw)
  } catch {
    return null
  }
}

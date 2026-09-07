import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkcePair() {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function randomState() {
  return b64url(randomBytes(16))
}

// Browser-facing authorize URL. `prompt` = 'none' for a silent re-auth attempt.
export function authorizeUrl({ state, challenge, prompt }) {
  const u = new URL(`${config.fluxerPublic}/api/v1/oauth2/authorize`)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', config.oauth.clientId)
  u.searchParams.set('redirect_uri', config.oauth.redirectUri)
  u.searchParams.set('scope', config.oauth.scope)
  u.searchParams.set('state', state)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  if (prompt) u.searchParams.set('prompt', prompt)
  return u.toString()
}

async function tokenRequest(form) {
  const res = await fetch(`${config.fluxerApiInternal}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': config.userAgent,
      accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: config.oauth.clientId,
      client_secret: config.oauth.clientSecret,
      ...form,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`token ${form.grant_type} → ${res.status} ${text.slice(0, 300)}`)
  return JSON.parse(text) // { access_token, token_type, expires_in, refresh_token, scope }
}

export function exchangeCode({ code, verifier }) {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.oauth.redirectUri,
    code_verifier: verifier,
  })
}

export function refresh(refreshToken) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

async function bearerGet(path, accessToken) {
  const res = await fetch(`${config.fluxerApiInternal}${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      'user-agent': config.userAgent,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.json()
}

// { sub, id, username, discriminator, global_name, avatar, email }
export function userinfo(accessToken) {
  return bearerGet('/oauth2/userinfo', accessToken)
}

export async function isGuildMember(accessToken) {
  const guilds = await bearerGet('/users/@me/guilds', accessToken)
  return Array.isArray(guilds) && guilds.some(g => g.id === config.guildId)
}

export async function revoke(token) {
  try {
    await fetch(`${config.fluxerApiInternal}/oauth2/token/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': config.userAgent },
      body: new URLSearchParams({
        token,
        client_id: config.oauth.clientId,
        client_secret: config.oauth.clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {}
}

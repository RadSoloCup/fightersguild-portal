import { config } from '../config.js'
import { gateway } from '../bot/missionbot.js'
import { crosstalkRows } from './crosstalkStatus.js'

// Lightweight status board for the Servers page: the Fluxer stack's services
// (HTTP probes) plus the guild bots (presence via the gateway client).

const TIMEOUT = 6000

async function probe(url, ok) {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT), headers: { 'user-agent': config.userAgent } })
    const body = ok.needsBody ? await res.text() : ''
    return ok.test(res, body)
      ? { status: 'up' }
      : { status: 'down', detail: `HTTP ${res.status}` }
  } catch (e) {
    return { status: 'down', detail: e.name === 'TimeoutError' ? 'timed out' : e.message }
  }
}

async function checkServices() {
  const origin = config.fluxerPublic
  const [web, api, voice] = await Promise.all([
    // Web client served (Caddy + the SPA bundle).
    probe(`${origin}/`, { needsBody: true, test: (r, b) => r.status === 200 && b.includes('__FLUXER_BOOTSTRAP__') }),
    // API up: an unauthenticated call is rejected with 401, which still proves
    // the API container is answering (a dead one 502s / times out).
    probe(`${origin}/api/v1/gateway/bot`, { test: r => r.status === 401 || r.status === 200 }),
    // LiveKit health endpoint returns "OK".
    probe(`${origin}/livekit/`, { needsBody: true, test: (r, b) => r.status === 200 && /ok/i.test(b) }),
  ])

  // The realtime gateway: trust our own live socket over an HTTP guess.
  const gw = gateway()
  const chat = gw?.isReady ? { status: 'up' } : { status: 'down', detail: 'portal gateway not connected' }

  return [
    { key: 'fluxer', label: 'Fluxer service', ...web },
    { key: 'api', label: 'Chat server (API)', ...api },
    { key: 'gateway', label: 'Chat server (realtime)', ...chat },
    { key: 'voice', label: 'Voice server', ...voice },
  ]
}

function botList() {
  const bots = [...config.status.bots]
  const selfId = config.oauth.clientId
  if (selfId && !bots.some(b => b.id === selfId)) bots.push({ label: 'Portal bot', id: selfId })
  return bots
}

function checkBots() {
  const gw = gateway()
  const bots = botList()
  if (!gw?.isReady) {
    return bots.map(b => ({ key: b.id, label: b.label, status: 'unknown', detail: 'gateway offline' }))
  }
  const snap = gw.presenceSnapshot(bots.map(b => b.id))
  return bots.map(b => {
    const s = snap[b.id]
    return { key: b.id, label: b.label, status: s && s !== 'offline' && s !== 'invisible' ? 'up' : 'down' }
  })
}

// Refresh presences from the gateway, then build the snapshot.
export async function buildStatus() {
  const gw = gateway()
  if (gw?.isReady && config.guildId) {
    gw.requestPresences(config.guildId, botList().map(b => b.id))
    await new Promise(r => setTimeout(r, 1200)) // let the chunk come back
  }
  const [services, bots] = [await checkServices(), checkBots()]
  return { services: [...services, ...crosstalkRows()], bots, checkedAt: new Date().toISOString() }
}

// Cached snapshot served to the page; refreshed by a poller in server.js.
let cached = { services: [], bots: [], checkedAt: null }
export function getStatus() { return cached }
export async function pollStatus() { cached = await buildStatus() }

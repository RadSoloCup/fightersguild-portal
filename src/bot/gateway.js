import { EventEmitter } from 'node:events'
import { config } from '../config.js'

// Minimal Fluxer gateway client — just enough to receive MESSAGE_CREATE for the
// mission board. Discord-wire-compatible opcodes. No voice, no presence.
const OP = {
  DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7,
  INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11,
  REQUEST_GUILD_MEMBERS: 8,
}

const log = (...a) => console.log(new Date().toISOString(), '[gateway]', ...a)

async function getGatewayUrl() {
  const res = await fetch(`${config.fluxerApiInternal}/gateway/bot`, {
    headers: {
      authorization: `Bot ${config.bot.token}`,
      'user-agent': config.userAgent,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`gateway/bot → ${res.status}`)
  return (await res.json()).url
}

export class GatewayClient extends EventEmitter {
  constructor() {
    super()
    this.ws = null
    this.seq = null
    this.sessionId = null
    this.resumeUrl = null
    this.heartbeatTimer = null
    this.awaitingAck = false
    this.reconnectDelay = 1000
    this.botUserId = null
    this.closed = false
    this.connected = false
    // userId -> { status, since } from Request Guild Members (presences)
    this.presences = new Map()
  }

  get isReady() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN
  }

  // Ask Fluxer for these members' presences (op 8). Results arrive as
  // GUILD_MEMBERS_CHUNK and land in this.presences.
  requestPresences(guildId, userIds) {
    if (!this.isReady || !guildId || !userIds?.length) return
    this._pendingPresenceIds = [...userIds]
    this._send(OP.REQUEST_GUILD_MEMBERS, {
      guild_id: guildId,
      user_ids: userIds.slice(0, 100),
      presences: true,
      limit: 0,
      nonce: 'status',
    })
  }

  // { userId: 'online' | 'offline' | ... } for the ids asked about.
  presenceSnapshot(userIds) {
    const out = {}
    for (const id of userIds) out[id] = this.presences.get(id)?.status || 'offline'
    return out
  }

  async start() {
    this.closed = false
    await this._connect()
  }

  stop() {
    this.closed = true
    this._clearHeartbeat()
    try { this.ws?.close(1000) } catch {}
  }

  async _connect(resume = false) {
    let base
    try {
      base = resume && this.resumeUrl ? this.resumeUrl : await getGatewayUrl()
    } catch (err) {
      log(`lookup failed (${err.message}); retrying in 15s`)
      return void setTimeout(() => this._connect(), 15_000)
    }
    const url = `${base}${base.includes('?') ? '&' : '?'}v=1&encoding=json`
    log(`connecting ${resume ? '(resume) ' : ''}${base}`)

    const ws = new WebSocket(url)
    this.ws = ws
    ws.addEventListener('message', ev => this._onMessage(ev.data, resume))
    ws.addEventListener('error', () => {})
    ws.addEventListener('close', ev => {
      this._clearHeartbeat()
      if (this.closed) return
      this.connected = false
      const fatal = [4004, 4010, 4011, 4012, 4013, 4014].includes(ev.code)
      log(`socket closed (${ev.code} ${ev.reason || ''})${fatal ? ' — FATAL, not reconnecting' : ''}`)
      if (fatal) { this.emit('fatal', ev.code); return }
      const delay = Math.min(this.reconnectDelay, 30_000)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
      setTimeout(() => this._connect(!!this.sessionId), delay + Math.random() * 500)
    })
  }

  _onMessage(raw, wasResume) {
    let msg
    try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()) } catch { return }
    if (msg.s != null) this.seq = msg.s

    switch (msg.op) {
      case OP.HELLO:
        this._startHeartbeat(msg.d.heartbeat_interval)
        if (wasResume && this.sessionId) {
          this._send(OP.RESUME, { token: config.bot.token, session_id: this.sessionId, seq: this.seq })
        } else {
          this._identify()
        }
        break
      case OP.HEARTBEAT:
        this._send(OP.HEARTBEAT, this.seq)
        break
      case OP.HEARTBEAT_ACK:
        this.awaitingAck = false
        break
      case OP.INVALID_SESSION:
        log('invalid session, re-identifying')
        this.sessionId = null
        setTimeout(() => this._identify(), 1500 + Math.random() * 3000)
        break
      case OP.RECONNECT:
        try { this.ws.close(4900) } catch {}
        break
      case OP.DISPATCH:
        this._onDispatch(msg.t, msg.d)
        break
    }
  }

  _onDispatch(type, d) {
    switch (type) {
      case 'READY':
        this.reconnectDelay = 1000
        this.connected = true
        this.sessionId = d.session_id || this.sessionId
        this.resumeUrl = d.resume_gateway_url || this.resumeUrl
        this.botUserId = d.user?.id ?? this.botUserId
        log(`READY as ${d.user?.username ?? '?'} (${this.botUserId})`)
        this.emit('ready', d)
        break
      case 'RESUMED':
        this.connected = true
        break
      case 'MESSAGE_CREATE':
        if (d.author?.id && d.author.id === this.botUserId) return
        if (d.author?.bot) return
        this.emit('message', d)
        break
      case 'GUILD_MEMBERS_CHUNK': {
        const seen = new Set()
        for (const p of d.presences || []) {
          const id = p.user?.id || p.user_id
          if (id) { this.presences.set(id, { status: p.status || 'online', since: Date.now() }); seen.add(id) }
        }
        // Asked-about members with no presence in the chunk are offline.
        for (const id of this._pendingPresenceIds || []) {
          if (!seen.has(id)) this.presences.set(id, { status: 'offline', since: Date.now() })
        }
        this.emit('presences', this.presences)
        break
      }
      case 'PRESENCE_UPDATE': {
        const id = d.user?.id || d.user_id
        if (id && this.presences.has(id)) this.presences.set(id, { status: d.status || 'offline', since: Date.now() })
        break
      }
    }
  }

  _identify() {
    this._send(OP.IDENTIFY, {
      token: config.bot.token,
      properties: { os: process.platform, browser: 'fightersguild-portal', device: 'fightersguild-portal' },
      presence: { status: 'online', afk: false },
      ignored_events: [
        'TYPING_START',
        'GUILD_MEMBER_ADD', 'GUILD_MEMBER_UPDATE', 'GUILD_MEMBER_REMOVE',
        'CHANNEL_PINS_UPDATE', 'MESSAGE_REACTION_ADD', 'MESSAGE_REACTION_REMOVE',
        'MESSAGE_UPDATE', 'MESSAGE_DELETE', 'VOICE_STATE_UPDATE',
      ],
    })
  }

  _startHeartbeat(interval) {
    this._clearHeartbeat()
    setTimeout(() => {
      this._beat()
      this.heartbeatTimer = setInterval(() => this._beat(), interval)
    }, interval * Math.random())
  }

  _beat() {
    if (this.awaitingAck) {
      try { this.ws.close(4900) } catch {}
      return
    }
    this.awaitingAck = true
    this._send(OP.HEARTBEAT, this.seq)
  }

  _clearHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    this.awaitingAck = false
  }

  _send(op, d) {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op, d }))
      }
    } catch (err) {
      log(`send failed (op ${op}): ${err.message}`)
    }
  }
}

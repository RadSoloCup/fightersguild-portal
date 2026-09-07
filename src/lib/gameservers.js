import net from 'node:net'
import dns from 'node:dns/promises'
import { many, query } from '../db.js'

// Minecraft clients resolve _minecraft._tcp SRV records (playit.gg creates them).
// If no explicit port is set, honour the SRV, else fall back to 25565.
async function resolveMinecraft(host, port) {
  if (port) return { host, port }
  try {
    const srv = await dns.resolveSrv(`_minecraft._tcp.${host}`)
    if (srv?.length) return { host: srv[0].name, port: srv[0].port }
  } catch {}
  return { host, port: 25565 }
}

// ── plain TCP reachability ─────────────────────────────────────────────────
function checkTcp(host, port, timeoutMs = 4000) {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let done = false
    const finish = (status, detail = '') => {
      if (done) return
      done = true
      socket.destroy()
      resolve({ status, detail })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish('online'))
    socket.once('timeout', () => finish('offline', 'timed out'))
    socket.once('error', err => finish('offline', err.code || err.message))
    socket.connect(port, host)
  })
}

// ── Minecraft Server List Ping (handshake + status) ───────────────────────
function mcVarInt(n) {
  n >>>= 0
  const bytes = []
  do {
    let b = n & 0x7f
    n >>>= 7
    if (n !== 0) b |= 0x80
    bytes.push(b)
  } while (n !== 0)
  return Buffer.from(bytes)
}
function mcString(s) {
  const b = Buffer.from(s, 'utf8')
  return Buffer.concat([mcVarInt(b.length), b])
}
function mcPacket(id, ...parts) {
  const body = Buffer.concat([mcVarInt(id), ...parts])
  return Buffer.concat([mcVarInt(body.length), body])
}
function readVarInt(buf, offset) {
  let result = 0, shift = 0, pos = offset
  while (true) {
    if (pos >= buf.length) return null
    const b = buf[pos++]
    result |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
    shift += 7
  }
  return { value: result, offset: pos }
}

function checkMinecraft(host, port, timeoutMs = 5000) {
  return new Promise(resolve => {
    const socket = new net.Socket()
    let done = false
    let chunks = Buffer.alloc(0)
    const fail = (detail) => finish({ status: 'offline', detail })
    const finish = r => {
      if (done) return
      done = true
      socket.destroy()
      resolve(r)
    }
    socket.setTimeout(timeoutMs)
    socket.once('timeout', () => fail('timed out'))
    socket.once('error', err => fail(err.code || err.message))
    socket.connect(port, host, () => {
      const portBytes = Buffer.from([(port >> 8) & 0xff, port & 0xff])
      const handshake = mcPacket(0x00, mcVarInt(754), mcString(host), portBytes, mcVarInt(1))
      socket.write(handshake)
      socket.write(mcPacket(0x00)) // status request
    })
    socket.on('data', d => {
      chunks = Buffer.concat([chunks, d])
      // frame: [VarInt length][VarInt packetId=0x00][VarInt json length][json]
      const lenField = readVarInt(chunks, 0)
      if (!lenField) return
      const total = lenField.offset + lenField.value
      if (chunks.length < total) return
      const idField = readVarInt(chunks, lenField.offset)
      if (!idField) return fail('bad response')
      const strLen = readVarInt(chunks, idField.offset)
      if (!strLen) return fail('bad response')
      const json = chunks.subarray(strLen.offset, strLen.offset + strLen.value).toString('utf8')
      try {
        const info = JSON.parse(json)
        const motd = typeof info.description === 'string'
          ? info.description
          : (info.description?.text || flattenMotd(info.description) || '')
        finish({
          status: 'online',
          players_online: info.players?.online ?? null,
          players_max: info.players?.max ?? null,
          detail: [info.version?.name, motd].filter(Boolean).join(' · ').slice(0, 300),
        })
      } catch {
        finish({ status: 'online', detail: 'responded (unparseable)' })
      }
    })
  })
}
function flattenMotd(d) {
  if (!d) return ''
  if (typeof d === 'string') return d
  let s = d.text || ''
  if (Array.isArray(d.extra)) s += d.extra.map(flattenMotd).join('')
  return s
}

// ── poller ────────────────────────────────────────────────────────────────
export async function pollGameServers() {
  const rows = await many(
    `SELECT id, host, port, check_type FROM game_servers WHERE check_type <> 'none'`,
  )
  for (const s of rows) {
    let r
    try {
      if (s.check_type === 'minecraft') {
        const mc = await resolveMinecraft(s.host, s.port)
        r = await checkMinecraft(mc.host, mc.port)
      } else {
        if (!s.port) continue
        r = await checkTcp(s.host, s.port)
      }
    } catch (e) {
      r = { status: 'offline', detail: e.message }
    }
    await query(
      `UPDATE game_servers SET status = $2, players_online = $3, players_max = $4,
         status_detail = $5, checked_at = now() WHERE id = $1`,
      [s.id, r.status, r.players_online ?? null, r.players_max ?? null, (r.detail || '').slice(0, 300)],
    )
  }
}

export async function checkOne(id) {
  const [s] = await many('SELECT id, host, port, check_type FROM game_servers WHERE id = $1', [id])
  if (!s || s.check_type === 'none') return
  let r
  if (s.check_type === 'minecraft') {
    const mc = await resolveMinecraft(s.host, s.port)
    r = await checkMinecraft(mc.host, mc.port)
  } else {
    if (!s.port) return
    r = await checkTcp(s.host, s.port)
  }
  await query(
    `UPDATE game_servers SET status = $2, players_online = $3, players_max = $4,
       status_detail = $5, checked_at = now() WHERE id = $1`,
    [id, r.status, r.players_online ?? null, r.players_max ?? null, (r.detail || '').slice(0, 300)],
  )
}

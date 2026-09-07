import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { config } from '../config.js'

// AES-256-GCM at-rest encryption for stored OAuth refresh tokens. Key is
// derived from SESSION_SECRET (a dedicated TOKEN_ENC_KEY overrides it) — if the
// Portal DB leaks, the tokens in it are useless without this key.
const KEY = scryptSync(
  process.env.TOKEN_ENC_KEY || config.session.secret,
  'fgp-token-enc-v1',
  32,
)

const PREFIX = 'enc:v1:'

export function encryptToken(plaintext) {
  if (plaintext == null) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

// Transparently passes through legacy plaintext values (they get re-encrypted
// on the next write).
export function decryptToken(value) {
  if (value == null) return null
  const s = String(value)
  if (!s.startsWith(PREFIX)) return s
  try {
    const buf = Buffer.from(s.slice(PREFIX.length), 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const ct = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch (e) {
    throw new Error(`refresh token decrypt failed: ${e.message}`)
  }
}

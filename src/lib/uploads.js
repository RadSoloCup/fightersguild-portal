import { mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { config } from '../config.js'

const TYPES = {
  '89504e47': ['png', 'image/png'],
  'ffd8ff': ['jpg', 'image/jpeg'],
  '47494638': ['gif', 'image/gif'],
  '52494646': ['webp', 'image/webp'], // RIFF … WEBP (checked below)
}

// Sniff by magic bytes, not the client's content-type.
function detect(buf) {
  const hex = buf.subarray(0, 4).toString('hex')
  if (hex.startsWith('89504e47')) return TYPES['89504e47']
  if (hex.startsWith('ffd8ff')) return TYPES['ffd8ff']
  if (hex.startsWith('47494638')) return TYPES['47494638']
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString('ascii') === 'WEBP') return TYPES['52494646']
  return null
}

let ensured = false
async function ensureDir() {
  if (ensured) return
  await mkdir(config.uploadDir, { recursive: true })
  ensured = true
}

// Returns { url, file } or throws.
export async function saveImage(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('no file')
  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.length === 0) throw new Error('empty file')
  if (buf.length > config.uploadMaxBytes) throw new Error(`over ${Math.round(config.uploadMaxBytes / 1048576)} MB`)
  const t = detect(buf)
  if (!t) throw new Error('not a PNG / JPEG / GIF / WebP image')
  await ensureDir()
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${t[0]}`
  await writeFile(join(config.uploadDir, name), buf)
  return { url: `${config.basePath}/uploads/${name}`, file: name, contentType: t[1] }
}

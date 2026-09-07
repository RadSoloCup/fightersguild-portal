import pg from 'pg'
import { config } from './config.js'

export const pool = new pg.Pool({
  connectionString: config.db.connectionString,
  max: config.db.poolMax,
  idleTimeoutMillis: 30_000,
})

pool.on('error', err => console.error(new Date().toISOString(), 'pg pool error', err.message))

export function query(text, params) {
  return pool.query(text, params)
}

// Single row or null.
export async function one(text, params) {
  const { rows } = await pool.query(text, params)
  return rows[0] ?? null
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params)
  return rows
}

export async function tx(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

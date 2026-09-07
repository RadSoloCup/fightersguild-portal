import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pool } from './db.js'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort()
  const { rows } = await pool.query('SELECT name FROM schema_migrations')
  const done = new Set(rows.map(r => r.name))

  for (const file of files) {
    if (done.has(file)) continue
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    console.log(new Date().toISOString(), `migrating ${file}`)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw new Error(`migration ${file} failed: ${err.message}`)
    } finally {
      client.release()
    }
  }
  console.log(new Date().toISOString(), `migrations up to date (${files.length} total)`)
}

// Allow `npm run migrate` standalone.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.js')) {
  migrate().then(() => pool.end()).catch(err => { console.error(err); process.exit(1) })
}

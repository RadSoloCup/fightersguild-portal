import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const DISTANCE_KEYS = ['walk_one_cm', 'sprint_one_cm', 'crouch_one_cm', 'swim_one_cm', 'walk_on_water_one_cm',
  'walk_under_water_one_cm', 'climb_one_cm', 'fly_one_cm', 'aviate_one_cm', 'boat_one_cm', 'horse_one_cm',
  'minecart_one_cm', 'pig_one_cm', 'strider_one_cm']

const sum = obj => Object.values(obj || {}).reduce((s, v) => s + (Number(v) || 0), 0)

function summarize(json) {
  const s = json.stats || {}
  const c = s['minecraft:custom'] || {}
  return {
    playtime: (c['minecraft:play_time'] ?? c['minecraft:play_one_minute'] ?? 0) / 20,
    deaths: c['minecraft:deaths'] || 0,
    kills: c['minecraft:mob_kills'] || 0,
    mined: sum(s['minecraft:mined']),
    distance: DISTANCE_KEYS.reduce((t, k) => t + (c[`minecraft:${k}`] || 0), 0) / 100_000,
  }
}

export const METRICS = ['playtime', 'deaths', 'kills', 'mined', 'distance']

export async function buildLeaderboard({ statsDir, usercacheFile, limit = 10 }) {
  const names = new Map()
  for (const u of JSON.parse(await readFile(usercacheFile, 'utf8'))) names.set(u.uuid, u.name)

  const rows = []
  for (const f of await readdir(statsDir)) {
    if (!f.endsWith('.json')) continue
    const name = names.get(f.slice(0, -5))
    if (!name) continue
    try {
      rows.push({ name, ...summarize(JSON.parse(await readFile(path.join(statsDir, f), 'utf8'))) })
    } catch { /* a half-written stats file is skipped until the next refresh */ }
  }

  const metrics = {}
  for (const m of METRICS) {
    metrics[m] = rows
      .filter(r => r[m] > 0)
      .sort((a, b) => b[m] - a[m])
      .slice(0, limit)
      .map(r => ({ name: r.name, value: r[m] }))
  }
  return { generatedAt: new Date().toISOString(), players: rows.length, metrics }
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function startLeaderboard(config, log) {
  let latest = { generatedAt: null, players: 0, metrics: {} }

  async function refresh() {
    try {
      latest = await buildLeaderboard({ statsDir: config.mcStatsDir, usercacheFile: config.mcUsercache })
      log(`leaderboard refreshed: ${latest.players} players`)
    } catch (err) {
      log(`leaderboard refresh failed: ${err.message}`)
    }
  }

  refresh()
  setInterval(refresh, WEEK_MS).unref()
  return () => latest
}

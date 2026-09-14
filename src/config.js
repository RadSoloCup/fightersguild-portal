const env = process.env

function required(name) {
  const v = env[name]
  if (!v) throw new Error(`Missing required env var ${name}`)
  return v
}

// Public origin the browser sees. Portal is served under <origin>/portal.
const publicOrigin = required('PORTAL_PUBLIC_ORIGIN').replace(/\/$/, '')
const basePath = (env.PORTAL_BASE_PATH || '/portal').replace(/\/$/, '')

export const config = {
  port: Number(env.PORT || 3000),
  publicOrigin,
  basePath,
  baseUrl: `${publicOrigin}${basePath}`,

  // Fluxer API, reached server-side. NOTE: the API 403s any request that does
  // not arrive through Caddy (it validates the proxy chain), so we must use the
  // public URL even from inside the compose network — the hairpin is cheap.
  // The browser-facing OAuth URLs are always built from publicOrigin.
  fluxerApiInternal: (env.FLUXER_API_INTERNAL || `${publicOrigin}/api/v1`).replace(/\/$/, ''),
  fluxerPublic: publicOrigin,

  guildId: required('FIGHTERS_GUILD_ID'),

  oauth: {
    clientId: required('OAUTH_CLIENT_ID'),
    clientSecret: required('OAUTH_CLIENT_SECRET'),
    scope: 'identify guilds',
    redirectUri: `${publicOrigin}${basePath}/auth/callback`,
  },

  session: {
    secret: required('SESSION_SECRET'), // >= 32 chars
    cookieName: 'fgp_session',
    flowCookieName: 'fgp_flow',
    ttlSeconds: Number(env.SESSION_TTL_SECONDS || 7 * 24 * 3600),
    // Re-check guild membership + resync profile (name/avatar) at most this
    // often, per user (seconds).
    recheckSeconds: Number(env.MEMBERSHIP_RECHECK_SECONDS || 900),
  },

  db: {
    // Full connection string, or assembled from parts.
    connectionString:
      env.DATABASE_URL ||
      `postgres://${env.PGUSER || 'portal'}:${encodeURIComponent(env.PGPASSWORD || '')}@${env.PGHOST || 'postgres'}:${env.PGPORT || 5432}/${env.PGDATABASE || 'portal'}`,
    poolMax: Number(env.PG_POOL_MAX || 6),
  },

  // Portal admins (Fluxer user IDs, comma-separated). Full moderation rights.
  adminIds: (env.PORTAL_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean),

  // Uploaded forum images. Needs a writable volume in production.
  uploadDir: env.UPLOAD_DIR || '/data/uploads',
  uploadMaxBytes: Number(env.UPLOAD_MAX_BYTES || 8 * 1024 * 1024),

  // Launcher distribution: distribution.json + packaged mod/config files
  // (built by Nebula). Served unauthenticated at /downloads — the desktop
  // launcher has no Portal browser session, so this sits outside the sign-in
  // gate, same trust model as any other unlisted download link.
  downloadsDir: env.DOWNLOADS_DIR || '/data/launcher-downloads',

  // Optional cross-posting to Fluxer via the Portal bot.
  bot: {
    token: env.PORTAL_BOT_TOKEN || null,
    // Announce new forum threads here.
    forumChannelId: env.ANNOUNCE_FORUM_CHANNEL_ID || null,
    // Announce new events here.
    eventsChannelId: env.ANNOUNCE_EVENTS_CHANNEL_ID || null,
    // Post missions to the board here (the sc-tools !sc job channel works too).
    missionChannelId: env.MISSION_BOARD_CHANNEL_ID || null,
  },

  // Status board (Servers page). Extra guild bots to show, "Label:userId,Label:userId".
  // The Portal's own bot is always included.
  status: {
    bots: (env.STATUS_BOTS || '').split(',').map(s => s.trim()).filter(Boolean).map(pair => {
      const i = pair.lastIndexOf(':')
      return i > 0 ? { label: pair.slice(0, i).trim(), id: pair.slice(i + 1).trim() } : null
    }).filter(b => b && /^\d+$/.test(b.id)),
    // Shared bearer token the Crosstalk bridge uses to POST its health snapshot.
    ingestToken: env.STATUS_INGEST_TOKEN || null,
  },

  // Machine-to-machine event creation (e.g. fightersguild-mc-events posting a
  // seasonal battlepass launch). Same bearer-token pattern as status.ingestToken.
  events: {
    ingestToken: env.EVENTS_INGEST_TOKEN || null,
    // Fallback creator when the caller doesn't specify one — must be a user id
    // that has signed into the Portal at least once (FK to users.id).
    defaultCreatorId: env.EVENTS_INGEST_DEFAULT_CREATOR_ID || null,
  },

  userAgent: env.USER_AGENT || 'fightersguild-portal (+https://github.com/RadSoloCup/fightersguild-portal)',
  // AGPL §13: the running service must point users at its source. Override if
  // you run a modified copy.
  sourceUrl: env.PORTAL_SOURCE_URL || 'https://github.com/RadSoloCup/fightersguild-portal',
  isDev: env.NODE_ENV !== 'production',
}

export function assertConfig() {
  if (config.session.secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }
}

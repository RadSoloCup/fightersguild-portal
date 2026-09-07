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

  // Optional cross-posting to Fluxer via the Portal bot.
  bot: {
    token: env.PORTAL_BOT_TOKEN || null,
    // Announce new forum threads here.
    forumChannelId: env.ANNOUNCE_FORUM_CHANNEL_ID || null,
    // Announce new events here.
    eventsChannelId: env.ANNOUNCE_EVENTS_CHANNEL_ID || null,
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

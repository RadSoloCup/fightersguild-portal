process.env.OAUTH_CLIENT_ID='x';process.env.OAUTH_CLIENT_SECRET='x';process.env.SESSION_SECRET='0123456789012345678901234567890123456';process.env.PORTAL_PUBLIC_ORIGIN='http://localhost:3000';process.env.FIGHTERS_GUILD_ID='9'
process.env.DATABASE_URL='postgres://x:x@127.0.0.1:1/x'  // won't connect, just testing the checkers
const g = await import('./src/lib/gameservers.js')

# Fighters Guild Portal

A **Forum** and **Events** calendar for the Fighters Guild, with **one login** —
your Fluxer account signs you into the Portal too. No second password.

Served under `https://chat.example.com/portal`, next to the chat.

- **[DESIGN.md](DESIGN.md)** — the full architecture and roadmap.
- Milestone 1 (this): SSO + Forum + a simple Events list with RSVP.

---

## How the login works

The Portal is a Fluxer **OAuth2** client (`identify guilds` scopes). First
visit → one consent screen on Fluxer → back to the Portal, signed in. After that
it's silent. Only members of the Fighters Guild server get in; if you leave the
server, Portal access is revoked within the hour.

No password is ever stored here — identity is read from Fluxer.

---

## Running it

Needs Postgres and network access to the Fluxer `api` service. It's built to run
as a container on the Fluxer stack's Docker network.

### 1. Postgres

In the Fluxer Postgres container:

```sql
CREATE ROLE portal LOGIN PASSWORD 'a-strong-password';
CREATE DATABASE portal OWNER portal;
```

The app runs its own migrations on boot.

### 2. OAuth2 app

In Fluxer settings, create an application **"Fighters Guild Portal"**. Register
redirect URI `https://chat.example.com/portal/auth/callback`. Note the
client id + secret.

### 3. Config

Copy `.env.example` → `portal.env`, fill in `OAUTH_CLIENT_ID`,
`OAUTH_CLIENT_SECRET`, `SESSION_SECRET` (`openssl rand -hex 32`), `PGPASSWORD`,
and `PORTAL_ADMIN_IDS` (your Fluxer user id).

### 4. Compose + Caddy

Add the service from `compose.snippet.yml`, add the route from
`Caddyfile.snippet` to the Fluxer Caddyfile, then bring it up and reload Caddy.

### Local dev

```bash
npm install
DATABASE_URL=postgres://... OAUTH_CLIENT_ID=... OAUTH_CLIENT_SECRET=... \
SESSION_SECRET=$(openssl rand -hex 32) \
PORTAL_PUBLIC_ORIGIN=http://localhost:3000 PORTAL_BASE_PATH=/portal \
FLUXER_API_INTERNAL=https://chat.example.com/api/v1 \
npm start
```

---

## Layout

```
src/
  server.js          Hono app, static, membership sweep
  config.js  db.js  migrate.js
  auth/
    oauth.js         Fluxer OAuth2 client (PKCE, token, userinfo, guild check)
    session.js       signed-cookie session, requireAuth / requireAdmin
  routes/
    home.js  auth.js  forum.js  events.js
  lib/
    html.js          layout + formatting (hono/html SSR)
    markdown.js       markdown-it + sanitize-html
    users.js  slug.js  membership.js
  bot/announce.js    optional cross-posting to a Fluxer channel
migrations/001_init.sql
public/portal.css    RSI Blue theme
```

## Notes

- Keeps state in Postgres only. Back it up with `pg_dump portal`.
- The forum "Announcements" category is admin-post by default.
- Events: anyone signed in can create one; RSVP is Going / Interested / Can't.
- The optional Portal bot is **outbound only** (posts announcements) — it needs
  no gateway connection.

## Credits

| | | License |
|---|---|---|
| [**Hono**](https://hono.dev) + [`@hono/node-server`](https://github.com/honojs/node-server) | web framework + SSR (`hono/html`, `hono/jwt`) | MIT |
| [`pg`](https://node-postgres.com) | PostgreSQL client | MIT |
| [`markdown-it`](https://github.com/markdown-it/markdown-it) | forum / event markdown rendering | MIT |
| [`sanitize-html`](https://github.com/apostrophecms/sanitize-html) | scrubs rendered HTML | MIT |
| [**Fluxer**](https://github.com/fluxerapp/fluxer) | the chat platform — the Portal is a Fluxer OAuth2 client and shares its accounts | AGPL-3.0 |
| [PostgreSQL](https://www.postgresql.org) | the database (runs alongside the Fluxer stack) | PostgreSQL License |

The **RSI Blue** theme (`public/portal.css`) is original work — the palette
echoes the Star Citizen launcher. **Star Citizen®** and **Roberts Space
Industries®** are trademarks of Cloud Imperium Rights LLC; this is an unofficial
fan project, not affiliated with Cloud Imperium Games.

## License

Copyright © 2026 Fighters Guild. Licensed under the
[GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html) — see [`LICENSE`](LICENSE).

The Portal is a network service: per AGPL §13 it links its own source in the page
footer, and if you run a modified copy you must do the same for your users.

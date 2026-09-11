# Fighters Guild Portal

The **Operations Center** for the Fighters Guild: a web app that runs next to the
guild's [Fluxer](https://github.com/fluxerapp/fluxer) chat server and handles
everything around the chat. It is served under `https://chat.example.com/portal`
and is also the **Ops Center** tab in the
[desktop client](https://github.com/RadSoloCup/fightersguild-app).

Its job is to run Star Citizen operations for the guild: planning missions,
signing up crew, tracking ships, keeping an events calendar, hosting a forum, and
watching the guild's game servers and services.

---

## What it does

### Mission board

The core of the Portal. A member posts an operation with:

- a title and a markdown briefing
- mission type and pay
- a **roll call time** (be in voice, logged in, spawned) and a **mission time**
  (wheels up)
- an in game **meet up point**
- a set of **crew roles**, each with a slot count (for example Fighter escort x2,
  Medic x1, Overwatch with no cap)
- a list of **ship types** the operation wants (for example Heavy fighter x2,
  Medical)

Other members then:

- **claim a role** with one button. Roles with a slot cap fill up and lock.
  Picking a different role moves you.
- **tick which of the requested ships they can bring.** A member can offer more
  than one ship.

The board shows every role, who has signed up, and the ships each person is
bringing, so the operation lead can see crew and hull coverage at a glance. Board
cards show a `Crew 3/4` fill summary.

The creator or an admin can **edit** an open operation (times, briefing, roles,
ships, meet up point) with sign ups preserved, or **mark it complete** and file a
short after action report: did it pass or fail, why, what to change next time,
and was the described payout made. Filing the report opens a discussion thread in
the forum's Operations category so the crew can talk it over. Completed
operations move to their own list with the reports attached.

### Two way sync with the chat server

The mission board is wired into the chat server both directions:

- Posting an operation on the web drops a rich embed in the guild's mission
  channel, and editing it re renders that message.
- Posting `!mission` in that channel (with a title, `role:` and `ship:` lines,
  times, and a briefing) creates a board entry. `!mission help` prints the
  format.

So a member can plan an op from either the web or chat and it shows up in both.

### Forum

Markdown threads with categories, per user read tracking, and image uploads
(paste, drop, or pick a file). Admins can pin, lock, move between categories, and
delete threads, and every moderation action is logged. Seeded categories:
Announcements (admin post only), Operations, Recruitment, Guides, Star Citizen,
Off topic.

### Events calendar

Anyone signed in can schedule an event with a time and location. RSVP is going,
interested, or can't.

### Game server list

The guild's game servers (Minecraft, Hytale, and so on) with a background up or
down check every couple of minutes. For Minecraft style servers it does a real
server list ping and shows player count, version, and MOTD; for other games it
falls back to a TCP reachability check. Each server card has a copy address
button and an optional one click join link. Admins manage the list, including an
optional faded box art background per game.

### Service status board

On the Servers page, a live status panel for the whole stack: the chat service,
the API, the realtime gateway, the voice server, and each guild bot (up or
down, read from the gateway). The
[Crosstalk bridge](https://github.com/RadSoloCup/fightersguild-crosstalk) also
pushes its own health here (Fluxer link, Discord link, text bridge, voice
bridge) when `STATUS_INGEST_TOKEN` is set.

### Admin

An admin area with a dashboard, forum category management, the game server list,
the moderation log, and a member list where admins can grant or revoke admin and
revoke or restore a member's Portal access.

---

## How sign in works

The Portal has no accounts of its own. It is an **OAuth2 client of the chat
server**, so signing in uses your existing Fighters Guild chat identity as the
gateway: one consent screen on the first visit, then it is silent. The Portal
reads your username and avatar from the chat server and keeps them in sync, and
it checks that you are still a member of the Fighters Guild server; if you leave,
Portal access is revoked within the hour.

Only members of the guild server can see anything. To everyone else the Portal is
a single sign in page that reveals nothing about the guild.

Scopes requested: `identify` and `guilds`. The refresh token the Portal stores to
re check membership is encrypted at rest.

---

## Plans

Cloud Imperium has said public Star Citizen APIs are coming. When they land, the
Portal is where they plug in:

- pull a member's owned fleet from their RSI account and pre fill the "ships I can
  bring" picker instead of asking them to tick boxes
- resolve org membership and reputation automatically
- show live server or shard status per operation
- link an operation to an in game contract or event and track its state
- richer after action data (payouts, losses) straight from the game

Until then the ship and role lists are entered by hand, which still captures the
plan.

---

## Running it

The Portal runs as a container on the Fluxer stack's Docker network, alongside
Postgres and the chat API. It runs its own database migrations on boot.

### 1. Database

In the Fluxer Postgres container:

```sql
CREATE ROLE portal LOGIN PASSWORD 'a-strong-password';
CREATE DATABASE portal OWNER portal;
```

### 2. OAuth2 application

In the chat server's settings, create an application named "Fighters Guild
Portal" and register the redirect URI
`https://chat.example.com/portal/auth/callback`. Note the client id and secret.

### 3. Portal bot

Create a bot account for the Portal and invite it to the guild with View
Channels, Send Messages, Embed Links, Attach Files, Read Message History, and
Manage Webhooks. It needs a gateway connection so it can read `!mission` in the
mission channel, so it must be a guild member, not just a webhook.

### 4. Config

Copy `.env.example` to `portal.env` and fill in `OAUTH_CLIENT_ID`,
`OAUTH_CLIENT_SECRET`, `SESSION_SECRET` (`openssl rand -hex 32`),
`TOKEN_ENC_KEY` (`openssl rand -hex 32`), the database password,
`FIGHTERS_GUILD_ID`, `PORTAL_ADMIN_IDS` (your chat user id),
`PORTAL_BOT_TOKEN`, and `MISSION_BOARD_CHANNEL_ID`.

Note: the chat API rejects requests that do not arrive through the reverse proxy,
so `FLUXER_API_INTERNAL` must be the public URL
(`https://chat.example.com/api/v1`), not an internal container address. The
hairpin is cheap.

### 5. Compose and reverse proxy

Add the service from `compose.snippet.yml` to the Fluxer Compose project, add the
route from `Caddyfile.snippet` to the Fluxer Caddyfile, bring it up, and reload
the proxy.

### Local dev

```bash
npm install
DATABASE_URL=postgres://... OAUTH_CLIENT_ID=... OAUTH_CLIENT_SECRET=... \
SESSION_SECRET=$(openssl rand -hex 32) \
PORTAL_PUBLIC_ORIGIN=http://localhost:3000 PORTAL_BASE_PATH=/portal \
FLUXER_API_INTERNAL=https://chat.example.com/api/v1 \
FIGHTERS_GUILD_ID=... \
npm start
```

---

## Layout

```
src/
  server.js          Hono app, static, auth gate, membership sweep, pollers
  config.js  db.js  migrate.js
  auth/
    oauth.js         chat server OAuth2 client (PKCE, token, userinfo, guild check)
    session.js       signed cookie session, requireAuth / requireAdmin
  routes/
    home.js  auth.js  forum.js  events.js  servers.js  missions.js  admin.js
  lib/
    html.js          layout and formatting (hono/html server rendering)
    markdown.js       markdown-it plus sanitize-html
    missions.js       mission create, edit, roster, sign up, ships
    gameservers.js    TCP and Minecraft ping checks
    status.js         service and bot status board
    crypto.js         AES-256-GCM for stored refresh tokens
    users.js  slug.js  membership.js  forum.js  gameart.js  modlog.js
  bot/
    announce.js      cross posts to chat channels, edits its own messages
    gateway.js       minimal chat gateway client (receive only)
    missionbot.js    listens for !mission in the board channel
migrations/*.sql
public/portal.css    RSI Blue theme
```

## Notes

- All state lives in Postgres. Back it up with `pg_dump portal`.
- A five minute sweep re checks each member's guild membership and refreshes
  their name and avatar.
- The mission bot ignores its own messages, so cross posts do not loop.

## Credits

| | | License |
|---|---|---|
| [**Hono**](https://hono.dev) and [`@hono/node-server`](https://github.com/honojs/node-server) | web framework and server rendering (`hono/html`, `hono/jwt`) | MIT |
| [`pg`](https://node-postgres.com) | PostgreSQL client | MIT |
| [`markdown-it`](https://github.com/markdown-it/markdown-it) | forum and event markdown rendering | MIT |
| [`sanitize-html`](https://github.com/apostrophecms/sanitize-html) | scrubs rendered HTML | MIT |
| [**Fluxer**](https://github.com/fluxerapp/fluxer) | the chat platform. The Portal is an OAuth2 client of it and uses its accounts. | AGPL-3.0 |
| [PostgreSQL](https://www.postgresql.org) | the database, runs alongside the Fluxer stack | PostgreSQL License |

The **RSI Blue** theme (`public/portal.css`) is original work; the palette echoes
the Star Citizen launcher. **Star Citizen&reg;** and **Roberts Space
Industries&reg;** are trademarks of Cloud Imperium Rights LLC. This is an
unofficial fan project, not affiliated with Cloud Imperium Games.

## License

Copyright &copy; 2026 Fighters Guild. Licensed under the
[GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html), see [`LICENSE`](LICENSE).

The Portal is a network service. Per AGPL section 13 it links its own source in
the page footer, and if you run a modified copy you must do the same for your
users.

---

Made in Canada 🇨🇦

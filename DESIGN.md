# Fighters Guild Portal — design notes

**Status:** proposal / not started · drafted 2026-09-06
**Goal:** a Forum, an Events calendar, and a proper Job Board, reachable from the
Fighters Guild desktop app, with **one login** — a Fluxer account signs you into
all of it. No second password, no second account.

---

## 1. Is it feasible?

**Yes.** Every piece it needs already exists:

| Need | How | Confidence |
|---|---|---|
| Single sign-on with Fluxer | Fluxer ships a full **OAuth2 authorization-code flow** (`/oauth2/authorize`, `/oauth2/token`, `/oauth2/userinfo`, PKCE, `prompt=none` silent re-auth, refresh tokens) | **Verified in `fluxerapp/fluxer` source** |
| "Are they a guild member?" | OAuth2 `guilds` scope returns the user's guild list | Verified (scope exists) |
| Surface it in the app | The desktop app is an Electron wrapper we already inject into (titlebar, tray, voice) — adding a nav entry / in-window tab is the same technique | Established pattern |
| Hosting | Another Compose service on Unraid + a Caddy route, exactly like the Fluxer stack and sc-tools | Established pattern |
| The forum/calendar/jobs themselves | Either a small bespoke app (like sc-tools / dj) or an off-the-shelf forum behind the same SSO | Standard work |

The only genuinely *new* infrastructure is: **one OAuth2 app registration** in
Fluxer, **one new web service**, and **one Caddy route**.

---

## 2. Shape of it

One web app — **"the Portal"** — with modules, not three separate apps. Reasons:

- One OAuth2 client, one consent screen, one session — the SSO goal is met once.
- One deploy, one theme (RSI Blue), one nav.
- The modules stay code-separable, so a module can be split out later if wanted.

```
                    ┌───────────────────────────────┐
  Fluxer account →  │  chat.example.com    │
                    │   /            → Fluxer (chat)  │
                    │   /portal      → Portal SPA/SSR │
                    │       /forum                    │
                    │       /events                   │
                    │       /jobs                     │
                    │   /oauth2/*    → Fluxer OAuth2   │  ← SSO happens here
                    │   /livekit     → voice          │
                    └───────────────────────────────┘
                              ▲
              Caddy routes /portal/* to the new container
```

Serving the Portal on the **same origin** as Fluxer (`/portal`) is deliberate —
it makes the desktop-app integration and the OAuth redirect seamless, and lets
the Portal optionally read the Fluxer session cookie for a zero-click first
login. A subdomain (`portal.chat.example.com`) also works and is
cleaner to reason about; pick one before building (see Open Questions).

---

## 3. SSO — how "one login" actually works

This is the core of the request, and it's the best-supported part.

### 3.1 One-time setup

1. In Fluxer's app settings, create an OAuth2 application **"Fighters Guild Portal"**.
   - Redirect URI: `https://chat.example.com/portal/auth/callback`
   - Note the `client_id` and `client_secret`.
2. Scopes the Portal will request: **`identify guilds`**
   - `identify` → user id, username, avatar (via `/oauth2/userinfo`)
   - `guilds` → to confirm the user is in the **Fighters Guild** server

### 3.2 The login flow (standard OAuth2 + PKCE)

```
User opens /portal
  └─ no Portal session? → redirect to:
     https://chat.example.com/oauth2/authorize
       ?client_id=<portal>
       &redirect_uri=https://chat.example.com/portal/auth/callback
       &response_type=code
       &scope=identify guilds
       &state=<csrf>
       &code_challenge=<PKCE S256>
       &code_challenge_method=S256
  └─ Fluxer: user is already logged in → shows a one-time consent screen
     (first visit only) → redirects back with ?code=…&state=…
  └─ Portal /auth/callback:
       POST /oauth2/token  (code + code_verifier + client_secret) → access + refresh token
       GET  /oauth2/userinfo  → { id, username, avatar }
       GET  /users/@me/guilds  (with the token) → must include Fighters Guild
     → create a Portal session cookie (JWT or server session), store the
       refresh token server-side.
```

**After the first consent it is invisible.** Subsequent logins (new device, session
expiry) use `prompt=none` on `/oauth2/authorize` — Fluxer silently returns a fresh
code with no UI because consent is already on record. In the desktop app, where
the user is *always* already logged into Fluxer in the same session, this means
opening the Forum just works.

### 3.3 Keeping them in sync

- Portal session ~30 days, backed by the stored refresh token; refresh in the
  background via the `refresh_token` grant.
- On each Portal login, re-check guild membership. If they've left Fighters
  Guild, revoke their Portal access.
- "Log out everywhere" in Fluxer doesn't automatically kill the Portal session —
  add a periodic `/oauth2/introspect` check (hourly) so a revoked token logs the
  user out of the Portal within the hour.
- Identity is **read** from Fluxer, never duplicated — no password is ever stored
  by the Portal.

### 3.4 Notes / gotchas

- Fluxer OAuth2 is OAuth2, **not full OIDC** — no `openid` scope, no `id_token`.
  `/oauth2/userinfo` covers everything we need, so this doesn't matter.
- Redirect URIs must be pre-registered exactly (verified by
  `OAuth2AuthorizeRedirectURI.test.ts`).
- Some Fluxer instances gate OAuth2 app creation behind admin approval
  (`AdminOAuth2ApplicationRequirement.test.ts`). We own the instance, so we
  approve our own app.
- Bots and OAuth are separate credential namespaces — the Portal is an OAuth2
  app, not a bot. (A bot is only needed if the Portal should *post into Fluxer
  channels* — see Job Board below.)

---

## 4. Surfacing it in the desktop app

The request is "under the Fighters Guild server on the left-hand side." Three
ways, roughly in order of robustness:

### Option A — Electron-drawn nav (recommended)

The wrapper adds its own UI element and opens Portal modules in a
`WebContentsView` swapped into the main window (or a dedicated `BrowserWindow`,
like the killfeed settings window today).

- **Where:** a slim strip below Fluxer's guild rail, or a small top tab bar
  (`Chat · Forum · Events · Jobs`), drawn by the wrapper.
- **Pros:** fully under our control, survives every Fluxer update, no re-patching.
  Same `executeJavaScript` / `BrowserWindow` techniques `main.js` already uses.
- **Cons:** not *literally* an icon inside Fluxer's server rail — it sits
  adjacent to it. In practice this reads fine.
- **Session:** the Portal is same-origin with Fluxer, so the Electron session's
  cookies carry over; OAuth `prompt=none` completes with no interaction.

### Option B — patch the Fluxer SPA guild rail

Add custom icons into Fluxer's server list, the same way the "Download" button
was repointed (`/mnt/user/appdata/fluxer/patches/`, re-applied after every
`docker compose pull`).

- **Pros:** pixel-native — the icons live in the real rail.
- **Cons:** fragile. Re-detect the bundle hash and re-patch on every Fluxer
  update. The rail is React; injecting a working nav item is more invasive than
  swapping a URL string.

### Option C — upstream a real feature to Fluxer

Fluxer is AGPL and its roadmap already lists a bot UI kit. A "guild external
links / tabs" feature could be contributed. Big scope, long timeline — not now.

**Recommendation:** Option A. Ship the Portal as a web app first (usable in any
browser at `/portal`), then add the Electron nav entry. If Fluxer later ships a
guild-tabs feature, move to it.

---

## 5. The Forum

### Build vs off-the-shelf

| Approach | RAM | SSO effort | Theme match | Verdict |
|---|---|---|---|---|
| **Bespoke** (Node + SQLite/Postgres) | ~128 MB | trivial (we write it) | perfect (RSI Blue from day one) | **Recommended** — matches how sc-tools / dj were built, unifies forum + events + jobs, no plugin wrangling |
| **NodeBB** | ~512 MB | medium (custom SSO plugin) | good (themeable) | strong fallback if we want batteries-included (search, notifications, mobile) |
| **Flarum** | ~256 MB | medium (`fof/oauth` + custom provider) | good | fine, PHP stack is a new thing to run |
| **Discourse** | ~1 GB+ | low (`discourse-oauth2-basic` fits our endpoints exactly) | heavy to restyle | overkill for a guild |

The bespoke path wins here because the Portal is *also* the calendar and job
board — one app, one schema, one theme, one auth. A forum's core (categories →
threads → posts, markdown, edit history, pins, locks, reactions) is a known,
bounded build.

### Forum feature set (v1)

- Categories (e.g. *Announcements*, *Operations*, *Recruitment*, *Off-topic*,
  *Star Citizen*), admin-managed.
- Threads with markdown posts, edit + soft-delete, quote-reply.
- Pin / lock / move (moderators = Fighters Guild roles, read from the `guilds`
  scope's role data or a Portal-side admin list).
- Reactions (reuse Fluxer's emoji set for consistency).
- Full-text search (SQLite FTS5 or Postgres `tsvector`).
- Unread tracking per user, "new since last visit".
- Optional: a bot cross-posts new threads in a chosen Fluxer channel.

---

## 6. Events / Calendar module

Fits guild ops nights, org events, race schedules.

- Create event: title, description (markdown), start/end, location (free text or
  a Fluxer voice channel link), cover image.
- RSVP: Going / Interested / Can't. Roster view.
- Recurring events (weekly ops).
- Views: month grid, agenda list, "next 7 days" widget on the Portal home.
- iCal feed per user (`/events/feed/<token>.ics`) so it drops into Google/Outlook.
- Optional: a bot posts a reminder in a Fluxer channel N minutes before, and/or
  pings RSVPs.
- Ties into the Job Board — a job can *become* a scheduled event.

---

## 7. Job Board module

There's already a lightweight job board: the sc-tools `!sc job` command parses a
bracketed message and posts an embed into the Fluxer job channel
the guild job-board channel, deleting the original. The Portal version is the
"proper" one; the bot flow stays as a quick-post shortcut.

- Structured listing form: role, crew size, mission type, objective, pay, launch
  time, voice channel, tags.
- Browse / filter (open vs filled, by pay, by time, by tag).
- Apply / express interest → notifies the poster (in-Portal + optional Fluxer DM
  via bot).
- "Launch now" → spins up an Event and/or drops a formatted post in the Fluxer
  job channel (reusing the existing embed format from `sc-tools/src/bot/jobBoard.js`).
- The sc-tools bot gains a `POST /jobs` call to the Portal API so `!sc job` and
  the web form write to the *same* backend.

---

## 8. Suggested tech stack

Consistent with sc-tools / dj so there's one mental model:

- **Runtime:** Node 22, ESM, no build step where avoidable.
- **Server:** Hono or Fastify (Fluxer itself uses Hono).
- **DB:** Postgres (share the Fluxer stack's Postgres with a separate database,
  or a dedicated small instance). SQLite is viable for a single guild but
  Postgres avoids a migration later.
- **Frontend:** server-rendered (HTMX or a light templating layer) for the forum
  and job board; a small amount of JS for the calendar. Keeps it fast and
  themeable. A full SPA is optional and can come later.
- **Theme:** port the RSI Blue palette (`themes/rsi-blue.css` in sc-tools) into
  the Portal's own CSS — navy surfaces, cyan accents, same as the launcher.
- **Auth lib:** hand-rolled OAuth2 client (~150 lines) — the flow is small and
  we've now got the exact endpoint contract.
- **Deploy:** `fightersguild-portal` repo → Docker → Compose Manager service on
  Unraid → Caddy route `handle_path /portal/*` → container. Same staged-deploy
  script pattern as sc-tools / dj.

---

## 9. Data model sketch

```
users            id (Fluxer snowflake, PK), username, avatar,
                 roles (cached), last_seen, created_at
oauth_tokens     user_id, refresh_token (encrypted), scope, expires_at

forum_categories id, name, slug, description, position, min_role
forum_threads    id, category_id, author_id, title, slug, pinned, locked,
                 created_at, last_post_at, post_count
forum_posts      id, thread_id, author_id, body_md, created_at, edited_at,
                 deleted_at
forum_reactions  post_id, user_id, emoji
forum_reads      user_id, thread_id, last_read_post_id

events           id, creator_id, title, body_md, starts_at, ends_at, location,
                 voice_channel_id?, cover_url, recurrence_rule?, created_at
event_rsvps      event_id, user_id, status (going|interested|declined)

jobs             id, poster_id, role, crew_size, mission_type, objective,
                 pay, launch_at, voice_channel_id, tags[], status (open|filled|
                 cancelled), fluxer_message_id?, created_at
job_interest     job_id, user_id, note, created_at
```

---

## 10. Build phases

1. **Portal skeleton + SSO** — the OAuth2 client, session, membership gate, RSI
   Blue shell, home page. Deployed at `/portal`. *This is the milestone that
   proves the whole idea.*
2. **Forum** — categories, threads, posts, markdown, search, unread.
3. **Desktop app nav** — Electron nav entry opens the Portal in-window.
4. **Events** — calendar, RSVP, iCal, home-page "next 7 days".
5. **Job Board** — web form + browse; point `!sc job` at the Portal API.
6. **Bot glue** — cross-post new threads / job listings / event reminders into
   Fluxer channels (needs a bot token — could be the sc-tools bot or a new one).
7. **Polish** — notifications, mobile layout, moderation tools, audit log.

Phases 1–2 are the "forum exists and one login works" deliverable.

---

## 11. Open questions (for you)

1. **Same origin (`/portal`) or subdomain (`portal.chat.example.com`)?**
   Same-origin = smoother SSO and app integration; subdomain = cleaner
   separation, its own Caddy block, easier to move later. Leaning same-origin.
2. **Bespoke forum, or stand up NodeBB behind the SSO?** Bespoke matches
   everything else and unifies the three modules; NodeBB is faster to a
   feature-rich forum but a separate system to run and theme. Leaning bespoke.
3. **Postgres:** share the Fluxer stack's instance (new DB) or run a dedicated
   one? Sharing is less to manage; dedicated is safer isolation.
4. **Moderation roles:** derive from Fluxer guild roles, or a Portal-side admin
   list to start? Portal-side list is trivial for v1.
5. **How much calendar do you want** — simple event list + RSVP, or full
   recurring-events with reminders? Affects phase 4 size.
6. **One bot or reuse sc-tools' bot** for Portal→Fluxer cross-posting?

---

## 12. Risks

- **Fluxer SPA changes** could break Option-B rail patching (hence Option A).
- **OAuth app approval** — confirm the instance lets us register the app (we're
  admin, should be fine).
- **playit hairpin** — the Portal container calling `chat.example.com`
  for token exchange from inside the same host may need the same
  internal-URL treatment the dj bot might need. Mitigation: the Portal can call
  Caddy directly on the LAN for the token/userinfo calls.
- **Scope creep** — forum + calendar + jobs + notifications is a real app. Phase
  it; ship Phase 1–2 and stop to reassess.
- **Maintenance** — it's another service to patch and back up. Fold it into the
  existing SessionEnd backup hook.

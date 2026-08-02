# YouTube Playlist Generator

A React + Express app that builds a **random** YouTube playlist from a set of
channels you choose, filtered by criteria such as date range, most viewed, top
rated, minimum view count, and excluding Shorts. When you're happy with the
selection it creates the playlist on your own YouTube account.

All secrets live on the **server**. The YouTube API key and OAuth client secret
never reach the browser, and each user's OAuth tokens are held in an httpOnly
session cookie — the app is safe to expose on the public internet.

## Architecture

- **Client** (`src/`, built with Vite): the UI. Talks only to the backend under
  `/api`; it holds no secrets.
- **Server** (`server/`, Express): proxies YouTube reads with the server-held API
  key, runs the OAuth 2.0 authorization-code flow (client secret stays server
  side), and performs playlist writes on behalf of the signed-in user.

```
Browser ──/api──▶ Express ──▶ YouTube Data API
                     │
                     └─ OAuth code flow (client secret) ─▶ Google
```

## Prerequisites

A [Google Cloud](https://console.cloud.google.com/) project with the **YouTube
Data API v3** enabled, and:

### 1. API key (server-side reads)

- APIs & Services → **Credentials** → *Create credentials* → **API key**.
- Restrict it to the *YouTube Data API v3*.

### 2. OAuth 2.0 Client ID + Secret (playlist creation)

- APIs & Services → **OAuth consent screen** → configure. Add the scope
  `https://www.googleapis.com/auth/youtube`. While unverified, add each user as a
  **test user** (see "Verification" below).
- APIs & Services → **Credentials** → *Create credentials* → **OAuth client ID**
  → *Web application*.
- Add an **Authorized redirect URI**:
  - Dev: `http://localhost:3173/api/auth/callback`
  - Prod: `https://your-domain/api/auth/callback`

## Configure

Copy `.env.example` to `.env` on the server and fill it in:

```bash
cp .env.example .env
# generate a session secret:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`.env` is git-ignored and is the only place secrets live.

## Run (development)

Runs the API (port 3173) and the Vite dev server (port 5173) together; Vite
proxies `/api` to the backend.

```bash
npm install
npm run dev
```

Open http://localhost:5173/. For OAuth to work in dev, keep
`APP_ORIGIN=http://localhost:5173` and the redirect URI on port 3173 as above.

## Run (production)

Build the client, then start the server, which serves the built SPA and the API
from a single origin. Set `APP_ENV=production` in `.env` first.

```bash
npm install
npm run build
npm start
```

Set `APP_ORIGIN` to your public URL and `OAUTH_REDIRECT_URI` to
`https://your-domain/api/auth/callback`. If TLS is terminated by a reverse proxy,
set `TRUST_PROXY=1` so secure cookies work.

## Deploy on a Raspberry Pi (PM2 + reverse proxy)

This assumes a reverse proxy (e.g. the companion `reverse-proxy` app) terminates
TLS for `https://playlists.drewgourley.com` and forwards to this app's local port
(`3173`), passing the `X-Forwarded-Proto` header.

### 1. Google Cloud OAuth client

Add to the OAuth 2.0 **Web application** client:

- Authorized JavaScript origin: `https://playlists.drewgourley.com`
- Authorized redirect URI: `https://playlists.drewgourley.com/api/auth/callback`

### 2. Clone, configure, build

```bash
git clone <your-repo> playlists && cd playlists
npm install
cp .env.example .env   # then edit .env — see values below
npm run build          # produces dist/, which the server serves
```

Production `.env` values (secrets filled in as usual):

```ini
PORT=3173
APP_ENV=production
APP_ORIGIN=https://playlists.drewgourley.com
OAUTH_REDIRECT_URI=https://playlists.drewgourley.com/api/auth/callback
TRUST_PROXY=1
YT_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=...            # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Start under PM2

```bash
pm2 start ecosystem.config.js
pm2 save                       # persist across reboots (run pm2 startup once)
pm2 logs "YouTube Playlist Generator"
```

### 4. Point the reverse proxy at it

Add a service that maps `playlists.drewgourley.com` → `http://localhost:3173`
and provision its Let's Encrypt certificate.

To deploy updates: `git pull && npm install && npm run build && pm2 restart
"YouTube Playlist Generator"`.

## Security notes

- Secrets (`YT_API_KEY`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) stay in `.env`
  on the server and are never bundled into the client.
- Sessions use httpOnly, SameSite=Lax cookies (secure in production).
- State-changing routes verify the request `Origin` and are rate-limited.
- Requests are size-limited and all channel/criteria input is validated and
  clamped server-side (max 50 channels, max 200 videos per playlist).

## Notes on quota

The YouTube `search.list` call costs 100 quota units and runs once per channel;
the default daily quota is 10,000 units. "Reshuffle" and "remove" re-pick from
the already-fetched pool client-side and cost nothing extra.

## Verification (removing the "unverified app" warning)

While the OAuth consent screen is in **Testing**, only listed test users can sign
in and they'll see an "unverified app" warning (safe to bypass). To make it
public, Google requires app verification for the sensitive `youtube` scope: a
verified domain, a homepage and privacy-policy URL, and a demo video. For a
personal or small-group tool, staying in Testing mode is usually simplest.

## Attribution

This product uses the YouTube API Services. By using it you agree to the
[YouTube Terms of Service](https://www.youtube.com/t/terms) and the
[Google Privacy Policy](https://policies.google.com/privacy).

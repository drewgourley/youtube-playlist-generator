import 'dotenv/config';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { gatherCandidates, publishPlaylist } from './youtube.js';
import {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  fetchMyChannelTitle,
} from './oauth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// APP_ENV (not NODE_ENV) so this can live in .env without affecting the Vite build.
const isProd = (process.env.APP_ENV ?? process.env.NODE_ENV) === 'production';
if (isProd) process.env.NODE_ENV = 'production';

// --- Environment validation (fail fast so .env setup is obvious) ---
const REQUIRED = ['YT_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_REDIRECT_URI', 'SESSION_SECRET'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values before starting.');
  process.exit(1);
}

const PORT = Number(process.env.PORT || 3173);
const APP_ORIGINS = (process.env.APP_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DEV_ORIGINS = isProd ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
const ALLOWED_ORIGINS = new Set([...APP_ORIGINS, ...DEV_ORIGINS]);
const POST_LOGIN_REDIRECT = APP_ORIGINS[0] || '/';

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// The reverse proxy terminates TLS but may not forward X-Forwarded-Proto. In
// production behind a trusted proxy, assume HTTPS so secure session cookies are set.
if (isProd && process.env.TRUST_PROXY) {
  app.use((req, _res, next) => {
    if (!req.headers['x-forwarded-proto']) req.headers['x-forwarded-proto'] = 'https';
    next();
  });
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // Allow YouTube thumbnail/avatar hosts so result images load.
        'img-src': ["'self'", 'data:', 'https://i.ytimg.com', 'https://i9.ytimg.com', 'https://yt3.ggpht.com'],
      },
    },
  }),
);
app.use(express.json({ limit: '64kb' }));
app.use(
  session({
    name: 'ypg.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

// Reject cross-site state-changing requests (defense-in-depth alongside SameSite).
function checkOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin || ALLOWED_ORIGINS.has(origin)) return next();
  return res.status(403).json({ error: 'Cross-origin request rejected.' });
}

const writeLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

// --- Input validation ---
const ORDERS = new Set(['viewCount', 'date', 'rating', 'relevance']);
const PRIVACIES = new Set(['private', 'unlisted', 'public']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CHANNELS = 50;
const MAX_PLAYLIST = 200;

function validateChannels(input) {
  if (!Array.isArray(input)) throw new Error('channels must be an array.');
  const list = input
    .filter((c) => typeof c === 'string')
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, MAX_CHANNELS);
  if (list.length === 0) throw new Error('Add at least one channel.');
  return list;
}

function validateCriteria(input) {
  const c = input && typeof input === 'object' ? input : {};
  const clampInt = (v, lo, hi, dflt) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const date = (v) => (typeof v === 'string' && DATE_RE.test(v) ? v : '');
  return {
    order: ORDERS.has(c.order) ? c.order : 'viewCount',
    publishedAfter: date(c.publishedAfter),
    publishedBefore: date(c.publishedBefore),
    poolPerChannel: clampInt(c.poolPerChannel, 1, 50, 25),
    playlistSize: clampInt(c.playlistSize, 1, MAX_PLAYLIST, 20),
    minViews: clampInt(c.minViews, 0, Number.MAX_SAFE_INTEGER, 0),
    excludeShorts: c.excludeShorts !== false,
  };
}

function validatePlaylistMeta(input) {
  const m = input && typeof input === 'object' ? input : {};
  const title = (typeof m.title === 'string' ? m.title.trim() : '').slice(0, 150) || 'Random Mix';
  const description = (typeof m.description === 'string' ? m.description : '').slice(0, 5000);
  const privacy = PRIVACIES.has(m.privacy) ? m.privacy : 'private';
  return { title, description, privacy };
}

function validateVideoIds(input) {
  if (!Array.isArray(input)) throw new Error('videoIds must be an array.');
  const ids = input
    .filter((v) => typeof v === 'string' && /^[\w-]{11}$/.test(v))
    .slice(0, MAX_PLAYLIST);
  if (ids.length === 0) throw new Error('No valid video ids provided.');
  return ids;
}

// Returns a valid access token for the session, refreshing if needed.
async function getAccessToken(req) {
  const tokens = req.session.tokens;
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) return null;
  const refreshed = await refreshAccessToken(tokens.refreshToken);
  tokens.accessToken = refreshed.accessToken;
  tokens.expiresAt = refreshed.expiresAt;
  return tokens.accessToken;
}

// --- Auth routes ---
app.get('/api/auth/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  console.log('OAuth login: secure=%s xfProto=%s', req.secure, req.get('x-forwarded-proto'));
  res.redirect(buildAuthUrl(state));
});

app.get('/api/auth/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      console.error('OAuth callback: provider error:', error);
      return res.redirect(`${POST_LOGIN_REDIRECT}?auth=error`);
    }
    if (!code || !state || state !== req.session.oauthState) {
      console.error('OAuth callback: state check failed', {
        hasCode: !!code,
        hasState: !!state,
        hasSessionState: !!req.session.oauthState,
        stateMatches: state === req.session.oauthState,
      });
      return res.redirect(`${POST_LOGIN_REDIRECT}?auth=error`);
    }
    delete req.session.oauthState;
    const tokens = await exchangeCode(String(code));
    req.session.tokens = tokens;
    req.session.channelTitle = await fetchMyChannelTitle(tokens.accessToken);
    res.redirect(`${POST_LOGIN_REDIRECT}?auth=ok`);
  } catch (e) {
    console.error('OAuth callback error:', e.message);
    res.redirect(`${POST_LOGIN_REDIRECT}?auth=error`);
  }
});

app.get('/api/auth/status', (req, res) => {
  res.json({
    signedIn: !!req.session.tokens,
    channelTitle: req.session.channelTitle ?? null,
  });
});

app.post('/api/auth/logout', checkOrigin, async (req, res) => {
  const token = req.session.tokens?.refreshToken || req.session.tokens?.accessToken;
  if (token) await revokeToken(token);
  req.session.destroy(() => res.json({ ok: true }));
});

// --- Data routes ---
app.post('/api/generate', checkOrigin, writeLimiter, async (req, res) => {
  try {
    const channels = validateChannels(req.body?.channels);
    const criteria = validateCriteria(req.body?.criteria);
    const videos = await gatherCandidates(channels, criteria, process.env.YT_API_KEY);
    res.json({ videos });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/playlists', checkOrigin, writeLimiter, async (req, res) => {
  try {
    const token = await getAccessToken(req);
    if (!token) return res.status(401).json({ error: 'Not signed in.' });
    const videoIds = validateVideoIds(req.body?.videoIds);
    const meta = validatePlaylistMeta(req.body?.meta);
    const result = await publishPlaylist(videoIds, meta, token);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- Static SPA (production) ---
const distDir = path.resolve(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} (${isProd ? 'production' : 'development'})`);
});

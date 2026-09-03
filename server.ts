import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { INITIAL_ACCOUNTS, INITIAL_ACTIVITIES } from './src/data/initialAccounts';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

// Every /api/* response carries per-session data (auth state, accounts,
// activities). Some hosting setups sit behind a CDN/reverse-proxy that will
// cache a GET response by URL alone and happily serve that cached copy to a
// completely different browser/session — which looks exactly like "data
// from another device/session leaking into mine" or "my new data never
// shows up elsewhere". These headers explicitly forbid that at every layer
// (browser, any intermediate proxy, and CDNs that respect Cache-Control).
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Cookie');
  next();
});

// ---- Dashboard login (protects the whole app, not Reddit itself) ----
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
let SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET) {
  console.warn(
    '[Auth] SESSION_SECRET is not set in .env — using a random secret generated at startup. ' +
    'This means everyone will be logged out every time the server restarts. Set SESSION_SECRET in .env to fix this.'
  );
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
}
if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.warn(
    '[Auth] ADMIN_USERNAME / ADMIN_PASSWORD are not set in .env — login is DISABLED and the dashboard ' +
    'is open to anyone who can reach this server. Set both in .env to require a login.'
  );
}
const SESSION_COOKIE_NAME = 'ln_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = decodeURIComponent(pair.slice(idx + 1).trim());
    if (key) out[key] = val;
  });
  return out;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function signValue(value: string): string {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${sig}`;
}

function unsignValue(signed: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  return value;
}

function createSessionToken(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + SESSION_MAX_AGE_MS })
  ).toString('base64url');
  return signValue(payload);
}

function verifySessionToken(token: string): { username: string } | null {
  const payload = unsignValue(token);
  if (!payload) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp || !data.u) return null;
    return { username: data.u };
  } catch {
    return null;
  }
}

function getSessionFromRequest(req: express.Request): { username: string } | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token);
}

// Basic brute-force protection: lock an IP out after 5 bad attempts within 15 min
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

function isLockedOut(ip: string): boolean {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordFailedAttempt(ip: string) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() - entry.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAttempt: Date.now() });
  } else {
    entry.count += 1;
  }
}

function clearFailedAttempts(ip: string) {
  loginAttempts.delete(ip);
}

// Protects any route it's applied to — returns 401 if there's no valid session.
// If ADMIN_USERNAME/ADMIN_PASSWORD aren't configured, auth is treated as disabled
// (so the app still works out of the box), but a console warning is printed above.
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return next();
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
  }
  next();
}

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return res.status(400).json({
      success: false,
      message: 'Login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in the server .env file.',
    });
  }

  if (isLockedOut(ip)) {
    return res.status(429).json({
      success: false,
      message: 'Too many failed attempts. Try again in 15 minutes.',
    });
  }

  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  const validUsername = timingSafeStringEqual(username, ADMIN_USERNAME);
  const validPassword = timingSafeStringEqual(password, ADMIN_PASSWORD);

  if (!validUsername || !validPassword) {
    recordFailedAttempt(ip);
    return res.status(401).json({ success: false, message: 'Incorrect username or password.' });
  }

  clearFailedAttempts(ip);
  const token = createSessionToken(username);
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}; SameSite=Lax${secureFlag}`
  );
  res.json({ success: true, username });
});

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return res.json({ authenticated: true, authDisabled: true, username: null });
  }
  const session = getSessionFromRequest(req);
  if (!session) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: session.username });
});

// In-memory cache for Reddit user data to stay within rate limits
interface CacheEntry {
  timestamp: number;
  data: any;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 45 * 1000; // 45 seconds cache

const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || '';
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || '';
const REDDIT_USER_AGENT =
  process.env.REDDIT_USER_AGENT || 'web:litnuke-x-anuma-tracker:1.0.0 (by /u/your_reddit_username)';
const HAS_OAUTH_CREDENTIALS = Boolean(REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET);

// ---- OAuth (application-only / client_credentials) token handling ----
// oauth.reddit.com is far less likely to be Cloudflare-blocked than the
// public www.reddit.com/*.json endpoints, which Reddit increasingly blocks
// for non-browser / datacenter traffic (this is the source of "403: Blocked").
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getAppOnlyAccessToken(): Promise<string | null> {
  if (!HAS_OAUTH_CREDENTIALS) return null;
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.accessToken;
  }

  const basicAuth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': REDDIT_USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    console.warn(`[Reddit OAuth] Token request failed: ${response.status} ${response.statusText}`);
    return null;
  }

  const json = await response.json();
  if (!json.access_token) return null;

  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

// Helper to fetch from Reddit. Tries OAuth (oauth.reddit.com) first when
// credentials are configured, then falls back to the public JSON endpoint.
async function fetchRedditEndpoint(endpoint: string) {
  // Path 1: authenticated OAuth API (preferred, much less likely to be blocked)
  if (HAS_OAUTH_CREDENTIALS) {
    try {
      const token = await getAppOnlyAccessToken();
      if (token) {
        const oauthUrl = `https://oauth.reddit.com${endpoint.replace(/\.json(\?|$)/, '$1')}`;
        const response = await fetch(oauthUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': REDDIT_USER_AGENT,
            'Accept': 'application/json',
          },
        });
        if (response.ok) {
          return await response.json();
        }
        if (response.status === 404) {
          throw new Error('NOT_FOUND');
        }
        console.warn(`[Reddit OAuth] ${oauthUrl} responded ${response.status}, falling back to public endpoint.`);
      }
    } catch (err: any) {
      if (err.message === 'NOT_FOUND') throw err;
      console.warn('[Reddit OAuth] Request failed, falling back to public endpoint:', err.message);
    }
  }

  // Path 2: public JSON endpoint (no auth required, but frequently rate-limited/blocked)
  const url = `https://www.reddit.com${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': REDDIT_USER_AGENT,
      'Accept': 'application/json',
    },
  });

  if (response.status === 404) {
    throw new Error('NOT_FOUND');
  }
  if (response.status === 403 || response.status === 429) {
    throw new Error(
      HAS_OAUTH_CREDENTIALS
        ? `Reddit rejected the request (${response.status}). Try again in a moment.`
        : `Reddit blocked the unauthenticated request (${response.status}). Register a Reddit App at reddit.com/prefs/apps and set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env for a much more stable connection.`
    );
  }
  if (!response.ok) {
    throw new Error(`Reddit API responded with status ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'LitNuke X ANUMA Tracker', time: new Date().toISOString() });
});

// ---- Server-side data persistence (accounts & activities) ----
// Previously this data lived only in the browser's localStorage, which is
// scoped per-browser/device — switching browsers or devices meant the app
// looked "empty" and fell back to the built-in sample data. Storing it here
// instead means every browser hitting this same server sees the same data.
//
// NOTE: this writes to a local JSON file on disk. On most containerized
// hosts (including Railway without a mounted Volume) the filesystem is
// reset on every redeploy — this survives server restarts within the same
// deployment, but NOT a fresh deploy. For that, mount a persistent Volume
// at DATA_DIR, or swap this for a real database.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[Data] Failed to read ${filePath}, using fallback:`, err);
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: unknown) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

app.get('/api/data/accounts', requireAuth, (_req, res) => {
  const accounts = readJsonFile(ACCOUNTS_FILE, INITIAL_ACCOUNTS);
  res.json({ success: true, accounts });
});

app.post('/api/data/accounts', requireAuth, (req, res) => {
  const accounts = req.body;
  if (!Array.isArray(accounts)) {
    return res.status(400).json({ success: false, message: 'accounts must be an array.' });
  }
  try {
    writeJsonFile(ACCOUNTS_FILE, accounts);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Data] Failed to save accounts:', err);
    res.status(500).json({ success: false, message: 'Failed to save accounts on the server.' });
  }
});

app.get('/api/data/activities', requireAuth, (_req, res) => {
  const activities = readJsonFile(ACTIVITIES_FILE, INITIAL_ACTIVITIES);
  res.json({ success: true, activities });
});

app.post('/api/data/activities', requireAuth, (req, res) => {
  const activities = req.body;
  if (!Array.isArray(activities)) {
    return res.status(400).json({ success: false, message: 'activities must be an array.' });
  }
  try {
    writeJsonFile(ACTIVITIES_FILE, activities);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Data] Failed to save activities:', err);
    res.status(500).json({ success: false, message: 'Failed to save activities on the server.' });
  }
});

// Fetch Reddit user profile info
app.get('/api/reddit/user/:username/about', requireAuth, async (req, res) => {
  const cleanUsername = req.params.username.replace(/^(u\/|r\/|@)/, '').trim();
  const cacheKey = `about:${cleanUsername.toLowerCase()}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json({ success: true, source: 'cache', data: cached.data });
  }

  try {
    const json = await fetchRedditEndpoint(`/user/${cleanUsername}/about.json`);
    const userData = json?.data;
    if (!userData) {
      return res.status(404).json({ success: false, message: 'Reddit account not found.' });
    }

    const cleanData = {
      username: userData.name,
      totalKarma: userData.total_karma || (userData.link_karma + userData.comment_karma) || 0,
      postKarma: userData.link_karma || 0,
      commentKarma: userData.comment_karma || 0,
      createdUtc: userData.created_utc || 0,
      avatarUrl: userData.icon_img ? userData.icon_img.split('?')[0] : null,
      isVerified: userData.verified || false,
      isSuspended: userData.is_suspended || false,
    };

    cache.set(cacheKey, { timestamp: Date.now(), data: cleanData });
    res.json({ success: true, source: 'live', data: cleanData });
  } catch (error: any) {
    console.warn(`[Reddit Proxy] Could not fetch user about for ${cleanUsername}:`, error.message);
    const message = error.message === 'NOT_FOUND'
      ? `u/${cleanUsername} not found on Reddit.`
      : (error.message || 'Failed to fetch the live Reddit profile.');
    res.status(200).json({
      success: false,
      message,
      fallback: true,
    });
  }
});

// Fetch Reddit user activities (submissions & comments)
app.get('/api/reddit/user/:username/activity', requireAuth, async (req, res) => {
  const cleanUsername = req.params.username.replace(/^(u\/|r\/|@)/, '').trim();
  const cacheKey = `activity:${cleanUsername.toLowerCase()}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json({ success: true, source: 'cache', items: cached.data });
  }

  try {
    const [overviewData, aboutData] = await Promise.allSettled([
      fetchRedditEndpoint(`/user/${cleanUsername}/overview.json?limit=25&sort=new`),
      fetchRedditEndpoint(`/user/${cleanUsername}/about.json`),
    ]);

    let rawChildren: any[] = [];
    if (overviewData.status === 'fulfilled' && overviewData.value?.data?.children) {
      rawChildren = overviewData.value.data.children;
    }

    const items = rawChildren.map((item: any) => {
      const kind = item.kind; // 't3' is Link/Post, 't1' is Comment
      const d = item.data;
      const isPost = kind === 't3';

      return {
        id: d.name || `reddit-${d.id}`,
        username: d.author || cleanUsername,
        type: isPost ? 'post' : 'comment',
        title: isPost ? d.title : undefined,
        parentTitle: !isPost ? d.link_title : undefined,
        body: isPost ? (d.selftext || d.title) : d.body,
        subreddit: d.subreddit_name_prefixed || `r/${d.subreddit}`,
        score: d.score ?? 1,
        upvoteRatio: d.upvote_ratio ?? 1,
        numComments: d.num_comments ?? 0,
        createdUtc: d.created_utc || Math.floor(Date.now() / 1000),
        permalink: d.permalink ? `https://reddit.com${d.permalink}` : `https://reddit.com/user/${cleanUsername}`,
        url: d.url || (d.permalink ? `https://reddit.com${d.permalink}` : undefined),
      };
    });

    let userInfo = null;
    if (aboutData.status === 'fulfilled' && aboutData.value?.data) {
      const u = aboutData.value.data;
      userInfo = {
        username: u.name,
        totalKarma: u.total_karma || (u.link_karma + u.comment_karma) || 0,
        postKarma: u.link_karma || 0,
        commentKarma: u.comment_karma || 0,
        createdUtc: u.created_utc || 0,
        avatarUrl: u.icon_img ? u.icon_img.split('?')[0] : null,
      };
    }

    const responsePayload = { items, userInfo };
    cache.set(cacheKey, { timestamp: Date.now(), data: responsePayload });

    res.json({ success: true, source: 'live', ...responsePayload });
  } catch (error: any) {
    console.warn(`[Reddit Proxy] Error fetching activity for ${cleanUsername}:`, error.message);
    res.status(200).json({
      success: false,
      message: error.message || 'Failed to load the Reddit feed.',
      items: [],
      fallback: true,
    });
  }
});

// Setup Vite development middleware or production static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LitNuke X ANUMA] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

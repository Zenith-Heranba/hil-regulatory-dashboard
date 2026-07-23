const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const { EDITABLE_FIELDS } = require('./lib/rowid');

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy; needed for secure cookies

const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-railway-env-vars';
const INGEST_API_KEY = process.env.INGEST_API_KEY || '';

if (!VIEWER_PASSWORD || !ADMIN_PASSWORD) {
  console.warn('WARNING: VIEWER_PASSWORD / ADMIN_PASSWORD not set — set them in Railway env vars before sharing the link.');
}

app.use(express.json({ limit: '25mb' })); // daily ingest payload can be a few hundred KB
app.use(cookieSession({
  name: 'hil_session',
  keys: [SESSION_SECRET],
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  if (req.session && (req.session.role === 'viewer' || req.session.role === 'admin')) return next();
  return res.status(401).json({ error: 'Not logged in' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}
function requireIngestKey(req, res, next) {
  if (!INGEST_API_KEY) return res.status(500).json({ error: 'INGEST_API_KEY not configured on server' });
  const key = req.get('x-ingest-key');
  if (!key || !timingSafeEqual(key, INGEST_API_KEY)) return res.status(401).json({ error: 'Invalid ingest key' });
  return next();
}

app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (ADMIN_PASSWORD && timingSafeEqual(password || '', ADMIN_PASSWORD)) {
    req.session.role = 'admin';
    return res.json({ role: 'admin' });
  }
  if (VIEWER_PASSWORD && timingSafeEqual(password || '', VIEWER_PASSWORD)) {
    req.session.role = 'viewer';
    return res.json({ role: 'viewer' });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/session', requireAuth, (req, res) => {
  res.json({ role: req.session.role });
});

app.get('/api/data', requireAuth, (req, res) => {
  const merged = store.getMerged();
  merged.meta._role = req.session.role;
  res.json(merged);
});

app.post('/api/data/edit', requireAdmin, async (req, res) => {
  const { table, id, field, value } = req.body || {};
  if (!table || !id || !field) return res.status(400).json({ error: 'table, id and field are required' });
  try {
    await store.setOverride(table, id, field, value, req.session.role);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/data/reset', requireAdmin, async (req, res) => {
  const { table } = req.body || {};
  await store.clearOverrides(table);
  res.json({ ok: true });
});

// Called by the scheduled daily-sync task (protected by an API key, not a session,
// since it's a machine-to-machine call from outside a browser).
app.post('/api/data/ingest', requireIngestKey, async (req, res) => {
  const newBase = req.body;
  if (!newBase || !newBase.completed_registrations || !newBase.data_generation || !newBase.completeness_matrix) {
    return res.status(400).json({ error: 'Payload does not look like a valid dataset (missing expected top-level keys)' });
  }
  await store.setBase(newBase);
  res.json({ ok: true, rowCounts: store.rowCounts(newBase), overridesCount: store.overridesCount() });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HIL dashboard server listening on :${PORT}`));

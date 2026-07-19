require('./loadenv');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;
const FX = Number(process.env.FX_KES_PER_USD) || 129;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const COOKIE = 'gweno_admin';
const TTL_MS = 4 * 60 * 60 * 1000; // 4-hour admin session
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rid = (n) => crypto.randomBytes(n).toString('hex');
const eq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Serverless: wait for storage, reload fresh state for /api reads, flush writes before responding.
const dbReady = Promise.resolve(db.init()).catch((e) => console.error('[admin] init failed:', e && e.message));
const ON_VERCEL = !!process.env.VERCEL;
app.use(async (req, res, next) => {
  try { await dbReady; } catch (_) {}
  if (ON_VERCEL && req.path.startsWith('/api')) {
    if (db.reload) { try { await db.reload(); } catch (_) {} }
    if (db.flush) {
      for (const name of ['json', 'send', 'end']) {
        const orig = res[name].bind(res);
        res[name] = (...args) => { db.flush().finally(() => orig(...args)); return res; };
      }
    }
  }
  next();
});

// ---------- admin session ----------
function S() { const s = db.get(); s.adminSessions = s.adminSessions || []; return s; }
function currentAdmin(req) {
  const t = req.cookies[COOKIE]; if (!t) return null;
  const s = S();
  const sess = s.adminSessions.find((x) => x.token === t);
  if (!sess) return null;
  if (new Date(sess.expiresAt).getTime() < Date.now()) {
    s.adminSessions = s.adminSessions.filter((x) => x.token !== t); db.save(); return null;
  }
  return sess;
}
function requireAdmin(req, res, next) { if (!currentAdmin(req)) return res.status(401).json({ error: 'Not signed in.' }); next(); }

app.get('/api/session', (req, res) => res.json({ authed: !!currentAdmin(req), configured: !!ADMIN_PASSWORD, username: ADMIN_USERNAME }));
app.post('/api/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: 'Admin not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD.' });
  const { username, password } = req.body || {};
  if (!eq(username || '', ADMIN_USERNAME) || !eq(password || '', ADMIN_PASSWORD)) return res.status(401).json({ error: 'Invalid username or password.' });
  const token = rid(24);
  const s = S();
  s.adminSessions.push({ token, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TTL_MS).toISOString() });
  db.save();
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: TTL_MS });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  const t = req.cookies[COOKIE];
  if (t) { const s = S(); s.adminSessions = s.adminSessions.filter((x) => x.token !== t); db.save(); }
  res.clearCookie(COOKIE); res.json({ ok: true });
});

// ---------- helpers ----------
const users = () => db.get().users || [];
const userById = (id) => users().find((u) => u.id === id);
const providerOf = (u) => (u.providers && u.providers.length ? u.providers.join(', ') : 'email');

// ---------- overview ----------
app.get('/api/overview', requireAdmin, (req, res) => {
  const s = db.get();
  const subs = s.submissions || [], reds = s.redemptions || [], invs = s.investments || [], deps = s.deposits || [];
  res.json({
    admin: ADMIN_USERNAME,
    users: users().length,
    suspended: users().filter((u) => u.suspended).length,
    submissions: { total: subs.length, pending: subs.filter((x) => x.status === 'pending').length, approved: subs.filter((x) => x.status === 'approved').length },
    withdrawals: { pending: reds.filter((r) => /requested|processing/i.test(r.status || '')).length, total: reds.length, valueUSD: round2(reds.filter((r) => /requested|processing/i.test(r.status || '')).reduce((a, r) => a + (r.amountUSD != null ? r.amountUSD : r.amount) || 0, 0)) },
    investments: { active: invs.filter((i) => i.status === 'active').length, total: invs.length, principalUSD: round2(invs.reduce((a, i) => a + (i.principal || 0), 0)) },
    deposits: { total: deps.length, success: deps.filter((d) => /success|paid/i.test(d.status || '')).length },
    support: (s.support || []).length,
  });
});

// ---------- users ----------
app.get('/api/users', requireAdmin, (req, res) => {
  const list = users().map((u) => ({
    id: u.id, name: u.name, email: u.email, username: u.username,
    provider: providerOf(u),                 // how they signed up: email / google / facebook / apple
    balanceKES: round2(u.balance || 0), usd: round2(u.usd || 0),
    referralCount: u.referralCount || 0, createdAt: u.createdAt, isAdmin: !!u.isAdmin,
    suspended: !!u.suspended, onboarded: !!u.onboarded,
    country: (u.profile && u.profile.country) || '', phone: (u.profile && u.profile.phone) || '',
  })).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ users: list });
});
app.post('/api/users/:id/suspend', requireAdmin, (req, res) => {
  const u = userById(req.params.id); if (!u) return res.status(404).json({ error: 'User not found.' });
  u.suspended = !u.suspended;
  if (u.suspended) { const s = db.get(); s.sessions = (s.sessions || []).filter((x) => x.userId !== u.id); } // sign them out
  db.save();
  res.json({ ok: true, suspended: u.suspended });
});
app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const s = db.get(); const u = userById(req.params.id); if (!u) return res.status(404).json({ error: 'User not found.' });
  s.users = (s.users || []).filter((x) => x.id !== u.id);
  s.sessions = (s.sessions || []).filter((x) => x.userId !== u.id);
  s.submissions = (s.submissions || []).filter((x) => x.userId !== u.id);
  s.investments = (s.investments || []).filter((x) => x.userId !== u.id);
  s.redemptions = (s.redemptions || []).filter((x) => x.userId !== u.id);
  s.deposits = (s.deposits || []).filter((x) => x.userId !== u.id);
  db.save();
  res.json({ ok: true });
});

// ---------- submissions (task proofs) ----------
app.get('/api/submissions', requireAdmin, (req, res) => {
  const subs = (db.get().submissions || []).map((sm) => { const u = userById(sm.userId); return { ...sm, user: u ? { username: u.username, email: u.email } : null }; })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ submissions: subs });
});
app.post('/api/submissions/:id/decision', requireAdmin, (req, res) => {
  const decision = String(req.body.decision || '');
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
  const sm = (db.get().submissions || []).find((x) => x.id === req.params.id);
  if (!sm) return res.status(404).json({ error: 'Submission not found.' });
  const prev = sm.status; sm.status = decision; sm.reviewedAt = new Date().toISOString();
  if (decision === 'approved' && prev !== 'approved') { const u = userById(sm.userId); if (u) u.usd = round2((u.usd || 0) + (sm.reward || 0)); }
  db.save();
  res.json({ ok: true });
});

// ---------- withdrawals ----------
app.get('/api/redemptions', requireAdmin, (req, res) => {
  const reds = (db.get().redemptions || []).map((r) => { const u = userById(r.userId); return { ...r, user: u ? { username: u.username, email: u.email } : null }; })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ redemptions: reds });
});
app.post('/api/redemptions/:id/mark', requireAdmin, (req, res) => {
  const status = String(req.body.status || '');
  if (!['Paid', 'Failed'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const r = (db.get().redemptions || []).find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Withdrawal not found.' });
  const held = r.amountUSD != null ? r.amountUSD : r.amount;
  if (status === 'Failed' && r.status !== 'Failed') { const u = userById(r.userId); if (u) u.usd = round2((u.usd || 0) + held); } // refund the hold
  r.status = status; r.reviewedAt = new Date().toISOString();
  db.save();
  res.json({ ok: true });
});

// ---------- deposits ----------
app.get('/api/deposits', requireAdmin, (req, res) => {
  const deps = (db.get().deposits || []).map((d) => { const u = userById(d.userId); return { ...d, user: u ? { username: u.username, email: u.email } : null }; })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json({ deposits: deps });
});

// ---------- investments ----------
app.get('/api/investments', requireAdmin, (req, res) => {
  const invs = (db.get().investments || []).map((i) => { const u = userById(i.userId); return { ...i, user: u ? { username: u.username, email: u.email } : null }; })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const active = invs.filter((i) => i.status === 'active');
  res.json({ investments: invs, rates: db.get().investmentRates || {}, stats: { total: invs.length, active: active.length, principalUSD: round2(invs.reduce((a, i) => a + (i.principal || 0), 0)) } });
});
app.post('/api/investment-rates', requireAdmin, (req, res) => {
  const s = db.get(); s.investmentRates = s.investmentRates || {};
  for (const k of ['starter', 'growth', 'premium']) {
    const v = req.body[k]; if (v === undefined || v === '') continue;
    const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ error: `Enter a valid rate (0–100%) for ${k}.` });
    s.investmentRates[k] = n;
  }
  db.save();
  res.json({ ok: true, rates: s.investmentRates });
});

// ---------- support ----------
app.get('/api/support', requireAdmin, (req, res) => res.json({ tickets: (db.get().support || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) }));

// ---------- export (download a sanitised snapshot — no password hashes or tokens) ----------
app.get('/api/export', requireAdmin, (req, res) => {
  const s = db.get();
  const out = {
    exportedAt: new Date().toISOString(),
    users: (s.users || []).map(({ passwordHash, ...rest }) => rest),
    submissions: s.submissions || [], redemptions: s.redemptions || [], deposits: s.deposits || [],
    investments: s.investments || [], investmentRates: s.investmentRates || {}, support: s.support || [],
  };
  res.setHeader('Content-Disposition', `attachment; filename="gweno-export-${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(out, null, 2));
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  dbReady.then(() => app.listen(PORT, () => console.log(`\n  Gweno admin -> http://localhost:${PORT}\n`)));
}
module.exports = app;

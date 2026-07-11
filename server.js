/**
 * Gweno — auth server for a freelancing marketplace.
 *
 * Focus of this project: the Welcome (home) screen and the sign-up / sign-in flow.
 * Four security problems are explicitly handled (see labelled sections below):
 *   1. Wrong password        -> generic error + failed-attempt lockout (anti brute-force)
 *   2. Duplicate email signup -> one account per (normalized) email, incl. social login
 *   3. Password-reset abuse   -> single-use, expiring, rate-limited, hashed reset tokens
 *   4. Never-expiring session -> every session has a server-side expiry that is enforced
 */
require('./loadenv'); // must run before payments.js reads process.env
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const db = require('./db');
const tasksMod = require('./tasks');
const surveysMod = require('./surveys');
const investmentsMod = require('./investments');
const { currencyFor } = require('./currencies');
const payments = require('./payments');
const mailer = require('./mailer');
const oauth = require('./oauth');
const { TASKS } = tasksMod;

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Tunable security policy ------------------------------------------------
const SESSION_TTL_MS = 60 * 60 * 1000;          // #4 sessions live 1 hour, then expire
const LOGIN_MAX_ATTEMPTS = 5;                    // #1 lock after this many bad passwords
const LOGIN_LOCK_MS = 15 * 60 * 1000;           // #1 lockout duration
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;      // #3 reset link valid for 30 min
const RESET_MAX_REQUESTS = 3;                    // #3 max reset emails ...
const RESET_WINDOW_MS = 60 * 60 * 1000;         // #3 ... per email per hour
const BCRYPT_ROUNDS = 12;
const COOKIE = 'gweno_session';

// ---- Members-area policy ----------------------------------------------------
const REF_BONUS_KES = 5;                                 // paid per successful referral
const PAYMENT_METHODS = ['M-Pesa', 'PayPal', 'Bank account']; // WITHDRAWAL destinations (legacy)
const SETTINGS_PAYMENT_METHODS = ['M-Pesa', 'Card', 'PayPal', 'Bank account', 'Apple Pay', 'Stripe']; // saved in Settings
const DEPOSIT_METHODS = ['M-Pesa', 'Card', 'PayPal', 'Bank account', 'Paystack']; // top-up methods
const WITHDRAW_METHODS = ['M-Pesa', 'PayPal', 'Stripe', 'Apple Pay', 'Card']; // cash-out methods (USD)
const INVEST_METHODS = ['Card', 'Stripe', 'PayPal', 'M-Pesa', 'Paystack'];      // fund an investment (USD)
// Which invest payment methods have their keys in .env (else the method is offered
// but returns a clear "add your keys" message when chosen). 'Card' is processed by Stripe.
const investPay = require('./investPay');
function investMethodConfigured(method) {
  if (method === 'M-Pesa') return payments.mpesaStkConfigured();
  if (method === 'Stripe' || method === 'Card') return investPay.stripeConfigured();
  if (method === 'PayPal') return investPay.paypalConfigured();
  if (method === 'Paystack') return investPay.paystackConfigured();
  return false;
}
const investMethodsInfo = () => INVEST_METHODS.map((key) => ({ key, configured: investMethodConfigured(key) }));
const USERNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;   // username changeable once / 30 days
const MIN_REDEEM = { KES: 10, USD: 0.5 };       // demo-friendly; raise for production
const DEPOSIT_MIN_KES = 10;                              // DEPOSITS via M-Pesa STK Push (KES)
const FX_KES_PER_USD = Number(process.env.FX_KES_PER_USD) || 129; // conversion rate (configurable)
const SUBSCRIPTION_USD = 10;                            // Premium unlocks $1–$4 tasks
const SUBSCRIPTION_DAYS = 30;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const SURVEY_DONE = 'surveysDone';

// Separate admin credentials — NOT a client account. Set these in .env.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_COOKIE = 'gweno_admin';
const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // admin sessions expire after 2h

app.set('trust proxy', 1); // trust the first proxy (correct client IPs when deployed)
app.use(express.json({ limit: '2mb' })); // room for base64 avatar uploads
app.use(express.urlencoded({ extended: false })); // Apple OAuth returns via form_post
app.use(cookieParser());

// ---- Security headers (clickjacking, MIME-sniffing, XSS defense-in-depth) ----
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src 'self' data: https://api.qrserver.com; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; " +
    "form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// ---- Lightweight request logging (API + any error responses) ----
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api') || res.statusCode >= 400) {
      console.log(`${new Date().toISOString()} ${req.ip} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    }
  });
  next();
});

// ---- Rate limiting per IP on the API ----
const rlBuckets = new Map();
const RL_WINDOW_MS = 60 * 1000;
const RL_MAX = 200; // requests / minute / IP
setInterval(() => { const t = now(); for (const [k, v] of rlBuckets) if (v.reset < t) rlBuckets.delete(k); }, 5 * 60 * 1000).unref();
app.use('/api', (req, res, next) => {
  const ip = req.ip || 'unknown';
  const t = Date.now();
  let b = rlBuckets.get(ip);
  if (!b || b.reset < t) { b = { count: 0, reset: t + RL_WINDOW_MS }; rlBuckets.set(ip, b); }
  b.count += 1;
  if (b.count > RL_MAX) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
  }
  next();
});

// ---- Same-origin only: reject cross-site API calls (server-to-server callbacks have no Origin) ----
app.use('/api', (req, res, next) => {
  // OAuth provider callbacks and payment webhooks legitimately arrive cross-origin.
  if (req.path.startsWith('/oauth/') || req.path.startsWith('/mpesa/')) return next();
  const origin = req.headers.origin;
  if (origin) {
    let oHost;
    try { oHost = new URL(origin).host; } catch (_) { return res.status(403).json({ error: 'Invalid origin.' }); }
    if (oHost !== req.headers.host) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Make sure the newer collections exist even on an old store file.
(function initCollections() {
  const S = db.get();
  S.submissions = S.submissions || [];
  S.campaigns = S.campaigns || [];
  S.redemptions = S.redemptions || [];
  S.support = S.support || [];
  S.deposits = S.deposits || [];
  S.devices = S.devices || []; // #5 one account per device (fingerprint tombstones)
  S.adminSessions = S.adminSessions || []; // separate admin login sessions
  S.investments = S.investments || []; // member investments
  S.investmentRates = S.investmentRates || {}; // admin per-plan interest-rate overrides
})();

// ---- Helpers ----------------------------------------------------------------
const now = () => Date.now();
const normEmail = (e) => String(e || '').trim().toLowerCase();
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const rid = (n = 16) => crypto.randomBytes(n).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must include a letter and a number.';
  return null;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const newRefCode = () => crypto.randomBytes(5).toString('hex'); // 10-char single-use code
const isPremium = (u) => !!(u && u.premium && u.premium.active && (!u.premium.expires || new Date(u.premium.expires).getTime() > now()));
const grantPremium = (u) => { const iso = new Date().toISOString(); u.premium = { active: true, since: iso, expires: new Date(now() + SUBSCRIPTION_DAYS * 86400000).toISOString() }; };

// #5 — one account per device. A used fingerprint stays a tombstone even after
// the account is deleted, so the same device can't register again.
// Toggle off with DEVICE_LIMIT=off in .env (handy while testing on one machine).
const DEVICE_LIMIT = (process.env.DEVICE_LIMIT || 'on').toLowerCase() !== 'off';
const deviceRecord = (fp) => db.get().devices.find((d) => d.fingerprint === fp) || null;
const deviceBlocked = (fp) => { if (!DEVICE_LIMIT) return false; const d = deviceRecord(fp); return !!(d && d.used); };
function registerDevice(fp, userId) {
  if (!fp) return;
  const d = deviceRecord(fp);
  if (d) { d.used = true; if (!d.userIds.includes(userId)) d.userIds.push(userId); }
  else db.get().devices.push({ fingerprint: fp, used: true, userIds: [userId], createdAt: new Date().toISOString() });
}
const userById = (id) => db.get().users.find((u) => u.id === id) || null;
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

function usernameProblem(username) {
  if (!/^[a-zA-Z0-9]{6,10}$/.test(username || '')) {
    return 'Username must be 6–10 characters, letters and numbers only.';
  }
  return null;
}
function usernameTaken(username, exceptId) {
  const lo = String(username).toLowerCase();
  return db.get().users.some((u) => u.username && u.username.toLowerCase() === lo && u.id !== exceptId);
}
function genUsername(base) {
  let b = String(base || 'user').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (b.length < 6) b = (b + 'user00').slice(0, 6);
  let candidate = b.slice(0, 10);
  let i = 0;
  while (usernameTaken(candidate)) {
    i += 1;
    const suffix = String(i);
    candidate = (b.slice(0, Math.max(6, 10 - suffix.length)) + suffix).slice(0, 10);
  }
  return candidate;
}

// Backfill fields on older accounts + keep the referral link single-use.
function ensureUserShape(u) {
  if (!u) return u;
  if (u.usd == null) u.usd = 0;
  if (u.balance == null) u.balance = 0;
  if (!u.profile) u.profile = {};
  // A used referral link is replaced by a fresh one next time the owner loads it.
  if (!u.referral || !u.referral.code || u.referral.used) u.referral = { code: newRefCode(), used: false };
  if (u.referralEarningsKES == null) u.referralEarningsKES = 0;
  if (u.referralCount == null) u.referralCount = 0;
  if (!u.notifications) u.notifications = { newTasks: true, account: true, promotions: false };
  if (!u.payment) u.payment = { method: '', details: '' };
  if (u.avatar === undefined) u.avatar = null;
  if (u.usernameChangedAt === undefined) u.usernameChangedAt = null;
  if (!u[SURVEY_DONE]) u[SURVEY_DONE] = [];
  if (!u.premium) u.premium = { active: false, since: null, expires: null };
  return u;
}

// Credit the referrer 5 KES and burn their single-use link.
function creditReferral(refCode, newUser) {
  const code = String(refCode || '').trim();
  if (!code) return;
  const owner = db.get().users.find((u) => u.referral && u.referral.code === code && !u.referral.used && u.id !== newUser.id);
  if (!owner) return;
  owner.referral.used = true;
  owner.balance = round2((owner.balance || 0) + REF_BONUS_KES);
  owner.referralEarningsKES = round2((owner.referralEarningsKES || 0) + REF_BONUS_KES);
  owner.referralCount = (owner.referralCount || 0) + 1;
  newUser.referredBy = owner.id;
}

function publicUser(u) {
  ensureUserShape(u);
  return {
    id: u.id, name: u.name, email: u.email, username: u.username || null,
    providers: u.providers, createdAt: u.createdAt, onboarded: !!u.onboarded,
    balance: round2(u.balance), usd: round2(u.usd), profile: u.profile || {},
    referral: { code: u.referral.code, count: u.referralCount || 0, earningsKES: u.referralEarningsKES || 0 },
    notifications: u.notifications, payment: { method: u.payment.method || '', details: u.payment.details || '' },
    avatar: u.avatar || null, isAdmin: !!u.isAdmin, usernameChangedAt: u.usernameChangedAt || null,
    premium: { active: isPremium(u), expires: u.premium.expires || null },
  };
}

// ---- Investments ------------------------------------------------------------
// Plans + the current (admin-overridable) rates. Existing investments keep the
// rate they were opened at; overrides only affect brand-new investments.
const investmentRates = () => db.get().investmentRates || {};
const investmentPlans = () => investmentsMod.plans(investmentRates());

// Interest accrued so far on an active investment, pro-rated by elapsed time.
function accruedInterest(inv) {
  const start = new Date(inv.startDate).getTime();
  const end = new Date(inv.maturityDate).getTime();
  if (!(end > start)) return round2(inv.expectedInterest || 0);
  const frac = (now() - start) / (end - start);
  return round2((inv.expectedInterest || 0) * Math.max(0, Math.min(1, frac)));
}
function investmentProgress(inv) {
  const start = new Date(inv.startDate).getTime();
  const end = new Date(inv.maturityDate).getTime();
  if (!(end > start)) return 100;
  return Math.max(0, Math.min(100, Math.round(((now() - start) / (end - start)) * 100)));
}
function daysRemaining(inv) {
  return Math.max(0, Math.ceil((new Date(inv.maturityDate).getTime() - now()) / 86400000));
}

// Automatic maturity: any active investment whose maturity date has passed is
// marked completed and its principal + interest credited to the USD wallet,
// where it becomes available for withdrawal via the existing Withdraw page.
function matureInvestments() {
  const S = db.get();
  let changed = false;
  for (const inv of S.investments || []) {
    if (inv.status === 'active' && new Date(inv.maturityDate).getTime() <= now()) {
      inv.status = 'completed';
      inv.completedAt = new Date().toISOString();
      inv.updatedAt = inv.completedAt;
      if (!inv.walletCredited) {
        const u = userById(inv.userId);
        if (u) { ensureUserShape(u); u.usd = round2((u.usd || 0) + inv.expectedReturn); }
        inv.walletCredited = true;
      }
      changed = true;
    }
  }
  if (changed) db.save();
}
setInterval(matureInvestments, 5 * 60 * 1000).unref();

function publicInvestment(inv) {
  const done = inv.status === 'completed';
  const pending = inv.status === 'pending' || inv.status === 'failed' || !inv.startDate;
  return {
    id: inv.id, planId: inv.planId, planName: inv.planName,
    principal: round2(inv.principal), interestRate: inv.interestRate, durationDays: inv.durationDays,
    expectedInterest: round2(inv.expectedInterest), expectedReturn: round2(inv.expectedReturn),
    currentEarnings: done ? round2(inv.expectedInterest) : (pending ? 0 : accruedInterest(inv)),
    progress: done ? 100 : (pending ? 0 : investmentProgress(inv)),
    daysRemaining: done ? 0 : (pending ? inv.durationDays : daysRemaining(inv)),
    paymentMethod: inv.paymentMethod, currency: inv.currency || 'USD', status: inv.status,
    paid: !!inv.paid, walletCredited: !!inv.walletCredited,
    startDate: inv.startDate, maturityDate: inv.maturityDate,
    completedAt: inv.completedAt || null, createdAt: inv.createdAt,
  };
}

// #4 — Remove sessions past their expiry so nothing lives forever.
function sweepExpiredSessions() {
  const s = db.get();
  const before = s.sessions.length + (s.adminSessions || []).length;
  s.sessions = s.sessions.filter((sess) => sess.expiresAt > now());
  s.adminSessions = (s.adminSessions || []).filter((sess) => sess.expiresAt > now());
  if (s.sessions.length + s.adminSessions.length !== before) db.save();
}
setInterval(sweepExpiredSessions, 5 * 60 * 1000).unref();

function createSession(res, userId) {
  const token = rid(24);
  const session = { token, userId, createdAt: now(), expiresAt: now() + SESSION_TTL_MS };
  db.get().sessions.push(session);
  db.save();
  res.cookie(COOKIE, token, {
    httpOnly: true,            // JS on the page can't read it (XSS mitigation)
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,    // browser also drops it when the server session expires
  });
  return session;
}

// #4 — Auth middleware: reject missing / unknown / EXPIRED sessions.
function currentSession(req) {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const s = db.get();
  const sess = s.sessions.find((x) => x.token === token);
  if (!sess) return null;
  if (sess.expiresAt <= now()) {
    // Expired: delete it and treat the user as logged out.
    s.sessions = s.sessions.filter((x) => x.token !== token);
    db.save();
    return null;
  }
  return sess;
}

function requireAuth(req, res, next) {
  const sess = currentSession(req);
  if (!sess) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  req.user = db.get().users.find((u) => u.id === sess.userId) || null;
  if (!req.user) return res.status(401).json({ error: 'Account not found.' });
  ensureUserShape(req.user);
  req.session = sess;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Admins only.' });
  next();
}

// ---- Separate admin authentication (independent of client accounts) ----
function createAdminSession(res) {
  const token = rid(24);
  const sess = { token, createdAt: now(), expiresAt: now() + ADMIN_SESSION_TTL_MS };
  db.get().adminSessions.push(sess);
  db.save();
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: ADMIN_SESSION_TTL_MS,
  });
  return sess;
}
function currentAdminSession(req) {
  const token = req.cookies[ADMIN_COOKIE];
  if (!token) return null;
  const s = db.get();
  const sess = (s.adminSessions || []).find((x) => x.token === token);
  if (!sess) return null;
  if (sess.expiresAt <= now()) {
    s.adminSessions = s.adminSessions.filter((x) => x.token !== token);
    db.save();
    return null;
  }
  return sess;
}
function requireAdminSession(req, res, next) {
  if (!currentAdminSession(req)) return res.status(401).json({ error: 'Admin sign-in required.' });
  next();
}
let adminLock = { count: 0, lockedUntil: 0 };

function findUserByEmail(email) {
  return db.get().users.find((u) => u.email === email) || null;
}

// Recent real completions (approved submissions) for the dashboard feed.
app.get('/api/public/activity', (req, res) => {
  const s = db.get();
  const items = (s.submissions || [])
    .filter((x) => x.status === 'approved')
    .sort((a, b) => String(b.reviewedAt || b.createdAt).localeCompare(String(a.reviewedAt || a.createdAt)))
    .slice(0, 8)
    .map((x) => {
      const u = userById(x.userId);
      const t = tasksMod.byId(x.taskId);
      return {
        username: u ? u.username : 'member',
        country: (u && u.profile && u.profile.country) || '',
        task: t ? t.title : 'a task',
        reward: x.reward,
      };
    });
  res.json({ items });
});

// Public, no-auth stats for the home page social-proof band.
app.get('/api/public/stats', (req, res) => {
  const s = db.get();
  const approved = (s.submissions || []).filter((x) => x.status === 'approved');
  const workers = new Set(approved.map((x) => x.userId));
  res.json({
    members: (s.users || []).length,
    tasksLive: TASKS.length,
    tasksCompleted: approved.length,
    workers: workers.size,
  });
});

// =============================================================================
//  SIGN UP  (email + password)                     — guards #2 (duplicate email)
// =============================================================================
app.post('/api/signup', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normEmail(req.body.email);
    const username = String(req.body.username || '').trim();
    const password = req.body.password;
    const country = String(req.body.country || '').trim();
    const phone = String(req.body.phone || '').trim();
    const deviceId = String(req.body.deviceId || '').trim();

    // #5 — block a device that has already created an account (even a deleted one).
    if (deviceId && deviceBlocked(deviceId)) {
      return res.status(409).json({ error: 'An account has already been created on this device. Only one account per device is allowed.' });
    }

    if (!name) return res.status(400).json({ error: 'Please enter your name.' });
    if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
    const unErr = usernameProblem(username);
    if (unErr) return res.status(400).json({ error: unErr });
    const pwErr = passwordProblem(password);
    if (pwErr) return res.status(400).json({ error: pwErr });

    // #2 — Reject a second account on the same (normalized) email.
    if (findUserByEmail(email)) {
      return res.status(409).json({ error: 'An account with this email already exists. Try signing in instead.' });
    }
    if (usernameTaken(username)) {
      return res.status(409).json({ error: 'That username is already taken. Please pick another.' });
    }

    const user = {
      id: rid(8),
      name,
      email,
      username,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      providers: ['email'],
      createdAt: new Date().toISOString(),
      onboarded: false,   // -> new users answer the welcome questionnaire next
      balance: 0,         // KES wallet; welcome bonus + referral bonuses land here
      usd: 0,             // USD wallet; approved task earnings land here
      profile: Object.assign({}, country ? { country } : {}, phone ? { phone } : {}), // + age / education / about / referral later
      isAdmin: db.get().users.length === 0 || (ADMIN_EMAIL && email === ADMIN_EMAIL),
    };
    ensureUserShape(user);
    db.get().users.push(user);
    registerDevice(deviceId, user.id); // #5 tombstone this device
    creditReferral(req.body.ref, user); // ?ref=<code> -> pay the referrer 5 KES
    db.save();

    createSession(res, user.id);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// =============================================================================
//  SIGN IN  (email + password)                     — guards #1 (wrong password)
// =============================================================================
app.post('/api/login', async (req, res) => {
  try {
    const email = normEmail(req.body.email);
    const password = String(req.body.password || '');
    const s = db.get();

    // #1 — Lockout check: too many wrong passwords -> temporarily blocked.
    const rec = s.attempts[email];
    if (rec && rec.lockedUntil && rec.lockedUntil > now()) {
      const mins = Math.ceil((rec.lockedUntil - now()) / 60000);
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute(s).` });
    }

    const user = findUserByEmail(email);
    const ok = user && user.passwordHash && (await bcrypt.compare(password, user.passwordHash));

    if (!ok) {
      // #1 — Count the failure and, past the threshold, lock the account window.
      const cur = s.attempts[email] || { count: 0, lockedUntil: 0 };
      cur.count += 1;
      if (cur.count >= LOGIN_MAX_ATTEMPTS) {
        cur.lockedUntil = now() + LOGIN_LOCK_MS;
        cur.count = 0;
      }
      s.attempts[email] = cur;
      db.save();
      // #1 — Generic message: never reveal whether the email or the password was wrong.
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Success: clear the failed-attempt record and start a fresh, expiring session.
    delete s.attempts[email];
    db.save();
    createSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// =============================================================================
//  SOCIAL LOGIN  (Google / Facebook / Apple)  — real OAuth 2.0 / OIDC
// =============================================================================
//  Flow: /start redirects to the provider; the provider redirects back to
//  /callback with a code; we exchange it, read the email, and upsert ONE
//  account per email (#2). A `state` cookie protects against CSRF.
const OAUTH_STATE_COOKIE = 'gweno_oauth_state';
const OAUTH_REF_COOKIE = 'gweno_oauth_ref';
const OAUTH_DEV_COOKIE = 'gweno_oauth_dev';
const oauthRedirectUri = (req, provider) => `${baseUrl(req)}/api/oauth/${provider}/callback`;

app.get('/api/oauth/:provider/start', (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  if (!oauth.isProvider(provider)) return res.redirect('/login.html?error=unknown_provider');
  if (!oauth.configured(provider)) return res.redirect(`/login.html?error=${provider}_unavailable`);
  const state = rid(16);
  const opts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000 };
  res.cookie(OAUTH_STATE_COOKIE, state, opts);
  if (req.query.ref) res.cookie(OAUTH_REF_COOKIE, String(req.query.ref), opts);
  if (req.query.deviceId) res.cookie(OAUTH_DEV_COOKIE, String(req.query.deviceId), opts);
  res.redirect(oauth.authorizeUrl(provider, oauthRedirectUri(req, provider), state));
});

async function handleOAuthCallback(req, res) {
  const provider = String(req.params.provider || 'apple').toLowerCase();
  try {
    if (!oauth.isProvider(provider) || !oauth.configured(provider)) return res.redirect('/login.html?error=oauth_unavailable');
    const code = req.query.code || req.body.code;
    const state = req.query.state || req.body.state;
    if (!code || !state || state !== req.cookies[OAUTH_STATE_COOKIE]) return res.redirect('/login.html?error=oauth_state');
    res.clearCookie(OAUTH_STATE_COOKIE);

    const tokens = await oauth.exchangeCode(provider, code, oauthRedirectUri(req, provider));
    const profile = await oauth.fetchProfile(provider, tokens);
    let name = profile.name;
    if (provider === 'apple' && req.body.user) { // Apple only sends the name on first consent
      try { const u = JSON.parse(req.body.user); if (u.name) name = `${u.name.firstName || ''} ${u.name.lastName || ''}`.trim(); } catch (_) {}
    }
    if (!isEmail(profile.email)) return res.redirect('/login.html?error=oauth_no_email');

    const deviceId = req.cookies[OAUTH_DEV_COOKIE] || '';
    const ref = req.cookies[OAUTH_REF_COOKIE] || '';
    res.clearCookie(OAUTH_REF_COOKIE); res.clearCookie(OAUTH_DEV_COOKIE);

    let user = findUserByEmail(profile.email);
    if (!user) {
      if (deviceId && deviceBlocked(deviceId)) return res.redirect('/login.html?error=device_limit');
      user = {
        id: rid(8), name: name || profile.email.split('@')[0], email: profile.email,
        username: genUsername(profile.email.split('@')[0]), passwordHash: null, providers: [provider],
        createdAt: new Date().toISOString(), onboarded: false, balance: 0, usd: 0, profile: {},
        isAdmin: db.get().users.length === 0 || (ADMIN_EMAIL && profile.email === ADMIN_EMAIL),
      };
      ensureUserShape(user);
      db.get().users.push(user);
      registerDevice(deviceId, user.id);
      creditReferral(ref, user);
    } else if (!user.providers.includes(provider)) {
      user.providers.push(provider); // #2 link, don't duplicate
    }
    db.save();
    createSession(res, user.id);
    res.redirect(user.onboarded ? '/app.html#/dashboard' : '/onboarding.html');
  } catch (err) {
    console.error('[gweno] oauth callback error:', err.message);
    res.redirect('/login.html?error=oauth_failed');
  }
}

app.get('/api/oauth/:provider/callback', handleOAuthCallback);
app.post('/api/oauth/apple/callback', handleOAuthCallback); // Apple posts (form_post)

// =============================================================================
//  FORGOT PASSWORD  -> issue reset token           — guards #3 (reset abuse)
// =============================================================================
app.post('/api/forgot-password', (req, res) => {
  const email = normEmail(req.body.email);
  const s = db.get();

  // #3 — Rate-limit reset requests per email so the endpoint can't be spammed.
  const win = s.resetRequests[email];
  if (win && win.windowStart > now() - RESET_WINDOW_MS) {
    if (win.count >= RESET_MAX_REQUESTS) {
      // Still generic (see below) so we don't leak which emails are throttled.
      return res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
    }
    win.count += 1;
  } else {
    s.resetRequests[email] = { windowStart: now(), count: 1 };
  }

  const user = isEmail(email) ? findUserByEmail(email) : null;

  if (user) {
    // #3 — Invalidate any previous tokens for this user (only the newest works).
    s.resetTokens = s.resetTokens.filter((t) => t.userId !== user.id);
    const raw = rid(24);
    s.resetTokens.push({
      tokenHash: sha(raw),                 // #3 store only the hash, never the raw token
      userId: user.id,
      createdAt: now(),
      expiresAt: now() + RESET_TOKEN_TTL_MS, // #3 short expiry
      used: false,                          // #3 single-use flag
    });
    const link = `${baseUrl(req)}/reset.html?token=${raw}`;
    if (mailer.configured()) {
      mailer.sendPasswordReset(user.email, link).catch((e) => console.error('[gweno] reset email failed:', e.message));
    } else {
      // No SMTP yet: log server-side only (never exposed to the page).
      console.log(`\n[gweno] SMTP not configured — reset link for ${email}:\n  ${link}\n`);
    }
  }
  db.save();

  // #3 — Always the same response whether or not the email exists (no enumeration).
  res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
});

// =============================================================================
//  RESET PASSWORD  (consume token)                 — guards #3 (reset abuse)
// =============================================================================
app.post('/api/reset-password', async (req, res) => {
  const raw = String(req.body.token || '');
  const password = req.body.password;
  const s = db.get();

  const pwErr = passwordProblem(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const rec = s.resetTokens.find((t) => t.tokenHash === sha(raw));
  // #3 — Reject unknown, already-used, or expired tokens.
  if (!rec || rec.used || rec.expiresAt <= now()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
  }

  const user = s.users.find((u) => u.id === rec.userId);
  if (!user) return res.status(400).json({ error: 'Account not found.' });

  user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  if (!user.providers.includes('email')) user.providers.push('email');
  rec.used = true;                                       // #3 mark single-use token spent
  s.sessions = s.sessions.filter((x) => x.userId !== user.id); // log out everywhere after reset
  delete s.attempts[user.email];                          // clear any lockout too
  db.save();

  res.json({ ok: true, message: 'Your password has been reset. You can sign in now.' });
});

// =============================================================================
//  ONBOARDING  (welcome questionnaire)  -> credits a 1 KES-per-answer bonus
// =============================================================================
const BONUS_PER_ANSWER_KES = 1;
app.post('/api/onboarding', requireAuth, (req, res) => {
  const user = req.user;

  // Idempotent: the welcome bonus is only ever paid once.
  if (user.onboarded) {
    return res.json({ user: publicUser(user), alreadyDone: true, bonus: 0 });
  }

  const ageRange = String(req.body.ageRange || '').trim();
  const education = String(req.body.education || '').trim();
  const about = String(req.body.about || '').trim();
  const referral = String(req.body.referral || '').trim();

  // All questions are required now.
  if (!ageRange || !education || !about || !referral) {
    return res.status(400).json({ error: 'Please answer all the questions before continuing.' });
  }
  // Age gate: you must be 18 or older to use Gweno.
  if (ageRange === 'Under 18') {
    return res.status(403).json({ error: 'You must be at least 18 years old to have a Gweno account.', underage: true });
  }

  // One shilling for each answered question (all four are required, so this is the full bonus).
  const answered = [ageRange, education, about, referral].filter(Boolean).length;
  const bonus = answered * BONUS_PER_ANSWER_KES;

  user.profile = Object.assign({}, user.profile, { ageRange, education, about, referral });
  user.balance = (user.balance || 0) + bonus;
  user.onboarded = true;
  db.save();

  res.json({ user: publicUser(user), bonus, answered });
});

// ---- Session-backed endpoints ----------------------------------------------
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), sessionExpiresAt: req.session.expiresAt, fx: FX_KES_PER_USD });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies[COOKIE];
  const s = db.get();
  s.sessions = s.sessions.filter((x) => x.token !== token);
  db.save();
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

// Delete account. The device fingerprint stays a tombstone (#5) so the same
// device can't create a fresh account afterwards.
app.post('/api/delete-account', requireAuth, async (req, res) => {
  // Require the account password before destroying anything.
  const password = String(req.body.password || '');
  if (req.user.passwordHash) {
    if (!password) return res.status(400).json({ error: 'Please enter your password to confirm.' });
    const okPw = await bcrypt.compare(password, req.user.passwordHash);
    if (!okPw) return res.status(400).json({ error: 'That password is incorrect.' });
  }
  const uid = req.user.id;
  const s = db.get();
  s.users = s.users.filter((u) => u.id !== uid);
  s.sessions = s.sessions.filter((x) => x.userId !== uid);
  s.submissions = s.submissions.filter((x) => x.userId !== uid);
  s.deposits = s.deposits.filter((x) => x.userId !== uid);
  s.redemptions = s.redemptions.filter((x) => x.userId !== uid);
  s.campaigns = s.campaigns.filter((x) => x.userId !== uid);
  s.investments = (s.investments || []).filter((x) => x.userId !== uid);
  // NB: s.devices is intentionally NOT cleared — the tombstone must persist.
  db.save();
  res.clearCookie(COOKIE);
  res.json({ ok: true, message: 'Your account has been deleted.' });
});

// =============================================================================
//  TASKS  —  36-task catalog + submissions
// =============================================================================
function mySubmissions(userId) {
  return db.get().submissions.filter((x) => x.userId === userId);
}

app.get('/api/tasks', requireAuth, (req, res) => {
  const premium = isPremium(req.user);
  const mine = mySubmissions(req.user.id);
  // Hide tasks that are pending or approved; rejected ones can be retried.
  const done = new Set(mine.filter((x) => x.status !== 'rejected').map((x) => x.taskId));
  const available = TASKS.filter((t) => !done.has(t.id)).map((t) => ({ ...t, locked: t.tier === 'premium' && !premium }));
  const accessible = available.filter((t) => !t.locked);
  const pending = mine.filter((x) => x.status === 'pending').reduce((a, x) => a + x.reward, 0);
  const approved = mine.filter((x) => x.status === 'approved').reduce((a, x) => a + x.reward, 0);
  res.json({
    premium,
    totalAvailable: accessible.length,
    moneyAvailableUSD: round2(accessible.reduce((a, t) => a + t.reward, 0)),
    premiumMoneyUSD: round2(available.filter((t) => t.tier === 'premium').reduce((a, t) => a + t.reward, 0)),
    pendingUSD: round2(pending),
    approvedUSD: round2(approved),
    balanceUSD: round2(req.user.usd),
    subscription: {
      priceUSD: SUBSCRIPTION_USD, priceKES: Math.round(SUBSCRIPTION_USD * FX_KES_PER_USD),
      live: payments.mpesaStkConfigured(), expires: req.user.premium.expires || null,
    },
    tasks: available,
  });
});

app.get('/api/tasks/:id', requireAuth, (req, res) => {
  const task = tasksMod.byId(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const sub = mySubmissions(req.user.id).find((x) => x.taskId === task.id && x.status !== 'rejected');
  res.json({ task, submission: sub || null });
});

app.post('/api/tasks/:id/submit', requireAuth, (req, res) => {
  const task = tasksMod.byId(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (task.tier === 'premium' && !isPremium(req.user)) {
    return res.status(403).json({ error: 'This is a Premium task. Subscribe to Premium to work on it.' });
  }
  const S = db.get();
  if (mySubmissions(req.user.id).some((x) => x.taskId === task.id && x.status !== 'rejected')) {
    return res.status(409).json({ error: 'You have already submitted this task.' });
  }
  // One task per day: block if the user already started a task today.
  const todayUTC = new Date().toISOString().slice(0, 10);
  if (mySubmissions(req.user.id).some((x) => String(x.createdAt).slice(0, 10) === todayUTC)) {
    return res.status(429).json({ error: 'You can only do one task per day. Please come back tomorrow for another.' });
  }
  const proof = String(req.body.proof || '').trim();
  if (task.requiresProof && !proof) return res.status(400).json({ error: 'This task needs proof before you can submit it.' });
  const sub = {
    id: rid(8), userId: req.user.id, taskId: task.id, reward: task.reward,
    proof, status: 'pending', createdAt: new Date().toISOString(), reviewedAt: null, reviewNote: '', dispute: null,
  };
  S.submissions.push(sub);
  db.save();
  res.status(201).json({ submission: sub, message: 'Submitted for review. Approvals are usually completed within 5 hours.' });
});

app.get('/api/submissions', requireAuth, (req, res) => {
  const mine = mySubmissions(req.user.id)
    .map((x) => ({ ...x, task: tasksMod.byId(x.taskId) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ submissions: mine });
});

// Dispute a rejected submission (2-day window is shown in the UI).
app.post('/api/submissions/:id/dispute', requireAuth, (req, res) => {
  const sub = db.get().submissions.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!sub) return res.status(404).json({ error: 'Submission not found.' });
  if (sub.status !== 'rejected') return res.status(400).json({ error: 'Only rejected submissions can be disputed.' });
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Please describe your dispute.' });
  sub.dispute = { message, createdAt: new Date().toISOString(), status: 'open' };
  db.save();
  res.json({ ok: true, message: 'Your dispute has been submitted and will be reviewed.' });
});

// =============================================================================
//  ADMIN  —  review submissions (approve / reject)
// =============================================================================
app.get('/api/admin/submissions', requireAdminSession, (req, res) => {
  const all = db.get().submissions
    .map((x) => {
      const u = userById(x.userId);
      return { ...x, task: tasksMod.byId(x.taskId), user: u ? { username: u.username, email: u.email } : null };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ submissions: all });
});

app.post('/api/admin/submissions/:id/decision', requireAdminSession, (req, res) => {
  const sub = db.get().submissions.find((x) => x.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Submission not found.' });
  const decision = String(req.body.decision || '');
  const note = String(req.body.note || '').trim();
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });

  const owner = userById(sub.userId);
  if (owner) ensureUserShape(owner);
  if (decision === 'approved' && sub.status !== 'approved' && owner) {
    owner.usd = round2((owner.usd || 0) + sub.reward);       // credit on approval
  }
  if (decision === 'rejected' && sub.status === 'approved' && owner) {
    owner.usd = round2(Math.max(0, (owner.usd || 0) - sub.reward)); // reverse if un-approved
  }
  sub.status = decision;
  sub.reviewedAt = new Date().toISOString();
  sub.reviewNote = note;
  db.save();
  res.json({ ok: true, submission: sub });
});

// ---- Admin sign-in (separate credentials + own cookie; not a client account) ----
app.get('/api/admin/session', (req, res) => {
  const authed = !!currentAdminSession(req);
  res.json({ authed, username: authed ? ADMIN_USERNAME : null, configured: !!ADMIN_PASSWORD });
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'Admin login is not configured. Set ADMIN_PASSWORD in .env.' });
  if (adminLock.lockedUntil > now()) {
    const mins = Math.ceil((adminLock.lockedUntil - now()) / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${mins} minute(s).` });
  }
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    adminLock.count += 1;
    if (adminLock.count >= 5) { adminLock.lockedUntil = now() + 15 * 60 * 1000; adminLock.count = 0; }
    return res.status(401).json({ error: 'Invalid admin username or password.' });
  }
  adminLock = { count: 0, lockedUntil: 0 };
  createAdminSession(res);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.cookies[ADMIN_COOKIE];
  const s = db.get();
  s.adminSessions = (s.adminSessions || []).filter((x) => x.token !== token);
  db.save();
  res.clearCookie(ADMIN_COOKIE);
  res.json({ ok: true });
});

// ---- Admin panel: overview + read-only lists + withdrawal actions ----
app.get('/api/admin/overview', requireAdminSession, (req, res) => {
  const S = db.get();
  const subs = S.submissions;
  res.json({
    admin: { username: ADMIN_USERNAME },
    users: S.users.length,
    submissions: {
      total: subs.length,
      pending: subs.filter((x) => x.status === 'pending').length,
      approved: subs.filter((x) => x.status === 'approved').length,
      rejected: subs.filter((x) => x.status === 'rejected').length,
      disputes: subs.filter((x) => x.dispute).length,
    },
    deposits: { count: S.deposits.length, totalKES: round2(S.deposits.filter((d) => d.status === 'success').reduce((a, d) => a + d.amount, 0)) },
    withdrawals: { count: S.redemptions.length, open: S.redemptions.filter((r) => /process|request/i.test(r.status)).length },
    support: S.support.length,
  });
});

app.get('/api/admin/users', requireAdminSession, (req, res) => {
  const users = db.get().users.map((u) => ({
    id: u.id, name: u.name, username: u.username, email: u.email, isAdmin: !!u.isAdmin,
    balance: round2(u.balance || 0), usd: round2(u.usd || 0), onboarded: !!u.onboarded,
    referralCount: u.referralCount || 0, createdAt: u.createdAt,
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ users });
});

app.get('/api/admin/deposits', requireAdminSession, (req, res) => {
  const deposits = db.get().deposits.map((d) => {
    const u = userById(d.userId);
    return { ...d, user: u ? { username: u.username, email: u.email } : null };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ deposits });
});

app.get('/api/admin/redemptions', requireAdminSession, (req, res) => {
  const redemptions = db.get().redemptions.map((r) => {
    const u = userById(r.userId);
    return { ...r, user: u ? { username: u.username, email: u.email } : null };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ redemptions });
});

app.post('/api/admin/redemptions/:id/mark', requireAdminSession, (req, res) => {
  const rec = db.get().redemptions.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Redemption not found.' });
  const status = String(req.body.status || '');
  if (!['Paid', 'Failed', 'Processing'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (status === 'Failed' && rec.status !== 'Failed') {
    const u = userById(rec.userId); // refund on manual failure
    if (u) { ensureUserShape(u); if (rec.currency === 'KES') u.balance = round2(u.balance + rec.amount); else u.usd = round2(u.usd + rec.amount); }
  }
  rec.status = status; rec.reviewedAt = new Date().toISOString();
  db.save();
  res.json({ ok: true, redemption: rec });
});

app.get('/api/admin/support', requireAdminSession, (req, res) => {
  const tickets = db.get().support.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ tickets });
});

// =============================================================================
//  REFERRALS  —  single-use link, 5 KES per successful referral, + QR
// =============================================================================
app.get('/api/referral', requireAuth, (req, res) => {
  const u = req.user; // ensureUserShape already issued a fresh code if the last was used
  const link = `${baseUrl(req)}/signup.html?ref=${u.referral.code}`;
  const referred = db.get().users
    .filter((x) => x.referredBy === u.id)
    .map((x) => ({ username: x.username, joinedAt: x.createdAt }));
  res.json({
    code: u.referral.code,
    link,
    qr: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(link)}`,
    perReferralKES: REF_BONUS_KES,
    count: u.referralCount || 0,
    earningsKES: round2(u.referralEarningsKES || 0),
    referred,
  });
});

app.post('/api/referral/regenerate', requireAuth, (req, res) => {
  req.user.referral = { code: newRefCode(), used: false };
  db.save();
  const link = `${baseUrl(req)}/signup.html?ref=${req.user.referral.code}`;
  res.json({ code: req.user.referral.code, link });
});

// =============================================================================
//  REDEEM  —  withdraw to M-Pesa, PayPal or a bank account
// =============================================================================
// The wallet is one balance held in two currencies (KES + USD). These helpers
// express it as a single combined pool so a withdrawal in either currency can
// draw on the whole balance, deducting the matching wallet first.
function combinedKES(u) { return round2(u.balance + u.usd * FX_KES_PER_USD); }
function combinedUSD(u) { return round2(u.usd + u.balance / FX_KES_PER_USD); }
function deductCombined(u, currency, amount) {
  if (currency === 'KES') {
    const fromKes = Math.min(u.balance, amount);
    u.balance = round2(u.balance - fromKes);
    const rem = amount - fromKes;
    if (rem > 0.0001) u.usd = round2(Math.max(0, u.usd - rem / FX_KES_PER_USD));
  } else {
    const fromUsd = Math.min(u.usd, amount);
    u.usd = round2(u.usd - fromUsd);
    const rem = amount - fromUsd;
    if (rem > 0.0001) u.balance = round2(Math.max(0, u.balance - rem * FX_KES_PER_USD));
  }
}
function creditCombined(u, currency, amount) {
  if (currency === 'KES') u.balance = round2(u.balance + amount);
  else u.usd = round2(u.usd + amount);
}

app.get('/api/redeem', requireAuth, (req, res) => {
  const history = db.get().redemptions
    .filter((r) => r.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({
    // Same balance shown in both currencies, kept in sync via the live FX rate.
    balanceKES: combinedKES(req.user), balanceUSD: combinedUSD(req.user),
    methods: WITHDRAW_METHODS, min: MIN_REDEEM,
    savedMethod: req.user.payment.method || '', savedDetails: req.user.payment.details || '',
    providers: { mpesa: payments.mpesaConfigured() },
    history,
  });
});

// All cash-outs are entered in USD. M-Pesa is auto-paid via B2C (converted to KES);
// PayPal / Stripe / Apple Pay / Card are recorded and processed by the team.
app.post('/api/redeem', requireAuth, async (req, res) => {
  const method = String(req.body.method || '').trim();
  const amount = round2(req.body.amount); // USD
  const destination = String(req.body.destination || '').trim();

  if (!WITHDRAW_METHODS.includes(method)) return res.status(400).json({ error: 'Choose a payout method.' });
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount.' });
  if (amount < MIN_REDEEM.USD) return res.status(400).json({ error: `Minimum payout is $${MIN_REDEEM.USD}.` });

  // Per-method destination rules.
  if (method === 'M-Pesa') {
    if (!/^(?:254|0)\d{9}$/.test(destination.replace(/\s+/g, ''))) return res.status(400).json({ error: 'Enter a valid M-Pesa phone number (e.g. 0712345678).' });
  } else if (method === 'PayPal' || method === 'Apple Pay' || method === 'Stripe') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destination)) return res.status(400).json({ error: 'Enter a valid email address for this method.' });
  } else if (method === 'Card') {
    if (destination.replace(/\D/g, '').length < 12) return res.status(400).json({ error: 'Enter a valid card number.' });
  }

  // Everything is priced in USD; check against the combined balance in USD.
  if (amount > combinedUSD(req.user)) return res.status(400).json({ error: 'Amount exceeds your available balance.' });

  if (method === 'M-Pesa' && !payments.mpesaConfigured()) {
    return res.status(503).json({ error: 'M-Pesa withdrawals are not available yet. Please check back soon.' });
  }

  // Never store a full card number — keep only the last 4 digits for display.
  const storedDest = method === 'Card' ? '•••• ' + destination.replace(/\D/g, '').slice(-4) : destination;

  // Deduct up-front (in USD), then attempt the payout; refund on failure.
  deductCombined(req.user, 'USD', amount);
  const rec = {
    id: rid(8), userId: req.user.id, amount, currency: 'USD', method, destination: storedDest,
    status: 'Requested', createdAt: new Date().toISOString(), provider: null, error: null,
  };
  db.get().redemptions.push(rec);
  db.save();

  if (method === 'M-Pesa') {
    const kesAmount = Math.round(amount * FX_KES_PER_USD); // B2C pays out in KES
    try {
      rec.provider = { type: 'mpesa', kesAmount, ...(await payments.mpesaB2C({ phone: destination, amount: kesAmount })) };
      rec.status = 'Processing'; // final Paid/Failed arrives on the M-Pesa result callback
      db.save();
      return res.json({ ok: true, redemption: rec, message: `Payout of $${amount} (≈ ${kesAmount} KES) submitted to M-Pesa.` });
    } catch (err) {
      creditCombined(req.user, 'USD', amount);
      rec.status = 'Failed'; rec.error = String(err.message || err);
      db.save();
      return res.status(502).json({ error: `Payout failed: ${rec.error}. Your balance was refunded.` });
    }
  }

  // PayPal / Stripe / Apple Pay / Card — manually processed by the team.
  rec.status = 'Processing';
  db.save();
  return res.json({ ok: true, redemption: rec, message: `Payout of $${amount} requested via ${method}. We'll process it shortly.` });
});

// M-Pesa B2C callbacks (point MPESA_RESULT_URL / MPESA_TIMEOUT_URL here via a public tunnel).
app.post('/api/mpesa/result', (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' }); // acknowledge immediately
  const r = req.body && req.body.Result;
  if (!r) return;
  const rec = db.get().redemptions.find((x) => x.provider && (
    x.provider.conversationId === r.ConversationID || x.provider.originatorConversationId === r.OriginatorConversationID));
  if (!rec) return;
  if (Number(r.ResultCode) === 0) {
    rec.status = 'Paid';
  } else {
    rec.status = 'Failed'; rec.error = r.ResultDesc;
    const u = userById(rec.userId);
    if (u) { ensureUserShape(u); creditCombined(u, rec.currency, rec.amount); }
  }
  rec.resultAt = new Date().toISOString();
  db.save();
});
app.post('/api/mpesa/timeout', (req, res) => { res.json({ ok: true }); });

// =============================================================================
//  DEPOSITS  —  top up your KES wallet via M-Pesa STK Push (Lipa na M-Pesa)
// =============================================================================
app.get('/api/deposits', requireAuth, (req, res) => {
  const mine = db.get().deposits
    .filter((d) => d.userId === req.user.id && d.purpose !== 'subscription') // wallet top-ups only
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ deposits: mine, live: payments.mpesaStkConfigured(), min: DEPOSIT_MIN_KES });
});

app.post('/api/deposit', requireAuth, async (req, res) => {
  const amount = round2(req.body.amount);
  const phone = String(req.body.phone || '').trim();
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount.' });
  if (amount < DEPOSIT_MIN_KES) return res.status(400).json({ error: `Minimum deposit is ${DEPOSIT_MIN_KES} KES.` });
  if (!/^(?:254|0)\d{9}$/.test(phone.replace(/\s+/g, ''))) return res.status(400).json({ error: 'Enter a valid M-Pesa phone number (e.g. 0712345678).' });
  if (!payments.mpesaStkConfigured()) return res.status(503).json({ error: 'Deposits are not available yet. Please check back soon.' });

  const reference = 'dep_' + rid(8);
  const rec = {
    id: rid(8), userId: req.user.id, amount, currency: 'KES', reference, phone,
    status: 'pending', createdAt: new Date().toISOString(), paidAt: null, error: null, provider: null,
  };
  db.get().deposits.push(rec);
  db.save();

  try {
    rec.provider = { type: 'mpesa-stk', ...(await payments.mpesaStkPush({ phone, amount, accountRef: 'Gweno', description: 'Wallet top-up' })) };
    db.save(); // final success/fail arrives on the STK callback
    return res.json({ ok: true, reference, message: 'Payment request sent. Enter your M-Pesa PIN on your phone to complete the deposit.' });
  } catch (err) {
    rec.status = 'failed'; rec.error = String(err.message || err);
    db.save();
    return res.status(502).json({ error: 'Deposit failed: ' + rec.error });
  }
});

// Let the client poll a deposit's status while the STK prompt is pending.
app.get('/api/deposit/:reference/status', requireAuth, (req, res) => {
  const rec = db.get().deposits.find((d) => d.reference === req.params.reference && d.userId === req.user.id);
  if (!rec) return res.status(404).json({ error: 'Deposit not found.' });
  res.json({ status: rec.status, amount: rec.amount, balanceKES: round2(req.user.balance) });
});

// Non-M-Pesa top-ups (Card / PayPal / Bank / Paystack). Recorded in USD and marked
// pending until the provider is wired with live keys; no balance is credited yet.
app.post('/api/deposit/manual', requireAuth, (req, res) => {
  const method = String(req.body.method || '').trim();
  const amount = round2(req.body.amount); // USD
  const details = String(req.body.details || '').trim();
  if (!DEPOSIT_METHODS.includes(method) || method === 'M-Pesa') return res.status(400).json({ error: 'Choose a valid deposit method.' });
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount.' });
  const rec = {
    id: rid(8), userId: req.user.id, amount, currency: 'USD', reference: 'dep_' + rid(8),
    method, details, status: 'pending', createdAt: new Date().toISOString(), paidAt: null, error: null, provider: null,
  };
  db.get().deposits.push(rec);
  db.save();
  res.status(201).json({ ok: true, reference: rec.reference, message: `Deposit of $${amount} via ${method} recorded. It will be credited once the payment is confirmed.` });
});

// Safaricom posts the STK result here (point MPESA_STK_CALLBACK_URL to this via a public tunnel).
// Handles both wallet top-ups (credit balance) and Premium subscriptions (grant premium).
app.post('/api/mpesa/stk-callback', (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  const cb = req.body && req.body.Body && req.body.Body.stkCallback;
  if (!cb) return;

  // An investment funded via M-Pesa STK? Activate it on success.
  const invRec = db.get().investments.find((i) => i.provider && i.provider.checkoutRequestId === cb.CheckoutRequestID);
  if (invRec) {
    if (invRec.status === 'pending') {
      if (Number(cb.ResultCode) === 0) {
        const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
        const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber');
        if (receipt) invRec.provider.receipt = receipt.Value;
        activateInvestment(invRec);
      } else { invRec.status = 'failed'; invRec.error = cb.ResultDesc; }
      db.save();
    }
    return;
  }

  const rec = db.get().deposits.find((d) => d.provider && d.provider.checkoutRequestId === cb.CheckoutRequestID);
  if (!rec || rec.status === 'success') return;
  if (Number(cb.ResultCode) === 0) {
    rec.status = 'success'; rec.paidAt = new Date().toISOString();
    const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
    const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber');
    if (receipt) rec.receipt = receipt.Value;
    const u = userById(rec.userId);
    if (u) {
      ensureUserShape(u);
      if (rec.purpose === 'subscription') grantPremium(u);
      else u.balance = round2((u.balance || 0) + rec.amount);
    }
  } else {
    rec.status = 'failed'; rec.error = cb.ResultDesc;
  }
  db.save();
});

// =============================================================================
//  PREMIUM SUBSCRIPTION  —  $10 (charged in KES) via M-Pesa STK, unlocks $1–$4 tasks
// =============================================================================
app.get('/api/subscription', requireAuth, (req, res) => {
  res.json({
    active: isPremium(req.user),
    expires: req.user.premium.expires || null,
    priceUSD: SUBSCRIPTION_USD,
    priceKES: Math.round(SUBSCRIPTION_USD * FX_KES_PER_USD),
    live: payments.mpesaStkConfigured(),
  });
});

app.post('/api/subscribe', requireAuth, async (req, res) => {
  if (isPremium(req.user)) return res.status(400).json({ error: 'You already have an active Premium subscription.' });
  const phone = String(req.body.phone || '').trim();
  const amountKES = Math.round(SUBSCRIPTION_USD * FX_KES_PER_USD);
  if (!/^(?:254|0)\d{9}$/.test(phone.replace(/\s+/g, ''))) return res.status(400).json({ error: 'Enter a valid M-Pesa phone number (e.g. 0712345678).' });
  if (!payments.mpesaStkConfigured()) return res.status(503).json({ error: 'Premium subscription is not available yet. Please check back soon.' });

  const reference = 'sub_' + rid(8);
  const rec = {
    id: rid(8), userId: req.user.id, amount: amountKES, currency: 'KES', reference, phone,
    purpose: 'subscription', status: 'pending', createdAt: new Date().toISOString(), paidAt: null, provider: null, error: null,
  };
  db.get().deposits.push(rec);
  db.save();

  try {
    rec.provider = { type: 'mpesa-stk', ...(await payments.mpesaStkPush({ phone, amount: amountKES, accountRef: 'Gweno Premium', description: 'Premium subscription' })) };
    db.save();
    return res.json({ ok: true, reference, message: 'Payment request sent. Enter your M-Pesa PIN to activate Premium.' });
  } catch (err) {
    rec.status = 'failed'; rec.error = String(err.message || err);
    db.save();
    return res.status(502).json({ error: 'Subscription payment failed: ' + rec.error });
  }
});

// =============================================================================
//  SETTINGS  —  profile, password, email, username, notifications, payment, avatar
// =============================================================================
app.post('/api/settings/profile', requireAuth, (req, res) => {
  const u = req.user; const b = req.body;
  const name = String(b.name || '').trim();
  if (name) u.name = name;
  u.profile = Object.assign({}, u.profile, {
    gender: String(b.gender ?? u.profile.gender ?? '').trim(),
    country: String(b.country ?? u.profile.country ?? '').trim(),
    phone: String(b.phone ?? u.profile.phone ?? '').trim(),
    dob: String(b.dob ?? u.profile.dob ?? '').trim(),
    postalCode: String(b.postalCode ?? u.profile.postalCode ?? '').trim(),
    state: String(b.state ?? u.profile.state ?? '').trim(),
  });
  db.save();
  res.json({ ok: true, user: publicUser(u), message: 'Profile updated.' });
});

app.post('/api/settings/password', requireAuth, async (req, res) => {
  const u = req.user;
  const current = String(req.body.current || '');
  const nw = req.body.newPassword;
  const pe = passwordProblem(nw);
  if (pe) return res.status(400).json({ error: pe });
  if (u.passwordHash) {
    const ok = await bcrypt.compare(current, u.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Your current password is incorrect.' });
  }
  u.passwordHash = await bcrypt.hash(nw, BCRYPT_ROUNDS);
  if (!u.providers.includes('email')) u.providers.push('email');
  // Keep this session, drop the others.
  const token = req.cookies[COOKIE];
  db.get().sessions = db.get().sessions.filter((x) => x.userId !== u.id || x.token === token);
  db.save();
  res.json({ ok: true, message: 'Password updated. Other devices have been signed out.' });
});

app.post('/api/settings/email', requireAuth, async (req, res) => {
  const u = req.user;
  const newEmail = normEmail(req.body.newEmail);
  const pw = String(req.body.password || '');
  if (!isEmail(newEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (newEmail !== u.email && findUserByEmail(newEmail)) return res.status(409).json({ error: 'That email is already in use.' });
  if (u.passwordHash) {
    const ok = await bcrypt.compare(pw, u.passwordHash);
    if (!ok) return res.status(400).json({ error: 'Password is incorrect.' });
  }
  u.email = newEmail;
  db.save();
  res.json({ ok: true, user: publicUser(u), message: 'Email address updated.' });
});

app.post('/api/settings/username', requireAuth, (req, res) => {
  const u = req.user;
  const nu = String(req.body.newUsername || '').trim();
  const pe = usernameProblem(nu);
  if (pe) return res.status(400).json({ error: pe });
  if (u.usernameChangedAt) {
    const elapsed = now() - new Date(u.usernameChangedAt).getTime();
    if (elapsed < USERNAME_COOLDOWN_MS) {
      const days = Math.ceil((USERNAME_COOLDOWN_MS - elapsed) / 86400000);
      return res.status(429).json({ error: `You can only change your username once every 30 days. Try again in ${days} day(s).` });
    }
  }
  if (usernameTaken(nu, u.id)) return res.status(409).json({ error: 'That username is already taken.' });
  u.username = nu;
  u.usernameChangedAt = new Date().toISOString();
  db.save();
  res.json({ ok: true, user: publicUser(u), message: 'Username updated.' });
});

app.post('/api/settings/notifications', requireAuth, (req, res) => {
  req.user.notifications = {
    newTasks: !!req.body.newTasks,
    account: !!req.body.account,
    promotions: !!req.body.promotions,
  };
  db.save();
  res.json({ ok: true, notifications: req.user.notifications, message: 'Notification preferences saved.' });
});

app.post('/api/settings/payment', requireAuth, (req, res) => {
  const method = String(req.body.method || '').trim();
  if (!SETTINGS_PAYMENT_METHODS.includes(method)) return res.status(400).json({ error: 'Choose a valid payment method.' });
  // `details` is a masked display string built on the client — no raw card data or secret keys reach the server.
  req.user.payment = { method, details: String(req.body.details || '').trim() };
  db.save();
  res.json({ ok: true, payment: { method: req.user.payment.method, details: req.user.payment.details }, message: 'Payment method saved.' });
});

app.post('/api/settings/avatar', requireAuth, (req, res) => {
  const img = String(req.body.image || '');
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(img)) return res.status(400).json({ error: 'Please upload a valid image file.' });
  if (img.length > 1_600_000) return res.status(413).json({ error: 'That image is too large (max ~1MB).' });
  req.user.avatar = img;
  db.save();
  res.json({ ok: true, avatar: img, message: 'Profile picture updated.' });
});

// =============================================================================
//  SUPPORT  —  contact form (stored + emailed to the support inbox)
// =============================================================================
app.post('/api/support', requireAuth, (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();
  if (!subject || !message) return res.status(400).json({ error: 'Please enter a subject and a message.' });
  db.get().support.push({ id: rid(8), userId: req.user.id, email: req.user.email, subject, message, createdAt: new Date().toISOString() });
  db.save();
  if (mailer.configured()) {
    mailer.sendSupport({ fromEmail: req.user.email, subject, message }).catch((e) => console.error('[gweno] support email failed:', e.message));
  }
  res.json({ ok: true, message: 'Thanks — your message has been received. We will reply by email.' });
});

// =============================================================================
//  ADVERTISE  —  campaigns
// =============================================================================
app.get('/api/campaigns', requireAuth, (req, res) => {
  const mine = db.get().campaigns
    .filter((c) => c.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ campaigns: mine });
});

app.post('/api/campaigns', requireAuth, (req, res) => {
  const title = String(req.body.title || '').trim();
  const url = String(req.body.url || '').trim();
  const type = String(req.body.type || 'Clicks').trim();
  const budget = round2(req.body.budget);
  if (!title) return res.status(400).json({ error: 'Enter a campaign title.' });
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'Enter a valid URL starting with http:// or https://' });
  if (!(budget > 0)) return res.status(400).json({ error: 'Enter a budget greater than 0.' });
  const c = { id: rid(6), userId: req.user.id, title, url, type, budget, spent: 0, status: 'In review', createdAt: new Date().toISOString() };
  db.get().campaigns.push(c);
  db.save();
  res.json({ ok: true, campaign: c });
});

// =============================================================================
//  SURVEYS  —  catalog + one-time completion reward (USD)
// =============================================================================
app.get('/api/surveys', requireAuth, (req, res) => {
  const done = new Set(req.user[SURVEY_DONE] || []);
  res.json({
    surveys: surveysMod.SURVEYS.map((s) => ({
      id: s.id, title: s.title, minutes: s.minutes, reward: s.reward,
      questions: s.questions, done: done.has(s.id),
    })),
  });
});

app.post('/api/surveys/:id/complete', requireAuth, (req, res) => {
  const survey = surveysMod.byId(req.params.id);
  if (!survey) return res.status(404).json({ error: 'Survey not found.' });
  const done = req.user[SURVEY_DONE] || (req.user[SURVEY_DONE] = []);
  if (done.includes(survey.id)) return res.status(409).json({ error: 'You have already completed this survey.' });
  const answers = req.body.answers || {};
  if (Object.keys(answers).length < survey.questions.length) {
    return res.status(400).json({ error: 'Please answer all questions.' });
  }
  done.push(survey.id);
  req.user.usd = round2((req.user.usd || 0) + survey.reward);
  db.save();
  res.json({ ok: true, reward: survey.reward, balanceUSD: round2(req.user.usd), message: `Survey complete. You earned $${survey.reward.toFixed(2)}.` });
});

// =============================================================================
//  EARNINGS  —  breakdown by source
// =============================================================================
app.get('/api/earnings', requireAuth, (req, res) => {
  const u = req.user;
  const subs = mySubmissions(u.id);
  const taskUSD = round2(subs.filter((x) => x.status === 'approved').reduce((a, x) => a + x.reward, 0));
  const surveyUSD = round2((u[SURVEY_DONE] || []).reduce((a, id) => a + ((surveysMod.byId(id) || {}).reward || 0), 0));
  res.json({
    balanceKES: round2(u.balance), balanceUSD: round2(u.usd),
    sources: [
      { key: 'tasks', label: 'Tasks', usd: taskUSD, kes: 0 },
      { key: 'surveys', label: 'Surveys', usd: surveyUSD, kes: 0 },
      { key: 'referrals', label: 'Referral bonus', usd: 0, kes: round2(u.referralEarningsKES || 0), note: `${u.referralCount || 0} referral(s)` },
      { key: 'games', label: 'Games', usd: 0, kes: 0, note: 'Coming soon' },
      { key: 'clicks', label: 'Paid clicks', usd: 0, kes: 0, note: 'Coming soon' },
    ],
  });
});

// =============================================================================
//  INVESTMENTS  —  plans, invest from KES wallet, active/history, auto-maturity
// =============================================================================
// Overview + full list for the member. Funds an investment from the KES wallet;
// principal + interest is credited back to the wallet automatically at maturity.
app.get('/api/investments', requireAuth, (req, res) => {
  matureInvestments();
  const mine = db.get().investments
    .filter((i) => i.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(publicInvestment);
  const active = mine.filter((i) => i.status === 'active');
  const completed = mine.filter((i) => i.status === 'completed');
  res.json({
    plans: investmentPlans(),
    methods: INVEST_METHODS,
    methodInfo: investMethodsInfo(),
    local: currencyFor(req.user.profile && req.user.profile.country), // { code, perUSD, symbol }
    walletUSD: round2(req.user.usd),
    summary: {
      totalInvested: round2(active.reduce((a, i) => a + i.principal, 0)),
      currentEarnings: round2(active.reduce((a, i) => a + i.currentEarnings, 0)),
      availableForWithdrawal: round2(req.user.usd),
      totalReturned: round2(completed.reduce((a, i) => a + i.expectedReturn, 0)),
      activeCount: active.length,
      completedCount: completed.length,
    },
    investments: mine,
  });
});

app.get('/api/investments/:id', requireAuth, (req, res) => {
  matureInvestments();
  const inv = db.get().investments.find((i) => i.id === req.params.id && i.userId === req.user.id);
  if (!inv) return res.status(404).json({ error: 'Investment not found.' });
  res.json({ investment: publicInvestment(inv) });
});

// Start the clock once payment is confirmed: the lock period runs from activation,
// not from when the (unpaid) record was created.
function activateInvestment(inv) {
  if (inv.status !== 'pending') return;
  const start = new Date();
  inv.status = 'active';
  inv.paid = true;
  inv.paidAt = start.toISOString();
  inv.startDate = start.toISOString();
  inv.maturityDate = new Date(start.getTime() + inv.durationDays * 86400000).toISOString();
  inv.updatedAt = start.toISOString();
}

// Where the browser should be sent back to after a hosted-checkout redirect.
const appBase = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

// Create an investment as PENDING, then kick off real payment via the chosen method.
// The investment only starts earning after the payment is confirmed.
app.post('/api/investments', requireAuth, async (req, res) => {
  const planId = String(req.body.planId || '').trim();
  const amount = round2(req.body.amount);
  const method = String(req.body.method || '').trim();
  const phone = String(req.body.phone || '').trim();
  const plan = investmentsMod.byId(planId, investmentRates());
  if (!plan) return res.status(400).json({ error: 'Choose a valid investment plan.' });
  if (!INVEST_METHODS.includes(method)) return res.status(400).json({ error: 'Choose a payment method.' });
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount.' });
  if (amount < plan.min) return res.status(400).json({ error: `The ${plan.name} minimum is $${plan.min.toLocaleString()}.` });
  if (plan.max != null && amount > plan.max) return res.status(400).json({ error: `The ${plan.name} maximum is $${plan.max.toLocaleString()}.` });
  if (!investMethodConfigured(method)) {
    return res.status(503).json({ error: `${method} payments aren't set up yet. Add the ${method} API keys to .env and restart to enable this method.` });
  }

  ensureUserShape(req.user);
  const expectedInterest = investmentsMod.computeInterest(amount, plan.rate, plan.days);
  const inv = {
    id: 'INV' + rid(4).toUpperCase(),
    userId: req.user.id, planId: plan.id, planName: plan.name,
    principal: amount, interestRate: plan.rate, durationDays: plan.days,
    expectedInterest, expectedReturn: round2(amount + expectedInterest),
    paymentMethod: method, currency: 'USD', status: 'pending', paid: false, walletCredited: false,
    startDate: null, maturityDate: null, provider: null,
    completedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.get().investments.push(inv);
  db.save();

  try {
    if (method === 'M-Pesa') {
      if (!/^(?:254|0)\d{9}$/.test(phone.replace(/\s+/g, ''))) {
        return res.status(400).json({ error: 'Enter a valid M-Pesa phone number (e.g. 0712345678).' });
      }
      const amountKES = Math.max(1, Math.round(amount * FX_KES_PER_USD));
      const push = await payments.mpesaStkPush({ phone, amount: amountKES, accountRef: 'Gweno Invest', description: `${plan.name} investment` });
      inv.provider = { type: 'mpesa-stk', method, amountKES, ...push };
      db.save();
      return res.status(201).json({ ok: true, mode: 'stk', id: inv.id, investment: publicInvestment(inv),
        message: `Enter your M-Pesa PIN to pay KES ${amountKES.toLocaleString()} (≈ $${amount}) and start your ${plan.name}.` });
    }
    // Card / Stripe / PayPal / Paystack — hosted checkout redirect.
    const ref = 'inv_' + rid(10);
    const returnUrl = `${appBase(req)}/api/investments/pay/return?id=${inv.id}`;
    const cancelUrl = `${appBase(req)}/dashboard.html#/invest?payfail=${inv.id}`;
    const args = { amountUSD: amount, email: req.user.email, ref, returnUrl, cancelUrl };
    // Paystack settles in the account currency (default KES) — convert from USD.
    if (method === 'Paystack') {
      const cur = (process.env.PAYSTACK_CURRENCY || 'KES').toUpperCase();
      args.currency = cur;
      args.amountMajor = cur === 'KES' ? Math.round(amount * FX_KES_PER_USD) : amount;
    }
    const { url, providerRef } = await investPay.createCheckout(method, args);
    inv.provider = { type: method.toLowerCase(), method, ref, providerRef, currency: args.currency || 'USD', amountCharged: args.amountMajor || amount };
    db.save();
    return res.status(201).json({ ok: true, mode: 'redirect', id: inv.id, url,
      message: `Redirecting to ${method} to pay $${amount}…` });
  } catch (err) {
    inv.status = 'failed'; inv.error = String(err.message || err); db.save();
    return res.status(502).json({ error: `Could not start ${method} payment: ${inv.error}` });
  }
});

// Poll a pending investment (used while the M-Pesa STK prompt is open).
app.get('/api/investments/:id/status', requireAuth, (req, res) => {
  const inv = db.get().investments.find((i) => i.id === req.params.id && i.userId === req.user.id);
  if (!inv) return res.status(404).json({ error: 'Investment not found.' });
  res.json({ status: inv.status, paid: !!inv.paid, investment: publicInvestment(inv) });
});

// Manual re-check (SPA fallback) — verifies with the provider and activates if paid.
app.post('/api/investments/:id/verify', requireAuth, async (req, res) => {
  const inv = db.get().investments.find((i) => i.id === req.params.id && i.userId === req.user.id);
  if (!inv) return res.status(404).json({ error: 'Investment not found.' });
  if (inv.status === 'active' || inv.status === 'completed') return res.json({ ok: true, status: inv.status });
  if (!inv.provider || inv.provider.type === 'mpesa-stk') return res.json({ ok: false, status: inv.status });
  try {
    const paid = await investPay.verify(inv.provider.method, inv.provider.providerRef);
    if (paid) { activateInvestment(inv); db.save(); }
    res.json({ ok: paid, status: inv.status });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// Provider redirects the browser here after a hosted-checkout payment.
app.get('/api/investments/pay/return', async (req, res) => {
  const inv = db.get().investments.find((i) => i.id === String(req.query.id || ''));
  if (!inv || !inv.provider) return res.redirect('/dashboard.html#/invest');
  try {
    if (inv.status === 'pending' && await investPay.verify(inv.provider.method, inv.provider.providerRef)) {
      activateInvestment(inv); db.save();
    }
  } catch (_) { /* fall through to the SPA, which will show the pending state */ }
  const done = inv.status === 'active' || inv.status === 'completed';
  res.redirect(`/dashboard.html#/invest?${done ? 'paid' : 'payfail'}=${inv.id}`);
});

// ---- Admin: investment statistics, all investments, interest settings ----
app.get('/api/admin/investments', requireAdminSession, (req, res) => {
  matureInvestments();
  const S = db.get();
  const list = (S.investments || []).map((inv) => {
    const u = userById(inv.userId);
    return { ...publicInvestment(inv), user: u ? { username: u.username, email: u.email } : null };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = list.filter((i) => i.status === 'active');
  const completed = list.filter((i) => i.status === 'completed');
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    plans: investmentPlans(),
    rates: investmentRates(),
    stats: {
      investors: new Set((S.investments || []).map((i) => i.userId)).size,
      totalInvested: round2((S.investments || []).reduce((a, i) => a + i.principal, 0)),
      activeValue: round2(active.reduce((a, i) => a + i.principal, 0)),
      activeCount: active.length,
      completedCount: completed.length,
      todayInvested: round2((S.investments || []).filter((i) => (i.createdAt || '').slice(0, 10) === today).reduce((a, i) => a + i.principal, 0)),
      todayMaturing: round2(active.filter((i) => (i.maturityDate || '').slice(0, 10) === today).reduce((a, i) => a + i.expectedReturn, 0)),
      expectedPayout: round2(active.reduce((a, i) => a + i.expectedReturn, 0)),
    },
    investments: list,
  });
});

app.post('/api/admin/investment-rates', requireAdminSession, (req, res) => {
  const S = db.get();
  S.investmentRates = S.investmentRates || {};
  for (const p of investmentsMod.PLANS) {
    const v = req.body[p.id];
    if (v === undefined || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: `Enter a valid rate (0–100%) for ${p.name}.` });
    }
    S.investmentRates[p.id] = round2(n);
  }
  db.save();
  res.json({ ok: true, rates: S.investmentRates, plans: investmentPlans(), message: 'Interest settings saved.' });
});

// =============================================================================
//  STATS  —  submission activity for charts + table
// =============================================================================
app.get('/api/stats', requireAuth, (req, res) => {
  const subs = mySubmissions(req.user.id);
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const inRange = subs.filter((x) => {
    const d = (x.createdAt || '').slice(0, 10);
    return (!from || d >= from) && (!to || d <= to);
  });
  const byDay = {};
  inRange.forEach((x) => {
    const d = (x.createdAt || '').slice(0, 10);
    byDay[d] = byDay[d] || { date: d, completions: 0, approved: 0, reward: 0 };
    byDay[d].completions += 1;
    if (x.status === 'approved') { byDay[d].approved += 1; byDay[d].reward += x.reward; }
  });
  const rows = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ ...r, reward: round2(r.reward) }));
  res.json({
    rows,
    totals: {
      completions: inRange.length,
      approved: inRange.filter((x) => x.status === 'approved').length,
      pending: inRange.filter((x) => x.status === 'pending').length,
      rejected: inRange.filter((x) => x.status === 'rejected').length,
      rewardUSD: round2(inRange.filter((x) => x.status === 'approved').reduce((a, x) => a + x.reward, 0)),
    },
  });
});

// ---- Not-found + error handlers (registered after all routes) ----
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[gweno] unhandled error:', err && err.message, err && err.stack);
  if (req.path.startsWith('/api')) return res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
  res.status(500).sendFile(path.join(__dirname, 'public', '500.html'));
});

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  Gweno running -> http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise storage:', err.message);
    process.exit(1);
  });

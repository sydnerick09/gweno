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
const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000;      // passwordless sign-in link valid 15 min
const MAGIC_MAX_REQUESTS = 4;                    // max magic links per email per window
const MAGIC_WINDOW_MS = 15 * 60 * 1000;         // ... per email per 15 min
const BCRYPT_ROUNDS = 12;
const COOKIE = 'gweno_session';

// ---- Members-area policy ----------------------------------------------------
const REF_BONUS_KES = 5;                                 // paid per successful referral
const PAYMENT_METHODS = ['M-Pesa', 'PayPal', 'Bank account']; // WITHDRAWAL destinations (legacy)
const SETTINGS_PAYMENT_METHODS = ['M-Pesa', 'Card', 'PayPal', 'Bank account', 'Apple Pay', 'Stripe']; // saved in Settings
const DEPOSIT_METHODS = ['M-Pesa', 'Card', 'PayPal', 'Bank account', 'Paystack']; // top-up methods
const WITHDRAW_METHODS = ['M-Pesa', 'PayPal', 'Bank account']; // cash-out methods (M-Pesa in KES, rest USD)
const COMING_SOON_METHODS = ['Card', 'Stripe', 'Apple Pay']; // shown but not usable until their keys are wired
// Receiving bank account for manual bank-transfer deposits — shown to the user BEFORE they pay.
// Configure via .env; returns null (feature hidden) until at least a name + account number exist.
function bankDetails() {
  const d = {
    bankName: process.env.DEPOSIT_BANK_NAME || '',
    accountName: process.env.DEPOSIT_BANK_ACCOUNT_NAME || '',
    accountNumber: process.env.DEPOSIT_BANK_ACCOUNT_NUMBER || '',
    branch: process.env.DEPOSIT_BANK_BRANCH || '',
    swift: process.env.DEPOSIT_BANK_SWIFT || '',
    instructions: process.env.DEPOSIT_BANK_INSTRUCTIONS || '',
  };
  return (d.bankName && d.accountNumber) ? d : null;
}
const INVEST_METHODS = ['Card', 'Stripe', 'PayPal', 'M-Pesa', 'Paystack'];      // fund an investment (USD)
// Which invest payment methods have their keys in .env (else the method is offered
// but returns a clear "add your keys" message when chosen). 'Card' is processed by Stripe.
const investPay = require('./investPay');
function investMethodConfigured(method) {
  if (method === 'M-Pesa') return payments.mpesaStkConfigured();
  if (method === 'Stripe') return investPay.stripeConfigured();
  if (method === 'Paystack' || method === 'Card') return investPay.paystackConfigured(); // Card = pay by card via Paystack
  if (method === 'PayPal') return investPay.paypalConfigured();
  return false;
}
const investMethodsInfo = () => INVEST_METHODS.map((key) => ({ key, configured: investMethodConfigured(key) }));
const USERNAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;   // username changeable once / 30 days
const MIN_REDEEM = { KES: 39, USD: 0.3 };        // minimum cash-out: $0.30 (M-Pesa ≈ 39 KES)
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

// M-Pesa Daraja server-to-server callbacks must hit a PUBLIC https URL. We auto-derive
// them (explicit env override -> PUBLIC_URL when not localhost -> the current request
// host, which is your live domain on Vercel), so you only need the CORE M-Pesa keys:
// MPESA_CONSUMER_KEY/SECRET, MPESA_STK_SHORTCODE, MPESA_PASSKEY, MPESA_SHORTCODE,
// MPESA_INITIATOR_NAME, MPESA_SECURITY_CREDENTIAL (+ MPESA_ENV, MPESA_COMMAND_ID).
function mpesaBase(req) {
  const pub = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (pub && !/localhost|127\.0\.0\.1/.test(pub)) return pub;
  return `${req.protocol}://${req.get('host')}`;
}
const stkCallbackUrl = (req) => process.env.MPESA_STK_CALLBACK_URL || `${mpesaBase(req)}/api/mpesa/stk-callback`;
const b2cResultUrl = (req) => process.env.MPESA_RESULT_URL || `${mpesaBase(req)}/api/mpesa/result`;
const b2cTimeoutUrl = (req) => process.env.MPESA_TIMEOUT_URL || `${mpesaBase(req)}/api/mpesa/timeout`;

app.set('trust proxy', 1); // trust the first proxy (correct client IPs when deployed)
app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf; } })); // raw body kept for Paystack webhook signature
app.use(express.urlencoded({ extended: false })); // Apple OAuth returns via form_post
app.use(cookieParser());

// ---- Security headers (clickjacking, MIME-sniffing, XSS defense-in-depth) ----
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  // CSP allows Google AdSense (script + ad frames + ad images) so ads load and the
  // site can be verified by the AdSense crawler.
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.googleadservices.com https://adservice.google.com https://*.google.com https://*.doubleclick.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://challenges.cloudflare.com https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.google.com https://*.doubleclick.net; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "frame-src https://challenges.cloudflare.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net https://www.google.com; " +
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

// ---- Tighter per-IP limiter for abuse-prone endpoints (auth, resets, payouts) ----
// The global limiter (above) stops floods; this caps credential-stuffing / spam that
// stays under 200/min. Keyed by bucket+IP so each sensitive route has its own budget.
const strictBuckets = new Map();
setInterval(() => { const t = now(); for (const [k, v] of strictBuckets) if (v.reset < t) strictBuckets.delete(k); }, 10 * 60 * 1000).unref();
function rateLimit(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = `${bucket}:${req.ip || 'unknown'}`;
    const t = Date.now();
    let b = strictBuckets.get(key);
    if (!b || b.reset < t) { b = { count: 0, reset: t + windowMs }; strictBuckets.set(key, b); }
    b.count += 1;
    if (b.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((b.reset - t) / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }
    next();
  };
}

// ---- Same-origin only: reject cross-site API calls (server-to-server callbacks have no Origin) ----
app.use('/api', (req, res, next) => {
  // OAuth provider callbacks and payment webhooks legitimately arrive cross-origin.
  if (req.path.startsWith('/oauth/') || req.path.startsWith('/mpesa/') || req.path.startsWith('/paystack/')) return next();
  const origin = req.headers.origin;
  if (origin) {
    let oHost;
    try { oHost = new URL(origin).host; } catch (_) { return res.status(403).json({ error: 'Invalid origin.' }); }
    if (oHost !== req.headers.host) return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Kick off storage init once (works both as a long-running server and on serverless).
const dbReady = Promise.resolve(db.init()).catch((err) => console.error('[gweno] storage init failed:', err && err.message));
const ON_VERCEL = !!process.env.VERCEL;

// Serverless request guard. Each Vercel invocation may be a different instance, so
// for API calls we (1) reload fresh state from Postgres so a session created on
// another instance is visible here (fixes the sign-in bounce), and (2) flush the
// pending write before responding so nothing is lost when the function freezes.
// Writes snapshot state at save-time (see db.persist), so this reload can't clobber
// a just-created session. With Supabase's transaction pooler the reload is cheap.
app.use(async (req, res, next) => {
  try { await dbReady; } catch (_) {}
  if (ON_VERCEL && req.path.startsWith('/api')) {
    if (db.reload) { try { await db.reload(); } catch (_) {} }
    if (db.flush) {
      for (const name of ['json', 'redirect']) {
        const orig = res[name].bind(res);
        res[name] = (...args) => { db.flush().finally(() => orig(...args)); return res; };
      }
    }
  }
  next();
});

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
// Strict-but-inclusive email check: valid local part, a real domain with a TLD (>=2
// letters). Accepts Gmail/Outlook/Yahoo/iCloud/custom domains; rejects malformed input
// (missing @, no TLD, spaces, leading/trailing/consecutive dots, over-long addresses).
const isEmail = (e) => {
  const s = String(e || '').trim();
  if (!s || s.length > 254 || /\s/.test(s) || s.includes('..')) return false;
  const at = s.lastIndexOf('@');
  if (at < 1) return false;
  const local = s.slice(0, at), domain = s.slice(at + 1);
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.')) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.startsWith('-')) return false;
  return /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/.test(domain);
};
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

// Cloudflare Turnstile (bot protection). Gated on TURNSTILE_SECRET: when the key
// isn't set the check is a no-op, so signup keeps working until keys are added.
const turnstileEnabled = () => !!(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET);
async function verifyTurnstile(token, ip) {
  if (!process.env.TURNSTILE_SECRET) return true; // not configured -> allow
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: String(token) });
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const d = await r.json();
    return !!d.success;
  } catch (e) { console.error('[gweno] turnstile verify failed:', e.message); return false; }
}

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
  if (!u.tour) u.tour = { done: false, skips: 0, lastSkipAt: null }; // first-login guided tour
  if (u.suspended === undefined) u.suspended = false; // admin: blocks sign-in
  if (u.held === undefined) u.held = false;           // admin: pauses withdrawals
  return u;
}

// Credit the referrer 5 KES and burn their single-use link.
// At signup: burn the single-use link and remember who referred this user. The
// 5 KES bonus is NOT paid yet — it's only paid once the new user finishes the
// welcome questions (see payReferralOnOnboarding).
function creditReferral(refCode, newUser) {
  const code = String(refCode || '').trim();
  if (!code) return;
  const owner = db.get().users.find((u) => u.referral && u.referral.code === code && !u.referral.used && u.id !== newUser.id);
  if (!owner) return;
  owner.referral.used = true;          // link is single-use — a fresh one is issued next load
  newUser.referredBy = owner.id;
  newUser.referralCredited = false;    // becomes true when the referrer is paid at onboarding
}

// At onboarding: pay the referrer their 5 KES, once, after the new user answers
// the welcome questions.
function payReferralOnOnboarding(newUser) {
  if (!newUser.referredBy || newUser.referralCredited) return;
  const owner = userById(newUser.referredBy);
  if (!owner) return;
  ensureUserShape(owner);
  owner.balance = round2((owner.balance || 0) + REF_BONUS_KES);
  owner.referralEarningsKES = round2((owner.referralEarningsKES || 0) + REF_BONUS_KES);
  owner.referralCount = (owner.referralCount || 0) + 1;
  newUser.referralCredited = true;
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
    tour: u.tour || { done: false, skips: 0, lastSkipAt: null },
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
  if (req.user.suspended) return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
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
// Time-based so the figures grow steadily and wobble a little (they feel live and
// "update over time") while staying realistic and presentable across restarts.
const STATS_EPOCH = Date.UTC(2026, 0, 1);
// Deterministic pseudo-random wobble in the range [-range, +range] from a seed.
function statWobble(seed, range) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return Math.round(((x - Math.floor(x)) * 2 - 1) * range);
}
app.get('/api/public/stats', (req, res) => {
  const now = Date.now();
  const hours = Math.max(0, (now - STATS_EPOCH) / 3600000);
  const tick = Math.floor(now / 45000); // the wobble changes roughly every 45 seconds
  const members = 14340 + Math.floor(hours * 0.8) + statWobble(tick, 4) + 4;
  const workers = Math.round(members * 0.70) + statWobble(tick + 7, 3);
  const tasksLive = 1470 + (Math.floor(hours * 0.3) % 300) + statWobble(tick + 3, 10) + 10;
  const tasksCompleted = 68420 + Math.floor(hours * 4) + statWobble(tick + 11, 6);
  res.json({
    members,
    workers,
    tasksLive: Math.max(200, tasksLive),
    tasksCompleted,
  });
});

// Public client config: the Turnstile site key (safe to expose) so the browser can
// render the CAPTCHA widget. Empty when CAPTCHA isn't configured -> client skips it.
app.get('/api/config', (req, res) => {
  res.json({ turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '' });
});

// =============================================================================
//  SIGN UP  (email + password)                     — guards #2 (duplicate email)
// =============================================================================
app.post('/api/signup', rateLimit('signup', 15, 10 * 60 * 1000), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normEmail(req.body.email);
    const username = String(req.body.username || '').trim();
    const password = req.body.password;
    const country = String(req.body.country || '').trim();
    const phone = String(req.body.phone || '').trim();
    const deviceId = String(req.body.deviceId || '').trim();

    // Bot protection: verify the Turnstile token (no-op until keys are configured).
    if (!(await verifyTurnstile(req.body.captcha, req.ip))) {
      return res.status(400).json({ error: 'Please complete the "I\'m not a robot" check and try again.' });
    }

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
app.post('/api/login', rateLimit('login', 30, 10 * 60 * 1000), async (req, res) => {
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

    // Suspended accounts can't sign in (admin can suspend/unsuspend from the admin panel).
    if (user.suspended) return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });

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
    if (user.suspended) return res.redirect('/login.html?error=suspended');
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
app.post('/api/forgot-password', rateLimit('forgot', 10, 15 * 60 * 1000), async (req, res) => {
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
      // Await on serverless so the email actually sends before the function freezes.
      try { await mailer.sendPasswordReset(user.email, link); }
      catch (e) { console.error('[gweno] reset email failed:', e.message); }
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
app.post('/api/reset-password', rateLimit('reset', 20, 15 * 60 * 1000), async (req, res) => {
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
//  MAGIC LINK  (passwordless sign-in for existing accounts)
// =============================================================================
//  Flow: /start emails a one-time link -> /verify consumes it and opens a session.
//  Non-enumerating (same reply whether or not the email exists) and single-use, like
//  the reset flow. New users still sign up with the form (name/username/device).
app.post('/api/auth/magic/start', rateLimit('magic', 8, 15 * 60 * 1000), async (req, res) => {
  const email = normEmail(req.body.email);
  if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!mailer.configured()) return res.status(503).json({ error: 'Email sign-in isn\'t available right now. Please use your password.' });

  const s = db.get();
  s.magicRequests = s.magicRequests || {};
  s.magicTokens = s.magicTokens || [];

  // Per-email throttle so the endpoint can't be used to spam someone's inbox.
  const win = s.magicRequests[email];
  let allowed = true;
  if (win && win.windowStart > now() - MAGIC_WINDOW_MS) {
    if (win.count >= MAGIC_MAX_REQUESTS) allowed = false; else win.count += 1;
  } else {
    s.magicRequests[email] = { windowStart: now(), count: 1 };
  }

  const user = findUserByEmail(email);
  if (user && !user.suspended && allowed) {
    s.magicTokens = s.magicTokens.filter((t) => t.userId !== user.id); // only the newest link works
    const raw = rid(24);
    s.magicTokens.push({
      tokenHash: sha(raw), userId: user.id, createdAt: now(),
      expiresAt: now() + MAGIC_TOKEN_TTL_MS, used: false,
    });
    const link = `${baseUrl(req)}/api/auth/magic/verify?token=${raw}`;
    try { await mailer.sendMagicLink(user.email, link); }
    catch (e) { console.error('[gweno] magic link email failed:', e.message); }
  }
  db.save();
  res.json({ ok: true, message: 'If that email is registered, a sign-in link is on its way. Check your inbox.' });
});

app.get('/api/auth/magic/verify', async (req, res) => {
  const raw = String(req.query.token || '');
  const s = db.get();
  s.magicTokens = s.magicTokens || [];
  const rec = raw ? s.magicTokens.find((t) => t.tokenHash === sha(raw)) : null;
  if (!rec || rec.used || rec.expiresAt <= now()) return res.redirect('/login.html?error=magic_invalid');
  const user = s.users.find((u) => u.id === rec.userId);
  if (!user || user.suspended) return res.redirect('/login.html?error=magic_invalid');
  rec.used = true;                       // single-use
  delete s.attempts[user.email];         // clear any password-lockout
  createSession(res, user.id);           // opens the session cookie (+ db.save)
  res.redirect(user.onboarded ? '/app.html#/dashboard' : '/onboarding.html');
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
  payReferralOnOnboarding(user); // pay the referrer their 5 KES now that questions are answered
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
  // Validate the proof against the task's type (typing / email / link / survey / photo /
  // social / data). Rejects junk like ".", "123" or random characters before review.
  const check = tasksMod.validateProof(task, proof);
  if (!check.ok) return res.status(400).json({ error: check.error });
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
    providers: u.providers || [],                       // how they joined (email / google / facebook / apple)
    suspended: !!u.suspended,
    held: !!u.held,
    hasPassword: !!u.passwordHash,                       // whether a password is set (never the value)
    gender: (u.profile && u.profile.gender) || '',
    country: (u.profile && u.profile.country) || '',
    phone: (u.profile && u.profile.phone) || '',
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ users });
});

// Suspend / unsuspend a member (blocks sign-in and drops their active sessions).
app.post('/api/admin/users/:id/suspend', requireAdminSession, (req, res) => {
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  u.suspended = !u.suspended;
  if (u.suspended) { const s = db.get(); s.sessions = (s.sessions || []).filter((x) => x.userId !== u.id); }
  db.save();
  res.json({ ok: true, suspended: !!u.suspended });
});

// Put an account on hold / release it. On hold: sign-in still works but withdrawals
// are paused (see the redeem endpoint).
app.post('/api/admin/users/:id/hold', requireAdminSession, (req, res) => {
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  ensureUserShape(u);
  u.held = !u.held;
  db.save();
  res.json({ ok: true, held: !!u.held });
});

// Set a member's balance directly (KES wallet and/or USD wallet).
app.post('/api/admin/users/:id/balance', requireAdminSession, (req, res) => {
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  ensureUserShape(u);
  if (req.body.balance !== undefined) {
    const kesV = Number(req.body.balance);
    if (!Number.isFinite(kesV) || kesV < 0) return res.status(400).json({ error: 'Enter a valid KES amount.' });
    u.balance = round2(kesV);
  }
  if (req.body.usd !== undefined) {
    const usdV = Number(req.body.usd);
    if (!Number.isFinite(usdV) || usdV < 0) return res.status(400).json({ error: 'Enter a valid USD amount.' });
    u.usd = round2(usdV);
  }
  db.save();
  res.json({ ok: true, balance: round2(u.balance), usd: round2(u.usd) });
});

// Change a member's email address.
app.post('/api/admin/users/:id/email', requireAdminSession, (req, res) => {
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const newEmail = normEmail(req.body.email);
  if (!isEmail(newEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (newEmail !== u.email && findUserByEmail(newEmail)) return res.status(409).json({ error: 'That email is already in use.' });
  u.email = newEmail;
  db.save();
  res.json({ ok: true, email: u.email });
});

// Set a NEW password for a member. Passwords are stored only as a one-way bcrypt
// hash and can never be read back — the admin can reset it, not view it.
app.post('/api/admin/users/:id/password', requireAdminSession, async (req, res) => {
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const pw = req.body.password;
  const pe = passwordProblem(pw);
  if (pe) return res.status(400).json({ error: pe });
  u.passwordHash = await bcrypt.hash(pw, BCRYPT_ROUNDS);
  if (!u.providers) u.providers = [];
  if (!u.providers.includes('email')) u.providers.push('email');
  // Sign the user out everywhere so the new password takes effect.
  const s = db.get();
  s.sessions = (s.sessions || []).filter((x) => x.userId !== u.id);
  db.save();
  res.json({ ok: true, message: 'Password updated.' });
});

// Permanently delete a member and all their data.
app.delete('/api/admin/users/:id', requireAdminSession, (req, res) => {
  const s = db.get();
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  s.users = (s.users || []).filter((x) => x.id !== u.id);
  s.sessions = (s.sessions || []).filter((x) => x.userId !== u.id);
  s.submissions = (s.submissions || []).filter((x) => x.userId !== u.id);
  s.investments = (s.investments || []).filter((x) => x.userId !== u.id);
  s.redemptions = (s.redemptions || []).filter((x) => x.userId !== u.id);
  s.deposits = (s.deposits || []).filter((x) => x.userId !== u.id);
  db.save();
  res.json({ ok: true });
});

// Download a sanitised snapshot of the data (no password hashes or session tokens).
app.get('/api/admin/export', requireAdminSession, (req, res) => {
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

// Admin verifies a withdrawal, then releases (Paid) or rejects (Failed) it.
// Rejecting refunds the held USD. Approving an M-Pesa payout triggers the real
// B2C send when M-Pesa is configured; otherwise it's marked Paid (send manually).
app.post('/api/admin/redemptions/:id/mark', requireAdminSession, async (req, res) => {
  const rec = db.get().redemptions.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Redemption not found.' });
  const status = String(req.body.status || '');
  if (!['Paid', 'Failed', 'Processing'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const heldUSD = rec.amountUSD != null ? rec.amountUSD : rec.amount; // USD that was held

  if (status === 'Failed' && rec.status !== 'Failed') {
    const u = userById(rec.userId); // refund the held USD on rejection
    if (u) { ensureUserShape(u); u.usd = round2(u.usd + heldUSD); }
    rec.status = 'Failed'; rec.reviewedAt = new Date().toISOString();
    db.save();
    return res.json({ ok: true, redemption: rec });
  }

  // Approving an M-Pesa payout: actually send it via B2C when configured.
  if (status === 'Paid' && rec.method === 'M-Pesa' && rec.status !== 'Paid' && payments.mpesaConfigured()) {
    const kesAmount = rec.currency === 'KES' ? Math.round(rec.amount) : Math.round(heldUSD * FX_KES_PER_USD);
    try {
      rec.provider = { type: 'mpesa', kesAmount, ...(await payments.mpesaB2C({ phone: rec.destination, amount: kesAmount, resultUrl: b2cResultUrl(req), timeoutUrl: b2cTimeoutUrl(req) })) };
      rec.status = 'Processing'; rec.reviewedAt = new Date().toISOString(); // final Paid/Failed comes on the M-Pesa result callback
      db.save();
      return res.json({ ok: true, redemption: rec, message: `M-Pesa payout of ${kesAmount.toLocaleString()} KES submitted.` });
    } catch (err) {
      rec.error = String(err.message || err); db.save();
      return res.status(502).json({ error: 'M-Pesa payout failed: ' + rec.error });
    }
  }

  rec.status = status; rec.reviewedAt = new Date().toISOString();
  db.save();
  res.json({ ok: true, redemption: rec });
});

app.get('/api/admin/support', requireAdminSession, (req, res) => {
  const tickets = db.get().support.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ tickets, emailReady: mailer.configured() });
});

// Reply to a support message — saves the reply and emails it to the member.
app.post('/api/admin/support/:id/reply', requireAdminSession, async (req, res) => {
  const ticket = db.get().support.find((t) => t.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Support message not found.' });
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Enter a reply message.' });
  ticket.replies = ticket.replies || [];
  ticket.replies.push({ message, at: new Date().toISOString() });
  db.save();
  if (!mailer.configured()) return res.json({ ok: true, emailed: false, message: 'Reply saved. (Email is not set up, so it was not sent — configure SMTP to email members.)' });
  try {
    await mailer.send({
      to: ticket.email,
      subject: `Re: ${ticket.subject || 'Your Gweno support message'}`,
      text: `${message}\n\n— Gweno Support\n\n------\nIn reply to your message:\n"${ticket.message}"`,
    });
    res.json({ ok: true, emailed: true, message: `Reply emailed to ${ticket.email}.` });
  } catch (err) {
    res.status(502).json({ error: 'Reply saved, but the email failed: ' + (err.message || err) });
  }
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
//  ONBOARDING TOUR  —  remember whether to show the first-login walkthrough.
//  'done'  = completed or dismissed for good.
//  'skip'  = skipped; re-prompt schedule is 5 min -> 24 h -> never (3rd skip = done).
// =============================================================================
app.post('/api/tour', requireAuth, (req, res) => {
  ensureUserShape(req.user);
  const action = String(req.body.action || '').trim();
  const t = req.user.tour;
  if (action === 'done') {
    t.done = true;
  } else if (action === 'skip') {
    t.skips = (t.skips || 0) + 1;
    t.lastSkipAt = new Date().toISOString();
    if (t.skips >= 3) t.done = true; // skipped 3 times -> stop showing
  } else {
    return res.status(400).json({ error: 'Unknown tour action.' });
  }
  db.save();
  res.json({ ok: true, tour: t });
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

// Cash-outs: M-Pesa is entered/paid in KES (Kenyan users hold KES, not USD, in M-Pesa);
// PayPal & Bank are in USD. NOTHING is auto-paid — the amount is held (deducted) and the
// request is left "Requested" for an admin to verify and release from the admin panel.
// Rejecting a withdrawal refunds the held balance.
app.post('/api/redeem', rateLimit('redeem', 15, 10 * 60 * 1000), requireAuth, async (req, res) => {
  if (req.user.held) return res.status(403).json({ error: 'Your account is on hold, so withdrawals are paused. Please contact support.' });
  const method = String(req.body.method || '').trim();
  const rawAmount = round2(req.body.amount);
  let destination = String(req.body.destination || '').trim();
  const bankCode = String(req.body.bankCode || '').trim();
  const accountNumber = String(req.body.accountNumber || '').replace(/\s+/g, '');
  const idemKey = String(req.body.idempotencyKey || '').trim().slice(0, 80);

  // Idempotency: a repeated request (double-click, retry) never pays out twice.
  if (idemKey) {
    const existing = db.get().redemptions.find((r) => r.userId === req.user.id && r.idempotencyKey === idemKey);
    if (existing) return res.json({ ok: true, redemption: existing, duplicate: true, message: 'Withdrawal already submitted.' });
  }

  if (!WITHDRAW_METHODS.includes(method)) return res.status(400).json({ error: 'Choose a payout method.' });
  if (!(rawAmount > 0)) return res.status(400).json({ error: 'Enter a valid amount.' });

  const currency = method === 'M-Pesa' ? 'KES' : 'USD';           // M-Pesa in KES, others in USD
  const amountUSD = currency === 'KES' ? round2(rawAmount / FX_KES_PER_USD) : rawAmount;

  if (currency === 'KES' && rawAmount < MIN_REDEEM.KES) return res.status(400).json({ error: `Minimum M-Pesa withdrawal is ${MIN_REDEEM.KES} KES.` });
  if (currency === 'USD' && rawAmount < MIN_REDEEM.USD) return res.status(400).json({ error: `Minimum withdrawal is $${MIN_REDEEM.USD}.` });

  const paystackLive = investPay.paystackConfigured(); // real payouts via Paystack Transfers

  // Per-method destination validation.
  if (method === 'M-Pesa') {
    if (!/^(?:254|0)\d{9}$/.test(destination.replace(/\s+/g, ''))) return res.status(400).json({ error: 'Enter a valid M-Pesa phone number (e.g. 0712345678).' });
  } else if (method === 'PayPal') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destination)) return res.status(400).json({ error: 'Enter a valid PayPal email address.' });
  } else if (method === 'Bank account') {
    if (paystackLive) {
      if (!bankCode || accountNumber.length < 6) return res.status(400).json({ error: 'Choose your bank and enter a valid account number.' });
    } else if (destination.replace(/\s+/g, '').length < 6) {
      return res.status(400).json({ error: 'Enter your bank account details (name, bank and account number).' });
    }
  }

  if (amountUSD > combinedUSD(req.user)) return res.status(400).json({ error: 'Amount exceeds your available balance.' });

  // Which methods are REAL, automated Paystack payouts.
  const isBankReal = method === 'Bank account' && paystackLive && bankCode && accountNumber;
  const isMpesaReal = method === 'M-Pesa' && paystackLive;

  // Hold the funds (in USD) first, then attempt the payout; refund on any failure.
  deductCombined(req.user, 'USD', amountUSD);
  const reference = 'wd_' + (idemKey ? idemKey.replace(/[^A-Za-z0-9_]/g, '') : rid(10));
  const rec = {
    id: rid(8), userId: req.user.id, idempotencyKey: idemKey || null,
    amount: rawAmount, currency, amountUSD, method, destination, reference,
    status: 'Requested', createdAt: new Date().toISOString(), resultAt: null,
    provider: null, recipient: null, error: null,
  };
  db.get().redemptions.push(rec);
  db.save();
  console.log(`[gweno] withdrawal ${rec.id} user=${req.user.id} ${method} $${amountUSD} ref=${reference}`);

  const refund = () => { ensureUserShape(req.user); req.user.usd = round2(req.user.usd + amountUSD); };

  if (isBankReal || isMpesaReal) {
    const payoutCurrency = (process.env.PAYSTACK_CURRENCY || 'KES').toUpperCase();
    const amountLocal = payoutCurrency === 'KES' ? Math.round(amountUSD * FX_KES_PER_USD) : round2(amountUSD);
    try {
      let transferArgs, destLabel;
      if (isMpesaReal) {
        const phone = payments.normalizePhone(destination); // 2547XXXXXXXX
        rec.recipient = { type: 'mobile_money', provider: 'MPESA', phone };
        rec.destination = phone;
        destLabel = 'your M-Pesa (' + phone + ')';
        transferArgs = { type: 'mobile_money', name: req.user.name || 'Gweno member', accountNumber: phone, bankCode: 'MPESA', amountMajor: amountLocal, currency: payoutCurrency, reason: 'Gweno withdrawal', reference };
      } else {
        let name = String(req.body.accountName || '').trim();
        try { const rr = await investPay.paystackResolveAccount(accountNumber, bankCode); if (rr.accountName) name = rr.accountName; } catch (_) {}
        if (!name) name = req.user.name || 'Gweno member';
        rec.recipient = { type: 'bank', name, bankCode, accountNumber };
        rec.destination = destination || `${name} · ${accountNumber}`;
        destLabel = name;
        transferArgs = { type: 'nuban', name, accountNumber, bankCode, amountMajor: amountLocal, currency: payoutCurrency, reason: 'Gweno withdrawal', reference };
      }

      const t = await investPay.paystackTransfer(transferArgs);
      // Full audit trail of the provider response.
      rec.provider = {
        type: 'paystack-transfer', reference: t.reference || reference,
        transferCode: t.transferCode, transferId: t.transferId, recipientCode: t.recipientCode,
        amountLocal, currency: payoutCurrency, providerStatus: t.status, response: t.raw || null,
      };

      if (t.status === 'otp') {
        refund(); rec.status = 'Failed'; rec.error = 'otp_required'; rec.resultAt = new Date().toISOString();
        db.save();
        return res.status(503).json({ error: 'Automated payouts need OTP disabled on Paystack (Settings → Preferences → turn off "OTP for transfers"). Your balance was refunded.' });
      }
      // Only 'success' is final here; 'pending'/'processing' stay Processing until the webhook confirms.
      rec.status = t.status === 'success' ? 'Paid' : 'Processing';
      rec.resultAt = t.status === 'success' ? new Date().toISOString() : null;
      db.save();
      console.log(`[gweno] withdrawal ${rec.id} paystack status=${t.status}`);
      return res.json({ ok: true, redemption: publicRedemption(rec), message: `Payout of ${amountLocal.toLocaleString()} ${payoutCurrency} sent to ${destLabel}. Tracking status…` });
    } catch (err) {
      const raw = String(err.message || err);
      refund(); rec.status = 'Failed'; rec.error = raw; rec.resultAt = new Date().toISOString();
      db.save();
      console.error(`[gweno] withdrawal ${rec.id} FAILED: ${raw}`);
      // Merchant/config problems (payouts not enabled, insufficient float, OTP) shouldn't
      // be exposed to members — show a clean message, keep the real error for the admin.
      const merchantIssue = /starter business|third party payouts|balance|otp|not enabled|permission/i.test(raw);
      const msg = merchantIssue
        ? 'Withdrawals are temporarily unavailable. Your balance was not affected — please try again later.'
        : 'Payout failed: ' + raw + '. Your balance was refunded.';
      return res.status(502).json({ error: msg });
    }
  }

  // PayPal (or bank/M-Pesa when Paystack isn't configured) — held for admin verification.
  const shown = currency === 'KES' ? `${rawAmount.toLocaleString()} KES` : `$${rawAmount}`;
  return res.json({ ok: true, redemption: publicRedemption(rec),
    message: `Withdrawal of ${shown} via ${method} submitted. It will be sent once we verify it (usually within 24 hours).` });
});

// A member's own view of a withdrawal (no internal provider secrets).
function publicRedemption(r) {
  return {
    id: r.id, amount: r.amount, currency: r.currency, amountUSD: r.amountUSD,
    method: r.method, destination: r.destination, status: r.status,
    reference: r.reference, createdAt: r.createdAt, resultAt: r.resultAt, error: r.error || null,
  };
}

// Real-time status of a member's own withdrawal (frontend polls this).
app.get('/api/redemptions/:id/status', requireAuth, async (req, res) => {
  const rec = db.get().redemptions.find((r) => r.id === req.params.id && r.userId === req.user.id);
  if (!rec) return res.status(404).json({ error: 'Withdrawal not found.' });
  // If still processing and we have a Paystack reference, reconcile with the provider
  // (in case the webhook is delayed).
  if (rec.status === 'Processing' && rec.provider && rec.provider.type === 'paystack-transfer' && investPay.paystackConfigured()) {
    try {
      const s = await investPay.paystackTransferStatus(rec.provider.reference);
      if (s.status === 'success' && rec.status !== 'Paid') { rec.status = 'Paid'; rec.resultAt = new Date().toISOString(); db.save(); }
      else if ((s.status === 'failed' || s.status === 'reversed') && !/failed/i.test(rec.status)) {
        rec.status = 'Failed'; rec.error = s.status;
        const u = userById(rec.userId); if (u) { ensureUserShape(u); u.usd = round2(u.usd + (rec.amountUSD != null ? rec.amountUSD : rec.amount)); }
        rec.resultAt = new Date().toISOString(); db.save();
      }
    } catch (_) { /* keep Processing; webhook will finalise */ }
  }
  res.json({ status: rec.status, error: rec.error || null, resultAt: rec.resultAt || null });
});

// Banks available for bank withdrawals (Paystack). Used to populate the dropdown.
let BANKS_CACHE = { at: 0, banks: [] };
app.get('/api/banks', requireAuth, async (req, res) => {
  if (!investPay.paystackConfigured()) return res.json({ banks: [], live: false });
  if (Date.now() - BANKS_CACHE.at < 6 * 60 * 60 * 1000 && BANKS_CACHE.banks.length) {
    return res.json({ banks: BANKS_CACHE.banks, live: true });
  }
  try {
    const banks = await investPay.paystackBanks({ currency: (process.env.PAYSTACK_CURRENCY || 'KES'), country: 'kenya' });
    BANKS_CACHE = { at: Date.now(), banks };
    res.json({ banks, live: true });
  } catch (err) {
    res.json({ banks: BANKS_CACHE.banks, live: true, error: String(err.message || err) });
  }
});

// Paystack webhook — finalises transfers (and confirms charges). Point Paystack's
// dashboard webhook URL at https://<domain>/api/paystack/webhook.
app.post('/api/paystack/webhook', (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY || '';
  const sig = req.headers['x-paystack-signature'];
  const body = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const hash = crypto.createHmac('sha512', secret).update(body).digest('hex');
  if (!secret || sig !== hash) return res.status(401).json({ error: 'bad signature' });

  const evt = req.body || {};
  if (typeof evt.event === 'string' && evt.event.startsWith('transfer.')) {
    const ref = evt.data && evt.data.reference;
    const rec = db.get().redemptions.find((r) => r.provider && r.provider.reference === ref);
    if (rec && !/paid|failed/i.test(rec.status)) {
      if (evt.event === 'transfer.success') rec.status = 'Paid';
      else if (evt.event === 'transfer.failed' || evt.event === 'transfer.reversed') {
        rec.status = 'Failed';
        const u = userById(rec.userId);
        if (u) { ensureUserShape(u); u.usd = round2(u.usd + (rec.amountUSD != null ? rec.amountUSD : rec.amount)); }
      }
      rec.resultAt = new Date().toISOString();
      db.save();
    }
  }
  res.json({ received: true });
});

// M-Pesa B2C callbacks (point MPESA_RESULT_URL / MPESA_TIMEOUT_URL here via a public tunnel).
app.post('/api/mpesa/result', (req, res) => {
  // IMPORTANT: do the work (and db.save) BEFORE responding. On serverless the instance
  // can freeze right after the response, so anything after res.json() may never run.
  const r = req.body && req.body.Result;
  if (r) {
    const rec = db.get().redemptions.find((x) => x.provider && (
      x.provider.conversationId === r.ConversationID || x.provider.originatorConversationId === r.OriginatorConversationID));
    if (rec && !/paid|failed/i.test(rec.status)) {
      if (Number(r.ResultCode) === 0) {
        rec.status = 'Paid';
      } else {
        rec.status = 'Failed'; rec.error = r.ResultDesc;
        const u = userById(rec.userId); // refund the held USD if the payout fails
        if (u) { ensureUserShape(u); u.usd = round2(u.usd + (rec.amountUSD != null ? rec.amountUSD : rec.amount)); }
      }
      rec.resultAt = new Date().toISOString();
      db.save();
    }
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});
app.post('/api/mpesa/timeout', (req, res) => { res.json({ ok: true }); });

// =============================================================================
//  DEPOSITS  —  top up your KES wallet via M-Pesa STK Push (Lipa na M-Pesa)
// =============================================================================
app.get('/api/deposits', requireAuth, (req, res) => {
  const mine = db.get().deposits
    .filter((d) => d.userId === req.user.id && d.purpose !== 'subscription') // wallet top-ups only
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ deposits: mine, live: payments.mpesaStkConfigured(), min: DEPOSIT_MIN_KES, bank: bankDetails() });
});

app.post('/api/deposit', rateLimit('deposit', 25, 10 * 60 * 1000), requireAuth, async (req, res) => {
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
    rec.provider = { type: 'mpesa-stk', ...(await payments.mpesaStkPush({ phone, amount, accountRef: 'Gweno', description: 'Wallet top-up', callbackUrl: stkCallbackUrl(req) })) };
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
  if (COMING_SOON_METHODS.includes(method)) return res.status(503).json({ error: `${method} deposits are coming soon.` });
  if (method === 'Bank account' && !bankDetails()) return res.status(503).json({ error: 'Bank transfer isn\'t set up yet. Please use another method for now.' });
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount.' });
  const rec = {
    id: rid(8), userId: req.user.id, amount, currency: 'USD', reference: 'dep_' + rid(8),
    method, details, status: 'pending', createdAt: new Date().toISOString(), paidAt: null, error: null, provider: null,
  };
  db.get().deposits.push(rec);
  db.save();
  const msg = method === 'Bank account'
    ? `Bank transfer of $${amount} recorded. Send it to the account shown, then we'll credit your wallet once the payment is confirmed (usually within 24 hours).`
    : `Deposit of $${amount} via ${method} recorded. It will be credited once the payment is confirmed.`;
  res.status(201).json({ ok: true, reference: rec.reference, message: msg });
});

// Card / Paystack top-up: a REAL charge via Paystack's hosted checkout (which collects
// the card). "Card" is just the friendly label. On success the USD wallet is credited.
app.post('/api/deposit/checkout', requireAuth, async (req, res) => {
  const method = String(req.body.method || '').trim();
  const amount = round2(req.body.amount); // USD
  if (!['Card', 'Paystack'].includes(method)) return res.status(400).json({ error: 'Choose a valid card method.' });
  if (!investPay.paystackConfigured()) return res.status(503).json({ error: "Card payments aren't set up yet. Add your Paystack keys to .env." });
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount.' });

  const ref = 'dep_' + rid(10);
  const rec = {
    id: rid(8), userId: req.user.id, amount, currency: 'USD', reference: ref, method,
    status: 'pending', createdAt: new Date().toISOString(), paidAt: null, error: null, provider: null,
  };
  db.get().deposits.push(rec);
  db.save();
  try {
    const cur = (process.env.PAYSTACK_CURRENCY || 'KES').toUpperCase();
    const amountMajor = cur === 'KES' ? Math.round(amount * FX_KES_PER_USD) : amount;
    const returnUrl = `${appBase(req)}/api/deposit/pay/return?ref=${ref}`;
    const { url, providerRef } = await investPay.createCheckout(method, {
      amountUSD: amount, amountMajor, currency: cur, email: req.user.email, ref, returnUrl,
    });
    rec.provider = { type: 'paystack', method, providerRef, currency: cur, amountCharged: amountMajor };
    db.save();
    return res.json({ ok: true, mode: 'redirect', url, reference: ref, message: 'Redirecting to the secure card page…' });
  } catch (err) {
    rec.status = 'failed'; rec.error = String(err.message || err); db.save();
    return res.status(502).json({ error: 'Could not start card payment: ' + rec.error });
  }
});

// Paystack redirects the browser here after a card top-up; verify + credit the USD wallet.
app.get('/api/deposit/pay/return', async (req, res) => {
  const rec = db.get().deposits.find((d) => d.reference === String(req.query.ref || ''));
  if (!rec || !rec.provider) return res.redirect('/app.html#/redeem');
  try {
    if (rec.status === 'pending' && await investPay.verify(rec.provider.method, rec.provider.providerRef)) {
      rec.status = 'success'; rec.paidAt = new Date().toISOString();
      const u = userById(rec.userId);
      if (u) { ensureUserShape(u); u.usd = round2((u.usd || 0) + rec.amount); }
      db.save();
    }
  } catch (_) { /* leave pending; the SPA shows the failure state */ }
  const done = rec.status === 'success';
  res.redirect(`/app.html#/redeem?${done ? 'deposited' : 'depfail'}=1`);
});

// Safaricom posts the STK result here (point MPESA_STK_CALLBACK_URL to this via a public tunnel).
// Handles both wallet top-ups (credit balance) and Premium subscriptions (grant premium).
app.post('/api/mpesa/stk-callback', (req, res) => {
  // IMPORTANT: process (and db.save) BEFORE responding — on serverless the instance can
  // freeze immediately after res.json(), so crediting must not happen after the response.
  const cb = req.body && req.body.Body && req.body.Body.stkCallback;
  if (cb) {
    handleStkCallback(cb);
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});
function handleStkCallback(cb) {
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
}

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
    rec.provider = { type: 'mpesa-stk', ...(await payments.mpesaStkPush({ phone, amount: amountKES, accountRef: 'Gweno Premium', description: 'Premium subscription', callbackUrl: stkCallbackUrl(req) })) };
    db.save();
    return res.json({ ok: true, reference, message: 'Payment request sent. Enter your M-Pesa PIN to activate Premium.' });
  } catch (err) {
    rec.status = 'failed'; rec.error = String(err.message || err);
    db.save();
    return res.status(502).json({ error: 'Subscription payment failed: ' + rec.error });
  }
});

// Subscribe by card via Paystack. Premium is NOT granted here — only after the payment
// is CONFIRMED on the return from the hosted checkout (see /api/subscribe/pay/return).
app.post('/api/subscribe/manual', requireAuth, async (req, res) => {
  if (isPremium(req.user)) return res.status(400).json({ error: 'You already have an active Premium subscription.' });
  const method = String(req.body.method || '').trim();
  if (!['Card', 'Paystack'].includes(method)) return res.status(400).json({ error: 'Choose a card payment method.' });
  if (!investPay.paystackConfigured()) {
    return res.status(503).json({ error: "Card payments for Premium aren't set up yet. Premium only unlocks after a confirmed payment." });
  }
  const ref = 'sub_' + rid(10);
  const rec = {
    id: rid(8), userId: req.user.id, amount: SUBSCRIPTION_USD, currency: 'USD', reference: ref,
    purpose: 'subscription', method, status: 'pending', createdAt: new Date().toISOString(), paidAt: null, provider: null, error: null,
  };
  db.get().deposits.push(rec);
  db.save();
  try {
    const cur = (process.env.PAYSTACK_CURRENCY || 'KES').toUpperCase();
    const amountMajor = cur === 'KES' ? Math.round(SUBSCRIPTION_USD * FX_KES_PER_USD) : SUBSCRIPTION_USD;
    const returnUrl = `${appBase(req)}/api/subscribe/pay/return?ref=${ref}`;
    const { url, providerRef } = await investPay.createCheckout(method, { amountUSD: SUBSCRIPTION_USD, amountMajor, currency: cur, email: req.user.email, ref, returnUrl });
    rec.provider = { type: 'paystack', method, providerRef, currency: cur, amountCharged: amountMajor };
    db.save();
    return res.json({ ok: true, mode: 'redirect', url, message: 'Redirecting to pay for Premium…' });
  } catch (err) {
    rec.status = 'failed'; rec.error = String(err.message || err); db.save();
    return res.status(502).json({ error: 'Could not start Premium payment: ' + rec.error });
  }
});

// Paystack redirects the browser back here after a Premium payment; grant Premium only
// once the payment is verified as successful.
app.get('/api/subscribe/pay/return', async (req, res) => {
  const rec = db.get().deposits.find((d) => d.reference === String(req.query.ref || '') && d.purpose === 'subscription');
  if (!rec || !rec.provider) return res.redirect('/app.html#/tasks');
  try {
    if (rec.status === 'pending' && await investPay.verify(rec.provider.method, rec.provider.providerRef)) {
      rec.status = 'success'; rec.paidAt = new Date().toISOString();
      const u = userById(rec.userId);
      if (u) { ensureUserShape(u); grantPremium(u); } // <-- only after confirmed payment
      db.save();
    }
  } catch (_) { /* leave pending; premium stays locked */ }
  const done = rec.status === 'success';
  res.redirect(`/app.html#/tasks?${done ? 'premium' : 'premfail'}=1`);
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
app.post('/api/support', rateLimit('support', 10, 10 * 60 * 1000), requireAuth, async (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();
  if (!subject || !message) return res.status(400).json({ error: 'Please enter a subject and a message.' });
  if (subject.length > 150) return res.status(400).json({ error: 'Subject is too long (max 150 characters).' });
  if (message.length > 4000) return res.status(400).json({ error: 'Message is too long (max 4000 characters).' });
  db.get().support.push({ id: rid(8), userId: req.user.id, email: req.user.email, subject, message, createdAt: new Date().toISOString() });
  db.save();
  if (mailer.configured()) {
    // Await on serverless so the email sends before the function freezes.
    try { await mailer.sendSupport({ fromEmail: req.user.email, subject, message }); }
    catch (e) { console.error('[gweno] support email failed:', e.message); }
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
      const push = await payments.mpesaStkPush({ phone, amount: amountKES, accountRef: 'Gweno Invest', description: `${plan.name} investment`, callbackUrl: stkCallbackUrl(req) });
      inv.provider = { type: 'mpesa-stk', method, amountKES, ...push };
      db.save();
      return res.status(201).json({ ok: true, mode: 'stk', id: inv.id, investment: publicInvestment(inv),
        message: `Enter your M-Pesa PIN to pay KES ${amountKES.toLocaleString()} (≈ $${amount}) and start your ${plan.name}.` });
    }
    // Card / Stripe / PayPal / Paystack — hosted checkout redirect.
    const ref = 'inv_' + rid(10);
    const returnUrl = `${appBase(req)}/api/investments/pay/return?id=${inv.id}`;
    const cancelUrl = `${appBase(req)}/app.html#/invest?payfail=${inv.id}`;
    const args = { amountUSD: amount, email: req.user.email, ref, returnUrl, cancelUrl };
    // Paystack (and Card, which uses Paystack) settle in the account currency (default KES) — convert from USD.
    if (method === 'Paystack' || method === 'Card') {
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
  if (!inv || !inv.provider) return res.redirect('/app.html#/invest');
  try {
    if (inv.status === 'pending' && await investPay.verify(inv.provider.method, inv.provider.providerRef)) {
      activateInvestment(inv); db.save();
    }
  } catch (_) { /* fall through to the SPA, which will show the pending state */ }
  const done = inv.status === 'active' || inv.status === 'completed';
  res.redirect(`/app.html#/invest?${done ? 'paid' : 'payfail'}=${inv.id}`);
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

// Run a normal HTTP server when started directly (node server.js). On Vercel the
// module is imported as a serverless function, so we export the app instead.
if (require.main === module) {
  dbReady.then(() => {
    app.listen(PORT, () => {
      console.log(`\n  Gweno running -> http://localhost:${PORT}\n`);
    });
  });
}

module.exports = app;

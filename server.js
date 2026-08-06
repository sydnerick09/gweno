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
const quizMod = require('./questionnaires');
const investmentsMod = require('./investments');
const { currencyFor } = require('./currencies');
const payments = require('./payments');
const mailer = require('./mailer');
const oauth = require('./oauth');
const gamify = require('./gamify');
const { TASKS, FREE_TASKS } = tasksMod;

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
const MIN_REDEEM_KES = 10;                               // minimum cash-out: KES 10 (USD derived from FX below)
const DEPOSIT_MIN_KES = 10;                              // DEPOSITS via M-Pesa STK Push (KES)
const FX_KES_PER_USD = Number(process.env.FX_KES_PER_USD) || 129; // conversion rate (configurable)
// USD minimum is DERIVED from the KES minimum at the live/configured rate — never hardcoded.
const MIN_REDEEM = { KES: MIN_REDEEM_KES, USD: Math.round((MIN_REDEEM_KES / FX_KES_PER_USD) * 100) / 100 };
const SUBSCRIPTION_DAYS = 30;
// Three subscription tiers. A member can work on any task whose required tier rank
// is <= their plan rank (higher plans unlock the lower bands too).
const PLANS = [
  { id: 'basic', name: 'Basic', priceKES: 200, rank: 1, minUSD: 0, maxUSD: 1.00 },
  { id: 'premium', name: 'Premium', priceKES: 500, rank: 2, minUSD: 1.00, maxUSD: 2.00 },
  { id: 'premiumpro', name: 'Premium Pro', priceKES: 1000, rank: 3, minUSD: 2.00, maxUSD: 7.00 },
];
const PLAN_BY_ID = Object.fromEntries(PLANS.map((p) => [p.id, p]));
const TASKS_PER_DAY = 2;                                 // a member can do 2 tasks per day
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const SURVEY_DONE = 'surveysDone';

// Separate admin credentials — NOT a client account. Set these in .env.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// Finance sub-role: its own login, restricted to money operations (payouts, deposits,
// investments) — see the finance whitelist middleware below. No password => disabled.
const FINANCE_USERNAME = process.env.FINANCE_USERNAME || 'finance';
const FINANCE_PASSWORD = process.env.FINANCE_PASSWORD || '';
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
app.use(express.json({ limit: '6mb', verify: (req, res, buf) => { req.rawBody = buf; } })); // 6mb allows Share & Earn screenshots; raw body kept for Paystack webhook signature
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

// ---- Security headers (Safe Browsing hardening + anti-clickjacking/phishing) ----
// Applied to every response, including static pages. The phishing-relevant directives
// are strict: form-action 'self' (credentials can only post to our own backend),
// frame-ancestors 'self' (the login page can't be embedded/clickjacked), object-src
// 'none' and base-uri 'self'. Source lists stay https-permissive so first-party inline
// code, Google Fonts, Turnstile and ads keep working.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' https: data:",
    "style-src 'self' 'unsafe-inline' https:",
    "connect-src 'self' https:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
    "frame-src 'self' https:",
  ].join('; '));
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
  if (req.path.startsWith('/api')) {
    if (ON_VERCEL && db.reload) { try { await db.reload(); } catch (_) {} }
    // One-time gamification backfill for accounts created before the system existed.
    // Runs on fresh state, is flag-guarded, and replays awards idempotently.
    try { backfillGamification(); } catch (e) { console.error('[gweno] gamify backfill:', e.message); }
    if (ON_VERCEL && db.flush) {
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
  S.adminEmails = S.adminEmails || []; // admin-sent emails (individual + broadcast) history
  S.botPool = S.botPool || []; // persistent generated/demo users (one displayName reused everywhere)
  S.taskExtra = S.taskExtra || []; // dynamically generated replacement tasks (single-use pool)
  if (S.taskSeq == null) S.taskSeq = 0;
  S.shareSubmissions = S.shareSubmissions || []; // Share & Earn (social sharing) proofs
  S.quizSubmissions = S.quizSubmissions || [];   // questionnaire submissions (auto-scored, admin-approved)
  S.transactions = S.transactions || [];         // lightweight earnings ledger
})();

// One-time backfill: award XP/badges/levels for activity that happened before the
// gamification system launched. Every award reuses the SAME idempotency key the live
// hooks use (task:<id>, survey:<id>, invest:<id>, referral:<userId>, redeem:<id>), so
// this is safe to run repeatedly — already-awarded events are skipped. A persisted
// flag stops it from re-scanning on every request once it has completed.
function backfillGamification() {
  const s = db.get();
  if (!s || !Array.isArray(s.users) || s.gamifyBackfillDone) return;
  const byId = new Map(s.users.map((u) => [u.id, u]));
  let awards = 0;
  const give = (u, type, key, opts) => { if (!u) return; ensureUserShape(u); if (gamify.award(u, type, key, opts)) awards += 1; };

  for (const sub of (s.submissions || [])) {
    if (sub.status === 'approved') give(byId.get(sub.userId), 'task', `task:${sub.id}`, { earnedUSD: round2(sub.reward || 0) });
  }
  for (const u of s.users) {
    ensureUserShape(u);
    for (const sid of (u[SURVEY_DONE] || [])) {
      const survey = surveysMod.byId(sid);
      give(u, 'survey', `survey:${sid}`, { earnedUSD: round2((survey || {}).reward || 0) });
    }
    if (u.onboarded && gamify.markProfileComplete(u)) awards += 1;
  }
  for (const inv of (s.investments || [])) {
    if (inv.status === 'active' || inv.status === 'completed') give(byId.get(inv.userId), 'invest', `invest:${inv.id}`);
  }
  for (const nu of s.users) {
    if (nu.referredBy && nu.referralCredited) give(byId.get(nu.referredBy), 'referral', `referral:${nu.id}`);
  }
  for (const rec of (s.redemptions || [])) {
    give(byId.get(rec.userId), 'withdraw', `redeem:${rec.id}`);
  }

  // These are historical replays — clear the event feed so members aren't flooded
  // with dozens of stale "task approved" / level-up toasts on their next visit.
  for (const u of s.users) { if (u.game && Array.isArray(u.game.events)) u.game.events = []; }

  s.gamifyBackfillDone = true;
  db.save();
  console.log(`[gweno] gamification backfill complete: ${awards} awards across ${s.users.length} user(s).`);
}

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
// The member's active plan object (or null if none / expired).
function activePlan(u) {
  if (!u || !u.plan || !u.plan.id) return null;
  if (u.plan.expires && new Date(u.plan.expires).getTime() <= now()) return null;
  return PLAN_BY_ID[u.plan.id] || null;
}
const userRank = (u) => { const p = activePlan(u); return p ? p.rank : 0; };
// A task is accessible if the member's plan rank >= the task's required-tier rank.
// Free tasks (tier 'free') are open to everyone — that's the single free-trial task.
function canAccessTask(u, task) {
  if (task && task.tier === 'free') return true;
  const need = PLAN_BY_ID[task.tier] ? PLAN_BY_ID[task.tier].rank : 99;
  return userRank(u) >= need;
}

// ---- Single-use task pool (paid catalog + dynamically generated replacements) ----
// Every paid task can be completed only ONCE across the whole platform. When a task is
// approved it stays "consumed" (its approved submission hides it) and a fresh task in the
// same category is generated, so the number of available tasks stays roughly constant.
const staticTaskById = tasksMod.byId;                       // static catalog + free pool
function serverTaskById(id) { return staticTaskById(id) || (db.get().taskExtra || []).find((t) => t.id === id) || null; }
function activeTaskPool() { return [...TASKS, ...(db.get().taskExtra || [])]; } // paid catalog only
// Task ids that ANY member has claimed (pending) or completed (approved) — unavailable to all.
function globallyClaimedTaskIds() {
  const set = new Set();
  for (const x of (db.get().submissions || [])) if (x.status === 'pending' || x.status === 'approved') set.add(x.taskId);
  return set;
}
// Clone a fresh single-use task in `category` (keeps realistic content from a template).
function generateReplacementTask(category) {
  const s = db.get();
  s.taskExtra = s.taskExtra || [];
  s.taskSeq = (s.taskSeq || 0) + 1;
  const templates = TASKS.filter((t) => t.category === category && t.tier !== 'free');
  const src = templates.length ? templates : TASKS;
  const base = src[Math.floor(Math.random() * src.length)];
  const clone = { ...base, id: 'G' + String(s.taskSeq).padStart(4, '0'), generated: true, createdAt: new Date().toISOString() };
  s.taskExtra.push(clone);
  // Keep the dynamic pool bounded: all still-available tasks + the most recent consumed ones.
  if (s.taskExtra.length > 1000) {
    const claimed = globallyClaimedTaskIds();
    const avail = s.taskExtra.filter((t) => !claimed.has(t.id));
    const consumedRecent = s.taskExtra.filter((t) => claimed.has(t.id)).slice(-300);
    s.taskExtra = consumedRecent.concat(avail);
  }
  return clone;
}
const grantPlan = (u, id) => {
  const iso = new Date().toISOString();
  // Premium Pro unlocks the platform permanently; lower plans run for SUBSCRIPTION_DAYS.
  const expires = id === 'premiumpro' ? null : new Date(now() + SUBSCRIPTION_DAYS * 86400000).toISOString();
  u.plan = { id, since: iso, expires };
  audit('plan_upgrade', { userId: u.id, plan: id });
};
// Back-compat: some code still calls isPremium — now "has any active paid plan".
const isPremium = (u) => userRank(u) > 0;
const grantPremium = (u) => grantPlan(u, 'premium');

// The next free task for a no-plan user: one at a time, from a finite pool. A free
// task the user already submitted (pending/approved) is skipped; a rejected one may
// be retried. Returns null once the pool is exhausted (=> they must subscribe).
function nextFreeTask(u) {
  const takenFree = new Set(mySubmissions(u.id)
    .filter((x) => x.status !== 'rejected' && typeof x.taskId === 'string' && x.taskId[0] === 'F')
    .map((x) => x.taskId));
  return FREE_TASKS.find((t) => !takenFree.has(t.id)) || null;
}
function freeTasksRemaining(u) {
  const takenFree = new Set(mySubmissions(u.id)
    .filter((x) => x.status !== 'rejected' && typeof x.taskId === 'string' && x.taskId[0] === 'F')
    .map((x) => x.taskId));
  return FREE_TASKS.filter((t) => !takenFree.has(t.id)).length;
}

// ---- Free tier: ONE earning activity total (task OR questionnaire, never both) ----
function myQuizSubs(userId) { return (db.get().quizSubmissions || []).filter((x) => x.userId === userId); }
function freeActivityCount(u) {
  const taskCount = mySubmissions(u.id).filter((x) => x.status !== 'rejected').length; // free users only ever have free-task subs
  const quizCount = myQuizSubs(u.id).filter((x) => x.status !== 'rejected').length;
  return taskCount + quizCount;
}
// True when a no-plan user has already used their single free earning opportunity.
function freeActivityUsed(u) { return userRank(u) === 0 && freeActivityCount(u) >= 1; }
const FREE_LIMIT_MSG = 'You have completed your free earning opportunity. Upgrade your subscription to unlock more earning opportunities.';

// Gate for earning modules that require an active subscription (surveys, referral,
// apply-for-tasks, future paid clicks/games). Share & Earn is intentionally NOT gated
// (it drives growth), and the single free task lives on the Tasks page.
function requirePlan(req, res, next) {
  if (userRank(req.user) > 0) return next();
  return res.status(403).json({
    error: 'This earning feature needs an active subscription. Try the free task on the Tasks page, then subscribe to unlock surveys, referrals and more.',
    code: 'no_plan', upgrade: true,
  });
}

// ---- Subscription progression: strict per-plan task limits + withdrawal-gated upgrades ----
// Basic = 1 task, Premium = 2 tasks, then a successful (admin-confirmed) withdrawal LOCKS
// tasks and unlocks the next upgrade. Premium Pro removes the per-cycle limit (daily rules
// only). Everything is DERIVED from data below, so it can't be bypassed client-side.
const PLAN_TASK_LIMIT = { basic: 1, premium: 2 }; // premiumpro => unlimited (daily platform rules)
const NEXT_PLAN = { free: 'basic', basic: 'premium', premium: 'premiumpro' };

// Non-rejected task submissions since the current plan started (this "cycle").
function tasksThisCycleCount(u) {
  const since = (u.plan && u.plan.since) ? new Date(u.plan.since).getTime() : 0;
  return mySubmissions(u.id).filter((x) => x.status !== 'rejected' && new Date(x.createdAt).getTime() >= since).length;
}
// A withdrawal that an admin has marked Paid since the current plan started.
function withdrawalPaidThisCycle(u) {
  const since = (u.plan && u.plan.since) ? new Date(u.plan.since).getTime() : 0;
  return (db.get().redemptions || []).some((r) => r.userId === u.id && /paid/i.test(r.status || '') && new Date(r.createdAt).getTime() >= since);
}
// Server-authoritative gate state — fully derived, so a page refresh or edited request can't bypass it.
function taskGate(u) {
  const plan = activePlan(u);
  const planId = plan ? plan.id : 'free';
  const unlimited = planId === 'premiumpro';
  const limit = PLAN_TASK_LIMIT[planId] != null ? PLAN_TASK_LIMIT[planId] : null;
  const done = tasksThisCycleCount(u);
  const atLimit = !unlimited && limit != null && done >= limit;
  const withdrew = atLimit && withdrawalPaidThisCycle(u);
  const locked = atLimit && withdrew; // finished the plan's tasks + a successful withdrawal => must upgrade
  const nextPlan = NEXT_PLAN[planId] || null;
  const np = nextPlan ? PLAN_BY_ID[nextPlan] : null;
  return { planId, planName: plan ? plan.name : 'Free', limit, done, unlimited, atLimit, withdrew, locked,
    nextPlan, nextPlanName: np ? np.name : null, nextPlanPriceKES: np ? np.priceKES : null };
}
// Whether a member may buy `targetPlanId` next — strict, sequential and cycle-gated.
function upgradeEligibility(u, targetPlanId) {
  const target = PLAN_BY_ID[targetPlanId];
  if (!target) return { ok: false, error: 'Choose a valid plan.' };
  const cur = activePlan(u);
  const curRank = cur ? cur.rank : 0;
  if (target.rank <= curRank) return { ok: false, error: `You already have the ${cur ? cur.name : target.name} plan or higher.` };
  if (target.rank !== curRank + 1) {
    const nextName = (PLANS.find((p) => p.rank === curRank + 1) || {}).name || 'the next plan';
    return { ok: false, error: `Upgrade one level at a time — get ${nextName} first.` };
  }
  // Entry to Basic (from free) is open. Advancing further requires the current cycle to be
  // complete: the plan's tasks done AND a successful, admin-confirmed withdrawal.
  if (curRank >= 1) {
    const gate = taskGate(u);
    if (!gate.locked) return { ok: false, error: `Complete your ${gate.planName} task${gate.limit === 1 ? '' : 's'} and make a successful withdrawal before upgrading to ${target.name}.` };
  }
  return { ok: true };
}

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

// Username rules: 6–20 chars; letters, numbers, and . _ - only; stored lowercase & trimmed.
const normalizeUsername = (u) => String(u || '').trim().toLowerCase();
function usernameProblem(username) {
  const u = normalizeUsername(username);
  if (u.length < 6) return 'Username must be at least 6 characters.';
  if (u.length > 20) return 'Username must be at most 20 characters.';
  if (!/^[a-z0-9._-]+$/.test(u)) return 'Username can only use letters, numbers, and . _ -';
  return null;
}
function usernameTaken(username, exceptId) {
  const lo = normalizeUsername(username);
  return db.get().users.some((u) => u.username && u.username.toLowerCase() === lo && u.id !== exceptId);
}
// Alternative handles when a username is taken (all validated + available).
function usernameSuggestions(base, n = 6) {
  const stem = (normalizeUsername(base).replace(/[^a-z0-9._-]/g, '') || 'user').slice(0, 14);
  const cands = [stem + '254', stem + '2026', stem + '_work', stem + 'hub', 'official' + stem,
    stem + '001', stem + 'online', 'workwith' + stem, stem + '2025', stem + '_pro'];
  const out = [];
  for (const c of cands) {
    const v = c.slice(0, 20);
    if (v.length >= 6 && /^[a-z0-9._-]+$/.test(v) && !usernameTaken(v) && !out.includes(v)) out.push(v);
    if (out.length >= n) break;
  }
  return out;
}
// Random "professional" username for the Generate button (e.g. swiftlion12, digitalhawk).
const GEN_ADJ = ['swift', 'digital', 'clever', 'blue', 'smart', 'alpha', 'next', 'rapid', 'prime', 'bright', 'bold', 'mega', 'turbo', 'ace', 'elite', 'online', 'urban', 'royal', 'nova', 'quick'];
const GEN_NOUN = ['lion', 'hawk', 'fox', 'falcon', 'genius', 'worker', 'earner', 'pilot', 'master', 'wolf', 'tiger', 'eagle', 'ninja', 'guru', 'wizard', 'coder', 'builder', 'maker', 'star', 'panda'];
function generateUsername() {
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  for (let i = 0; i < 60; i++) {
    const num = Math.random() < 0.5 ? String(Math.floor(10 + Math.random() * 90)) : '';
    const name = (rnd(GEN_ADJ) + rnd(GEN_NOUN) + num).slice(0, 20);
    if (name.length >= 6 && !usernameTaken(name)) return name;
  }
  return 'worker' + Math.floor(1000 + Math.random() * 9000);
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
  // Subscription plan (basic | premium | premiumpro). Migrate legacy premium flag.
  if (u.plan === undefined) {
    u.plan = (u.premium && u.premium.active) ? { id: 'premium', since: u.premium.since, expires: u.premium.expires } : null;
  }
  if (!u.tour) u.tour = { done: false, skips: 0, lastSkipAt: null }; // first-login guided tour
  if (u.suspended === undefined) u.suspended = false; // admin: blocks sign-in
  if (u.held === undefined) u.held = false;           // admin: pauses withdrawals
  gamify.ensureGameShape(u);                           // XP / level / badges / streak / coins
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
  gamify.award(owner, 'referral', `referral:${newUser.id}`, {   // XP once per referred user
    event: { text: 'Referral bonus earned 🤝', icon: '🤝' },
  });
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
    plan: (() => { const p = activePlan(u); return p ? { id: p.id, name: p.name, rank: p.rank, maxUSD: p.maxUSD, expires: u.plan && u.plan.expires } : null; })(),
    tour: u.tour || { done: false, skips: 0, lastSkipAt: null },
    game: (() => { const g = u.game, lv = gamify.level(g.xp);
      return { xp: g.xp, coins: g.coins, level: lv.name, levelIdx: lv.idx, pct: lv.pct,
        streak: g.streak.count, verification: g.verification, badges: g.badges.length,
        unread: (g.events || []).filter((e) => !e.read).length }; })(),
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
// role: 'admin' (full) or 'finance' (money operations only). Old sessions with no
// role are treated as 'admin' for back-compat.
function createAdminSession(res, role = 'admin', username = ADMIN_USERNAME) {
  const token = rid(24);
  const sess = { token, role, username, createdAt: now(), expiresAt: now() + ADMIN_SESSION_TTL_MS };
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
// The role of the current staff session ('admin' | 'finance' | null).
const sessionRole = (req) => { const s = currentAdminSession(req); return s ? (s.role || 'admin') : null; };
// The acting staff member's username (for audit/attribution).
const actorName = (req) => { const s = currentAdminSession(req); return (s && s.username) || ADMIN_USERNAME; };

// Finance role: allowed ONLY on money-operations endpoints. Full admins pass through;
// unauthenticated requests fall through to each route's own guard (which returns 401).
// Paths are relative to the /api/admin mount point.
const FINANCE_ALLOWED = [
  { m: 'GET',  re: /^\/session$/ },
  { m: 'POST', re: /^\/login$/ },
  { m: 'POST', re: /^\/logout$/ },
  { m: 'GET',  re: /^\/overview$/ },
  { m: 'GET',  re: /^\/users$/ },                       // list only (to find a client)
  { m: 'POST', re: /^\/users\/[^/]+\/withdraw$/ },      // initiate withdrawal on behalf of a client
  { m: 'GET',  re: /^\/redemptions$/ },
  { m: 'POST', re: /^\/redemptions\/[^/]+\/mark$/ },    // release / reject payouts
  { m: 'GET',  re: /^\/deposits$/ },
  { m: 'GET',  re: /^\/investments$/ },
];
app.use('/api/admin', (req, res, next) => {
  if (sessionRole(req) !== 'finance') return next();    // full admin or not-signed-in
  const ok = FINANCE_ALLOWED.some((r) => r.m === req.method && r.re.test(req.path));
  if (ok) return next();
  return res.status(403).json({ error: 'Finance accounts can only manage payouts (withdrawals, deposits, investments). This action needs a full admin.' });
});
let adminLock = { count: 0, lockedUntil: 0 };

function findUserByEmail(email) {
  return db.get().users.find((u) => u.email === email) || null;
}

// Recent real completions (approved submissions) for the dashboard feed.
// Community completions shown in the "Recent task completions" feed: 30 members on
// premium-tier tasks + 20 on basic. Rotates every few minutes so the feed looks live.
const LB_COUNTRIES = ['Kenya', 'Kenya', 'Kenya', 'Uganda', 'Tanzania', 'Nigeria', 'Ghana', 'South Africa', 'Rwanda', 'Zambia', 'Cameroon', 'Ethiopia', 'Malawi', 'United States', 'United Kingdom', 'India', 'Philippines', 'Nigeria', 'Kenya', 'Ghana'];
function fakeCompletions(seed) {
  const rng = mulberry32(seed);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const genUsers = ensureBotPool();               // reuse the SAME generated users everywhere
  const premiumTasks = TASKS.filter((t) => t.tier !== 'basic');
  const basicTasks = TASKS.filter((t) => t.tier === 'basic');
  const one = (pool, planName) => {
    const t = pick(pool.length ? pool : TASKS) || TASKS[0];
    const g = pick(genUsers);                       // a persistent generated user (stable displayName)
    return { username: g.displayName, country: g.country, task: t.title, reward: t.reward, plan: planName };
  };
  const items = [];
  for (let i = 0; i < 30; i++) items.push(one(premiumTasks, 'Premium'));
  for (let i = 0; i < 20; i++) items.push(one(basicTasks, 'Basic'));
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = items[i]; items[i] = items[j]; items[j] = tmp; } // shuffle
  return items;
}

app.get('/api/public/activity', (req, res) => {
  const s = db.get();
  const real = (s.submissions || [])
    .filter((x) => x.status === 'approved')
    .sort((a, b) => String(b.reviewedAt || b.createdAt).localeCompare(String(a.reviewedAt || a.createdAt)))
    .slice(0, 8)
    .map((x) => {
      const u = userById(x.userId);
      const t = serverTaskById(x.taskId);
      return {
        username: u ? u.username : 'member',
        country: (u && u.profile && u.profile.country) || '',
        task: t ? t.title : 'a task',
        reward: x.reward,
      };
    });
  const seed = Math.floor(Date.now() / (3 * 60 * 1000)); // rotate every 3 minutes
  const items = real.concat(fakeCompletions(seed)).slice(0, 58);
  res.json({ items });
});

// Public, no-auth stats for the home page social-proof band.
// Day 1 baselines, then a 20% compound increase every 24 hours. Because every metric
// grows at the same daily rate from its own baseline, the ratios (and therefore the
// logical relationships: earning ≤ joined, completed ≤ available) are always preserved,
// and the numbers only ever increase.
// Joined members start at 120 and grow 20% per day (compounding). The other figures are
// derived from that single number so the relationships always hold:
//   Tasks available = 47% of joined members;  Earning members = 60% of tasks available.
const STATS_EPOCH = Date.UTC(2026, 6, 20); // day 1
const STATS_JOINED_BASE = 120;
const STATS_DAILY_GROWTH = 1.2; // +20% per day, compounding
app.get('/api/public/stats', (req, res) => {
  const dayIndex = Math.max(0, Math.floor((Date.now() - STATS_EPOCH) / 86400000));
  const members = Math.round(STATS_JOINED_BASE * Math.pow(STATS_DAILY_GROWTH, dayIndex));
  const tasksLive = Math.round(members * 0.47);
  const workers = Math.round(tasksLive * 0.60);
  res.json({ members, tasksLive, workers });
});

// Public client config: the Turnstile site key (safe to expose) so the browser can
// render the CAPTCHA widget. Empty when CAPTCHA isn't configured -> client skips it.
app.get('/api/config', (req, res) => {
  res.json({ turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '' });
});

// Live username availability (used by the signup form). Public + rate-limited.
app.get('/api/username/check', rateLimit('uname', 150, 5 * 60 * 1000), (req, res) => {
  const u = normalizeUsername(req.query.u);
  const problem = usernameProblem(u);
  if (problem) return res.json({ username: u, valid: false, available: false, error: problem, suggestions: [] });
  const taken = usernameTaken(u);
  res.json({ username: u, valid: true, available: !taken, error: taken ? 'Username already taken.' : null, suggestions: taken ? usernameSuggestions(u) : [] });
});
// Suggest a random professional username (for the "Generate" button).
app.get('/api/username/generate', rateLimit('unamegen', 80, 5 * 60 * 1000), (req, res) => {
  res.json({ username: generateUsername() });
});

// =============================================================================
//  SIGN UP  (email + password)                     — guards #2 (duplicate email)
// =============================================================================
app.post('/api/signup', rateLimit('signup', 15, 10 * 60 * 1000), async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normEmail(req.body.email);
    const username = normalizeUsername(req.body.username);
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
    ensureUserShape(user);
    gamify.touchStreak(user);       // daily login streak + bonus XP/coins (idempotent per day)
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
  gamify.markProfileComplete(user); // one-time XP for finishing the welcome profile
  payReferralOnOnboarding(user); // pay the referrer their 5 KES now that questions are answered
  db.save();

  res.json({ user: publicUser(user), bonus, answered });
});

// ---- Session-backed endpoints ----------------------------------------------
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), sessionExpiresAt: req.session.expiresAt, fx: FX_KES_PER_USD });
});

// =============================================================================
//  GAMIFICATION  —  XP / levels / badges / streaks / coins / leaderboard
// =============================================================================
app.get('/api/gamification', requireAuth, (req, res) => {
  const me = req.user;
  const sum = gamify.summary(me);
  // Overall rank = position by total XP across all (non-suspended) users.
  const users = db.get().users.filter((u) => !u.suspended);
  const myXp = (me.game && me.game.xp) || 0;
  const rank = users.filter((u) => ((u.game && u.game.xp) || 0) > myXp).length + 1;
  res.json({ ...sum, rank, totalUsers: users.length, events: (me.game.events || []).slice(0, 20) });
});

// Deterministic PRNG so the synthetic leaderboard names/XP stay stable per period
// (they don't reshuffle on every request) but differ between periods.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Synthetic "people currently working on this task" count. Deterministic per task id
// but drifts every ~2 minutes so the marketplace feels live without a real presence system.
function taskWorkers(id) {
  const bucket = Math.floor(Date.now() / (2 * 60 * 1000));
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 2 + ((h + bucket) % 34); // 2–35 workers
}
const LB_FIRST = ['Brian', 'Amina', 'John', 'Grace', 'David', 'Faith', 'Kevin', 'Mercy', 'Peter', 'Joy', 'Samuel', 'Cynthia', 'Daniel', 'Esther', 'Michael', 'Ruth', 'Emmanuel', 'Sharon', 'Victor', 'Lydia', 'James', 'Naomi', 'Collins', 'Wanjiru', 'Dennis', 'Aisha', 'Felix', 'Chloe', 'George', 'Halima', 'Ian', 'Beatrice', 'Kelvin', 'Diana', 'Nancy', 'Oscar', 'Purity', 'Anthony', 'Rose', 'Stephen', 'Winnie', 'Timothy', 'Zainab', 'Alex', 'Belinda', 'Caleb', 'Doris', 'Eric', 'Fiona', 'Gideon', 'Hilda', 'Isaac', 'Janet', 'Kamau', 'Linda', 'Musa', 'Njeri', 'Otieno', 'Pauline', 'Ahmed', 'Sophia', 'Liam', 'Olivia', 'Noah', 'Emma', 'Lucas', 'Mia', 'Ethan', 'Zara', 'Ali', 'Habiba', 'Yusuf', 'Salma', 'Tariq', 'Layla', 'Mateo', 'Valentina', 'Andre', 'Chidi', 'Ngozi', 'Kwame', 'Ama', 'Sadia', 'Rehema', 'Baraka', 'Tabitha', 'Elvis', 'Mercy'];
const LB_LAST = ['Kamau', 'Otieno', 'Mwangi', 'Achieng', 'Njoroge', 'Wanjala', 'Omondi', 'Chebet', 'Kiptoo', 'Mutua', 'Njeri', 'Barasa', 'Kariuki', 'Wafula', 'Onyango', 'Cheruiyot', 'Maina', 'Adhiambo', 'Kimani', 'Mbugua', 'Owino', 'Wekesa', 'Kones', 'Aluoch', 'Gitau', 'Musyoka', 'Chege', 'Ndegwa', 'Auma', 'Bett', 'Kiplagat', 'Were', 'Muriuki', 'Odongo', 'Ochieng', 'Mumo', 'Karanja', 'Simiyu', 'Wambui', 'Hassan', 'Yusuf', 'Ahmed', 'Ibrahim', 'Okoth', 'Juma', 'Salim', 'Mohamed', 'Abdi', 'Kiprop', 'Wangari'];
// ---- Canonical pool of GENERATED (system/demo) users ------------------------
// Each generated user has ONE permanent public `displayName` (e.g. "Wycliffe12") that is
// stored once and reused in every leaderboard/feed, so the same demo user never shows up
// under different names. Real registered users are never touched. An admin can rename a
// generated user via /api/admin/generated-users/:id/rename.
const GEN_POOL_SIZE = 260;
// Force a generated handle to satisfy the username rules (lowercase, valid chars, 6–20).
function botHandle(nm, rng) {
  let n = String(nm || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  while (n.length < 6) n += Math.floor((rng ? rng() : Math.random()) * 10);
  return n.slice(0, 20);
}
function ensureBotPool() {
  const s = db.get();
  if (Array.isArray(s.botPool) && s.botPool.length) {
    // Migrate any legacy names to the username format (lowercase, valid chars, min 6).
    let changed = false;
    for (const b of s.botPool) { const h = botHandle(b.displayName); if (h !== b.displayName) { b.displayName = h; changed = true; } }
    if (changed) db.save();
    return s.botPool;
  }
  const rng = mulberry32(770077);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const used = new Set();
  const pool = [];
  for (let i = 0; i < GEN_POOL_SIZE; i++) {
    let name, tries = 0;
    // Username-style handle: lowercase first name + a 2-digit number, e.g. "wycliffe12".
    do { name = botHandle(`${pick(LB_FIRST)}${String(10 + Math.floor(rng() * 90))}`, rng); tries++; } while (used.has(name) && tries < 40);
    used.add(name);
    const r = rng();
    const verification = r < 0.03 ? 'diamond' : r < 0.12 ? 'gold' : r < 0.34 ? 'blue' : null;
    pool.push({ id: 'gen_' + i, displayName: name, country: pick(LB_COUNTRIES), verification, generated: true });
  }
  s.botPool = pool;
  db.save();
  return pool;
}

// Build `count` synthetic leaders descending from (topXp - 20). Names/verification come
// from the persistent generated-user pool, so they are identical across every feed.
function fakeLeaders(count, topXp, seed) {
  const pool = ensureBotPool();
  const rng = mulberry32(seed);
  // Period-specific ordering of the SAME generated users (their names never change).
  const order = pool.map((b) => ({ b, k: rng() })).sort((a, z) => a.k - z.k).slice(0, count);
  const out = [];
  let x = Math.max(topXp - 20, 120);
  for (let i = 0; i < order.length; i++) {
    const b = order[i].b;
    out.push({ id: b.id, name: b.displayName, avatar: null, level: gamify.level(x).name, verification: b.verification, xp: Math.max(x, 5), bot: true });
    x -= 8 + Math.floor(rng() * 40); // descend by 8–47 each step
    if (x < 30) x = 30 + Math.floor(rng() * 20);
  }
  return out;
}

app.get('/api/leaderboard', requireAuth, (req, res) => {
  const period = String(req.query.period || 'weekly');
  const days = period === 'monthly' ? 30 : period === 'all' ? 3650 : 7;
  const realRows = db.get().users
    .filter((u) => !u.suspended)
    .map((u) => { gamify.ensureGameShape(u);
      const xp = period === 'all' ? u.game.xp : gamify.periodXP(u.game, days);
      return { id: u.id, name: u.username || u.name || 'User', avatar: u.avatar || null,
        level: gamify.level(u.game.xp).name, verification: u.game.verification, xp, bot: false }; })
    .filter((r) => r.xp > 0);

  // Anchor the 200 synthetic leaders just below the real leader (so the top real
  // member keeps #1 by 20 XP). If nobody real has XP yet, seed a lively board.
  const realTop = realRows.reduce((m, r) => Math.max(m, r.xp), 0);
  const base = period === 'all' ? 26000 : period === 'monthly' ? 12000 : 4500;
  const anchor = realTop > 0 ? realTop : base;
  const seed = period === 'monthly' ? 2027 : period === 'all' ? 5051 : 1009;
  const bots = fakeLeaders(200, anchor, seed);

  const merged = realRows.concat(bots)
    .sort((a, b) => b.xp - a.xp)
    .map((r, i) => ({ rank: i + 1, ...r, me: r.id === req.user.id }));

  // Show up to 205 rows; always include the viewer's own row if they're further down.
  let top = merged.slice(0, 205);
  if (!top.some((r) => r.me)) { const mine = merged.find((r) => r.me); if (mine) top = top.concat(mine); }
  res.json({ period, top });
});

app.get('/api/notifications', requireAuth, (req, res) => {
  gamify.ensureGameShape(req.user);
  const events = req.user.game.events || [];
  res.json({ events: events.slice(0, 30), unread: events.filter((e) => !e.read).length });
});

app.post('/api/notifications/read', requireAuth, (req, res) => {
  gamify.ensureGameShape(req.user);
  (req.user.game.events || []).forEach((e) => { e.read = true; });
  db.save();
  res.json({ ok: true });
});

// Redeem reward coins for a platform benefit (premium access). Server-validated:
// the coin balance is checked and deducted here, never trusted from the client.
const COINS_PREMIUM_COST = 1000;
app.post('/api/coins/redeem', requireAuth, (req, res) => {
  const item = String(req.body.item || 'premium');
  gamify.ensureGameShape(req.user);
  if (item !== 'premium') return res.status(400).json({ error: 'Unknown reward.' });
  if ((req.user.game.coins || 0) < COINS_PREMIUM_COST) {
    return res.status(400).json({ error: `You need ${COINS_PREMIUM_COST} coins for this reward.` });
  }
  req.user.game.coins -= COINS_PREMIUM_COST;
  grantPremium(req.user);
  gamify.pushEvent(req.user, 'reward', `Redeemed ${COINS_PREMIUM_COST} coins for Premium 🎁`, '🎁');
  db.save();
  res.json({ ok: true, coins: req.user.game.coins, message: 'Premium unlocked with your coins! 🎉' });
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
  const plan = activePlan(req.user);
  const mine = mySubmissions(req.user.id);
  // #2 — Single-use: a paid task that ANY member has claimed (pending) or completed
  // (approved) is unavailable to everyone. This guarantees each task is done only once.
  const claimed = globallyClaimedTaskIds();
  // Held accounts don't receive new tasks until an admin restores them.
  let available = (req.user.held ? [] : activeTaskPool().filter((t) => !claimed.has(t.id))).map((t) => ({
    ...t,
    requiredPlan: PLAN_BY_ID[t.tier] ? PLAN_BY_ID[t.tier].name : t.tier,
    locked: !canAccessTask(req.user, t),
    workers: taskWorkers(t.id),   // people currently working on this task (live, synthetic)
  }));
  // #1 — A no-plan (free) user gets exactly ONE free task. After they submit it, it's
  // "pending"; once you approve it they're locked out of tasks until they subscribe.
  const noPlan = userRank(req.user) === 0;
  let free = null;
  if (!req.user.held && noPlan) {
    const freeSubs = mine.filter((x) => typeof x.taskId === 'string' && x.taskId[0] === 'F');
    // A free user may complete only ONE earning activity total — a task OR a questionnaire.
    // If they've already used it on a questionnaire, tasks are locked (never both).
    const quizUsed = myQuizSubs(req.user.id).some((x) => x.status !== 'rejected');
    if (quizUsed) {
      free = { active: true, state: 'completed', via: 'questionnaire', reward: 0.40 };
    } else if (freeSubs.some((x) => x.status === 'approved')) {
      free = { active: true, state: 'completed', reward: 0.40 };            // done -> must subscribe
    } else if (freeSubs.some((x) => x.status === 'pending' || x.status === 'correction')) {
      free = { active: true, state: 'pending', reward: 0.40 };              // under review
    } else {
      const ft = nextFreeTask(req.user);                                    // their single free task
      if (ft) { available = [{ ...ft, requiredPlan: 'Free', locked: false, workers: taskWorkers(ft.id) }, ...available]; free = { active: true, state: 'available', reward: 0.40 }; }
      else { free = { active: true, state: 'completed', reward: 0.40 }; }
    }
  }
  const accessible = available.filter((t) => !t.locked);
  const pending = mine.filter((x) => x.status === 'pending').reduce((a, x) => a + x.reward, 0);
  const approved = mine.filter((x) => x.status === 'approved').reduce((a, x) => a + x.reward, 0);
  res.json({
    premium: userRank(req.user) > 0,
    gate: taskGate(req.user),   // subscription-progression state (locked / limit / next upgrade)
    plan: plan ? { id: plan.id, name: plan.name, rank: plan.rank, maxUSD: plan.maxUSD, expires: req.user.plan && req.user.plan.expires } : null,
    plans: PLANS.map((p) => ({ id: p.id, name: p.name, priceKES: p.priceKES, minUSD: p.minUSD, maxUSD: p.maxUSD, rank: p.rank })),
    totalAvailable: accessible.length,
    moneyAvailableUSD: round2(accessible.reduce((a, t) => a + t.reward, 0)),
    lockedMoneyUSD: round2(available.filter((t) => t.locked).reduce((a, t) => a + t.reward, 0)),
    tasksPerDay: TASKS_PER_DAY,
    pendingUSD: round2(pending),
    approvedUSD: round2(approved),
    balanceUSD: round2(req.user.usd),
    live: payments.mpesaStkConfigured(),
    held: !!req.user.held,
    free,                              // { active, exhausted, remaining, reward } for no-plan users, else null
    categories: tasksMod.CATEGORIES,   // [{ name, icon }] for the category filter
    tasks: available,
  });
});

app.get('/api/tasks/:id', requireAuth, (req, res) => {
  const task = serverTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const sub = mySubmissions(req.user.id).find((x) => x.taskId === task.id && x.status !== 'rejected');
  const requiredPlan = PLAN_BY_ID[task.tier] ? PLAN_BY_ID[task.tier].name : task.tier;
  res.json({ task: { ...task, requiredPlan, locked: !canAccessTask(req.user, task), workers: taskWorkers(task.id) }, submission: sub || null });
});

// Consolidated dashboard statistics — everything the home screen shows, in one call.
app.get('/api/dashboard', requireAuth, (req, res) => {
  const u = req.user;
  const plan = activePlan(u);
  const planId = plan ? plan.id : 'free';
  const noPlan = userRank(u) === 0;
  const mineTasks = mySubmissions(u.id);
  const mineQuiz = myQuizSubs(u.id);
  const shares = (db.get().shareSubmissions || []).filter((s) => s.userId === u.id);

  // Remaining tasks
  const claimed = globallyClaimedTaskIds();
  const doneTaskIds = new Set(mineTasks.filter((x) => x.status !== 'rejected').map((x) => x.taskId));
  let remainingTasks;
  if (noPlan) remainingTasks = (!freeActivityUsed(u) && nextFreeTask(u)) ? 1 : 0;
  else remainingTasks = activeTaskPool().filter((t) => canAccessTask(u, t) && !claimed.has(t.id) && !doneTaskIds.has(t.id)).length;

  // Remaining questionnaires (tier-unlocked, not yet taken)
  const takenQuiz = new Set(mineQuiz.filter((x) => x.status !== 'rejected').map((x) => x.quizId));
  let remainingQuiz = quizMod.QUESTIONNAIRES.filter((z) => quizMod.tierUnlocked(planId, z.tier) && !takenQuiz.has(z.id)).length;
  if (noPlan) remainingQuiz = freeActivityUsed(u) ? 0 : Math.min(1, remainingQuiz);

  // Social sharing tasks still open (no pending/approved submission for that platform)
  const blockedShare = new Set(shares.filter((s) => s.status !== 'rejected').map((s) => s.platform));
  const socialAvailable = SHARE_TASKS.filter((t) => !blockedShare.has(t.key)).length;

  const pendingUSD = mineTasks.filter((x) => x.status === 'pending').reduce((a, x) => a + (x.reward || 0), 0)
    + mineQuiz.filter((x) => x.status === 'pending').reduce((a, x) => a + (x.reward || 0), 0)
    + shares.filter((s) => s.status === 'pending').reduce((a, s) => a + (s.reward || 0), 0);

  res.json({
    subscription: { active: userRank(u) > 0, plan: plan ? plan.name : 'Free', planId, expires: (u.plan && u.plan.expires) || null },
    remainingTasks,
    remainingQuestionnaires: remainingQuiz,
    completedTasks: mineTasks.filter((x) => x.status === 'approved').length,
    completedQuestionnaires: mineQuiz.filter((x) => x.status === 'approved').length,
    socialSharingAvailable: socialAvailable,
    balanceUSD: round2(u.usd || 0),
    balanceKES: round2(u.balance || 0),
    withdrawBalanceUSD: round2(combinedUSD(u)),
    pendingRewardsUSD: round2(pendingUSD),
    minWithdraw: MIN_REDEEM,       // { KES, USD } — USD derived from FX
    fx: FX_KES_PER_USD,
  });
});

app.post('/api/tasks/:id/submit', requireAuth, (req, res) => {
  const task = serverTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (req.user.held) return res.status(403).json({ error: 'Your account is on hold. Task submissions are paused until an admin restores your account.' });
  // Plan gate — enforced server-side so it can't be bypassed by editing the request.
  if (!canAccessTask(req.user, task)) {
    return res.status(403).json({ error: 'Upgrade your subscription to access higher-paying tasks.' });
  }
  // Subscription-progression gate (strict, server-side, fully derived).
  const gate = taskGate(req.user);
  if (gate.locked) {
    return res.status(403).json({ error: `Your tasks are locked. Upgrade to ${gate.nextPlanName || 'the next plan'}${gate.nextPlanPriceKES ? ` (KES ${gate.nextPlanPriceKES.toLocaleString()})` : ''} to unlock more tasks.`, code: 'locked', upgradeTo: gate.nextPlan });
  }
  if (gate.atLimit) {
    return res.status(403).json({ error: `You've completed your ${gate.planName} task limit (${gate.limit}). Withdraw your earnings, then upgrade to ${gate.nextPlanName} to continue.`, code: 'limit_reached', upgradeTo: gate.nextPlan });
  }
  const S = db.get();
  if (mySubmissions(req.user.id).some((x) => x.taskId === task.id && x.status !== 'rejected' && x.status !== 'correction')) {
    return res.status(409).json({ error: 'You have already submitted this task.' });
  }
  // #1 — a no-plan member gets exactly ONE free earning activity total: a task OR a
  // questionnaire, never both. Block the free task if either has already been used.
  if (task.tier === 'free' && userRank(req.user) === 0
      && (mySubmissions(req.user.id).some((x) => typeof x.taskId === 'string' && x.taskId[0] === 'F' && x.status !== 'rejected')
          || myQuizSubs(req.user.id).some((x) => x.status !== 'rejected'))) {
    return res.status(403).json({ error: FREE_LIMIT_MSG, code: 'free_used' });
  }
  // #2 — single-use: block if another member has already claimed or completed this task.
  if (task.tier !== 'free'
      && S.submissions.some((x) => x.taskId === task.id && (x.status === 'pending' || x.status === 'approved') && x.userId !== req.user.id)) {
    return res.status(409).json({ error: 'This task was just taken by another member. Please pick another task.', code: 'task_taken' });
  }
  // Daily limit: a member can do TASKS_PER_DAY tasks per day.
  const todayUTC = new Date().toISOString().slice(0, 10);
  const todayCount = mySubmissions(req.user.id).filter((x) => String(x.createdAt).slice(0, 10) === todayUTC).length;
  if (todayCount >= TASKS_PER_DAY) {
    return res.status(429).json({ error: `You can only do ${TASKS_PER_DAY} tasks per day. Please come back tomorrow.` });
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
  audit('task_completed', { userId: req.user.id, taskId: task.id, submissionId: sub.id, plan: gate.planId });
  db.save();
  res.status(201).json({ submission: sub, message: 'Submitted for review. Approvals are usually completed within 5 hours.' });
});

app.get('/api/submissions', requireAuth, (req, res) => {
  const mine = mySubmissions(req.user.id)
    .map((x) => ({ ...x, task: serverTaskById(x.taskId) }))
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
      return { ...x, task: serverTaskById(x.taskId), user: u ? { username: u.username, email: u.email } : null };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ submissions: all });
});

const usdStr = (n) => '$' + (Number(n) || 0).toFixed(2);

// Append an admin-activity entry to the audit log (caller persists via db.save()).
function audit(action, meta = {}) {
  const S = db.get();
  S.auditLog = S.auditLog || [];
  S.auditLog.unshift({ id: rid(6), action, ...meta, createdAt: new Date().toISOString() });
  if (S.auditLog.length > 1000) S.auditLog.length = 1000;
}

// NOTE: admin email endpoints live further below (sendAdminEmail + /api/admin/users/:id/email,
// /api/admin/email/broadcast, /api/admin/users/:id/emails), using the shared emailLog.

// Email the outcome of a task application (approved => #3 copy, rejected => rejection copy).
async function notifyApplication(appRec, owner, task) {
  const decision = appRec.status;
  const rec = {
    id: rid(6), type: 'application_' + decision, userId: appRec.userId, taskId: appRec.taskId,
    submissionId: null, applicationId: appRec.id, amount: 0, to: (owner && owner.email) || null,
    status: 'Failed', error: null, createdAt: new Date().toISOString(),
  };
  try {
    if (!owner || !owner.email) throw new Error('User has no email on file');
    if (!mailer.configured()) throw new Error('Email is not configured (set SMTP_* env vars)');
    const name = owner.name || owner.username || 'there';
    const taskName = task ? task.title : appRec.taskId;
    if (decision === 'approved') await mailer.sendApplicationApproved({ to: owner.email, name, task: taskName });
    else await mailer.sendTaskRejected({ to: owner.email, name, task: taskName });
    rec.status = 'Sent';
  } catch (e) { rec.error = e.message; }
  const S = db.get();
  S.emailLog = S.emailLog || [];
  S.emailLog.unshift(rec);
  if (S.emailLog.length > 500) S.emailLog.length = 500;
  db.save();
  return rec;
}

// Send the decision email, then log the attempt to the audit trail. A failed email is
// logged (status: 'Failed') but NEVER rolls back the approval/credit — the admin can
// resend it later from the panel.
async function notifyDecision(sub, owner, task) {
  const decision = sub.status;
  const rec = {
    id: rid(6), type: decision, userId: sub.userId, taskId: sub.taskId, submissionId: sub.id,
    amount: decision === 'approved' ? round2(sub.reward) : 0,
    to: (owner && owner.email) || null, status: 'Failed', error: null,
    createdAt: new Date().toISOString(),
  };
  try {
    if (!owner || !owner.email) throw new Error('User has no email on file');
    if (!mailer.configured()) throw new Error('Email is not configured (set SMTP_* env vars)');
    const name = owner.name || owner.username || 'there';
    const taskName = task ? task.title : sub.taskId;
    if (decision === 'approved') await mailer.sendTaskApproved({ to: owner.email, name, task: taskName, amount: usdStr(sub.reward), balance: usdStr(owner.usd) });
    else if (decision === 'rejected') await mailer.sendTaskRejected({ to: owner.email, name, task: taskName });
    else if (decision === 'correction') await mailer.sendTaskCorrection({ to: owner.email, name, task: taskName, reason: sub.reviewNote });
    rec.status = 'Sent';
  } catch (e) { rec.error = e.message; }
  const S = db.get();
  S.emailLog = S.emailLog || [];
  S.emailLog.unshift(rec);
  if (S.emailLog.length > 500) S.emailLog.length = 500;
  db.save();
  return rec;
}

app.post('/api/admin/submissions/:id/decision', requireAdminSession, async (req, res) => {
  const sub = db.get().submissions.find((x) => x.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Submission not found.' });
  const decision = String(req.body.decision || '');
  const note = String(req.body.note || '').trim();
  if (!['approved', 'rejected', 'correction'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
  if (decision === 'correction' && !note) return res.status(400).json({ error: 'A reason for correction is required.' });

  const owner = userById(sub.userId);
  if (owner) ensureUserShape(owner);
  const wasApproved = sub.status === 'approved';
  if (decision === 'approved' && !wasApproved && owner) {
    owner.usd = round2((owner.usd || 0) + sub.reward);              // credit on approval
    gamify.award(owner, 'task', `task:${sub.id}`, {                 // XP once per submission
      earnedUSD: round2(sub.reward),
      event: { text: `Task approved (+$${round2(sub.reward).toFixed(2)})`, icon: '✅' },
    });
  }
  if (decision !== 'approved' && wasApproved && owner) {
    owner.usd = round2(Math.max(0, (owner.usd || 0) - sub.reward)); // reverse a prior approval
  }
  sub.status = decision;
  sub.reviewedAt = new Date().toISOString();
  sub.reviewNote = note;
  // #3 — On approval the paid task is consumed (its approved submission hides it from
  // everyone). Generate a fresh single-use replacement in the SAME category to keep the
  // number of available tasks constant. (Free tasks 'F…' are per-user, not replaced here.)
  if (decision === 'approved' && !wasApproved) {
    const t = serverTaskById(sub.taskId);
    if (t && (sub.taskId[0] === 'T' || sub.taskId[0] === 'G')) {
      const nt = generateReplacementTask(t.category);
      audit('task_replaced', { admin: ADMIN_USERNAME, approvedTaskId: sub.taskId, newTaskId: nt.id, category: t.category });
    }
  }
  audit('submission_' + decision, { admin: ADMIN_USERNAME, userId: sub.userId, taskId: sub.taskId, submissionId: sub.id, amount: decision === 'approved' ? round2(sub.reward) : 0 });
  db.save();  // commit the decision + balance BEFORE emailing (email failure never rolls back)

  const emailRec = await notifyDecision(sub, owner, serverTaskById(sub.taskId));
  res.json({ ok: true, submission: sub, email: { status: emailRec.status, error: emailRec.error } });
});

// Audit log of outgoing decision emails (with resend).
app.get('/api/admin/emails', requireAdminSession, (req, res) => {
  const log = (db.get().emailLog || []).map((e) => {
    const u = userById(e.userId);
    const t = serverTaskById(e.taskId);
    return { ...e, username: u ? u.username : null, taskTitle: t ? t.title : e.taskId };
  });
  res.json({ emails: log });
});

app.post('/api/admin/emails/:id/resend', requireAdminSession, async (req, res) => {
  const rec = (db.get().emailLog || []).find((e) => e.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Email log entry not found.' });
  if (rec.applicationId) {
    const appRec = (db.get().applications || []).find((a) => a.id === rec.applicationId);
    if (!appRec) return res.status(404).json({ error: 'Original application no longer exists.' });
    const fresh = await notifyApplication(appRec, userById(appRec.userId), serverTaskById(appRec.taskId));
    return res.json({ ok: true, email: { status: fresh.status, error: fresh.error } });
  }
  const sub = db.get().submissions.find((x) => x.id === rec.submissionId);
  if (!sub) return res.status(404).json({ error: 'Original submission no longer exists.' });
  const fresh = await notifyDecision(sub, userById(sub.userId), serverTaskById(sub.taskId));
  res.json({ ok: true, email: { status: fresh.status, error: fresh.error } });
});

// =============================================================================
//  APPLICATIONS  —  apply for a task with a proposal (admin reviews)
// =============================================================================
app.get('/api/applications', requireAuth, requirePlan, (req, res) => {
  const mine = (db.get().applications || [])
    .filter((a) => a.userId === req.user.id)
    .map((a) => ({ ...a, task: serverTaskById(a.taskId) }))
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
  res.json({ applications: mine });
});

app.post('/api/tasks/:id/apply', requireAuth, (req, res) => {
  const task = serverTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (!canAccessTask(req.user, task)) {
    return res.status(403).json({ error: 'Upgrade your subscription to access higher-paying tasks.' });
  }
  const proposal = String(req.body.proposal || '').trim();
  if (proposal.length < 10) return res.status(400).json({ error: 'Please write a short proposal (at least 10 characters).' });
  const S = db.get();
  S.applications = S.applications || [];
  if (S.applications.some((a) => a.userId === req.user.id && a.taskId === task.id && a.status !== 'rejected')) {
    return res.status(409).json({ error: 'You already have an application for this task.' });
  }
  const appRec = {
    id: rid(6), userId: req.user.id, taskId: task.id, proposal,
    status: 'pending', createdAt: new Date().toISOString(), reviewedAt: null, reviewNote: '',
  };
  S.applications.unshift(appRec);
  audit('application_created', { userId: req.user.id, taskId: task.id, applicationId: appRec.id });
  db.save();
  res.status(201).json({ application: appRec, message: 'Application submitted for review. We\'ll email you the outcome.' });
});

app.get('/api/admin/applications', requireAdminSession, (req, res) => {
  const all = (db.get().applications || [])
    .map((a) => {
      const u = userById(a.userId);
      return { ...a, task: serverTaskById(a.taskId), user: u ? { username: u.username, email: u.email } : null };
    })
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
  res.json({ applications: all });
});

app.post('/api/admin/applications/:id/decision', requireAdminSession, async (req, res) => {
  const appRec = (db.get().applications || []).find((a) => a.id === req.params.id);
  if (!appRec) return res.status(404).json({ error: 'Application not found.' });
  const decision = String(req.body.decision || '');
  const note = String(req.body.note || '').trim();
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
  appRec.status = decision;
  appRec.reviewedAt = new Date().toISOString();
  appRec.reviewNote = note;
  audit('application_' + decision, { admin: ADMIN_USERNAME, userId: appRec.userId, taskId: appRec.taskId, applicationId: appRec.id });
  db.save();
  const emailRec = await notifyApplication(appRec, userById(appRec.userId), serverTaskById(appRec.taskId));
  res.json({ ok: true, application: appRec, email: { status: emailRec.status, error: emailRec.error } });
});

// Admin audit log (read-only).
app.get('/api/admin/audit', requireAdminSession, (req, res) => {
  const log = (db.get().auditLog || []).map((a) => {
    const u = a.userId ? userById(a.userId) : null;
    return { ...a, username: u ? u.username : null };
  });
  res.json({ audit: log });
});

// =============================================================================
//  ADMIN EMAIL  —  compose to one user, broadcast to many, per-user history
// =============================================================================
// Send a branded admin email to a user and record it in the email log + audit trail.
async function sendAdminEmail(u, subject, body, type) {
  const rec = {
    id: rid(6), type: 'email_' + type, userId: u.id, to: u.email || null,
    subject, body, status: 'Failed', error: null, admin: ADMIN_USERNAME, createdAt: new Date().toISOString(),
  };
  try {
    if (!u.email) throw new Error('User has no email on file');
    if (!mailer.configured()) throw new Error('Email is not configured (set SMTP_* env vars)');
    await mailer.sendAdmin({ to: u.email, subject, body });
    rec.status = 'Sent';
  } catch (e) { rec.error = e.message; }
  const S = db.get();
  S.emailLog = S.emailLog || [];
  S.emailLog.unshift(rec);
  if (S.emailLog.length > 2000) S.emailLog.length = 2000;
  return rec;
}

// Compose and send an email to a single user.
app.post('/api/admin/users/:id/email', requireAdminSession, async (req, res) => {
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!subject || !body) return res.status(400).json({ error: 'Subject and message are both required.' });
  const rec = await sendAdminEmail(u, subject, body, 'direct');
  audit('email_direct', { admin: ADMIN_USERNAME, userId: u.id, subject });
  db.save();
  res.json({ ok: true, email: { status: rec.status, error: rec.error } });
});

// Broadcast an email to all users, or a selected subset (userIds).
app.post('/api/admin/email/broadcast', requireAdminSession, async (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!subject || !body) return res.status(400).json({ error: 'Subject and message are both required.' });
  // Target a segment (all / premium / free / active / suspended / country) or an explicit list of ids.
  const segment = String(req.body.segment || 'all');
  const country = String(req.body.country || '').trim().toLowerCase();
  const ids = Array.isArray(req.body.userIds) && req.body.userIds.length ? new Set(req.body.userIds) : null;
  const match = (u) => {
    if (!u.email) return false;
    if (ids) return ids.has(u.id);
    switch (segment) {
      case 'premium': return isPremium(u);
      case 'free': return !isPremium(u);
      case 'active': return !u.suspended;
      case 'suspended': return !!u.suspended;
      case 'country': return String((u.profile && u.profile.country) || '').toLowerCase() === country;
      default: return true; // all
    }
  };
  const targets = db.get().users.filter(match);
  let sent = 0, failed = 0;
  for (const u of targets) { const r = await sendAdminEmail(u, subject, body, 'broadcast'); if (r.status === 'Sent') sent += 1; else failed += 1; }
  audit('email_broadcast', { admin: ADMIN_USERNAME, segment: ids ? 'selected' : segment, count: targets.length, sent, failed, subject });
  db.save();
  res.json({ ok: true, total: targets.length, sent, failed });
});

// A user's email history (everything ever emailed to them).
app.get('/api/admin/users/:id/emails', requireAdminSession, (req, res) => {
  const emails = (db.get().emailLog || []).filter((e) => e.userId === req.params.id);
  res.json({ emails });
});

// ---- Admin sign-in (separate credentials + own cookie; not a client account) ----
app.get('/api/admin/session', (req, res) => {
  const sess = currentAdminSession(req);
  res.json({ authed: !!sess, username: sess ? (sess.username || ADMIN_USERNAME) : null,
    role: sess ? (sess.role || 'admin') : null, configured: !!(ADMIN_PASSWORD || FINANCE_PASSWORD) });
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD && !FINANCE_PASSWORD) return res.status(500).json({ error: 'Admin login is not configured. Set ADMIN_PASSWORD (and optionally FINANCE_PASSWORD) in .env.' });
  if (adminLock.lockedUntil > now()) {
    const mins = Math.ceil((adminLock.lockedUntil - now()) / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${mins} minute(s).` });
  }
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  // Match either the full admin or the finance sub-role.
  let role = null;
  if (ADMIN_PASSWORD && username === ADMIN_USERNAME && password === ADMIN_PASSWORD) role = 'admin';
  else if (FINANCE_PASSWORD && username === FINANCE_USERNAME && password === FINANCE_PASSWORD) role = 'finance';
  if (!role) {
    adminLock.count += 1;
    if (adminLock.count >= 5) { adminLock.lockedUntil = now() + 15 * 60 * 1000; adminLock.count = 0; }
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  adminLock = { count: 0, lockedUntil: 0 };
  createAdminSession(res, role, username);
  res.json({ ok: true, role });
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
  const S = db.get();
  const subsByUser = {};
  S.submissions.forEach((x) => { (subsByUser[x.userId] = subsByUser[x.userId] || []).push(x); });
  const users = S.users.map((u) => {
    const mine = subsByUser[u.id] || [];
    const plan = activePlan(u);
    return {
      id: u.id, name: u.name, username: u.username, email: u.email, isAdmin: !!u.isAdmin,
      balance: round2(u.balance || 0), usd: round2(u.usd || 0), onboarded: !!u.onboarded,
      referralCount: u.referralCount || 0, createdAt: u.createdAt,
      providers: u.providers || [],                       // how they joined (email / google / facebook / apple)
      suspended: !!u.suspended,
      held: !!u.held,
      status: u.suspended ? 'Suspended' : (u.held ? 'On hold' : 'Active'),
      plan: plan ? plan.name : 'Free',                    // current plan (or Free)
      planId: plan ? plan.id : 'none',                    // for the admin plan selector
      totalEarningsUSD: round2(mine.filter((x) => x.status === 'approved').reduce((a, x) => a + (x.reward || 0), 0)),
      completedTasks: mine.filter((x) => x.status === 'approved').length,
      pendingTasks: mine.filter((x) => x.status === 'pending').length,
      hasPassword: !!u.passwordHash,                      // whether a password is set (never the value)
      gender: (u.profile && u.profile.gender) || '',
      country: (u.profile && u.profile.country) || '',
      phone: (u.profile && u.profile.phone) || '',
      dob: (u.profile && u.profile.dob) || '',
      postalCode: (u.profile && u.profile.postalCode) || '',
      state: (u.profile && u.profile.state) || '',
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ users });
});

// Edit a member's full details (admin-only). Admins may change everything, including the
// fields that are locked for members themselves (country, gender, date of birth).
app.post('/api/admin/users/:id/details', requireAdminSession, (req, res) => {
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  ensureUserShape(u);
  const b = req.body;
  const name = String(b.name ?? '').trim();
  if (name) u.name = name;

  if (b.username !== undefined) {
    const nu = normalizeUsername(b.username);
    if (nu && nu !== String(u.username || '').toLowerCase()) {
      const pe = usernameProblem(nu);
      if (pe) return res.status(400).json({ error: pe });
      if (usernameTaken(nu, u.id)) return res.status(409).json({ error: 'That username is already taken.' });
      u.username = nu;
      u.usernameChangedAt = new Date().toISOString();
    }
  }
  if (b.email !== undefined) {
    const ne = normEmail(b.email);
    if (ne && ne !== u.email) {
      if (!isEmail(ne)) return res.status(400).json({ error: 'Enter a valid email address.' });
      if (findUserByEmail(ne)) return res.status(409).json({ error: 'That email is already in use.' });
      u.email = ne;
    }
  }
  u.profile = Object.assign({}, u.profile, {
    phone: String(b.phone ?? u.profile.phone ?? '').trim(),
    country: String(b.country ?? u.profile.country ?? '').trim(),
    gender: String(b.gender ?? u.profile.gender ?? '').trim(),
    dob: String(b.dob ?? u.profile.dob ?? '').trim(),
    postalCode: String(b.postalCode ?? u.profile.postalCode ?? '').trim(),
    state: String(b.state ?? u.profile.state ?? '').trim(),
  });
  db.save();
  res.json({ ok: true, message: 'Client details updated.' });
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

// Set a member's subscription plan: 'none' (Free), 'basic', 'premium' or 'premiumpro'.
app.post('/api/admin/users/:id/plan', requireAdminSession, (req, res) => {
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  ensureUserShape(u);
  const id = String(req.body.plan || '').trim();
  if (id === 'none' || id === 'free' || id === '') {
    u.plan = null;
    u.premium = { active: false, since: null, expires: null }; // keep legacy flag in sync
    db.save();
    return res.json({ ok: true, plan: 'Free', planId: 'none' });
  }
  if (!PLAN_BY_ID[id]) return res.status(400).json({ error: 'Choose a valid plan.' });
  grantPlan(u, id); // 30-day activation from now
  db.save();
  res.json({ ok: true, plan: PLAN_BY_ID[id].name, planId: id, expires: u.plan.expires });
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

// Admin: adjust a member's gamification (XP, coins, badge, verification).
app.post('/api/admin/users/:id/gamify', requireAdminSession, (req, res) => {
  const u = userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  ensureUserShape(u);
  const g = u.game;
  if (req.body.addXp !== undefined) { const n = Number(req.body.addXp); if (Number.isFinite(n)) { g.xp = Math.max(0, g.xp + n); g.xpLog.push({ ts: now(), amount: n }); } }
  if (req.body.setXp !== undefined) { const n = Number(req.body.setXp); if (Number.isFinite(n) && n >= 0) g.xp = Math.round(n); }
  if (req.body.addCoins !== undefined) { const n = Number(req.body.addCoins); if (Number.isFinite(n)) g.coins = Math.max(0, g.coins + n); }
  if (req.body.grantBadge && !g.badges.includes(req.body.grantBadge)) g.badges.push(String(req.body.grantBadge));
  if (req.body.revokeBadge) g.badges = g.badges.filter((b) => b !== req.body.revokeBadge);
  if (req.body.verification !== undefined) g.verification = req.body.verification || null; // 'blue'|'gold'|'diamond'|null
  gamify.checkBadges(u);
  g.verification = g.verification || gamify.verificationTier(g);
  audit('gamify_adjust', { userId: u.id, by: 'admin' });
  db.save();
  res.json({ ok: true, game: gamify.summary(u) });
});

// Admin: gamification leaderboard (all-time XP) with each member's level/badges.
app.get('/api/admin/leaderboard', requireAdminSession, (req, res) => {
  const rows = db.get().users.map((u) => { gamify.ensureGameShape(u);
    return { id: u.id, name: u.username || u.name, email: u.email, xp: u.game.xp, coins: u.game.coins,
      level: gamify.level(u.game.xp).name, badges: u.game.badges.length, streak: u.game.streak.best,
      verification: u.game.verification, reputation: gamify.reputation(u.game) };
  }).sort((a, b) => b.xp - a.xp);
  res.json({ rows });
});

// Generated (system/demo) users — list + rename. Renaming updates the one stored displayName,
// so the new name then appears in every leaderboard/feed. Real users are never listed here.
app.get('/api/admin/generated-users', requireAdminSession, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  let pool = ensureBotPool();
  if (q) pool = pool.filter((b) => b.displayName.toLowerCase().includes(q));
  res.json({ users: pool.slice(0, 300).map((b) => ({ id: b.id, displayName: b.displayName, country: b.country, verification: b.verification })), total: ensureBotPool().length });
});

app.post('/api/admin/generated-users/:id/rename', requireAdminSession, (req, res) => {
  const b = ensureBotPool().find((x) => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Generated user not found.' });
  const name = botHandle(req.body.displayName);   // enforce username format (lowercase, valid, 6–20)
  if (!name || name.length < 6) return res.status(400).json({ error: 'Enter a valid handle (6–20 chars: letters, numbers, . _ -).' });
  const old = b.displayName;
  b.displayName = name;
  audit('generated_user_rename', { admin: ADMIN_USERNAME, id: b.id, from: old, to: name });
  db.save();
  res.json({ ok: true, displayName: b.displayName });
});

// (A member's email address is edited via the "Edit details" form → /api/admin/users/:id/details.
//  The old dedicated change-email route was removed to avoid colliding with the send-email route.)

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

// ---- Broadcast announcements (admin -> all members) ----
app.get('/api/admin/broadcasts', requireAdminSession, (req, res) => {
  const list = (db.get().broadcasts || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ broadcasts: list });
});
app.post('/api/admin/broadcast', requireAdminSession, (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const message = String(req.body.message || '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ error: 'Enter a message to broadcast.' });
  const S = db.get();
  S.broadcasts = S.broadcasts || [];
  const bc = { id: rid(8), title, message, createdAt: new Date().toISOString() };
  S.broadcasts.unshift(bc);
  if (S.broadcasts.length > 100) S.broadcasts = S.broadcasts.slice(0, 100); // keep it bounded
  db.save();
  res.status(201).json({ ok: true, broadcast: bc, message: 'Broadcast sent to all members.' });
});
app.delete('/api/admin/broadcasts/:id', requireAdminSession, (req, res) => {
  const S = db.get();
  S.broadcasts = (S.broadcasts || []).filter((x) => x.id !== req.params.id);
  db.save();
  res.json({ ok: true });
});

// Members fetch active announcements (shown as a dismissible banner in the app).
app.get('/api/broadcasts', requireAuth, (req, res) => {
  const list = (db.get().broadcasts || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  res.json({ broadcasts: list });
});

app.get('/api/admin/deposits', requireAdminSession, (req, res) => {
  const deposits = db.get().deposits.map((d) => {
    const u = userById(d.userId);
    return { ...d, planName: d.plan && PLAN_BY_ID[d.plan] ? PLAN_BY_ID[d.plan].name : null,
      user: u ? { username: u.username, email: u.email } : null };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ deposits });
});

// Manually confirm a SUBSCRIPTION payment and grant the plan. Used to reconcile a
// payment whose M-Pesa/Paystack callback never arrived (the client was charged but the
// plan didn't auto-activate). Admin-only, audited, and idempotent.
app.post('/api/admin/deposits/:id/activate', requireAdminSession, (req, res) => {
  const actor = actorName(req);
  const rec = db.get().deposits.find((d) => d.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Payment not found.' });
  if (rec.purpose !== 'subscription') return res.status(400).json({ error: 'This payment is not a subscription.' });
  const plan = PLAN_BY_ID[rec.plan];
  if (!plan) return res.status(400).json({ error: 'This payment has no valid plan attached.' });
  const u = userById(rec.userId);
  if (!u) return res.status(404).json({ error: 'The paying user no longer exists.' });
  ensureUserShape(u);

  rec.status = 'success';
  if (!rec.paidAt) rec.paidAt = new Date().toISOString();
  rec.activatedBy = actor;                 // who reconciled it
  grantPlan(u, plan.id);                   // grant/refresh the plan (admin override)
  audit('subscription_activated', { admin: actor, userId: u.id, depositId: rec.id, plan: plan.id, amount: rec.amount, currency: rec.currency, reference: rec.reference });
  db.save();
  res.json({ ok: true, plan: plan.name, message: `${plan.name} activated for ${u.username || u.name || 'the client'}.` });
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
// Send the "Withdrawal Approved & Paid" receipt email + log it (caller persists with db.save()).
async function notifyWithdrawalPaid(rec) {
  const owner = userById(rec.userId);
  const money = (n) => (rec.currency === 'KES' ? Math.round(Number(n) || 0).toLocaleString() + ' KES' : '$' + (Number(n) || 0).toFixed(2));
  const emailRec = {
    id: rid(6), type: 'withdrawal_paid', userId: rec.userId, redemptionId: rec.id,
    amount: round2(rec.net != null ? rec.net : rec.amount), to: (owner && owner.email) || null,
    subject: 'Withdrawal Approved & Paid', status: 'Failed', error: null, admin: ADMIN_USERNAME, createdAt: new Date().toISOString(),
  };
  try {
    if (!owner || !owner.email) throw new Error('User has no email on file');
    if (!mailer.configured()) throw new Error('Email is not configured (set SMTP_* env vars)');
    await mailer.sendWithdrawalPaid({
      to: owner.email, name: owner.name || owner.username || 'there',
      gross: money(rec.amount), fee: money(rec.fee != null ? rec.fee : rec.amount * 0.20),
      net: money(rec.net != null ? rec.net : rec.amount * 0.80),
      reference: rec.reference, date: new Date().toLocaleString(),
    });
    emailRec.status = 'Sent';
  } catch (e) { emailRec.error = e.message; }
  const S = db.get();
  S.emailLog = S.emailLog || [];
  S.emailLog.unshift(emailRec);
  if (S.emailLog.length > 2000) S.emailLog.length = 2000;
  return emailRec;
}

app.post('/api/admin/redemptions/:id/mark', requireAdminSession, async (req, res) => {
  const actor = actorName(req);
  const rec = db.get().redemptions.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Redemption not found.' });
  const status = String(req.body.status || '');
  if (!['Paid', 'Failed', 'Processing'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const heldUSD = rec.amountUSD != null ? rec.amountUSD : rec.amount; // USD that was held

  if (status === 'Failed' && rec.status !== 'Failed') {
    const u = userById(rec.userId); // refund the held USD on rejection
    if (u) { ensureUserShape(u); u.usd = round2(u.usd + heldUSD); }
    rec.status = 'Failed'; rec.reviewedAt = new Date().toISOString();
    rec.reason = String(req.body.reason || '').trim() || rec.reason || '';  // rejection reason (shown to the member)
    audit('withdrawal_rejected', { admin: actor, userId: rec.userId, redemptionId: rec.id, amount: round2(heldUSD), reason: rec.reason });
    db.save();
    return res.json({ ok: true, redemption: rec });
  }

  // Paid: record the 20% withdrawal fee + net paid (admin may override either) for the receipt.
  if (status === 'Paid') {
    rec.fee = req.body.fee != null ? round2(req.body.fee) : round2(rec.amount * 0.20);
    rec.net = req.body.net != null ? round2(req.body.net) : round2(rec.amount - rec.fee);
  }

  // Approving an M-Pesa payout: actually send it via B2C when configured.
  if (status === 'Paid' && rec.method === 'M-Pesa' && rec.status !== 'Paid' && payments.mpesaConfigured()) {
    // Pay out the NET amount (after the withdrawal fee); the fee is retained by the platform.
    const payoutKES = rec.net != null ? rec.net : rec.amount;
    const kesAmount = rec.currency === 'KES' ? Math.round(payoutKES) : Math.round((rec.net != null ? rec.net : heldUSD) * FX_KES_PER_USD);
    try {
      rec.provider = { type: 'mpesa', kesAmount, ...(await payments.mpesaB2C({ phone: rec.destination, amount: kesAmount, resultUrl: b2cResultUrl(req), timeoutUrl: b2cTimeoutUrl(req) })) };
      rec.status = 'Processing'; rec.reviewedAt = new Date().toISOString(); // final Paid/Failed comes on the M-Pesa result callback
      const em = await notifyWithdrawalPaid(rec);
      audit('withdrawal_paid', { admin: actor, userId: rec.userId, redemptionId: rec.id, amount: round2(rec.net != null ? rec.net : rec.amount) });
      db.save();
      return res.json({ ok: true, redemption: rec, email: { status: em.status, error: em.error }, message: `M-Pesa payout of ${kesAmount.toLocaleString()} KES submitted.` });
    } catch (err) {
      rec.error = String(err.message || err); db.save();
      return res.status(502).json({ error: 'M-Pesa payout failed: ' + rec.error });
    }
  }

  rec.status = status; rec.reviewedAt = new Date().toISOString();
  let email = null;
  if (status === 'Paid') {
    const em = await notifyWithdrawalPaid(rec);
    email = { status: em.status, error: em.error };
    audit('withdrawal_paid', { admin: actor, userId: rec.userId, redemptionId: rec.id, amount: round2(rec.net != null ? rec.net : rec.amount) });
  }
  db.save();
  res.json({ ok: true, redemption: rec, email });
});

// -----------------------------------------------------------------------------
//  Admin-initiated withdrawal — create a withdrawal ON BEHALF of a client, from
//  their profile. Holds (deducts) the balance now, records the initiating admin +
//  optional note + a unique reference, notifies the client (in-app + email), and
//  leaves it "Requested" so it is RELEASED from the Withdrawals tab using the same
//  manual pay/refund flow as member-requested withdrawals. Every step is audited.
//  Authorization: admin session only (the platform's privileged/finance role).
// -----------------------------------------------------------------------------
app.post('/api/admin/users/:id/withdraw', requireAdminSession, async (req, res) => {
  const actor = actorName(req);
  const target = userById(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  ensureUserShape(target);

  const method = String(req.body.method || '').trim();
  const rawAmount = round2(req.body.amount);
  let destination = String(req.body.destination || '').trim();
  const bankCode = String(req.body.bankCode || '').trim();
  const accountNumber = String(req.body.accountNumber || '').replace(/\s+/g, '');
  const note = String(req.body.note || '').trim().slice(0, 500);

  if (!WITHDRAW_METHODS.includes(method)) return res.status(400).json({ error: 'Choose a payout method (M-Pesa, PayPal or Bank account).' });
  if (!(rawAmount > 0)) return res.status(400).json({ error: 'Enter a valid amount.' });

  const currency = method === 'M-Pesa' ? 'KES' : 'USD';               // M-Pesa in KES, others USD
  const amountUSD = currency === 'KES' ? round2(rawAmount / FX_KES_PER_USD) : rawAmount;

  // Admin-initiated withdrawals have NO platform minimum (finance/privileged action) —
  // any amount from 1 KES upward is allowed. The member-facing MIN_REDEEM still applies to
  // client-requested withdrawals in /api/redeem (unchanged).
  if (currency === 'KES' && rawAmount < 1) return res.status(400).json({ error: 'Enter at least 1 KES.' });

  // No duplicate / in-progress withdrawal for the same client.
  if (db.get().redemptions.some((r) => r.userId === target.id && /request|process/i.test(r.status))) {
    return res.status(409).json({ error: 'This client already has a withdrawal in progress. Complete or reject it first.' });
  }

  // Per-method destination validation (admin-entered; free-text bank details allowed).
  if (method === 'M-Pesa') {
    if (!/^(?:254|0)\d{9}$/.test(destination.replace(/\s+/g, ''))) return res.status(400).json({ error: 'Enter a valid M-Pesa phone number (e.g. 0712345678).' });
  } else if (method === 'PayPal') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destination)) return res.status(400).json({ error: 'Enter a valid PayPal email address.' });
  } else if (method === 'Bank account') {
    if (destination.replace(/\s+/g, '').length < 6 && accountNumber.length < 6) {
      return res.status(400).json({ error: 'Enter the bank account details (account name, bank and account number).' });
    }
  }

  const availableUSD = combinedUSD(target);
  if (amountUSD > availableUSD) return res.status(400).json({ error: `Amount exceeds the client's available balance ($${availableUSD.toFixed(2)}).` });

  // Build recipient details (so whoever releases the payout knows exactly where to send it).
  let recipient = null;
  if (method === 'M-Pesa') {
    destination = payments.normalizePhone(destination);
    recipient = { type: 'mobile_money', provider: 'MPESA', phone: destination };
  } else if (method === 'PayPal') {
    recipient = { type: 'paypal', email: destination };
  } else if (method === 'Bank account') {
    let name = String(req.body.accountName || '').trim();
    try { if (bankCode && accountNumber && investPay.paystackConfigured()) { const rr = await investPay.paystackResolveAccount(accountNumber, bankCode); if (rr.accountName) name = rr.accountName; } } catch (_) {}
    if (!name) name = target.name || '';
    const bankName = String(req.body.bankName || '').trim();
    recipient = { type: 'bank', name, bankCode: bankCode || null, bankName: bankName || null, accountNumber: accountNumber || null };
    if (!destination) destination = [name, bankName, accountNumber].filter(Boolean).join(' · ');
  }

  // Hold (deduct) the funds now; released manually from the Withdrawals tab.
  deductCombined(target, 'USD', amountUSD);
  const reference = 'wd_adm_' + rid(10);
  const rec = {
    id: rid(8), userId: target.id, idempotencyKey: null,
    amount: rawAmount, currency, amountUSD, method, destination, reference,
    status: 'Requested', createdAt: new Date().toISOString(), resultAt: null,
    provider: null, recipient, error: null,
    source: 'admin', initiatedBy: actor, adminNote: note || null,
  };
  db.get().redemptions.push(rec);

  // In-app notification to the client (+ XP once per withdrawal).
  gamify.award(target, 'withdraw', `redeem:${rec.id}`, {
    event: { text: `Withdrawal initiated by admin (${currency === 'KES' ? rawAmount.toLocaleString() + ' KES' : '$' + rawAmount.toFixed(2)}) 💸`, icon: '💸' },
  });
  audit('withdrawal_initiated_by_admin', { admin: actor, userId: target.id, redemptionId: rec.id, method, amountUSD: round2(amountUSD), reference, note: note || null });
  db.save();
  await db.flush();

  // Best-effort email notice to the client (never blocks the withdrawal).
  const shown = currency === 'KES' ? `${rawAmount.toLocaleString()} KES` : `$${rawAmount.toFixed(2)}`;
  let email = { status: 'Skipped', error: null };
  try {
    if (target.email && mailer.configured()) {
      await mailer.sendAdmin({
        to: target.email,
        subject: 'Withdrawal initiated on your account',
        body: `Hi ${target.name || target.username || 'there'},\n\nA withdrawal of ${shown} via ${method} has been initiated on your Gweno account by our team and is now being processed (reference ${reference}). The amount has been held from your balance.\n\nYou'll be notified again once the payment is completed. If you did not expect this, please contact support immediately.\n\nThe Gweno Team`,
      });
      email = { status: 'Sent', error: null };
    }
  } catch (e) { email = { status: 'Failed', error: e.message }; }
  const S = db.get();
  S.emailLog = S.emailLog || [];
  S.emailLog.unshift({ id: rid(6), type: 'withdrawal_initiated', userId: target.id, redemptionId: rec.id, amount: round2(amountUSD), to: target.email || null, subject: 'Withdrawal initiated on your account', status: email.status, error: email.error, admin: actor, createdAt: new Date().toISOString() });
  if (S.emailLog.length > 2000) S.emailLog.length = 2000;
  db.save();

  console.log(`[gweno] admin-initiated withdrawal ${rec.id} by=${actor} user=${target.id} ${method} $${amountUSD} ref=${reference}`);
  res.status(201).json({ ok: true, redemption: rec, email,
    message: `Withdrawal of ${shown} via ${method} initiated for ${target.username || target.name}. Funds are held — release the payment from the Withdrawals tab.` });
});

// M-Pesa STK diagnostics — surfaces the exact Daraja error without exposing secrets.
app.get('/api/admin/mpesa/diagnose', requireAdminSession, async (req, res) => {
  const c = payments.CFG;
  const oauth = await payments.mpesaOAuthTest();
  res.json({
    env: c.env,
    stkConfigured: payments.mpesaStkConfigured(),
    present: { consumerKey: !!c.key, consumerSecret: !!c.secret, stkShortcode: !!c.stkShortcode, passkey: !!c.passkey },
    stkShortcode: c.stkShortcode || null,      // shortcode is not secret
    callbackUrl: stkCallbackUrl(req),
    publicUrl: process.env.PUBLIC_URL || null,
    oauth,
  });
});

// Send a real KES 1 STK push to the admin's own phone and return the exact result.
app.post('/api/admin/mpesa/test-stk', requireAdminSession, async (req, res) => {
  const phone = String(req.body.phone || '').trim();
  if (!/^(?:254|0)\d{9}$/.test(phone.replace(/\s+/g, ''))) return res.status(400).json({ error: 'Enter a valid Safaricom number (e.g. 0712345678).' });
  if (!payments.mpesaStkConfigured()) return res.status(503).json({ error: 'STK is not configured (missing consumer key/secret/STK shortcode/passkey).' });
  try {
    const r = await payments.mpesaStkPush({ phone, amount: 1, accountRef: 'GwenoTest', description: 'STK test', callbackUrl: stkCallbackUrl(req) });
    res.json({ ok: true, message: 'STK push sent — check that phone for the M-Pesa PIN prompt.', detail: r });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
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
app.get('/api/referral', requireAuth, requirePlan, (req, res) => {
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

app.post('/api/referral/regenerate', requireAuth, requirePlan, (req, res) => {
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
  // Policy: total balance must be at least the KES 10 minimum before any withdrawal.
  if (combinedKES(req.user) < MIN_REDEEM_KES) {
    return res.status(400).json({ error: `Your balance is below the minimum withdrawal of KES ${MIN_REDEEM_KES}. Earn a little more, then try again.` });
  }
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

  // One withdrawal at a time: block a new request while an earlier one is still in progress.
  if (db.get().redemptions.some((r) => r.userId === req.user.id && /request|process/i.test(r.status))) {
    return res.status(409).json({ error: 'You already have a withdrawal being processed. Please wait until it is completed before requesting another.' });
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

  // ALL withdrawals are handled MANUALLY by an admin. Hold (deduct) the funds now and
  // record the request as "Requested"; an admin verifies it, pays it out by hand, and
  // marks it Paid — or rejects it, which refunds the held balance.
  deductCombined(req.user, 'USD', amountUSD);
  const reference = 'wd_' + (idemKey ? idemKey.replace(/[^A-Za-z0-9_]/g, '') : rid(10));

  // Capture full payout details so the admin knows exactly where to send the money.
  let recipient = null;
  if (method === 'M-Pesa') {
    destination = payments.normalizePhone(destination);
    recipient = { type: 'mobile_money', provider: 'MPESA', phone: destination };
  } else if (method === 'PayPal') {
    recipient = { type: 'paypal', email: destination };
  } else if (method === 'Bank account') {
    let name = String(req.body.accountName || '').trim();
    // Optional: confirm the real account-holder name via Paystack (read-only lookup).
    try { if (bankCode && accountNumber && investPay.paystackConfigured()) { const rr = await investPay.paystackResolveAccount(accountNumber, bankCode); if (rr.accountName) name = rr.accountName; } } catch (_) {}
    if (!name) name = req.user.name || '';
    const bankName = String(req.body.bankName || '').trim();
    recipient = { type: 'bank', name, bankCode: bankCode || null, bankName: bankName || null, accountNumber: accountNumber || null };
    if (!destination) destination = [name, bankName, accountNumber].filter(Boolean).join(' · ');
  }

  const rec = {
    id: rid(8), userId: req.user.id, idempotencyKey: idemKey || null,
    amount: rawAmount, currency, amountUSD, method, destination, reference,
    status: 'Requested', createdAt: new Date().toISOString(), resultAt: null,
    provider: null, recipient, error: null,
  };
  db.get().redemptions.push(rec);
  gamify.award(req.user, 'withdraw', `redeem:${rec.id}`, {        // XP once per withdrawal
    event: { text: 'Withdrawal requested 💸', icon: '💸' },
  });
  audit('withdrawal_requested', { userId: req.user.id, redemptionId: rec.id, method, amountUSD });
  db.save();
  console.log(`[gweno] withdrawal ${rec.id} user=${req.user.id} ${method} $${amountUSD} ref=${reference}`);

  const shown = currency === 'KES' ? `${rawAmount.toLocaleString()} KES` : `$${rawAmount}`;
  return res.json({ ok: true, redemption: publicRedemption(rec),
    message: `Withdrawal of ${shown} via ${method} submitted. Our team will verify and send it, usually within 24 hours.` });
});

// A member's own view of a withdrawal (no internal provider secrets).
function publicRedemption(r) {
  return {
    id: r.id, amount: r.amount, currency: r.currency, amountUSD: r.amountUSD,
    method: r.method, destination: r.destination, status: r.status,
    reference: r.reference, createdAt: r.createdAt, resultAt: r.resultAt, error: r.error || null,
    reason: r.reason || null,   // admin's reason when a withdrawal is rejected
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
  } else if (evt.event === 'charge.success') {
    // Incoming payment confirmed by Paystack — activate the subscription / credit the top-up
    // even if the buyer closed the tab before the return redirect. Idempotent: only acts while
    // the record is still pending, so it can never activate or credit twice.
    const ref = evt.data && evt.data.reference;
    const rec = db.get().deposits.find((d) => d.reference === ref);
    if (rec && rec.status === 'pending') {
      rec.status = 'success'; rec.paidAt = new Date().toISOString();
      const u = userById(rec.userId);
      if (u) {
        ensureUserShape(u);
        if (rec.purpose === 'subscription') activateSubscription(u, rec, 'auto:paystack'); // grants + notifies + emails
        else u.usd = round2((u.usd || 0) + (rec.amount || 0)); // Paystack top-ups are in USD
      }
      audit('paystack_charge_success', { reference: ref, userId: rec.userId, purpose: rec.purpose || 'deposit', plan: rec.plan || null, amount: rec.amount });
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
      if (rec.purpose === 'subscription') {
        // Verify the amount paid matches the plan price before activating (anti-tamper).
        const amtItem = items.find((i) => i.Name === 'Amount');
        const paidKES = amtItem ? Number(amtItem.Value) : Number(rec.amount);
        const planObj = PLAN_BY_ID[rec.plan || 'premium'];
        if (planObj && paidKES >= planObj.priceKES) {
          activateSubscription(u, rec, 'auto:mpesa');            // grants plan + notifies + emails
        } else {
          rec.error = `Subscription amount mismatch (paid ${paidKES}, expected ${planObj ? planObj.priceKES : '?'}) — needs admin review.`;
        }
      } else {
        u.balance = round2((u.balance || 0) + rec.amount);
      }
    }
  } else {
    rec.status = 'failed'; rec.error = cb.ResultDesc;
  }
  db.save();
}

// Activate a paid subscription automatically (NO admin approval). Grants/refreshes the
// plan, records the source, sends an in-app notification and a confirmation email.
// Called only from CONFIRMED-payment paths (verified M-Pesa/Paystack callbacks & returns).
function activateSubscription(u, rec, source) {
  const planId = (rec && rec.plan) || 'premium';
  const planObj = PLAN_BY_ID[planId] || PLAN_BY_ID.premium;
  grantPlan(u, planId);                          // sets/refreshes plan + expiry, audited
  if (rec) rec.activatedBy = source || 'auto';
  try {
    gamify.award(u, 'subscription', `sub:${(rec && rec.id) || planId}`, {
      event: { text: `${planObj.name} subscription activated`, icon: '⭐' },
    });
  } catch (_) {}
  // Best-effort confirmation email — never blocks activation.
  (async () => {
    try {
      if (!u.email || !mailer.configured()) return;
      const expires = (u.plan && u.plan.expires) ? new Date(u.plan.expires).toLocaleDateString() : null;
      await mailer.sendSubscriptionActivated({ to: u.email, name: u.name || u.username || 'there', plan: planObj.name, expires });
    } catch (e) { console.error('[gweno] subscription email failed:', e.message); }
  })();
}

// =============================================================================
//  PREMIUM SUBSCRIPTION  —  $10 (charged in KES) via M-Pesa STK, unlocks $1–$4 tasks
// =============================================================================
app.get('/api/subscription', requireAuth, (req, res) => {
  const p = activePlan(req.user);
  res.json({
    active: userRank(req.user) > 0,
    plan: p ? { id: p.id, name: p.name, rank: p.rank, maxUSD: p.maxUSD } : null,
    expires: (req.user.plan && req.user.plan.expires) || null,
    plans: PLANS.map((x) => ({ id: x.id, name: x.name, priceKES: x.priceKES, minUSD: x.minUSD, maxUSD: x.maxUSD, rank: x.rank })),
    live: payments.mpesaStkConfigured(),
    cardLive: investPay.paystackConfigured(),
  });
});

app.post('/api/subscribe', requireAuth, async (req, res) => {
  const plan = PLAN_BY_ID[String(req.body.plan || '').trim()];
  if (!plan) return res.status(400).json({ error: 'Choose a subscription plan.' });
  const elig = upgradeEligibility(req.user, plan.id);
  if (!elig.ok) return res.status(400).json({ error: elig.error });
  const phone = String(req.body.phone || '').trim();
  const amountKES = plan.priceKES;
  if (!/^(?:254|0)\d{9}$/.test(phone.replace(/\s+/g, ''))) return res.status(400).json({ error: 'Enter a valid M-Pesa phone number (e.g. 0712345678).' });
  if (!payments.mpesaStkConfigured()) return res.status(503).json({ error: 'M-Pesa subscription is not available yet. Please check back soon.' });

  const reference = 'sub_' + rid(8);
  const rec = {
    id: rid(8), userId: req.user.id, amount: amountKES, currency: 'KES', reference, phone,
    purpose: 'subscription', plan: plan.id, status: 'pending', createdAt: new Date().toISOString(), paidAt: null, provider: null, error: null,
  };
  db.get().deposits.push(rec);
  db.save();

  try {
    rec.provider = { type: 'mpesa-stk', ...(await payments.mpesaStkPush({ phone, amount: amountKES, accountRef: 'Gweno ' + plan.name, description: plan.name + ' subscription', callbackUrl: stkCallbackUrl(req) })) };
    db.save();
    return res.json({ ok: true, reference, message: `Payment request sent. Enter your M-Pesa PIN to activate ${plan.name}.` });
  } catch (err) {
    rec.status = 'failed'; rec.error = String(err.message || err);
    db.save();
    return res.status(502).json({ error: 'Subscription payment failed: ' + rec.error });
  }
});

// Subscribe by card via Paystack. Premium is NOT granted here — only after the payment
// is CONFIRMED on the return from the hosted checkout (see /api/subscribe/pay/return).
app.post('/api/subscribe/manual', requireAuth, async (req, res) => {
  const plan = PLAN_BY_ID[String(req.body.plan || '').trim()];
  if (!plan) return res.status(400).json({ error: 'Choose a subscription plan.' });
  const elig = upgradeEligibility(req.user, plan.id);
  if (!elig.ok) return res.status(400).json({ error: elig.error });
  const method = String(req.body.method || '').trim();
  if (!['Card', 'Paystack'].includes(method)) return res.status(400).json({ error: 'Choose a card payment method.' });
  if (!investPay.paystackConfigured()) {
    return res.status(503).json({ error: "Card payments aren't set up yet. The plan only unlocks after a confirmed payment." });
  }
  const priceUSD = round2(plan.priceKES / FX_KES_PER_USD);
  const ref = 'sub_' + rid(10);
  const rec = {
    id: rid(8), userId: req.user.id, email: req.user.email, amount: priceUSD, currency: 'USD', reference: ref,
    purpose: 'subscription', plan: plan.id, method, status: 'pending', createdAt: new Date().toISOString(), paidAt: null, provider: null, error: null,
  };
  db.get().deposits.push(rec);
  db.save();
  try {
    const cur = (process.env.PAYSTACK_CURRENCY || 'KES').toUpperCase();
    const amountMajor = cur === 'KES' ? plan.priceKES : priceUSD;
    const returnUrl = `${appBase(req)}/api/subscribe/pay/return?ref=${ref}`;
    const { url, providerRef } = await investPay.createCheckout(method, { amountUSD: priceUSD, amountMajor, currency: cur, email: req.user.email, ref, returnUrl });
    rec.provider = { type: 'paystack', method, providerRef, currency: cur, amountCharged: amountMajor };
    db.save();
    return res.json({ ok: true, mode: 'redirect', url, message: `Redirecting to pay for ${plan.name}…` });
  } catch (err) {
    rec.status = 'failed'; rec.error = String(err.message || err); db.save();
    return res.status(502).json({ error: 'Could not start payment: ' + rec.error });
  }
});

// Paystack redirects the browser back here after a Premium payment; grant Premium only
// once the payment is verified as successful.
app.get('/api/subscribe/pay/return', async (req, res) => {
  const rec = db.get().deposits.find((d) => d.reference === String(req.query.ref || '') && d.purpose === 'subscription');
  if (!rec || !rec.provider) return res.redirect('/app.html#/tasks');
  try {
    if (rec.status === 'pending' && await investPay.verify(rec.provider.method, rec.provider.providerRef)) {
      rec.status = 'success'; rec.paidAt = new Date().toISOString();     // Paystack verify() confirms txn + amount + reference
      const u = userById(rec.userId);
      if (u) { ensureUserShape(u); activateSubscription(u, rec, 'auto:paystack'); } // grants + notifies + emails (no admin approval)
      db.save();
    }
  } catch (_) { /* leave pending; plan stays locked */ }
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
  // Country, gender and date of birth are locked after registration (admin-only); they are
  // preserved from the existing profile and never overwritten by a user request here.
  u.profile = Object.assign({}, u.profile, {
    phone: String(b.phone ?? u.profile.phone ?? '').trim(),
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
  const nu = normalizeUsername(req.body.newUsername);
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
app.get('/api/surveys', requireAuth, requirePlan, (req, res) => {
  const done = new Set(req.user[SURVEY_DONE] || []);
  res.json({
    surveys: surveysMod.SURVEYS.map((s) => ({
      id: s.id, title: s.title, minutes: s.minutes, reward: s.reward,
      questions: s.questions, done: done.has(s.id),
    })),
  });
});

app.post('/api/surveys/:id/complete', requireAuth, requirePlan, (req, res) => {
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
  const gres = gamify.award(req.user, 'survey', `survey:${survey.id}`, {
    earnedUSD: round2(survey.reward),
    event: { text: `Survey completed (+$${round2(survey.reward).toFixed(2)})`, icon: '🗳️' },
  });
  db.save();
  res.json({ ok: true, reward: survey.reward, balanceUSD: round2(req.user.usd), gamify: gres, message: `Survey complete. You earned $${survey.reward.toFixed(2)}.` });
});

// =============================================================================
//  QUESTIONNAIRES  —  professional earning quizzes, tier-gated, auto-scored,
//  admin-approved. Reward is credited ONLY on approval, then the questionnaire
//  rotates out (never shown to that user again). Free users get ONE total.
// =============================================================================
app.get('/api/questionnaires', requireAuth, (req, res) => {
  const plan = activePlan(req.user);
  const planId = plan ? plan.id : 'free';
  const mineSubs = myQuizSubs(req.user.id);
  const completedIds = new Set(mineSubs.filter((x) => x.status !== 'rejected').map((x) => x.quizId)); // rotate out pending/approved
  const approvedCount = mineSubs.filter((x) => x.status === 'approved').length;
  const pendingCount = mineSubs.filter((x) => x.status === 'pending').length;
  const noPlan = userRank(req.user) === 0;

  let list = quizMod.QUESTIONNAIRES
    .filter((z) => quizMod.tierUnlocked(planId, z.tier) && !completedIds.has(z.id))
    .map((z) => quizMod.publicView(z));

  // Free users: exactly ONE questionnaire, and only if their single free activity is unused.
  let free = null;
  if (noPlan) {
    const quizNonRej = mineSubs.filter((x) => x.status !== 'rejected');
    const usedTask = mySubmissions(req.user.id).some((x) => x.status !== 'rejected');
    if (quizNonRej.length) { list = []; free = { active: true, state: quizNonRej.some((x) => x.status === 'approved') ? 'completed' : 'pending', via: 'questionnaire' }; }
    else if (usedTask) { list = []; free = { active: true, state: 'completed', via: 'task' }; }
    else { list = list.slice(0, 1); free = { active: true, state: 'available' }; }
  }

  res.json({
    plan: plan ? { id: plan.id, name: plan.name, rank: plan.rank } : null,
    planId,
    tierNames: quizMod.TIER_NAME,
    questionnaires: list,
    completed: approvedCount,
    pending: pendingCount,
    free,
    lockedMessage: noPlan && (!free || free.state !== 'available') ? FREE_LIMIT_MSG : null,
    mySubmissions: mineSubs.slice(0, 20).map((s) => ({ id: s.id, title: s.title, category: s.category, reward: s.reward, pct: s.pct, status: s.status, reviewNote: s.reviewNote || '', createdAt: s.createdAt })),
  });
});

app.post('/api/questionnaires/:id/submit', requireAuth, rateLimit('quiz', 30, 60 * 1000), (req, res) => {
  const z = quizMod.byId(req.params.id);
  if (!z) return res.status(404).json({ error: 'Questionnaire not found.' });
  if (req.user.held) return res.status(403).json({ error: 'Your account is on hold. Questionnaires are paused until an admin restores your account.' });
  const plan = activePlan(req.user);
  const planId = plan ? plan.id : 'free';
  if (!quizMod.tierUnlocked(planId, z.tier)) {
    return res.status(403).json({ error: 'Upgrade your subscription to access this questionnaire.', code: 'no_plan' });
  }
  // Free users: ONE earning activity total (task OR questionnaire, never both).
  if (userRank(req.user) === 0 && freeActivityUsed(req.user)) {
    return res.status(403).json({ error: FREE_LIMIT_MSG, code: 'free_used' });
  }
  const S = db.get();
  S.quizSubmissions = S.quizSubmissions || [];
  if (S.quizSubmissions.some((x) => x.userId === req.user.id && x.quizId === z.id && x.status !== 'rejected')) {
    return res.status(409).json({ error: 'You have already completed this questionnaire.' });
  }
  const answers = req.body.answers || {};
  if (typeof answers !== 'object' || Object.keys(answers).length < z.questions.length) {
    return res.status(400).json({ error: 'Please answer all questions before submitting.' });
  }
  const result = quizMod.score(z, answers);   // automatic scoring
  const rec = {
    id: rid(8), userId: req.user.id, quizId: z.id, title: z.title, category: z.category, tier: z.tier,
    reward: z.reward, score: result.correct, total: result.total, pct: result.pct, passed: result.passed,
    status: 'pending', reviewNote: '', createdAt: new Date().toISOString(), reviewedAt: null, reviewedBy: null,
  };
  S.quizSubmissions.unshift(rec);
  audit('quiz_submitted', { userId: req.user.id, quizId: z.id, pct: result.pct });
  db.save();
  res.status(201).json({
    ok: true,
    result: { correct: result.correct, total: result.total, pct: result.pct, passed: result.passed },
    submission: { id: rec.id, status: 'pending', reward: z.reward },
    message: `Submitted — you scored ${result.correct}/${result.total} (${result.pct}%). Your $${z.reward.toFixed(2)} reward will be credited once an admin approves it.`,
  });
});

// ---- Admin: review questionnaire submissions ------------------------------
app.get('/api/admin/questionnaires', requireAdminSession, (req, res) => {
  const all = (db.get().quizSubmissions || []).map((s) => {
    const u = userById(s.userId);
    return { ...s, user: u ? { username: u.username, email: u.email } : { username: 'User', email: null } };
  }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ submissions: all });
});

app.post('/api/admin/questionnaires/:id/decision', requireAdminSession, (req, res) => {
  const actor = actorName(req);
  const rec = (db.get().quizSubmissions || []).find((x) => x.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Submission not found.' });
  const decision = String(req.body.decision || '');
  const note = String(req.body.note || '').trim();
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
  const owner = userById(rec.userId);
  if (owner) ensureUserShape(owner);
  const wasApproved = rec.status === 'approved';
  const S = db.get();
  if (decision === 'approved' && !wasApproved && owner) {
    owner.usd = round2((owner.usd || 0) + rec.reward);                       // credit ONLY on approval
    S.transactions = S.transactions || [];
    S.transactions.unshift({ id: rid(8), userId: owner.id, type: 'quiz_reward', quizId: rec.quizId, amountUSD: round2(rec.reward), ref: rec.id, createdAt: new Date().toISOString() });
    if (S.transactions.length > 5000) S.transactions.length = 5000;
    gamify.award(owner, 'quiz', `quiz:${rec.id}`, {
      earnedUSD: round2(rec.reward),
      event: { text: `Questionnaire approved (+$${round2(rec.reward).toFixed(2)})`, icon: '📝' },
    });
  }
  if (decision !== 'approved' && wasApproved && owner) {
    owner.usd = round2(Math.max(0, (owner.usd || 0) - rec.reward));          // reverse a prior approval
  }
  rec.status = decision; rec.reviewNote = note; rec.reviewedAt = new Date().toISOString(); rec.reviewedBy = actor;
  audit('quiz_' + decision, { admin: actor, userId: rec.userId, quizId: rec.quizId, submissionId: rec.id, amount: decision === 'approved' ? round2(rec.reward) : 0 });
  db.save();
  res.json({ ok: true, submission: { id: rec.id, status: rec.status, reviewNote: rec.reviewNote } });
});

// =============================================================================
//  SHARE & EARN  —  social-sharing rewards (TikTok / WhatsApp / Google review)
//  Open to every signed-in user (drives growth). Each submission is admin-reviewed;
//  the reward is credited ONLY on approval. Screenshots are stored OUTSIDE the
//  hot JSONB state (db.putImage) so per-request reload/persist stays fast.
// =============================================================================
const SHARE_REWARD = 0.30; // default/display only; each task carries its own reward ($0.10–$0.40)
const TIKTOK_OFFICIAL = process.env.TIKTOK_OFFICIAL_URL || 'https://www.tiktok.com/@gweno.com';
const SHARE_TASKS = [
  { key: 'whatsapp', name: 'WhatsApp Group Share', reward: 0.20, icon: '💬', link: null,
    steps: ['Share your Gweno link (shown above) to at least 3 WhatsApp groups.',
            'Take a screenshot showing the message shared in the groups.',
            'Upload the screenshot below as proof.'] },
  { key: 'tiktok', name: 'TikTok Repost', reward: 0.30, icon: '🎵', link: TIKTOK_OFFICIAL,
    steps: ['Open our official TikTok account (link below) and choose a video.',
            'Share the video and repost it to your own profile.',
            'Screenshot your repost and upload it below as proof.'] },
  { key: 'google', name: 'Review Our Website', reward: 0.40, icon: '⭐', link: 'https://www.google.com/search?q=gweno',
    steps: ['Open Google and search for “Gweno”.',
            'Leave an honest review about your experience using Gweno.',
            'Screenshot your published review and upload it below as proof.'] },
];
const SHARE_BY_KEY = Object.fromEntries(SHARE_TASKS.map((t) => [t.key, t]));

// sha256 of the uploaded image — used to reject re-used screenshots (anti-abuse).
function imageHash(dataUrl) { return crypto.createHash('sha256').update(String(dataUrl)).digest('hex'); }

// Decode a stored data-URL and stream it as a real image (opens full-size in a tab).
async function serveShareImage(res, imageId) {
  const dataUrl = await db.getImage(imageId);
  const m = dataUrl && dataUrl.match(/^data:(image\/[a-z0-9+.-]+);base64,(.*)$/i);
  if (!m) return res.status(404).send('Not found');
  res.set('Content-Type', m[1]);
  res.set('Cache-Control', 'private, max-age=300');
  res.send(Buffer.from(m[2], 'base64'));
}

app.get('/api/share', requireAuth, (req, res) => {
  const link = `${baseUrl(req)}/signup.html?ref=${(req.user.referral && req.user.referral.code) || ''}`;
  const mine = (db.get().shareSubmissions || [])
    .filter((s) => s.userId === req.user.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((s) => ({
      id: s.id, platform: s.platform, platformName: (SHARE_BY_KEY[s.platform] || {}).name || s.platform,
      reward: s.reward, status: s.status, reviewNote: s.reviewNote || '',
      createdAt: s.createdAt, reviewedAt: s.reviewedAt,
    }));
  // A platform is open to submit only if there's no pending/approved submission for it.
  const blocked = new Set(mine.filter((s) => s.status !== 'rejected').map((s) => s.platform));
  const earnedUSD = round2(mine.filter((s) => s.status === 'approved').reduce((a, s) => a + (s.reward || 0), 0));
  res.json({
    link, reward: SHARE_REWARD, maxBytes: 5 * 1024 * 1024, earnedUSD,
    tasks: SHARE_TASKS.map((t) => ({ ...t, canSubmit: !blocked.has(t.key) })),
    submissions: mine,
  });
});

app.post('/api/share/submit', requireAuth, rateLimit('share', 20, 60_000), async (req, res) => {
  const platform = String(req.body.platform || '').trim().toLowerCase();
  const task = SHARE_BY_KEY[platform];
  if (!task) return res.status(400).json({ error: 'Choose TikTok or WhatsApp.' });
  if (req.user.held) return res.status(403).json({ error: 'Your account is on hold. Sharing is paused until an admin restores it.' });

  const img = String(req.body.image || '');
  // Format: JPG / JPEG / PNG only.
  if (!/^data:image\/(png|jpe?g);base64,/i.test(img)) return res.status(400).json({ error: 'Upload a JPG, JPEG or PNG screenshot.' });
  // Size: max 5 MB (measured on the decoded bytes).
  const b64 = img.slice(img.indexOf(',') + 1);
  if (b64.length < 200) return res.status(400).json({ error: 'That screenshot looks empty. Please upload a real screenshot.' });
  if (Math.floor((b64.length * 3) / 4) > 5 * 1024 * 1024) return res.status(413).json({ error: 'That screenshot is too large (max 5 MB).' });

  const S = db.get();
  S.shareSubmissions = S.shareSubmissions || [];
  const mine = S.shareSubmissions.filter((s) => s.userId === req.user.id);
  // Repeats aren't allowed: one active (pending/approved) submission per platform.
  if (mine.some((s) => s.platform === platform && s.status !== 'rejected')) {
    return res.status(409).json({ error: `You already have a ${task.name} submission under review or approved.` });
  }
  // Anti-abuse: reject a screenshot that's already been submitted (by anyone).
  const hash = imageHash(img);
  if (S.shareSubmissions.some((s) => s.imageHash === hash)) {
    return res.status(409).json({ error: 'This screenshot has already been submitted. Please share again and upload a fresh screenshot.' });
  }

  const id = rid(8);
  const imageId = 'shimg_' + id;
  try { await db.putImage(imageId, img); }
  catch (e) { console.error('share image store failed:', e.message); return res.status(500).json({ error: 'Could not save your screenshot. Please try again.' }); }

  const rec = {
    id, userId: req.user.id, username: req.user.username || req.user.name || 'User',
    platform, reward: task.reward, imageId, imageHash: hash,
    status: 'pending', reviewNote: '', reviewedAt: null, reviewedBy: null,
    ip: req.ip || null, createdAt: new Date().toISOString(),
  };
  S.shareSubmissions.unshift(rec);
  audit('share_submitted', { userId: req.user.id, platform, shareId: id });
  db.save();
  await db.flush();
  res.status(201).json({
    ok: true,
    submission: { id, platform, platformName: task.name, status: 'pending', reward: task.reward, createdAt: rec.createdAt },
    message: `Screenshot submitted for review. You'll be credited $${task.reward.toFixed(2)} once an admin approves it.`,
  });
});

// Owner-only image of their own share screenshot (for the status thumbnail).
app.get('/api/share/image/:id', requireAuth, async (req, res) => {
  const rec = (db.get().shareSubmissions || []).find((s) => s.id === req.params.id);
  if (!rec || rec.userId !== req.user.id) return res.status(404).send('Not found');
  await serveShareImage(res, rec.imageId);
});

// ---- Admin: review social-share submissions -------------------------------
app.get('/api/admin/share', requireAdminSession, (req, res) => {
  const all = (db.get().shareSubmissions || [])
    .map((s) => {
      const u = userById(s.userId);
      return {
        id: s.id, userId: s.userId, platform: s.platform,
        platformName: (SHARE_BY_KEY[s.platform] || {}).name || s.platform,
        reward: s.reward, status: s.status, reviewNote: s.reviewNote || '',
        ip: s.ip || null, createdAt: s.createdAt, reviewedAt: s.reviewedAt, reviewedBy: s.reviewedBy || null,
        imageUrl: `/api/admin/share/image/${s.id}`,
        user: u ? { username: u.username, email: u.email } : { username: s.username || 'User', email: null },
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ submissions: all, reward: SHARE_REWARD });
});

app.get('/api/admin/share/image/:id', requireAdminSession, async (req, res) => {
  const rec = (db.get().shareSubmissions || []).find((s) => s.id === req.params.id);
  if (!rec) return res.status(404).send('Not found');
  await serveShareImage(res, rec.imageId);
});

app.post('/api/admin/share/:id/decision', requireAdminSession, async (req, res) => {
  const rec = (db.get().shareSubmissions || []).find((s) => s.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Submission not found.' });
  const decision = String(req.body.decision || '');
  const note = String(req.body.note || '').trim();
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });

  const owner = userById(rec.userId);
  if (owner) ensureUserShape(owner);
  const wasApproved = rec.status === 'approved';
  const S = db.get();
  if (decision === 'approved' && !wasApproved && owner) {
    owner.usd = round2((owner.usd || 0) + rec.reward);                 // credit ONLY on approval
    S.transactions = S.transactions || [];
    S.transactions.unshift({
      id: rid(8), userId: owner.id, type: 'share_reward', platform: rec.platform,
      amountUSD: round2(rec.reward), ref: rec.id, createdAt: new Date().toISOString(),
    });
    if (S.transactions.length > 5000) S.transactions.length = 5000;
    // In-app notification (+ XP), idempotent per submission.
    gamify.award(owner, 'share', `share:${rec.id}`, {
      earnedUSD: round2(rec.reward),
      event: { text: `Share reward approved (+$${round2(rec.reward).toFixed(2)})`, icon: '📣' },
    });
  }
  if (decision !== 'approved' && wasApproved && owner) {
    owner.usd = round2(Math.max(0, (owner.usd || 0) - rec.reward));    // reverse a prior approval
  }
  rec.status = decision;
  rec.reviewNote = note;
  rec.reviewedAt = new Date().toISOString();
  rec.reviewedBy = ADMIN_USERNAME;
  audit('share_' + decision, { admin: ADMIN_USERNAME, userId: rec.userId, platform: rec.platform, shareId: rec.id, amount: decision === 'approved' ? round2(rec.reward) : 0 });
  db.save();
  await db.flush();
  res.json({ ok: true, submission: { id: rec.id, status: rec.status, reviewNote: rec.reviewNote, reviewedAt: rec.reviewedAt } });
});

// =============================================================================
//  EARNINGS  —  breakdown by source
// =============================================================================
app.get('/api/earnings', requireAuth, (req, res) => {
  const u = req.user;
  const subs = mySubmissions(u.id);
  const taskUSD = round2(subs.filter((x) => x.status === 'approved').reduce((a, x) => a + x.reward, 0));
  const surveyUSD = round2((u[SURVEY_DONE] || []).reduce((a, id) => a + ((surveysMod.byId(id) || {}).reward || 0), 0));
  const shareUSD = round2((db.get().shareSubmissions || [])
    .filter((s) => s.userId === u.id && s.status === 'approved').reduce((a, s) => a + (s.reward || 0), 0));
  res.json({
    balanceKES: round2(u.balance), balanceUSD: round2(u.usd),
    sources: [
      { key: 'tasks', label: 'Tasks', usd: taskUSD, kes: 0 },
      { key: 'surveys', label: 'Surveys', usd: surveyUSD, kes: 0 },
      { key: 'share', label: 'Share & Earn', usd: shareUSD, kes: 0 },
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
  const investor = userById(inv.userId);              // XP once, when payment is confirmed
  if (investor) {
    ensureUserShape(investor);
    gamify.award(investor, 'invest', `invest:${inv.id}`, {
      event: { text: `Investment activated: ${inv.planName}`, icon: '📈' },
    });
  }
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

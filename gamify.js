/**
 * gamify.js — server-side gamification engine.
 *
 * Everything users see (XP, level, badges, streak, coins, reputation, verification)
 * lives under `user.game`. All awards are **idempotent**: each activity is recorded
 * once in `user.game.awards[key]`, so re-processing the same event (a re-approval, a
 * replayed webhook, a double click) can never grant a reward twice. XP is only ever
 * changed server-side here — the client cannot set it.
 */

// ---- Levels -----------------------------------------------------------------
// Beginner -> Explorer -> Professional -> Elite -> Legend
const LEVELS = [
  { name: 'Beginner',     min: 0 },
  { name: 'Explorer',     min: 250 },
  { name: 'Professional', min: 900 },
  { name: 'Elite',        min: 2500 },
  { name: 'Legend',       min: 7000 },
];

// XP + coins granted per activity type.
const REWARDS = {
  task:     { xp: 50,  coins: 10, stat: 'tasks' },
  survey:   { xp: 20,  coins: 5,  stat: 'surveys' },
  invest:   { xp: 120, coins: 25, stat: 'investments' },
  withdraw: { xp: 30,  coins: 5,  stat: 'withdrawals' },
  referral: { xp: 80,  coins: 15, stat: 'referrals' },
  login:    { xp: 10,  coins: 2,  stat: null },
  profile:  { xp: 40,  coins: 10, stat: null },
};

// Daily-streak bonus grows with the streak length, capped so it can't run away.
const STREAK = { xpPerDay: 5, coinsPerDay: 1, xpCap: 60, coinsCap: 12 };

// Achievement badges. `check(stats, game)` decides whether it's unlocked.
const BADGES = [
  { id: 'first_task',     name: 'First Task',      icon: '✅', desc: 'Complete your first task',      check: (s) => s.tasks >= 1 },
  { id: 'tasks_10',       name: 'Getting Started', icon: '🔟', desc: 'Complete 10 tasks',             check: (s) => s.tasks >= 10 },
  { id: 'tasks_100',      name: 'Century',         icon: '💯', desc: 'Complete 100 tasks',            check: (s) => s.tasks >= 100 },
  { id: 'first_survey',   name: 'Opinionated',     icon: '🗳️', desc: 'Complete your first survey',    check: (s) => s.surveys >= 1 },
  { id: 'surveys_25',     name: 'Pollster',        icon: '📊', desc: 'Complete 25 surveys',           check: (s) => s.surveys >= 25 },
  { id: 'investor',       name: 'Investor',        icon: '📈', desc: 'Make your first investment',    check: (s) => s.investments >= 1 },
  { id: 'big_investor',   name: 'Portfolio',       icon: '🏦', desc: 'Make 5 investments',            check: (s) => s.investments >= 5 },
  { id: 'first_referral', name: 'Connector',       icon: '🤝', desc: 'Refer your first friend',       check: (s) => s.referrals >= 1 },
  { id: 'referral_master',name: 'Referral Master', icon: '👑', desc: 'Refer 10 friends',              check: (s) => s.referrals >= 10 },
  { id: 'first_withdraw', name: 'Cash Out',        icon: '💸', desc: 'Make your first withdrawal',    check: (s) => s.withdrawals >= 1 },
  { id: 'streak_7',       name: 'On Fire',         icon: '🔥', desc: '7-day login streak',            check: (s) => s.streakBest >= 7 },
  { id: 'streak_30',      name: 'Dedicated',       icon: '⚡', desc: '30-day login streak',           check: (s) => s.streakBest >= 30 },
  { id: 'top_earner',     name: 'Top Earner',      icon: '🏆', desc: 'Earn $50 in total rewards',     check: (s) => s.earnedUSD >= 50 },
  { id: 'level_legend',   name: 'Legend',          icon: '🌟', desc: 'Reach the Legend level',        check: (s, g) => level(g.xp).idx >= 4 },
];

const nowTs = () => Date.now();
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10); // UTC YYYY-MM-DD

// ---- Level maths ------------------------------------------------------------
function level(xp) {
  const x = Math.max(0, Number(xp) || 0);
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) if (x >= LEVELS[i].min) idx = i;
  const cur = LEVELS[idx];
  const next = LEVELS[idx + 1] || null;
  const span = next ? next.min - cur.min : 0;
  const into = x - cur.min;
  const pct = next ? Math.min(100, Math.round((into / span) * 100)) : 100;
  return {
    idx, name: cur.name, min: cur.min,
    next: next ? next.name : null, nextMin: next ? next.min : null,
    into, span, toNext: next ? Math.max(0, next.min - x) : 0, pct,
  };
}

// ---- Shape / backfill -------------------------------------------------------
function ensureGameShape(u) {
  if (!u) return u;
  const g = u.game || (u.game = {});
  if (g.xp == null) g.xp = 0;
  if (g.coins == null) g.coins = 0;
  if (!g.streak) g.streak = { count: 0, best: 0, lastDate: null };
  if (!g.stats) g.stats = {};
  const s = g.stats;
  for (const k of ['tasks', 'surveys', 'investments', 'referrals', 'withdrawals']) if (s[k] == null) s[k] = 0;
  if (s.earnedUSD == null) s.earnedUSD = 0;
  if (s.profileComplete == null) s.profileComplete = false;
  if (!Array.isArray(g.badges)) g.badges = [];
  if (!g.awards) g.awards = {};
  if (!Array.isArray(g.events)) g.events = [];
  if (!Array.isArray(g.xpLog)) g.xpLog = [];
  if (g.verification === undefined) g.verification = null;
  if (g.createdAt == null) g.createdAt = nowTs();
  return u;
}

// ---- Notifications feed -----------------------------------------------------
let _eid = 0;
function pushEvent(u, type, text, icon) {
  ensureGameShape(u);
  u.game.events.unshift({ id: `${nowTs()}_${(_eid = (_eid + 1) % 100000)}`, type, text, icon: icon || '🔔', ts: nowTs(), read: false });
  if (u.game.events.length > 60) u.game.events.length = 60;
}

// ---- Reputation (derived; can't be gamed directly) --------------------------
function reputation(g) {
  const s = g.stats || {};
  const base = (s.tasks || 0) * 3 + (s.surveys || 0) * 1 + (s.investments || 0) * 8
    + (s.referrals || 0) * 5 + (s.withdrawals || 0) * 1 + (s.streakBest || g.streak.best || 0) * 2;
  return Math.round(base);
}

// ---- Verification tier ------------------------------------------------------
function verificationTier(g) {
  const s = g.stats || {};
  const lvl = level(g.xp).idx;
  if (lvl >= 4 || (g.badges || []).length >= 9) return 'diamond';
  if (s.investments >= 1 && s.referrals >= 3) return 'gold';
  if (s.tasks >= 1 && s.profileComplete) return 'blue';
  return null;
}

// ---- Badge evaluation -------------------------------------------------------
function checkBadges(u) {
  ensureGameShape(u);
  const g = u.game;
  const s = { ...g.stats, streakBest: g.streak.best };
  const unlocked = [];
  for (const b of BADGES) {
    if (g.badges.includes(b.id)) continue;
    let ok = false;
    try { ok = !!b.check(s, g); } catch (_) { ok = false; }
    if (ok) {
      g.badges.push(b.id);
      unlocked.push(b);
      pushEvent(u, 'badge', `Badge unlocked: ${b.name}`, b.icon);
    }
  }
  if (unlocked.length) g.verification = verificationTier(g);
  return unlocked;
}

// ---- Core award (idempotent) ------------------------------------------------
// type: one of REWARDS keys. key: unique event id (e.g. "task:SUB123"). Returns a
// summary or null if this key was already awarded.
function award(u, type, key, opts = {}) {
  ensureGameShape(u);
  const g = u.game;
  const def = REWARDS[type];
  if (!def) return null;
  if (key) {
    if (g.awards[key]) return null;          // already granted — anti-duplicate/fraud
    g.awards[key] = nowTs();
  }
  const before = level(g.xp).idx;

  let xp = opts.xp != null ? opts.xp : def.xp;
  let coins = opts.coins != null ? opts.coins : def.coins;

  // Streak bonus stacks onto the daily login award.
  if (opts.streakBonus) { xp += opts.streakBonus.xp; coins += opts.streakBonus.coins; }

  g.xp += xp;
  g.coins += coins;
  if (def.stat) g.stats[def.stat] = (g.stats[def.stat] || 0) + 1;
  if (opts.earnedUSD) g.stats.earnedUSD = Math.round(((g.stats.earnedUSD || 0) + opts.earnedUSD) * 100) / 100;

  g.xpLog.push({ ts: nowTs(), amount: xp });
  if (g.xpLog.length > 400) g.xpLog.splice(0, g.xpLog.length - 400);
  // Prune anything older than ~40 days (leaderboards only need weekly/monthly).
  const cutoff = nowTs() - 40 * 86400000;
  if (g.xpLog.length && g.xpLog[0].ts < cutoff) g.xpLog = g.xpLog.filter((e) => e.ts >= cutoff);

  const after = level(g.xp).idx;
  const leveledUp = after > before;
  if (leveledUp) pushEvent(u, 'levelup', `Level up! You're now ${LEVELS[after].name}`, '🎉');
  if (opts.event) pushEvent(u, type, opts.event.text, opts.event.icon);

  const newBadges = checkBadges(u);
  g.verification = verificationTier(g);

  return { xp, coins, leveledUp, level: LEVELS[after].name, newBadges };
}

// ---- Daily login streak -----------------------------------------------------
function touchStreak(u) {
  ensureGameShape(u);
  const g = u.game;
  const today = dayKey();
  if (g.streak.lastDate === today) return { alreadyToday: true, streak: g.streak.count };

  const y = dayKey(new Date(nowTs() - 86400000));
  g.streak.count = g.streak.lastDate === y ? (g.streak.count + 1) : 1;
  g.streak.lastDate = today;
  if (g.streak.count > g.streak.best) g.streak.best = g.streak.count;
  g.stats.streakBest = g.streak.best;

  const bonusXp = Math.min(STREAK.xpCap, (g.streak.count - 1) * STREAK.xpPerDay);
  const bonusCoins = Math.min(STREAK.coinsCap, (g.streak.count - 1) * STREAK.coinsPerDay);
  const res = award(u, 'login', `login:${today}`, {
    streakBonus: { xp: bonusXp, coins: bonusCoins },
    event: { text: `Daily streak: ${g.streak.count} day${g.streak.count === 1 ? '' : 's'} 🔥`, icon: '🔥' },
  });
  return { alreadyToday: false, streak: g.streak.count, best: g.streak.best, reward: res };
}

// Mark the user's profile as complete (one-time XP).
function markProfileComplete(u) {
  ensureGameShape(u);
  if (u.game.stats.profileComplete) return null;
  u.game.stats.profileComplete = true;
  return award(u, 'profile', 'profile:complete', { event: { text: 'Profile completed', icon: '📝' } });
}

// Sum XP earned within the last `days` days (for leaderboards).
function periodXP(g, days) {
  if (!g || !Array.isArray(g.xpLog)) return 0;
  const since = nowTs() - days * 86400000;
  return g.xpLog.reduce((a, e) => (e.ts >= since ? a + e.amount : a), 0);
}

// ---- Full dashboard summary for one user ------------------------------------
function summary(u) {
  ensureGameShape(u);
  const g = u.game;
  const lv = level(g.xp);
  const earned = new Set(g.badges);
  return {
    xp: g.xp,
    coins: g.coins,
    level: lv,
    reputation: reputation(g),
    verification: g.verification || verificationTier(g),
    streak: { current: g.streak.count, best: g.streak.best, lastDate: g.streak.lastDate },
    stats: {
      tasks: g.stats.tasks || 0, surveys: g.stats.surveys || 0,
      investments: g.stats.investments || 0, referrals: g.stats.referrals || 0,
      withdrawals: g.stats.withdrawals || 0, earnedUSD: g.stats.earnedUSD || 0,
    },
    badges: BADGES.map((b) => ({ id: b.id, name: b.name, icon: b.icon, desc: b.desc, earned: earned.has(b.id) })),
    badgesEarned: g.badges.length,
    badgesTotal: BADGES.length,
    weeklyXP: periodXP(g, 7),
    monthlyXP: periodXP(g, 30),
  };
}

module.exports = {
  LEVELS, REWARDS, BADGES,
  ensureGameShape, level, award, touchStreak, checkBadges,
  markProfileComplete, reputation, verificationTier, periodXP, summary, pushEvent,
};

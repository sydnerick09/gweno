/* Gweno members-area single-page app. Depends on /js/auth.js (api, etc.). */

let ME = null;
let FX = 129; // KES per USD; overwritten from /api/me
let PAGE_POLL = null; // stop() for the current page's smart poller (see data.js)

// ---------- theme (light/dark) ----------
const THEME_ICONS = {
  moon: '<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};
const currentTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('theme', t); } catch (_) {} }
function toggleTheme() { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); updateTopbar(); }

// ---------- tiny helpers ----------
const usd = (n) => '$' + (Number(n) || 0).toFixed(2);
const kes = (n) => Math.round(Number(n) || 0).toLocaleString() + ' KES';

// Combine the KES wallet (bonuses/referrals/deposits) and USD wallet (task earnings)
// into a single total, expressed in both currencies using the live FX rate.
function totals() {
  const kesW = Number(ME.balance) || 0, usdW = Number(ME.usd) || 0;
  return { usd: usdW + kesW / FX, kes: kesW + usdW * FX };
}

// Fire onLong after a ~500ms press-and-hold (mouse or touch).
function attachLongPress(el, onLong) {
  let timer = null;
  const start = () => { timer = setTimeout(() => { timer = null; onLong(); }, 450); };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener('mousedown', start);
  el.addEventListener('touchstart', start, { passive: true });
  ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((ev) => el.addEventListener(ev, cancel));
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');
const view = () => document.getElementById('view');

// Clean line icons (no emojis) used across tiles and cards.
const ICON = {
  tasks: '<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  survey: '<svg viewBox="0 0 24 24"><path d="M9 4h6a2 2 0 0 1 2 2v0H7v0a2 2 0 0 1 2-2z"/><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 11h6M9 15h4"/></svg>',
  gift: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4"/><path d="M12 8v13M5 12v9h14v-9"/><path d="M12 8S9.5 3 7 4.5 9 8 12 8zM12 8s2.5-5 5-3.5S15 8 12 8z"/></svg>',
  submissions: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M12 3v12M8 7l4-4 4 4"/></svg>',
  games: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 12h3M8.5 10.5v3"/><circle cx="16" cy="11" r="1"/><circle cx="18" cy="13.5" r="1"/></svg>',
  clicks: '<svg viewBox="0 0 24 24"><path d="M9 3v10l3-2 2 4 2-1-2-4h4z"/></svg>',
  // Consistent Feather (2017) line icons for the earning shortcuts.
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 12h6M9 16h4"/></svg>',
  userplus: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  ban: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  bank: '<svg viewBox="0 0 24 24"><path d="M3 10l9-6 9 6"/><path d="M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  // ---- Navigation icons (Feather Icons, 2017), monochrome line icons via currentColor ----
  home: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
  money: '<svg viewBox="0 0 24 24"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  invest: '<svg viewBox="0 0 24 24"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>',
  advertise: '<svg viewBox="0 0 24 24"><path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 8.5a4 4 0 0 1 0 7"/></svg>',
  learn: '<svg viewBox="0 0 24 24"><path d="M2 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/></svg>',
  support: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M14.9 9.1l4.2-4.2M4.9 19.1l4.2-4.2"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M3 12h18M3 6h18M3 18h18"/></svg>',
  coins: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>',
  // ---- Extended Feather Icons roster (dashboard / admin set) ----
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  analytics: '<svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  users: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  orders: '<svg viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
  products: '<svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/><path d="M12 22.08V12"/></svg>',
  messages: '<svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M22 6l-10 7L2 6"/></svg>',
  notifications: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  files: '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  reports: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/></svg>',
  logout: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>',
  billing: '<svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><path d="M1 10h22"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><path d="M1 10h22"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><path d="M20 12V8H6a2 2 0 0 1-2-2 2 2 0 0 1 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0-2 2 2 2 0 0 0 2 2h4v-4z"/></svg>',
  database: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
  server: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><path d="M6 6h.01M6 18h.01"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  api: '<svg viewBox="0 0 24 24"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>',
};

// Brand logos for the payment-method picker (approximate, self-contained SVGs/wordmarks).
const LOGO = {
  mpesa: '<span class="pl pl-mpesa">M-PESA</span>',
  card: '<svg class="pl-card" viewBox="0 0 40 26"><rect x="1" y="1" width="38" height="24" rx="4" fill="#1a1f71"/><rect x="1" y="6" width="38" height="4" fill="#12143f"/><circle cx="23" cy="17" r="5.5" fill="#eb001b"/><circle cx="29" cy="17" r="5.5" fill="#f79e1b" opacity=".9"/></svg>',
  paypal: '<span class="pl pl-paypal"><span style="color:#003087">Pay</span><span style="color:#009cde">Pal</span></span>',
  bank: '<svg class="pl-ic" viewBox="0 0 24 24"><path d="M3 10l9-6 9 6"/><path d="M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18"/></svg>',
  applepay: '<span class="pl pl-apple"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M16.4 12.7c0-2 1.6-2.9 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.2 2-1.4 2.4-.4 6 1 8 .6 1 1.4 2 2.4 2 .9 0 1.3-.6 2.4-.6 1.1 0 1.4.6 2.4.6 1 0 1.6-.9 2.2-1.9.7-1 1-2 1-2.1-.1 0-2-.8-2-2.9zM14.7 6.3c.5-.6.9-1.5.8-2.3-.8 0-1.7.5-2.2 1.1-.5.5-.9 1.4-.8 2.2.9.1 1.8-.4 2.2-1z"/></svg> Pay</span>',
  stripe: '<span class="pl pl-stripe">stripe</span>',
  paystack: '<span class="pl pl-paystack"><svg viewBox="0 0 24 24" width="15" height="15"><g fill="#00c3f7"><rect x="3" y="4" width="18" height="3" rx="1.5"/><rect x="3" y="9" width="18" height="3" rx="1.5"/><rect x="3" y="14" width="12" height="3" rx="1.5"/></g></svg>Paystack</span>',
};

// Shared method-picker: renders logo cards and returns a getter for the current selection.
function renderMethodCards(root, methods, onSelect) {
  root.innerHTML = `<div class="pay-methods">${methods.map((m) => `
    <button type="button" class="pay-card ${m.soon ? 'soon' : ''}" data-method="${esc(m.key)}"${m.soon ? ' data-soon="1"' : ''}>
      ${m.soon ? '<span class="soon-badge">Coming soon</span>' : ''}
      <span class="pay-logo">${m.logo}</span>
      <span class="pay-name">${esc(m.key)}</span>
      <span class="pay-desc">${esc(m.desc)}</span>
    </button>`).join('')}</div>`;
  let current = '';
  root.querySelectorAll('.pay-card').forEach((c) => c.addEventListener('click', () => {
    if (c.dataset.soon) { toast(`${c.dataset.method} is coming soon.`); return; }  // not selectable yet
    current = c.dataset.method;
    root.querySelectorAll('.pay-card').forEach((x) => x.classList.toggle('selected', x.dataset.method === current));
    onSelect(current);
  }));
  return () => current;
}

// GETs go through the data layer so concurrent identical requests are deduplicated
// (pattern 1). Falls back to a plain fetch if data.js hasn't loaded.
async function apiGet(path) {
  if (window.Data && Data.get) return Data.get(path);
  const r = await fetch(path);
  let d = {}; try { d = await r.json(); } catch (_) {}
  return { ok: r.ok, status: r.status, data: d };
}

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  // Announce to screen readers: errors are assertive, everything else polite.
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  t.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3200);
}

function avatarHTML(u, cls) {
  if (u && u.avatar) return `<img class="${cls}" src="${esc(u.avatar)}" alt="avatar">`;
  const initials = String((u && (u.username || u.name)) || '?').slice(0, 2).toUpperCase();
  return `<div class="${cls}">${esc(initials)}</div>`;
}

function openModal(html) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
  const onKey = (e) => {
    if (e.key === 'Escape') { bg.remove(); }
    if (!document.body.contains(bg)) document.removeEventListener('keydown', onKey); // self-clean
  };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.classList.contains('close')) bg.remove(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  // Move keyboard focus into the dialog (first field, else the dialog itself).
  const modal = bg.querySelector('.modal');
  (modal.querySelector('input, textarea, select, button:not(.close)') || modal).focus();
  return bg;
}

function copyText(text) {
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
  else toast('Copy: ' + text);
}

// ---------- boot ----------
async function boot() {
  const r = await fetch('/api/me');
  if (!r.ok) { location.href = '/login.html'; return; }
  const { user, fx } = await r.json();
  if (!user.onboarded) { location.href = '/onboarding.html'; return; }
  ME = user;
  if (fx) FX = fx;
  renderShell();
  window.addEventListener('hashchange', router);
  router();
  setTimeout(() => { try { maybeStartTour(); } catch (_) {} }, 900); // first-login guided tour
}

// ===================== FIRST-LOGIN GUIDED TOUR =====================
// Bubbles that point at each part of the app so a new member knows where things are.
// Shows once; if skipped, re-prompts after 5 min, then 24 h, then never (see /api/tour).
// Each step opens the real page it describes (route) and points an arrow at the menu
// item, so a new member sees exactly where each thing is and what that screen looks like.
const TOUR_STEPS = [
  { route: '#/dashboard', title: 'Welcome to Gweno! 👋', body: "Quick tour, I'll open each page for you so you know exactly where everything is. You can skip anytime." },
  { route: '#/dashboard', sel: '#sidebar', title: 'This is your menu', body: 'Everything is in this menu. On a phone, tap the ☰ button at the top-left to open it. Let\'s walk through each page.' },
  { route: '#/dashboard', sel: '#topRight', title: 'Your balance', body: 'Your money shows here in USD and KES. On the Dashboard, press and hold the balance to switch between US Dollars and Kenya Shillings.' },
  { route: '#/tasks', sel: '[data-route="earn"]', title: 'Tasks, earn money', body: 'This is where you do tasks and surveys to earn money into your wallet. Tap "Earn" in the menu to get here.' },
  { route: '#/invest', sel: '[data-route="invest"]', title: 'Investments, grow your money', body: 'This is Investments. Buy into a plan (Starter, Growth or Premium), invest by shares, and earn fixed interest until it matures.' },
  { route: '#/redeem', sel: '[data-route="redeem"]', title: 'Redeem, deposit & withdraw', body: 'This is Redeem. Deposit (top up) your wallet, or withdraw (cash out) to M-Pesa, card, PayPal or bank. There\'s a small minimum to withdraw.' },
  { route: '#/settings', sel: '[data-route="settings"]', title: 'Settings, your name & profile', body: 'This is Settings. Change your name, password, payout details and picture here.' },
  { route: '#/support', sel: '[data-route="support"]', title: 'Support, get help', body: 'This is Support. Read guides and message our team any time you need help.' },
  { route: '#/dashboard', title: "You're all set! 🎉", body: "That's the whole app. Explore Gweno and start earning, everything is reachable from the menu." },
];
let TOUR_I = 0;
let TOUR_TIMER = null;
const tourActive = () => !!document.getElementById('tourOverlay');
const isMobile = () => window.innerWidth <= 900;

function maybeStartTour(force) {
  if (!ME || tourActive()) return;
  const t = ME.tour || { done: false, skips: 0, lastSkipAt: null };
  if (!force) {
    if (t.done) return;
    const skips = t.skips || 0;
    if (skips >= 3) return;
    if (skips >= 1) {
      const since = t.lastSkipAt ? Date.now() - new Date(t.lastSkipAt).getTime() : Infinity;
      const wait = skips === 1 ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
      if (since < wait) { if (wait - since <= 60 * 60 * 1000) scheduleReprompt(wait - since); return; }
    }
  }
  startTour();
}
function scheduleReprompt(ms) {
  if (TOUR_TIMER) clearTimeout(TOUR_TIMER);
  TOUR_TIMER = setTimeout(() => maybeStartTour(), Math.max(1000, ms));
}
function startTour() {
  TOUR_I = 0;
  const sb = document.getElementById('sidebar'); if (sb) sb.classList.add('open'); // reveal nav on mobile
  const ov = document.createElement('div');
  ov.id = 'tourOverlay';
  ov.className = 'tour-overlay';
  ov.innerHTML = `<div class="tour-spot" id="tourSpot"></div><div class="tour-bubble" id="tourBubble"></div>`;
  document.body.appendChild(ov);
  window.addEventListener('resize', renderTourStep);
  renderTourStep();
}
function renderTourStep() {
  const ov = document.getElementById('tourOverlay'); if (!ov) return;
  const step = TOUR_STEPS[TOUR_I];
  // Open the actual page this step is about, and keep the menu visible.
  if (step.route && location.hash !== step.route) location.hash = step.route;
  const sb = document.getElementById('sidebar'); if (sb) sb.classList.add('open');
  const spot = document.getElementById('tourSpot');
  const bubble = document.getElementById('tourBubble');
  const target = step.sel ? document.querySelector(step.sel) : null;
  const last = TOUR_I === TOUR_STEPS.length - 1;
  ov.classList.toggle('has-spot', !!target);
  if (target) {
    const r = target.getBoundingClientRect(); const pad = 6;
    spot.style.display = 'block';
    spot.style.top = (r.top - pad) + 'px'; spot.style.left = (r.left - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
  } else { spot.style.display = 'none'; }
  bubble.innerHTML = `
    <div class="tour-count">Step ${TOUR_I + 1} of ${TOUR_STEPS.length}</div>
    <h4>${esc(step.title)}</h4>
    <p>${esc(step.body)}</p>
    <div class="tour-btns">
      <button class="tour-skip" id="tourSkip">Skip</button>
      <div>
        ${TOUR_I > 0 ? '<button class="tour-back" id="tourBack">Back</button>' : ''}
        <button class="btn btn-primary auto" id="tourNext">${last ? 'Finish' : 'Next'}</button>
      </div>
    </div>`;
  positionBubble(bubble, target);
  document.getElementById('tourSkip').onclick = () => endTour('skip');
  document.getElementById('tourNext').onclick = () => { if (last) endTour('done'); else { TOUR_I += 1; renderTourStep(); } };
  const back = document.getElementById('tourBack'); if (back) back.onclick = () => { TOUR_I -= 1; renderTourStep(); };
}
function positionBubble(bubble, target) {
  bubble.style.visibility = 'hidden'; bubble.style.display = 'block';
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  let top, left, side = 'center';
  if (!target) { top = (vh - bh) / 2; left = (vw - bw) / 2; }
  else {
    const r = target.getBoundingClientRect();
    if (r.right + bw + 24 < vw) { left = r.right + 16; top = Math.min(Math.max(12, r.top), vh - bh - 12); side = 'left'; }
    else if (r.bottom + bh + 24 < vh) { top = r.bottom + 14; left = Math.min(Math.max(12, r.left), vw - bw - 12); side = 'up'; }
    else { top = Math.max(12, r.top - bh - 14); left = Math.min(Math.max(12, r.left), vw - bw - 12); side = 'down'; }
  }
  bubble.setAttribute('data-arrow', side); // CSS draws the arrow pointing at the target
  bubble.style.top = Math.max(12, top) + 'px'; bubble.style.left = Math.max(12, left) + 'px';
  bubble.style.visibility = 'visible';
}
async function endTour(action) {
  const ov = document.getElementById('tourOverlay'); if (ov) ov.remove();
  window.removeEventListener('resize', renderTourStep);
  if (isMobile()) { const sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open'); }
  try {
    const { ok, data } = await api('/api/tour', { action });
    if (ok && data.tour) ME.tour = data.tour;
  } catch (_) {}
  if (action === 'skip' && ME.tour && (ME.tour.skips || 0) === 1) scheduleReprompt(5 * 60 * 1000);
}

const NAV = [
  ['dashboard', 'Dashboard', ICON.home],
  ['stats', 'Stats', ICON.chart],
  ['earn', 'Earn', ICON.money],
  ['invest', 'Investments', ICON.invest],
  ['advertise', 'Advertise', ICON.advertise],
  ['learn', 'Learn', ICON.learn],
  ['redeem', 'Redeem', ICON.bank],
  ['settings', 'Settings', ICON.settings],
  ['chat', 'Chat', ICON.chat],
  ['support', 'Support', ICON.support],
];
const TITLES = {
  dashboard: 'Dashboard', stats: 'Stats', earn: 'Earn', tasks: 'Tasks', submissions: 'My submissions',
  referral: 'Refer & earn', invest: 'Investments', advertise: 'Advertise', learn: 'Learn', redeem: 'Redeem',
  settings: 'Settings', chat: 'Chat', support: 'Support', admin: 'Admin review', profile: 'Profile',
};

function renderShell() {
  document.getElementById('app').innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="#/dashboard"><img class="brand-logo" src="/img/logo.png" alt="Gweno" onerror="this.onerror=null;this.src='/img/logo.svg'"></a>
        <nav class="side-nav">
          ${NAV.map(([k, label, ico]) => `<a class="nav-item" data-route="${k}" href="#/${k}"><span class="ni">${ico}</span> ${label}</a>`).join('')}
        </nav>
        <div class="side-foot">
          <button class="btn btn-ghost" id="signout">Sign out</button>
        </div>
      </aside>
      <div class="content">
        <header class="topbar">
          <div style="display:flex;align-items:center;gap:12px">
            <button class="hamburger" id="ham" aria-label="Menu">${ICON.menu}</button>
            <h1 id="pageTitle">Dashboard</h1>
          </div>
          <div class="top-right" id="topRight"></div>
        </header>
        <main class="view" id="view"></main>
      </div>
    </div>
    <nav class="bottom-nav" id="bottomNav" aria-label="Primary">
      <a class="bn-item" data-route="dashboard" href="#/dashboard"><span class="bn-ico">${ICON.home}</span><span class="bn-lbl">Dashboard</span></a>
      <a class="bn-item" data-route="tasks" href="#/tasks"><span class="bn-ico">${ICON.tasks}</span><span class="bn-lbl">Tasks</span></a>
      <a class="bn-item" data-route="redeem" href="#/redeem"><span class="bn-ico">${ICON.bank}</span><span class="bn-lbl">Redeem</span></a>
      <a class="bn-item" data-route="invest" href="#/invest"><span class="bn-ico">${ICON.invest}</span><span class="bn-lbl">Invest</span></a>
      <a class="bn-item" data-route="invest" href="#/invest"><span class="bn-ico">${ICON.coins}</span><span class="bn-lbl">Investments</span></a>
      <a class="bn-item" data-route="stats" href="#/stats"><span class="bn-ico">${ICON.chart}</span><span class="bn-lbl">Stats</span></a>
      <a class="bn-item" data-route="advertise" href="#/advertise"><span class="bn-ico">${ICON.advertise}</span><span class="bn-lbl">Advertise</span></a>
    </nav>`;

  document.getElementById('signout').addEventListener('click', async () => { await api('/api/logout', {}); location.href = '/'; });
  document.getElementById('ham').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('sidebar').classList.toggle('open'); });
  document.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', () => document.getElementById('sidebar').classList.remove('open')));
  // Tap anywhere outside the open menu (on mobile) to close it.
  document.addEventListener('click', (e) => {
    const sb = document.getElementById('sidebar');
    if (sb && sb.classList.contains('open') && !sb.contains(e.target)) sb.classList.remove('open');
  });
  updateTopbar();
}

function updateTopbar() {
  const t = totals();
  document.getElementById('topRight').innerHTML = `
    <button class="theme-toggle" id="themeBtn" title="Toggle dark mode" aria-label="Toggle dark mode">${currentTheme() === 'dark' ? THEME_ICONS.sun : THEME_ICONS.moon}</button>
    <span class="chip usd">${ICON.money} ${usd(t.usd)}</span>
    <span class="chip kes">${ICON.coins} ${kes(t.kes)}</span>
    <a href="#/profile" class="avatar-link" title="Profile">${avatarHTML(ME, 'avatar-sm')}</a>`;
  const tb = document.getElementById('themeBtn');
  if (tb) tb.addEventListener('click', toggleTheme);
}

async function refreshMe() {
  const r = await fetch('/api/me');
  if (r.ok) { const j = await r.json(); ME = j.user; if (j.fx) FX = j.fx; updateTopbar(); }
}

function setActive(routeKey) {
  // Side nav groups tasks/submissions/referral under "Earn"; the bottom nav highlights the real page.
  const sideKey = ['tasks', 'submissions', 'referral'].includes(routeKey) ? 'earn' : routeKey;
  document.querySelectorAll('.nav-item').forEach((a) => {
    const on = a.dataset.route === sideKey;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('.bottom-nav [data-route]').forEach((a) => {
    const on = a.dataset.route === routeKey;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // Keep the active item visible in the horizontally scrollable bottom bar.
  const bn = document.querySelector('.bottom-nav');
  const active = document.querySelector('.bottom-nav [data-route].active');
  if (bn && active && bn.scrollWidth > bn.clientWidth) {
    bn.scrollTo({ left: active.offsetLeft - bn.clientWidth / 2 + active.clientWidth / 2, behavior: 'smooth' });
  }
}

// ---------- router ----------
function router() {
  // Stop any page-scoped smart poller before leaving the current page.
  if (PAGE_POLL) { try { PAGE_POLL(); } catch (_) {} PAGE_POLL = null; }
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const key = (hash.split('/')[0] || 'dashboard').split('?')[0]; // ignore any ?query (e.g. #/invest?paid=INV…)
  document.getElementById('pageTitle').textContent = TITLES[key] || 'Gweno';
  setActive(key);
  const map = {
    dashboard: pageDashboard, stats: pageStats, earn: pageEarn, tasks: pageTasks,
    submissions: pageSubmissions, referral: pageReferral, invest: pageInvest, advertise: pageAdvertise,
    learn: pageLearn, redeem: pageRedeem, settings: pageSettings, chat: pageChat,
    support: pageSupport, admin: pageAdmin, profile: pageProfile,
  };
  (map[key] || pageDashboard)();
  window.scrollTo(0, 0);
}

// YouTube-style skeleton: structural shimmer placeholders shown instantly so page
// switches feel immediate while the real data loads in.
function skeletonView() {
  const line = (w) => `<div class="sk sk-line" style="width:${w}"></div>`;
  return `
    <div class="sk sk-line" style="width:38%;height:16px;margin-bottom:18px"></div>
    <div class="grid g4">
      <div class="sk sk-stat"></div><div class="sk sk-stat"></div>
      <div class="sk sk-stat"></div><div class="sk sk-stat"></div>
    </div>
    <div class="panel">
      ${line('30%')}${line('55%')}
      <div class="tiles" style="margin-top:14px">
        <div class="sk sk-tile"></div><div class="sk sk-tile"></div><div class="sk sk-tile"></div>
      </div>
    </div>
    <div class="panel">
      ${line('26%')}
      <div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div>
    </div>`;
}
const loading = () => { view().innerHTML = skeletonView(); };

// =====================================================================
//  DASHBOARD
// =====================================================================
async function pageDashboard() {
  // Streaming UI (pattern 3): paint the full structure immediately (with tiny
  // shimmers), then fill each section the moment its own request resolves, no
  // waiting on Promise.all before anything shows.
  const skv = (w) => `<span class="sk sk-line" style="display:inline-block;width:${w};height:22px;vertical-align:middle"></span>`;
  view().innerHTML = `
    <p class="page-sub">Welcome back, <b>${esc(ME.username || ME.name)}</b>. Here's your activity.</p>

    <div class="grid g4">
      <div class="stat brand balance-card" id="balCard" title="Hold to switch currency">
        <div class="label">Total balance <span class="hold-hint">· hold to switch</span></div>
        <div class="value" id="balValue"></div>
        <div class="p-sub" id="balAlt"></div>
      </div>
      <div class="stat"><div class="label">Pending earnings</div><div class="value" id="dPending">${skv('62px')}</div></div>
      <div class="stat"><div class="label">Tasks available</div><div class="value" id="dTasksAvail">${skv('40px')}</div></div>
      <div class="stat"><div class="label">Money available</div><div class="value" id="dMoneyAvail">${skv('62px')}</div></div>
    </div>

    <div class="panel" style="margin-top:18px">
      <h3>Quick start</h3>
      <p class="p-sub">Jump straight into earning.</p>
      <div class="tiles">
        <a class="tile" href="#/tasks"><div class="ico">${ICON.edit}</div><h4>Do tasks</h4><p id="dQsTasks">Loading available tasks…</p><span class="tag">Start earning →</span></a>
        <a class="tile" href="#/earn"><div class="ico">${ICON.clipboard}</div><h4>Take surveys</h4><p>Share your opinion and earn in minutes.</p><span class="tag">View surveys →</span></a>
        <a class="tile" href="#/referral"><div class="ico">${ICON.userplus}</div><h4>Refer & earn</h4><p>Earn 5 KES for every friend who joins.</p><span class="tag">Get your link →</span></a>
      </div>
    </div>

    <div class="panel">
      <h3>Your referral link</h3>
      <p class="p-sub">Single-use, a new one is issued after each successful referral. Your friend must answer the welcome questions before your 5 KES is paid.</p>
      <div class="copybox">
        <input id="refLink" readonly value="" placeholder="Loading your link…" />
        <button class="btn btn-primary auto" id="copyRef">Copy</button>
      </div>
      <p class="p-sub" style="margin-top:12px" id="dRefStats">Referrals: <b>—</b> · Earned: <b>—</b></p>
    </div>

    <div class="panel">
      <h3>Recent task completions</h3>
      <p class="p-sub">A live look at what members are earning.</p>
      <div id="dFeed"><div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div></div>
    </div>`;

  // Balance card, driven by in-memory ME totals; press-and-hold switches currency.
  let showUsd = true;
  const renderBal = () => {
    const bv = document.getElementById('balValue'); if (!bv) return;
    const tot = totals();
    bv.textContent = showUsd ? usd(tot.usd) : kes(tot.kes);
    document.getElementById('balAlt').textContent = '≈ ' + (showUsd ? kes(tot.kes) : usd(tot.usd));
  };
  renderBal();
  attachLongPress(document.getElementById('balCard'), () => { showUsd = !showUsd; renderBal(); toast(showUsd ? 'Showing USD' : 'Showing KES'); });

  // Section renderers (reused by SWR and the smart poller). Each is null-safe in
  // case the user has already navigated away.
  const renderTasks = (t) => {
    if (!t) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('dPending', usd(t.pendingUSD));
    set('dTasksAvail', t.totalAvailable ?? '—');
    set('dMoneyAvail', usd(t.moneyAvailableUSD));
    set('dQsTasks', `${t.totalAvailable ?? 0} tasks worth ${usd(t.moneyAvailableUSD)} available.`);
  };
  const renderRef = (r) => {
    if (!r) return;
    const link = document.getElementById('refLink'); if (link) link.value = r.link || '';
    const stats = document.getElementById('dRefStats'); if (stats) stats.innerHTML = `Referrals: <b>${r.count || 0}</b> · Earned: <b>${kes(r.earningsKES)}</b>`;
    const copy = document.getElementById('copyRef'); if (copy) copy.onclick = () => copyText(r.link);
  };
  const renderFeed = (d) => {
    const el = document.getElementById('dFeed'); if (!el || !d) return;
    const feed = d.items || [];
    el.innerHTML = feed.length ? feed.map((f) => `
      <div class="task-row">
        <div class="t-ico">${esc((f.username || '?').slice(0, 2).toUpperCase())}</div>
        <div class="t-main"><h4>${esc(f.username)}${f.country ? ` · ${esc(f.country)}` : ''}</h4><p>completed “${esc(f.task)}”</p></div>
        <div class="t-reward">+${usd(f.reward)}</div>
      </div>`).join('') : `<p class="p-sub">No completions yet, be the first to finish a task!</p>`;
  };

  // Stale-while-revalidate (pattern 4): on repeat visits the cached values paint
  // instantly, then each section revalidates in the background.
  Data.swr('/api/tasks', (d) => renderTasks(d));
  Data.swr('/api/referral', (d) => renderRef(d));
  Data.swr('/api/public/activity', (d) => renderFeed(d));

  // Smart polling (pattern 5): keep the live sections + balance fresh while the
  // tab is visible; auto-pauses when the tab is hidden, resumes on focus.
  PAGE_POLL = Data.poll(async () => {
    const [tasks, feed] = await Promise.all([Data.get('/api/tasks'), Data.get('/api/public/activity')]);
    if (tasks.ok) { Data.setCache('/api/tasks', tasks.data); renderTasks(tasks.data); }
    if (feed.ok) { Data.setCache('/api/public/activity', feed.data); renderFeed(feed.data); }
    await refreshMe(); renderBal();
  }, 20000);
}

// =====================================================================
//  STATS
// =====================================================================
async function pageStats(from = '', to = '') {
  loading();
  const q = new URLSearchParams(); if (from) q.set('from', from); if (to) q.set('to', to);
  const { data } = await apiGet('/api/stats?' + q.toString());
  const rows = data.rows || [], tot = data.totals || {};
  const max = Math.max(1, ...rows.map((r) => r.completions));

  view().innerHTML = `
    <p class="page-sub">Track your completions, approvals and rewards over time.</p>
    <div class="panel">
      <div class="grid" style="grid-template-columns:repeat(4,auto) 1fr auto;align-items:end;gap:12px">
        <div class="field" style="margin:0"><label>From</label><input type="date" id="from" value="${esc(from)}"></div>
        <div class="field" style="margin:0"><label>To</label><input type="date" id="to" value="${esc(to)}"></div>
        <div class="field" style="margin:0"><label>Group by</label><select id="group"><option>Day</option></select></div>
        <button class="btn btn-primary auto" id="apply">Apply</button>
      </div>
    </div>

    <div class="grid g4">
      <div class="stat"><div class="label">Completions</div><div class="value">${tot.completions || 0}</div></div>
      <div class="stat"><div class="label">Approved</div><div class="value">${tot.approved || 0}</div></div>
      <div class="stat"><div class="label">Pending</div><div class="value">${tot.pending || 0}</div></div>
      <div class="stat brand"><div class="label">Reward earned</div><div class="value">${usd(tot.rewardUSD)}</div></div>
    </div>

    <div class="panel">
      <h3>Completions by day</h3>
      ${rows.length ? `<div class="bars">${rows.map((r) => `<div class="bar" style="height:${(r.completions / max) * 100}%" title="${r.completions} on ${r.date}"><span>${r.date.slice(5)}</span></div>`).join('')}</div>` : `<p class="p-sub">No activity yet in this range. Complete some tasks to see your stats.</p>`}
    </div>

    <div class="panel">
      <h3>Breakdown</h3>
      <table class="table">
        <thead><tr><th>Date</th><th class="num">Completions</th><th class="num">Approved</th><th class="num">Reward</th></tr></thead>
        <tbody>${rows.length ? rows.map((r) => `<tr><td>${r.date}</td><td class="num">${r.completions}</td><td class="num">${r.approved}</td><td class="num">${usd(r.reward)}</td></tr>`).join('') : `<tr><td colspan="4" class="p-sub">No data yet.</td></tr>`}</tbody>
      </table>
    </div>`;

  document.getElementById('apply').addEventListener('click', () =>
    pageStats(document.getElementById('from').value, document.getElementById('to').value));
}

// =====================================================================
//  EARN (hub)
// =====================================================================
async function pageEarn() {
  loading();
  const { data } = await apiGet('/api/earnings');
  const s = data.sources || [];
  view().innerHTML = `
    <p class="page-sub">Every way to earn on Gweno, in one place.</p>
    <div class="tiles">
      <a class="tile" href="#/tasks"><div class="ico">${ICON.edit}</div><h4>Tasks</h4><p>Complete microtasks for cash rewards.</p><span class="tag">Open →</span></a>
      <a class="tile" href="#/earn/surveys" id="surveysTile"><div class="ico">${ICON.clipboard}</div><h4>Surveys</h4><p>Answer surveys and earn in minutes.</p><span class="tag">Open →</span></a>
      <a class="tile" href="#/referral"><div class="ico">${ICON.userplus}</div><h4>Refer & earn</h4><p>5 KES per friend who joins.</p><span class="tag">Open →</span></a>
      <a class="tile" href="#/submissions"><div class="ico">${ICON.submissions}</div><h4>My submissions</h4><p>Track approvals, rejections & disputes.</p><span class="tag">Open →</span></a>
      <div class="tile" style="opacity:.7"><div class="ico">${ICON.games}</div><h4>Games</h4><p>Get paid to play with our partners.</p><span class="tag">Coming soon</span></div>
      <div class="tile" style="opacity:.7"><div class="ico">${ICON.clicks}</div><h4>Paid clicks</h4><p>View partner offers for small rewards.</p><span class="tag">Coming soon</span></div>
    </div>

    <div class="panel" style="margin-top:18px">
      <h3>Earnings by source</h3>
      <table class="table">
        <thead><tr><th>Source</th><th class="num">USD</th><th class="num">KES</th><th>Note</th></tr></thead>
        <tbody>${s.map((x) => {
          const kesVal = Number(x.kes) || 0;
          // Show the true value in USD too, any KES earnings convert live at the current rate.
          const usdVal = (Number(x.usd) || 0) + kesVal / FX;
          const note = kesVal ? `${x.note ? esc(x.note) + ' · ' : ''}${kes(kesVal)} ≈ ${usd(kesVal / FX)}` : esc(x.note || '');
          return `<tr><td>${esc(x.label)}</td><td class="num">${usd(usdVal)}</td><td class="num">${kesVal ? kes(kesVal) : '—'}</td><td class="p-sub">${note}</td></tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  document.getElementById('surveysTile').addEventListener('click', (e) => { e.preventDefault(); pageSurveys(); });
}

async function pageSurveys() {
  document.getElementById('pageTitle').textContent = 'Surveys';
  loading();
  const { data } = await apiGet('/api/surveys');
  const list = data.surveys || [];
  view().innerHTML = `
    <p class="page-sub"><a href="#/earn">← Back to Earn</a></p>
    <div class="panel">
      <h3>Available surveys</h3>
      <p class="p-sub">Each survey pays once. Answer honestly to keep earning.</p>
      ${list.map((s) => `
        <div class="task-row">
          <div class="t-ico">${ICON.survey}</div>
          <div class="t-main"><h4>${esc(s.title)}</h4><p>${s.questions.length} questions · ~${s.minutes} min</p></div>
          <div class="t-reward">${usd(s.reward)}</div>
          ${s.done ? `<span class="st approved">Completed</span>` : `<button class="btn btn-primary auto start-survey" data-id="${s.id}">Start</button>`}
        </div>`).join('')}
    </div>`;
  view().querySelectorAll('.start-survey').forEach((b) => b.addEventListener('click', () => openSurvey(list.find((x) => x.id === b.dataset.id))));
}

function openSurvey(s) {
  const bg = openModal(`
    <button class="close">×</button>
    <h3>${esc(s.title)}</h3>
    <p class="p-sub">Reward: ${usd(s.reward)} · answer all questions.</p>
    <form id="svForm">
      ${s.questions.map((qq, i) => `
        <div class="field"><label>${i + 1}. ${esc(qq.q)}</label>
          <select data-q="${i}" required>
            <option value="">Select…</option>
            ${qq.options.map((o) => `<option>${esc(o)}</option>`).join('')}
          </select></div>`).join('')}
      <button class="btn btn-primary" type="submit">Submit survey</button>
    </form>`);
  bg.querySelector('#svForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const answers = {};
    bg.querySelectorAll('select[data-q]').forEach((sel) => { if (sel.value) answers[sel.dataset.q] = sel.value; });
    if (Object.keys(answers).length < s.questions.length) return toast('Please answer all questions', 'error');
    const { ok, data } = await api('/api/surveys/' + s.id + '/complete', { answers });
    if (ok) { toast(data.message); bg.remove(); await refreshMe(); pageSurveys(); }
    else toast(data.error || 'Could not submit', 'error');
  });
}

// =====================================================================
//  TASKS
// =====================================================================
let TASK_STATE = { search: '', tier: 'all' };
async function pageTasks() {
  loading();
  // Returning from a Premium card payment? (Premium is granted server-side only after payment verifies.)
  const pq = new URLSearchParams(location.hash.split('?')[1] || '');
  if (pq.get('premium')) { toast('Payment confirmed, Premium is now active!'); await refreshMe(); }
  else if (pq.get('premfail')) toast('Payment was not completed. Premium stays locked until it is confirmed.', 'error');
  if (pq.get('premium') || pq.get('premfail')) history.replaceState(null, '', `${location.pathname}${location.search}#/tasks`);

  const { data } = await apiGet('/api/tasks');
  const all = data.tasks || [];
  const sub = data.subscription || {};
  const filtered = all.filter((t) =>
    (TASK_STATE.tier === 'all' || t.tier === TASK_STATE.tier) &&
    (!TASK_STATE.search || t.title.toLowerCase().includes(TASK_STATE.search.toLowerCase())));

  const banner = data.premium ? `
    <div class="panel premium-active">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div><h3 style="margin:0">★ Premium active</h3><p class="p-sub" style="margin:2px 0 0">You can work on all premium tasks, up to $4 each${sub.expires ? ` · renews ${new Date(sub.expires).toLocaleDateString()}` : ''}.</p></div>
        <span class="st approved">Premium</span>
      </div>
    </div>` : `
    <div class="panel upgrade">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px">
        <div>
          <h3 style="margin:0">★ Unlock Premium tasks</h3>
          <p class="p-sub" style="margin:4px 0 0">Earn <b>up to $4</b> per task, ${usd(data.premiumMoneyUSD)} waiting. The 4 free basic tasks stay free.</p>
        </div>
        <div style="text-align:right">
          <div style="font-size:22px;font-weight:800">$${sub.priceUSD} <span class="p-sub" style="font-size:13px">≈ ${kes(sub.priceKES)}/mo</span></div>
          <button class="btn btn-primary auto" id="subBtn" style="margin-top:6px">★ Subscribe</button>
        </div>
      </div>
    </div>`;

  view().innerHTML = `
    <p class="page-sub">Complete a task, submit your proof, and get paid once it's approved. You can do <b>one task per day</b>.</p>
    <div class="grid g4">
      <div class="stat"><div class="label">Tasks available${data.premium ? '' : ' (basic)'}</div><div class="value">${data.totalAvailable}</div></div>
      <div class="stat brand"><div class="label">Money available to earn</div><div class="value">${usd(data.moneyAvailableUSD)}</div></div>
      <div class="stat"><div class="label">Pending earnings</div><div class="value">${usd(data.pendingUSD)}</div></div>
      <div class="stat"><div class="label">Approve rate</div><div class="value">N/A</div></div>
    </div>

    ${banner}

    <div class="tabs" style="margin-top:4px">
      ${[['all', 'All'], ['basic', 'Basic'], ['premium', 'Premium']].map(([k, l]) => `<button class="tab ${TASK_STATE.tier === k ? 'active' : ''}" data-tier="${k}">${l}</button>`).join('')}
      <input id="fSearch" value="${esc(TASK_STATE.search)}" placeholder="Search tasks…" class="tab-search">
    </div>

    <div class="task-cards">
      ${filtered.length ? filtered.map((t) => `
        <div class="task-card ${t.locked ? 'locked' : ''}">
          <div class="tc-top">
            <span class="tc-cat">${esc(t.category)}</span>
            <span class="tier-badge ${t.tier}">${t.tier === 'premium' ? '★ Premium' : 'Basic'}</span>
          </div>
          <h4>${esc(t.title)}</h4>
          <p class="tc-meta">~${t.estMinutes} min · Approve rate: N/A</p>
          <div class="tc-bottom">
            <span class="tc-reward">${usd(t.reward)}</span>
            ${t.locked ? `<button class="btn btn-ghost auto sub-lock"><span class="bico">${ICON.lock}</span> Premium</button>` : `<button class="btn btn-primary auto open-task" data-id="${t.id}">Start</button>`}
          </div>
        </div>`).join('') : `<p class="p-sub">No tasks match your filters.</p>`}
    </div>`;

  const subBtn = document.getElementById('subBtn');
  if (subBtn) subBtn.addEventListener('click', () => openSubscribe(sub));
  view().querySelectorAll('.tab[data-tier]').forEach((b) => b.addEventListener('click', () => { TASK_STATE.tier = b.dataset.tier; pageTasks(); }));
  const fs = document.getElementById('fSearch');
  if (fs) fs.addEventListener('input', (e) => { TASK_STATE.search = e.target.value; clearTimeout(fs._t); fs._t = setTimeout(pageTasks, 250); });
  view().querySelectorAll('.open-task').forEach((b) => b.addEventListener('click', () => openTask(all.find((t) => t.id === b.dataset.id))));
  view().querySelectorAll('.sub-lock').forEach((b) => b.addEventListener('click', () => openSubscribe(sub)));
}

const SUBSCRIBE_METHODS = [
  { key: 'M-Pesa', logo: LOGO.mpesa, desc: 'STK push' },
  { key: 'Card', logo: LOGO.card, desc: 'Debit / credit card' },
  { key: 'Paystack', logo: LOGO.paystack, desc: 'Cards & bank' },
];

function openSubscribe(sub) {
  const bg = openModal(`
    <button class="close">×</button>
    <h3>★ Go Premium</h3>
    <p class="p-sub">Unlock all $1–$4 tasks for 30 days. Choose how you'd like to pay, anyone can subscribe.</p>
    <div class="stat brand" style="margin:12px 0"><div class="label">Subscription price</div><div class="value">$${sub.priceUSD} <span class="p-sub" style="font-size:14px">≈ ${kes(sub.priceKES)}</span></div></div>
    <div id="subMethods"></div>
    <form id="subForm" style="margin-top:12px">
      <div id="subFields"><p class="p-sub">Select a payment method above.</p></div>
      <button class="btn btn-primary" type="submit" id="subPay">Pay & activate Premium</button>
    </form>`);

  const subFields = bg.querySelector('#subFields');
  const getSubMethod = renderMethodCards(bg.querySelector('#subMethods'), SUBSCRIBE_METHODS, (m) => {
    if (m === 'M-Pesa') subFields.innerHTML = `<div class="field"><label>M-Pesa phone number</label><input id="subPhone" placeholder="e.g. +254 712 345 678"></div><p class="p-sub">You'll get an STK PIN prompt to pay ${kes(sub.priceKES)}. Premium unlocks once the payment is confirmed.</p>`;
    else subFields.innerHTML = `<p class="p-sub">You'll be taken to a secure ${m === 'Card' ? 'card' : 'Paystack'} page to pay. <b>Premium unlocks only after the payment is confirmed</b>, not before.</p>`;
  });

  bg.querySelector('#subForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const method = getSubMethod();
    if (!method) return toast('Choose a payment method', 'error');
    const btn = bg.querySelector('#subPay'); btn.disabled = true;
    if (method === 'M-Pesa') {
      const { ok, data } = await api('/api/subscribe', { phone: (bg.querySelector('#subPhone') || {}).value || '' });
      if (!ok) { btn.disabled = false; return toast(data.error || 'Could not start subscription', 'error'); }
      toast(data.message);
      let tries = 0;
      const poll = setInterval(async () => {
        tries += 1;
        const s = await apiGet('/api/deposit/' + data.reference + '/status');
        if (s.ok && s.data.status === 'success') { clearInterval(poll); bg.remove(); toast('Premium activated!'); await refreshMe(); pageTasks(); }
        else if ((s.ok && s.data.status === 'failed') || tries >= 20) { clearInterval(poll); btn.disabled = false; if (s.data && s.data.status === 'failed') toast('Payment not completed.', 'error'); }
      }, 3000);
    } else {
      // Card / Paystack: go to the hosted checkout. Premium is granted server-side ONLY after payment verifies.
      const { ok, data } = await api('/api/subscribe/manual', { method });
      if (!ok) { btn.disabled = false; return toast(data.error || 'Could not start Premium payment', 'error'); }
      if (data.mode === 'redirect' && data.url) { toast(data.message || 'Redirecting to pay…'); location.href = data.url; return; }
      btn.disabled = false;
    }
  });
}

// Per-type proof field + a short hint describing exactly what's expected.
function proofFieldFor(t) {
  const cfg = {
    email:  { label: 'Your email address', kind: 'input', type: 'email', ph: 'name@example.com', hint: 'Enter a valid email address.' },
    url:    { label: 'The link', kind: 'input', type: 'url', ph: 'https://…', hint: 'Paste a valid link (starts with http:// or https://).' },
    photo:  { label: 'Direct image link', kind: 'input', type: 'url', ph: 'https://…/photo.jpg', hint: 'Paste a direct link to your uploaded image.' },
    social: { label: 'Profile / post link or @username', kind: 'input', type: 'text', ph: '@yourname or https://…', hint: 'Your @username or a profile/post link.' },
    code:   { label: 'Confirmation code', kind: 'input', type: 'text', ph: 'Enter the exact code', hint: 'Type the exact confirmation code from the steps.' },
    data:   { label: 'Your rows (one per line)', kind: 'textarea', ph: 'One row per line, e.g. Jane Doe, +254712345678, jane@example.com', hint: `At least ${t.minLines || 3} rows, one per line, in the format shown.` },
    match:  { label: 'Paste your typed text', kind: 'textarea', ph: 'Type the passage exactly as shown above', hint: 'Must closely match the passage above.' },
    text:   { label: 'Your answer', kind: 'textarea', ph: 'Paste your completed work here', hint: `At least ${t.minWords || 8} words of your own writing.` },
  }[t.proofType] || {};
  const label = cfg.label || 'Proof of completion';
  const field = cfg.kind === 'input'
    ? `<input id="proof" type="${cfg.type || 'text'}" placeholder="${esc(cfg.ph || '')}">`
    : `<textarea id="proof" placeholder="${esc(cfg.ph || '')}"></textarea>`;
  return `<div class="field"><label>${esc(label)} <span class="p-sub">(required)</span></label>${field}
    ${cfg.hint ? `<p class="hint">${esc(cfg.hint)}</p>` : ''}</div>`;
}

// Client-side mirror of the server's validateProof(), instant feedback before submit.
function validateProofClient(t, raw) {
  const proof = String(raw == null ? '' : raw).trim();
  if (!proof) return 'Please enter your proof of completion.';
  const isUrl = (s) => { try { const u = new URL(s.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (_) { return false; } };
  const junk = (s) => {
    const x = s.trim();
    if ((x.match(/[a-zA-Z]/g) || []).length < 3) return true;
    if (/^(.)\1*$/.test(x.replace(/\s/g, ''))) return true;
    return new Set(x.replace(/\s/g, '').toLowerCase()).size < 4;
  };
  switch (t.proofType) {
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(proof) ? '' : 'Enter a valid email address, e.g. name@example.com.';
    case 'url': return isUrl(proof) ? '' : 'Enter a valid link that starts with http:// or https://.';
    case 'photo':
      if (!isUrl(proof)) return 'Paste a valid image link that starts with http:// or https://.';
      return (/\.(png|jpe?g|gif|webp|heic|bmp)(\?|#|$)/i.test(proof) || /(imgur|ibb\.co|imgbb|postimg|drive\.google|photos\.app\.goo|cloudinary|dropbox|githubusercontent)/i.test(proof))
        ? '' : 'That does not look like an uploaded image link. Upload your photo and paste the direct image link.';
    case 'social':
      return (/^@?[a-z0-9_.]{3,30}$/i.test(proof) || isUrl(proof)) ? '' : 'Enter your profile/post link, or your @username.';
    case 'code':
      return (!t.code || proof.toLowerCase() === String(t.code).toLowerCase()) ? '' : 'That confirmation code is not correct. Follow the steps and enter the exact code shown.';
    case 'data': {
      const lines = proof.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const need = t.minLines || 3;
      if (lines.length < need) return `Enter at least ${need} rows, one per line.`;
      return lines.filter((l) => /[,:]/.test(l) && /[a-z0-9]/i.test(l)).length >= need
        ? '' : 'Each row must use the requested format (values separated by a comma or colon).';
    }
    case 'match': {
      if (junk(proof)) return 'Please paste your full typed text.';
      const norm = (s) => s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const a = norm(proof), b = norm(t.expected || '');
      // quick similarity: shared-length ratio via Levenshtein
      const lev = (x, y) => { const m = x.length, n = y.length; if (!m) return n; if (!n) return m; let p = Array.from({ length: n + 1 }, (_, i) => i); for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); p = c; } return p[n]; };
      const sim = (!a || !b) ? 0 : 1 - lev(a, b) / Math.max(a.length, b.length);
      return sim >= (t.minSimilarity || 0.8) ? '' : 'Your text does not closely match the passage. Please type it exactly as shown.';
    }
    default: {
      if (junk(proof)) return 'Please enter a real answer, not random characters.';
      const minW = t.minWords || 8, minC = t.minChars || 30;
      if (proof.split(/\s+/).filter(Boolean).length < minW) return `Please write at least ${minW} words.`;
      if (proof.length < minC) return `Your answer looks too short. Please write at least ${minC} characters.`;
      return '';
    }
  }
}

function openTask(t) {
  const bg = openModal(`
    <button class="close">×</button>
    <h3>${esc(t.title)}</h3>
    <p class="p-sub">${esc(t.category)} · Reward ${usd(t.reward)} · ~${t.estMinutes} min</p>
    <h4 style="margin:16px 0 6px">How to complete this task</h4>
    <ol class="instr">${t.instructions.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <form id="taskForm">
      ${proofFieldFor(t)}
      <p class="p-sub">Submissions are usually reviewed within 5 hours.</p>
      <button class="btn btn-primary" type="submit">Submit for review</button>
    </form>`);
  bg.querySelector('#taskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const proof = bg.querySelector('#proof').value;
    const err = validateProofClient(t, proof);
    if (err) return toast(err, 'error');
    const { ok, data } = await api('/api/tasks/' + t.id + '/submit', { proof });
    if (ok) { toast(data.message); bg.remove(); pageTasks(); }
    else toast(data.error || 'Could not submit', 'error');
  });
}

// =====================================================================
//  SUBMISSIONS
// =====================================================================
async function pageSubmissions() {
  loading();
  const { data } = await apiGet('/api/submissions');
  const subs = data.submissions || [];
  view().innerHTML = `
    <p class="page-sub">A summary of your tasks, approved, rejected or still pending review.</p>
    <div class="panel">
      <p class="pill-note">ℹ Proof must be submitted within 2 days. If a task is rejected, you have 2 days to open a dispute.</p>
      <table class="table" style="margin-top:14px">
        <thead><tr><th>Task</th><th class="num">Reward</th><th>Status</th><th>Submitted</th><th></th></tr></thead>
        <tbody>
          ${subs.length ? subs.map((s) => `
            <tr>
              <td>${esc(s.task ? s.task.title : s.taskId)}</td>
              <td class="num">${usd(s.reward)}</td>
              <td><span class="st ${s.status}">${s.status}</span>${s.dispute ? ' <span class="st pending">dispute open</span>' : ''}</td>
              <td class="p-sub">${new Date(s.createdAt).toLocaleDateString()}</td>
              <td>${s.status === 'rejected' && !s.dispute ? `<button class="btn btn-ghost auto dispute" data-id="${s.id}">Dispute</button>` : ''}</td>
            </tr>`).join('') : `<tr><td colspan="5" class="p-sub">No submissions yet. <a href="#/tasks">Start a task →</a></td></tr>`}
        </tbody>
      </table>
    </div>`;
  view().querySelectorAll('.dispute').forEach((b) => b.addEventListener('click', () => openDispute(b.dataset.id)));
}

function openDispute(id) {
  const bg = openModal(`
    <button class="close">×</button>
    <h3>Open a dispute</h3>
    <p class="p-sub">Tell us why you believe this rejection was a mistake. Our team will review it.</p>
    <form id="dForm">
      <div class="field"><label>Your message</label><textarea id="dMsg" placeholder="Explain what you did and why it should be approved…"></textarea></div>
      <button class="btn btn-primary" type="submit">Submit dispute</button>
    </form>`);
  bg.querySelector('#dForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { ok, data } = await api('/api/submissions/' + id + '/dispute', { message: bg.querySelector('#dMsg').value });
    if (ok) { toast(data.message); bg.remove(); pageSubmissions(); }
    else toast(data.error || 'Could not submit dispute', 'error');
  });
}

// =====================================================================
//  REFERRAL
// =====================================================================
async function pageReferral() {
  loading();
  const { data } = await apiGet('/api/referral');
  view().innerHTML = `
    <p class="page-sub">Invite friends and earn <b>${data.perReferralKES} KES</b> for each one who joins.</p>
    <div class="grid g2">
      <div class="panel">
        <h3>Your referral link</h3>
        <p class="p-sub">This link works <b>once</b>. After a friend joins with it, copy a fresh link here to invite the next person.</p>
        <div class="copybox">
          <input id="refLink" readonly value="${esc(data.link)}">
          <button class="btn btn-primary auto" id="copyBtn">Copy</button>
        </div>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn btn-ghost auto" id="regen">Generate new link</button>
        </div>
        <div class="grid g2" style="margin-top:16px">
          <div class="stat"><div class="label">Successful referrals</div><div class="value">${data.count}</div></div>
          <div class="stat brand"><div class="label">Referral earnings</div><div class="value">${kes(data.earningsKES)}</div></div>
        </div>
      </div>

      <div class="panel" style="text-align:center">
        <h3>Your QR code</h3>
        <p class="p-sub">Print it on a flyer or show it in person, it opens your referral link.</p>
        <div class="qr" style="margin:0 auto"><img src="${esc(data.qr)}" alt="Referral QR code"></div>
        <a class="btn btn-ghost auto" style="margin-top:14px;display:inline-flex" href="${esc(data.qr)}" download="gweno-referral-qr.png" target="_blank">Download QR</a>
      </div>
    </div>

    <div class="panel">
      <h3>People you've referred</h3>
      ${data.referred && data.referred.length ? `<table class="table"><thead><tr><th>Username</th><th>Joined</th></tr></thead><tbody>${data.referred.map((r) => `<tr><td>${esc(r.username || '—')}</td><td class="p-sub">${new Date(r.joinedAt).toLocaleDateString()}</td></tr>`).join('')}</tbody></table>` : `<p class="p-sub">No referrals yet. Share your link to get started.</p>`}
    </div>`;
  document.getElementById('copyBtn').addEventListener('click', () => copyText(data.link));
  document.getElementById('regen').addEventListener('click', async () => {
    const { ok } = await api('/api/referral/regenerate', {});
    if (ok) { toast('New referral link generated'); pageReferral(); }
  });
}

// =====================================================================
//  INVESTMENTS
// =====================================================================
// Interest matches the server (investments.js): simple, pro-rated over a 365-day
// year, principal * rate% * days/365. Investments are funded from the KES wallet;
// principal + interest is credited back to the wallet automatically at maturity.
const calcInterest = (principal, rate, days) =>
  Math.round((Number(principal) || 0) * ((Number(rate) || 0) / 100) * ((Number(days) || 0) / 365) * 100) / 100;

let INVEST_PLAN = null; // plan id selected in the Invest form

async function pageInvest() {
  loading();
  const { ok, data } = await apiGet('/api/investments');
  if (!ok) { view().innerHTML = `<p class="page-sub">Couldn't load your investments. Please try again.</p>`; return; }

  const plans = data.plans || [];
  const sum = data.summary || {};
  const invs = data.investments || [];
  const active = invs.filter((i) => i.status === 'active');
  const completed = invs.filter((i) => i.status === 'completed');
  const pending = invs.filter((i) => i.status === 'pending');
  const methodInfo = data.methodInfo || [];
  const methodReady = (k) => { const m = methodInfo.find((x) => x.key === k); return !m || m.configured; };

  // Local currency shown beside every USD figure, from the sign-up country.
  const local = data.local || { code: 'USD', perUSD: 1, symbol: '$' };
  const hasLocal = !!local.code && local.code !== 'USD';
  const loc = (u) => `${local.symbol} ${Math.round((Number(u) || 0) * local.perUSD).toLocaleString()}`;
  const both = (u) => `${usd(u)}${hasLocal ? ` <span class="loc">≈ ${loc(u)}</span>` : ''}`;
  const bothT = (u) => `${usd(u)}${hasLocal ? `  ≈ ${loc(u)}` : ''}`;
  const maxLabel = (p) => (p.max == null ? 'Unlimited' : both(p.max));
  if (INVEST_PLAN && !plans.some((p) => p.id === INVEST_PLAN)) INVEST_PLAN = null;

  // Coming back from a hosted-checkout redirect (?paid / ?payfail in the hash).
  const rq = new URLSearchParams(location.hash.split('?')[1] || '');
  if (rq.get('paid')) toast('Payment confirmed, your investment is now active!');
  else if (rq.get('payfail')) toast('Payment was not completed. You can try again.', 'error');
  if (rq.get('paid') || rq.get('payfail')) history.replaceState(null, '', `${location.pathname}${location.search}#/invest`);

  view().innerHTML = `
    <p class="page-sub">Grow your money in USD${hasLocal ? `, amounts also shown in ${esc(local.code)}` : ''}. Pick a plan, pay with your preferred method, and earn fixed interest, paid to your USD wallet automatically at maturity.</p>

    <div class="grid g4">
      <div class="stat brand"><div class="label">Total invested (active)</div><div class="value">${usd(sum.totalInvested)}</div></div>
      <div class="stat"><div class="label">Current earnings</div><div class="value">${usd(sum.currentEarnings)}</div></div>
      <div class="stat"><div class="label">Available to withdraw</div><div class="value">${usd(sum.availableForWithdrawal)}</div></div>
      <div class="stat"><div class="label">Active · Completed</div><div class="value">${sum.activeCount || 0} · ${sum.completedCount || 0}</div></div>
    </div>

    <div class="panel">
      <h3>Current investments</h3>
      <p class="p-sub">Live progress on everything that's still locked. Tap one for full details.</p>
      ${active.length ? `<div class="grid g2 inv-grid">${active.map((i) => `
        <div class="panel inv-card" data-id="${esc(i.id)}" style="margin:0;cursor:pointer">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:10px">
            <div><b>${esc(i.planName)}</b><div class="p-sub">#${esc(i.id)} · ${i.interestRate}% p.a.</div></div>
            <span class="st approved">Active</span>
          </div>
          <div class="grid g2" style="margin:12px 0 6px">
            <div><div class="p-sub">Principal</div><b>${usd(i.principal)}</b></div>
            <div><div class="p-sub">Earned so far</div><b>${usd(i.currentEarnings)}</b></div>
            <div><div class="p-sub">Started</div>${fmtDate(i.startDate)}</div>
            <div><div class="p-sub">Matures</div>${fmtDate(i.maturityDate)}</div>
          </div>
          <div class="ivp" title="${i.progress}%"><i style="width:${i.progress}%"></i></div>
          <div class="p-sub" style="margin-top:6px">${i.progress}% · ${i.daysRemaining} day(s) remaining</div>
        </div>`).join('')}</div>` : `<p class="p-sub">No active investments yet. Start one below.</p>`}
      ${pending.length ? `<p class="p-sub" style="margin-top:12px">⏳ ${pending.length} investment(s) awaiting payment: ${pending.map((i) => `${esc(i.id)} (${esc(i.paymentMethod)})`).join(', ')}. Finish the payment to activate them.</p>` : ''}
    </div>

    <div class="panel">
      <h3>Invest now</h3>
      <p class="p-sub">1. Choose a plan &nbsp;·&nbsp; 2. Enter an amount in USD &nbsp;·&nbsp; 3. Pick how you'll pay.</p>
      <div class="pay-methods inv-plans">
        ${plans.map((p) => `
          <button type="button" class="pay-card inv-plan ${p.id === INVEST_PLAN ? 'selected' : ''}" data-plan="${esc(p.id)}">
            <div class="pay-name">${esc(p.name)}</div>
            <div class="pay-desc">${p.rate}% p.a. · ${p.days} days</div>
            <div class="pay-desc">$${p.min} – ${p.max == null ? '∞' : '$' + p.max}</div>
            ${hasLocal ? `<div class="pay-desc loc">≈ ${loc(p.min)} – ${p.max == null ? '∞' : loc(p.max)}</div>` : ''}
          </button>`).join('')}
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div class="field"><label>Amount (USD)</label><input id="invAmt" type="number" min="0" step="1" placeholder="Select a plan first"></div>
        <div class="field"><label>Lock period</label><input id="invLock" value="—" readonly></div>
      </div>
      <p class="p-sub" id="invHint">Choose a plan to see its limits and expected return.</p>
      <div class="grid g3 inv-return" id="invReturn" style="display:none">
        <div class="stat"><div class="label">Principal</div><div class="value" id="invPrin">—</div></div>
        <div class="stat"><div class="label">Interest</div><div class="value" id="invInt">—</div></div>
        <div class="stat brand"><div class="label">Total at maturity</div><div class="value" id="invTot">—</div></div>
      </div>
      <label style="display:block;font-size:13px;color:var(--muted);margin:16px 0 8px">Payment method</label>
      <div id="invMethods"></div>
      <div class="field" id="invPhoneField" style="display:none;margin-top:12px"><label>M-Pesa phone number</label><input id="invPhone" placeholder="e.g. 0712345678"></div>
      <button class="btn btn-primary" id="invConfirm" disabled style="margin-top:14px">Confirm &amp; pay</button>
    </div>

    <div class="panel">
      <h3>Investment plans</h3>
      <div class="grid g3">
        ${plans.map((p) => `
          <div class="panel plan-card" style="margin:0">
            <h4 style="margin:0 0 2px">${esc(p.name)}</h4>
            <p class="p-sub" style="margin-top:0">${esc(p.blurb || '')}</p>
            <div class="grid g2" style="margin:8px 0">
              <div><div class="p-sub">Minimum</div><b>${both(p.min)}</b></div>
              <div><div class="p-sub">Maximum</div><b>${maxLabel(p)}</b></div>
              <div><div class="p-sub">Interest</div><b>${p.rate}% p.a.</b></div>
              <div><div class="p-sub">Lock period</div><b>${p.days} days</b></div>
            </div>
            <button class="btn btn-ghost auto plan-pick" data-plan="${esc(p.id)}">Invest in ${esc(p.name)}</button>
          </div>`).join('')}
      </div>
    </div>

    <div class="panel">
      <h3>Investment calculator</h3>
      <p class="p-sub">Estimate returns for any country, amount, rate and term. Results update as you type, in the currency of the country you choose.</p>
      <div class="grid g2">
        <div class="field"><label>Country</label><select id="calcCountry"></select></div>
        <div class="field"><label>Amount (<span id="calcCur">select a country</span>)</label><input id="calcAmt" type="number" min="0" step="1" value="1000"></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Interest rate (% p.a.)</label><input id="calcRate" type="number" min="0" step="0.1" value="15"></div>
        <div class="field"><label>Duration (days)</label><input id="calcDays" type="number" min="1" step="1" value="180"></div>
      </div>
      <div class="grid g2" style="margin-top:6px">
        <div class="stat"><div class="label">Interest earned</div><div class="value" id="calcInt">—</div></div>
        <div class="stat brand"><div class="label">Total return</div><div class="value" id="calcTot">—</div></div>
      </div>
    </div>

    <div class="panel">
      <h3>Investment history</h3>
      <p class="p-sub">Matured investments credited back to your USD wallet.</p>
      <table class="table">
        <thead><tr><th>ID</th><th>Plan</th><th class="num">Principal</th><th class="num">Profit</th><th class="num">Paid out</th><th>Completed</th></tr></thead>
        <tbody>${completed.length ? completed.map((i) => `<tr>
          <td>${esc(i.id)}</td><td>${esc(i.planName)}</td>
          <td class="num">${usd(i.principal)}</td><td class="num">${usd(i.expectedInterest)}</td>
          <td class="num">${usd(i.expectedReturn)}</td>
          <td><span class="st approved">Completed</span> <span class="p-sub">${fmtDate(i.completedAt || i.maturityDate)}</span></td>
        </tr>`).join('') : `<tr><td colspan="6" class="p-sub">No completed investments yet.</td></tr>`}</tbody>
      </table>
    </div>`;

  // ---- Invest form ----
  const amtEl = document.getElementById('invAmt');
  const lockEl = document.getElementById('invLock');
  const hintEl = document.getElementById('invHint');
  const retEl = document.getElementById('invReturn');
  const confirmEl = document.getElementById('invConfirm');
  const planOf = (id) => plans.find((p) => p.id === id) || null;

  function selectPlan(id) {
    INVEST_PLAN = id;
    document.querySelectorAll('.inv-plan').forEach((b) => b.classList.toggle('selected', b.dataset.plan === id));
    const p = planOf(id);
    lockEl.value = p ? `${p.days} days` : '—';
    if (p) { amtEl.min = p.min; amtEl.placeholder = `${p.min.toLocaleString()} – ${p.max == null ? 'no limit' : p.max.toLocaleString()}`; }
    recompute();
  }

  // Payment-method cards for funding the investment (USD). Methods whose keys
  // aren't in .env are still shown, tagged "setup needed", so it's clear what's live.
  const phoneField = document.getElementById('invPhoneField');
  const methodCards = INVEST_METHOD_CARDS.map((m) => ({ ...m, desc: m.desc + (methodReady(m.key) ? '' : ' · setup needed') }));
  const getInvMethod = renderMethodCards(document.getElementById('invMethods'), methodCards, (m) => {
    phoneField.style.display = (m === 'M-Pesa') ? '' : 'none';
    recompute();
  });

  function recompute() {
    const p = planOf(INVEST_PLAN);
    const amt = Number(amtEl.value);
    if (!p) { hintEl.textContent = 'Choose a plan to see its limits and expected return.'; retEl.style.display = 'none'; confirmEl.disabled = true; return; }
    let err = '';
    if (!(amt > 0)) err = `Enter an amount to invest in the ${p.name}.`;
    else if (amt < p.min) err = `The ${p.name} minimum is ${bothT(p.min)}.`;
    else if (p.max != null && amt > p.max) err = `The ${p.name} maximum is ${bothT(p.max)}.`;
    if (err) { hintEl.innerHTML = esc(err); retEl.style.display = 'none'; confirmEl.disabled = true; return; }
    const interest = calcInterest(amt, p.rate, p.days);
    document.getElementById('invPrin').textContent = bothT(amt);
    document.getElementById('invInt').textContent = bothT(interest);
    document.getElementById('invTot').textContent = bothT(amt + interest);
    const method = getInvMethod();
    hintEl.textContent = !method
      ? 'Choose a payment method to continue.'
      : (methodReady(method)
          ? `Pay ${bothT(amt)} via ${method} to lock in ${p.days} days at ${p.rate}% p.a.`
          : `${method} isn't set up yet, add its keys to .env, or pick another method.`);
    retEl.style.display = '';
    confirmEl.disabled = !method;
  }

  document.querySelectorAll('.inv-plan').forEach((b) => b.addEventListener('click', () => selectPlan(b.dataset.plan)));
  amtEl.addEventListener('input', recompute);
  if (INVEST_PLAN) selectPlan(INVEST_PLAN); else recompute();

  confirmEl.addEventListener('click', async () => {
    const p = planOf(INVEST_PLAN);
    if (!p) return toast('Choose a plan first', 'error');
    const method = getInvMethod();
    if (!method) return toast('Choose a payment method', 'error');
    const body = { planId: p.id, amount: Number(amtEl.value), method };
    if (method === 'M-Pesa') {
      const phone = document.getElementById('invPhone').value.trim();
      if (!phone) return toast('Enter your M-Pesa phone number', 'error');
      body.phone = phone;
    }
    confirmEl.disabled = true;
    const { ok: sent, data: d } = await api('/api/investments', body);
    if (!sent) { confirmEl.disabled = false; return toast(d.error || 'Could not start payment', 'error'); }

    // Card / PayPal / Paystack: go to the provider's hosted checkout.
    if (d.mode === 'redirect' && d.url) { toast(d.message || 'Redirecting to pay…'); location.href = d.url; return; }

    // M-Pesa: STK prompt on the phone, poll until it's paid.
    if (d.mode === 'stk') {
      toast(d.message || 'Check your phone for the M-Pesa prompt, then enter your PIN.');
      let tries = 0;
      const poll = setInterval(async () => {
        tries += 1;
        const s = await apiGet('/api/investments/' + d.id + '/status');
        if (s.ok && s.data.status === 'active') { clearInterval(poll); toast('Payment received, your investment is active!'); INVEST_PLAN = null; await refreshMe(); pageInvest(); }
        else if ((s.ok && s.data.status === 'failed') || tries >= 20) { clearInterval(poll); if (s.data && s.data.status === 'failed') toast('Payment was not completed.', 'error'); confirmEl.disabled = false; }
      }, 3000);
      return;
    }
    toast(d.message || 'Investment created'); INVEST_PLAN = null; await refreshMe(); pageInvest();
  });

  // Plan-showcase buttons jump to the form with that plan chosen.
  document.querySelectorAll('.plan-pick').forEach((b) => b.addEventListener('click', () => {
    selectPlan(b.dataset.plan);
    amtEl.focus();
    amtEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));

  // ---- Live calculator (choose any country; results in that country's currency) ----
  const cCountry = document.getElementById('calcCountry');
  const cCur = document.getElementById('calcCur');
  const cAmt = document.getElementById('calcAmt'), cRate = document.getElementById('calcRate'), cDays = document.getElementById('calcDays');
  if (window.populateCountries) populateCountries(cCountry, ''); // no default, the user picks a country
  function runCalc() {
    const currency = (window.currencyForCountry && cCountry.value) ? currencyForCountry(cCountry.value) : null;
    cCur.textContent = currency ? currency.code : 'select a country';
    const intEl = document.getElementById('calcInt'), totEl = document.getElementById('calcTot');
    if (!currency) { intEl.textContent = '—'; totEl.textContent = '—'; return; }
    const interest = calcInterest(cAmt.value, cRate.value, cDays.value);
    intEl.textContent = formatCurrency(interest, currency);
    totEl.textContent = formatCurrency((Number(cAmt.value) || 0) + interest, currency);
  }
  cCountry.addEventListener('change', runCalc);
  [cAmt, cRate, cDays].forEach((el) => el.addEventListener('input', runCalc));
  runCalc();

  // ---- Details modal ----
  document.querySelectorAll('.inv-card').forEach((card) => card.addEventListener('click', () => {
    const i = active.find((x) => x.id === card.dataset.id);
    if (!i) return;
    openModal(`
      <button class="close">&times;</button>
      <h3>Investment ${esc(i.id)}</h3>
      <p class="p-sub">${esc(i.planName)} · paid via ${esc(i.paymentMethod || 'card')}</p>
      <div class="grid g2" style="margin-top:8px">
        <div class="stat"><div class="label">Principal</div><div class="value">${usd(i.principal)}</div></div>
        <div class="stat brand"><div class="label">Current earnings</div><div class="value">${usd(i.currentEarnings)}</div></div>
        <div class="stat"><div class="label">Interest rate</div><div class="value">${i.interestRate}% p.a.</div></div>
        <div class="stat"><div class="label">Expected total</div><div class="value">${usd(i.expectedReturn)}</div></div>
      </div>
      <div class="ivp" style="margin-top:14px"><i style="width:${i.progress}%"></i></div>
      <p class="p-sub" style="margin-top:6px">Started ${fmtDate(i.startDate)} · Matures ${fmtDate(i.maturityDate)}</p>
      <p style="margin:4px 0 0"><b>${i.daysRemaining} day(s) remaining</b> · ${i.progress}% complete</p>`);
  }));
}

// =====================================================================
//  ADVERTISE
// =====================================================================
async function pageAdvertise() {
  loading();
  const { data } = await apiGet('/api/campaigns');
  const camps = data.campaigns || [];
  view().innerHTML = `
    <p class="page-sub">Promote your task, offer or link to the Gweno community.</p>
    <div class="grid g2">
      <div class="panel">
        <h3>Create a campaign</h3>
        <form id="cForm">
          <div class="field"><label>Campaign title</label><input id="cTitle" placeholder="e.g. Install my app"></div>
          <div class="field"><label>Destination URL</label><input id="cUrl" placeholder="https://…"></div>
          <div class="field"><label>Type</label><select id="cType"><option>Clicks</option><option>App installs</option><option>Sign-ups</option><option>Survey</option></select></div>
          <div class="field"><label>Budget (USD)</label><input id="cBudget" type="number" min="1" step="1" placeholder="50"></div>
          <button class="btn btn-primary" type="submit">Create campaign</button>
        </form>
      </div>
      <div class="panel">
        <h3>How it works</h3>
        <p class="p-sub">Four simple steps from creating a campaign to paying for results.</p>
        <div class="check"><div class="box">1</div><span><b>Create &amp; set a budget</b>, add your title, link and how much you want to spend.</span></div>
        <div class="check"><div class="box">2</div><span><b>We review your campaign</b>, our team checks it before it goes live to members.</span></div>
        <div class="check"><div class="box">3</div><span><b>Members complete it</b>, Gweno members do your task and submit their proof.</span></div>
        <div class="check"><div class="box">4</div><span><b>You approve results &amp; pay</b>, approve the good submissions; only pay for what you accept.</span></div>
      </div>
    </div>

    <div class="panel">
      <h3>Your campaigns</h3>
      <table class="table">
        <thead><tr><th>Title</th><th>Type</th><th class="num">Budget</th><th class="num">Spent</th><th>Status</th></tr></thead>
        <tbody>${camps.length ? camps.map((c) => `<tr><td>${esc(c.title)}</td><td>${esc(c.type)}</td><td class="num">${usd(c.budget)}</td><td class="num">${usd(c.spent)}</td><td><span class="st pending">${esc(c.status)}</span></td></tr>`).join('') : `<tr><td colspan="5" class="p-sub">No campaigns yet.</td></tr>`}</tbody>
      </table>
    </div>`;
  document.getElementById('cForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { ok, data: d } = await api('/api/campaigns', {
      title: document.getElementById('cTitle').value,
      url: document.getElementById('cUrl').value,
      type: document.getElementById('cType').value,
      budget: document.getElementById('cBudget').value,
    });
    if (ok) { toast('Campaign created and sent for review'); pageAdvertise(); }
    else toast(d.error || 'Could not create campaign', 'error');
  });
}

// =====================================================================
//  LEARN
// =====================================================================
async function pageLearn() {
  const cards = [
    [ICON.tasks, 'How tasks work', 'Pick a task, follow the instructions exactly, and submit the proof requested. Accurate proof gets approved faster.'],
    [ICON.clock, 'Approvals', 'Most submissions are reviewed within 5 hours. Approved rewards go straight to your USD balance.'],
    [ICON.gift, 'Referrals', 'Each referral link works once and pays 5 KES. Grab a fresh link after every successful invite.'],
    [ICON.ban, 'Avoid rejections', "Don't submit fake proof or repeat tasks, rejected work can't be paid and repeated abuse risks your account."],
    [ICON.bank, 'Getting paid', 'Save your payout details in Settings, then withdraw to M-Pesa, PayPal or your bank once you hit the minimum.'],
    [ICON.shield, 'Staying safe', 'Never share your password. Gweno will never ask for it by email or chat.'],
  ];
  view().innerHTML = `
    <p class="page-sub">Short guides to help you earn more, faster.</p>
    <div class="grid g3">
      ${cards.map(([ico, title, body]) => `
        <div class="panel learn-card"><div class="ico">${ico}</div><h3>${esc(title)}</h3><p class="p-sub">${esc(body)}</p></div>`).join('')}
    </div>`;
}

// =====================================================================
//  REDEEM
// =====================================================================
// Deposit + withdraw methods (each shown as a logo card).
const DEPOSIT_METHODS = [
  { key: 'M-Pesa', logo: LOGO.mpesa, desc: 'STK push · KES' },
  { key: 'Card', logo: LOGO.card, desc: 'Debit / credit card' },
  { key: 'Paystack', logo: LOGO.paystack, desc: 'Cards & bank' },
  { key: 'PayPal', logo: LOGO.paypal, desc: 'Pay with PayPal' },
  { key: 'Bank account', logo: LOGO.bank, desc: 'Bank transfer' },
];
const WITHDRAW_METHODS = [
  { key: 'M-Pesa', logo: LOGO.mpesa, desc: 'To your M-Pesa · KES' },
  { key: 'PayPal', logo: LOGO.paypal, desc: 'To your PayPal · USD' },
  { key: 'Bank account', logo: LOGO.bank, desc: 'To your bank · USD' },
];
const INVEST_METHOD_CARDS = [
  { key: 'Card', logo: LOGO.card, desc: 'Debit / credit card' },
  { key: 'Stripe', logo: LOGO.stripe, desc: 'Global cards' },
  { key: 'PayPal', logo: LOGO.paypal, desc: 'Pay with PayPal' },
  { key: 'M-Pesa', logo: LOGO.mpesa, desc: 'Mobile money' },
  { key: 'Paystack', logo: LOGO.paystack, desc: 'Cards & bank' },
];

async function pageRedeem() {
  loading();
  const [{ data }, dep] = await Promise.all([apiGet('/api/redeem'), apiGet('/api/deposits')]);
  const deposits = dep.data.deposits || [];
  const bank = dep.data.bank || null; // receiving bank account for manual bank-transfer deposits
  const statusClass = (s) => (s && /(paid|success)/i.test(s) ? 'approved' : s === 'Failed' ? 'rejected' : 'pending');
  const savedPhone = (ME.profile && ME.profile.phone) || '';
  const minUSD = (data.min && data.min.USD) || 0.5;

  // Coming back from a card / Paystack checkout redirect (?deposited / ?depfail).
  const rq = new URLSearchParams(location.hash.split('?')[1] || '');
  if (rq.get('deposited')) { toast('Deposit received, your wallet has been credited!'); await refreshMe(); }
  else if (rq.get('depfail')) toast('Payment was not completed. You can try again.', 'error');
  if (rq.get('deposited') || rq.get('depfail')) history.replaceState(null, '', `${location.pathname}${location.search}#/redeem`);

  // The wallet is one balance shown in both currencies, kept in sync via the live FX rate.
  const bal = totals();
  view().innerHTML = `
    <p class="page-sub">Your wallet, deposit and withdraw worldwide.</p>
    <div class="grid g2">
      <div class="stat brand"><div class="label">KES balance</div><div class="value">${kes(bal.kes)}</div></div>
      <div class="stat"><div class="label">USD balance</div><div class="value">${usd(bal.usd)}</div></div>
    </div>

    <div class="panel">
      <h3>Deposit to top up your wallet</h3>
      <p class="p-sub">Choose how you'd like to add money. Available worldwide.</p>
      <div id="depMethods"></div>
      <form id="dForm" style="margin-top:14px">
        <div id="depFields"><p class="p-sub">Select a method above to continue.</p></div>
        <button class="btn btn-primary" type="submit" id="dBtn">Deposit</button>
      </form>
      ${deposits.length ? `<table class="table" style="margin-top:14px"><thead><tr><th>Date</th><th class="num">Amount</th><th>Method</th><th>Status</th></tr></thead><tbody>${deposits.slice(0, 5).map((d) => `<tr><td class="p-sub">${fmtDate(d.createdAt)}</td><td class="num">${d.currency === 'USD' ? usd(d.amount) : kes(d.amount)}</td><td>${esc(d.method || 'M-Pesa')}</td><td><span class="st ${statusClass(d.status)}">${esc(d.status)}</span></td></tr>`).join('')}</tbody></table>` : ''}
    </div>

    <div class="panel">
      <h3>Withdraw to cash out</h3>
      <p class="p-sub"><b>M-Pesa</b> is entered and paid in <b>KES</b>; PayPal and bank in <b>USD</b>. Withdrawals are usually verified by our team within 2 hours before funds are sent.</p>
      <div id="wdMethods"></div>
      <form id="rForm" style="margin-top:14px">
        <div id="wdFields"><p class="p-sub">Select a method above to continue.</p></div>
        <p class="p-sub" id="minHint"></p>
        <button class="btn btn-primary" type="submit">Request payout</button>
      </form>
    </div>

    <div class="panel">
      <h3>Payout history</h3>
      <table class="table"><thead><tr><th>Date</th><th class="num">Amount</th><th>Method</th><th>Destination</th><th>Status</th></tr></thead>
      <tbody>${data.history.length ? data.history.map((h) => `<tr><td class="p-sub">${fmtDate(h.createdAt)}</td><td class="num">${h.currency === 'KES' ? kes(h.amount) : usd(h.amount)}</td><td>${esc(h.method)}</td><td class="p-sub">${esc(h.destination || '—')}</td><td><span class="st ${statusClass(h.status)}">${esc(h.status)}</span></td></tr>`).join('') : `<tr><td colspan="5" class="p-sub">No payouts yet.</td></tr>`}</tbody></table>
    </div>`;

  // ---------- Deposit ----------
  const depFields = document.getElementById('depFields');
  function depForm(m) {
    const amtKES = `<div class="field"><label>Amount in Kenyan Shillings</label><input id="dAmt" type="number" min="${dep.data.min}" step="1" placeholder="e.g. 500"></div>`;
    const amtUSD = `<div class="field"><label>Amount (USD)</label><input id="dAmt" type="number" min="1" step="0.01" placeholder="e.g. 20"></div>`;
    if (m === 'M-Pesa') return `<div class="grid g2">${amtKES}<div class="field"><label>M-Pesa phone</label><input id="dPhone" value="${esc(savedPhone)}" placeholder="e.g. +254 712 345 678"></div></div><p class="p-sub">You'll get an STK PIN prompt on your phone.</p>`;
    if (m === 'Card' || m === 'Paystack') return `${amtUSD}<p class="p-sub">You'll be taken to a secure ${m === 'Card' ? 'card payment' : 'Paystack'} page to enter your card and pay. Your wallet is credited automatically once the payment succeeds.</p>`;
    if (m === 'PayPal') return `<div class="grid g2">${amtUSD}<div class="field"><label>PayPal email</label><input id="dEmail" type="email" placeholder="you@example.com"></div></div>`;
    if (m === 'Bank account') {
      if (!bank) return `${amtUSD}<p class="p-sub">Bank transfer isn't set up yet, please use another method for now.</p>`;
      const row = (label, val) => (val ? `<div class="row"><span>${esc(label)}</span><b>${esc(val)}</b></div>` : '');
      return `
        <p class="p-sub" style="margin:0 0 6px"><b>How it works:</b> send your transfer to the account below, enter the amount and your bank reference, then click Deposit. Your wallet is credited once we confirm the payment (usually within 24 hours).</p>
        <div class="bank-box">
          <div class="p-sub" style="margin-bottom:6px">Transfer the money to:</div>
          ${row('Bank', bank.bankName)}
          ${row('Account name', bank.accountName)}
          ${row('Account number', bank.accountNumber)}
          ${row('Branch', bank.branch)}
          ${row('SWIFT / BIC', bank.swift)}
          ${bank.instructions ? `<div class="row"><span>Note</span><b>${esc(bank.instructions)}</b></div>` : ''}
        </div>
        ${amtUSD}
        <div class="field"><label>Your bank reference / transaction code</label><input id="dRef" placeholder="e.g. the reference shown by your bank"></div>`;
    }
    return amtUSD;
  }
  const getDepMethod = renderMethodCards(document.getElementById('depMethods'), DEPOSIT_METHODS, (m) => { depFields.innerHTML = depForm(m); });

  document.getElementById('dForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = getDepMethod();
    if (!m) return toast('Choose a deposit method', 'error');
    const amtEl = document.getElementById('dAmt');
    const amount = Number(amtEl ? amtEl.value : 0);
    if (!(amount > 0)) return toast('Enter a valid amount', 'error');
    const btn = document.getElementById('dBtn');
    if (m === 'M-Pesa') {
      const phone = document.getElementById('dPhone').value;
      if (!/^(?:254|0)\d{9}$/.test(String(phone).replace(/\s+/g, ''))) return toast('Enter a valid M-Pesa number (e.g. 0712345678)', 'error');
      btn.disabled = true;
      const { ok, data: d } = await api('/api/deposit', { amount, phone });
      if (!ok) { btn.disabled = false; return toast(d.error || 'Could not start deposit', 'error'); }
      toast(d.message);
      let tries = 0;
      const poll = setInterval(async () => {
        tries += 1;
        const s = await apiGet('/api/deposit/' + d.reference + '/status');
        if (s.ok && s.data.status === 'success') { clearInterval(poll); toast('Deposit received. Balance updated.'); await refreshMe(); pageRedeem(); }
        else if ((s.ok && s.data.status === 'failed') || tries >= 20) { clearInterval(poll); if (s.data && s.data.status === 'failed') toast('Deposit was not completed.', 'error'); pageRedeem(); }
      }, 3000);
    } else if (m === 'Card' || m === 'Paystack') {
      btn.disabled = true;
      const { ok, data: d } = await api('/api/deposit/checkout', { method: m, amount });
      if (!ok) { btn.disabled = false; return toast(d.error || 'Could not start card payment', 'error'); }
      if (d.mode === 'redirect' && d.url) { toast(d.message || 'Redirecting to pay…'); location.href = d.url; return; }
      btn.disabled = false;
    } else {
      let details = '';
      if (m === 'PayPal') details = document.getElementById('dEmail').value;
      else if (m === 'Bank account') { const r = document.getElementById('dRef'); details = r ? r.value.trim() : ''; }
      const { ok, data: d } = await api('/api/deposit/manual', { method: m, amount, details });
      if (ok) { toast(d.message); pageRedeem(); } else toast(d.error || 'Could not record deposit', 'error');
    }
  });

  // ---------- Withdraw (USD; Bank account is a REAL payout via Paystack) ----------
  const wdFields = document.getElementById('wdFields');
  const minHint = document.getElementById('minHint');
  let BANKS = null, bankLive = false;

  function wdForm(m) {
    // M-Pesa pays out in KES (Kenyan users don't hold USD in M-Pesa); PayPal/Bank are USD.
    const cur = m === 'M-Pesa' ? 'KES' : 'USD';
    const amt = `<div class="field"><label>Amount (${cur})</label><input id="rAmt" type="number" step="${cur === 'KES' ? '1' : '0.01'}" min="0" placeholder="${cur === 'KES' ? 'e.g. 1000' : '0.00'}"></div>`;
    if (m === 'Bank account') {
      return `${amt}
        <div class="grid g2">
          <div class="field"><label>Bank</label><select id="bkBankCode"><option value="">Loading banks…</option></select></div>
          <div class="field"><label>Account number</label><input id="bkAcct" inputmode="numeric" placeholder="Your account number"></div>
          <div class="field"><label>Account holder name <span class="p-sub">(optional)</span></label><input id="bkName" placeholder="Full name on the account"></div>
        </div>`;
    }
    let dest = '';
    if (m === 'M-Pesa') dest = `<div class="field"><label>M-Pesa phone number</label><input id="rDest" value="${esc(savedPhone)}" placeholder="e.g. +254 712 345 678"></div>`;
    else if (m === 'PayPal') dest = `<div class="field"><label>PayPal email</label><input id="rDest" type="email" placeholder="you@example.com"></div>`;
    else dest = `<div class="field"><label>Destination</label><input id="rDest" placeholder="Account details"></div>`;
    return `<div class="grid g2">${amt}${dest}</div>`;
  }

  async function loadBanks() {
    const sel = document.getElementById('bkBankCode'); if (!sel) return;
    if (BANKS === null) { const r = await apiGet('/api/banks'); BANKS = (r.data && r.data.banks) || []; bankLive = !!(r.data && r.data.live); }
    if (!bankLive || !BANKS.length) { sel.innerHTML = '<option value="">Manual bank transfer</option>'; return; }
    sel.innerHTML = '<option value="">Select your bank…</option>' + BANKS.map((b) => `<option value="${esc(b.code)}">${esc(b.name)}</option>`).join('');
  }

  const getWdMethod = renderMethodCards(document.getElementById('wdMethods'), WITHDRAW_METHODS, (m) => {
    wdFields.innerHTML = wdForm(m);
    if (m === 'Bank account') { loadBanks(); minHint.textContent = 'Paid straight to your bank account, real payout, usually arrives within minutes.'; }
    else minHint.textContent = m === 'M-Pesa'
      ? 'Entered in KES and sent straight to your M-Pesa, real payout, usually arrives within minutes.'
      : `Entered in USD and paid to your ${m}. Withdrawals are usually verified by our team within 2 hours before funds are sent.`;
  });

  // Poll a submitted withdrawal for its real status (Processing → Successful/Failed).
  async function trackWithdrawal(rec) {
    if (!rec || !rec.id) { await refreshMe(); return pageRedeem(); }
    if (!/processing/i.test(rec.status || '')) { await refreshMe(); return pageRedeem(); }
    toast('Payout processing…');
    let tries = 0;
    const poll = setInterval(async () => {
      tries += 1;
      const s = await apiGet('/api/redemptions/' + rec.id + '/status');
      const st = s.data && s.data.status;
      if (st && /paid|success/i.test(st)) { clearInterval(poll); toast('Withdrawal successful, money sent ✓'); await refreshMe(); pageRedeem(); }
      else if (st && /failed/i.test(st)) { clearInterval(poll); toast('Withdrawal failed, your balance was refunded.', 'error'); await refreshMe(); pageRedeem(); }
      else if (tries >= 15) { clearInterval(poll); await refreshMe(); pageRedeem(); }
    }, 3000);
  }

  document.getElementById('rForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const m = getWdMethod();
    if (!m) return toast('Choose a payout method', 'error');
    const amount = Number((document.getElementById('rAmt') || {}).value || 0);
    if (!(amount > 0)) return toast('Enter a valid amount to withdraw', 'error');
    // One idempotency key per submit, prevents duplicate payouts on retry/double-click.
    const idempotencyKey = 'wd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const body = { method: m, idempotencyKey, amount, currency: m === 'M-Pesa' ? 'KES' : 'USD' };

    if (m === 'Bank account') {
      const g = (id) => (document.getElementById(id) || {}).value || '';
      const bankCode = g('bkBankCode'), accountNumber = g('bkAcct').trim(), accountName = g('bkName').trim();
      if (bankLive) { if (!bankCode || !accountNumber) return toast('Choose your bank and enter your account number', 'error'); }
      else if (!accountNumber) return toast('Enter your account details', 'error');
      Object.assign(body, { bankCode, accountNumber, accountName, destination: `${accountName ? accountName + ' · ' : ''}${accountNumber}` });
    } else {
      const destEl = document.getElementById('rDest');
      body.destination = destEl ? destEl.value : '';
    }

    if (btn) btn.disabled = true;
    const { ok, data: d } = await api('/api/redeem', body);
    if (ok) { toast(d.message); await trackWithdrawal(d.redemption); }
    else { if (btn) btn.disabled = false; toast(d.error || 'Could not redeem', 'error'); }
  });
}

// =====================================================================
//  SETTINGS
// =====================================================================
let SETTINGS_TAB = 'password';
function pageSettings() {
  const tabs = [['password', 'Password'], ['email', 'Email'], ['username', 'Username'], ['notifications', 'Notifications'], ['payment', 'Payment'], ['picture', 'Profile picture']];
  if (!tabs.some(([k]) => k === SETTINGS_TAB)) SETTINGS_TAB = 'password';
  view().innerHTML = `
    <p class="page-sub">Manage your account and preferences. Edit your personal details in <a href="#/profile">Profile</a>.</p>
    <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === SETTINGS_TAB ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="settingsPanel"></div>`;
  view().querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { SETTINGS_TAB = b.dataset.tab; pageSettings(); }));
  ({ password: setPassword, email: setEmail, username: setUsername, notifications: setNotifications, payment: setPayment, picture: setPicture }[SETTINGS_TAB] || setPassword)();
}
const sPanel = () => document.getElementById('settingsPanel');

// Ask before signing out, then clear the session and go to the login screen.
function confirmSignOut() {
  const bg = openModal(`
    <button class="close">×</button>
    <h3>Sign out?</h3>
    <p class="p-sub">You'll need to sign in again to access your account.</p>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn btn-ghost auto" id="soCancel">Cancel</button>
      <button class="btn btn-primary auto" id="soConfirm"><span class="bico">${ICON.logout}</span> Sign out</button>
    </div>`);
  bg.querySelector('#soCancel').addEventListener('click', () => bg.remove());
  bg.querySelector('#soConfirm').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await api('/api/logout', {}); } catch (_) {}
    location.href = '/login.html';
  });
}

// Profile page, opened from the top-right avatar. Personal details + the Danger Zone.
function pageProfile() {
  const p = ME.profile || {};
  view().innerHTML = `
    <p class="page-sub">Your personal details. Account & security options are in <a href="#/settings">Settings</a>.</p>
    <div class="panel"><h3>Profile</h3>
    <form id="f">
      <div class="grid g2">
        <div class="field"><label>Full name</label><input id="name" value="${esc(ME.name)}"></div>
        <div class="field"><label>Gender</label><select id="gender"><option value="">Select…</option>${['Male', 'Female', 'Other', 'Prefer not to say'].map((g) => `<option ${p.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
        <div class="field"><label>Country</label><input id="country" value="${esc(p.country || '')}" placeholder="Kenya"></div>
        <div class="field"><label>Phone number</label><input id="phone" value="${esc(p.phone || '')}" placeholder="e.g. +254 712 345 678"></div>
        <div class="field"><label>Date of birth</label><input id="dob" type="date" value="${esc(p.dob || '')}"></div>
        <div class="field"><label>Postal code</label><input id="postalCode" value="${esc(p.postalCode || '')}"></div>
        <div class="field"><label>State / County</label><input id="state" value="${esc(p.state || '')}"></div>
      </div>
      <button class="btn btn-primary" type="submit">Save profile</button>
    </form></div>
    <div class="panel">
      <h3>Session</h3>
      <p class="p-sub">Sign out of your Gweno account on this device.</p>
      <button class="btn btn-ghost auto" id="signOutBtn"><span class="bico">${ICON.logout}</span> Sign out</button>
    </div>
    <div class="panel danger-zone">
      <h3>⚠ Danger Zone</h3>
      <p class="p-sub">Deleting your account is <b>permanent</b> and cannot be undone. It removes your profile, balances, transactions, tasks and all related records. For fraud prevention, this device will not be able to register a new account afterwards.</p>
      <button class="btn auto" id="delAcc" style="background:var(--danger);border-color:var(--danger);color:#fff">Delete my account</button>
    </div>`;
  view().querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = ['name', 'gender', 'country', 'phone', 'dob', 'postalCode', 'state'].reduce((o, k) => (o[k] = document.getElementById(k).value, o), {});
    const { ok, data } = await api('/api/settings/profile', body);
    if (ok) { ME = data.user; updateTopbar(); toast(data.message); } else toast(data.error, 'error');
  });
  document.getElementById('signOutBtn').addEventListener('click', confirmSignOut);
  document.getElementById('delAcc').addEventListener('click', () => {
    const bg = openModal(`
      <button class="close">×</button>
      <h3>Delete your account</h3>
      <p class="p-sub">This permanently deletes your account and cannot be undone. This device will also be blocked from creating a new account. Enter your password to confirm.</p>
      <form id="delForm">
        <div class="field"><label>Your password</label><div class="pw-wrap"><input id="delPw" type="password" placeholder="Enter your password"><button type="button" class="pw-toggle" data-pwtoggle="delPw"></button></div></div>
        <button class="btn btn-primary" type="submit" style="background:var(--danger);border-color:var(--danger)">Permanently delete my account</button>
      </form>`);
    attachPasswordToggles(bg);
    bg.querySelector('#delForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = bg.querySelector('#delPw').value;
      if (!password) return toast('Please enter your password', 'error');
      const { ok, data } = await api('/api/delete-account', { password });
      if (ok) { bg.remove(); toast(data.message); setTimeout(() => (location.href = '/'), 1200); }
      else toast(data.error || 'Could not delete account', 'error');
    });
  });
}

function setPassword() {
  sPanel().innerHTML = `<div class="panel"><h3>Change password</h3>
    <p class="p-sub">You can change your password here, or reset it from the <a href="/forgot.html" target="_blank">forgot-password page</a> if you're locked out.</p>
    <form id="f">
      <div class="field"><label>Current password</label><div class="pw-wrap"><input id="current" type="password"><button type="button" class="pw-toggle" data-pwtoggle="current"></button></div></div>
      <div class="field"><label>New password</label><div class="pw-wrap"><input id="newPassword" type="password" placeholder="8+ chars, a letter & a number"><button type="button" class="pw-toggle" data-pwtoggle="newPassword"></button></div></div>
      <div class="field"><label>Confirm new password</label><div class="pw-wrap"><input id="confirm" type="password"><button type="button" class="pw-toggle" data-pwtoggle="confirm"></button></div></div>
      <button class="btn btn-primary" type="submit">Update password</button>
    </form></div>`;
  attachPasswordToggles(sPanel());
  sPanel().querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (document.getElementById('newPassword').value !== document.getElementById('confirm').value) return toast('New passwords do not match', 'error');
    const { ok, data } = await api('/api/settings/password', { current: document.getElementById('current').value, newPassword: document.getElementById('newPassword').value });
    if (ok) { toast(data.message); sPanel().querySelector('#f').reset(); } else toast(data.error, 'error');
  });
}

function setEmail() {
  sPanel().innerHTML = `<div class="panel"><h3>Email address</h3>
    <p class="p-sub">Current: <b>${esc(ME.email)}</b></p>
    <form id="f">
      <div class="field"><label>New email address</label><input id="newEmail" type="email" placeholder="new@example.com"></div>
      <div class="field"><label>Confirm with password</label><div class="pw-wrap"><input id="password" type="password"><button type="button" class="pw-toggle" data-pwtoggle="password"></button></div></div>
      <button class="btn btn-primary" type="submit">Change email</button>
    </form></div>`;
  attachPasswordToggles(sPanel());
  sPanel().querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { ok, data } = await api('/api/settings/email', { newEmail: document.getElementById('newEmail').value, password: document.getElementById('password').value });
    if (ok) { ME = data.user; toast(data.message); pageSettings(); } else toast(data.error, 'error');
  });
}

function setUsername() {
  sPanel().innerHTML = `<div class="panel"><h3>Username</h3>
    <p class="p-sub">Current: <b>${esc(ME.username)}</b>. You can change it only once every 30 days. 6–10 characters, letters and numbers only.</p>
    <form id="f">
      <div class="field"><label>New username</label><input id="newUsername" placeholder="Your new username" minlength="6" maxlength="10"></div>
      <div class="field"><label>Confirm new username</label><input id="confirm" placeholder="Re-enter username"></div>
      <button class="btn btn-primary" type="submit">Change username</button>
    </form></div>`;
  sPanel().querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (document.getElementById('newUsername').value !== document.getElementById('confirm').value) return toast('Usernames do not match', 'error');
    const { ok, data } = await api('/api/settings/username', { newUsername: document.getElementById('newUsername').value });
    if (ok) { ME = data.user; updateTopbar(); toast(data.message); pageSettings(); } else toast(data.error, 'error');
  });
}

function setNotifications() {
  const n = ME.notifications || {};
  const row = (key, title, sub) => `<div class="toggle-row"><div class="t-label"><b>${title}</b><span>${sub}</span></div><label class="switch"><input type="checkbox" id="${key}" ${n[key] ? 'checked' : ''}><span class="track"></span></label></div>`;
  sPanel().innerHTML = `<div class="panel"><h3>Email notifications</h3>
    <p class="p-sub">Choose which emails you'd like to receive.</p>
    ${row('newTasks', 'New tasks available', 'Get an email when fresh tasks are posted.')}
    ${row('account', 'Account & security', 'Important updates about your account.')}
    ${row('promotions', 'Promotions & tips', 'Occasional offers and earning tips.')}
    <button class="btn btn-primary" id="save" style="margin-top:16px">Save preferences</button>
  </div>`;
  document.getElementById('save').addEventListener('click', async () => {
    const next = {
      newTasks: document.getElementById('newTasks').checked,
      account: document.getElementById('account').checked,
      promotions: document.getElementById('promotions').checked,
    };
    const applyToggles = (v) => {
      ME.notifications = v;
      ['newTasks', 'account', 'promotions'].forEach((k) => { const el = document.getElementById(k); if (el) el.checked = !!v[k]; });
    };
    // Optimistic update (pattern 2): keep the toggles as the user set them and save
    // in the background; if the request fails, Data.optimistic rolls the UI back.
    Data.setCache('me:notifications', ME.notifications || {});
    try {
      const res = await Data.optimistic('me:notifications', () => next, () => api('/api/settings/notifications', next), applyToggles);
      ME.notifications = (res.data && res.data.notifications) || next;
      toast((res.data && res.data.message) || 'Notification preferences saved.');
    } catch (_) {
      toast('Could not save preferences, changes reverted.', 'error');
    }
  });
}

const PAY_METHODS = [
  { key: 'M-Pesa', logo: LOGO.mpesa, desc: 'Mobile money (KES)' },
  { key: 'Card', logo: LOGO.card, desc: 'Visa / Mastercard' },
  { key: 'PayPal', logo: LOGO.paypal, desc: 'Pay & get paid in USD' },
  { key: 'Bank account', logo: LOGO.bank, desc: 'Direct bank transfer' },
  { key: 'Apple Pay', logo: LOGO.applepay, desc: 'Fast checkout on Apple devices' },
  { key: 'Stripe', logo: LOGO.stripe, desc: 'Global card processing' },
];

// The fields shown for each method. `masked` fields never leave the browser as-is.
function paymentFields(method) {
  const F = {
    'M-Pesa': `<div class="field"><label>M-Pesa phone number</label><input id="pf_phone" placeholder="e.g. +254 712 345 678"></div>`,
    'Card': `
      <div class="field"><label>Card number</label><input id="pf_card" inputmode="numeric" placeholder="1234 5678 9012 3456"></div>
      <div class="grid g2">
        <div class="field"><label>Name on card</label><input id="pf_name" placeholder="Full name"></div>
        <div class="field"><label>Expiry</label><input id="pf_exp" placeholder="MM/YY"></div>
      </div>
      <div class="field"><label>CVC</label><input id="pf_cvc" inputmode="numeric" placeholder="123" maxlength="4"></div>`,
    'PayPal': `<div class="field"><label>PayPal email</label><input id="pf_email" type="email" placeholder="you@example.com"></div>`,
    'Bank account': `
      <div class="grid g2">
        <div class="field"><label>Account holder name</label><input id="pf_name" placeholder="Full name"></div>
        <div class="field"><label>Bank name</label><input id="pf_bank" placeholder="Your bank's name"></div>
        <div class="field"><label>Account number / IBAN</label><input id="pf_acct" placeholder="Account number"></div>
        <div class="field"><label>SWIFT / routing <span class="p-sub">(optional)</span></label><input id="pf_swift" placeholder="Your SWIFT or routing code"></div>
      </div>`,
    'Apple Pay': `<div class="field"><label>Apple ID email</label><input id="pf_email" type="email" placeholder="you@icloud.com"></div>`,
    'Stripe': `
      <div class="field"><label>Publishable key</label><input id="pf_pub" placeholder="pk_live_…"></div>
      <div class="field"><label>Secret key</label><input id="pf_sec" placeholder="sk_live_…"></div>`,
  };
  return F[method] || '';
}

// Build a SAFE display string (no raw card number, CVC or secret keys are stored).
function paymentDetails(method, root) {
  const v = (id) => { const el = root.querySelector('#' + id); return el ? el.value.trim() : ''; };
  const last4 = (s) => s.replace(/\D/g, '').slice(-4);
  if (method === 'M-Pesa') { const p = v('pf_phone'); return p ? p : null; }
  if (method === 'PayPal' || method === 'Apple Pay') { const e = v('pf_email'); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : (toast('Enter a valid email', 'error'), null); }
  if (method === 'Card') { const c = last4(v('pf_card')); return c.length === 4 ? '•••• •••• •••• ' + c : (toast('Enter a valid card number', 'error'), null); }
  if (method === 'Bank account') { const n = v('pf_name'), b = v('pf_bank'), a = v('pf_acct'); if (!n || !b || !a) return (toast('Fill in your bank details', 'error'), null); return `${n} · ${b} · ••••${last4(a)}`; }
  if (method === 'Stripe') { return v('pf_pub') ? 'Stripe connected' : (toast('Enter your Stripe keys', 'error'), null); }
  return null;
}

function setPayment() {
  const saved = (ME.payment && ME.payment.method) || '';
  sPanel().innerHTML = `<div class="panel"><h3>Payment methods</h3>
    <p class="p-sub">Pick how you'd like to pay and get paid, then add the details. Choose one to save it as your default.</p>
    <div class="pay-methods">
      ${PAY_METHODS.map((m) => `<button type="button" class="pay-card ${m.key === saved ? 'selected' : ''}" data-method="${esc(m.key)}">
        <span class="pay-logo">${m.logo}</span>
        <span class="pay-name">${esc(m.key)}</span>
        <span class="pay-desc">${esc(m.desc)}</span>
      </button>`).join('')}
    </div>
    ${saved ? `<p class="p-sub" style="margin-top:14px">Current default: <b>${esc(saved)}</b>${ME.payment && ME.payment.details ? ` · ${esc(ME.payment.details)}` : ''}</p>` : ''}
    <form id="payForm" style="margin-top:14px"><div id="payFields"><p class="p-sub">Select a method above to add its details.</p></div>
      <button class="btn btn-primary" type="submit">Save payment method</button>
    </form>
    <p class="p-sub" style="margin-top:10px"><span class="bico">${ICON.lock}</span> For your security we only store a masked reference, full card numbers, CVC and secret keys are never saved.</p>
  </div>`;

  const payFields = sPanel().querySelector('#payFields');
  let current = '';
  const select = (method) => {
    current = method;
    sPanel().querySelectorAll('.pay-card').forEach((c) => c.classList.toggle('selected', c.dataset.method === method));
    payFields.innerHTML = paymentFields(method);
  };
  sPanel().querySelectorAll('.pay-card').forEach((c) => c.addEventListener('click', () => select(c.dataset.method)));

  sPanel().querySelector('#payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!current) return toast('Choose a payment method first', 'error');
    const details = paymentDetails(current, payFields);
    if (details === null) return;
    const { ok, data } = await api('/api/settings/payment', { method: current, details });
    if (ok) { ME.payment = data.payment; toast(data.message); pageSettings(); } else toast(data.error, 'error');
  });
}

function setPicture() {
  sPanel().innerHTML = `<div class="panel"><h3>Profile picture</h3>
    <div style="display:flex;align-items:center;gap:18px;margin-bottom:16px">${avatarHTML(ME, 'avatar-sm')}<span class="p-sub">Upload a clear photo of yourself. Square images look best.</span></div>
    <p class="msg error show" style="display:block">⚠ Please keep it appropriate. Any explicit, adult or offensive image will lead to your account being suspended and your earnings forfeited.</p>
    <input type="file" id="file" accept="image/*" class="field">
    <button class="btn btn-primary" id="upload" style="margin-top:12px">Upload picture</button>
  </div>`;
  document.getElementById('upload').addEventListener('click', () => {
    const f = document.getElementById('file').files[0];
    if (!f) return toast('Choose an image first', 'error');
    if (f.size > 1200000) return toast('Image too large (max ~1MB)', 'error');
    const reader = new FileReader();
    reader.onload = async () => {
      const { ok, data } = await api('/api/settings/avatar', { image: reader.result });
      if (ok) { ME.avatar = data.avatar; updateTopbar(); toast(data.message); pageSettings(); } else toast(data.error, 'error');
    };
    reader.readAsDataURL(f);
  });
}

// =====================================================================
//  CHAT / SUPPORT / ADMIN
// =====================================================================
function pageChat() {
  view().innerHTML = `<div class="panel"><div class="coming"><div class="big">💬</div><h3>Chat is coming soon</h3><p class="page-sub">Soon you'll be able to message support and other members right here. For now, please use <a href="#/support">Support</a>.</p><span class="pill-note">Coming soon</span></div></div>`;
}

function pageSupport() {
  view().innerHTML = `
    <p class="page-sub">Need help? Send us a message and we'll reply by email.</p>
    <div class="grid g2">
      <div class="panel"><h3>Contact support</h3>
        <form id="f">
          <div class="field"><label>Subject</label><input id="subject" placeholder="What do you need help with?"></div>
          <div class="field"><label>Message</label><textarea id="message" placeholder="Describe your issue…"></textarea></div>
          <button class="btn btn-primary" type="submit">Send message</button>
        </form>
      </div>
      <div class="panel"><h3>Other ways to reach us</h3>
        <p class="p-sub">Email: <a href="mailto:support@gweno.app">support@gweno.app</a></p>
        <p class="p-sub">We usually reply within 24 hours on business days.</p>
        <p class="p-sub">Signed in as <b>${esc(ME.email)}</b>, we'll reply to this address.</p>
      </div>
    </div>`;
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = document.getElementById('subject').value.trim();
    const message = document.getElementById('message').value.trim();
    if (!subject || !message) return toast('Please enter a subject and a message', 'error');
    if (subject.length > 150) return toast('Subject is too long (max 150 characters)', 'error');
    if (message.length > 4000) return toast('Message is too long (max 4000 characters)', 'error');
    const { ok, data } = await api('/api/support', { subject, message });
    if (ok) { toast(data.message); document.getElementById('f').reset(); } else toast(data.error, 'error');
  });
}

// Admin lives on its own page now, outside the member dashboard.
function pageAdmin() { location.href = '/admin.html'; }

boot();

/* Gweno admin panel — standalone page, admins only. Uses /js/auth.js (api). */
let ADMIN = null;
let TAB = 'overview';

const usd = (n) => '$' + (Number(n) || 0).toFixed(2);
const kes = (n) => Math.round(Number(n) || 0).toLocaleString() + ' KES';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function apiGet(p) { const r = await fetch(p); let d = {}; try { d = await r.json(); } catch (_) {} return { ok: r.ok, status: r.status, data: d }; }
function toast(msg, type = 'ok') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  document.body.appendChild(t); requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3000);
}

const TABS = [['overview', 'Overview'], ['submissions', 'Submissions'], ['users', 'Users'], ['investments', 'Investments'], ['deposits', 'Deposits'], ['withdrawals', 'Withdrawals'], ['support', 'Support']];

// ---- theme (light/dark), shared with the members area via localStorage ----
const THEME_ICONS = {
  moon: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
};
const curTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
function toggleTheme() {
  const t = curTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch (_) {}
  const b = document.getElementById('themeBtn'); if (b) b.innerHTML = curTheme() === 'dark' ? THEME_ICONS.sun : THEME_ICONS.moon;
}

async function boot() {
  const r = await apiGet('/api/admin/session');
  if (!r.data.authed) { renderLogin(!r.data.configured); return; }
  renderShell();
  route();
}

function renderLogin(notConfigured) {
  document.getElementById('app').innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:20px">
      <div class="panel" style="width:100%;max-width:380px">
        <a class="brand" href="/admin.html" style="display:inline-flex;margin-bottom:10px"><span class="dot"></span> gweno <span style="font-size:13px;color:var(--muted)">· admin</span></a>
        <h3 style="margin:2px 0">Admin sign-in</h3>
        <p class="p-sub">Private access — this is not a client account.</p>
        ${notConfigured ? `<p class="msg error show" style="display:block">Set ADMIN_USERNAME and ADMIN_PASSWORD in .env, then restart.</p>` : ''}
        <div class="msg" id="msg"></div>
        <form id="loginForm">
          <div class="field"><label>Username</label><input id="username" autocomplete="username"></div>
          <div class="field"><label>Password</label><input id="password" type="password" autocomplete="current-password"></div>
          <button class="btn btn-primary" type="submit" style="width:100%">Sign in</button>
        </form>
      </div>
    </div>`;
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('msg');
    const { ok, data } = await api('/api/admin/login', {
      username: document.getElementById('username').value,
      password: document.getElementById('password').value,
    });
    if (ok) boot();
    else { msg.className = 'msg show error'; msg.textContent = data.error || 'Sign-in failed'; }
  });
}

function renderShell() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <a class="brand" href="/admin.html"><span class="dot"></span> gweno <span style="font-size:13px;color:var(--muted)">· admin</span></a>
      <div class="top-right">
        <button class="theme-toggle" id="themeBtn" title="Toggle dark mode" aria-label="Toggle dark mode">${curTheme() === 'dark' ? THEME_ICONS.sun : THEME_ICONS.moon}</button>
        <a class="btn btn-ghost auto" href="/" target="_blank">View site</a>
        <button class="btn btn-ghost auto" id="signout">Sign out</button>
      </div>
    </header>
    <main class="view">
      <div class="tabs" id="tabs">${TABS.map(([k, l]) => `<button class="tab ${k === TAB ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="content"></div>
    </main>`;
  document.getElementById('signout').addEventListener('click', async () => { await api('/api/admin/logout', {}); boot(); });
  const themeBtn = document.getElementById('themeBtn'); if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    TAB = b.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === TAB));
    route();
  }));
}
const content = () => document.getElementById('content');
// Skeleton loader (shimmer) instead of a "Loading…" line — matches the members area.
const loading = () => { content().innerHTML = `
  <div class="sk sk-line" style="width:32%;height:15px;margin-bottom:18px"></div>
  <div class="grid g4"><div class="sk sk-stat"></div><div class="sk sk-stat"></div><div class="sk sk-stat"></div><div class="sk sk-stat"></div></div>
  <div class="panel">
    <div class="sk sk-line" style="width:26%;margin-bottom:14px"></div>
    <div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div>
  </div>`; };

function route() {
  ({ overview: tOverview, submissions: tSubmissions, users: tUsers, investments: tInvestments, deposits: tDeposits, withdrawals: tWithdrawals, support: tSupport }[TAB] || tOverview)();
}

async function tOverview() {
  loading();
  const { data } = await apiGet('/api/admin/overview');
  const s = data.submissions || {}, d = data.deposits || {}, w = data.withdrawals || {};
  content().innerHTML = `
    <p class="page-sub">Signed in as admin <b>${esc(data.admin ? data.admin.username : '')}</b>.</p>
    <div class="grid g4">
      <div class="stat brand"><div class="label">Users</div><div class="value">${data.users || 0}</div></div>
      <div class="stat"><div class="label">Pending reviews</div><div class="value">${s.pending || 0}</div></div>
      <div class="stat"><div class="label">Open disputes</div><div class="value">${s.disputes || 0}</div></div>
      <div class="stat"><div class="label">Support tickets</div><div class="value">${data.support || 0}</div></div>
    </div>
    <div class="grid g4">
      <div class="stat"><div class="label">Submissions</div><div class="value">${s.total || 0}</div></div>
      <div class="stat"><div class="label">Approved</div><div class="value">${s.approved || 0}</div></div>
      <div class="stat"><div class="label">Deposits (success)</div><div class="value">${kes(d.totalKES)}</div></div>
      <div class="stat"><div class="label">Withdrawals open</div><div class="value">${w.open || 0}</div></div>
    </div>
    <div class="panel"><h3>Welcome, admin</h3><p class="p-sub">Use the tabs above to review submissions, inspect users, and manage deposits and withdrawals. Approving a submission credits the member's USD balance.</p></div>`;
}

async function tSubmissions() {
  loading();
  const { data } = await apiGet('/api/admin/submissions');
  const subs = data.submissions || [];
  content().innerHTML = `
    <p class="page-sub">Approve or reject member task submissions. Approving credits the user's USD balance.</p>
    <div class="panel"><table class="table">
      <thead><tr><th>User</th><th>Task</th><th class="num">Reward</th><th>Proof</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${subs.length ? subs.map((sm) => `
        <tr>
          <td>${esc(sm.user ? sm.user.username : '—')}<br><span class="p-sub">${esc(sm.user ? sm.user.email : '')}</span></td>
          <td>${esc(sm.task ? sm.task.title : sm.taskId)}</td>
          <td class="num">${usd(sm.reward)}</td>
          <td class="p-sub" style="max-width:220px">${esc(sm.proof || '—')}${sm.dispute ? `<br><b style="color:#ffd479">Dispute:</b> ${esc(sm.dispute.message)}` : ''}</td>
          <td><span class="st ${sm.status}">${sm.status}</span></td>
          <td>${sm.status !== 'approved' ? `<button class="btn btn-primary auto adm" data-id="${sm.id}" data-d="approved">Approve</button> ` : ''}${sm.status !== 'rejected' ? `<button class="btn btn-ghost auto adm" data-id="${sm.id}" data-d="rejected">Reject</button>` : ''}</td>
        </tr>`).join('') : `<tr><td colspan="6" class="p-sub">No submissions yet.</td></tr>`}</tbody>
    </table></div>`;
  content().querySelectorAll('.adm').forEach((b) => b.addEventListener('click', async () => {
    const { ok, data: d } = await api('/api/admin/submissions/' + b.dataset.id + '/decision', { decision: b.dataset.d });
    if (ok) { toast('Marked ' + b.dataset.d); tSubmissions(); } else toast(d.error || 'Failed', 'error');
  }));
}

async function tUsers() {
  loading();
  const { data } = await apiGet('/api/admin/users');
  const users = data.users || [];
  const via = (ps) => (ps && ps.length ? ps.map((p) => (p === 'email' ? 'Email' : p.charAt(0).toUpperCase() + p.slice(1))).join(', ') : 'Email');
  const badges = (u) => `${u.isAdmin ? '<span class="st approved">admin</span> ' : ''}${u.suspended ? '<span class="st rejected">suspended</span> ' : ''}${u.held ? '<span class="st pending">on hold</span> ' : ''}${!u.suspended && !u.held ? '<span class="st approved">active</span>' : ''}`;
  const act = (a, u, label, extra) => `<button class="btn btn-ghost auto uact" data-a="${a}" data-id="${u.id}" data-email="${esc(u.email)}" data-kes="${u.balance}" data-usd="${u.usd}"${extra || ''}>${label}</button>`;
  content().innerHTML = `
    <p class="page-sub">${users.length} registered user(s). <b>Suspend</b> blocks sign-in · <b>Hold</b> pauses withdrawals · <b>Delete</b> removes the account. <a href="/api/admin/export" download>Download data export</a>.</p>
    <p class="pill-note">🔒 Passwords are encrypted one-way and can't be shown — for a member who asks, use <b>Password</b> to set them a new one.</p>
    <div class="panel"><table class="table">
      <thead><tr><th>Name</th><th>Email</th><th>Via</th><th class="num">KES</th><th class="num">USD</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${users.map((u) => `<tr>
        <td>${esc(u.name || u.username || '—')}<br><span class="p-sub">@${esc(u.username || '')}</span>
          <div style="margin-top:6px">${act('delete', u, '🗑 Delete', ' style="border-color:var(--danger);color:#c0143c;padding:4px 10px;font-size:12px"')}</div></td>
        <td class="p-sub">${esc(u.email)}</td>
        <td class="p-sub">${esc(via(u.providers))}</td>
        <td class="num">${kes(u.balance)}</td><td class="num">${usd(u.usd)}</td>
        <td>${badges(u)}</td>
        <td><div style="display:flex;gap:6px;flex-wrap:wrap">
          ${act('suspend', u, u.suspended ? 'Unsuspend' : 'Suspend')}
          ${act('hold', u, u.held ? 'Release hold' : 'Hold')}
          ${act('balance', u, 'Balance')}
          ${act('email', u, 'Email')}
          ${act('password', u, 'Password')}
        </div></td>
      </tr>`).join('') || `<tr><td colspan="7" class="p-sub">No users yet.</td></tr>`}</tbody>
    </table></div>`;
  content().querySelectorAll('.uact').forEach((b) => b.addEventListener('click', () => userAction(b.dataset)));
}

async function userAction(ds) {
  const id = ds.id, base = '/api/admin/users/' + id;
  if (ds.a === 'suspend') {
    const { ok, data } = await api(base + '/suspend', {});
    if (ok) { toast(data.suspended ? 'Account suspended' : 'Account unsuspended'); tUsers(); } else toast(data.error || 'Failed', 'error');
  } else if (ds.a === 'hold') {
    const { ok, data } = await api(base + '/hold', {});
    if (ok) { toast(data.held ? 'Account on hold' : 'Hold released'); tUsers(); } else toast(data.error || 'Failed', 'error');
  } else if (ds.a === 'balance') {
    const kesV = prompt('New KES balance for ' + ds.email + ':', ds.kes);
    if (kesV === null) return;
    const usdV = prompt('New USD balance for ' + ds.email + ':', ds.usd);
    if (usdV === null) return;
    const { ok, data } = await api(base + '/balance', { balance: Number(kesV), usd: Number(usdV) });
    if (ok) { toast('Balance updated'); tUsers(); } else toast(data.error || 'Failed', 'error');
  } else if (ds.a === 'email') {
    const email = prompt('New email address for this account:', ds.email);
    if (!email) return;
    const { ok, data } = await api(base + '/email', { email });
    if (ok) { toast('Email updated'); tUsers(); } else toast(data.error || 'Failed', 'error');
  } else if (ds.a === 'password') {
    const pw = prompt('Set a NEW password (8+ chars incl. a letter & a number). The member will be signed out everywhere:');
    if (!pw) return;
    const { ok, data } = await api(base + '/password', { password: pw });
    if (ok) toast('Password updated'); else toast(data.error || 'Failed', 'error');
  } else if (ds.a === 'delete') {
    if (!confirm('Permanently delete ' + ds.email + ' and all their data? This cannot be undone.')) return;
    const r = await fetch(base, { method: 'DELETE' });
    if (r.ok) { toast('Account deleted'); tUsers(); } else { let e = {}; try { e = await r.json(); } catch (_) {} toast(e.error || 'Failed', 'error'); }
  }
}

async function tDeposits() {
  loading();
  const { data } = await apiGet('/api/admin/deposits');
  const deps = data.deposits || [];
  const sc = (s) => (/success/i.test(s) ? 'approved' : (s === 'failed' ? 'rejected' : 'pending'));
  content().innerHTML = `
    <p class="page-sub">Wallet top-ups (M-Pesa STK &amp; other methods).</p>
    <div class="panel"><table class="table">
      <thead><tr><th>Date</th><th>User</th><th class="num">Amount</th><th>Method</th><th>Details</th><th>Status</th><th>Ref</th></tr></thead>
      <tbody>${deps.length ? deps.map((d) => `<tr><td class="p-sub">${new Date(d.createdAt).toLocaleString()}</td><td>${esc(d.user ? d.user.username : '—')}</td><td class="num">${d.currency === 'USD' ? usd(d.amount) : kes(d.amount)}</td><td>${esc(d.method || 'M-Pesa')}</td><td class="p-sub">${esc(d.phone || d.details || '—')}</td><td><span class="st ${sc(d.status)}">${esc(d.status)}${d.demo ? ' (demo)' : ''}</span></td><td class="p-sub">${esc(d.reference || '')}</td></tr>`).join('') : `<tr><td colspan="7" class="p-sub">No deposits yet.</td></tr>`}</tbody>
    </table></div>`;
}

async function tWithdrawals() {
  loading();
  const { data } = await apiGet('/api/admin/redemptions');
  const rs = data.redemptions || [];
  const sc = (s) => (/paid/i.test(s) ? 'approved' : (s === 'Failed' ? 'rejected' : 'pending'));
  content().innerHTML = `
    <p class="page-sub">Member withdrawals (M-Pesa, PayPal &amp; bank). Marking a payout <b>Failed</b> refunds the user's balance.</p>
    <div class="panel"><table class="table">
      <thead><tr><th>Date</th><th>User</th><th class="num">Amount</th><th>To</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${rs.length ? rs.map((r) => `<tr><td class="p-sub">${new Date(r.createdAt).toLocaleString()}</td><td>${esc(r.user ? r.user.username : '—')}</td><td class="num">${r.currency === 'KES' ? kes(r.amount) : usd(r.amount)}</td><td class="p-sub">${esc(r.destination || '—')}</td><td><span class="st ${sc(r.status)}">${esc(r.status)}</span></td><td>${!/paid/i.test(r.status) ? `<button class="btn btn-primary auto mk" data-id="${r.id}" data-s="Paid">Mark paid</button> ` : ''}${r.status !== 'Failed' ? `<button class="btn btn-ghost auto mk" data-id="${r.id}" data-s="Failed">Fail</button>` : ''}</td></tr>`).join('') : `<tr><td colspan="6" class="p-sub">No withdrawals yet.</td></tr>`}</tbody>
    </table></div>`;
  content().querySelectorAll('.mk').forEach((b) => b.addEventListener('click', async () => {
    const { ok, data: d } = await api('/api/admin/redemptions/' + b.dataset.id + '/mark', { status: b.dataset.s });
    if (ok) { toast('Marked ' + b.dataset.s); tWithdrawals(); } else toast(d.error || 'Failed', 'error');
  }));
}

async function tInvestments() {
  loading();
  const { data } = await apiGet('/api/admin/investments');
  const s = data.stats || {}, plans = data.plans || [], rates = data.rates || {};
  const invs = data.investments || [];
  const sc = (st) => (st === 'completed' ? 'approved' : 'pending');
  content().innerHTML = `
    <p class="page-sub">Investment statistics, live positions and per-plan interest settings.</p>
    <div class="grid g4">
      <div class="stat brand"><div class="label">Investors</div><div class="value">${s.investors || 0}</div></div>
      <div class="stat"><div class="label">Total invested</div><div class="value">${usd(s.totalInvested)}</div></div>
      <div class="stat"><div class="label">Active value</div><div class="value">${usd(s.activeValue)}</div></div>
      <div class="stat"><div class="label">Active · Completed</div><div class="value">${s.activeCount || 0} · ${s.completedCount || 0}</div></div>
    </div>
    <div class="grid g4">
      <div class="stat"><div class="label">Today's investments</div><div class="value">${usd(s.todayInvested)}</div></div>
      <div class="stat"><div class="label">Today's maturities</div><div class="value">${usd(s.todayMaturing)}</div></div>
      <div class="stat"><div class="label">Expected payout (active)</div><div class="value">${usd(s.expectedPayout)}</div></div>
      <div class="stat"><div class="label">Plans</div><div class="value">${plans.length}</div></div>
    </div>

    <div class="panel">
      <h3>Interest settings</h3>
      <p class="p-sub">Annual rate per plan (0–100%). Changes apply to <b>new</b> investments only — existing ones keep the rate they opened at.</p>
      <form id="rateForm"><div class="grid g3">
        ${plans.map((p) => `<div class="field"><label>${esc(p.name)}</label><input type="number" min="0" max="100" step="0.1" data-plan="${esc(p.id)}" value="${rates[p.id] != null ? rates[p.id] : p.rate}"></div>`).join('')}
      </div><button class="btn btn-primary" type="submit">Save changes</button></form>
    </div>

    <div class="panel"><h3>All investments</h3><table class="table">
      <thead><tr><th>ID</th><th>Investor</th><th>Plan</th><th class="num">Principal</th><th class="num">Rate</th><th class="num">Return</th><th>Maturity</th><th>Status</th></tr></thead>
      <tbody>${invs.length ? invs.map((i) => `<tr>
        <td>${esc(i.id)}</td>
        <td>${esc(i.user ? i.user.username : '—')}<br><span class="p-sub">${esc(i.user ? i.user.email : '')}</span></td>
        <td>${esc(i.planName)}</td>
        <td class="num">${usd(i.principal)}</td>
        <td class="num">${i.interestRate}%</td>
        <td class="num">${usd(i.expectedReturn)}</td>
        <td class="p-sub">${new Date(i.maturityDate).toLocaleDateString()}</td>
        <td><span class="st ${sc(i.status)}">${i.status === 'completed' ? 'Completed' : 'Running'}</span></td>
      </tr>`).join('') : `<tr><td colspan="8" class="p-sub">No investments yet.</td></tr>`}</tbody>
    </table></div>`;

  document.getElementById('rateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    document.querySelectorAll('#rateForm input[data-plan]').forEach((el) => { body[el.dataset.plan] = el.value; });
    const { ok, data: d } = await api('/api/admin/investment-rates', body);
    if (ok) { toast(d.message || 'Saved'); tInvestments(); } else toast(d.error || 'Failed', 'error');
  });
}

async function tSupport() {
  loading();
  const { data } = await apiGet('/api/admin/support');
  const t = data.tickets || [];
  content().innerHTML = `
    <p class="page-sub">${t.length} support message(s). Tap <b>Reply</b> to email the member back.${data.emailReady === false ? ' <span class="st pending">Email not set up — replies are saved but not sent.</span>' : ''}</p>
    <div class="panel">${t.length ? t.map((x) => `
      <div style="padding:14px 0;border-bottom:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(x.subject || '(no subject)')}</b><span class="p-sub">${new Date(x.createdAt).toLocaleString()}</span></div>
        <p class="p-sub" style="margin:4px 0">from ${esc(x.email)}</p>
        <p style="margin:0 0 8px">${esc(x.message)}</p>
        ${(x.replies || []).map((r) => `<div style="margin:6px 0;padding:9px 12px;background:var(--green-pale);border:1px solid var(--line);border-radius:10px"><b>Your reply</b> <span class="p-sub">· ${new Date(r.at).toLocaleString()}</span><br>${esc(r.message)}</div>`).join('')}
        <button class="btn btn-ghost auto reply-btn" data-id="${esc(x.id)}">↩ Reply</button>
        <div class="reply-box" data-id="${esc(x.id)}" style="display:none;margin-top:8px">
          <textarea class="reply-text" rows="3" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit" placeholder="Type your reply to ${esc(x.email)}…"></textarea>
          <button class="btn btn-primary auto reply-send" data-id="${esc(x.id)}" style="margin-top:6px">Send reply</button>
        </div>
      </div>`).join('') : `<p class="p-sub">No support messages yet.</p>`}</div>`;
  content().querySelectorAll('.reply-btn').forEach((b) => b.addEventListener('click', () => {
    const box = content().querySelector('.reply-box[data-id="' + b.dataset.id + '"]');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
    if (box.style.display === 'block') box.querySelector('.reply-text').focus();
  }));
  content().querySelectorAll('.reply-send').forEach((b) => b.addEventListener('click', async () => {
    const box = content().querySelector('.reply-box[data-id="' + b.dataset.id + '"]');
    const msg = box.querySelector('.reply-text').value.trim();
    if (!msg) return toast('Type a reply first', 'error');
    b.disabled = true;
    const { ok, data: d } = await api('/api/admin/support/' + b.dataset.id + '/reply', { message: msg });
    if (ok) { toast(d.message || 'Reply sent'); tSupport(); } else { b.disabled = false; toast(d.error || 'Failed', 'error'); }
  }));
}

boot();

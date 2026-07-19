/* Gweno standalone admin panel. Talks to its own /api/* on the same origin. */
let TAB = 'overview';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => '$' + (Number(n) || 0).toFixed(2);
const kes = (n) => Math.round(Number(n) || 0).toLocaleString() + ' KES';
const fdate = (d) => (d ? new Date(d).toLocaleString() : '—');
const app = () => document.getElementById('app');

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let data = {}; try { data = await r.json(); } catch (_) {}
  return { ok: r.ok, status: r.status, data };
}
const get = (p) => api(p);
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) });
const del = (p) => api(p, { method: 'DELETE' });

function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.textContent = msg; document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2800);
}

const TABS = [
  ['overview', 'Overview'], ['users', 'Users'], ['submissions', 'Submissions'],
  ['withdrawals', 'Withdrawals'], ['investments', 'Investments'], ['deposits', 'Deposits'], ['support', 'Support'],
];

async function boot() {
  const { data } = await get('/api/session');
  if (!data.authed) return renderLogin(!data.configured);
  renderShell();
  route();
}

function renderLogin(notConfigured) {
  app().innerHTML = `
    <div class="center"><div class="panel login">
      <div class="brand" style="margin-bottom:6px"><span class="dot"></span> gweno <span class="tag">· admin</span></div>
      <h3 style="margin:2px 0">Admin sign-in</h3>
      <p class="p-sub">Private — this is not a customer account.</p>
      ${notConfigured ? '<div class="msg error show">Set ADMIN_USERNAME and ADMIN_PASSWORD in this app\'s environment, then redeploy.</div>' : ''}
      <div class="msg" id="msg"></div>
      <form id="f">
        <div class="field"><label>Username</label><input id="u" autocomplete="username"></div>
        <div class="field"><label>Password</label><input id="p" type="password" autocomplete="current-password"></div>
        <button class="btn btn-primary" style="width:100%" type="submit">Sign in</button>
      </form>
    </div></div>`;
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { ok, data } = await post('/api/login', { username: document.getElementById('u').value, password: document.getElementById('p').value });
    if (ok) boot();
    else { const m = document.getElementById('msg'); m.className = 'msg error show'; m.textContent = data.error || 'Sign-in failed'; }
  });
}

function renderShell() {
  app().innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="dot"></span> gweno <span class="tag">· admin</span></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm" id="refresh">Refresh</button>
        <button class="btn btn-sm" id="signout">Sign out</button>
      </div>
    </header>
    <div class="wrap">
      <div class="tabs" id="tabs">${TABS.map(([k, l]) => `<button class="tab ${k === TAB ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="content"></div>
    </div>`;
  document.getElementById('signout').onclick = async () => { await post('/api/logout'); boot(); };
  document.getElementById('refresh').onclick = () => route();
  document.querySelectorAll('.tab').forEach((b) => b.onclick = () => {
    TAB = b.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === TAB));
    route();
  });
}
const content = () => document.getElementById('content');
const loading = () => { content().innerHTML = '<p class="p-sub">Loading…</p>'; };
function guard(r) { if (r.status === 401) { boot(); return false; } return true; }

function route() { ({ overview: tOverview, users: tUsers, submissions: tSubs, withdrawals: tWd, investments: tInv, deposits: tDep, support: tSup }[TAB] || tOverview)(); }

async function tOverview() {
  loading();
  const { data: d, ...r } = await get('/api/overview'); if (!guard(r)) return;
  const s = d.submissions || {}, w = d.withdrawals || {}, i = d.investments || {}, dep = d.deposits || {};
  content().innerHTML = `
    <p class="p-sub">Signed in as admin <b>${esc(d.admin || '')}</b>. Managing the live Gweno database.</p>
    <div class="grid g4">
      <div class="stat brand"><div class="label">Users</div><div class="value">${d.users || 0}</div></div>
      <div class="stat"><div class="label">Suspended</div><div class="value">${d.suspended || 0}</div></div>
      <div class="stat"><div class="label">Pending submissions</div><div class="value">${s.pending || 0}</div></div>
      <div class="stat"><div class="label">Pending withdrawals</div><div class="value">${w.pending || 0}</div></div>
    </div>
    <div class="grid g4">
      <div class="stat"><div class="label">Withdrawals to pay</div><div class="value">${usd(w.valueUSD)}</div></div>
      <div class="stat"><div class="label">Active investments</div><div class="value">${i.active || 0}</div></div>
      <div class="stat"><div class="label">Invested (principal)</div><div class="value">${usd(i.principalUSD)}</div></div>
      <div class="stat"><div class="label">Support tickets</div><div class="value">${d.support || 0}</div></div>
    </div>
    <div class="panel">
      <h3>Export data</h3>
      <p class="p-sub">Download a snapshot of users, submissions, withdrawals, deposits, investments and support (no passwords or tokens).</p>
      <a class="btn btn-primary" href="/api/export" download>Download JSON export</a>
    </div>`;
}

async function tUsers() {
  loading();
  const { data: d, ...r } = await get('/api/users'); if (!guard(r)) return;
  const u = d.users || [];
  content().innerHTML = `
    <p class="p-sub">${u.length} user(s). You can see how each person signed up, suspend/hold an account, or delete it.</p>
    <div class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>Name / Email</th><th>Username</th><th>Signed up via</th><th class="num">KES</th><th class="num">USD</th><th class="num">Refs</th><th>Country</th><th>Joined</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${u.length ? u.map((x) => `<tr>
        <td><b>${esc(x.name || '—')}</b><br><span class="mono">${esc(x.email)}</span></td>
        <td>${esc(x.username || '—')}</td>
        <td><span class="st prov">${esc(x.provider)}</span></td>
        <td class="num">${kes(x.balanceKES)}</td>
        <td class="num">${usd(x.usd)}</td>
        <td class="num">${x.referralCount}</td>
        <td>${esc(x.country || '—')}${x.phone ? '<br><span class="mono">' + esc(x.phone) + '</span>' : ''}</td>
        <td class="muted">${new Date(x.createdAt).toLocaleDateString()}</td>
        <td>${x.isAdmin ? '<span class="st approved">admin</span> ' : ''}${x.suspended ? '<span class="st rejected">suspended</span>' : '<span class="st approved">active</span>'}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm susp" data-id="${x.id}">${x.suspended ? 'Unsuspend' : 'Suspend'}</button>
          <button class="btn btn-sm btn-danger delu" data-id="${x.id}" data-name="${esc(x.email)}">Delete</button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="10" class="p-sub">No users yet.</td></tr>'}</tbody>
    </table></div></div>`;
  content().querySelectorAll('.susp').forEach((b) => b.onclick = async () => {
    const { ok, data } = await post('/api/users/' + b.dataset.id + '/suspend');
    if (ok) { toast(data.suspended ? 'Account suspended' : 'Account unsuspended'); tUsers(); } else toast(data.error || 'Failed', 'error');
  });
  content().querySelectorAll('.delu').forEach((b) => b.onclick = async () => {
    if (!confirm(`Permanently delete ${b.dataset.name} and all their data? This cannot be undone.`)) return;
    const { ok, data } = await del('/api/users/' + b.dataset.id);
    if (ok) { toast('Account deleted'); tUsers(); } else toast(data.error || 'Failed', 'error');
  });
}

async function tSubs() {
  loading();
  const { data: d, ...r } = await get('/api/submissions'); if (!guard(r)) return;
  const s = d.submissions || [];
  content().innerHTML = `
    <p class="p-sub">Approve or reject task submissions. Approving credits the member's USD balance.</p>
    <div class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>User</th><th>Task</th><th class="num">Reward</th><th>Proof</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${s.length ? s.map((m) => `<tr>
        <td>${esc(m.user ? m.user.username : '—')}<br><span class="mono">${esc(m.user ? m.user.email : '')}</span></td>
        <td>${esc(m.taskTitle || m.taskId || '—')}</td>
        <td class="num">${usd(m.reward)}</td>
        <td class="muted" style="max-width:240px">${esc(m.proof || '—')}</td>
        <td><span class="st ${m.status}">${esc(m.status)}</span></td>
        <td><div class="row-actions">${m.status !== 'approved' ? `<button class="btn btn-sm dec" data-id="${m.id}" data-d="approved">Approve</button>` : ''}${m.status !== 'rejected' ? `<button class="btn btn-sm dec" data-id="${m.id}" data-d="rejected">Reject</button>` : ''}</div></td>
      </tr>`).join('') : '<tr><td colspan="6" class="p-sub">No submissions yet.</td></tr>'}</tbody>
    </table></div></div>`;
  content().querySelectorAll('.dec').forEach((b) => b.onclick = async () => {
    const { ok, data } = await post('/api/submissions/' + b.dataset.id + '/decision', { decision: b.dataset.d });
    if (ok) { toast('Marked ' + b.dataset.d); tSubs(); } else toast(data.error || 'Failed', 'error');
  });
}

async function tWd() {
  loading();
  const { data: d, ...r } = await get('/api/redemptions'); if (!guard(r)) return;
  const rs = d.redemptions || [];
  const sc = (s) => (/paid/i.test(s) ? 'approved' : /failed/i.test(s) ? 'rejected' : 'pending');
  content().innerHTML = `
    <p class="p-sub">Verify withdrawals before releasing them. <b>Mark paid</b> = you've sent the money. <b>Fail</b> = reject &amp; refund the held balance.</p>
    <div class="panel"><div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>User</th><th class="num">Amount</th><th>Method</th><th>Destination</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${rs.length ? rs.map((r2) => `<tr>
        <td class="muted">${fdate(r2.createdAt)}</td>
        <td>${esc(r2.user ? r2.user.username : '—')}<br><span class="mono">${esc(r2.user ? r2.user.email : '')}</span></td>
        <td class="num">${r2.currency === 'KES' ? kes(r2.amount) : usd(r2.amount)}${r2.amountUSD != null && r2.currency === 'KES' ? '<br><span class="muted">≈ ' + usd(r2.amountUSD) + '</span>' : ''}</td>
        <td>${esc(r2.method)}</td>
        <td class="muted" style="max-width:240px">${esc(r2.destination || '—')}</td>
        <td><span class="st ${sc(r2.status)}">${esc(r2.status)}</span></td>
        <td><div class="row-actions">${!/paid/i.test(r2.status) ? `<button class="btn btn-sm mk" data-id="${r2.id}" data-s="Paid">Mark paid</button>` : ''}${!/failed/i.test(r2.status) ? `<button class="btn btn-sm btn-danger mk" data-id="${r2.id}" data-s="Failed">Fail</button>` : ''}</div></td>
      </tr>`).join('') : '<tr><td colspan="7" class="p-sub">No withdrawals yet.</td></tr>'}</tbody>
    </table></div></div>`;
  content().querySelectorAll('.mk').forEach((b) => b.onclick = async () => {
    if (b.dataset.s === 'Failed' && !confirm('Reject this withdrawal and refund the balance?')) return;
    const { ok, data } = await post('/api/redemptions/' + b.dataset.id + '/mark', { status: b.dataset.s });
    if (ok) { toast('Marked ' + b.dataset.s); tWd(); } else toast(data.error || 'Failed', 'error');
  });
}

async function tInv() {
  loading();
  const { data: d, ...r } = await get('/api/investments'); if (!guard(r)) return;
  const invs = d.investments || [], st = d.stats || {}, rates = d.rates || {};
  const sc = (s) => (s === 'completed' ? 'approved' : s === 'active' ? 'pending' : 'rejected');
  content().innerHTML = `
    <div class="grid g4">
      <div class="stat brand"><div class="label">Total investments</div><div class="value">${st.total || 0}</div></div>
      <div class="stat"><div class="label">Active</div><div class="value">${st.active || 0}</div></div>
      <div class="stat"><div class="label">Principal</div><div class="value">${usd(st.principalUSD)}</div></div>
      <div class="stat"><div class="label">—</div><div class="value"></div></div>
    </div>
    <div class="panel">
      <h3>Interest rates (annual %)</h3>
      <p class="p-sub">Applies to new investments only; existing ones keep their rate.</p>
      <form id="rf" class="grid g4">
        ${['starter', 'growth', 'premium'].map((k) => `<div class="field"><label>${k}</label><input type="number" min="0" max="100" step="0.1" data-k="${k}" value="${rates[k] != null ? rates[k] : ''}" placeholder="rate %"></div>`).join('')}
        <div class="field"><label>&nbsp;</label><button class="btn btn-primary" type="submit">Save rates</button></div>
      </form>
    </div>
    <div class="panel"><h3>All investments</h3><div class="table-wrap"><table class="table">
      <thead><tr><th>ID</th><th>User</th><th>Plan</th><th class="num">Principal</th><th class="num">Rate</th><th class="num">Return</th><th>Status</th><th>Maturity</th></tr></thead>
      <tbody>${invs.length ? invs.map((i) => `<tr>
        <td class="mono">${esc(i.id)}</td>
        <td>${esc(i.user ? i.user.username : '—')}<br><span class="mono">${esc(i.user ? i.user.email : '')}</span></td>
        <td>${esc(i.planName || i.planId)}</td>
        <td class="num">${usd(i.principal)}</td>
        <td class="num">${i.interestRate}%</td>
        <td class="num">${usd(i.expectedReturn)}</td>
        <td><span class="st ${sc(i.status)}">${esc(i.status)}</span></td>
        <td class="muted">${i.maturityDate ? new Date(i.maturityDate).toLocaleDateString() : '—'}</td>
      </tr>`).join('') : '<tr><td colspan="8" class="p-sub">No investments yet.</td></tr>'}</tbody>
    </table></div></div>`;
  document.getElementById('rf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {}; document.querySelectorAll('#rf input[data-k]').forEach((el) => { if (el.value !== '') body[el.dataset.k] = el.value; });
    const { ok, data } = await post('/api/investment-rates', body);
    if (ok) { toast('Rates saved'); tInv(); } else toast(data.error || 'Failed', 'error');
  });
}

async function tDep() {
  loading();
  const { data: d, ...r } = await get('/api/deposits'); if (!guard(r)) return;
  const deps = d.deposits || [];
  const sc = (s) => (/success|paid/i.test(s) ? 'approved' : /fail/i.test(s) ? 'rejected' : 'pending');
  content().innerHTML = `
    <div class="panel"><h3>Deposits</h3><div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>User</th><th class="num">Amount</th><th>Method</th><th>Status</th></tr></thead>
      <tbody>${deps.length ? deps.map((x) => `<tr>
        <td class="muted">${fdate(x.createdAt)}</td>
        <td>${esc(x.user ? x.user.username : '—')}<br><span class="mono">${esc(x.user ? x.user.email : '')}</span></td>
        <td class="num">${x.currency === 'USD' ? usd(x.amount) : kes(x.amount)}</td>
        <td>${esc(x.method || 'M-Pesa')}</td>
        <td><span class="st ${sc(x.status)}">${esc(x.status)}</span></td>
      </tr>`).join('') : '<tr><td colspan="5" class="p-sub">No deposits yet.</td></tr>'}</tbody>
    </table></div></div>`;
}

async function tSup() {
  loading();
  const { data: d, ...r } = await get('/api/support'); if (!guard(r)) return;
  const t = d.tickets || [];
  content().innerHTML = `
    <div class="panel"><h3>Support messages (${t.length})</h3>
      ${t.length ? t.map((x) => `<div style="padding:12px 0;border-bottom:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;gap:10px"><b>${esc(x.subject || '(no subject)')}</b><span class="muted">${fdate(x.createdAt)}</span></div>
        <div class="mono">${esc(x.email || '')}</div>
        <p style="margin:6px 0 0">${esc(x.message || '')}</p>
      </div>`).join('') : '<p class="p-sub">No support messages yet.</p>'}
    </div>`;
}

boot();

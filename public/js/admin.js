/* Gweno admin panel, standalone page, admins only. Uses /js/auth.js (api). */
let ADMIN = null;
let TAB = 'overview';
let ROLE = 'admin';   // 'admin' (full) or 'finance' (money operations only)
// Tabs a finance user may see (money operations only).
const FINANCE_TABS = ['overview', 'users', 'withdrawals', 'deposits', 'investments'];

const usd = (n) => '$' + (Number(n) || 0).toFixed(2);
const kes = (n) => Math.round(Number(n) || 0).toLocaleString() + ' KES';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Professional, user-facing status names used consistently across the app.
const STATUS_LABEL = { pending: 'Pending Review', approved: 'Approved', rejected: 'Rejected', correction: 'Correction Required', completed: 'Completed' };
const statusLabel = (s) => STATUS_LABEL[s] || s;
async function apiGet(p) { const r = await fetch(p); let d = {}; try { d = await r.json(); } catch (_) {} return { ok: r.ok, status: r.status, data: d }; }
function toast(msg, type = 'ok') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  document.body.appendChild(t); requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3000);
}

const TABS = [['overview', 'Overview'], ['submissions', 'Submissions'], ['questionnaires', 'Questionnaires'], ['applications', 'Applications'], ['share', 'Social Share'], ['emails', 'Email log'], ['audit', 'Audit log'], ['users', 'Users'], ['rewards', 'Rewards'], ['sendemail', 'Send Email'], ['broadcast', 'Broadcast'], ['investments', 'Investments'], ['deposits', 'Deposits'], ['withdrawals', 'Withdrawals'], ['support', 'Support']];

// ---- Reusable client-side pagination for admin tables ----
const PAGE_STATE = {};        // key -> current page (1-based); reset to 1 on tab switch
const PAGE_SIZE = 25;
function paginate(key, items, per = PAGE_SIZE) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / per));
  let page = PAGE_STATE[key] || 1;
  page = Math.min(Math.max(1, page), pages);
  PAGE_STATE[key] = page;
  const from = (page - 1) * per;
  return { rows: items.slice(from, from + per), page, pages, total, from, per };
}
// A pager bar (hidden when everything fits on one page). Place it after the table.
function pagerBar(key, p) {
  if (p.total <= p.per) return '';
  return `<div class="pager" data-pager="${esc(key)}" style="display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;margin-top:12px">
    <span class="p-sub">${p.from + 1}–${Math.min(p.from + p.per, p.total)} of ${p.total}</span>
    <button class="btn btn-ghost auto pg-prev" style="width:auto"${p.page <= 1 ? ' disabled' : ''}>← Prev</button>
    <span class="p-sub">Page ${p.page} / ${p.pages}</span>
    <button class="btn btn-ghost auto pg-next" style="width:auto"${p.page >= p.pages ? ' disabled' : ''}>Next →</button>
  </div>`;
}
// Wire the pager's buttons to change the page and re-run the table's render().
function wirePager(key, p, rerender) {
  const bar = content().querySelector(`[data-pager="${key}"]`);
  if (!bar) return;
  const go = (n) => { PAGE_STATE[key] = Math.min(Math.max(1, n), p.pages); rerender(); };
  const prev = bar.querySelector('.pg-prev'); if (prev) prev.addEventListener('click', () => go(p.page - 1));
  const next = bar.querySelector('.pg-next'); if (next) next.addEventListener('click', () => go(p.page + 1));
}

// Lightweight modal for admin forms (reuses .modal styles from app.css).
function adminModal(html, cls) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${cls || ''}">${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.classList.contains('close')) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}

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
  ROLE = r.data.role || 'admin';
  if (ROLE === 'finance' && !FINANCE_TABS.includes(TAB)) TAB = 'overview';
  renderShell();
  route();
}

function renderLogin(notConfigured) {
  document.getElementById('app').innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;padding:20px">
      <div class="panel" style="width:100%;max-width:380px">
        <a class="brand" href="/admin.html" style="display:inline-flex;margin-bottom:10px"><span class="dot"></span> gweno <span style="font-size:13px;color:var(--muted)">· admin</span></a>
        <h3 style="margin:2px 0">Staff sign-in</h3>
        <p class="p-sub">Private access for admin & finance — not a client account.</p>
        ${notConfigured ? `<p class="msg error show" style="display:block">Set ADMIN_USERNAME and ADMIN_PASSWORD (and optionally FINANCE_USERNAME/FINANCE_PASSWORD) in .env, then restart.</p>` : ''}
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
  const tabs = ROLE === 'finance' ? TABS.filter(([k]) => FINANCE_TABS.includes(k)) : TABS;
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <a class="brand" href="/admin.html"><span class="dot"></span> gweno <span style="font-size:13px;color:var(--muted)">· ${ROLE === 'finance' ? 'finance' : 'admin'}</span></a>
      <div class="top-right">
        <button class="theme-toggle" id="themeBtn" title="Toggle dark mode" aria-label="Toggle dark mode">${curTheme() === 'dark' ? THEME_ICONS.sun : THEME_ICONS.moon}</button>
        <a class="btn btn-ghost auto" href="/" target="_blank">View site</a>
        <button class="btn btn-ghost auto" id="signout">Sign out</button>
      </div>
    </header>
    <main class="view">
      ${ROLE === 'finance' ? `<p class="p-sub" style="margin:0 0 10px">Signed in as <b>finance</b> — you can initiate and release payouts, and view deposits & investments.</p>` : ''}
      <div class="tabs" id="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === TAB ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="content"></div>
    </main>`;
  document.getElementById('signout').addEventListener('click', async () => { await api('/api/admin/logout', {}); boot(); });
  const themeBtn = document.getElementById('themeBtn'); if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    TAB = b.dataset.tab;
    PAGE_STATE[TAB] = 1;   // start each tab on page 1
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === TAB));
    route();
  }));
}
const content = () => document.getElementById('content');
// Skeleton loader (shimmer) instead of a "Loading…" line, matches the members area.
const loading = () => { content().innerHTML = `
  <div class="sk sk-line" style="width:32%;height:15px;margin-bottom:18px"></div>
  <div class="grid g4"><div class="sk sk-stat"></div><div class="sk sk-stat"></div><div class="sk sk-stat"></div><div class="sk sk-stat"></div></div>
  <div class="panel">
    <div class="sk sk-line" style="width:26%;margin-bottom:14px"></div>
    <div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div><div class="sk sk-row"></div>
  </div>`; };

function route() {
  if (ROLE === 'finance' && !FINANCE_TABS.includes(TAB)) TAB = 'overview';
  ({ overview: tOverview, submissions: tSubmissions, questionnaires: tQuestionnaires, applications: tApplications, share: tShareReview, emails: tEmails, audit: tAudit, users: tUsers, rewards: tRewards, sendemail: tSendEmail, broadcast: tBroadcast, investments: tInvestments, deposits: tDeposits, withdrawals: tWithdrawals, support: tSupport }[TAB] || tOverview)();
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

// Render submitted proof: clickable when it's a link, plain (wrapped) text otherwise.
function proofCell(p) {
  const s = String(p == null ? '' : p).trim();
  if (!s) return '<span class="p-sub">—</span>';
  if (/^https?:\/\//i.test(s)) return `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s)}</a>`;
  return esc(s);
}

async function tSubmissions() {
  loading();
  const { data } = await apiGet('/api/admin/submissions');
  const subs = data.submissions || [];
  const render = () => {
    const p = paginate('submissions', subs);
    content().innerHTML = `
    <p class="page-sub">Every task submission. Click <b>Review</b> to see the full task and the user's response side by side, then Approve or Reject. Approving credits the user's USD balance.</p>
    <div class="panel"><table class="table">
      <thead><tr><th>User</th><th>Task</th><th class="num">Reward</th><th>Answer preview</th><th>Submitted</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${subs.length ? p.rows.map((sm) => `
        <tr>
          <td>${esc(sm.user ? sm.user.username : '—')}<br><span class="p-sub">${esc(sm.user ? sm.user.email : '')}</span></td>
          <td>${esc(sm.task ? sm.task.title : sm.taskId)}${sm.task ? `<br><span class="p-sub">${esc(sm.task.category || '')}</span>` : ''}</td>
          <td class="num">${usd(sm.reward)}</td>
          <td class="p-sub" style="max-width:240px;max-height:60px;overflow:hidden;word-break:break-word">${proofCell(sm.proof)}${sm.dispute ? `<br><b style="color:var(--danger)">Dispute:</b> ${esc(sm.dispute.message)}` : ''}</td>
          <td class="p-sub">${sm.createdAt ? new Date(sm.createdAt).toLocaleString() : '—'}</td>
          <td><span class="st ${sm.status}">${statusLabel(sm.status)}</span>${(sm.status === 'correction' || sm.status === 'rejected') && sm.reviewNote ? `<br><span class="p-sub">${esc(sm.reviewNote)}</span>` : ''}</td>
          <td><button class="btn btn-primary auto adm-review" data-id="${sm.id}">Review</button></td>
        </tr>`).join('') : `<tr><td colspan="7" class="p-sub">No submissions yet.</td></tr>`}</tbody>
    </table>${pagerBar('submissions', p)}</div>`;
    content().querySelectorAll('.adm-review').forEach((b) => b.addEventListener('click', () => openReviewSubmission(subs.find((x) => x.id === b.dataset.id))));
    wirePager('submissions', p, render);
  };
  render();
}

// Approve / reject / request-correction. Surfaces whether the decision email sent.
async function decideSubmission(id, decision, note) {
  const { ok, data: d } = await api('/api/admin/submissions/' + id + '/decision', { decision, note: note || '' });
  if (!ok) return toast(d.error || 'Failed', 'error');
  const em = d.email || {};
  const failed = em.status === 'Failed';
  toast(`${statusLabel(decision)} · email ${em.status || '—'}${failed ? ' — resend from Email log' : ''}`, failed ? 'error' : 'ok');
  tSubmissions();
}

// Human-readable answer requirements for a task (so the admin can verify the response).
function taskRequirements(t) {
  if (!t) return [];
  const PT = { text: 'Written answer', data: 'Data rows (comma/colon separated)', url: 'A valid link (URL)', photo: 'An uploaded image link', social: 'A social profile/post link or @username', code: 'An exact confirmation code', email: 'A valid email address', match: 'Must closely match the given text' };
  const out = ['Proof type: ' + (PT[t.proofType] || t.proofType || 'text')];
  if (t.minWords) out.push('Minimum words: ' + t.minWords);
  if (t.minChars) out.push('Minimum characters: ' + t.minChars);
  if (t.minLines) out.push('Minimum rows: ' + t.minLines);
  if (t.expected) out.push('Expected answer: “' + t.expected + '”');
  if (t.code) out.push('Required code: ' + t.code);
  return out;
}

// Full side-by-side review: the task assigned vs. the user's actual response. Approve is
// disabled until the admin confirms they've reviewed both (prevents rubber-stamping).
function openReviewSubmission(sm) {
  if (!sm) return;
  const t = sm.task || {};
  const proof = String(sm.proof == null ? '' : sm.proof).trim();
  const proofHtml = !proof ? '<span class="p-sub">— no answer was submitted —</span>'
    : /^https?:\/\//i.test(proof) ? `<a href="${esc(proof)}" target="_blank" rel="noopener">${esc(proof)}</a>`
    : `<div class="review-proof">${esc(proof)}</div>`;
  const reqs = taskRequirements(t);
  const bg = adminModal(`
    <button class="close">×</button>
    <h3>Review submission</h3>
    <div class="review-grid">
      <div class="review-col">
        <h4>📋 Task assigned</h4>
        <p class="review-title">${esc(t.title || sm.taskId)}</p>
        <p class="p-sub">${esc(t.category || '')}${t.difficulty ? ' · ' + esc(t.difficulty) : ''} · reward ${usd(sm.reward)}</p>
        ${t.description ? `<p>${esc(t.description)}</p>` : ''}
        ${Array.isArray(t.instructions) && t.instructions.length ? `<p class="review-label">What the task asked:</p><ol class="instr">${t.instructions.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p class="p-sub">(Original task details are no longer available.)</p>'}
        ${reqs.length ? `<p class="review-label">Answer requirements:</p><ul class="review-reqs">${reqs.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="review-col">
        <h4>✍️ User's response</h4>
        <p class="p-sub">${esc(sm.user ? sm.user.username : '')}${sm.user && sm.user.email ? ' · ' + esc(sm.user.email) : ''}</p>
        <p class="p-sub">Submitted ${sm.createdAt ? new Date(sm.createdAt).toLocaleString() : '—'} · <span class="st ${sm.status}">${statusLabel(sm.status)}</span></p>
        <p class="review-label">Their answer / proof:</p>
        ${proofHtml}
        ${sm.dispute ? `<p class="review-label" style="color:var(--danger)">Dispute raised:</p><div class="review-proof">${esc(sm.dispute.message)}</div>` : ''}
      </div>
    </div>
    <label class="review-ack"><input type="checkbox" id="revAck"> I have reviewed the full task and the user's response, and the answer is relevant and complete.</label>
    <div class="review-actions">
      ${sm.status !== 'approved' ? `<button class="btn btn-primary" id="revApprove" disabled>Approve &amp; pay ${usd(sm.reward)}</button>` : ''}
      ${sm.status !== 'correction' ? `<button class="btn btn-ghost" id="revCorrect">Request correction</button>` : ''}
      ${sm.status !== 'rejected' ? `<button class="btn btn-ghost" id="revReject">Reject</button>` : ''}
    </div>`, 'modal-wide');
  const ack = bg.querySelector('#revAck');
  const approveBtn = bg.querySelector('#revApprove');
  if (approveBtn) ack.addEventListener('change', () => { approveBtn.disabled = !ack.checked; });
  if (approveBtn) approveBtn.addEventListener('click', () => { if (!ack.checked) return; bg.remove(); decideSubmission(sm.id, 'approved'); });
  const rej = bg.querySelector('#revReject'); if (rej) rej.addEventListener('click', () => { bg.remove(); decideSubmission(sm.id, 'rejected'); });
  const corr = bg.querySelector('#revCorrect'); if (corr) corr.addEventListener('click', () => { bg.remove(); openCorrection(sm.id); });
}

// The "Reason for Correction" is composed by the admin and emailed to the member.
function openCorrection(id) {
  const bg = adminModal(`
    <button class="close">×</button>
    <h3>Request correction</h3>
    <p class="p-sub">The member receives an email with this reason and can then resubmit the task.</p>
    <form id="corrForm">
      <div class="field"><label>Reason for correction</label><textarea id="corrReason" rows="4" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;background:var(--bg-2);color:var(--text)" placeholder="Explain exactly what needs fixing…"></textarea></div>
      <button class="btn btn-primary" type="submit">Send correction request</button>
    </form>`);
  bg.querySelector('#corrForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const reason = bg.querySelector('#corrReason').value.trim();
    if (!reason) return toast('Please enter a reason for correction', 'error');
    bg.remove();
    decideSubmission(id, 'correction', reason);
  });
}

// ---- Social Share submissions (Share & Earn) ------------------------------
async function tShareReview() {
  loading();
  const { data } = await apiGet('/api/admin/share');
  const subs = data.submissions || [];
  const platName = { tiktok: '🎵 TikTok', whatsapp: '💬 WhatsApp' };
  const pending = subs.filter((s) => s.status === 'pending').length;
  const render = () => {
    const p = paginate('share', subs);
    content().innerHTML = `
    <p class="page-sub">Social-sharing proof from members. Open a screenshot to verify the share, then approve to credit <b>${usd(data.reward || 0.30)}</b>, or reject. ${pending ? `<b>${pending}</b> awaiting review.` : ''}</p>
    <div class="panel" style="overflow-x:auto"><table class="table">
      <thead><tr><th>User</th><th>Platform</th><th>Screenshot</th><th class="num">Reward</th><th>Submitted</th><th>IP</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${subs.length ? p.rows.map((s) => `
        <tr>
          <td>${esc(s.user ? s.user.username : 'User')}<br><span class="p-sub">${esc(s.user && s.user.email ? s.user.email : '')}</span></td>
          <td>${platName[s.platform] || esc(s.platform)}</td>
          <td><a href="${esc(s.imageUrl)}" target="_blank" rel="noopener" title="Open full size"><img class="sh-thumb" src="${esc(s.imageUrl)}" alt="screenshot" loading="lazy"></a></td>
          <td class="num">${usd(s.reward)}</td>
          <td class="p-sub">${s.createdAt ? new Date(s.createdAt).toLocaleString() : '—'}</td>
          <td class="p-sub">${esc(s.ip || '—')}</td>
          <td><span class="st ${s.status}">${statusLabel(s.status)}</span>${s.reviewNote ? `<br><span class="p-sub">${esc(s.reviewNote)}</span>` : ''}${s.reviewedBy ? `<br><span class="p-sub">by ${esc(s.reviewedBy)}</span>` : ''}</td>
          <td><div style="display:flex;gap:6px;flex-wrap:wrap">
            ${s.status !== 'approved' ? `<button class="btn btn-primary auto shr-approve" data-id="${s.id}">Approve</button>` : ''}
            ${s.status !== 'rejected' ? `<button class="btn btn-ghost auto shr-reject" data-id="${s.id}">Reject</button>` : ''}
          </div></td>
        </tr>`).join('') : `<tr><td colspan="8" class="p-sub">No share submissions yet.</td></tr>`}</tbody>
    </table>${pagerBar('share', p)}</div>`;
    content().querySelectorAll('.shr-approve').forEach((b) => b.addEventListener('click', () => openShareDecision(b.dataset.id, 'approved')));
    content().querySelectorAll('.shr-reject').forEach((b) => b.addEventListener('click', () => openShareDecision(b.dataset.id, 'rejected')));
    wirePager('share', p, render);
  };
  render();
}

async function decideShare(id, decision, note) {
  const { ok, data: d } = await api('/api/admin/share/' + id + '/decision', { decision, note: note || '' });
  if (!ok) return toast(d.error || 'Failed', 'error');
  toast(decision === 'approved' ? 'Approved — reward credited.' : 'Rejected.', 'ok');
  tShareReview();
}

// Confirm approve / reject with an optional review comment.
function openShareDecision(id, decision) {
  const approve = decision === 'approved';
  const bg = adminModal(`
    <button class="close">×</button>
    <h3>${approve ? 'Approve share' : 'Reject share'}</h3>
    <p class="p-sub">${approve ? 'This credits $0.30 to the member\'s wallet and notifies them.' : 'No payment is made. The member can share again and resubmit.'}</p>
    <form id="shrForm">
      <div class="field"><label>Review comment ${approve ? '(optional)' : '(optional, shown to the member)'}</label>
        <textarea id="shrNote" rows="3" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;background:var(--bg-2);color:var(--text)" placeholder="${approve ? 'e.g. Verified — thanks for sharing!' : 'e.g. The Gweno link is not visible in the screenshot.'}"></textarea></div>
      <button class="btn ${approve ? 'btn-primary' : 'btn-ghost'}" type="submit">${approve ? 'Approve & credit $0.30' : 'Reject submission'}</button>
    </form>`);
  bg.querySelector('#shrForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const note = bg.querySelector('#shrNote').value.trim();
    bg.remove();
    decideShare(id, decision, note);
  });
}

// ---- Questionnaire submissions (auto-scored, admin-approved) ----------------
async function tQuestionnaires() {
  loading();
  const { data } = await apiGet('/api/admin/questionnaires');
  const subs = data.submissions || [];
  const pending = subs.filter((s) => s.status === 'pending').length;
  const render = () => {
    const p = paginate('quiz', subs);
    content().innerHTML = `
      <p class="page-sub">Completed questionnaires (auto-scored). Approve to credit the reward + rotate a new questionnaire in for the member, or reject. ${pending ? `<b>${pending}</b> awaiting review.` : ''}</p>
      <div class="panel" style="overflow-x:auto"><table class="table">
        <thead><tr><th>User</th><th>Questionnaire</th><th>Tier</th><th class="num">Score</th><th class="num">Reward</th><th>Submitted</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${subs.length ? p.rows.map((s) => `
          <tr>
            <td>${esc(s.user ? s.user.username : 'User')}<br><span class="p-sub">${esc(s.user && s.user.email ? s.user.email : '')}</span></td>
            <td>${esc(s.title)}<br><span class="p-sub">${esc(s.category)}</span></td>
            <td>${esc(s.tier)}</td>
            <td class="num">${s.pct != null ? s.pct + '%' : '—'}${s.total ? `<br><span class="p-sub">${s.score}/${s.total}</span>` : ''}</td>
            <td class="num">${usd(s.reward)}</td>
            <td class="p-sub">${s.createdAt ? new Date(s.createdAt).toLocaleString() : '—'}</td>
            <td><span class="st ${s.status}">${statusLabel(s.status)}</span>${s.reviewNote ? `<br><span class="p-sub">${esc(s.reviewNote)}</span>` : ''}${s.reviewedBy ? `<br><span class="p-sub">by ${esc(s.reviewedBy)}</span>` : ''}</td>
            <td><div style="display:flex;gap:6px;flex-wrap:wrap">
              ${s.status !== 'approved' ? `<button class="btn btn-primary auto qz-approve" data-id="${s.id}">Approve</button>` : ''}
              ${s.status !== 'rejected' ? `<button class="btn btn-ghost auto qz-reject" data-id="${s.id}">Reject</button>` : ''}
            </div></td>
          </tr>`).join('') : `<tr><td colspan="8" class="p-sub">No questionnaire submissions yet.</td></tr>`}</tbody>
      </table>${pagerBar('quiz', p)}</div>`;
    content().querySelectorAll('.qz-approve').forEach((b) => b.addEventListener('click', () => decideQuiz(b.dataset.id, 'approved')));
    content().querySelectorAll('.qz-reject').forEach((b) => b.addEventListener('click', () => openQuizReject(b.dataset.id)));
    wirePager('quiz', p, render);
  };
  render();
}

async function decideQuiz(id, decision, note) {
  const { ok, data: d } = await api('/api/admin/questionnaires/' + id + '/decision', { decision, note: note || '' });
  if (!ok) return toast(d.error || 'Failed', 'error');
  toast(decision === 'approved' ? 'Approved — reward credited.' : 'Rejected.', 'ok');
  tQuestionnaires();
}

function openQuizReject(id) {
  const bg = adminModal(`
    <button class="close">×</button>
    <h3>Reject questionnaire</h3>
    <p class="p-sub">No payment is made. The member can retake this questionnaire.</p>
    <form id="qzrForm">
      <div class="field"><label>Reason (optional, shown to the member)</label>
        <textarea id="qzrNote" rows="3" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;background:var(--bg-2);color:var(--text)" placeholder="e.g. Score too low / answers look random."></textarea></div>
      <button class="btn btn-ghost" type="submit">Reject submission</button>
    </form>`);
  bg.querySelector('#qzrForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const note = bg.querySelector('#qzrNote').value.trim();
    bg.remove();
    decideQuiz(id, 'rejected', note);
  });
}

const EMAIL_TYPE = {
  approved: 'Task approved', rejected: 'Task rejected', correction: 'Correction requested',
  application_approved: 'Application approved', application_rejected: 'Application rejected',
  withdrawal_paid: 'Withdrawal paid', email_direct: 'Direct email', email_broadcast: 'Broadcast email',
};
const emailTypeLabel = (t) => EMAIL_TYPE[t] || String(t || '').replace(/_/g, ' ');
const CAN_RESEND = new Set(['approved', 'rejected', 'correction', 'application_approved', 'application_rejected']);

// Full log of every email the system/admin sent, with delivery status + resend.
async function tEmails() {
  loading();
  const { data } = await apiGet('/api/admin/emails');
  const list = data.emails || [];
  const render = () => {
    const p = paginate('emails', list);
    content().innerHTML = `
    <p class="page-sub">Every email sent from the platform — task decisions, withdrawal receipts, and direct/broadcast messages — with delivery status.</p>
    <div class="panel" style="overflow-x:auto"><table class="table">
      <thead><tr><th>When</th><th>Type</th><th>Subject / Task</th><th>User</th><th>To</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${list.length ? p.rows.map((e) => `
        <tr>
          <td class="p-sub">${new Date(e.createdAt).toLocaleString()}</td>
          <td>${esc(emailTypeLabel(e.type))}</td>
          <td class="p-sub">${esc(e.subject || e.taskTitle || e.taskId || '—')}</td>
          <td>${esc(e.username || e.userId || '—')}</td>
          <td class="p-sub">${esc(e.to || '—')}</td>
          <td><span class="st ${e.status === 'Sent' ? 'approved' : 'rejected'}">${esc(e.status)}</span>${e.error ? `<br><span class="p-sub">${esc(e.error)}</span>` : ''}</td>
          <td>${CAN_RESEND.has(e.type) ? `<button class="btn btn-ghost auto eresend" data-id="${esc(e.id)}">Resend</button>` : ''}</td>
        </tr>`).join('') : `<tr><td colspan="7" class="p-sub">No emails sent yet.</td></tr>`}</tbody>
    </table>${pagerBar('emails', p)}</div>`;
    content().querySelectorAll('.eresend').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      const { ok, data: d } = await api('/api/admin/emails/' + b.dataset.id + '/resend', {});
      if (ok) { const st = d.email ? d.email.status : '—'; toast('Resend: ' + st, st === 'Failed' ? 'error' : 'ok'); tEmails(); }
      else { b.disabled = false; toast(d.error || 'Failed', 'error'); }
    }));
    wirePager('emails', p, render);
  };
  render();
}

// Task applications + proposals. Approving emails the member that they can begin working.
async function tApplications() {
  loading();
  const { data } = await apiGet('/api/admin/applications');
  const apps = data.applications || [];
  const render = () => {
    const p = paginate('applications', apps);
    content().innerHTML = `
    <p class="page-sub">Task applications and the proposals members submitted. Approving emails them that they can begin working.</p>
    <div class="panel"><table class="table">
      <thead><tr><th>User</th><th>Task</th><th>Proposal</th><th>Status</th><th>Applied</th><th>Action</th></tr></thead>
      <tbody>${apps.length ? p.rows.map((a) => `
        <tr>
          <td>${esc(a.user ? a.user.username : '—')}<br><span class="p-sub">${esc(a.user ? a.user.email : '')}</span></td>
          <td>${esc(a.task ? a.task.title : a.taskId)}</td>
          <td class="p-sub" style="max-width:300px;word-break:break-word">${esc(a.proposal || '—')}</td>
          <td><span class="st ${a.status}">${statusLabel(a.status)}</span></td>
          <td class="p-sub">${a.createdAt ? new Date(a.createdAt).toLocaleString() : '—'}</td>
          <td><div style="display:flex;gap:6px;flex-wrap:wrap">
            ${a.status !== 'approved' ? `<button class="btn btn-primary auto appd" data-id="${a.id}" data-d="approved">Approve</button>` : ''}
            ${a.status !== 'rejected' ? `<button class="btn btn-ghost auto appd" data-id="${a.id}" data-d="rejected">Reject</button>` : ''}
          </div></td>
        </tr>`).join('') : `<tr><td colspan="6" class="p-sub">No applications yet.</td></tr>`}</tbody>
    </table>${pagerBar('applications', p)}</div>`;
    content().querySelectorAll('.appd').forEach((b) => b.addEventListener('click', async () => {
      const { ok, data: d } = await api('/api/admin/applications/' + b.dataset.id + '/decision', { decision: b.dataset.d });
      if (ok) { const em = d.email || {}; toast(`${statusLabel(b.dataset.d)} · email ${em.status || '—'}${em.status === 'Failed' ? ' — see Email log' : ''}`, em.status === 'Failed' ? 'error' : 'ok'); tApplications(); }
      else toast(d.error || 'Failed', 'error');
    }));
    wirePager('applications', p, render);
  };
  render();
}

// Read-only admin activity log.
async function tAudit() {
  loading();
  const { data } = await apiGet('/api/admin/audit');
  const log = data.audit || [];
  const detail = (a) => [
    a.amount ? usd(a.amount) : '', a.reason ? '“' + a.reason + '”' : '',
    a.subject ? '“' + a.subject + '”' : '', a.count != null ? `${a.sent}/${a.count} sent` : '',
    a.taskId ? 'task ' + a.taskId : '', a.redemptionId ? 'payout ' + a.redemptionId : '',
    a.applicationId ? 'app ' + a.applicationId : '', a.submissionId ? 'sub ' + a.submissionId : '',
  ].filter(Boolean).join(' · ');
  const render = () => {
    const p = paginate('audit', log);
    content().innerHTML = `
    <p class="page-sub">A record of every admin approval, payment and email — newest first.</p>
    <div class="panel" style="overflow-x:auto"><table class="table">
      <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>User</th><th>Details</th></tr></thead>
      <tbody>${log.length ? p.rows.map((a) => `
        <tr>
          <td class="p-sub">${new Date(a.createdAt).toLocaleString()}</td>
          <td>${esc(a.admin || '—')}</td>
          <td>${esc(String(a.action || '').replace(/_/g, ' '))}</td>
          <td>${esc(a.username || a.userId || '—')}</td>
          <td class="p-sub">${esc(detail(a) || '—')}</td>
        </tr>`).join('') : `<tr><td colspan="5" class="p-sub">No activity logged yet.</td></tr>`}</tbody>
    </table>${pagerBar('audit', p)}</div>`;
    wirePager('audit', p, render);
  };
  render();
}

let USERS_CACHE = [];
const USERS_STATE = { q: '', status: 'all', page: 1, per: 20 };
const inputStyle = 'padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg-2);color:var(--text)';

async function tUsers() {
  loading();
  const { data } = await apiGet('/api/admin/users');
  USERS_CACHE = data.users || [];
  USERS_STATE.page = 1;
  content().innerHTML = `
    <p class="page-sub">${USERS_CACHE.length} registered user(s). <b>Suspend</b> blocks sign-in · <b>Hold</b> pauses withdrawals & tasks · <b>Delete</b> removes the account. <a href="/api/admin/export" download>Download data export</a>.</p>
    <div class="panel" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <input id="uSearch" placeholder="Search name, email, username or ID…" style="flex:1;min-width:220px;${inputStyle}">
      <select id="uStatus" style="${inputStyle}">${[['all', 'All statuses'], ['active', 'Active'], ['suspended', 'Suspended'], ['hold', 'On hold']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <span class="p-sub" id="uCount"></span>
    </div>
    <div class="panel" style="overflow-x:auto"><table class="table">
      <thead><tr><th>Name</th><th>Email</th><th>Plan</th><th class="num">Wallet</th><th class="num">Earned</th><th class="num">Tasks</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody id="uBody"></tbody>
    </table></div>
    <div id="uPager" style="display:flex;gap:12px;align-items:center;justify-content:center;margin-top:4px"></div>`;
  const s = document.getElementById('uSearch');
  s.addEventListener('input', () => { USERS_STATE.q = s.value; USERS_STATE.page = 1; renderUsersTable(); });
  document.getElementById('uStatus').addEventListener('change', (e) => { USERS_STATE.status = e.target.value; USERS_STATE.page = 1; renderUsersTable(); });
  renderUsersTable();
}

function renderUsersTable() {
  const badges = (u) => `${u.isAdmin ? '<span class="st approved">admin</span> ' : ''}${u.suspended ? '<span class="st rejected">suspended</span> ' : ''}${u.held ? '<span class="st pending">on hold</span> ' : ''}${!u.suspended && !u.held ? '<span class="st approved">active</span>' : ''}`;
  const act = (a, u, label, extra) => `<button class="btn btn-ghost auto uact" data-a="${a}" data-id="${u.id}" data-email="${esc(u.email)}" data-kes="${u.balance}" data-usd="${u.usd}"${extra || ''}>${label}</button>`;
  const q = USERS_STATE.q.trim().toLowerCase();
  const list = USERS_CACHE.filter((u) => {
    if (USERS_STATE.status === 'active' && (u.suspended || u.held)) return false;
    if (USERS_STATE.status === 'suspended' && !u.suspended) return false;
    if (USERS_STATE.status === 'hold' && !u.held) return false;
    if (!q) return true;
    return [u.name, u.username, u.email, u.id].some((v) => String(v || '').toLowerCase().includes(q));
  });
  const pages = Math.max(1, Math.ceil(list.length / USERS_STATE.per));
  if (USERS_STATE.page > pages) USERS_STATE.page = pages;
  const from = (USERS_STATE.page - 1) * USERS_STATE.per;
  const items = list.slice(from, from + USERS_STATE.per);
  const cnt = document.getElementById('uCount'); if (cnt) cnt.textContent = `${list.length} match${list.length === 1 ? '' : 'es'}`;
  document.getElementById('uBody').innerHTML = items.map((u) => `<tr>
    <td>${esc(u.name || u.username || '—')}<br><span class="p-sub">@${esc(u.username || '')}</span></td>
    <td class="p-sub">${esc(u.email)}</td>
    <td class="p-sub">${esc(u.plan || 'Free')}</td>
    <td class="num">${usd(u.usd)}<br><span class="p-sub">${kes(u.balance)}</span></td>
    <td class="num">${usd(u.totalEarningsUSD)}</td>
    <td class="num">${u.completedTasks} done<br><span class="p-sub">${u.pendingTasks} pending</span></td>
    <td>${badges(u)}</td>
    <td><div style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="btn btn-ghost auto uview" data-id="${u.id}">View</button>
      ${act('withdraw', u, 'Initiate withdrawal')}
      ${ROLE === 'finance' ? '' : `
      <button class="btn btn-ghost auto uemail" data-id="${u.id}">Email</button>
      <button class="btn btn-primary auto udetails" data-id="${u.id}">Edit</button>
      ${act('suspend', u, u.suspended ? 'Reactivate' : 'Suspend')}
      ${act('hold', u, u.held ? 'Release hold' : 'Hold')}
      ${act('balance', u, 'Balance')}
      ${act('plan', u, 'Change plan', ' data-plan="' + esc(u.planId || 'none') + '"')}
      ${act('password', u, 'Reset password')}
      ${act('gamify', u, 'XP / Badges')}
      ${act('delete', u, 'Delete', ' style="border-color:var(--danger);color:#c0143c"')}`}
    </div></td>
  </tr>`).join('') || `<tr><td colspan="8" class="p-sub">No users match your search.</td></tr>`;
  document.getElementById('uPager').innerHTML = `
    <button class="btn btn-ghost auto" id="uPrev" style="width:auto"${USERS_STATE.page <= 1 ? ' disabled' : ''}>← Prev</button>
    <span class="p-sub">Page ${USERS_STATE.page} of ${pages}</span>
    <button class="btn btn-ghost auto" id="uNext" style="width:auto"${USERS_STATE.page >= pages ? ' disabled' : ''}>Next →</button>`;
  document.getElementById('uPrev').addEventListener('click', () => { if (USERS_STATE.page > 1) { USERS_STATE.page -= 1; renderUsersTable(); } });
  document.getElementById('uNext').addEventListener('click', () => { if (USERS_STATE.page < pages) { USERS_STATE.page += 1; renderUsersTable(); } });
  const find = (id) => USERS_CACHE.find((u) => u.id === id);
  content().querySelectorAll('.uact').forEach((b) => b.addEventListener('click', () => userAction(b.dataset)));
  content().querySelectorAll('.udetails').forEach((b) => b.addEventListener('click', () => openDetailsForm(find(b.dataset.id))));
  content().querySelectorAll('.uview').forEach((b) => b.addEventListener('click', () => openUserView(find(b.dataset.id))));
  content().querySelectorAll('.uemail').forEach((b) => b.addEventListener('click', () => openUserEmail(find(b.dataset.id))));
}

// Reusable email templates ({name} is replaced with the recipient's name).
const EMAIL_TEMPLATES = {
  '': { subject: '', body: '' },
  'Welcome': { subject: 'Welcome to Gweno 🎉', body: 'Hi {name},\n\nWelcome to Gweno! Your account is ready. Complete tasks and surveys to earn, and cash out to M-Pesa when you reach the minimum.\n\nHappy earning,\nThe Gweno Team' },
  'Premium upgrade': { subject: 'Your Gweno Premium is active', body: 'Hi {name},\n\nThank you for upgrading to Premium! You now have access to premium tasks and higher rewards.\n\nThe Gweno Team' },
  'Payment received': { subject: 'Payment received', body: 'Hi {name},\n\nWe have received your payment and your wallet has been credited. Thank you!\n\nThe Gweno Team' },
  'Withdrawal approved': { subject: 'Withdrawal approved & paid', body: 'Hi {name},\n\nGood news — your withdrawal has been approved and paid to your chosen account.\n\nThe Gweno Team' },
  'Withdrawal rejected': { subject: 'Withdrawal update', body: 'Hi {name},\n\nUnfortunately your recent withdrawal could not be processed and the amount has been refunded to your wallet. Please check your payout details and try again.\n\nThe Gweno Team' },
  'Account suspended': { subject: 'Your Gweno account status', body: 'Hi {name},\n\nYour account has been suspended pending review. If you believe this is a mistake, please reply to this email.\n\nThe Gweno Team' },
  'Announcement': { subject: 'An update from Gweno', body: 'Hi {name},\n\nWe wanted to share an update with you:\n\n[Your message here]\n\nThe Gweno Team' },
  'Maintenance': { subject: 'Scheduled maintenance', body: 'Hi {name},\n\nGweno will undergo scheduled maintenance and may be briefly unavailable. We apologise for any inconvenience.\n\nThe Gweno Team' },
};
const tplOptions = () => Object.keys(EMAIL_TEMPLATES).map((k) => `<option value="${esc(k)}">${k ? esc(k) : '— pick a template —'}</option>`).join('');

// Compose and send a one-off email to a single user.
function openUserEmail(u) {
  if (!u) return;
  const nm = u.name || u.username || 'there';
  const bg = adminModal(`
    <button class="close">×</button>
    <h3>Email ${esc(u.name || u.username || '')}</h3>
    <p class="p-sub">To: ${esc(u.email || '—')}</p>
    <form id="ueForm">
      <div class="field"><label>Template</label><select id="ueTpl" style="width:100%;${inputStyle}">${tplOptions()}</select></div>
      <div class="field"><label>Subject</label><input id="ueSubject" maxlength="160" style="width:100%;${inputStyle}"></div>
      <div class="field"><label>Message</label><textarea id="ueBody" rows="6" style="width:100%;${inputStyle}" placeholder="Write your message…"></textarea></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" type="submit"${u.email ? '' : ' disabled'}>Send email</button><button class="btn btn-ghost auto" type="button" id="uePreview">Preview</button></div>
      ${u.email ? '' : '<p class="p-sub" style="margin-top:8px">This user has no email address on file.</p>'}
    </form>
    <div id="uePrev" style="display:none;margin-top:14px;border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--bg-2)"></div>`);
  bg.querySelector('#ueTpl').addEventListener('change', (e) => { const t = EMAIL_TEMPLATES[e.target.value]; if (!t) return; bg.querySelector('#ueSubject').value = t.subject; bg.querySelector('#ueBody').value = t.body.replace(/\{name\}/g, nm); });
  bg.querySelector('#uePreview').addEventListener('click', () => { const p = bg.querySelector('#uePrev'); p.style.display = 'block'; p.innerHTML = `<b>${esc(bg.querySelector('#ueSubject').value)}</b><hr>${esc(bg.querySelector('#ueBody').value).replace(/\n/g, '<br>')}`; });
  bg.querySelector('#ueForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = bg.querySelector('#ueSubject').value.trim();
    const body = bg.querySelector('#ueBody').value.trim();
    if (!subject || !body) return toast('Subject and message are required', 'error');
    const btn = bg.querySelector('button[type="submit"]'); btn.disabled = true;
    const { ok, data: d } = await api('/api/admin/users/' + u.id + '/email', { subject, body });
    if (ok) { const st = d.email ? d.email.status : '—'; toast('Email ' + st, st === 'Failed' ? 'error' : 'ok'); bg.remove(); }
    else { btn.disabled = false; toast(d.error || 'Failed', 'error'); }
  });
}

// Broadcast an email to a segment of members.
async function tSendEmail() {
  content().innerHTML = `
    <p class="page-sub">Send one email to many members at once. Delivery is logged in the <b>Email log</b> tab.</p>
    <div class="panel">
      <h3>📣 Broadcast email</h3>
      <form id="beForm">
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          <select id="beSeg" style="flex:1;min-width:200px;${inputStyle}">
            <option value="all">All members</option><option value="premium">Premium members</option><option value="free">Free members</option>
            <option value="active">Active members</option><option value="suspended">Suspended members</option><option value="country">Members in a country…</option>
          </select>
          <input id="beCountry" placeholder="Country (if selected)" style="flex:1;min-width:160px;${inputStyle}">
        </div>
        <div class="field"><label>Template</label><select id="beTpl" style="width:100%;${inputStyle}">${tplOptions()}</select></div>
        <div class="field"><label>Subject</label><input id="beSubject" maxlength="160" style="width:100%;${inputStyle}"></div>
        <div class="field"><label>Message</label><textarea id="beBody" rows="8" style="width:100%;${inputStyle}" placeholder="Write your message…"></textarea></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" type="submit" id="beSend">Send broadcast</button><button class="btn btn-ghost auto" type="button" id="bePreview">Preview</button></div>
      </form>
      <div id="bePrev" style="display:none;margin-top:14px;border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--bg-2)"></div>
    </div>`;
  document.getElementById('beTpl').addEventListener('change', (e) => { const t = EMAIL_TEMPLATES[e.target.value]; if (!t) return; document.getElementById('beSubject').value = t.subject; document.getElementById('beBody').value = t.body.replace(/\{name\}/g, 'there'); });
  document.getElementById('bePreview').addEventListener('click', () => { const p = document.getElementById('bePrev'); p.style.display = 'block'; p.innerHTML = `<b>${esc(document.getElementById('beSubject').value)}</b><hr>${esc(document.getElementById('beBody').value).replace(/\n/g, '<br>')}`; });
  document.getElementById('beForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = document.getElementById('beSubject').value.trim(), body = document.getElementById('beBody').value.trim();
    const segment = document.getElementById('beSeg').value, country = document.getElementById('beCountry').value.trim();
    if (!subject || !body) return toast('Enter a subject and message', 'error');
    if (segment === 'country' && !country) return toast('Enter a country name', 'error');
    if (!confirm(`Send this email to the "${segment}"${segment === 'country' ? ' (' + country + ')' : ''} segment?`)) return;
    const btn = document.getElementById('beSend'); btn.disabled = true;
    const { ok, data } = await api('/api/admin/email/broadcast', { subject, body, segment, country });
    if (ok) { toast(`Sent to ${data.sent}/${data.total}${data.failed ? ` · ${data.failed} failed` : ''}`); btn.disabled = false; document.getElementById('beForm').reset(); }
    else { toast(data.error || 'Failed', 'error'); btn.disabled = false; }
  });
}

// Read-only full profile of a member (passwords are never shown — only that they're encrypted).
function openUserView(u) {
  if (!u) return;
  const row = (l, v) => `<div class="wa-row"><span class="wa-row-l">${esc(l)}</span><span class="wa-row-v">${v}</span></div>`;
  const bg = adminModal(`
    <button class="close">×</button>
    <h3>${esc(u.name || u.username || 'User')}</h3>
    <p class="p-sub">${esc(u.email || '')}</p>
    <div class="wa-list">
      ${row('Account ID', esc(u.id))}
      ${row('Username', '@' + esc(u.username || ''))}
      ${row('Phone', esc(u.phone || '—'))}
      ${row('Current plan', esc(u.plan || 'Free'))}
      ${row('Account status', esc(u.status || '—'))}
      ${row('Registered', u.createdAt ? new Date(u.createdAt).toLocaleString() : '—')}
      ${row('Wallet balance', usd(u.usd) + ' · ' + kes(u.balance))}
      ${row('Total earnings', usd(u.totalEarningsUSD))}
      ${row('Completed tasks', String(u.completedTasks))}
      ${row('Pending tasks', String(u.pendingTasks))}
      ${row('Country', esc(u.country || '—'))}
      ${row('Password', u.hasPassword ? '*************** <span class="p-sub">Encrypted</span>' : '<span class="p-sub">Not set (social sign-in)</span>')}
    </div>
    <h4 style="margin:16px 0 6px">Email history</h4>
    <div id="uvEmails"><p class="p-sub">Loading…</p></div>
    <p class="p-sub" style="margin-top:12px">Full task and withdrawal history are in the <b>Submissions</b> and <b>Withdrawals</b> tabs.</p>`);
  // Load this user's email history into the modal.
  apiGet('/api/admin/users/' + u.id + '/emails').then(({ data }) => {
    const box = bg.querySelector('#uvEmails'); if (!box) return;
    const list = (data && data.emails) || [];
    box.innerHTML = list.length ? list.map((e) => `
      <div style="padding:8px 0;border-bottom:1px solid var(--line)">
        <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(e.subject || statusLabel(e.type) || 'Email')}</b><span class="st ${e.status === 'Sent' ? 'approved' : 'rejected'}">${esc(e.status)}</span></div>
        <p class="p-sub" style="margin:2px 0 0">${new Date(e.createdAt).toLocaleString()}${e.admin ? ' · by ' + esc(e.admin) : ''}</p>
      </div>`).join('') : '<p class="p-sub">No emails sent to this user yet.</p>';
  });
}

// Edit a client's full details (admin can change everything, including the locked fields).
function openDetailsForm(u) {
  if (!u) return;
  const bg = adminModal(`
    <button class="close">×</button>
    <h3>Edit client details</h3>
    <p class="p-sub">${esc(u.email || '')}</p>
    <form id="detForm">
      <div class="grid g2">
        <div class="field"><label>Full name</label><input id="dName" value="${esc(u.name || '')}"></div>
        <div class="field"><label>Username</label><input id="dUsername" value="${esc(u.username || '')}"></div>
        <div class="field"><label>Email</label><input id="dEmail" type="email" value="${esc(u.email || '')}"></div>
        <div class="field"><label>Phone</label><input id="dPhone" value="${esc(u.phone || '')}"></div>
        <div class="field"><label>Country</label><input id="dCountry" value="${esc(u.country || '')}"></div>
        <div class="field"><label>Gender</label><input id="dGender" value="${esc(u.gender || '')}"></div>
        <div class="field"><label>Date of birth</label><input id="dDob" type="date" value="${esc(u.dob || '')}"></div>
        <div class="field"><label>Postal code</label><input id="dPostal" value="${esc(u.postalCode || '')}"></div>
        <div class="field"><label>State / region</label><input id="dState" value="${esc(u.state || '')}"></div>
      </div>
      <button class="btn btn-primary" type="submit">Save details</button>
    </form>`);
  bg.querySelector('#detForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const g = (id) => bg.querySelector(id).value;
    const { ok, data } = await api('/api/admin/users/' + u.id + '/details', {
      name: g('#dName'), username: g('#dUsername'), email: g('#dEmail'), phone: g('#dPhone'),
      country: g('#dCountry'), gender: g('#dGender'), dob: g('#dDob'), postalCode: g('#dPostal'), state: g('#dState'),
    });
    if (ok) { toast(data.message || 'Saved'); bg.remove(); tUsers(); }
    else toast(data.error || 'Failed', 'error');
  });
}

// ---- Rewards / gamification leaderboard + gifting ----
const BADGE_IDS = ['first_task', 'tasks_10', 'tasks_100', 'first_survey', 'surveys_25', 'investor', 'big_investor', 'first_referral', 'referral_master', 'first_withdraw', 'streak_7', 'streak_30', 'top_earner', 'level_legend'];

async function tRewards() {
  loading();
  const { ok, data } = await apiGet('/api/admin/leaderboard');
  const rows = (ok && data.rows) || [];
  const vChip = (v) => v ? `<span class="st approved">${esc(v)}</span>` : '<span class="p-sub">—</span>';
  content().innerHTML = `
    <p class="page-sub">Gamification leaderboard — ranked by all-time XP. Use <b>🎁 Gift</b> to award XP, coins, badges or a verification tier to any member.</p>
    <div class="panel"><table class="table">
      <thead><tr><th>#</th><th>Member</th><th>Level</th><th class="num">XP</th><th class="num">Coins</th><th class="num">Badges</th><th class="num">Streak</th><th class="num">Rep</th><th>Verified</th><th>Actions</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(r.name || '—')}<br><span class="p-sub">${esc(r.email || '')}</span></td>
        <td>${esc(r.level)}</td>
        <td class="num">${(r.xp || 0).toLocaleString()}</td>
        <td class="num">${(r.coins || 0).toLocaleString()}</td>
        <td class="num">${r.badges || 0}</td>
        <td class="num">${r.streak || 0}</td>
        <td class="num">${r.reputation || 0}</td>
        <td>${vChip(r.verification)}</td>
        <td><button class="btn btn-primary auto gift" data-id="${esc(r.id)}" data-name="${esc(r.name || r.email || '')}">🎁 Gift</button></td>
      </tr>`).join('') || `<tr><td colspan="10" class="p-sub">No gamification activity yet.</td></tr>`}</tbody>
    </table></div>`;
  content().querySelectorAll('.gift').forEach((b) => b.addEventListener('click', () => openGiftModal(b.dataset.id, b.dataset.name)));
}

function openGiftModal(id, name) {
  const bg = adminModal(`
    <button class="close">×</button>
    <h3>🎁 Gift rewards</h3>
    <p class="p-sub">${esc(name || '')}</p>
    <form id="giftForm">
      <div class="grid g2">
        <div class="field"><label>Add XP <span class="p-sub">(− to remove)</span></label><input id="gXp" type="number" placeholder="0"></div>
        <div class="field"><label>Set XP to <span class="p-sub">(exact)</span></label><input id="gSetXp" type="number" min="0" placeholder="leave blank"></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Add coins <span class="p-sub">(− to remove)</span></label><input id="gCoins" type="number" placeholder="0"></div>
        <div class="field"><label>Grant badge</label><select id="gBadge"><option value="">— none —</option>${BADGE_IDS.map((b) => `<option value="${b}">${b}</option>`).join('')}</select></div>
      </div>
      <div class="grid g2">
        <div class="field"><label>Verification</label><select id="gVerif"><option value="">— leave as-is —</option><option value="blue">Blue</option><option value="gold">Gold</option><option value="diamond">Diamond</option><option value="none">Remove</option></select></div>
        <div class="field"></div>
      </div>
      <button class="btn btn-primary" type="submit">Apply</button>
    </form>`);
  bg.querySelector('#giftForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = (s) => bg.querySelector(s).value;
    const body = {};
    if (val('#gSetXp').trim() !== '') body.setXp = Number(val('#gSetXp'));
    if (val('#gXp').trim() !== '') body.addXp = Number(val('#gXp'));
    if (val('#gCoins').trim() !== '') body.addCoins = Number(val('#gCoins'));
    if (val('#gBadge')) body.grantBadge = val('#gBadge');
    if (val('#gVerif')) body.verification = val('#gVerif') === 'none' ? null : val('#gVerif');
    if (!Object.keys(body).length) return toast('Nothing to apply', 'error');
    const { ok, data } = await api('/api/admin/users/' + id + '/gamify', body);
    if (ok) { toast('Rewards gifted 🎁'); bg.remove(); tRewards(); } else toast(data.error || 'Failed', 'error');
  });
}

async function tBroadcast() {
  loading();
  const { data } = await apiGet('/api/admin/broadcasts');
  const list = data.broadcasts || [];
  content().innerHTML = `
    <p class="page-sub">Send an announcement to every member. It appears as a dismissible banner in their dashboard.</p>
    <div class="panel">
      <h3>New broadcast</h3>
      <form id="bcForm">
        <div class="field"><label>Title <span class="p-sub">(optional)</span></label><input id="bcTitle" maxlength="120" placeholder="e.g. Scheduled maintenance"></div>
        <div class="field"><label>Message</label><textarea id="bcMsg" rows="4" maxlength="2000" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;background:var(--bg-2);color:var(--text)" placeholder="Write your announcement…"></textarea></div>
        <button class="btn btn-primary" type="submit">Send broadcast</button>
      </form>
    </div>
    <div class="panel">
      <h3>Broadcast email to all users</h3>
      <p class="p-sub">Sends a real email (not just an in-app banner) to every member who has an email on file.</p>
      <form id="beForm">
        <div class="field"><label>Subject</label><input id="beSubject" maxlength="160" style="width:100%;${inputStyle}"></div>
        <div class="field"><label>Message</label><textarea id="beBody" rows="5" style="width:100%;${inputStyle}" placeholder="Write your email…"></textarea></div>
        <button class="btn btn-primary" type="submit">Send email to all users</button>
      </form>
    </div>
    <div class="panel">
      <h3>Sent broadcasts</h3>
      ${list.length ? list.map((b) => `
        <div style="padding:12px 0;border-bottom:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
            <div>${b.title ? `<b>${esc(b.title)}</b><br>` : ''}<span>${esc(b.message)}</span></div>
            <button class="btn btn-ghost auto bcdel" data-id="${esc(b.id)}" style="border-color:var(--danger);color:#c0143c;padding:4px 10px;font-size:12px;flex:0 0 auto">Delete</button>
          </div>
          <p class="p-sub" style="margin:6px 0 0">${new Date(b.createdAt).toLocaleString()}</p>
        </div>`).join('') : `<p class="p-sub">No broadcasts sent yet.</p>`}
    </div>`;
  document.getElementById('bcForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { ok, data: d } = await api('/api/admin/broadcast', {
      title: document.getElementById('bcTitle').value,
      message: document.getElementById('bcMsg').value,
    });
    if (ok) { toast(d.message || 'Broadcast sent'); tBroadcast(); } else toast(d.error || 'Failed', 'error');
  });
  document.getElementById('beForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject = document.getElementById('beSubject').value.trim();
    const body = document.getElementById('beBody').value.trim();
    if (!subject || !body) return toast('Subject and message are required', 'error');
    if (!confirm('Send this email to ALL users who have an email address?')) return;
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    const { ok, data: d } = await api('/api/admin/email/broadcast', { subject, body });
    btn.disabled = false;
    if (ok) { toast(`Emailed ${d.sent}/${d.total}${d.failed ? ` · ${d.failed} failed` : ''}`, d.failed ? 'error' : 'ok'); e.target.reset(); }
    else toast(d.error || 'Failed', 'error');
  });
  content().querySelectorAll('.bcdel').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this broadcast? Members will no longer see it.')) return;
    const r = await fetch('/api/admin/broadcasts/' + b.dataset.id, { method: 'DELETE' });
    if (r.ok) { toast('Deleted'); tBroadcast(); } else toast('Failed', 'error');
  }));
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
  } else if (ds.a === 'withdraw') {
    const u = USERS_CACHE.find((x) => x.id === id) || { id, email: ds.email, usd: Number(ds.usd), balance: Number(ds.kes) };
    openInitiateWithdraw(u);
  } else if (ds.a === 'password') {
    const pw = prompt('Set a NEW password (8+ chars incl. a letter & a number). The member will be signed out everywhere:');
    if (!pw) return;
    const { ok, data } = await api(base + '/password', { password: pw });
    if (ok) toast('Password updated'); else toast(data.error || 'Failed', 'error');
  } else if (ds.a === 'gamify') {
    const xp = prompt('Add XP for ' + ds.email + ' (use a negative number to remove). Leave blank to skip:', '');
    if (xp === null) return;
    const coins = prompt('Add coins (negative to remove). Leave blank to skip:', '');
    if (coins === null) return;
    const grantBadge = prompt('Grant badge id (e.g. top_earner, investor). Leave blank to skip:', '');
    if (grantBadge === null) return;
    const verification = prompt('Set verification: blue / gold / diamond / none (blank = leave as-is):', '');
    if (verification === null) return;
    const body = {};
    if (xp.trim() !== '') body.addXp = Number(xp);
    if (coins.trim() !== '') body.addCoins = Number(coins);
    if (grantBadge.trim() !== '') body.grantBadge = grantBadge.trim();
    if (verification.trim() !== '') body.verification = verification.trim() === 'none' ? null : verification.trim();
    const { ok, data } = await api(base + '/gamify', body);
    if (ok) toast('Gamification updated'); else toast(data.error || 'Failed', 'error');
  } else if (ds.a === 'plan') {
    const cur = ds.plan || 'none';
    const opts = [
      ['none', 'Free — no plan'],
      ['basic', 'Basic — KES 200 (tasks up to $1)'],
      ['premium', 'Premium — KES 500 (tasks $1–$2)'],
      ['premiumpro', 'Premium Pro — KES 1000 (tasks $2–$7)'],
    ];
    const bg = adminModal(`
      <button class="close">×</button>
      <h3 style="margin:0 0 4px">Change subscription plan</h3>
      <p class="p-sub">${esc(ds.email)}</p>
      <div class="field"><label>Plan</label>
        <select id="planSel">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <p class="p-sub">Paid plans activate for 30 days from now.</p>
      <button class="btn btn-primary" id="planSave">Save plan</button>`);
    bg.querySelector('#planSave').addEventListener('click', async () => {
      const plan = bg.querySelector('#planSel').value;
      const { ok, data } = await api(base + '/plan', { plan });
      if (ok) { bg.remove(); toast('Plan set to ' + (data.plan || plan)); tUsers(); } else toast(data.error || 'Failed', 'error');
    });
  } else if (ds.a === 'delete') {
    if (!confirm('Permanently delete ' + ds.email + ' and all their data? This cannot be undone.')) return;
    const r = await fetch(base, { method: 'DELETE' });
    if (r.ok) { toast('Account deleted'); tUsers(); } else { let e = {}; try { e = await r.json(); } catch (_) {} toast(e.error || 'Failed', 'error'); }
  }
}

// Admin-initiated withdrawal on behalf of a client (from their profile). Holds the
// balance now; the payout is released from the Withdrawals tab (real pay/refund flow).
function openInitiateWithdraw(u) {
  if (!u) return;
  const name = u.name || u.username || u.email || 'this client';
  const usdBal = Number(u.usd) || 0, kesBal = Number(u.balance) || 0;
  const bg = adminModal(`
    <button class="close">×</button>
    <h3 style="margin:0 0 4px">Initiate withdrawal</h3>
    <p class="p-sub">${esc(name)} · <span style="font-family:ui-monospace,monospace;font-size:12px">${esc(u.id)}</span></p>
    <div class="wa-row"><span class="wa-row-l">Available balance</span><span class="wa-row-v">${usd(usdBal)} · ${kes(kesBal)}</span></div>
    <form id="iwForm" style="margin-top:10px">
      <div class="field"><label>Withdrawal method</label>
        <select id="iwMethod" style="width:100%;${inputStyle}">
          <option value="M-Pesa">M-Pesa (KES)</option>
          <option value="Bank account">Bank account (USD)</option>
          <option value="PayPal">PayPal (USD)</option>
        </select></div>
      <div id="iwMpesa"><div class="field"><label>M-Pesa phone number</label><input id="iwPhone" placeholder="e.g. 0712345678" style="width:100%;${inputStyle}"></div></div>
      <div id="iwPaypal" style="display:none"><div class="field"><label>PayPal email</label><input id="iwPaypalEmail" placeholder="name@example.com" style="width:100%;${inputStyle}"></div></div>
      <div id="iwBank" style="display:none">
        <div class="grid g2">
          <div class="field"><label>Account name</label><input id="iwAccName" style="width:100%;${inputStyle}"></div>
          <div class="field"><label>Bank name</label><input id="iwBankName" style="width:100%;${inputStyle}"></div>
        </div>
        <div class="field"><label>Account number</label><input id="iwAccNo" style="width:100%;${inputStyle}"></div>
      </div>
      <div class="field"><label>Amount (<span id="iwCur">KES</span>)</label><input id="iwAmount" type="number" step="0.01" min="0" style="width:100%;${inputStyle}"></div>
      <div class="field"><label>Admin notes (optional)</label><textarea id="iwNote" rows="2" style="width:100%;${inputStyle}" placeholder="Reason / context for this payout…"></textarea></div>
      <p class="p-sub">This holds the amount from the client's balance now and notifies them. Release the actual payment from the <b>Withdrawals</b> tab.</p>
      <button class="btn btn-primary" type="submit">Review &amp; initiate</button>
    </form>`);
  const methodEl = bg.querySelector('#iwMethod');
  const sync = () => {
    const m = methodEl.value;
    bg.querySelector('#iwMpesa').style.display = m === 'M-Pesa' ? '' : 'none';
    bg.querySelector('#iwPaypal').style.display = m === 'PayPal' ? '' : 'none';
    bg.querySelector('#iwBank').style.display = m === 'Bank account' ? '' : 'none';
    bg.querySelector('#iwCur').textContent = m === 'M-Pesa' ? 'KES' : 'USD';
  };
  methodEl.addEventListener('change', sync); sync();
  bg.querySelector('#iwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const method = methodEl.value;
    const amount = Number(bg.querySelector('#iwAmount').value);
    if (!(amount > 0)) return toast('Enter a valid amount', 'error');
    const body = { method, amount, note: bg.querySelector('#iwNote').value.trim() };
    let destLabel = '';
    if (method === 'M-Pesa') { body.destination = bg.querySelector('#iwPhone').value.trim(); destLabel = body.destination; }
    else if (method === 'PayPal') { body.destination = bg.querySelector('#iwPaypalEmail').value.trim(); destLabel = body.destination; }
    else {
      body.accountName = bg.querySelector('#iwAccName').value.trim();
      body.bankName = bg.querySelector('#iwBankName').value.trim();
      body.accountNumber = bg.querySelector('#iwAccNo').value.trim();
      destLabel = [body.accountName, body.bankName, body.accountNumber].filter(Boolean).join(' · ');
      body.destination = destLabel;
    }
    const cur = method === 'M-Pesa' ? 'KES' : 'USD';
    if (!confirm(`Initiate a ${cur} ${amount.toLocaleString()} ${method} withdrawal for ${name}?\n\nTo: ${destLabel || '—'}\n\nThe amount is held from their balance now; you'll release payment from the Withdrawals tab.`)) return;
    const btn = bg.querySelector('button[type="submit"]'); btn.disabled = true;
    const { ok, data } = await api('/api/admin/users/' + u.id + '/withdraw', body);
    if (ok) {
      toast(data.message || 'Withdrawal initiated');
      bg.remove();
      TAB = 'withdrawals';
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === TAB));
      route();
    } else { btn.disabled = false; toast(data.error || 'Failed', 'error'); }
  });
}

async function tDeposits() {
  loading();
  const { data } = await apiGet('/api/admin/deposits');
  const deps = data.deposits || [];
  const sc = (s) => (/success/i.test(s) ? 'approved' : (s === 'failed' ? 'rejected' : 'pending'));
  const render = () => {
    const p = paginate('deposits', deps);
    content().innerHTML = `
    <p class="page-sub">Wallet top-ups and <b>subscription payments</b>. If a subscription shows <b>pending</b> but the client was charged (the M-Pesa/Paystack callback didn't arrive), confirm the receipt and click <b>Activate</b> to grant the plan.</p>

    ${ROLE === 'finance' ? '' : `<div class="panel">
      <h3>M-Pesa STK diagnostics</h3>
      <p class="p-sub">Check that STK Push is correctly configured, then send a KES 1 test prompt to your own phone.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <button class="btn btn-ghost auto" id="mpDiag">Run configuration check</button>
        <input id="mpPhone" placeholder="Your Safaricom no. e.g. 0712345678" style="flex:1;min-width:200px;border:1px solid var(--line);border-radius:10px;padding:9px 12px;background:var(--bg-2);color:var(--text)">
        <button class="btn btn-primary auto" id="mpTest">Send KES 1 test STK</button>
      </div>
      <pre id="mpOut" style="white-space:pre-wrap;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:13px;margin:0;display:none"></pre>
    </div>`}

    <div class="panel" style="overflow-x:auto"><table class="table">
      <thead><tr><th>Date</th><th>User</th><th class="num">Amount</th><th>Type</th><th>Details</th><th>Status</th><th>Ref</th><th>Action</th></tr></thead>
      <tbody>${deps.length ? p.rows.map((d) => {
        const isSub = d.purpose === 'subscription';
        const typeCell = isSub ? `<b>Subscription</b><br><span class="p-sub">${esc(d.planName || d.plan || '')} · ${esc(d.method || 'M-Pesa')}</span>` : esc(d.method || 'M-Pesa');
        const detailCell = isSub ? esc(d.phone || d.method || '—') : esc(d.phone || d.details || '—');
        const action = (isSub && d.status !== 'success' && ROLE !== 'finance')
          ? `<button class="btn btn-primary auto dact" data-id="${esc(d.id)}" data-plan="${esc(d.planName || d.plan || 'plan')}" data-user="${esc(d.user ? d.user.username : '')}">Activate ${esc(d.planName || 'plan')}</button>`
          : (isSub && d.status === 'success' ? `<span class="p-sub">activated${d.activatedBy ? ' by ' + esc(d.activatedBy) : ''}</span>` : '');
        return `<tr><td class="p-sub">${new Date(d.createdAt).toLocaleString()}</td><td>${esc(d.user ? d.user.username : '—')}</td><td class="num">${d.currency === 'USD' ? usd(d.amount) : kes(d.amount)}</td><td>${typeCell}</td><td class="p-sub">${detailCell}</td><td><span class="st ${sc(d.status)}">${esc(d.status)}${d.demo ? ' (demo)' : ''}</span></td><td class="p-sub">${esc(d.reference || '')}</td><td>${action}</td></tr>`;
      }).join('') : `<tr><td colspan="8" class="p-sub">No deposits yet.</td></tr>`}</tbody>
    </table>${pagerBar('deposits', p)}</div>`;

    if (ROLE !== 'finance') {
      const out = document.getElementById('mpOut');
      const show = (obj, isErr) => { out.style.display = 'block'; out.style.color = isErr ? 'var(--danger)' : 'var(--text)'; out.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2); };
      document.getElementById('mpDiag').addEventListener('click', async () => {
        show('Checking…');
        const { ok, data: d } = await apiGet('/api/admin/mpesa/diagnose');
        show(d, !ok || (d.oauth && !d.oauth.ok));
      });
      document.getElementById('mpTest').addEventListener('click', async () => {
        show('Sending test STK…');
        const { ok, data: d } = await api('/api/admin/mpesa/test-stk', { phone: document.getElementById('mpPhone').value });
        show(ok ? d : (d.error || 'Failed'), !ok);
      });
    }
    content().querySelectorAll('.dact').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Activate ${b.dataset.plan} for ${b.dataset.user || 'this client'}?\n\nOnly do this after confirming the client's payment (e.g. the M-Pesa receipt). This grants the plan immediately.`)) return;
      b.disabled = true;
      const { ok, data: d } = await api('/api/admin/deposits/' + b.dataset.id + '/activate', {});
      if (ok) { toast(d.message || 'Plan activated'); tDeposits(); }
      else { b.disabled = false; toast(d.error || 'Failed', 'error'); }
    }));
    wirePager('deposits', p, render);
  };
  render();
}

async function tWithdrawals() {
  loading();
  const { data } = await apiGet('/api/admin/redemptions');
  const rs = data.redemptions || [];
  const sc = (s) => (/paid/i.test(s) ? 'approved' : (s === 'Failed' ? 'rejected' : 'pending'));
  const render = () => {
    const p = paginate('withdrawals', rs);
    content().innerHTML = `
    <p class="page-sub">Member &amp; admin-initiated withdrawals (M-Pesa, PayPal &amp; bank) — <b>all paid manually</b>. Send the money to the destination shown, then click <b>Mark paid</b>. Marking a payout <b>Failed</b> refunds the user's balance.</p>
    <div class="panel" style="overflow-x:auto"><table class="table">
      <thead><tr><th>Date</th><th>User</th><th class="num">Amount</th><th>To</th><th>Initiated by</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${rs.length ? p.rows.map((r) => `<tr><td class="p-sub">${new Date(r.createdAt).toLocaleString()}</td><td>${esc(r.user ? r.user.username : '—')}</td><td class="num">${r.currency === 'KES' ? kes(r.amount) : usd(r.amount)}</td><td class="p-sub"><b>${esc(r.method || '')}</b><br>${esc(r.destination || '—')}</td><td class="p-sub">${r.initiatedBy ? `<b>Admin</b> (${esc(r.initiatedBy)})${r.adminNote ? `<br><span class="p-sub">${esc(r.adminNote)}</span>` : ''}` : 'Client'}</td><td><span class="st ${sc(r.status)}">${esc(r.status)}</span>${r.status === 'Failed' && r.reason ? `<br><span class="p-sub">${esc(r.reason)}</span>` : ''}</td><td>${!/paid/i.test(r.status) ? `<button class="btn btn-primary auto mk" data-id="${r.id}" data-s="Paid">Approve (paid)</button> ` : ''}${r.status !== 'Failed' ? `<button class="btn btn-ghost auto mkfail" data-id="${r.id}">Reject</button>` : ''}</td></tr>`).join('') : `<tr><td colspan="7" class="p-sub">No withdrawals yet.</td></tr>`}</tbody>
    </table>${pagerBar('withdrawals', p)}</div>`;
    content().querySelectorAll('.mk').forEach((b) => b.addEventListener('click', () => openWithdrawPaid(rs.find((r) => r.id === b.dataset.id))));
    content().querySelectorAll('.mkfail').forEach((b) => b.addEventListener('click', () => openWithdrawReject(b.dataset.id)));
    wirePager('withdrawals', p, render);
  };
  render();
}

// Approve & mark paid, with automatic 20% fee / net calculation the admin can override.
function openWithdrawPaid(r) {
  if (!r) return;
  const isKes = r.currency === 'KES';
  const money = (n) => (isKes ? Math.round(Number(n) || 0).toLocaleString() + ' KES' : '$' + (Number(n) || 0).toFixed(2));
  const gross = Number(r.amount) || 0;
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const bg = adminModal(`
    <button class="close">×</button>
    <h3>Approve &amp; mark paid</h3>
    <p class="p-sub">${esc(r.user ? r.user.username : '')} · <b>${esc(r.method || '')}</b> → ${esc(r.destination || '—')}</p>
    <div class="wa-row"><span class="wa-row-l">Gross amount</span><span class="wa-row-v">${money(gross)}</span></div>
    <form id="wpForm">
      <div class="grid g2" style="margin-top:10px">
        <div class="field"><label>Withdrawal fee (20%, editable)</label><input id="wpFee" type="number" step="0.01" min="0" value="${round2(gross * 0.20)}"></div>
        <div class="field"><label>Net amount to send</label><input id="wpNet" type="number" step="0.01" min="0" value="${round2(gross * 0.80)}"></div>
      </div>
      <p class="p-sub">The member is emailed the gross, fee, net, reference and date. <b>Net</b> is what you actually send${isKes ? '' : ''}.</p>
      <button class="btn btn-primary" type="submit">Confirm paid &amp; email receipt</button>
    </form>`);
  const feeEl = bg.querySelector('#wpFee'), netEl = bg.querySelector('#wpNet');
  feeEl.addEventListener('input', () => { netEl.value = round2(gross - (Number(feeEl.value) || 0)); });
  netEl.addEventListener('input', () => { feeEl.value = round2(gross - (Number(netEl.value) || 0)); });
  bg.querySelector('#wpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
    const { ok, data: d } = await api('/api/admin/redemptions/' + r.id + '/mark', { status: 'Paid', fee: Number(feeEl.value), net: Number(netEl.value) });
    if (ok) { const em = d.email || {}; toast(`Marked paid · email ${em.status || '—'}`, em.status === 'Failed' ? 'error' : 'ok'); bg.remove(); tWithdrawals(); }
    else { btn.disabled = false; toast(d.error || 'Failed', 'error'); }
  });
}

// Reject a withdrawal with a reason; the amount is refunded to the member's wallet.
function openWithdrawReject(id) {
  const bg = adminModal(`
    <button class="close">×</button>
    <h3>Reject withdrawal</h3>
    <p class="p-sub">The held amount is refunded to the member's wallet. The reason is recorded on the payout.</p>
    <form id="wrForm">
      <div class="field"><label>Reason for rejection</label><textarea id="wrReason" rows="3" style="width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;background:var(--bg-2);color:var(--text)" placeholder="e.g. incorrect account details"></textarea></div>
      <button class="btn btn-primary" type="submit" style="background:var(--danger);border-color:var(--danger)">Reject &amp; refund</button>
    </form>`);
  bg.querySelector('#wrForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = bg.querySelector('#wrReason').value.trim();
    if (!reason) return toast('Please enter a rejection reason', 'error');
    const { ok, data: d } = await api('/api/admin/redemptions/' + id + '/mark', { status: 'Failed', reason });
    if (ok) { toast('Withdrawal rejected & refunded'); bg.remove(); tWithdrawals(); } else toast(d.error || 'Failed', 'error');
  });
}

async function tInvestments() {
  loading();
  const { data } = await apiGet('/api/admin/investments');
  const s = data.stats || {}, plans = data.plans || [], rates = data.rates || {};
  const invs = data.investments || [];
  const sc = (st) => (st === 'completed' ? 'approved' : 'pending');
  const render = () => {
    const pg = paginate('investments', invs);
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

    ${ROLE === 'finance' ? '' : `<div class="panel">
      <h3>Interest settings</h3>
      <p class="p-sub">Annual rate per plan (0–100%). Changes apply to <b>new</b> investments only, existing ones keep the rate they opened at.</p>
      <form id="rateForm"><div class="grid g3">
        ${plans.map((p) => `<div class="field"><label>${esc(p.name)}</label><input type="number" min="0" max="100" step="0.1" data-plan="${esc(p.id)}" value="${rates[p.id] != null ? rates[p.id] : p.rate}"></div>`).join('')}
      </div><button class="btn btn-primary" type="submit">Save changes</button></form>
    </div>`}

    <div class="panel" style="overflow-x:auto"><h3>All investments</h3><table class="table">
      <thead><tr><th>ID</th><th>Investor</th><th>Plan</th><th class="num">Principal</th><th class="num">Rate</th><th class="num">Return</th><th>Maturity</th><th>Status</th></tr></thead>
      <tbody>${invs.length ? pg.rows.map((i) => `<tr>
        <td>${esc(i.id)}</td>
        <td>${esc(i.user ? i.user.username : '—')}<br><span class="p-sub">${esc(i.user ? i.user.email : '')}</span></td>
        <td>${esc(i.planName)}</td>
        <td class="num">${usd(i.principal)}</td>
        <td class="num">${i.interestRate}%</td>
        <td class="num">${usd(i.expectedReturn)}</td>
        <td class="p-sub">${new Date(i.maturityDate).toLocaleDateString()}</td>
        <td><span class="st ${sc(i.status)}">${i.status === 'completed' ? 'Completed' : 'Running'}</span></td>
      </tr>`).join('') : `<tr><td colspan="8" class="p-sub">No investments yet.</td></tr>`}</tbody>
    </table>${pagerBar('investments', pg)}</div>`;

    const rateForm = document.getElementById('rateForm');
    if (rateForm) rateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      document.querySelectorAll('#rateForm input[data-plan]').forEach((el) => { body[el.dataset.plan] = el.value; });
      const { ok, data: d } = await api('/api/admin/investment-rates', body);
      if (ok) { toast(d.message || 'Saved'); tInvestments(); } else toast(d.error || 'Failed', 'error');
    });
    wirePager('investments', pg, render);
  };
  render();
}

async function tSupport() {
  loading();
  const { data } = await apiGet('/api/admin/support');
  const t = data.tickets || [];
  content().innerHTML = `
    <p class="page-sub">${t.length} support message(s). Tap <b>Reply</b> to email the member back.${data.emailReady === false ? ' <span class="st pending">Email not set up, replies are saved but not sent.</span>' : ''}</p>
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

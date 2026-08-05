/* Shared front-end helpers for Gweno auth pages. */

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, data };
}

function showMsg(el, text, type) {
  el.textContent = text;
  el.className = 'msg show ' + (type || 'error');
}
function clearMsg(el) { el.className = 'msg'; el.textContent = ''; }

/* Shared client-side validators (mirror the server) so every auth form gives the
   same clear, instant feedback before a request is sent. */
function validEmail(e) {
  const s = String(e || '').trim();
  if (!s || s.length > 254 || /\s/.test(s) || s.includes('..')) return false;
  const at = s.lastIndexOf('@'); if (at < 1) return false;
  const local = s.slice(0, at), domain = s.slice(at + 1);
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.')) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.startsWith('-')) return false;
  return /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/.test(domain);
}
function passwordIssue(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must include a letter and a number.';
  return null;
}

/* #5, a per-browser device fingerprint used to enforce one account per device.
   Tries FingerprintJS (open-source), falls back to a local signal hash offline. */
let _deviceIdPromise = null;
function getDeviceId() {
  if (_deviceIdPromise) return _deviceIdPromise;
  _deviceIdPromise = (async () => {
    try {
      const mod = await import('https://openfpcdn.io/fingerprintjs/v4');
      const FP = mod.default || mod;
      const fp = await FP.load();
      const { visitorId } = await fp.get();
      return 'fp_' + visitorId;
    } catch (_) {
      return 'lf_' + localFingerprint();
    }
  })();
  return _deviceIdPromise;
}
function localFingerprint() {
  const parts = [
    navigator.userAgent, navigator.language, (navigator.languages || []).join(','),
    screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
    new Date().getTimezoneOffset(), navigator.hardwareConcurrency || '', navigator.platform || '',
  ];
  try {
    const c = document.createElement('canvas'); const ctx = c.getContext('2d');
    ctx.textBaseline = 'top'; ctx.font = '14px Arial'; ctx.fillText('gweno-fp', 2, 2);
    parts.push(c.toDataURL());
  } catch (_) {}
  let h = 0; const s = parts.join('|');
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
  return h.toString(16);
}

/* New users answer the welcome questionnaire; onboarded users go to the app
   (or to ?next= if a protected page sent them here to sign in). */
function routeAfterAuth(user) {
  const next = new URLSearchParams(location.search).get('next');
  if (user && user.onboarded && next) { window.location.href = next; return; }
  window.location.href = user && user.onboarded ? '/app.html#/dashboard' : '/onboarding.html';
}

/* Redirect to the right place if already signed in (used on auth pages). */
async function redirectIfAuthed() {
  const res = await fetch('/api/me');
  if (res.ok) {
    const { user } = await res.json();
    routeAfterAuth(user);
  }
}

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19C5.6 19 2 12 2 12a19 19 0 0 1 5.1-5.9M9.9 5.2A10.5 10.5 0 0 1 12 5c6.4 0 10 7 10 7a19 19 0 0 1-2.3 3.3M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

/* Wire every button that has data-pwtoggle="<input-id>" to show/hide that field. */
function attachPasswordToggles(root) {
  (root || document).querySelectorAll('[data-pwtoggle]').forEach((btn) => {
    const input = document.getElementById(btn.getAttribute('data-pwtoggle'));
    if (!input) return;
    btn.innerHTML = EYE;
    btn.addEventListener('click', () => {
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      btn.innerHTML = reveal ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    });
  });
}

/* Social/OAuth sign-in UI has been removed: Gweno uses first-party email + password
   only, so the login page never imitates Google/Facebook/Apple (Safe Browsing safe). */

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

/* #5 — a per-browser device fingerprint used to enforce one account per device.
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

/* Real OAuth: hand off to the provider via the server /start endpoint, carrying
   the referral code and this device's id so the callback can apply both. */
async function socialLogin(provider) {
  const ref = new URLSearchParams(location.search).get('ref') || '';
  const deviceId = await getDeviceId();
  const q = new URLSearchParams();
  if (ref) q.set('ref', ref);
  if (deviceId) q.set('deviceId', deviceId);
  window.location.href = `/api/oauth/${provider}/start${q.toString() ? '?' + q.toString() : ''}`;
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

const SOCIAL_SVGS = {
  google: '<svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>',
  facebook: '<svg viewBox="0 0 24 24"><path fill="#1877F2" d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.92-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12z"/></svg>',
  apple: '<svg viewBox="0 0 24 24"><path fill="#fff" d="M16.36 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.19-1.73-1.36-.14-2.65.8-3.34.8-.68 0-1.75-.78-2.87-.76-1.48.02-2.84.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.83-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.5zM14.2 5.9c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.55 1.3-.56.65-1.05 1.68-.92 2.67.97.08 1.96-.49 2.57-1.21z"/></svg>',
};

function socialButtons(mount, verb) {
  mount.innerHTML = ['google', 'facebook'].map((p) => {
    const label = p[0].toUpperCase() + p.slice(1);
    return `<button class="btn btn-social" data-provider="${p}">${SOCIAL_SVGS[p]} ${verb} with ${label}</button>`;
  }).join('');
  mount.querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => socialLogin(b.dataset.provider));
  });
}

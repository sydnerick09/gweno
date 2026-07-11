/**
 * Real OAuth 2.0 / OpenID Connect for Google, Facebook and Apple.
 * No third-party auth library — uses global fetch + Node crypto (Apple client
 * secret is an ES256 JWT). Credentials come from env; see .env.example.
 */
const crypto = require('crypto');

const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    configured: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scope: 'email public_profile',
    configured: () => !!(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    clientId: () => process.env.FACEBOOK_APP_ID,
    clientSecret: () => process.env.FACEBOOK_APP_SECRET,
  },
  apple: {
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    scope: 'name email',
    configured: () => !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && process.env.APPLE_PRIVATE_KEY),
    clientId: () => process.env.APPLE_CLIENT_ID,
    clientSecret: () => appleClientSecret(),
  },
};

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const decodeJwtPayload = (jwt) => JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));

const isProvider = (p) => Object.prototype.hasOwnProperty.call(PROVIDERS, p);
const configured = (p) => isProvider(p) && PROVIDERS[p].configured();

// Apple wants the client_secret as a short-lived ES256 JWT signed with your .p8 key.
function appleClientSecret() {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: process.env.APPLE_KEY_ID };
  const payload = { iss: process.env.APPLE_TEAM_ID, iat: nowSec, exp: nowSec + 3600, aud: 'https://appleid.apple.com', sub: process.env.APPLE_CLIENT_ID };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = String(process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const signature = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64url(signature)}`;
}

function authorizeUrl(provider, redirectUri, state) {
  const p = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: p.clientId(), redirect_uri: redirectUri, response_type: 'code', scope: p.scope, state,
  });
  if (provider === 'apple') params.set('response_mode', 'form_post'); // Apple returns email via POST
  if (provider === 'google') params.set('prompt', 'select_account');
  return `${p.authUrl}?${params.toString()}`;
}

async function exchangeCode(provider, code, redirectUri) {
  const p = PROVIDERS[provider];
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    client_id: p.clientId(), client_secret: p.clientSecret(),
  });
  const r = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error_description || j.error || `Token exchange failed (${r.status})`);
  return j;
}

// Returns { email, name } for the signed-in user.
async function fetchProfile(provider, tokens) {
  if (provider === 'google' || provider === 'apple') {
    const c = decodeJwtPayload(tokens.id_token);
    return { email: String(c.email || '').toLowerCase(), name: c.name || (c.email ? String(c.email).split('@')[0] : '') };
  }
  const r = await fetch(`https://graph.facebook.com/me?fields=email,name&access_token=${encodeURIComponent(tokens.access_token)}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error((j.error && j.error.message) || 'Failed to fetch Facebook profile');
  return { email: String(j.email || '').toLowerCase(), name: j.name || '' };
}

module.exports = { PROVIDERS, isProvider, configured, authorizeUrl, exchangeCode, fetchProfile };

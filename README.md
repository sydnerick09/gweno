# Gweno — a task platform (auth focus)

Gweno is a **task platform**: people post work (tasks) and others pick it up and
get it done. This project focuses on the welcome/home screen and a complete,
secure sign-up / sign-in flow, plus a post-signup welcome questionnaire that pays
a small **KES bonus**. Social login (Google, Facebook, Apple) and email/password,
with forgotten-password recovery.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000**.

## Pages

| Page | URL | What it does |
|------|-----|--------------|
| Welcome / home | `/` | Why-choose-us, how-it-works, and a full footer (Terms, Privacy, About, Contact, Partners) — no task listings |
| Sign up | `/signup.html` | Full-page (no card) sign-up with social or email + show/hide password |
| Sign in | `/login.html` | Full-page sign-in with show/hide password and "Forgot password?" |
| Onboarding | `/onboarding.html` | Welcome questionnaire (age, education, about, referral) — pays **1 KES per answer** |
| Forgot password | `/forgot.html` | Request a reset link |
| Reset password | `/reset.html?token=…` | Set a new password from the link |
| Dashboard | `/dashboard.html` | Protected; shows the KES balance and a live session-expiry countdown |
| About / Contact / Partners / Terms / Privacy | `/about.html` … | Footer content pages |

## The four problems that are explicitly handled

1. **Wrong password** — login returns a generic *"Invalid email or password"*
   (no user enumeration) and locks the account for 15 min after 5 failures to
   stop brute-force. *(`server.js` → `/api/login`)*
2. **Duplicate email sign-ups** — emails are normalized to lowercase and must be
   unique. Social login for an existing email **links** to the same account
   instead of creating a second one. *(`/api/signup`, `/api/oauth/:provider`)*
3. **Password-reset abuse** — reset tokens are cryptographically random, stored
   only as a hash, single-use, expire after 30 min, are rate-limited (3/email/hr),
   and a new request invalidates older tokens. *(`/api/forgot-password`,
   `/api/reset-password`)*
4. **Sessions that never expire** — every session has a server-side `expiresAt`
   (1 hour). It's checked on every request, expired sessions are rejected and
   swept, and resetting a password logs the user out everywhere. *(`createSession`,
   `currentSession`)*

## Social login (demo vs. real)

Social buttons run in **demo mode**: they ask for the email the provider would
return, so you can see account-linking and dedup work without OAuth credentials.
To go live, add `passport` + the provider strategies and replace the body of
`/api/oauth/:provider` with the real provider callback — keep the "upsert by
email" logic so social + email logins that share an address stay one account.

## Payments, login & email — all real

Every integration is **real**. There is no demo/fake mode: a feature is simply
**disabled** (returns a clear "not available yet" error) until its keys exist in
`.env`. Copy the template and fill in what you have:

```bash
cp .env.example .env
```

### M-Pesa (Safaricom Daraja) — the wallet  ·  `payments.js`
- **Deposits**: STK Push (Lipa na M-Pesa) — PIN prompt; `/api/mpesa/stk-callback` credits the KES wallet.
- **Withdrawals**: B2C — KES from your shortcode to a phone; `/api/mpesa/result` finalises it.
- **Premium** ($10, charged in KES) is an STK Push.
- Keys: https://developer.safaricom.co.ke

### Social login — real OAuth  ·  `oauth.js`
- Google / Facebook / Apple: `/api/oauth/<provider>/start` → provider → `/api/oauth/<provider>/callback`.
- One account per email; a `state` cookie guards CSRF.
- Register this redirect URI with each provider: `https://YOUR-DOMAIN/api/oauth/<provider>/callback`

### Email — real SMTP  ·  `mailer.js`
- Password-reset links and support messages are emailed (nodemailer).
- Set `SMTP_HOST/PORT/USER/PASS`, `MAIL_FROM`, `SUPPORT_EMAIL`.

### Callbacks need a PUBLIC URL
Providers can't reach `localhost`. Use your domain, or run a tunnel for local
testing (no account needed) and point the env vars + provider redirect URIs at
the https URL it prints:

```bash
npm run tunnel     # cloudflared quick tunnel -> https://<random>.trycloudflare.com
```

Then set `MPESA_STK_CALLBACK_URL`, `MPESA_RESULT_URL`, `MPESA_TIMEOUT_URL`, and
each OAuth redirect URI to `https://<that-host>/...`. (Quick-tunnel URLs change
each run — update them or use a fixed domain in production.)

## Database (Supabase)

Persists to **Supabase Postgres** when `DATABASE_URL` is set (else `data/store.json`).
Use the **Session pooler** URI from Supabase → Settings → Database (IPv4-friendly);
it falls back to the local file automatically if unreachable.

## Notes

- Passwords hashed with bcrypt; session cookies are `httpOnly` and expire.
- The **admin panel** (`/admin.html`) has its **own** login (`ADMIN_USERNAME` /
  `ADMIN_PASSWORD` in `.env`) — completely separate from client accounts.
- `DEVICE_LIMIT=off` disables one-account-per-device while testing; set `on` for production.
- Balance shows in USD on the dashboard — **press & hold** to convert to KES (`FX_KES_PER_USD`).
- Security (session TTL, lockout, reset limits, rate limiting, CSP/headers,
  same-origin) is configured at the top of `server.js`.

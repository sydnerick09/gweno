# GWENO — Project Guide for AI/Dev Work

**Before making ANY change, read `read.md` first, then follow the rule files it lists:**
`apps.md`, `auth.md`, `language.md`, `html.md`, `css.md`, `mig.md`.
These are the source of truth. The notes below are a quick orientation, not a replacement.

## What this project is
GWENO — an online tasks & surveys earning platform (Kenya-first, works anywhere). Users
complete microtasks/surveys, earn to a wallet, and withdraw to M-Pesa / PayPal / bank.

## Stack & architecture (do NOT change the stack)
- **Backend:** a single Express app in `server.js` (Node). Not Next.js/React — ignore/avoid
  stray `.tsx`/`app/` files; they don't belong to this stack.
- **Frontend:** static HTML + vanilla JS in `public/` (`index.html`, `login.html`,
  `signup.html`, `app.html` = member SPA via `public/js/app.js`, `admin.html` = admin panel
  via `public/js/admin.js`). CSS in `public/css/` (`styles.css`, `app.css`, `authpanel.css`).
- **Storage:** ONE JSON-state store via `db.js` (`db.get()` / `db.save()`), backed by
  Supabase JSONB in prod or a local file otherwise. **Do not introduce a new database.**
  Update only the fields you need; preserve all other user data (see `mig.md`).
- **Email:** `mailer.js` (nodemailer/SMTP). Reuse existing send functions; log sends to
  `db.emailLog` and record admin actions via the `audit()` helper.

## Subscription plans (single source: `PLAN_BY_ID` in server.js)
`none/Free`, `basic`, `premium`, `premiumpro`, **`executive` = the "Exclusive Plan"** (top
tier, KES 2500, permanent, unlimited). A plan valid for users must be recognized by the
admin panel, Change-Plan control, dashboard, task access, gate/validation, and storage.
**Reuse the existing config — never duplicate a plan.**

## Non-negotiable product rules
- **Auth is first-party email/password ONLY.** Never add Google/Facebook/Apple login UI or
  branded social buttons — that caused a Google Safe Browsing phishing flag. See
  `.claude` memory `auth-no-social-login`.
- **Design = monochrome black-and-white**, token-driven via `public/css/styles.css` `:root`.
  Default theme is dark. Match existing components; make minimal, reusable CSS changes.
- Passwords: bcrypt only, never logged, never plaintext. Security headers are set globally
  in `server.js` before `express.static`.

## Deploy
This repo deploys to Vercel. From the project root: `vercel --prod --yes` (deploys the
working tree). Bump the `?v=N` query on changed `public/js|css` refs in the HTML so clients
get fresh assets. Commit real changes; leave others' WIP alone unless asked.

## Before finishing (from `language.md` / `read.md`)
Check syntax, verify the feature + that existing functionality still works, confirm data
persists after refresh, confirm responsive on mobile/tablet/desktop, and ensure related
validation/permissions recognize the change. Don't duplicate logic or rewrite working code.

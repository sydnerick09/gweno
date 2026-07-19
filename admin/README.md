# Gweno Admin — standalone panel

A separate app that manages the **same Supabase database** as the main Gweno site.
It has its own login and its own deployment, so it lives on a different URL from
your customers (more secure — no admin code ships with the public site).

## What it does
- **Overview** — users, suspended count, pending submissions/withdrawals, invested totals, support.
- **Users** — see how each person signed up (email / Google / Facebook / Apple), balances, country;
  **suspend/unsuspend** an account (signs them out and blocks sign-in), or **delete** it.
- **Submissions** — approve / reject task proofs (approving credits the member's USD).
- **Withdrawals** — verify payouts: **Mark paid** (you've sent it) or **Fail** (reject + refund the hold).
- **Investments** — see all investments and set per-plan interest rates.
- **Deposits** — see all top-ups.
- **Support** — read support messages.
- **Export** — download a JSON snapshot (no password hashes or tokens).

## Run locally
```bash
cd admin
npm install
cp .env.example .env      # fill DATABASE_URL (same as the main site), ADMIN_USERNAME, ADMIN_PASSWORD
npm start                 # http://localhost:4000
```
Leave `DATABASE_URL` blank to use a throwaway local file instead of the live DB.

## Deploy as its own Vercel project
1. Push this `admin/` folder to its **own** GitHub repo (or run `vercel` from inside `admin/`).
2. In the new Vercel project, set env vars:
   - `DATABASE_URL` — **exactly** the same Supabase **pooler** URI the main site uses.
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD` — your admin login.
   - `FX_KES_PER_USD` — e.g. `129`.
3. Deploy. Visit the project URL (e.g. `gweno-admin.vercel.app`) and sign in.

## Notes
- Admin and the member site share one JSON state row; admin actions are infrequent, so
  clobbering is unlikely, but avoid heavy simultaneous edits from both.
- Passwords are stored only as bcrypt hashes — the panel shows the **sign-in method**,
  not the password (by design).
- The main site enforces suspension: suspended users can't sign in and active sessions are dropped.

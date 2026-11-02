# Onix Finance — Client & Admin Portal

Bilingual (EN/ES) private lending and investment platform for a Houston-based
private lender. Clients view their loans, deposits, and documents; admins
manage every record and review data synced from two external loan-servicing
APIs (OUS Pasiva and OUS Activa).

**Live site:** https://onix-red.vercel.app/login.html

This README covers architecture and setup. For what's currently in flight,
open items, and detailed system gotchas, see [`CLAUDE.md`](./CLAUDE.md) —
its "Current status" section is the source of truth.

---

## 1. Architecture

| Layer | Tool | Notes |
|---|---|---|
| Frontend | Vanilla HTML / CSS / JS | Static, no build step |
| Frontend hosting | [Vercel](https://vercel.com) | Auto-deploys from `main`; live at `onix-red.vercel.app`. Only files on the `.vercelignore` allowlist are served (see §7) |
| Backend proxy | Node/Express on [Railway](https://railway.app) (`server.js`) | Authenticates every `/api/*` call against a real Supabase JWT; proxies and syncs OUS Pasiva + OUS Activa data on a cron |
| Auth + DB | [Supabase](https://supabase.com) | Project `ckayfqplkpplgojdhjlu` (free plan). RLS enabled on every table |
| Email | [Resend](https://resend.com) via Supabase Edge Functions | Sending from `info@onixfinance.com` once the domain is verified (see §9); until then only the sandbox sender `onboarding@resend.dev` works, and it delivers only to the Resend account owner |
| File storage | Supabase Storage — `client-documents` bucket | Signed URLs only, folder-scoped by `auth.uid()` |
| Repo | `strevino20/Onix` | `main` is protected — PRs required, direct pushes blocked |

**Two separate external integrations**, both proxied through Railway on a
15-minute cron:
- **OUS Pasiva** — deposits/liability side (client money coming in). Auto-creates
  placeholder clients on sync, no manual review.
- **OUS Activa** — real loans/asset side (money lent out). Requires an admin to
  manually verify a match (Loan Match Review tab) before a loan is written —
  never auto-creates a client.

Both write into the same `loans` table, distinguished by `loans.data_source`
(`'ous_pasiva'` vs `'ous_activa'`). A loan or deposit that OUS stops
reporting is marked `paid` by the next sync (with guards against partial
responses), and reappears as `active` if OUS returns it. See `CLAUDE.md`'s
"OUS Pasiva vs OUS Activa" section for the architecture and known quirks.

---

## 2. Pages

| File | Purpose | Auth |
|---|---|---|
| `login.html` | Sign-in page | Public |
| `signup.html` | Self-service registration | Public |
| `reset-password.html` | Password recovery landing | Public (requires Supabase recovery token) |
| `accept-invite.html` | Team member invite acceptance | Public (requires invite token) |
| `activate.html` | Client account activation: set a password from an emailed link | Public (requires activation token, 7-day, single use) |
| `client-portal.html` | Client-facing dashboard | Requires `role='client'`, `status` in (`active`, `met`) |
| `admin-portal.html` | Admin console | Requires `role` in (`admin`, `manager`), `status !== 'rejected'`. Account executives are `role='admin'` with `title='ae'` |
| `supabase.js` | Shared Supabase client + `OnixDB.*` helpers | Loaded by every page |
| `client-portal-data.js` | Live data layer for the client portal | Loaded by `client-portal.html` |
| `admin-portal-data.js` | Live data layer for the admin portal | Loaded by `admin-portal.html` |
| `i18n.js` | EN/ES toggle | Loaded by every page |
| `server.js` | Railway backend — OUS proxy, sync cron endpoints | Not served to browsers |

Cache-busting: every page references its JS deps with `?v=NN`. Bump that
number whenever you change the JS so users get the new code without a hard
refresh.

> **`admin-portal.html` is not a normal HTML file to edit.** Its real content
> is a JSON-encoded string inside a `<script type="__bundler/template">` tag
> — a "bundler" export format, not hand-written markup. **Never edit it with
> git merge/cherry-pick/rebase** — it has been silently corrupted by
> line-based merges before. See "Editing admin-portal.html" at the top of
> `CLAUDE.md` for the required decode → edit → re-encode procedure before
> touching this file.

---

## 3. Database schema

All tables live in the `public` schema with RLS enabled on every one —
clients see only their own rows (and only once `status` is `met` or
`active`), admins/managers see everything, non-admin write access is blocked
independently at the policy level.

**Core lending/investment tables**

| Table | Purpose |
|---|---|
| `profiles` | Extends `auth.users`. `role` (`client`/`admin`/`manager`), `title` (`admin`/`ae`/`manager`), `status` (`pending`/`met`/`active`/`rejected`) |
| `loans` | Real loans *and* Pasiva deposits, distinguished by `data_source` (`ous_pasiva`/`ous_activa`). `status`: `active`/`paid`/`review`/`charged_off` |
| `loan_documents` | Reference docs per loan — external share link only (Google Drive), no in-app upload |
| `loan_applications` | Submitted from the client portal — admin reviews and approves |
| `loan_payments` | Scheduled and recorded loan payments |
| `investments` | Client equity positions created from an approved `raise_interests` row — separate from OUS deposits |
| `investment_documents` | Reference docs per investment — external link only, same as `loan_documents` |
| `distributions` | Payouts distributed to investors |
| `raises` | Open venture/equity fundraising opportunities |
| `raise_documents` | Reference docs per raise — external link only |
| `raise_interests` | Captured client interest in a raise; admin approval auto-creates the matching `investments` row |
| `client_documents` | Real file uploads (Supabase Storage `client-documents` bucket) — KYC/ID/loan paperwork |
| `admin_documents` | Real file uploads, admin-authored, scoped by `scope`/`holder_name`/`category` |
| `client_admin_notes` | Admin-only notes per client, separate from anything client-visible |
| `calendar_events` | Manually-created admin calendar entries |
| `team_invites` | Pending/accepted invitations for new admin/manager team members |
| `client_activations` | One-time account-activation links sent to existing clients. Only a SHA-256 hash of each token is stored; staff can read it, only the service role writes |

**OUS integration tables**

| Table | Purpose |
|---|---|
| `ous_sync_log` / `ous_activa_sync_log` | One row per sync run per endpoint — the source of truth for whether a sync actually succeeded |
| `ous_activa_client_matches` | Persistent review queue matching OUS Activa borrowers to real client profiles — verified once, refreshed on every sync |
| `ous_raw_capture` / `ous_latest_capture` | Staging area for raw OUS Pasiva payloads, used to build the sync mapping |
| `railway_status_snapshots` | Daily health-check snapshot written by a separate Railway cron (`railway-status-snapshot.js`) |

`is_admin()` / `is_staff_admin()` / `is_ae()` are `SECURITY DEFINER` Postgres
functions used throughout the RLS policies — they only report the caller's
own role and grant nothing by themselves.

---

## 4. Edge Functions

Nine deployed (Supabase Dashboard → Edge Functions). Source for four of them
(`activate-client-account`, `invite-team-member`,
`send-account-activated-email`, `send-client-activation`) is in
`supabase/functions/`; the rest exist only in Supabase.

| Function | Triggered by | Purpose |
|---|---|---|
| `send-client-activation` | Invite / Resend Invite button in the admin Clients view | Emails up to 25 active/met clients a bilingual 7-day activation link. Any active admin, AE or manager can call it. Refuses to run without `RESEND_API_KEY` and `CLIENT_INVITE_FROM_EMAIL` |
| `activate-client-account` | `activate.html` | Validates the link and sets the client's password on their existing account; never creates accounts or changes role/status |
| `send-loan-app-email` | New loan application submitted | Emails Onix staff |
| `send-new-client-email` | New signup | Emails Onix staff about a pending approval |
| `send-account-activated-email` | Admin approves a client | Emails the client that they can sign in |
| `send-payment-confirmation-email` | Admin records a payment | Emails the client + staff a confirmation |
| `invite-team-member` | Admin invites a new team member | Creates a `team_invites` row, emails the invite link |
| `accept-team-invite` | Invite acceptance flow | Activates the invited account |
| `import-ous-clients` | Admin-triggered batch import | Bulk-creates client profiles from matched OUS data |

`send-account-activated-email` and `send-payment-confirmation-email` both
re-verify the caller is a signed-in admin inside the function itself (not
just `verify_jwt: true`, which only checks the JWT is validly signed — the
public anon key satisfies that on its own). Any new function that sends
email or performs a privileged action should follow the same pattern used
in `invite-team-member`.

**Edge Function secrets** (Supabase Dashboard → Edge Functions → Secrets):
`RESEND_API_KEY`, `LOAN_APP_NOTIFY_EMAIL`, `LOAN_APP_FROM_EMAIL`,
`NEW_CLIENT_NOTIFY_EMAIL`, `TEAM_INVITE_FROM_EMAIL`, `CLIENT_INVITE_FROM_EMAIL`,
`CLIENT_INVITE_REPLY_TO` (optional), `PORTAL_BASE_URL` (defaults to
`https://onix-red.vercel.app`). `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are
injected automatically by Supabase, not set manually.

---

## 5. Railway backend (`server.js`)

A small Express app, deployed as the `Onix` service in the `marvelous-surprise`
Railway project. Every `/api/*` route requires a real Supabase JWT; OUS sync
routes additionally accept a cron key. Responsibilities:

- Proxies OUS Pasiva (port 7070) and OUS Activa (port 7575) on the vendor's
  host (configured via env vars) — both vendor APIs are otherwise unreachable from
  the browser (no CORS, and credentials shouldn't ship client-side anyway).
- Runs the sync logic (`runOUSActivaSync`, Pasiva's equivalent) invoked by
  two separate Supabase cron jobs 5 minutes apart.
- Rate-limits outbound calls to OUS (`createThrottle()`) and inbound `/api/*`
  calls per IP (120 requests/minute by default).
- `ALLOWED_ORIGINS` env var controls CORS — must include the live Vercel
  domain and any custom domain in use. It does not follow a domain change
  automatically.
- Railway's Static Outbound IPs are enabled on the `Onix` service; OUS
  allowlists them. Keep that in mind if the service is ever recreated.

A second Railway service, `cozy-friendship`, runs `railway-status-snapshot.js`
once a day as a cron job and writes to `railway_status_snapshots`.

Required env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OUS_API_URL`/`OUS_LOGIN`/`OUS_PASSWORD`,
`OUS_ACTIVA_API_URL`/`OUS_ACTIVA_LOGIN`/`OUS_ACTIVA_PASSWORD`,
`SYNC_CRON_KEY`, `ACTIVA_SYNC_CRON_KEY`, `ALLOWED_ORIGINS`. Optional:
`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`.

---

## 6. Local development

There is no build step for the frontend. Open any HTML file in a browser or
serve them with a tiny static server:

```bash
cd path/to/repo
python3 -m http.server 8000
# then open http://localhost:8000/login.html
```

This talks to the **live** Supabase project — there's no local/staging
database. Edits to JS/HTML take effect on a hard refresh (or bump the
`?v=NN` cache-buster).

The Railway backend (`server.js`) isn't needed for most frontend work — only
for exercising OUS sync endpoints directly, which requires the env vars
above and network access to the OUS hosts.

---

## 7. Workflow

`main` is protected by a GitHub ruleset (`protect main`) — direct pushes are
blocked, and every PR must pass:
- `scan` — no leftover merge-conflict markers
- `validate-admin-bundle` — JSON-encoding + `node --check` validation of
  `admin-portal.html`'s bundler blob (see §2 above)

1. Branch off `main`, one logical change per branch/PR.
2. Bump the `?v=NN` cache query on any script you change.
3. If your change touches `admin-portal.html`, follow the decode → edit →
   re-encode procedure in `CLAUDE.md` — do not hand-edit the raw line.
4. If you add a file the site needs to serve (a new page, script or asset),
   add it to the `.vercelignore` allowlist — anything not listed there is not
   served in production and will 404.
5. Open a PR; CI must pass before merge.

This repo is public: never commit client names or emails, test logins,
credentials or API keys.

---

## 8. Common tasks

**Add a new admin/manager** — Admin → Team & Settings → invite by email;
`invite-team-member` sends them a signed invite link via `accept-invite.html`.

**Reset a client's password** — they click "Forgot password?" on the login
page; Supabase emails them a recovery link.

**Add a loan to a client** — Admin → Active Loans → **+ Add Loan** → pick
client → fill in loan details → Save. Most loans arrive via the OUS sync
instead of manual entry.

**Invite an existing client to the portal** — Admin → Clients → **Invite**
(or **Resend Invite**) on the client's row, then confirm. They get a
bilingual email with a 7-day, single-use link to `activate.html` where they set
their own password. The row then shows Invited, Activated, or Invite expired.
Only active/met clients with an email are eligible. Send in small batches and
check delivery before the next batch. This needs the Resend sender domain to be
verified first (see §9).

**Approve a pending registration** — Admin → Clients → Pending Approvals →
Approve. The client receives an "account activated" email automatically.

**Approve a loan application** — Admin → Applications → open the row →
Approve. A new loan is created and linked to the application.

**Review an OUS Activa match** — Admin → Loan Match Review → verify the
suggested client match (or use Create New Client for a genuinely new
borrower) before it's allowed to write a loan.

---

## 9. Domain, DNS and email sending

`onixfinance.com` is registered at Network Solutions, its DNS is hosted at
DreamHost (`ns1-3.dreamhost.com`), and its mail runs on Google Workspace. Any
DNS record for the steps below is added in **DreamHost**, not at the registrar.

### Email sending domain (Resend)

Client invites and other emails go through Resend. Until `onixfinance.com` is
verified there, only the sandbox sender works and it reaches only the Resend
account owner, so `send-client-activation` refuses to send.

1. Resend → Domains → add `onixfinance.com` (the root domain, so mail can come
   from `info@onixfinance.com`).
2. Add the records Resend shows at DreamHost: a `TXT` at `resend._domainkey`
   (DKIM), `CNAME`s at `send` and `rsend`, and optionally a `TXT` at `_dmarc`
   (`v=DMARC1; p=none;`). These sit on separate names and don't affect the
   existing Google Workspace mail records.
3. Click Verify in Resend and wait for the status to show Verified.
4. Set the Supabase edge function secrets `CLIENT_INVITE_FROM_EMAIL`
   (e.g. `Onix Finance <info@onixfinance.com>`) and optionally
   `CLIENT_INVITE_REPLY_TO`, `LOAN_APP_FROM_EMAIL` and `TEAM_INVITE_FROM_EMAIL`.
5. Send one test invite end to end before inviting real clients.

Check the current state of this in `CLAUDE.md` — at the time of writing, it is
waiting on DreamHost access. Also note that the domain registration is up for
renewal on 2026-12-02.

### Custom portal domain

The site currently serves at `onix-red.vercel.app` only — no custom domain
is configured yet. `portal.onixfinance.com` is already allow-listed in
Railway's `ALLOWED_ORIGINS` CORS config in anticipation of this, but the
domain itself hasn't been added in Vercel or pointed via DNS. To set it up:

1. Vercel dashboard → the project that serves `onix-red.vercel.app` →
   Settings → Domains → add `portal.onixfinance.com`.
2. Add the DNS record Vercel gives you (typically a `CNAME` to
   `cname.vercel-dns.com`) at DreamHost.
3. Once verified, add
   `https://portal.onixfinance.com/reset-password.html` and
   `https://portal.onixfinance.com/login.html` to Supabase Dashboard →
   Authentication → URL Configuration → Redirect URLs, or password-reset
   emails won't redirect correctly on the new domain.
4. Set `PORTAL_BASE_URL` for the edge functions and update Railway's
   `ALLOWED_ORIGINS` if it needs to change.

---

## 10. Known gaps

Tracked in `CLAUDE.md`'s "Open items" list, not duplicated here since it
changes often. It's a pointer, not the source of truth. Broad themes at the
time of writing: finishing client onboarding (Resend domain verification, then
batched invites), the Supabase free-tier limits, a few unanswered business
questions about deposits OUS no longer reports, and the brandbook
visual-fidelity pass, which hasn't been done.

---

## 11. Credits

Built by the Onix Finance team with assistance from Claude Code.

*Private & Confidential — Onix Finance, LLC*

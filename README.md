# Onix Finance — Client & Admin Portal

Bilingual (EN/ES) private lending and investment platform for a Houston-based
private lender. Clients view their loans, deposits, and documents; admins
manage every record and review data synced from two external loan-servicing
APIs (OUS Pasiva and OUS Activa).

**Live site:** https://onix-red.vercel.app/login.html

For day-to-day project history, open security/pending items, and detailed
system gotchas, see [`CLAUDE.md`](./CLAUDE.md) — this README covers
architecture and setup; `CLAUDE.md` tracks what's currently in flight.

---

## 1. Architecture

| Layer | Tool | Notes |
|---|---|---|
| Frontend | Vanilla HTML / CSS / JS | Static, no build step |
| Frontend hosting | [Vercel](https://vercel.com) | Auto-deploys from `main`; project name `onix`, live at `onix-red.vercel.app` |
| Backend proxy | Node/Express on [Railway](https://railway.app) (`server.js`) | Authenticates every `/api/*` call against a real Supabase JWT; proxies and syncs OUS Pasiva + OUS Activa data on a cron |
| Auth + DB | [Supabase](https://supabase.com) | Project `ckayfqplkpplgojdhjlu`. RLS enabled on every table |
| Email | [Resend](https://resend.com) via Supabase Edge Functions | Sandbox uses `onboarding@resend.dev` until a verified domain is set |
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
(`'ous_pasiva'` vs `'ous_activa'`). See `CLAUDE.md`'s "OUS Activa Integration"
section for the full architecture and known quirks (e.g. the current OUS
Activa connectivity issue, which is vendor-side, not app-side).

---

## 2. Pages

| File | Purpose | Auth |
|---|---|---|
| `login.html` | Sign-in page | Public |
| `signup.html` | Self-service registration | Public |
| `reset-password.html` | Password recovery landing | Public (requires Supabase recovery token) |
| `accept-invite.html` | Team member invite acceptance | Public (requires invite token) |
| `client-portal.html` | Client-facing dashboard | Requires `role='client'`, `status` in (`active`, `met`) |
| `admin-portal.html` | Admin console | Requires `role` in (`admin`, `manager`), `status !== 'rejected'` |
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
| `profiles` | Extends `auth.users`. `role` (`client`/`admin`/`manager`), `status` (`pending`/`met`/`active`/`rejected`) |
| `loans` | Real loans *and* Pasiva deposits, distinguished by `data_source` (`ous_pasiva`/`ous_activa`) |
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

Seven deployed (Supabase Dashboard → Edge Functions):

| Function | Triggered by | Purpose |
|---|---|---|
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
`NEW_CLIENT_NOTIFY_EMAIL`, `TEAM_INVITE_FROM_EMAIL`, `PORTAL_BASE_URL`.
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are injected automatically by
Supabase, not set manually.

---

## 5. Railway backend (`server.js`)

A small Express app, deployed as the `Onix` service in the `marvelous-surprise`
Railway project. Every `/api/*` route requires a real Supabase JWT; OUS sync
routes additionally accept a cron key. Responsibilities:

- Proxies OUS Pasiva (`54.165.232.64:7070`) and OUS Activa
  (`54.165.232.64:7575`) — both vendor APIs are otherwise unreachable from
  the browser (no CORS, and credentials shouldn't ship client-side anyway).
- Runs the sync logic (`runOUSActivaSync`, Pasiva's equivalent) invoked by
  two separate Supabase cron jobs 5 minutes apart.
- Rate-limits outbound calls to OUS (`createThrottle()`).
- `ALLOWED_ORIGINS` env var controls CORS — must include the live Vercel
  domain and any custom domain in use.

A second Railway service, `cozy-friendship`, runs `railway-status-snapshot.js`
once a day as a cron job and writes to `railway_status_snapshots`.

Required env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `OUS_API_URL`/`OUS_LOGIN`/`OUS_PASSWORD`,
`OUS_ACTIVA_API_URL`/`OUS_ACTIVA_LOGIN`/`OUS_ACTIVA_PASSWORD`,
`SYNC_CRON_KEY`, `ACTIVA_SYNC_CRON_KEY`, `ALLOWED_ORIGINS`.

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
4. Open a PR; CI must pass before merge.

---

## 8. Common tasks

**Add a new admin/manager** — Admin → Team & Settings → invite by email;
`invite-team-member` sends them a signed invite link via `accept-invite.html`.

**Reset a client's password** — they click "Forgot password?" on the login
page; Supabase emails them a recovery link.

**Add a loan to a client** — Admin → Active Loans → **+ Add Loan** → pick
client → fill in loan details → Save. Most loans arrive via the OUS sync
instead of manual entry.

**Approve a pending registration** — Admin → Clients → Pending Approvals →
Approve. The client receives an "account activated" email automatically.

**Approve a loan application** — Admin → Applications → open the row →
Approve. A new loan is created and linked to the application.

**Review an OUS Activa match** — Admin → Loan Match Review → verify the
suggested client match (or use Create New Client for a genuinely new
borrower) before it's allowed to write a loan.

---

## 9. Custom domain

The site currently serves at `onix-red.vercel.app` only — no custom domain
is configured yet. `portal.onixfinance.com` is already allow-listed in
Railway's `ALLOWED_ORIGINS` CORS config in anticipation of this, but the
domain itself hasn't been added in Vercel or pointed via DNS. To set it up:

1. Vercel dashboard → the `onix` project → Settings → Domains → add
   `portal.onixfinance.com`.
2. Add the DNS record Vercel gives you (typically a `CNAME` to
   `cname.vercel-dns.com`) at whichever provider manages `onixfinance.com`.
3. Once verified, add
   `https://portal.onixfinance.com/reset-password.html` and
   `https://portal.onixfinance.com/login.html` to Supabase Dashboard →
   Authentication → URL Configuration → Redirect URLs, or password-reset
   emails won't redirect correctly on the new domain.

---

## 10. Known gaps

Tracked living in `CLAUDE.md`'s "Still genuinely open" list, not duplicated
here since it changes often. As of this writing, the notable open items are:
OUS Activa's vendor-side connectivity issue (root-caused, fix is on the
vendor), no CSP/HSTS headers yet, and the brandbook visual-fidelity pass
hasn't been done. Check `CLAUDE.md` directly for the current list rather
than trusting this paragraph — it's a pointer, not the source of truth.

---

## 11. Credits

Built by the Onix Finance team with assistance from Claude Code.

*Private & Confidential — Onix Finance, LLC*

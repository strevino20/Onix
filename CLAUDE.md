# Onix Finance — Agent Notes

## Editing admin-portal.html

This file's real content is **not** the visible HTML — it's a JSON-encoded
string inside a single `<script type="__bundler/template">` tag near the
end of the file (a "bundler" export format). Everything before that tag is
a loading shell that decodes and mounts this blob at runtime.

**Never edit this file with git merge, cherry-pick, rebase, or any other
line-based tool.** The entire template lives on one line; a line-based
merge cannot meaningfully resolve conflicts in it, and has silently
corrupted the file more than once — including cases where corruption only
appeared *after* GitHub's actual merge, even though the branch-level diff
looked clean. Branch-level verification alone is not sufficient.

**Only ever edit it via decode → edit → re-encode:**

0. Back up first: `cp admin-portal.html admin-portal.html.bak-<timestamp>`.
1. Extract the JSON string from the `__bundler/template` script tag.
2. `JSON.parse()` it to get the real HTML/JS content.
3. Make the edit as a plain string replacement using a **function**
   replacer — `str.replace(old, () => newStr)` — never a string replacer.
   The content is full of `$`-prefixed currency-formatting code, and
   `String.replace()` treats `$&`, `$'`, `` $` `` etc. specially in a
   *string* replacement argument, silently splicing in huge unrelated
   chunks of the file. A function replacer inserts its return value
   verbatim with no special-pattern interpretation.
4. Re-encode with `JSON.stringify()`, **then escape nested `</script>` as
   `<\/script>`** before writing it back:
   ```js
   function safeStringifyForScriptTag(str) {
     return JSON.stringify(str).replace(/<\/script/gi, '<\\/script');
   }
   ```
   The decoded content has its own nested `<script>` tags (Chart.js CDN,
   i18n, the dashboard init script). `JSON.stringify()` does not escape
   forward slashes, so skipping this step leaves those nested closing
   tags as literal `</script>` — which a real browser's HTML parser
   treats as closing the *outer* `__bundler/template` tag at the first
   occurrence, silently truncating the blob to a few KB. This shipped
   broken once already. Local `JSON.parse()` on the raw line does **not**
   catch this, because it doesn't simulate a browser's HTML tag-boundary
   parsing — you have to check *how many `</script>` occur between the
   opening tag and where you claim the closing tag is*, or run a real
   `DOMParser` extraction.
5. Verify before trusting the edit:
   - Occurrence-count each anchor string in the decoded content before
     replacing (abort if it's not exactly 1).
   - `node --check` on every inline `<script>` block in the decoded
     content.
   - Confirm exactly one raw `</script>` exists between the opening
     `__bundler/template` tag and its true close, in the **final
     re-encoded file** (not just the decoded string).
   - Ideally, load the raw file text into a real browser's `DOMParser`
     and confirm the extracted `textContent` round-trips through
     `JSON.parse()` to the expected length — this is the only check that
     actually simulates what a real page load does.
6. After pushing, verify **live on the deployed site** (hard-refresh,
   check browser console) before considering the task done — local and
   even CI verification have both missed real breakage before.

**Keep changes to this file small and separate.** Do not bundle multiple
unrelated changes (e.g. a bug fix + a new feature) into one edit pass —
verify and ship one change at a time. A bundled chart-fix + feature change
was merged and reverted within the same session with no recorded
explanation; treat that as the reason this rule exists.

CI enforces the JSON-validity and `node --check` parts of step 5
automatically via `.github/workflows/validate-admin-bundle.yml` (required
status check `validate-admin-bundle`, runs on the PR merge result) — but
don't rely on CI to catch what local verification should already catch.

## Current status (as of 2026-11-02) — start here

This file used to be a stack of dated audit sections (late July → Oct 29)
that contradicted each other. It was rewritten on 2026-11-02 into the
current picture below. The old chronology is in git history (see "History"
at the end) — don't rebuild it from there unless you need a specific trail.

**This repo is public.** Never put client emails, client names, test
logins, credential details or API keys in this file or any committed file.
Things that must stay private live in Santi's private notes.

Confidence labels: "confirmed live" = checked against Supabase/Railway on
the date given. Everything else is from git history or relayed in chat.
Re-verify before relying on a number — they drift.

### What this is

Onix Finance is a bilingual (EN/ES) client-facing financial portal for a
Houston-based private lender: clients view loans, deposits and documents;
admins manage everything and review data synced from two vendor APIs.

| Piece | Where |
|---|---|
| Live site | `https://onix-red.vercel.app` (Vercel project `onix-red`, auto-deploys `main`) |
| Repo | `github.com/strevino20/Onix` (public by choice; transferred from `williamBking/Onix` on 2026-09-18) |
| Backend | Express proxy `server.js` on Railway, service `Onix` in project `marvelous-surprise`; domain `onix-production-50c3.up.railway.app` |
| Second Railway service | `cozy-friendship`, daily cron running `railway-status-snapshot.js` → `railway_status_snapshots` |
| Database/Auth/Storage | Supabase project `ckayfqplkpplgojdhjlu`, free plan |
| Email | Resend, called from Supabase Edge Functions (sender domain not verified yet, see Onboarding) |
| Domain | `onixfinance.com`: registrar Network Solutions, DNS at DreamHost, mail on Google Workspace |

Working-style rules, branch protection and CI are in "How we work" below.

### Where things stand

**Syncs (confirmed live 2026-11-02).** Both OUS syncs run every 15 min via
Supabase pg_cron → Railway, 5 min apart (`ous-pasiva-sync-15min`,
`ous-activa-sync-15min`). Last 24h: Pasiva 94/96 ok, Activa 95/96 ok. The
two Pasiva failures were `loans upsert failed HTTP 409` bodies containing a
Cloudflare "Error 1001: DNS resolution error" — transient on the Supabase
side, not seen as a pattern; look again only if it recurs.
`loans`: `ous_pasiva` 168 active / 54 paid, `ous_activa` 59 active / 9 paid.
Activa review queue (`ous_activa_client_matches`): 78 verified, 67
unverified rows.

**OUS Activa outage — over.** Syncs failed from 2026-08-20 to 2026-10-29
(`connect ETIMEDOUT` on the Activa login call, port 7575) and resumed at 18:05 UTC
on 2026-10-29 after OUS restarted their system; no change on our side
fixed it. The server was never down; port 7575 just would not answer
Railway until the restart, and what the restart cleared is unknown. Our
egress IP was confirmed from production as one of Railway's three static
outbound IPs, which OUS already allowlisted (the IPs are in Railway → `Onix`
→ Networking and Santi's private notes, not here). If it recurs, give OUS
those three IPs and ask them to confirm 7575 is listening and allowlisted. Don't re-diagnose from
outside: probes from other networks time out on both ports.

**Stale-deposit closing — shipped (PR #255, 2026-11-02).** `runOUSSync()` /
the Activa sync used to leave loans `active` forever once OUS stopped
returning them (cierre-saldos returns only open credits), double-counting
renewed money. Now each sync marks loans OUS no longer reports as `paid`
(balance kept, not zeroed). Guards: skip on an empty response, on a >10%
drop in rows vs the last run, or if more than 10 loans would close in one
run. The client portal maps `paid` deposits to `exited` so they leave
totals and charts. Live result: 54 Pasiva and 9 Activa loans are now `paid`
(they went from 0 Pasiva paid; the 9 Activa are the ones absent after the
outage). It is reversible: `upsertLoan` rewrites `status`/`balance` on the
next sync if OUS returns the credit. What's **not** recorded: Carlos's
business answer on whether "OUS stopped reporting it" means closed. Open
questions for him: a handful of deposits dropped out *before* maturity (IDs
in private notes), and a few matured deposits OUS still reports with a
balance and rising `days_delinquent`. Those are
business questions, not sync bugs; the fix deliberately leaves the second
group untouched. The repo has no tests; the reversibility claim was checked
only against a mock OUS + Supabase.

Unverified from the Oct 19 review: about a third of Pasiva syncs (all in
00:00–09:00 UTC) returned 0 rows, probably because `fecha_cierre` uses the
UTC date, which is already tomorrow in Mexico after 6pm. The empty-response
guard covers it; fixing the date to Mexico time would be a separate change.

### Client onboarding (in progress)

Goal: get real clients logging in, in batches — Patrick wants **5 clients**
first, then 10, and so on. Sync-created clients have a random password
nobody knows, so staff send each one a one-time activation link.

Built and deployed (PRs #252, #253, #254):
- `client_activations` table (migration `20261029220000`): stores only a
  SHA-256 hash of each token; one live link per client; staff can read, only
  the service role writes. Statuses: pending / used / revoked / expired.
- Edge function `send-client-activation`: callable by any active staff
  (role `admin` or `manager`; **AEs are `role='admin'` with `title='ae'`, so
  they are included** — Santi confirmed 2026-11-02 that every admin may
  invite anyone, leave it). Up to 25 clients per call, active/met clients
  with an email only, bilingual email (client's language first), 7-day link,
  sends paced 600ms apart, revokes the link if the send fails. **Refuses to
  run without `RESEND_API_KEY` and `CLIENT_INVITE_FROM_EMAIL`.**
- Edge function `activate-client-account` + `activate.html`: validates the
  link, claims it, sets the password on the client's existing auth account.
  Never creates accounts or changes role/status.
- Admin Clients view: per-row **Invite / Resend Invite** button (active or
  met, has email, not yet activated) and an "Invited / Activated / Invite
  expired" line under the status badge.
- `send-account-activated-email` and `invite-team-member` now read
  `PORTAL_BASE_URL` (default `https://onix-red.vercel.app`); they used to
  point at the dead GitHub Pages URL.

State (confirmed live 2026-11-02): `client_activations` holds 4 rows, all
test artifacts from Oct 21/29 (no Resend `email_id`, no sender recorded; one
was "used" 10 seconds after sending). **No real invite has been sent.**
141 of 142 client profiles are eligible.

**Blocked on Resend domain verification — waiting for DreamHost access.**
Santi added `onixfinance.com` (root domain, so the sender can be
`info@onixfinance.com`) in Resend on 2026-11-02; status "Not Started" (see
Resend → Domains). Santi does not have DreamHost access yet; someone who does has to add these
records (none of them exist today, so nothing conflicts; mail is Google
Workspace with working MX):

Santi asked Carlos about DreamHost access on 2026-11-04 and is waiting for the
answer; decided to wait rather than take a workaround. Alternatives set aside
for now: sending from `send-client-activation` through Google Workspace SMTP
(needs no DNS) and manual invite links.

| Type | Name | Value |
|---|---|---|
| TXT | `resend._domainkey` | the DKIM `p=MIGfMA…` key — copy it from the Resend page |
| CNAME | `rsend` | `rsend.forge.rmta.net` |
| CNAME | `send` | `send.forge.rmta.net` |
| TXT (optional) | `_dmarc` | `v=DMARC1; p=none;` |

Then Verify in Resend and set these Supabase edge function secrets (Santi
wants `info@onixfinance.com` for everything): `CLIENT_INVITE_FROM_EMAIL` =
`Onix Finance <info@onixfinance.com>`, `CLIENT_INVITE_REPLY_TO` =
`info@onixfinance.com`; optionally also `LOAN_APP_FROM_EMAIL` and
`TEAM_INVITE_FROM_EMAIL` (without them those emails still come from the
sandbox sender `onboarding@resend.dev`, which only reaches the Resend
account owner). Confirm `RESEND_API_KEY` exists — secrets can't be read
through the Supabase MCP connector. Never ask for the key in chat.

Next after Resend: send one test invite to a test account end to end,
invite the first 5 real clients, check results (delivery, activation,
bounces) before the next 10. **Not built:** a multi-select / batch invite
(the button is per row), and nothing marks a client as part of a batch.
Open credential-hygiene item for some client accounts: details are
deliberately not recorded here; ask Santi.

**Registration expiry:** `onixfinance.com` at Network Solutions expires
**2026-12-02**. Auto-renew state is unknown. If it lapses, `info@` mail and
anything on the domain break. Santi needs whoever holds that account to
confirm renewal (and DreamHost access, same conversation).

### Open items (most urgent first)

1. **`onixfinance.com` registration expires 2026-12-02** (see above).
2. **Supabase free-tier limits.** Storage confirmed over the free limit
   (2026-09-21; likely the `client-documents` bucket, ~1,171 docs); a paid
   upgrade is probable. Project was `ACTIVE_HEALTHY` as of 2026-09-18, margin
   to auto-pause unknown. Leaked Password Protection is a paid feature,
   still disabled, bundled with the same upgrade decision. Pro fixes storage
   and Leaked Password Protection but **not** email: Supabase's built-in SMTP
   only delivers to organization team members (`email_address_not_authorized`
   for anyone else) and only sends Auth emails. Client activation emails go
   out of the edge function via Resend, so they depend on domain verification,
   not the plan.
3. **Resend domain verification / DreamHost access** (above).
4. **Carlos's answers on the stale-deposit questions** (above). Portal audit
   of 2026-11-04 (counts, 141 active/met clients): render matches the DB for
   all of them (PRs #258/#259 fixed exited-deposit cards and the dashboard
   loan total). Still to review against OUS, deliberately left pending: 4
   duplicate active rows (same client, principal, rate, maturity), 9 active
   rows past maturity, 19 Pasiva rows whose balance differs from principal
   by >1%, 5 Pasiva rows maturing in <90 days with no `next_due_date`, 8
   Activa `paid` rows still holding a balance. `profiles.is_borrower` is not
   reliable (91 flagged borrowers have no Activa credit). The audit was a
   Playwright run of the real `client-portal-data.js` with stubbed `OnixDB`
   data per client; it checks render vs DB, not DB vs OUS.
5. **Supabase Auth dashboard: confirm the project-level minimum password
   length is 8** — Santi checks this, no tool can. The last open item from
   the 2026-09 security audit.
6. **Delete the leftover empty intern test login** in the Supabase
   dashboard (Authentication → Users); which account it is lives in Santi's
   private notes. Confirmed empty on 2026-10-15; the permission check blocks
   irreversible deletes, so Santi has to do it.
7. **OUS Activa review queue**: 67 unverified match rows and the new credits
   from after the outage wait in the Loan Match Review tab.
8. **Remove the temporary `/diagnose-egress` endpoint** (PR #249) only when
   Santi says so; he wants it kept for now. It's admin-only and sends no
   credentials.
9. **Railway access for Carlos**: Santi invited him to `marvelous-surprise`;
   an expired pending invite is still listed (Santi's call whether to remove
   it). `cozy-friendship`'s GitHub source still points
   at the old owner (Settings shows "Could not load branches"); the cron still
   runs. It also rebuilds on every push — low severity wasted build minutes.
10. **Not integrated:** OUS Activa's `proximo-pagos` / `historico-pagos`.
    (Pasiva's `proximo-pagos` is wired up; don't conflate the two.) Activa
    sync never writes `loans.next_due_date`, so single-payment Activa loans
    show no due date to the client unless an admin sets it manually — a
    product decision for Patrick, not a bug.
11. **Product/UX, deferred by Santi:** Clients view filter (All / Lending /
    Investors, using `is_borrower`/`is_lp`; a filter, not separate tabs); the
    client Profile "Raise Alerts" toggle does nothing; brandbook styling audit
    (the `Onix Brandbook.pdf` lives in the `onix-servicing-dashboard` folder);
    HSTS and Permissions-Policy headers.
12. **Undecided:** the standalone `onix-servicing-dashboard` project (paused,
    its own `loans` table in a separate Supabase project) — don't assume any
    consolidation direction without asking Santi. An outside-counsel loan-file
    audit is a possible driver for a compliance-tracking feature; nothing is
    built, and Santi owns the workbook and matching files to loans (details in
    his private notes, not here).
13. **Housekeeping:** many stale remote branches; untracked local files
    (`Onix_Finance_Portal_PRD_branded.docx`, `Onix_Summary_of_Findings (2)
    copy.docx`, a `.bak` of admin-portal.html) — confirm with Santi before
    deleting; GitHub secret scanning is off (free, worth enabling);
    `cozy-friendship`/`Onix` env var naming differs (`SUPABASE_SERVICE_KEY` vs
    `SUPABASE_SERVICE_ROLE_KEY`).

### Closed — don't re-raise these

- OUS Activa outage (see above) and the claim that it was a vendor-side
  server outage.
- Rate limiting: inbound per-IP (120 req/min, `trust proxy: 2`; PRs #226/#227)
  and outbound OUS throttling (PR #206) both exist.
- Security audit items fixed: open email relay on two edge functions, the
  pending-approval RLS gate (clients need `status IN ('met','active')`),
  legacy `onclick` localStorage leak, `package-lock.json`, CSP enforcing
  (PRs #229/#230), logout clears all `onix-*` keys, constant-time cron key
  compare (#245), friendly client-portal errors (#246), `.vercelignore`
  allowlist after internal files were publicly served (#241), revoked public
  EXECUTE on `ous_activa_sync_trigger()` (#251).
- `charged_off` loan status bug (PRs #217/#218); `loan_id_display` collision
  between Pasiva and Activa (#239/#240, unique per `data_source`);
  `findOrCreateAuthUser()` wrong-account reuse (#243).
- `profiles.admin_notes` dropped; `view-review` removed; PRs #106/#107 closed
  as resolved elsewhere; `verified_at`/`verified_by` inconsistency on
  `ous_activa_client_matches` is historical seed data, not a live bug.
- The advisor's SECURITY DEFINER warnings for `handle_new_user` /
  `trg_loan_payments_recalc` are false positives (trigger-typed functions
  can't be called directly); the helper functions (`is_admin`, `is_ae`,
  `is_staff_admin`, …) only report the caller's own role.
- The "~20 multiple permissive policies" advisor warnings are the deliberate
  admin-all + self-own pattern.

## Architecture facts worth knowing

### Roles and RLS

`profiles.role` is `client` / `admin` / `manager`; `profiles.status` is
`pending` / `met` / `active` / `rejected`. **Account executives are
`role='admin'` with `title='ae'`**, not a separate role. `is_admin()` is true
for `admin` and `manager`; `is_staff_admin()` means title `admin`;
`is_ae()` means title `ae`. AEs are blocked from creating clients (RLS check
in `admin_create_client()` plus `requireNotAE` on `POST
/api/activa-create-client`; the admin UI also hides the buttons). RBAC is
built as small targeted fixes on the RLS foundation, not one sweeping change.
Policies follow admin-all + self-own + RESTRICTIVE non-admin-cannot-write,
with `(select auth.uid())` wrapped for per-query evaluation. Anonymous access
to `raises`/`raise_documents` is gone. `ous_activa_client_matches`,
`ous_sync_log` and the `ous_*` capture tables are admin-only; the
`ous_latest_capture` view is `security_invoker`.

### OUS Pasiva vs OUS Activa

Same vendor and host (address in `server.js`), different ports and meanings:
**Pasiva** (`:7070`) = deposits/liabilities, client money coming in;
**Activa** (`:7575`) = real loans, money lent out. Treated as fully
independent in code: separate sync functions (`runOUSSync`,
`runOUSActivaSync`), routes, cron jobs, log tables, env vars
(`OUS_*` / `OUS_ACTIVA_*`, `SYNC_CRON_KEY` / `ACTIVA_SYNC_CRON_KEY` — never
cross-referenced). Base URL and login for Activa come from the official API
manual, which is not in the repo; ask Santi to re-share it if needed.
Credentials live only in Railway env vars, never in the repo.

- `loans.data_source` (`'ous_pasiva'` default / `'ous_activa'`, NOT NULL)
  separates real loans from deposits. Everywhere that used `ous_synced_at`
  as a type discriminator now checks `data_source !== 'ous_pasiva'`. Both
  syncs upsert on `(data_source, loan_id_display)`.
- **Pasiva auto-creates a placeholder client** (when an email exists) with
  no human review. **Activa never does**: unmatched borrowers accumulate in
  `ous_activa_client_matches` for an admin to verify in the **Loan Match
  Review** tab (RFC auto-suggest, plus a "Create New Client" action via
  `activa_admin_create_client()`), and `runOUSActivaSync()` only writes a loan
  for a verified match. `loans.user_id` is `NOT NULL`, so "no match" can't leak
  into `loans`, but "matched but unverified" is prevented only by the
  `if (!matchRow.verified || …) continue` check in that function — be
  careful there.
- `mapActivaStatus()` only returns `'active'`/`'review'`; `loans.status`
  allows `active` / `paid` / `review` / `charged_off` (migration
  `20260922175100`, client portal labels it).
- `parseTermMonths()` handles `"N SEMANAS"` as well as days/months.
- Source data quality: `nombre_cliente` isn't unique and many `rfc` values
  are placeholder junk (repeated letters, no 6-digit date); apply a
  plausibility filter before trusting `rfc`.
- A verified match with no live-sync coverage yet writes no loan (a credit
  that closed or renewed between seeding and the live pull). "Verified
  count" and "loans written" therefore don't match 1:1 — expected.
- pg_net's cron call has a 5s timeout, but it's fire-and-forget: check
  `ous_sync_log` / `ous_activa_sync_log` (timestamp column `ran_at`) for the
  real result, never the trigger call.
- Outbound calls to OUS are rate-limited (`createThrottle()`).
- `loans.next_due_date`: Pasiva's `proximo-pagos` looks 90 days ahead, so a
  single-payment loan maturing later correctly has none yet; overdue dates
  are kept (fixed in #208) and shown as "X days overdue" in the client portal
  (`fmt.isOverdue()`, #209). Only ~96 of 252 active loans had one when
  checked on 2026-08-28.

### Frontend pitfalls

- **Vercel**: the repo's root `package.json` belongs to the Railway backend,
  so on a fresh import Vercel auto-detects an Express app and serves
  `server.js` itself. Fixed by the `.vercelignore` **allowlist** and the
  project's Framework Preset set to **Other** — redo both if the repo is ever
  re-imported. **A new file the site needs must be added to the
  `.vercelignore` allowlist or it 404s in production.** If a second Vercel
  project for this repo reappears, delete it; `onix-red` is canonical.
- **CORS**: `ALLOWED_ORIGINS` on Railway is `https://onix-red.vercel.app,
  https://portal.onixfinance.com` and does not follow a Vercel domain change.
  A custom domain also needs adding to Supabase Auth Redirect URLs.
- **CSP** (in `vercel.json`) is enforcing; inline script/style allowances are
  intentional because `admin-portal.html` recreates its inline scripts at
  runtime. Any new external origin must be added to it.
- **Dates**: bare `YYYY-MM-DD` columns must go through `parseLocalDate()` in
  `client-portal-data.js`; `new Date('YYYY-MM-DD')` reads as the previous day
  in US time zones (six call sites were fixed in #214).
- **Chart.js** is vendored (v4.4.0, gzip+base64 in the bundle manifest).
  Never replace `chart.data` / `chart.options` sub-objects wholesale on an
  existing instance — mutate in place (`array.length = 0; array.push(...)`),
  then `chart.update()`, or it hits a Proxy `RangeError: Maximum call stack
  size exceeded` from the option-scope merger.
- The admin Clients rows are clones made by `splitClientsBySection`, which
  drops listeners; use delegated listeners on `document`.
- The admin-portal debug log is gated behind `localStorage['onix-debug']`;
  the Financial Reports tab is detected by the stable `id="view-documents"`.
- Source for only four edge functions lives in `supabase/functions/`
  (`activate-client-account`, `invite-team-member`,
  `send-account-activated-email`, `send-client-activation`). The other five
  deployed functions (`send-loan-app-email`, `send-new-client-email`,
  `send-payment-confirmation-email`, `accept-team-invite`,
  `import-ous-clients`) exist only in Supabase.
- Edge functions that send email or do privileged work must re-verify the
  caller is a signed-in admin inside the function (`verify_jwt` alone is
  satisfied by the public anon key). Follow `invite-team-member`.

### Railway

- Env vars the `Onix` service reads: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `OUS_API_URL` / `OUS_LOGIN` / `OUS_PASSWORD`,
  `OUS_ACTIVA_API_URL` / `OUS_ACTIVA_LOGIN` / `OUS_ACTIVA_PASSWORD`,
  `SYNC_CRON_KEY`, `ACTIVA_SYNC_CRON_KEY`, `ALLOWED_ORIGINS`, optionally
  `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX`. `PORT` is injected by Railway.
- Static Outbound IPs (three, shared) are enabled on `Onix`; OUS allowlists them.
- Railway filters deploys by watched path: frontend-only PRs show SKIPPED.
  Auto-deploy broke after the 2026-09-18 transfer (service source pointed at
  the old repo path and the GitHub App wasn't installed on the new account);
  fixed 2026-09-23 and verified with a real PR.
- Quirks: the service Console tab failed to connect (hence `/diagnose-egress`);
  the project Invite dialog doesn't work through browser automation, so
  invite manually. The Railway MCP's `list-projects` shows empty but
  project-scoped calls with the known project ID work.

### Edge function secrets

Supabase Dashboard → Edge Functions → Secrets: `RESEND_API_KEY`,
`LOAN_APP_NOTIFY_EMAIL`, `LOAN_APP_FROM_EMAIL`, `NEW_CLIENT_NOTIFY_EMAIL`,
`TEAM_INVITE_FROM_EMAIL`, `PORTAL_BASE_URL`, `CLIENT_INVITE_FROM_EMAIL`,
`CLIENT_INVITE_REPLY_TO`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically.

## How we work

- **One logical change = one branch = one commit = one PR**, however small.
  Don't bundle a bug fix with a feature, especially in `admin-portal.html`.
- **Show the diff and wait for an explicit go-ahead before committing**, for
  every change, not just `admin-portal.html` ones.
- **Claude commits, pushes and opens the PR after the go-ahead; Santi
  merges.** Never merge yourself.
- Commit promptly: other sessions share this repo, and uncommitted work can
  get swept into their commits.
- Proposing a better technical alternative than what was literally asked is
  welcome if clearly flagged and justified: implement it, say what you
  changed and why, and let Santi confirm or override.
- Verify UI fixes with Playwright against the real app code before calling
  them done, and verify live after deploy.
- **Before any `git reset --hard` or other command that discards work, run
  `git stash -u` first if `git status` shows anything uncommitted.** A reset
  once destroyed an unstaged CLAUDE.md edit with no way back.
- `main` is protected by the "protect main" ruleset (`bypass_actors: []`):
  PRs only; required checks `scan` (no merge-conflict markers) and
  `validate-admin-bundle` (JSON validity and `node --check` of the bundle).
  The checks are a backstop, not a substitute for the local verification in
  "Editing admin-portal.html".
- Bump the `?v=NN` cache query on any script you change.
- Use `dig @8.8.8.8` with full output for DNS checks; `+short` returned false
  empty answers in this environment.

## Features shipped (summary)

Details are in git history; this is only to know what exists.
- **Client portal**: loans, deposits, documents, self-service profile edit,
  express-interest modal, deposit option on New Application, real charts and
  repayment progress, payments folded into My Loan, overdue framing.
  Removed fake features (distribution history, quarterly-calls toggle,
  2FA toggle). `2fa-totally-legit.png` is a joke button, not a feature.
- **Admin portal**: dashboard KPIs ("Loan / Deposit Ratio", formerly
  "Portfolio LTV"), clients/loans/investments/raises, Loan Match Review,
  document manager (`client_documents` + `client-documents` bucket), admin
  profile modal, admin-only client notes (`client_admin_notes`), calendar
  with monthly cashflow in/out (reworked many times — read the diffs before
  touching it), team invites, Missing Document filter, ID/Passport combined
  filter, client names in ALL CAPS, Invite buttons.
- **Document migration**: 1,171 documents across 88 clients migrated from
  Google Drive; ~62 Drive folders still need manual client matching (the
  one-time script lives in `onix-folder-migration/`, outside this repo — ask
  Santi).

## History

The previous, much longer version of this file (dated sections from July to
Oct 29 2026, including the per-session handoff notes and the full OUS Activa
outage investigation) is in git history: `git log --follow CLAUDE.md`. The
last version before the 2026-11-02 rewrite is at commit `7e0c38e`.

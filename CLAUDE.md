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

## Project Status & History (as of late July 2026, see Sept 18 audit below)

Comprehensive handoff summary for a fresh session with no prior context.
Every fact below was independently re-verified against the live codebase
and Supabase project (not transcribed blindly) as of this writing. **This
section is now stale — read the "Sept 18 2026 audit" section near the end
of this file first**, it's the current entry point and supersedes the
"Aug 20 2026 audit" addendum below it, which corrects several items in
this section (notably the two "Known pending items" and the OUS Activa
"Not yet built" list) but is itself now superseded where the two
disagree.

**Before touching `admin-portal.html`, read "Editing admin-portal.html"
above first** — it's current and unchanged; nothing below duplicates it.

### Project overview

Onix Finance is a bilingual (EN/ES) client-facing financial portal for a
Houston-based private lender, serving both clients (loan/investment
management) and admins. Live at williambking.github.io/Onix. Supabase
project: `ckayfqplkpplgojdhjlu`.

### What's live and working

- **Client portal**: loan/investment viewing, document access, bilingual
  UI, and self-service profile editing (name/phone/address/date of
  birth) — confirmed genuinely wired to `profiles.update(...).eq('id',
  userId)` in `client-portal-data.js` (`wireProfileForm`), not cosmetic.
- **Admin portal**: full dashboard, client/loan/investment/raise
  management, calendar, document manager (`client_documents` table +
  `client-documents` Storage bucket), an admin self-service profile
  modal (`__onix_profile` in `admin-portal.html`), and admin-only client
  notes (`client_admin_notes` table — confirmed to exist with
  `profile_id`/`notes`/`updated_at`/`updated_by`).
- **Document migration**: confirmed via direct query — **1,171
  documents across 88 distinct clients** in `client_documents`. Roughly
  62 Drive folders still need manual client-matching; there's a
  documented process for this (folder-to-client fuzzy matching,
  cross-referencing against loan balances, manual verification, batch
  migration via a one-time script in `onix-folder-migration/`, which
  lives *outside* this git repo as a sibling directory — ask the user
  for details if this comes up again).

### Critical security fixes applied — all confirmed still in place

- **RLS permissive-OR bug, fixed.** Checked `pg_policies` on `profiles`,
  `loans`, `investments`, `loan_payments`, `distributions` directly: no
  "ae scope" policies remain on any of them. Only clean, correctly-
  scoped policies exist now (`X_admin_all` via `is_admin()`,
  `X_select_own` via ownership check, plus RESTRICTIVE non-admin-cannot-
  write policies via `is_staff_admin()`).
- **`ous_sync_log` / `ous_latest_capture`, locked down.** `ous_sync_log`
  has RLS enabled with a single admin-only SELECT policy.
  `ous_latest_capture` (a view) has `security_invoker=true` set —
  confirmed directly via `pg_class.reloptions` — so it no longer
  bypasses RLS on the underlying `ous_raw_capture` table (which itself
  also has RLS enabled + an admin-only policy).
- **`ous_sync_trigger()` / `recalc_loan_state(uuid)`, execution
  restricted.** Checked `pg_proc.proacl` directly: both show EXECUTE
  granted only to `postgres` and `service_role` — no
  `authenticated`/`anon`/PUBLIC grant remains.
- **RLS performance work**: confirmed `auth.uid()` calls are
  consistently wrapped as `(select auth.uid())` across every policy
  checked (per-query, not per-row, evaluation). FK-shaped indexes exist
  on most foreign-key columns (`*_user_id_idx`, `*_uploaded_by_idx`,
  `*_related_*_idx`, etc.) — Supabase's own performance advisor
  currently reports these as "unused" (not missing, just not yet
  exercised by real traffic — expected for a low-traffic app). Note:
  the advisor still reports ~20 "multiple permissive policies" warnings
  today (e.g. `profiles` has both `profiles_select_admin` and
  `profiles_select_self` as separate PERMISSIVE SELECT policies) — this
  is the deliberate admin-all + self-own two-policy pattern used
  throughout the schema, not redundant/accidental duplication. Couldn't
  independently verify the historical "~40 removed" figure with no
  prior snapshot to diff against, but the current policy set looks
  intentional and clean.
- **`raises` / `raise_documents` now require login.** Confirmed: both
  `raises_select_authenticated` and `raise_documents_select_authenticated`
  are scoped to `roles={authenticated}`, not `{public}`/`{anon}` —
  anonymous access is gone.
- **Still pending**: "Leaked Password Protection" is confirmed still
  disabled (checked via Supabase's security advisor) — user has not yet
  been able to enable it from the dashboard.
- **Not a new concern, already investigated**: Supabase's advisor flags
  several `SECURITY DEFINER` functions as directly callable via
  PostgREST RPC by `anon`/`authenticated` (`admin_create_client`,
  `current_admin_title`, `enforce_onix_admin_permissions`, `is_admin`,
  `is_ae`, `is_staff_admin`, `handle_new_user`,
  `trg_loan_payments_recalc`). The helper/check functions are benign by
  design (they just tell the caller their own role, which grants
  nothing). `handle_new_user` and `trg_loan_payments_recalc` are
  confirmed scanner false positives: both have return type `trigger`
  (verified via `pg_proc.prorettype`), and Postgres physically refuses
  to execute a trigger-typed function outside of an actual table
  trigger firing, regardless of any GRANT — this isn't a permissions
  gap, it's a structural language restriction. No further action needed
  here; don't re-investigate this from scratch in a future session.

### CI/CD safety net

- GitHub ruleset **"protect main"**: confirmed fresh via API —
  `enforcement: active`, requires both `scan`
  (no-merge-conflict-markers) and `validate-admin-bundle`,
  `bypass_actors: []`. Direct pushes to main are blocked — everything
  goes through a feature branch + PR.
- `validate-admin-bundle.yml` specifically catches JSON-encoding
  corruption in `admin-portal.html` before merge (this file has been
  corrupted twice historically by git merge/cherry-pick — never use
  those on this file; see "Editing admin-portal.html" above).

### Known pending items / open threads

- **PRs #106 (`ous-portal-integration`) and #107 (`rbac-comprehensive`) —
  RESOLVED, both closed without merging (confirmed via GitHub, Aug 20
  2026).** #106 was closed by jwellsgranger on 2026-07-29 as "resolved
  elsewhere" — the underlying problem was fixed by separate, already-
  merged commits on main. #107 was also closed as "resolved elsewhere" —
  comprehensive role-based permissions ended up implemented at the
  database level via Postgres RLS policies/triggers instead of this PR's
  JS-side approach; the codebase had also moved too far for a clean
  merge. As of Aug 20 2026 there are 0 open PRs on the repo. Don't re-
  raise "revive or close #106/#107" as an open question, it's done.
- **Railway backend** (Express proxy to OUS Pasiva, `server.js`):
  fundamentals confirmed solid (real Supabase-JWT auth on every
  `/api/*` route including `/api/ous-capture`, no leaked secrets,
  proper CORS allowlist, graceful degradation when OUS is down). Of the
  three items previously flagged as unverified, two are now resolved —
  see "Aug 20 2026 — Railway live verification" near the end of this
  file for full detail: (1) env vars confirmed to match, (2) the
  redeploy-on-every-push hypothesis is disproven (Railway correctly
  skips deploys via watched-path filtering). (3) no rate limiting on OUS
  API calls yet — still genuinely open, this one is a code fix, not a
  Railway config question.
- ~~**`view-review`** in `admin-portal.html`'s decoded template~~ —
  **REMOVED, PR #174 (`d938557`, "Remove dead view-review section from
  admin-portal.html").** Confirmed merged via git history (Aug 20 2026
  audit). Don't re-flag this as pending.
- ~~**`profiles.admin_notes`** column~~ — **DROPPED, migration
  `drop_admin_notes_from_profiles` (2026-08-28).** Confirmed vestigial
  (superseded by the dedicated `client_admin_notes` table), confirmed
  empty across all rows, then dropped. See the Aug 28 2026 section
  below for the full trail. Don't re-flag this as pending.

### Upcoming work

User is about to start integrating a new third-party API (separate and
different from the already-integrated OUS Pasiva API). Standard
workflow for this project: test the new API's endpoints in Postman
first, get credentials/docs from the user's boss, plan Supabase schema
(with RLS from day one, not bolted on after) before writing sync code,
likely extend or mirror the existing Railway Express.js proxy pattern
used for OUS Pasiva.

## OUS Activa Integration (added late July 2026)

Second major API integration, landed as PR #163 (merged 2026-07-29,
16:35 UTC). A fresh session should be able to work from this section
alone without re-deriving it from server.js.

### What this is

OUS Activa is a separate API from the already-integrated OUS Pasiva.
Pasiva = deposits/liability side (client money coming in); Activa =
real loans/asset side (money Onix lends out). Base URL
`http://54.165.232.64:7575/api` — same host as Pasiva's confirmed
`http://54.165.232.64:7070/api` (see server.js's header comment), just
a different port, which is at least consistent with "same
business/infrastructure provider" even though the two are treated as
fully independent in code. Documented in the official OUS Activa API
manual; ask the user for the actual document if it's needed for
reference — it doesn't live in this repo. Login credentials are the
same as Pasiva's per the business side, but nothing in code assumes
that: separate session state, separate everything (see below),
specifically because it was never actually confirmed to be the same
underlying backend, only the same vendor.

### Key architecture decisions (and why)

- **`loans.data_source`** (text, `NOT NULL`, default `'ous_pasiva'` —
  confirmed live) added to distinguish real loans from deposits, since
  `ous_synced_at` alone was being overloaded as a type discriminator in
  ~14 places across the codebase (admin dashboard KPIs, Loans/Active
  Deposits views, global search, dashboard + Reports charts, calendar,
  client My Loan/My Investments/Payments, supabase.js query filters).
  All updated to check `data_source !== 'ous_pasiva'` instead (PRs
  #159/#160). A same-day follow-up (PR #162, not from this line of
  work — landed via a teammate, "Wells") found and fixed a few more
  spots on the admin Clients views with the same underlying bug in a
  different shape.
- **`ous_activa_client_matches`** — a *persistent* review/matching
  table, not a one-time thing like the Google Drive folder migration
  was, because this API is synced repeatedly (every ~15 min). An admin
  verifies a match once; future syncs just refresh `last_seen_at`
  without re-matching or touching the review fields.
- **CRITICAL SAFETY PROPERTY** — confirmed live: `loans.user_id` is
  `uuid NOT NULL` with no default. A loan is structurally incapable of
  being inserted without a real `user_id`, so "no match at all" can
  never leak into `loans`. But "matched-but-unverified" leaking in is
  **not** database-enforced — it's only prevented by
  `runOUSActivaSync()`'s own `if (!matchRow.verified || …) continue`
  check. Worth knowing before anyone touches that function.
- **Fully separate infrastructure from Pasiva, by design**: separate
  sync function (`runOUSActivaSync`), separate route
  (`/api/activa-sync-run`), separate cron job
  (`ous-activa-sync-15min`, confirmed live — offset 5 min from
  Pasiva's `ous-pasiva-sync-15min`, both `active: true`), separate log
  table (`ous_activa_sync_log`, confirmed live), separate env vars
  (`OUS_ACTIVA_LOGIN`/`PASSWORD`/`API_URL`, `ACTIVA_SYNC_CRON_KEY` —
  confirmed to never cross-reference `SYNC_CRON_KEY` anywhere in
  server.js). Deliberately not merged with Pasiva's sync: different
  field shapes, different matching/review requirements (Activa
  requires human verification; Pasiva auto-creates with zero review).
- **Client auto-creation differs between the two systems.** Pasiva
  auto-creates a placeholder client unconditionally on every sync (no
  human review) whenever an email exists. Activa deliberately does
  *not* — unmatched borrowers just accumulate in
  `ous_activa_client_matches` for manual admin review/creation. A
  deliberate divergence, not an oversight — see "Not yet built" below
  for the admin action this implies but doesn't have yet.

### Known quirks worth knowing

- **pg_net's cron trigger has a 5-second timeout — confirmed via
  `net.http_post`'s actual signature** (`timeout_milliseconds integer
  DEFAULT 5000`, not overridden by either `ous_sync_trigger()` or
  `ous_activa_sync_trigger()`), while the one real Activa sync so far
  took 24,952ms (~25s). This is expected and harmless for both syncs:
  `net.http_post` queues the request and returns immediately
  (fire-and-forget via `net.http_request_queue`) — it doesn't block
  waiting for a response, so the 5s figure only affects how long
  pg_net's background worker waits to *record* a response, not
  whether Railway keeps executing the request. Check
  `ous_sync_log`/`ous_activa_sync_log` for the real result, never
  whether the trigger call itself "succeeded."
- **`parseTermMonths()`** (shared helper, used by both syncs) was
  fixed to handle `"N SEMANAS"` (weeks), not just `"N DÍAS"`/months —
  a real latent bug that silently produced `NULL` `term_months` for
  week-denominated loans (confirmed against real sample data: `"52
  SEMANAS"` credits exist).
- **`mapActivaStatus()`** deliberately only returns `'active'`/
  `'review'`, never `'charged_off'` — Pasiva's equivalent
  (`mapAccountingStatus()`) has a latent bug where it *can* produce
  `'charged_off'`, which violates the `loans.status` `CHECK`
  constraint (`active`/`paid`/`review` only) and silently fails that
  one credit's upsert every sync cycle, forever. Found, not fixed
  (out of scope at the time) — worth fixing later, but don't
  accidentally reintroduce the same bug into the Activa path.
- **Source data quality**: `nombre_cliente` in Activa's payload has no
  uniqueness guarantee, and a meaningful fraction of `rfc` values are
  obvious placeholder junk (repeated-letter patterns like
  `"HAAAAAAAAAAAA"`, no digits at all — a real RFC always has a
  6-digit birthdate segment). Any future matching logic must apply a
  plausibility filter before trusting `rfc` as a signal — the manual
  batch-matching pass that seeded this table did; a future automated
  version needs to as well.
- **`verified_at`/`verified_by` aren't being populated consistently**
  today — confirmed live: of the 14 currently-verified rows, 6 have a
  real `verified_at` timestamp (all 6 are the Hagemeister-family rows
  and share one exact timestamp, consistent with a single batch
  action) and 8 have `verified_at = null`, meaning `verified` was
  flipped directly via SQL/Table Editor without setting the other two
  columns alongside it. Not a bug, but worth being deliberate about
  all three columns together in whatever manual workflow is used
  until a real admin UI exists (see "Not yet built").
- **A verified match with no live-sync coverage yet writes no loan.**
  Confirmed live: id_credito 380 (Ignacio Arroyo Kuribreña) is
  verified with a matched profile, but its `last_seen_at` has never
  advanced past its original batch-population timestamp — meaning the
  one real sync run so far didn't include that credit in OUS's
  response (closed/renewed/reissued between the original sample and
  the live pull, most likely). No loan gets written until a future
  sync actually sees that `id_credito` again. This is why "verified
  count" and "loans written count" don't line up 1:1 — expected
  behavior, not a bug, but easy to misdiagnose as one.

### Current state (verify against live data — this will drift)

As of this writing: one successful automated sync has run, 2026-07-29
16:56 UTC — 105 credits seen, 13 loans written to the real `loans`
table (`data_source = 'ous_activa'`, all linked to admin-verified
profiles — confirmed matching count in both `ous_activa_sync_log` and
`loans` directly), 0 auto-created clients (by design), took ~25s. The
review queue (`ous_activa_client_matches`) currently holds 126 credit
rows across 86 distinct borrower names: 14 rows (10 distinct names)
verified with a matched profile, 112 rows (76 distinct names) still
unverified awaiting admin attention. (An earlier draft of this section
said "101 unmatched" — that was stale; verify the live counts above
rather than trusting this paragraph blindly next time either.)

### Not yet built

- ~~Admin UI for reviewing/verifying `ous_activa_client_matches`~~ —
  **BUILT, PR #165 (`add-loan-match-review-tab`)**: new admin "Loan
  Match Review" tab. **PR #166** added RFC auto-suggest for matches on
  top of it. Confirmed merged via git history (Aug 20 2026 audit); not
  re-verified live against `ous_activa_client_matches` data (no
  Supabase access this session) — worth a quick live check that the
  `verified_at`/`verified_by` inconsistency noted below has actually
  stopped recurring now that there's a real UI instead of raw
  Table Editor/SQL edits.
- ~~"Create new client" admin action for genuinely new borrowers~~ —
  **BUILT, PR #166 (`add-activa-create-client-endpoint`)**: "Create New
  Client" action added to Loan Match Review (commit e6c693a, "Piece 2").
  Same live-data caveat as above.
- Integration of the other 2 documented OUS Activa endpoints
  (`proximo-pagos`, `historico-pagos`) — **still not decided/done for
  Activa.** Note: PR #203 (`populate-loan-next-due-date`) did wire up
  `proximo-pagos`, but that's OUS **Pasiva's** `proximo-pagos` endpoint
  (populates `loans.next_due_date` on every Pasiva sync) — a different
  API from Activa's. Don't conflate the two; Activa's `proximo-pagos`/
  `historico-pagos` are unaddressed.

## Aug 20 2026 audit — CLAUDE.md was 3 weeks stale, here's what changed

This section replaces the old "Session Handoff Notes" below (which was
about the chart-recursion session, PRs #124-158, and had already been
folded into "Project Status & History" above). It exists because a plain
audit request on 2026-08-20 found this file's "Project Status & History"
section still describing the codebase as of PR #164, while the actual
repo was 40 PRs further along (through #204, last merged 2026-08-11).

**Important scope caveat**: everything in this section was verified
against **git history and the public GitHub repo only** (commit
messages, diffs, PR close reasons). Unlike most of "Project Status &
History" above, none of it was re-checked against live Supabase, Railway,
or the deployed site — this session had no DB/Railway access. Treat
"confirmed via git" below as weaker than "confirmed live" elsewhere in
this file, and re-verify against live data before relying on specifics.

### Feature work shipped, PRs #165-204 (not previously documented)

Grouped by area, each merged (verified via `git log`, not just branch
existence):

- **OUS Activa admin tooling**: Loan Match Review tab (#165), RFC
  auto-match suggestions + Create New Client action (#166), fixed Activa
  loan_type normalization to use the real `catalogos` lookup instead of
  passing `segmento` through raw (#186). These directly resolve the old
  "Not yet built" list in the OUS Activa section above — see the updated
  bullets there.
- **Calendar rework** (several iterative PRs, same area touched
  repeatedly — #181, #182, #196, #197, #198, #203, #204): added a
  monthly cashflow in/out summary, counted loan closings toward Cashflow
  In, fixed Cashflow In to reflect full company cash movement (not just
  a subset), switched to real interest instead of principal maturities,
  added borrower/depositor names next to loan IDs, grouped same-day
  events, populated `loans.next_due_date` from OUS **Pasiva's**
  `proximo-pagos` on every sync, and added a confirmed-vs-pending
  interest estimate. This area clearly went through several rounds of
  "that's still not quite right" — if touching Calendar cashflow again,
  read all of these diffs first rather than assuming the current state
  matches any single one of these commit messages.
- **Client portal, made more "real" / less scaffolded**: dashboard's two
  charts now show real data (#191), Repayment Progress shows real OUS
  payment counts (#188), deposit detail views show real
  performance/schedule (#195), Payments tab folded into My Loan (#194),
  Express Interest now a full modal with amount/contact/notes (#187),
  Deposit option added to New Application (#177). Also removed things
  that were fake/dead: the Distribution History table (#189), the fake
  Quarterly Calls toggle and fake Two-Factor Auth toggle (#178, #192) —
  replaced by a joke 2FA button for the team (#180, `2fa-totally-legit.png`,
  not a real feature, don't treat it as one.
- **Admin permissions**: account executives blocked from creating
  clients (#200), a follow-up fix for the "Add Clients" permissions-
  matrix checkmark on Team & Settings not reflecting that (#201). This
  is the practical, incremental continuation of what PR #107
  (`rbac-comprehensive`) was trying to do in one big JS-side PR before
  it got closed as "resolved elsewhere" (see above) — RBAC here is being
  built as small, targeted fixes against the RLS foundation, not as one
  sweeping PR. Expect more of these to show up piecemeal.
- **Admin portal cleanup/fixes**: removed dead `view-review` section
  (#174, resolves the old pending item above), removed loan/deposit edit
  UI from the admin View modal (#170), fixed the Missing Document filter
  (freezing the page, not re-applying after re-clone, not filtering at
  all — three separate PRs, #183/#184/#185, same feature area, same
  pattern as Calendar above of multiple passes to get one thing right),
  fixed Originations chart using sync date instead of real origination
  date (#202), fixed Loan Type Breakdown to only ever show
  Personal/Simple/Other (#199), client names rendered in ALL CAPS across
  admin (#172), fixed signup/accept-invite placeholder branding (#167).
- **Dashboard KPI rename**: "Portfolio LTV" → "Loan / Deposit Ratio"
  (#190) — if grepping for the old name in future work, it won't be
  there anymore.

### GitHub state (verified 2026-08-20)

- **0 open PRs, 204 closed.** Nothing is currently blocked on review.
- Last merge to `main`: PR #204, 2026-08-11. No activity in the 9 days
  before this audit.
- **38 remote branches still exist**, most of them names matching
  already-merged PR topics above (e.g. `origin/add-loan-match-review-tab`,
  `origin/fix-calendar-cashflow-interest`). The branch-hygiene pass from
  the previous session (99 branches deleted) has re-accumulated. Another
  pass would be low-risk cleanup, not urgent.
- One untracked local file was present in the working directory during
  this audit: `Onix_Finance_Portal_PRD_branded.docx` (added 2026-08-19,
  not committed, not otherwise referenced in git). Possibly related to
  the known brandbook-audit gap noted elsewhere — confirm with the user
  before assuming its purpose or deleting it.

### Still genuinely open (carried forward, not resolved by the above)

- **Railway access gap** — mostly closed, see "Aug 20 2026 — Railway
  live verification" near the end of this file. Env vars and the
  redeploy hypothesis are resolved; only rate limiting on OUS calls is
  still open, and that's a code task, not something to re-check in the
  Railway dashboard.
- **Supabase free-tier usage limit** — new, found 2026-08-20: the
  Supabase dashboard showed an "EXCEEDING USAGE LIMITS" badge on this
  project (`ckayfqplkpplgojdhjlu`), which is on the FREE plan. A free
  Supabase project that stays over its usage limit for too long can get
  auto-paused, which would take the whole portal down, not just degrade
  it. Not investigated further this session (why it's over limit, how
  close to actual pause) — flagging this as genuinely urgent, more so
  than the other items in this list, and worth Santi's direct attention
  rather than waiting for a future session to get to it.
- **"Leaked Password Protection"** in Supabase — status unknown this
  session (no Supabase access); last confirmed disabled in the previous
  audit. Re-verify before assuming either way.
- **OUS Activa's `proximo-pagos`/`historico-pagos`** — still not
  integrated (see corrected "Not yet built" bullet above; don't confuse
  with Pasiva's `proximo-pagos`, which PR #203 did wire up).
- **OUS Activa sync outage, port 7575** — confirmed live:
  `ous_activa_sync_log` shows 766 consecutive failed syncs with
  `connect ETIMEDOUT 54.165.232.64:7575` on the login call, running
  continuously from 2026-08-20 19:07 UTC through 2026-08-28 16:22 UTC
  (still failing as of this writing). OUS Pasiva, same host, port 7070,
  synced clean the entire time (838/838 `ok=true` over the same
  window) — confirmed isolated to OUS's Activa endpoint, not a shared-
  infrastructure or our-side problem; env vars, rate limiting, and
  retry logic were each individually ruled out earlier, and a TCP-level
  connect timeout on the login call happens before any of our own
  throttle logic would even run. Santi's decision (2026-08-28):
  deprioritize — work on the rest of the project first, revisit
  escalating to the OUS Activa vendor contact later, no fixed date.
- **Loans-table duplication with the servicing dashboard** — unresolved,
  status uncertain. The standalone `onix-servicing-dashboard` project has
  its own separate `public.loans` table in its own separate Supabase
  project, distinct from this repo's real loans table. That project is
  currently paused and it's not settled whether/how it gets consolidated
  with this repo — don't assume any direction here without checking with
  Santi first. If reconciliation happens, it's tracked in the separate
  "Onix Portal general" project, not here.
- **Brandbook audit** — still not done; current styling still doesn't
  match the brandbook. Known, pre-existing gap. Note: the actual
  `Onix Brandbook.pdf` was located in the `onix-servicing-dashboard`
  project folder — it exists and is findable, it just hasn't been used
  yet.

## Aug 20 2026 addendum — outside counsel loan audit & archived API manuals

Added the same day as the audit above, from a later conversation (Cowork
session, not verified against live Supabase/Railway/git — this is
**relayed by Santi in chat**, not independently confirmed against any
system).

- **G. Ortega Law loan-file audit**: outside counsel (G. Ortega Law, PLLC)
  audited 47 loan files (source: "Master Loan Audit Workbook," reporting
  date 2026-05-15) and found a 30.9% aggregate documentation-completion
  rate — Credit Approval Memo missing in 98% of files, KYC/CIP missing or
  incomplete in 95%, insurance-naming-Onix-as-loss-payee missing in 66%,
  post-closing insurance/financial-statement/KYC ticklers each missing in
  ~77-79%. Only the audit's summary document has been seen so far; the
  full per-loan checklist workbook has not been shared into a session yet
  (Santi says the files are too large to attach directly). This audit is
  a potential driver for a future loan-compliance-tracking feature, but
  nothing is built or decided — blocked on getting the full workbook and
  matching the 47 audited files to real loan records (matched by borrower
  name/property in the audit vs. `id_credito`/loan UUID in the real
  table — no shared key exists yet). Santi is handling the workbook
  acquisition and file-matching himself — a future session should not
  assume any of that is done without checking. **Do not treat this as
  tied to the servicing-dashboard consolidation** — that project is
  paused and it's unknown whether/when it happens; this audit stands on
  its own regardless of that outcome.
- **Not started**: no schema changes, no loan-matching, no UI work has
  happened on any of this yet as of 2026-08-20. Don't build ahead of
  where Santi actually is.
- **OUS Activa/Pasiva API manuals**: the official manuals for both APIs
  (documenting all endpoints including Activa's still-unintegrated
  `proximo-pagos`/`historico-pagos`) were shared into a Cowork session on
  2026-08-20, along with API credentials. Explicitly archived only, no
  action taken — if a future session needs these, ask Santi to re-share
  them; they were not committed to this repo (credentials should never
  be committed here regardless — they belong only in Railway env vars).

## Aug 20 2026 — Railway live verification

Same day as the sections above, later still. Unlike the "Aug 20 2026
addendum," this one **was** verified live — directly in the Railway
dashboard via screen-share with Santi, not relayed secondhand. Resolves
two of the three "Railway access gap" items that every prior session
had to leave open for lack of access.

- **Railway env vars — confirmed matching.** The `Onix` service
  (Express app, domain `onix-production-50c3.up.railway.app`) has all
  13 variables `server.js` actually reads via `process.env.*`:
  `ACTIVA_SYNC_CRON_KEY`, `OUS_ACTIVA_API_URL`/`LOGIN`/`PASSWORD`,
  `OUS_API_URL`/`LOGIN`/`PASSWORD`, `SUPABASE_ANON_KEY`/
  `SERVICE_ROLE_KEY`/`URL`, `SYNC_CRON_KEY`. `PORT` isn't in the
  Variables list, but that's expected — Railway auto-injects it, it's
  never something you set manually. `ALLOWED_ORIGINS` also isn't set
  explicitly, but `server.js` has a working fallback default
  (`https://williambking.github.io,https://portal.onixfinance.com`)
  that already matches production, so this isn't a gap either, just
  implicit config. Nothing missing, nothing broken.
- **Redeploy-on-every-push hypothesis — disproven.** Checked the
  `Onix` service's Deployment history across roughly a dozen recent
  merges. Frontend-only PRs (#199, #201, #202, and two direct-push
  Calendar commits) all show **SKIPPED — "No changes to watched
  files."** Backend-touching PRs (#200, #203) show **REMOVED**, meaning
  they *did* trigger a real deploy at the time, which was later torn
  down once superseded by the next real deploy (#204, currently
  ACTIVE) — that's normal deployment lifecycle, not a bug. Railway is
  correctly filtering by watched path; it is **not** redeploying on
  every push regardless of what changed. The old hypothesis (built on
  `railway_status_snapshots` showing frequent restarts) should be
  considered wrong, or at least not explained by this mechanism —
  see the next bullet for where those restart signals likely actually
  come from.
- **Identified a second, previously-undocumented Railway service:
  `cozy-friendship`** (Railway's auto-generated name, also linked to
  the `williamBking/Onix` GitHub repo). It's a **Cron Job**, not a
  always-on service — runs once a day (~08:00 Central / 13:00 UTC,
  ~2s per run). Its Custom Start Command is `npm run snapshot`, which
  confirms it's running this repo's `railway-status-snapshot.js` — the
  script that populates the `railway_status_snapshots` Supabase table
  referenced elsewhere in this file. Its variables are
  `ONIX_HEALTHZ_URL`, `OUS_PASSWORD`, `SUPABASE_SERVICE_KEY` (note:
  different name than the `Onix` service's `SUPABASE_SERVICE_ROLE_KEY`
  — same purpose, inconsistent naming, worth normalizing eventually but
  not urgent), `SUPABASE_URL`. Mystery solved: this is not a rogue or
  forgotten integration, it's the health-snapshot cron, just never
  written down as its own service before. One real finding from this:
  its own Deployment history shows **REMOVED for every recent merge**
  (#201, #202, #203), no SKIPPED entries seen — unlike the `Onix`
  service, it appears to rebuild on every single push regardless of
  whether anything relevant changed. Low severity (it's a tiny
  single-file script, ~2s to run), but wastes build minutes for no
  reason, and given the Supabase free-tier usage-limit finding below,
  worth tightening its watched paths eventually — not urgent enough to
  interrupt other work for.
- **New, unrelated but more urgent finding from the same session:**
  Supabase's dashboard shows an "EXCEEDING USAGE LIMITS" badge on this
  project (`ckayfqplkpplgojdhjlu`), which is on the FREE plan — see the
  "Still genuinely open" list above. Not yet investigated further.
- **Still open, unchanged**: rate limiting on OUS API calls — this is a
  `server.js` code change, not a Railway configuration question, so it
  can't be resolved by looking at the dashboard.

## Aug 28 2026 — next_due_date fix and Activa match audit trail closed

### `loans.next_due_date` gap — investigated, mostly by design, one real bug found and fixed

Confirmed live: only 96 of 252 active loans have `next_due_date`
populated (184 `ous_pasiva` / 92 populated, 68 `ous_activa` / 4
populated). Most of that gap is working as designed, not a bug:

- OUS Pasiva's `proximo-pagos` sync only looks 90 days ahead
  (`dias: 90`, same window as `por-vencer`) — a single-payment/balloon
  loan's only due date is its maturity date, so it correctly has no
  `next_due_date` yet if maturity is further out than that.
- OUS Activa's sync never writes `next_due_date` at all —
  `upsertActivaLoan()`'s payload omits the field entirely, since only
  Pasiva's `proximo-pagos` was ever wired up (see "Not yet built" in
  the OUS Activa Integration section above; not duplicated here). The
  4 populated Activa rows are leftover manual edits via the admin Edit
  Loan form's `next_due_date` field, not sync writes — confirmed by
  their values not matching what an automated Activa sync would ever
  produce.

A real bug **was** found and fixed: `server.js`'s `proximo-pagos`
grouping loop dropped any due date already in the past (`d < today`),
so a still-active loan whose earliest scheduled date had already
passed — genuinely overdue — showed `next_due_date = null` instead of
the true overdue date, hiding delinquency instead of just lacking
future data. Fixed in PR #208 (`fix-overdue-next-due-date`, commit
`ac56b6b`, merged `2efddbd`, 2026-08-28): now keeps the earliest date
regardless of whether it's before today, only skipping rows with no
date at all.

Follow-up, same day: the client portal had no overdue framing for the
newly-surfaced past dates — a client would just see a plain past date
under a forward-looking label ("Next Payment", "Interest Earned",
"Upcoming"). Fixed in PR #209 (`fix-client-portal-overdue-display`,
commit `5718e76`, merged `66c27ee`, 2026-08-28): adds a shared
`fmt.isOverdue()` helper and applies red "X days overdue" framing
across the deposit detail stat, Dashboard Upcoming sidebar, Upcoming
Payments table (reusing the existing `.badge.badge-red` pattern), the
notifications bell, and the My Loan/Dashboard KPI — display-only,
`days_delinquent` and `server.js` untouched by this second PR.

### `profiles.admin_notes` column dropped

The dead-code blocker flagged in the original investigation (a dead
`notes` parameter in `supabase.js`'s `markClientMet`/`approveClient`,
confirmed unreachable — every real call site only ever passed
`userId`) was removed and merged first: PR #210
(`remove-dead-admin-notes-plumbing`, commit `7f61de4`, merged
`e448d79`, 2026-08-28). With that cleared, a fresh full-repo grep
(including the same bundler-blob decode as the original check) came
back with zero remaining references anywhere, and a live check
confirmed all 149 `profiles` rows had `admin_notes IS NULL`, with no
index, constraint, or RLS policy touching it. Dropped via migration
`drop_admin_notes_from_profiles` (2026-08-28) — see
`supabase/migrations/20260828164917_drop_admin_notes_from_profiles.sql`
for the exact statement. Column is gone; don't re-flag this as
pending.

### `ous_activa_client_matches` verified_at/verified_by inconsistency — closed, not a bug

Re-raised and re-investigated: 6 rows have `verified_at` set with
`verified_by` null (confirmed live, unchanged from the original Aug 20
finding above — still exactly the Hagemeister-family rows), 8 rows
have both null, 64 rows have both set correctly. Traced both current
write paths — the "Verify Match" UI button (`admin-portal-data.js`, a
single atomic `.update()` setting `matched_profile_id`/`verified`/
`verified_by`/`verified_at` together) and the "Create New Client" RPC
(`activa_admin_create_client()`, a single atomic `UPDATE` inside a
Postgres function that rolls back the whole transaction, including the
profile insert, if the match is already claimed) — confirmed neither
can produce a `verified_at`-without-`verified_by` split. This is dead,
historical data from a one-time manual/batch-seeding pass that
predates the real Verify Match UI (PR #165/166), not a live bug. No
fix needed; don't re-raise this as an open question in a future
session.

### Process note: a `git reset --hard` destroyed an uncommitted CLAUDE.md edit

During this session's work, `git reset --hard origin/main` was run to
fast-forward a branch while `git status` showed an uncommitted, never-
staged local edit to this exact file (`CLAUDE.md`). The reset silently
discarded it — no `git stash`, no commit, no reflog entry, since
unstaged working-tree changes aren't git objects. Not recoverable: not
in git, not in VS Code's local file history, no relevant Time Machine
snapshot. **Before any `git reset --hard` (or other command that
discards uncommitted work), run `git stash -u` first whenever `git
status` shows anything uncommitted** — this is already the stated
safety protocol; this incident is the reason to actually follow it
every time, not just when the change looks obviously important.

## Sept 18 2026 audit — repo ownership transfer, live Supabase/Railway check

Main had **zero commits for 21 days** (last activity was PR #211, the Aug
28 audit itself) — this gap is when the ownership transfer below
happened. This audit is broader than the Aug 20 one: it had live
Supabase **and** Railway access via MCP connectors, not git-history-only,
so findings below marked "confirmed live" are stronger than that caveat
implied for the Aug 20 section.

### Repo ownership transferred: williamBking/Onix → strevino20/Onix

GitHub confirms the transfer (`api.github.com/repos/williamBking/Onix`
now 301-redirects to the new location). The repo now lives at
`github.com/strevino20/Onix`. Local `origin` remote updated to the new
URL directly rather than relying on the redirect. Branch tracking,
history, and PR numbering all carried over intact — this was a plain
GitHub transfer, not a fork or re-clone, so nothing below about PR/issue
numbers or branch names changed because of it.

**Railway was not transferred along with it — separate, still open.**
`strevino20`'s Railway workspace ("strevino20's Projects") has
`projectCount: 0`, confirmed via the Railway MCP connector's own
`whoami` (authenticated as `strevino20`) and `list-workspaces` calls.
The `Onix` Express service and the `cozy-friendship` cron job documented
in "Aug 20 2026 — Railway live verification" above are presumably still
sitting under William's Railway account — that section's findings were
gathered via screen-share on William's login, not through any access
Santi's own account has. **Practical impact: this session cannot inspect
Railway logs, redeploy, or change env vars/variables for the live
backend** — that requires William to invite `strevino20` to the Railway
project (or transfer it, same as GitHub) before any Railway-side work
this session flags as needed can actually be done. Flag this to Santi
directly; it's not something to work around.

### Correcting a stale "still genuinely open" item

**Rate limiting on OUS API calls — DONE, not open.** The Aug 20 and Aug
28 sections both still list this as genuinely open ("a code fix, not a
Railway config question"). Confirmed via git log: `add-ous-rate-limiting`
merged as **PR #206** on 2026-08-28 ("Add outbound rate limiting for OUS
Pasiva/Activa calls"), before the Aug 28 audit section itself was
written — that section simply missed it. Don't re-flag this as open in
a future session; if it needs revisiting, that's a "does the existing
rate limiter need tuning" question, not "does one exist."

### Live Supabase check (via MCP, project `ckayfqplkpplgojdhjlu`)

- **Project status: `ACTIVE_HEALTHY`**, not paused. Directly answers the
  most urgent item from the Aug 20 Railway-verification section (the
  "EXCEEDING USAGE LIMITS" dashboard badge risking auto-pause) — the
  project has not been paused. Couldn't check the badge itself or how
  close to the limit it currently runs (no billing/usage endpoint
  exposed through this MCP connector, only project status), so treat
  "not paused" as confirmed but "how much margin is left" as still
  unknown — worth Santi checking the dashboard billing page directly.
- **`profiles.admin_notes` — confirmed still gone** (0 matching columns
  in `information_schema.columns`), consistent with the Aug 28 drop.
- **RLS policies re-checked directly** on `profiles`, `loans`,
  `investments`, `loan_payments`, `distributions`, `ous_sync_log`,
  `ous_activa_sync_log` — no "ae scope" policies on any of them, only
  the documented admin-all + self-own + non-admin-cannot-write pattern.
  Security fixes from "Critical security fixes applied" above are
  confirmed still in place, live, today.
- **Leaked Password Protection — confirmed still disabled**, live, via
  the security advisor. Unchanged from every prior check; still nobody's
  gotten to it.
- **OUS Activa outage — still ongoing, now ~4 weeks in.** Confirmed live:
  686 of 686 sync attempts failed in the last 7 days (0 successes), most
  recent failure 2026-09-18 15:37 UTC — same `ETIMEDOUT` pattern on port
  7575 documented in the Aug 28 section, uninterrupted since. OUS Pasiva
  in the same window: 671/671 successful, healthy. Matches Santi's
  2026-08-28 decision to deprioritize rather than escalate yet — this
  isn't a new problem, just confirmation it's still exactly where it was
  left. Don't re-investigate the cause again; it's already been ruled
  isolated to OUS's Activa endpoint (see Aug 28 section above).
- **New, undocumented finding: a stray `public."Onix"` table.** Columns
  are only `id` (bigint) and `created_at` (timestamptz) — no other
  columns, no data checked. RLS is enabled with **zero policies**, which
  means it's fully inaccessible via PostgREST to every role including
  admins (not a security hole — the opposite, nothing can reach it
  through the API). Not referenced anywhere in this file's history and
  doesn't match the naming convention of any other table in the schema
  (capitalized, matches the Supabase project's display name "Onix
  Backend Project" instead). Best guess: leftover from initial project
  scaffolding, never cleaned up. Low priority, but ask Santi before
  dropping it — don't assume it's safe to delete without confirming nothing
  external (a forgotten script, a manual dashboard test) still expects it.

### GitHub state (confirmed live, 2026-09-18)

- **0 open PRs.** `drop-profiles-admin-notes-column` (this session's
  starting branch, commit `f343132`) is pushed to origin but has no PR
  opened yet.
- **46 remote branches** — up from 38 at the Aug 20 audit, not down.
  The branch-hygiene pass that was "low-risk cleanup, not urgent" at
  that audit has drifted further rather than happened; still not
  urgent, but flagging the trend.
- **Two untracked local files**, not one: the previously-noted
  `Onix_Finance_Portal_PRD_branded.docx` (2026-08-19) plus a new
  `Onix_Summary_of_Findings (2) copy.docx`, neither committed nor
  otherwise referenced in git. Contents not read as part of this audit
  — confirm with Santi before assuming either's purpose.

### Still genuinely open (carried forward, correcting the list above)

- **Railway access** — reopened in a new shape: not "screen-share only,"
  now "not on Santi's Railway account at all." Needs William to invite
  or transfer the Railway project. See above.
- **Supabase usage-limit margin** — status upgraded from "urgent, unknown
  how close to pause" to "confirmed not paused, margin still unknown."
- ~~**OUS Activa port-7575 outage**~~ — **root cause corrected, still
  unresolved** — see "Sept 18 2026 — Vercel migration, client portal
  fixes, and OUS Activa root-cause correction" below. It was never a
  vendor-side outage; don't re-describe it that way.
- **Leaked Password Protection** — unchanged, still disabled.
- **OUS Activa's `proximo-pagos`/`historico-pagos`** — unchanged, still
  not integrated.
- **Loans-table duplication with the servicing dashboard** — unchanged,
  status uncertain, don't assume a direction.
- **Brandbook audit** — unchanged, still not done.
- ~~**Rate limiting on OUS API calls**~~ — **RESOLVED**, see above. Was
  incorrectly still listed as open through the Aug 28 section.

## Sept 18 2026 — Vercel migration, client portal fixes, and OUS Activa root-cause correction

Same day as the audit above, continuing the same session — Santi asked
to prep the live site for a client-facing test (Patrick wants 5 real
clients to check their portal view "next week"). This section is the
result. Everything below is confirmed live, not relayed secondhand.

### Live site moved from GitHub Pages to Vercel

**The site is no longer at `williambking.github.io/Onix` or any
`github.io` URL — it's now `https://onix-red.vercel.app`.** This was
already the "original plan" per Santi; PR #213 finished it. Update any
reference to the old URL you find in a future session (this file's
"Project overview" line above still says `williambking.github.io/Onix`
— stale, fix it when next editing that section).

- **Why now, not later**: the repo transfer earlier today silently broke
  the site. GitHub Pages project-site URLs are owner-scoped
  (`<owner>.github.io/<repo>`), so the transfer moved the live URL out
  from under `williambking.github.io/Onix` with nothing redirecting —
  and separately, `server.js`'s hardcoded CORS fallback only ever
  listed that exact old origin, so even loading the new URL couldn't
  reach the backend (browser blocked every API call, no visible error
  beyond a blank/broken app). Both are fixed now (see below) but this
  was a real, live, total-outage bug for roughly the whole gap between
  the transfer and this session — worth knowing if anyone asks why the
  portal "wasn't working" around Sept 18.
- **`vercel.json`/`.vercelignore` already existed in the repo** before
  this session touched anything — confirms the Vercel plan was real
  prior work, not just talk. No hardcoded `/Onix/`-subpath references
  exist anywhere in the frontend (checked all 11 HTML/JS files), so the
  move to Vercel's root-path serving was clean.
- **Known pitfall, now fixed (PR #213, `.vercelignore`)**: the repo's
  root `package.json` belongs to the **Railway backend**
  (`onix-ous-proxy`, `server.js`), not this static frontend — but
  Vercel doesn't know that. On first import, Vercel saw `express` as a
  dependency and a `"start": "node server.js"` script and auto-detected
  the whole repo as an Express app, deploying `server.js` itself
  instead of the static HTML — every route 404'd with Express's own
  `Cannot GET /` fallback (not a Vercel 404 page). Confirmed live
  before the fix. Fixed by excluding `package.json`,
  `package-lock.json`, `server.js`, and `railway-status-snapshot.js`
  via `.vercelignore` **and** the Vercel project's Framework Preset
  manually set to "Other" in the dashboard (the `.vercelignore` change
  alone may not have been sufficient — the preset can lock in at import
  time; both were done this session). **If this repo is ever
  re-imported into a fresh Vercel project, redo both steps** — a bare
  re-import will likely reproduce the exact same bug, since nothing
  about the repo's `package.json` changed, only what Vercel is told to
  ignore.
  - `server.js`'s full source was briefly publicly downloadable at
    `/server.js` on the live domain before this fix landed — no secrets
    in it (all real values are env vars), but internal
    architecture/comments were exposed. Confirmed closed after the fix.
- **Two Vercel projects briefly existed** pointing at the same repo
  (`onix-red` and `onix-fb9b`, from two separate import attempts).
  `onix-fb9b` was deleted; **`onix-red` is the canonical one.** If a
  second project mysteriously reappears, it's probably another accidental
  re-import — delete it, don't try to keep both in sync.

### Railway: CORS updated, and Static Outbound IPs were already on

- **`ALLOWED_ORIGINS`** is now set as a real env var on the `Onix`
  service (previously unset, relying on the stale code fallback) —
  `https://onix-red.vercel.app,https://portal.onixfinance.com`. Confirmed
  live via direct CORS probe from both origins. If the Vercel domain
  ever changes (custom domain, project recreation), this needs updating
  too — it will NOT auto-follow a Vercel domain change.
- **The `Onix` service already has Railway's "Static Outbound IPs"
  (HA) enabled** — this was news to this session; not documented
  anywhere before. Three fixed IPs, shared type:
  `162.220.232.250`, `162.220.232.251`, `152.55.176.240`. This directly
  matters for the OUS Activa item below.
- Railway project confirmed named **`marvelous-surprise`** (project ID
  `82848d48-9c6c-49cc-9069-ad6edc38aebc`) — contains both the `Onix`
  service and the `cozy-friendship` cron. Neither this file nor any
  prior session had named the parent project before, only its services.

### OUS Activa outage — root cause was wrong, corrected here

Every prior mention of this outage (Aug 20 audit through today's
earlier Sept 18 audit section) concluded it was a vendor-side server
outage and recommended deprioritizing until OUS's team could be
reached. **That diagnosis is wrong.** Confirmed this session:

- A direct, repeated test of `54.165.232.64:7575` from outside Railway's
  network succeeded instantly every time (3/3 attempts, ~100ms each),
  returning the identical healthy `HTTP 400` response Pasiva's port 7070
  gives for an unauthenticated login call. **The Activa server is up.**
- Meanwhile Railway's own requests to that exact host:port have failed
  with `connect ETIMEDOUT` on every attempt since 2026-08-20 (686/686
  failed in the 7 days before this session, still failing as of
  2026-09-18 16:07 UTC) — while Pasiva (port 7070, same host, same
  server) has synced perfectly the entire time.
- Env vars and the requested URL are confirmed correct (the error
  message itself proves the right host/port is being hit).
- **Conclusion: OUS's firewall almost certainly allowlists Railway's
  traffic for port 7070 but not port 7575** — a one-sided network rule,
  not a dead server. This is fixable, not just something to wait out.

**What's needed to actually fix it**: give OUS's technical contact the
three Static Outbound IPs listed above and ask them to check/extend
their port-7575 allowlist to match whatever already lets port 7070
through for the same origin. Nobody has done this yet — it requires a
person (Santi or William) to actually contact OUS, which is outside
what a session can do alone. **Don't re-diagnose this from scratch in a
future session** — the cause is known; only the vendor-side fix is
still pending.

### Client portal bug fix: timezone date-parsing (PR #214)

Found while doing a code+data correctness pass ahead of Patrick's
client test. `client-portal-data.js` has a `parseLocalDate()` helper
specifically because `new Date('YYYY-MM-DD')` parses as UTC midnight,
which reads back as the *previous calendar day* in any US timezone
(confirmed: Houston reads `'2026-01-15'` as Jan 14). That helper is used
correctly through most of the file, but **6 call sites bypassed it**
with a raw `new Date(...)` on a bare date column instead — all fixed
this session:

1. `synthActivaSchedule`'s anchor date — shifted every synthesized OUS
   Activa payment due date back a day for any loan without real
   `loan_payments` rows (which is most Activa loans, since Activa never
   exposes per-installment history).
2. The notification bell's overdue check (`renderNotifications`) —
   could flag a payment "overdue" several hours before it actually was.
3. The Dashboard "Upcoming" card's displayed day-number
   (`renderUpcomingEvents`) — showed the wrong calendar day.
4. The Repayment Progress card's Origination/Maturity month-year labels.
5. The investment cash-flow chart's month labels (wrong month for a
   distribution paid on the 1st).
6. The portfolio growth chart's month-boundary bucketing (same 1st-of-
   month edge case, could misattribute a distribution to the prior
   month's cumulative total).

Verified against a real live loan (Activa loan `156`, origination
`2023-03-21`) that the fix is checkable by eye: payment dates on that
loan's My Loan page should land on the 21st of each month post-fix,
not the 20th.

### Live client-portal spot checks (real accounts, real data)

Two real client logins were tested live on the new Vercel domain,
confirming full end-to-end functionality (login → real Supabase data →
correct rendering) for the first time since the repo transfer:

- A Pasiva-only client (investor/depositor, no borrower loan) —
  Dashboard correctly showed real invested amount and ROI, "My Loan"
  correctly showed "No active loan" (this client's `loans` row is
  `data_source = 'ous_pasiva'`, i.e. a deposit, not a real loan — not a
  bug that "My Loan" is empty for this client type).
- An Activa borrower client (`ph@onixfinance.com` — a Hagemeister-family
  client account, not Patrick's own staff login; his actual admin login
  is `admin@onixfinance.com` per the July audit) — real active loan
  rendered correctly, including a genuinely blank Monthly
  Payment/Next Due on one of their 12 loans, traced to real missing
  source data (`monthly_payment IS NULL`, a single-payment/balloon
  loan with `num_payments_total = 1`) rather than a code bug.
  **Product gap worth flagging to Patrick**: a client with a
  single-payment Activa loan currently has no way to see when it's due
  at all unless an admin manually sets `next_due_date` on the Edit Loan
  form. Not fixed this session — a product decision, not a bug fix.

### Client accounts share a password — not universally, confirmed partial

Santi discovered that at least some client accounts share one login
password across accounts (useful for testing, but a real security
concern with real client financial data on the line — separate from,
and not fixed by, Supabase's still-disabled "Leaked Password
Protection," which only checks against known breach dumps and
wouldn't catch internal password reuse). **Confirmed this does NOT
apply to every client**: one Activa client
(`pedroteyuca@gmail.com`, loan `156`) has never signed in
(`last_sign_in_at IS NULL`) and the shared password did not work for
it. Working theory, not fully confirmed: bulk/auto-created Pasiva
clients share the default password from however that batch process set
them up; individually admin-created Activa clients (via the "Create New
Client" flow, PR #166) may each have gotten a distinct password at
creation time. **Before assuming a given test client's login works,
check `auth.users.last_sign_in_at` for that email first** — null means
don't assume the shared password applies. This is Patrick's decision to
prioritize, not something fixed here — flagging it is as far as this
session went.

### Loose end

`drop-profiles-admin-notes-column` branch (pre-existing before this
session) is pushed to origin with one commit but still has no PR
opened. Not touched this session beyond noticing it — pick it up
whenever, low priority, purely a docs-recording commit (the actual
column drop migration already shipped).

## Session Handoff Notes (historical — chart-recursion session, folded up)

Narrower and more time-sensitive than the sections above — this is what
happened in the session that just ended, not yet folded into the durable
summary above. Once acted on, fold anything still relevant up into
"Project Status & History" and delete it from here; don't let this
section grow indefinitely.

### Shipped this session, not otherwise documented above

- **Chart.js recursion, root-caused and fixed (merged, PRs #135/#136).**
  Worth knowing for any future chart work: `admin-portal.html` vendors
  Chart.js **v4.4.0** itself — gzip+base64 inside the `__bundler/manifest`
  tag, reconstituted to a `blob:` URL at load, not fetched from a CDN at
  request time. The original "`Recursion detected: _scriptable->_scriptable`"
  error came from Chart.js's scriptable-options resolver, which has a
  deliberate, guarded recursion check (throws a clean error on purpose).
  After fixing that (canvas-reuse: destroy before recreate), a *different*
  error surfaced — `RangeError: Maximum call stack size exceeded at
  Object.set` — from a separate, unguarded `Proxy` `set` trap in Chart.js's
  option-scope-merger, hit specifically because `admin-portal-data.js`'s
  `updateDashboardCharts()`/`updateReportsCharts()` were **wholesale-
  replacing** `chart.data.labels` / `chart.data.datasets[0].data` /
  `chart.options.plugins` on every repaint tick instead of mutating them
  in place. Fixed by mutating instead (`array.length = 0; array.push(...)`
  for data, direct property assignment for options) — Chart.js's own
  documented pattern. **General rule going forward: never replace
  `chart.data`/`chart.options` sub-objects wholesale on an existing Chart
  instance; always mutate in place, then call `chart.update()`.**
- **Combined the ID and Passport document filters** into one "ID/Passport"
  option across all three places that grouped by category (admin's Client
  Documents modal, admin's "Missing document" dropdown, client portal's "My
  Documents" tab) — display-layer only, `client_documents.category` still
  stores `'id'`/`'passport'` as distinct real values; upload pickers
  correctly still offer them separately.
- **Fixed the admin calendar forcing horizontal scroll** on the whole page
  (missing `min-width:0` on `.cal-cell`/`.main`, a CSS Grid gotcha — grid
  items default to `min-width:auto` and can force a track wider than its
  container).
- **Four small fixes from a portal audit**, each its own PR: gated
  `paintDashboardView`'s debug `console.log` behind
  `localStorage.getItem('onix-debug')` instead of it running unconditionally
  every ~600ms forever; hardened the Financial Reports tab's detection
  (`isDocumentsView()`) to key off the stable `id="view-documents"` instead
  of matching the heading text, which had already broken silently once
  before when the heading was renamed — now logs a `console.warn` if the
  expected structure isn't found instead of failing silently; removed a
  dead, never-read `notesContainer` selector in the admin "Post Note"
  handler; removed the entire dead Edit Raise modal
  (`openRaiseEditor`/`saveRaise`/`closeRaiseEditor`/`closeRaise` + its
  modal HTML) — confirmed unreachable, `saveRaise()` had no real Supabase
  call at all, just a fake success alert.
- **Built the Admin Notes feature** (see "What's live and working" above
  for the `client_admin_notes` table) — UI lives in
  `openClientInLPModal()` in `admin-portal.html`, a new section right
  after Active Investments, with an explicit "Save Notes" button (no
  auto-save) and a "Last updated by [name] on [date]" line. That label
  is populated from the current admin's own `localStorage['onix-user']`
  snapshot (set once at login) rather than a second round-trip query —
  known, accepted tradeoff: it can show a stale name if that admin's own
  `full_name` changed elsewhere mid-session, but self-corrects the next
  time the modal is reopened for that client (fresh DB join), and the
  actual persisted `updated_by`/`updated_at` are never wrong.
- **Full repo hygiene pass**: deleted 99 confirmed-merged stale branches
  from the remote (kept `main`, `rbac-comprehensive`, `ous-portal-integration`
  only). Full git-history secrets scan came back clean (no leaked keys —
  only the public Supabase anon key, which is meant to be public).
  GitHub's own secret scanning is disabled on this repo — nobody has
  turned it on; worth doing since it's a free, automatic backstop for
  exactly what was manually checked once here.

### Working directory state right now

- Every branch created this session, including the one that added the
  "Project Status & History" section above (`fix-chart-recursion-v3`,
  `combine-id-passport-doc-filter`, `fix-calendar-horizontal-overflow`,
  `gate-dashboard-debug-log`, `harden-financial-reports-detection`,
  `remove-dead-notes-container-selector`, `remove-dead-edit-raise-modal`,
  `add-admin-notes-feature`, `update-claude-md-project-status`), is
  confirmed **merged into `main`** (verified via `git merge-base
  --is-ancestor` against `origin/main`, not assumed — re-checked fresh
  right before writing this). This "Session Handoff Notes" section
  itself is being added on a new branch, `add-session-handoff-notes`,
  off that same up-to-date `main`.
- One untracked leftover file: `admin-portal.html.bak-20260723-214625`
  (a backup made during the Edit Raise modal removal's decode/edit/
  re-encode process). Harmless, safe to delete, just never cleaned up —
  same as the five earlier `.bak` files that *were* cleaned up during
  the branch-hygiene pass.
- Local clone also has several stale local-only branch refs pointing at
  already-merged or long-abandoned work (their `[origin/...: gone]`
  marker means the remote side is already deleted) — cosmetic, `git
  fetch --prune` plus deleting the local refs would tidy this up
  whenever convenient, not urgent.

### Working-style expectations confirmed this session

Not written down elsewhere in this file, but consistently how the user
wants this project worked on:

- **One logical change = one branch = one commit.** Every fix this
  session, no matter how small (even a one-line debug-log gate that
  never touched `admin-portal.html`), got its own branch and its own PR
  rather than being batched with anything else.
- **Always show the diff and wait for explicit go-ahead before
  committing** — for every single change, not just `admin-portal.html`
  edits.
- **Proposing a better technical alternative to what was literally
  asked, clearly flagged and justified, is welcomed rather than
  overstepping** — confirmed repeatedly and explicitly (e.g. tracking
  chart-instance identity instead of a literal boolean reset; putting a
  CSS override in the already-existing injected stylesheet instead of
  editing the blob to add a new attribute; reusing the existing stable
  `id="view-documents"` instead of adding a new `data-view-id`
  attribute). The pattern that worked: implement the substitution,
  then explicitly call out *what* was changed from the literal request
  and *why*, and let the user confirm or override.

### Unresolved open questions (superseded, see below)

The two items previously here are stale as of the Aug 20 2026 audit:
the "new third-party API" being teased turned out to be OUS Activa,
which is now fully integrated (see "OUS Activa Integration" section
above and the "Feature work shipped, PRs #165-204" list). The Railway
access gap is genuinely still open — see "Still genuinely open" in the
Aug 20 2026 audit section above for the current version of that item;
don't treat this older paragraph as the live copy.

### Next action for a new session (superseded, see Aug 20 2026 audit above)

This paragraph described a session-specific expectation (the user
describing a new API) that has since resolved. There is no single
obvious "next action" queued as of Aug 20 2026 — 0 open PRs, last merge
9 days ago. A new session should ask the user what they want worked on
next, rather than assuming continuation of anything listed here. If
nothing else is specified, the highest-value low-risk items are: (1)
resolve the Railway access question if it becomes relevant, (2) another
branch-hygiene pass (38 stale remote branches), (3) decide what to do
with the untracked `Onix_Finance_Portal_PRD_branded.docx`.

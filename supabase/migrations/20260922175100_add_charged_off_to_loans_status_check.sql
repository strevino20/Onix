-- Widens loans_status_check to allow 'charged_off'. mapAccountingStatus()
-- in server.js maps OUS Pasiva's 'castigo' (write-off) accounting status to
-- 'charged_off', but the constraint only allowed 'active'/'paid'/'review' --
-- so any credit that goes to castigo silently failed its upsert on every
-- sync cycle, forever, with no visible error. Found during the OUS Activa
-- integration work (flagged, not fixed at the time), deferred by Santi on
-- 2026-09-21, picked back up 2026-09-22. See CLAUDE.md's charged_off memory
-- entry for the full trail.
--
-- Confirmed live before this change: zero loans currently stuck in this
-- state (every row was status='active') -- this is a preventive fix, not a
-- backfill.
--
-- Applied live via the Supabase SQL Editor on 2026-09-22 (run directly by
-- Santi, since the assistant's own apply_migration call was blocked by the
-- environment's production-deploy guard) rather than through the tracked
-- Supabase migration system -- this file mirrors that change for a
-- git-tracked record, same as the prior admin_notes-drop migration. Verified
-- live immediately after: pg_get_constraintdef confirmed the new allowed
-- list, and a throwaway insert/delete of a status='charged_off' row
-- succeeded cleanly with no leftover rows.

begin;

alter table public.loans drop constraint loans_status_check;

alter table public.loans add constraint loans_status_check
  check (status = any (array['active'::text, 'paid'::text, 'review'::text, 'charged_off'::text]));

commit;

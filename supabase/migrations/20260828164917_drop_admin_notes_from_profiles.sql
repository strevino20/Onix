-- Drops profiles.admin_notes: confirmed vestigial, superseded by the
-- dedicated client_admin_notes table (own admin-only RLS + audit
-- columns). Before dropping: a full-repo grep (including a proper
-- decode of admin-portal.html's bundler blob) found zero remaining
-- references anywhere in the codebase, and a live check confirmed all
-- rows in profiles had admin_notes IS NULL, with no index, constraint,
-- or RLS policy referencing the column. See CLAUDE.md's "Aug 28 2026"
-- section for the full investigation trail.
--
-- Applied live via the Supabase migration system on 2026-08-28
-- (version 20260828164917); this file mirrors that migration for a
-- git-tracked record, since this project doesn't otherwise track
-- Supabase migrations as local files.

alter table public.profiles drop column if exists admin_notes;

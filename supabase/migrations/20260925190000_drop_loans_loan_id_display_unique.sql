-- Step 2 of 2 for the Pasiva/Activa loan_id_display collision fix (see
-- 20260925180000_loans_unique_per_data_source.sql and PR #239).
--
-- Both syncs now upsert on (data_source, loan_id_display), backed by
-- loans_data_source_loan_id_display_key. The old single-column unique key
-- is what still stops an OUS Activa loan from being inserted when a Pasiva
-- deposit already uses the same id_credito. Dropped only after the
-- server.js change was confirmed deployed on Railway, so no running sync
-- depended on on_conflict=loan_id_display at the time.
alter table public.loans drop constraint loans_loan_id_display_key;

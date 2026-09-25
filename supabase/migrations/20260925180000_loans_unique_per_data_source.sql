-- loans.loan_id_display is OUS's bare id_credito, but OUS Pasiva (deposits)
-- and OUS Activa (loans) number their credits independently, so the same
-- number can exist in both. With UNIQUE (loan_id_display) and both syncs
-- upserting on it, each sync overwrote the other's row. Between 2026-07-29
-- and 2026-08-20 the Activa sync took over 5 Pasiva deposit rows; once it
-- stopped (port 7575 outage) Pasiva took back user_id/balance every cycle
-- but, since its upsert never sent data_source, the rows stayed labelled
-- 'ous_activa' — so those depositors saw their deposit as a loan.
--
-- Step 1 of 2. Runs BEFORE the server.js change that switches both
-- upserts to on_conflict=(data_source, loan_id_display):
--   a) relabel the 5 taken-over rows back to ous_pasiva and clear the
--      Activa-only payment-count fields left behind on them
--   b) add the composite unique index the new server.js needs, keeping
--      the old single-column one so the currently deployed code keeps
--      working until the new code is live.
-- Step 2 (separate migration, after the deploy is confirmed) drops
-- loans_loan_id_display_key.

begin;

-- a) Rows currently labelled ous_activa whose owner is NOT the verified
--    Activa borrower for that id_credito, and that the Pasiva sync is
--    still actively writing. Expected: exactly 507, 519, 532, 539, 573.
do $$
declare n int;
begin
  with hijacked as (
    select l.id
    from loans l
    join ous_activa_client_matches m on m.id_credito::text = l.loan_id_display
    where l.data_source = 'ous_activa'
      and l.user_id is distinct from m.matched_profile_id
      and l.ous_synced_at > now() - interval '1 day'
  )
  update loans l
     set data_source          = 'ous_pasiva',
         num_payments_made    = null,
         num_payments_total   = null,
         num_payments_overdue = null
    from hijacked h
   where l.id = h.id;
  get diagnostics n = row_count;
  if n <> 5 then
    raise exception 'expected to relabel 5 rows, would relabel %', n;
  end if;
end $$;

-- b) New key. Old UNIQUE (loan_id_display) stays until step 2.
create unique index loans_data_source_loan_id_display_key
  on public.loans (data_source, loan_id_display);

commit;

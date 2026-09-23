-- is_lp has never been set to true for any profile (confirmed live: 0 of 140
-- client profiles had it true before this migration). The Clients view's
-- Borrowers/LPs section split (admin-portal.html splitClientsBySection)
-- only worked around this via a loan-activity fallback. Backfill is_lp for
-- every client who currently holds an active OUS Pasiva loan (a deposit),
-- since that's the real signal an LP/investor. Never touches is_borrower,
-- and never flips is_lp to false for anyone.
update profiles
set is_lp = true
where role = 'client'
  and coalesce(is_lp, false) = false
  and id in (
    select distinct user_id
    from loans
    where status = 'active'
      and data_source = 'ous_pasiva'
  );

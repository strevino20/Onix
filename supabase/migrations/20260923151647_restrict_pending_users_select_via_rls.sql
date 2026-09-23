-- Close the pending-approval RLS bypass: a user whose signup session token
-- survives past signup.html's explicit signOut() could otherwise read their
-- own profile/loans/investments via direct Supabase API before an admin
-- approves them, even though login.html blocks the UI for pending/rejected
-- accounts. Match RLS to the same allowed-login statuses login.html already
-- uses ('met' and 'active' proceed to full access; 'pending'/'rejected' do not).

ALTER POLICY profiles_select_self ON public.profiles
  USING ((( SELECT auth.uid() AS uid) = id) AND status IN ('met', 'active'));

ALTER POLICY loans_select_own ON public.loans
  USING ((( SELECT auth.uid() AS uid) = user_id) AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = loans.user_id AND p.status IN ('met', 'active')
  ));

ALTER POLICY investments_select_own ON public.investments
  USING ((( SELECT auth.uid() AS uid) = user_id) AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = investments.user_id AND p.status IN ('met', 'active')
  ));

-- ous_activa_sync_trigger() is SECURITY DEFINER and fires the Railway
-- Activa sync with the cron key. It was still executable by anon and
-- authenticated via /rest/v1/rpc, so anyone with the public anon key
-- could trigger syncs on demand. Match ous_sync_trigger() (Pasiva):
-- only postgres (pg_cron) and service_role keep EXECUTE.
revoke execute on function public.ous_activa_sync_trigger() from public, anon, authenticated;

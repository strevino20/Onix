-- One-time account-activation links for existing client accounts.
-- Sync-created clients have a random password nobody knows, so staff
-- send each one a 7-day link (send-client-activation edge function) that
-- lets them set their own password (activate-client-account edge
-- function, activate.html).
--
-- Only a SHA-256 hash of each link's token is stored, so a read of this
-- table never yields a working link. Staff can read it (to show
-- Invited / Activated in the Clients view); only the service role
-- writes, via the two edge functions.

CREATE TABLE public.client_activations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email       text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'used', 'revoked', 'expired')),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  sent_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  email_id    text
);

CREATE INDEX client_activations_profile_id_idx ON public.client_activations (profile_id);
CREATE INDEX client_activations_sent_by_idx ON public.client_activations (sent_by);

-- At most one live link per client: sending again revokes the old one first.
CREATE UNIQUE INDEX client_activations_one_pending_per_profile
  ON public.client_activations (profile_id) WHERE status = 'pending';

ALTER TABLE public.client_activations ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_activations_select_admin ON public.client_activations
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

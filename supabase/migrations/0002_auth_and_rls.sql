-- 0002_auth_and_rls.sql
-- Phase C: Wire Supabase Auth to the migrated profiles and replace placeholder RLS.
--
-- Order of operations (one transaction):
--   1) Drop the dead Xano magic_link column
--   2) Link public.users.id → auth.users(id) with ON DELETE CASCADE
--   3) Trigger: auto-create public.users on new auth.users signup
--   4) Custom access-token hook: inject is_admin into JWT app_metadata
--   5) Helper function: public.is_admin() reads the JWT claim
--   6) Replace every *_all_migration_placeholder RLS policy with real ones

BEGIN;

-- ---------------------------------------------------------------
-- 1) Drop Xano-era column
-- ---------------------------------------------------------------
ALTER TABLE public.users DROP COLUMN IF EXISTS magic_link;

-- ---------------------------------------------------------------
-- 2) FK: public.users.id → auth.users(id)
-- ---------------------------------------------------------------
-- (Auth migration script runs AFTER this SQL, so the FK is valid on day-one
--  for new rows — the existing 2,127 public.users rows are linked as
--  08-migrate-auth-users.ts creates their auth.users counterparts.
--  To keep this migration one-shot safe, defer the FK and validate later.)
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_id_auth_fkey;

ALTER TABLE public.users
  ADD CONSTRAINT users_id_auth_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED
  NOT VALID;

-- NOT VALID means existing rows are not checked immediately; new rows are.
-- After 08-migrate-auth-users.ts finishes, you can run:
--   ALTER TABLE public.users VALIDATE CONSTRAINT users_id_auth_fkey;
-- (09-verify-auth.ts does this automatically.)

-- ---------------------------------------------------------------
-- 3) New-signup trigger: auto-create public.users row
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, is_admin)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ---------------------------------------------------------------
-- 4) Custom access-token hook: inject is_admin into JWT app_metadata
-- ---------------------------------------------------------------
-- Dashboard toggle required to activate: Auth → Hooks → Custom Access Token
-- → "Use hook" → select `public.custom_access_token_hook`.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims     jsonb;
  admin_flag boolean;
BEGIN
  SELECT is_admin
    INTO admin_flag
    FROM public.users
    WHERE id = (event->>'user_id')::uuid;

  claims := COALESCE(event->'claims', '{}'::jsonb);

  claims := jsonb_set(
    claims,
    '{app_metadata}',
    COALESCE(claims->'app_metadata', '{}'::jsonb)
      || jsonb_build_object('is_admin', COALESCE(admin_flag, false))
  );

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
-- The hook function needs to read public.users under the supabase_auth_admin role.
GRANT SELECT ON TABLE public.users TO supabase_auth_admin;

-- ---------------------------------------------------------------
-- 5) Helper: public.is_admin() reads the JWT
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (auth.jwt()->'app_metadata'->>'is_admin')::boolean,
    false
  );
$$;

-- ---------------------------------------------------------------
-- 6) Replace placeholder RLS policies with real ones
-- ---------------------------------------------------------------

-- -------- location: public read, admin write ----------
DROP POLICY IF EXISTS location_all_migration_placeholder ON public.location;
CREATE POLICY location_select_anyone ON public.location
  FOR SELECT
  USING (true);
CREATE POLICY location_admin_insert ON public.location
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY location_admin_update ON public.location
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY location_admin_delete ON public.location
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- -------- offers: public read, admin write ----------
DROP POLICY IF EXISTS offers_all_migration_placeholder ON public.offers;
CREATE POLICY offers_select_anyone ON public.offers
  FOR SELECT
  USING (true);
CREATE POLICY offers_admin_insert ON public.offers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY offers_admin_update ON public.offers
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY offers_admin_delete ON public.offers
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- -------- post_codes: public read, admin write ----------
DROP POLICY IF EXISTS post_codes_all_migration_placeholder ON public.post_codes;
CREATE POLICY post_codes_select_anyone ON public.post_codes
  FOR SELECT
  USING (true);
CREATE POLICY post_codes_admin_insert ON public.post_codes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY post_codes_admin_update ON public.post_codes
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY post_codes_admin_delete ON public.post_codes
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- -------- users: self read/update; admin full; insert only via trigger ----------
DROP POLICY IF EXISTS users_all_migration_placeholder ON public.users;
CREATE POLICY users_select_self_or_admin ON public.users
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin());
CREATE POLICY users_update_self ON public.users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
CREATE POLICY users_admin_all ON public.users
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
-- (No INSERT policy for clients — handle_new_auth_user() trigger owns inserts.)

-- -------- reviews: approved public; owner can read/create/update own pending; admin full ----------
DROP POLICY IF EXISTS reviews_all_migration_placeholder ON public.reviews;
CREATE POLICY reviews_select ON public.reviews
  FOR SELECT
  USING (status = 'approved' OR auth.uid() = user_id OR public.is_admin());
CREATE POLICY reviews_insert_own ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY reviews_update_own_pending ON public.reviews
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');
CREATE POLICY reviews_admin_all ON public.reviews
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- -------- saved_location: self-only CRUD; admin override ----------
DROP POLICY IF EXISTS saved_location_all_migration_placeholder ON public.saved_location;
CREATE POLICY saved_location_self_all ON public.saved_location
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY saved_location_admin ON public.saved_location
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- -------- saved_offers: self-only CRUD; admin override ----------
DROP POLICY IF EXISTS saved_offers_all_migration_placeholder ON public.saved_offers;
CREATE POLICY saved_offers_self_all ON public.saved_offers
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY saved_offers_admin ON public.saved_offers
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMIT;

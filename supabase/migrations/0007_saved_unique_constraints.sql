-- 0007_saved_unique_constraints.sql
-- Prevent duplicate favorites. De-duplicate existing rows first (keep the earliest by ctid),
-- then add UNIQUE constraints. The backend services are also idempotent at the app layer,
-- but the constraint is the real guarantee under concurrency.

BEGIN;

-- saved_location: one row per (user_id, location_id)
DELETE FROM public.saved_location a
USING public.saved_location b
WHERE a.user_id = b.user_id
  AND a.location_id = b.location_id
  AND a.ctid > b.ctid;

ALTER TABLE public.saved_location
  DROP CONSTRAINT IF EXISTS saved_location_user_location_uniq;
ALTER TABLE public.saved_location
  ADD CONSTRAINT saved_location_user_location_uniq UNIQUE (user_id, location_id);

-- saved_offers: one row per (user_id, offers_id)
DELETE FROM public.saved_offers a
USING public.saved_offers b
WHERE a.user_id = b.user_id
  AND a.offers_id = b.offers_id
  AND a.ctid > b.ctid;

ALTER TABLE public.saved_offers
  DROP CONSTRAINT IF EXISTS saved_offers_user_offer_uniq;
ALTER TABLE public.saved_offers
  ADD CONSTRAINT saved_offers_user_offer_uniq UNIQUE (user_id, offers_id);

COMMIT;

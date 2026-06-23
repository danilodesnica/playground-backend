-- 0006_review_stats_trigger.sql
-- Maintain location.average_rating and location.reviews automatically from APPROVED reviews.
-- Replaces (a) the app's manual, non-atomic reviews[] read-modify-write append, and
-- (b) the never-recomputed average_rating (previously stuck at 0 forever).

BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_location_review_stats(loc uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.location l
  SET
    average_rating = COALESCE((
      SELECT round(avg(r.rating)::numeric, 2)
      FROM public.reviews r
      WHERE r.location_id = loc AND r.status = 'approved'
    ), 0),
    reviews = COALESCE((
      SELECT array_agg(r.id ORDER BY r.created_at DESC)
      FROM public.reviews r
      WHERE r.location_id = loc AND r.status = 'approved'
    ), ARRAY[]::uuid[])
  WHERE l.id = loc;
$$;

CREATE OR REPLACE FUNCTION public.reviews_stats_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.location_id IS NOT NULL THEN
      PERFORM public.refresh_location_review_stats(OLD.location_id);
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.location_id IS NOT NULL THEN
    PERFORM public.refresh_location_review_stats(NEW.location_id);
  END IF;

  -- If an UPDATE moved the review to a different location, refresh the old one too.
  IF TG_OP = 'UPDATE'
     AND OLD.location_id IS NOT NULL
     AND OLD.location_id IS DISTINCT FROM NEW.location_id THEN
    PERFORM public.refresh_location_review_stats(OLD.location_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_stats ON public.reviews;
CREATE TRIGGER reviews_stats
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.reviews_stats_trigger();

-- One-time backfill so existing locations reflect their approved reviews immediately.
UPDATE public.location l
SET
  average_rating = COALESCE((
    SELECT round(avg(r.rating)::numeric, 2)
    FROM public.reviews r
    WHERE r.location_id = l.id AND r.status = 'approved'
  ), 0),
  reviews = COALESCE((
    SELECT array_agg(r.id ORDER BY r.created_at DESC)
    FROM public.reviews r
    WHERE r.location_id = l.id AND r.status = 'approved'
  ), ARRAY[]::uuid[]);

COMMIT;

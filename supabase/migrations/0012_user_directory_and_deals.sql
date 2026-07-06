-- 0012_user_directory_and_deals.sql
-- Member directory + deals analytics.
--
-- Fully additive: three NEW SQL functions only. No existing table or function is
-- touched, so the live app and prior migrations are unaffected.
--
--   1. admin_users_list       — paginated, searchable member directory with
--                               per-user counts (favorites / saved deals /
--                               reviews) and last_active from the pixel.
--   2. analytics_top_offers   — deal engagement (view/save/open) from the pixel
--                               over a Sydney-date range, joined to offers.
--   3. analytics_top_saved_offers — all-time saved-deal leaderboard from
--                               saved_offers, joined to offers.
--
-- Notes:
--   * offers.id is bigint; the pixel carries deal_id as text in props, so joins
--     compare offers.id::text = props->>'deal_id'.
--   * saved_offers' fk to offers is the column "offers_id" (bigint).
--   * Sydney-tz range idiom mirrors migration 0011: the redundant raw
--     received_at bounds let the planner use app_events_received_idx.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Member directory: one row per user, searchable + paginated.
--    total = full filtered count (COUNT(*) OVER()) so the API can paginate
--    without a second round-trip. last_active is LEFT (nullable) from the pixel.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_users_list(
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  id uuid, name text, email text, code text, created_at timestamptz,
  favorites bigint, saved_deals bigint, reviews bigint,
  last_active timestamptz, total bigint
)
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT u.id, u.name, u.email, u.code, u.created_at
    FROM public.users u
    WHERE p_search IS NULL
       OR btrim(p_search) = ''
       OR u.name  ILIKE '%' || p_search || '%'
       OR u.email ILIKE '%' || p_search || '%'
       OR u.code  ILIKE '%' || p_search || '%'
  ),
  counted AS (
    SELECT f.*, count(*) OVER() AS total
    FROM filtered f
    ORDER BY f.created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    c.id, c.name, c.email, c.code, c.created_at,
    COALESCE((SELECT count(*) FROM public.saved_location sl WHERE sl.user_id = c.id), 0) AS favorites,
    COALESCE((SELECT count(*) FROM public.saved_offers   so WHERE so.user_id = c.id), 0) AS saved_deals,
    COALESCE((SELECT count(*) FROM public.reviews        r  WHERE r.user_id  = c.id), 0) AS reviews,
    (SELECT max(e.received_at) FROM public.app_events e WHERE e.user_id = c.id) AS last_active,
    c.total
  FROM counted c
  ORDER BY c.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_users_list(text, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Deal engagement from the pixel (view/save/open) over a Sydney-date range.
--    Grouped by deal_id (text from props), joined to offers for name/category.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_top_offers(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(offer_id text, name text, category text,
              views bigint, saves bigint, opens bigint, uniq_users bigint)
LANGUAGE sql STABLE AS $$
  SELECT e.props->>'deal_id' AS offer_id,
         COALESCE(o.name, e.props->>'name', 'Unknown') AS name,
         COALESCE(o.category, '') AS category,
         count(*) FILTER (WHERE e.event = 'deal_view') AS views,
         count(*) FILTER (WHERE e.event = 'deal_save') AS saves,
         count(*) FILTER (WHERE e.event = 'deal_open') AS opens,
         count(DISTINCT e.anon_id) AS uniq_users
  FROM public.app_events e
  LEFT JOIN public.offers o ON o.id::text = e.props->>'deal_id'
  WHERE e.event IN ('deal_view','deal_save','deal_open')
    AND e.props ? 'deal_id'
    AND e.received_at >= ((p_from::date - interval '1 day') AT TIME ZONE 'UTC')
    AND e.received_at <  ((p_to::date + interval '1 day') AT TIME ZONE 'UTC')
    AND (e.received_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
  GROUP BY 1, 2, 3
  ORDER BY views DESC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.analytics_top_offers(timestamptz, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) All-time saved-deal leaderboard from saved_offers, joined to offers.
--    saves = total save rows; savers = distinct users.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_top_saved_offers(p_limit int DEFAULT 50)
RETURNS TABLE(offer_id text, name text, category text,
              saves bigint, savers bigint, first_save timestamptz, last_save timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT so.offers_id::text AS offer_id,
         COALESCE(o.name, 'Unknown') AS name,
         COALESCE(o.category, '') AS category,
         count(*) AS saves,
         count(DISTINCT so.user_id) AS savers,
         min(so.created_at) AS first_save,
         max(so.created_at) AS last_save
  FROM public.saved_offers so
  LEFT JOIN public.offers o ON o.id = so.offers_id
  GROUP BY so.offers_id, o.name, o.category
  ORDER BY count(*) DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.analytics_top_saved_offers(int) TO authenticated;

COMMIT;

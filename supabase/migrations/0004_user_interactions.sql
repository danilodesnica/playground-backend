-- 0004_user_interactions.sql
-- Personalization layer:
--   1) user_interaction table — implicit click + favorite events (server-tracked, no mobile API)
--   2) get_personalized_featured(uid) RPC — replaces the random ORDER BY in
--      get_featured_locations() with a per-user composite score, ranked within each rail.

BEGIN;

-- ---------------------------------------------------------------
-- 1) user_interaction table
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_interaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.location(id) ON DELETE CASCADE,
  interaction_type text NOT NULL CHECK (interaction_type IN ('click','favorite')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_interaction_user_recent_idx
  ON public.user_interaction (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_interaction_location_idx
  ON public.user_interaction (location_id);

ALTER TABLE public.user_interaction ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_interaction_self ON public.user_interaction;
CREATE POLICY user_interaction_self ON public.user_interaction
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_interaction_admin ON public.user_interaction;
CREATE POLICY user_interaction_admin ON public.user_interaction
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------
-- 2) Personalized featured RPC
-- ---------------------------------------------------------------
-- Composite score per location:
--   1.0 * category affinity   (sum of decayed event weights for items in same category)
-- + 0.5 * tag overlap         (sum of decayed event weights for items sharing any tag)
-- + 0.5 * geo proximity       (10 / (1 + 100*dist) from user's interaction centroid)
-- + 0.3 * average rating
-- + 0.1 * uniform random      (jitter — replaces final shuffle)
--
-- Cold-start: zero events → cat/tag/geo terms collapse to 0 →
-- score reduces to average_rating*0.3 + random()*0.1, preserving today's
-- "random within rail" feel without a special branch.
CREATE OR REPLACE FUNCTION public.get_personalized_featured(uid uuid)
RETURNS SETOF public.location
LANGUAGE sql
STABLE
AS $$
  WITH events AS (
    SELECT
      location_id,
      CASE interaction_type
        WHEN 'favorite' THEN 5.0
        WHEN 'click'    THEN 3.0
      END
      * exp(-extract(epoch FROM now() - created_at) / (7.0 * 86400)) AS w
    FROM public.user_interaction
    WHERE user_id = uid
      AND created_at >= now() - interval '60 days'
    UNION ALL
    SELECT location_id, 5.0 AS w
    FROM public.saved_location
    WHERE user_id = uid
  ),
  cat_pref AS (
    SELECT l.category, SUM(e.w) AS w
    FROM events e
    JOIN public.location l ON l.id = e.location_id
    GROUP BY l.category
  ),
  tag_pref AS (
    SELECT t AS tag, SUM(e.w) AS w
    FROM events e
    JOIN public.location l ON l.id = e.location_id,
    LATERAL unnest(coalesce(l.tags, ARRAY[]::text[])) AS t
    GROUP BY t
  ),
  geo_pref AS (
    SELECT
      AVG(l.latitude)  AS lat,
      AVG(l.longitude) AS lng,
      SUM(e.w)         AS total
    FROM events e
    JOIN public.location l ON l.id = e.location_id
  ),
  candidates AS (
    SELECT *
    FROM public.location
    WHERE category IN (
      'Upcoming Events',
      'Popular Playgrounds',
      'New Playgrounds',
      'New Events',
      'Activities'
    )
      AND (end_date IS NULL OR end_date >= CURRENT_DATE)
  ),
  scored AS (
    SELECT
      c.*,
      (
        coalesce((SELECT cp.w FROM cat_pref cp WHERE cp.category = c.category), 0) * 1.0
        + coalesce(
            (SELECT SUM(tp.w)
             FROM tag_pref tp
             WHERE tp.tag = ANY(coalesce(c.tags, ARRAY[]::text[]))),
            0
          ) * 0.5
        + CASE
            WHEN (SELECT total FROM geo_pref) > 0 THEN
              10.0 / (1 + 100 * sqrt(
                power(c.latitude  - (SELECT lat FROM geo_pref), 2) +
                power(c.longitude - (SELECT lng FROM geo_pref), 2)
              ))
            ELSE 0
          END * 0.5
        + coalesce(c.average_rating, 0) * 0.3
        + random() * 0.1
      ) AS score
    FROM candidates c
  )
  SELECT
    id, created_at, latitude, longitude, name, end_date, category, url,
    description, tags, place_position, type, img_url, preview_img,
    reviews, average_rating
  FROM (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY category ORDER BY score DESC) AS rn
    FROM scored
  ) t
  WHERE rn <= 5;
$$;

GRANT EXECUTE ON FUNCTION public.get_personalized_featured(uuid) TO authenticated;

COMMIT;

-- 0009_fix_featured_functions_for_cafe.sql
-- 0008 added 4 columns to public.location. Two SQL functions are declared
-- `RETURNS SETOF public.location` but end with a HARD-CODED 16-column SELECT, so
-- once the row type grew to 20 columns Postgres rejected them with
-- "return type mismatch in function declared to return location" (500 on the
-- home/featured endpoints). Recreate both with the 4 cafe columns appended, in
-- the same order they were added to the table.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_featured_locations()
RETURNS SETOF public.location
LANGUAGE sql
STABLE
AS $$
  SELECT id, created_at, latitude, longitude, name, end_date, category, url,
         description, tags, place_position, type, img_url, preview_img, reviews, average_rating,
         cafe_name, cafe_subtitle, cafe_image_url, cafe_directions_url
  FROM (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY category ORDER BY random()) AS rn
    FROM public.location
    WHERE category IN (
      'Upcoming Events',
      'Popular Playgrounds',
      'New Playgrounds',
      'New Events',
      'Activities'
    )
      AND (end_date IS NULL OR end_date >= CURRENT_DATE)
  ) t
  WHERE rn <= 5;
$$;

GRANT EXECUTE ON FUNCTION public.get_featured_locations() TO authenticated, anon;

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
    reviews, average_rating,
    cafe_name, cafe_subtitle, cafe_image_url, cafe_directions_url
  FROM (
    SELECT *,
           ROW_NUMBER() OVER (PARTITION BY category ORDER BY score DESC) AS rn
    FROM scored
  ) t
  WHERE rn <= 5;
$$;

GRANT EXECUTE ON FUNCTION public.get_personalized_featured(uuid) TO authenticated;

COMMIT;

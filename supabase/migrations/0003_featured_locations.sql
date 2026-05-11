-- 0003_featured_locations.sql
-- Home-screen featured sections: up to 5 random locations per category,
-- filtered to those still active (end_date null or >= today).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_featured_locations()
RETURNS SETOF public.location
LANGUAGE sql
STABLE
AS $$
  SELECT id, created_at, latitude, longitude, name, end_date, category, url,
         description, tags, place_position, type, img_url, preview_img, reviews, average_rating
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

COMMIT;

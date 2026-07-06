-- 0013_admin_users_list_server_sort.sql
-- Make the member-directory sortable SERVER-SIDE over the whole filtered set.
--
-- 0012's admin_users_list only ORDER BY created_at then LIMIT/OFFSET, so the admin
-- could only sort the currently-loaded page (e.g. "top favourites" showed whoever
-- happened to be on page 1). This adds p_sort + p_dir: counts are computed for
-- every matching user, the full set is ordered by the chosen column, THEN paginated.
--
-- Additive/compatible: the old 3-arg call still resolves (p_sort/p_dir have
-- defaults). Drop the old 3-arg signature first so there's exactly one function.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_users_list(text, int, int);

CREATE OR REPLACE FUNCTION public.admin_users_list(
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_sort text DEFAULT 'created_at',   -- name|postcode|created_at|favorites|saved_deals|reviews|last_active
  p_dir text DEFAULT 'desc'           -- asc|desc
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
  enriched AS (
    SELECT
      f.id, f.name, f.email, f.code, f.created_at,
      COALESCE((SELECT count(*) FROM public.saved_location sl WHERE sl.user_id = f.id), 0) AS favorites,
      COALESCE((SELECT count(*) FROM public.saved_offers   so WHERE so.user_id = f.id), 0) AS saved_deals,
      COALESCE((SELECT count(*) FROM public.reviews        r  WHERE r.user_id  = f.id), 0) AS reviews,
      (SELECT max(e.received_at) FROM public.app_events e WHERE e.user_id = f.id) AS last_active
    FROM filtered f
  ),
  ordered AS (
    SELECT e.*, count(*) OVER() AS total
    FROM enriched e
    ORDER BY
      -- numeric columns
      CASE WHEN p_dir = 'asc' THEN
        CASE p_sort WHEN 'favorites' THEN favorites WHEN 'saved_deals' THEN saved_deals WHEN 'reviews' THEN reviews END
      END ASC NULLS LAST,
      CASE WHEN p_dir = 'desc' THEN
        CASE p_sort WHEN 'favorites' THEN favorites WHEN 'saved_deals' THEN saved_deals WHEN 'reviews' THEN reviews END
      END DESC NULLS LAST,
      -- timestamp columns
      CASE WHEN p_dir = 'asc' THEN
        CASE p_sort WHEN 'created_at' THEN created_at WHEN 'last_active' THEN last_active END
      END ASC NULLS LAST,
      CASE WHEN p_dir = 'desc' THEN
        CASE p_sort WHEN 'created_at' THEN created_at WHEN 'last_active' THEN last_active END
      END DESC NULLS LAST,
      -- text columns
      CASE WHEN p_dir = 'asc' THEN
        CASE p_sort WHEN 'name' THEN lower(name) WHEN 'postcode' THEN lower(code) END
      END ASC NULLS LAST,
      CASE WHEN p_dir = 'desc' THEN
        CASE p_sort WHEN 'name' THEN lower(name) WHEN 'postcode' THEN lower(code) END
      END DESC NULLS LAST,
      -- deterministic tiebreak / default
      created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT id, name, email, code, created_at, favorites, saved_deals, reviews, last_active, total
  FROM ordered;
$$;

GRANT EXECUTE ON FUNCTION public.admin_users_list(text, int, int, text, text) TO authenticated;

COMMIT;

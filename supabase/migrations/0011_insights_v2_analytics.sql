-- 0011_insights_v2_analytics.sql
-- Insights v2.
--
-- A) Fixes the six analytics RPCs shipped in 0010 (already applied in prod, so
--    everything here is CREATE OR REPLACE — except analytics_users, which is
--    dropped and re-created because its grouping/identity semantics change):
--      1. All day/week bucketing in Australia/Sydney time. p_from/p_to are
--         interpreted as Sydney dates.
--      2. Session math uses client timestamps when sane (|client_ts −
--         received_at| ≤ 48h, else fall back to received_at), groups sessions
--         by session_id only, attributes a session to the Sydney date of its
--         first event, and reports the MEDIAN session length (column name
--         avg_session_secs is kept for wire compatibility).
--      3. Identity = anon_id everywhere (user_id only for profile joins).
--      4. analytics_screens: dwell ms parsed only when purely numeric (≤9
--         digits) and clamped to 30 min per event.
--      5. analytics_retention: firsts computed over all history; cohorts
--         restricted to the last 8 Sydney week-buckets; activity window starts
--         at the earliest included cohort week (so Wk0 = 100%); offset ≤ 7.
--
-- B) Adds the historical / database-wide RPCs for the reworked Insights page:
--    analytics_lifetime, analytics_signups_monthly, analytics_top_favorited,
--    analytics_top_clicked, analytics_historical_actives,
--    analytics_dead_inventory, analytics_reviews_trend, analytics_postcodes,
--    analytics_engagement, analytics_dau_by_version.
--
-- Note on the recurring WHERE pattern for app_events:
--   the raw received_at bounds (±1 day around the requested Sydney dates) are
--   deliberately redundant with the exact Sydney-date predicate — they exist
--   so the planner can use app_events_received_idx instead of scanning the
--   whole table.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Daily series: DAU, new signups, sessions, events, median session length
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_daily(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(day date, dau bigint, new_users bigint, sessions bigint, events bigint, avg_session_secs numeric)
LANGUAGE sql STABLE AS $$
  WITH days AS (
    SELECT generate_series(p_from::date, p_to::date, interval '1 day')::date AS day
  ),
  ev AS (
    SELECT (received_at AT TIME ZONE 'Australia/Sydney')::date AS day,
           anon_id,
           session_id,
           -- device clock when sane, server clock otherwise (±48h clamp)
           CASE
             WHEN client_ts IS NULL
               OR abs(EXTRACT(epoch FROM client_ts - received_at)) > 172800
             THEN received_at
             ELSE client_ts
           END AS eff_ts
    FROM public.app_events
    WHERE received_at >= ((p_from::date - interval '1 day') AT TIME ZONE 'UTC')
      AND received_at <  ((p_to::date + interval '1 day') AT TIME ZONE 'UTC')
      AND (received_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
  ),
  sess AS (
    -- one row per session, attributed to the Sydney date of its first event
    -- (no day+session double counting across midnight)
    SELECT (min(eff_ts) AT TIME ZONE 'Australia/Sydney')::date AS day,
           EXTRACT(epoch FROM max(eff_ts) - min(eff_ts)) AS secs
    FROM ev
    GROUP BY session_id
  ),
  nu AS (
    SELECT (created_at AT TIME ZONE 'Australia/Sydney')::date AS day, count(*) AS n
    FROM public.users
    WHERE (created_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
    GROUP BY 1
  )
  SELECT d.day,
         COALESCE((SELECT count(DISTINCT anon_id) FROM ev WHERE ev.day = d.day), 0),
         COALESCE(nu.n, 0),
         COALESCE((SELECT count(*) FROM sess WHERE sess.day = d.day), 0),
         COALESCE((SELECT count(*) FROM ev WHERE ev.day = d.day), 0),
         -- median, not mean; keeps the avg_session_secs wire name
         COALESCE((SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY secs::float8))::numeric)
                   FROM sess WHERE sess.day = d.day), 0)
  FROM days d LEFT JOIN nu ON nu.day = d.day
  ORDER BY d.day;
$$;

-- ---------------------------------------------------------------------------
-- 2) Screens: visits, unique installs, avg time on screen (hardened ms cast)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_screens(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(screen text, views bigint, uniq_users bigint, avg_secs numeric, total_secs numeric)
LANGUAGE sql STABLE AS $$
  WITH views AS (
    SELECT e.screen, count(*) AS views, count(DISTINCT anon_id) AS uniq
    FROM public.app_events e
    WHERE event = 'screen_view' AND e.screen IS NOT NULL
      AND received_at >= ((p_from::date - interval '1 day') AT TIME ZONE 'UTC')
      AND received_at <  ((p_to::date + interval '1 day') AT TIME ZONE 'UTC')
      AND (received_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
    GROUP BY e.screen
  ),
  dwell AS (
    -- ms must be a plain 1-9 digit integer; clamp each event to 30 minutes
    SELECT e.screen,
           avg(LEAST((props->>'ms')::numeric, 1800000) / 1000) AS avg_secs,
           sum(LEAST((props->>'ms')::numeric, 1800000) / 1000) AS total_secs
    FROM public.app_events e
    WHERE event = 'screen_time' AND e.screen IS NOT NULL
      AND props->>'ms' ~ '^\d{1,9}$'
      AND received_at >= ((p_from::date - interval '1 day') AT TIME ZONE 'UTC')
      AND received_at <  ((p_to::date + interval '1 day') AT TIME ZONE 'UTC')
      AND (received_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
    GROUP BY e.screen
  )
  SELECT COALESCE(v.screen, d.screen), COALESCE(v.views,0), COALESCE(v.uniq,0),
         round(COALESCE(d.avg_secs,0),1), round(COALESCE(d.total_secs,0))
  FROM views v FULL OUTER JOIN dwell d ON d.screen = v.screen
  ORDER BY COALESCE(v.views,0) DESC;
$$;

-- ---------------------------------------------------------------------------
-- 3) Geography (IP-derived)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_geo(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(country text, region text, city text, uniq_users bigint, sessions bigint)
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(country,'Unknown'), COALESCE(region,''), COALESCE(city,''),
         count(DISTINCT anon_id),
         count(DISTINCT session_id)
  FROM public.app_events
  WHERE received_at >= ((p_from::date - interval '1 day') AT TIME ZONE 'UTC')
    AND received_at <  ((p_to::date + interval '1 day') AT TIME ZONE 'UTC')
    AND (received_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
  GROUP BY 1,2,3
  ORDER BY 4 DESC
  LIMIT 100;
$$;

-- ---------------------------------------------------------------------------
-- 4) Content: per-location engagement (pixel events)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_top_locations(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(location_id text, name text, type text, suburb text,
              views bigint, favorites bigint, shares bigint, directions bigint, bookings bigint, uniq_users bigint)
LANGUAGE sql STABLE AS $$
  SELECT e.props->>'location_id',
         COALESCE(l.name, e.props->>'name', 'Unknown'),
         COALESCE(l.type, e.props->>'type', ''),
         COALESCE(l.place_position, ''),
         count(*) FILTER (WHERE e.event = 'location_view'),
         count(*) FILTER (WHERE e.event = 'location_favorite'),
         count(*) FILTER (WHERE e.event = 'location_share'),
         count(*) FILTER (WHERE e.event = 'get_directions'),
         count(*) FILTER (WHERE e.event = 'book_now'),
         count(DISTINCT e.anon_id)
  FROM public.app_events e
  LEFT JOIN public.location l ON l.id::text = e.props->>'location_id'
  WHERE e.event IN ('location_view','location_favorite','location_share','get_directions','book_now')
    AND e.props ? 'location_id'
    AND e.received_at >= ((p_from::date - interval '1 day') AT TIME ZONE 'UTC')
    AND e.received_at <  ((p_to::date + interval '1 day') AT TIME ZONE 'UTC')
    AND (e.received_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
  GROUP BY 1,2,3,4
  ORDER BY 5 DESC
  LIMIT 200;
$$;

-- ---------------------------------------------------------------------------
-- 5) Search
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_searches(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(query text, searches bigint, uniq_users bigint, geocoded bigint, fuzzy bigint, missed bigint)
LANGUAGE sql STABLE AS $$
  SELECT lower(trim(props->>'query')),
         count(*),
         count(DISTINCT anon_id),
         count(*) FILTER (WHERE props->>'matched' = 'geocode'),
         count(*) FILTER (WHERE props->>'matched' = 'fuzzy'),
         count(*) FILTER (WHERE props->>'matched' = 'none')
  FROM public.app_events
  WHERE event = 'map_search' AND COALESCE(trim(props->>'query'),'') <> ''
    AND received_at >= ((p_from::date - interval '1 day') AT TIME ZONE 'UTC')
    AND received_at <  ((p_to::date + interval '1 day') AT TIME ZONE 'UTC')
    AND (received_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
  GROUP BY 1 ORDER BY 2 DESC LIMIT 100;
$$;

-- ---------------------------------------------------------------------------
-- 6) Weekly retention cohorts (Sydney weeks, Monday-anchored)
--    firsts over ALL history; cohorts = the 8 most recent week-buckets
--    (current week included); activity counted since the earliest included
--    cohort week so every cohort's Wk0 = 100%.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_retention()
RETURNS TABLE(cohort_week date, cohort_size bigint, week_offset int, active bigint)
LANGUAGE sql STABLE AS $$
  WITH bounds AS (
    SELECT (date_trunc('week', now() AT TIME ZONE 'Australia/Sydney') - interval '7 weeks')::date AS min_week
  ),
  firsts AS (
    SELECT anon_id,
           date_trunc('week', min(received_at AT TIME ZONE 'Australia/Sydney'))::date AS cohort_week
    FROM public.app_events
    GROUP BY 1
  ),
  cohorts AS (
    SELECT f.anon_id, f.cohort_week
    FROM firsts f, bounds b
    WHERE f.cohort_week >= b.min_week
  ),
  activity AS (
    SELECT DISTINCT e.anon_id,
           date_trunc('week', e.received_at AT TIME ZONE 'Australia/Sydney')::date AS active_week
    FROM public.app_events e, bounds b
    WHERE e.received_at >= ((b.min_week - interval '1 day') AT TIME ZONE 'UTC')
  ),
  sizes AS (
    SELECT c.cohort_week, count(*) AS cohort_size FROM cohorts c GROUP BY 1
  )
  SELECT c.cohort_week, s.cohort_size,
         ((a.active_week - c.cohort_week) / 7)::int AS week_offset,
         count(DISTINCT a.anon_id) AS active
  FROM cohorts c
  JOIN activity a ON a.anon_id = c.anon_id AND a.active_week >= c.cohort_week
  JOIN sizes s ON s.cohort_week = c.cohort_week
  WHERE ((a.active_week - c.cohort_week) / 7) <= 7
  GROUP BY 1,2,3 ORDER BY 1,3;
$$;

-- ---------------------------------------------------------------------------
-- 7) Per-install rollup. Grouping changes from COALESCE(user_id, anon_id) to
--    anon_id alone, so DROP + CREATE (OR REPLACE can't change semantics safely
--    if the row identity of the result changes). Wire shape is unchanged:
--    ident is now always the install id, user_id is the linked login if any.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_users(timestamptz, timestamptz, int);
CREATE FUNCTION public.analytics_users(p_from timestamptz, p_to timestamptz, p_limit int DEFAULT 100)
RETURNS TABLE(ident text, user_id uuid, name text, email text, postcode text,
              sessions bigint, events bigint, screens_viewed bigint,
              favorites bigint, first_seen timestamptz, last_seen timestamptz)
LANGUAGE sql STABLE AS $$
  WITH agg AS (
    SELECT e.anon_id AS ident,
           -- any login seen on this install (uuid has no max(); go via text)
           max(e.user_id::text)::uuid AS uid,
           count(DISTINCT e.session_id) AS sessions,
           count(*) AS n_events,
           count(*) FILTER (WHERE e.event = 'screen_view') AS screens_viewed,
           count(*) FILTER (WHERE e.event = 'location_favorite') AS favorites,
           min(e.received_at) AS first_seen,
           max(e.received_at) AS last_seen
    FROM public.app_events e
    WHERE e.received_at >= ((p_from::date - interval '1 day') AT TIME ZONE 'UTC')
      AND e.received_at <  ((p_to::date + interval '1 day') AT TIME ZONE 'UTC')
      AND (e.received_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
    GROUP BY e.anon_id
  )
  SELECT a.ident, a.uid, u.name, u.email, u.code,
         a.sessions, a.n_events, a.screens_viewed, a.favorites, a.first_seen, a.last_seen
  FROM agg a
  LEFT JOIN public.users u ON u.id = a.uid
  ORDER BY a.last_seen DESC
  LIMIT p_limit;
$$;

-- ===========================================================================
-- NEW: historical / database-wide RPCs (Insights v2)
-- ===========================================================================

-- All-time KPI row --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_lifetime()
RETURNS TABLE(total_users bigint, total_favorites bigint, total_reviews_approved bigint,
              avg_rating numeric, live_locations bigint, pending_reviews bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    (SELECT count(*) FROM public.users),
    (SELECT count(*) FROM public.saved_location),
    (SELECT count(*) FROM public.reviews WHERE status = 'approved'),
    (SELECT COALESCE(round(avg(rating), 2), 0) FROM public.reviews WHERE status = 'approved'),
    (SELECT count(*) FROM public.location WHERE end_date IS NULL OR end_date >= current_date),
    (SELECT count(*) FROM public.reviews WHERE status = 'pending');
$$;

-- All-time monthly signups (Sydney months) ---------------------------------
CREATE OR REPLACE FUNCTION public.analytics_signups_monthly()
RETURNS TABLE(month date, signups bigint)
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('month', created_at AT TIME ZONE 'Australia/Sydney')::date AS month,
         count(*) AS signups
  FROM public.users
  GROUP BY 1 ORDER BY 1;
$$;

-- All-time most favorited locations ----------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_top_favorited(p_limit int DEFAULT 50)
RETURNS TABLE(location_id uuid, name text, type text, place_position text,
              saves bigint, savers bigint, first_save timestamptz, last_save timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT s.location_id, l.name, l.type, l.place_position,
         count(*) AS saves,
         count(DISTINCT s.user_id) AS savers,
         min(s.created_at) AS first_save,
         max(s.created_at) AS last_save
  FROM public.saved_location s
  JOIN public.location l ON l.id = s.location_id
  GROUP BY 1,2,3,4
  ORDER BY count(*) DESC
  LIMIT p_limit;
$$;

-- All-time most clicked locations (server-tracked user_interaction) ---------
CREATE OR REPLACE FUNCTION public.analytics_top_clicked(p_limit int DEFAULT 50)
RETURNS TABLE(location_id uuid, name text, type text, place_position text,
              clicks bigint, uniq_users bigint)
LANGUAGE sql STABLE AS $$
  SELECT ui.location_id, l.name, l.type, l.place_position,
         count(*) AS clicks,
         count(DISTINCT ui.user_id) AS uniq_users
  FROM public.user_interaction ui
  JOIN public.location l ON l.id = ui.location_id
  WHERE ui.interaction_type = 'click'
  GROUP BY 1,2,3,4
  ORDER BY count(*) DESC
  LIMIT p_limit;
$$;

-- Daily actives from server-tracked interactions (pre-pixel history) --------
CREATE OR REPLACE FUNCTION public.analytics_historical_actives(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(day date, actives bigint)
LANGUAGE sql STABLE AS $$
  SELECT (created_at AT TIME ZONE 'Australia/Sydney')::date AS day,
         count(DISTINCT user_id) AS actives
  FROM public.user_interaction
  WHERE created_at >= ((p_from::date - interval '1 day') AT TIME ZONE 'UTC')
    AND created_at <  ((p_to::date + interval '1 day') AT TIME ZONE 'UTC')
    AND (created_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
  GROUP BY 1 ORDER BY 1;
$$;

-- Live locations nobody has ever saved or clicked ---------------------------
CREATE OR REPLACE FUNCTION public.analytics_dead_inventory()
RETURNS TABLE(id uuid, name text, type text, place_position text, created_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT l.id, l.name, l.type, l.place_position, l.created_at
  FROM public.location l
  WHERE (l.end_date IS NULL OR l.end_date >= current_date)
    AND NOT EXISTS (SELECT 1 FROM public.saved_location s WHERE s.location_id = l.id)
    AND NOT EXISTS (SELECT 1 FROM public.user_interaction ui WHERE ui.location_id = l.id)
  ORDER BY l.created_at ASC
  LIMIT 200;
$$;

-- Monthly review volume + avg rating (avg over approved only) ---------------
CREATE OR REPLACE FUNCTION public.analytics_reviews_trend()
RETURNS TABLE(month date, reviews bigint, avg_rating numeric)
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('month', created_at AT TIME ZONE 'Australia/Sydney')::date AS month,
         count(*) AS reviews,
         round(avg(rating) FILTER (WHERE status = 'approved'), 2) AS avg_rating
  FROM public.reviews
  GROUP BY 1 ORDER BY 1;
$$;

-- Signup postcode distribution (post_codes.name = suburb label) -------------
CREATE OR REPLACE FUNCTION public.analytics_postcodes(p_limit int DEFAULT 30)
RETURNS TABLE(code text, suburb text, users bigint)
LANGUAGE sql STABLE AS $$
  WITH uc AS (
    SELECT u.code, count(*) AS n
    FROM public.users u
    WHERE u.code IS NOT NULL AND btrim(u.code) <> ''
    GROUP BY u.code
  ),
  pc AS (
    -- a postcode can map to several suburb rows; collapse to one label
    SELECT p.code, min(p.name) AS suburb
    FROM public.post_codes p
    GROUP BY p.code
  )
  SELECT uc.code, pc.suburb, uc.n
  FROM uc
  LEFT JOIN pc ON pc.code = uc.code
  ORDER BY uc.n DESC, uc.code
  LIMIT p_limit;
$$;

-- DAU/WAU/MAU + stickiness, anchored on the requested end date --------------
-- (the dashboard passes p_to = Sydney "yesterday"; the anchor is capped at
--  the last full Sydney day so a partial "today" never skews the numbers)
CREATE OR REPLACE FUNCTION public.analytics_engagement(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(dau_yesterday bigint, wau bigint, mau bigint, stickiness numeric)
LANGUAGE sql STABLE AS $$
  WITH anchor AS (
    SELECT LEAST(p_to::date, (now() AT TIME ZONE 'Australia/Sydney')::date - 1) AS d
  ),
  ev AS (
    SELECT e.anon_id, (e.received_at AT TIME ZONE 'Australia/Sydney')::date AS day
    FROM public.app_events e, anchor
    WHERE e.received_at >= ((anchor.d - interval '30 days') AT TIME ZONE 'UTC')
      AND e.received_at <  ((anchor.d + interval '2 days') AT TIME ZONE 'UTC')
  ),
  agg AS (
    SELECT
      count(DISTINCT anon_id) FILTER (WHERE day = (SELECT d FROM anchor)) AS dau,
      count(DISTINCT anon_id) FILTER (WHERE day >  (SELECT d FROM anchor) - 7
                                        AND day <= (SELECT d FROM anchor)) AS wau,
      count(DISTINCT anon_id) FILTER (WHERE day >  (SELECT d FROM anchor) - 30
                                        AND day <= (SELECT d FROM anchor)) AS mau
    FROM ev
  )
  SELECT agg.dau, agg.wau, agg.mau,
         COALESCE(round(agg.dau::numeric / NULLIF(agg.mau, 0), 3), 0)
  FROM agg;
$$;

-- Per-day DAU split by app version ------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_dau_by_version(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(day date, app_version text, dau bigint)
LANGUAGE sql STABLE AS $$
  SELECT (e.received_at AT TIME ZONE 'Australia/Sydney')::date AS day,
         COALESCE(e.app_version, 'unknown') AS app_version,
         count(DISTINCT e.anon_id) AS dau
  FROM public.app_events e
  WHERE e.received_at >= ((p_from::date - interval '1 day') AT TIME ZONE 'UTC')
    AND e.received_at <  ((p_to::date + interval '1 day') AT TIME ZONE 'UTC')
    AND (e.received_at AT TIME ZONE 'Australia/Sydney')::date BETWEEN p_from::date AND p_to::date
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

COMMIT;

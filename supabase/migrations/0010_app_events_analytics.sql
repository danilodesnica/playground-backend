-- 0010_app_events_analytics.sql
-- First-party analytics ("the pixel"). One raw event stream + SQL aggregate
-- functions the admin Insights dashboard calls via RPC. Fully additive — no
-- existing table or function is touched, so the live app is unaffected.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now(),
  client_ts    timestamptz,          -- when it happened on the device
  anon_id      text NOT NULL,        -- stable per-install id (works for guests)
  user_id      uuid,                 -- set when the batch carried a valid JWT
  session_id   text NOT NULL,
  event        text NOT NULL,        -- screen_view / screen_time / location_view / ...
  screen       text,                 -- route the event happened on
  props        jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_version  text,
  platform     text,                 -- ios | android
  os_version   text,
  device_model text,
  country      text,                 -- server-side IP geo enrichment
  region       text,
  city         text
);

CREATE INDEX IF NOT EXISTS app_events_received_idx ON public.app_events (received_at DESC);
CREATE INDEX IF NOT EXISTS app_events_event_idx    ON public.app_events (event, received_at DESC);
CREATE INDEX IF NOT EXISTS app_events_user_idx     ON public.app_events (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS app_events_session_idx  ON public.app_events (session_id);
CREATE INDEX IF NOT EXISTS app_events_screen_idx   ON public.app_events (screen, received_at DESC);

-- Only the backend (service role) reads/writes; RLS with no policies blocks
-- direct PostgREST access with the anon key.
ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

-- Identity for counting "users": logged-in id when present, else the install id.
-- (inlined as COALESCE(user_id::text, anon_id) in the functions below)

-- ---------------------------------------------------------------------------
-- 1) Daily series: DAU, new signups, sessions, events, avg session length
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_daily(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(day date, dau bigint, new_users bigint, sessions bigint, events bigint, avg_session_secs numeric)
LANGUAGE sql STABLE AS $$
  WITH days AS (
    SELECT generate_series(p_from::date, p_to::date, interval '1 day')::date AS day
  ),
  ev AS (
    SELECT received_at::date AS day,
           COALESCE(user_id::text, anon_id) AS ident,
           session_id, received_at
    FROM public.app_events
    WHERE received_at >= p_from AND received_at < p_to + interval '1 day'
  ),
  sess AS (
    SELECT day, session_id,
           EXTRACT(epoch FROM max(received_at) - min(received_at)) AS secs
    FROM ev GROUP BY day, session_id
  ),
  nu AS (
    SELECT created_at::date AS day, count(*) AS n
    FROM public.users
    WHERE created_at >= p_from AND created_at < p_to + interval '1 day'
    GROUP BY 1
  )
  SELECT d.day,
         COALESCE((SELECT count(DISTINCT ident) FROM ev WHERE ev.day = d.day), 0),
         COALESCE(nu.n, 0),
         COALESCE((SELECT count(*) FROM sess WHERE sess.day = d.day), 0),
         COALESCE((SELECT count(*) FROM ev WHERE ev.day = d.day), 0),
         COALESCE((SELECT round(avg(secs)) FROM sess WHERE sess.day = d.day), 0)
  FROM days d LEFT JOIN nu ON nu.day = d.day
  ORDER BY d.day;
$$;

-- ---------------------------------------------------------------------------
-- 2) Screens: visits, unique users, avg time on screen (from screen_time events)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_screens(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(screen text, views bigint, uniq_users bigint, avg_secs numeric, total_secs numeric)
LANGUAGE sql STABLE AS $$
  WITH views AS (
    SELECT e.screen, count(*) AS views, count(DISTINCT COALESCE(user_id::text, anon_id)) AS uniq
    FROM public.app_events e
    WHERE event = 'screen_view' AND e.screen IS NOT NULL
      AND received_at >= p_from AND received_at < p_to + interval '1 day'
    GROUP BY e.screen
  ),
  dwell AS (
    SELECT e.screen,
           avg((props->>'ms')::numeric / 1000) AS avg_secs,
           sum((props->>'ms')::numeric / 1000) AS total_secs
    FROM public.app_events e
    WHERE event = 'screen_time' AND e.screen IS NOT NULL AND props ? 'ms'
      AND received_at >= p_from AND received_at < p_to + interval '1 day'
    GROUP BY e.screen
  )
  SELECT COALESCE(v.screen, d.screen), COALESCE(v.views,0), COALESCE(v.uniq,0),
         round(COALESCE(d.avg_secs,0),1), round(COALESCE(d.total_secs,0))
  FROM views v FULL OUTER JOIN dwell d ON d.screen = v.screen
  ORDER BY COALESCE(v.views,0) DESC;
$$;

-- ---------------------------------------------------------------------------
-- 3) Geography: country/region/city (IP-derived, plus platform split)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_geo(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(country text, region text, city text, uniq_users bigint, sessions bigint)
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(country,'Unknown'), COALESCE(region,''), COALESCE(city,''),
         count(DISTINCT COALESCE(user_id::text, anon_id)),
         count(DISTINCT session_id)
  FROM public.app_events
  WHERE received_at >= p_from AND received_at < p_to + interval '1 day'
  GROUP BY 1,2,3
  ORDER BY 4 DESC
  LIMIT 100;
$$;

-- ---------------------------------------------------------------------------
-- 4) Content: per-location engagement (views/favorites/shares/directions/bookings)
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
         count(DISTINCT COALESCE(e.user_id::text, e.anon_id))
  FROM public.app_events e
  LEFT JOIN public.location l ON l.id::text = e.props->>'location_id'
  WHERE e.event IN ('location_view','location_favorite','location_share','get_directions','book_now')
    AND e.props ? 'location_id'
    AND e.received_at >= p_from AND e.received_at < p_to + interval '1 day'
  GROUP BY 1,2,3,4
  ORDER BY 5 DESC
  LIMIT 200;
$$;

-- ---------------------------------------------------------------------------
-- 5) Search: what people look for on the map (and whether it resolved)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_searches(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(query text, searches bigint, uniq_users bigint, geocoded bigint, fuzzy bigint, missed bigint)
LANGUAGE sql STABLE AS $$
  SELECT lower(trim(props->>'query')),
         count(*),
         count(DISTINCT COALESCE(user_id::text, anon_id)),
         count(*) FILTER (WHERE props->>'matched' = 'geocode'),
         count(*) FILTER (WHERE props->>'matched' = 'fuzzy'),
         count(*) FILTER (WHERE props->>'matched' = 'none')
  FROM public.app_events
  WHERE event = 'map_search' AND COALESCE(trim(props->>'query'),'') <> ''
    AND received_at >= p_from AND received_at < p_to + interval '1 day'
  GROUP BY 1 ORDER BY 2 DESC LIMIT 100;
$$;

-- ---------------------------------------------------------------------------
-- 6) Weekly retention cohorts (last 8 weeks): of identities first seen in week X,
--    what share came back in week X+N
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_retention()
RETURNS TABLE(cohort_week date, cohort_size bigint, week_offset int, active bigint)
LANGUAGE sql STABLE AS $$
  WITH firsts AS (
    SELECT COALESCE(user_id::text, anon_id) AS ident,
           date_trunc('week', min(received_at))::date AS cohort_week
    FROM public.app_events GROUP BY 1
  ),
  activity AS (
    SELECT DISTINCT COALESCE(user_id::text, anon_id) AS ident,
           date_trunc('week', received_at)::date AS active_week
    FROM public.app_events
    WHERE received_at >= now() - interval '8 weeks'
  ),
  sizes AS (
    SELECT cohort_week, count(*) AS cohort_size FROM firsts
    WHERE cohort_week >= (now() - interval '8 weeks')::date
    GROUP BY 1
  )
  SELECT f.cohort_week, s.cohort_size,
         ((a.active_week - f.cohort_week) / 7)::int AS week_offset,
         count(DISTINCT a.ident) AS active
  FROM firsts f
  JOIN activity a ON a.ident = f.ident AND a.active_week >= f.cohort_week
  JOIN sizes s ON s.cohort_week = f.cohort_week
  WHERE f.cohort_week >= (now() - interval '8 weeks')::date
  GROUP BY 1,2,3 ORDER BY 1,3;
$$;

-- ---------------------------------------------------------------------------
-- 7) Per-user rollup (drill-down entry point). Joins profile + signup postcode.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_users(p_from timestamptz, p_to timestamptz, p_limit int DEFAULT 100)
RETURNS TABLE(ident text, user_id uuid, name text, email text, postcode text,
              sessions bigint, events bigint, screens_viewed bigint,
              favorites bigint, first_seen timestamptz, last_seen timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(e.user_id::text, e.anon_id),
         e.user_id,
         u.name, u.email, u.code,
         count(DISTINCT e.session_id),
         count(*),
         count(*) FILTER (WHERE e.event = 'screen_view'),
         count(*) FILTER (WHERE e.event = 'location_favorite'),
         min(e.received_at), max(e.received_at)
  FROM public.app_events e
  LEFT JOIN public.users u ON u.id = e.user_id
  WHERE e.received_at >= p_from AND e.received_at < p_to + interval '1 day'
  GROUP BY 1,2,3,4,5
  ORDER BY max(e.received_at) DESC
  LIMIT p_limit;
$$;

COMMIT;

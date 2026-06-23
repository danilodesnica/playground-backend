-- 0005_location_geo_index.sql
-- Speeds up the Discover map's viewport query, which filters
--   latitude  BETWEEN :latMin  AND :latMax
--   longitude BETWEEN :lngMin  AND :lngMax
-- Before this, location had no index on lat/long, so every pan/zoom did a
-- sequential scan + sort over the whole table (1000+ rows).
--
-- A composite btree on (latitude, longitude) lets Postgres range-scan on the
-- (more selective) latitude bound first. For a true 2-D nearest/box workload the
-- ideal is PostGIS + a GiST index on geography(Point); that's the recommended
-- future upgrade if the dataset grows substantially.

BEGIN;

CREATE INDEX IF NOT EXISTS location_lat_lng_idx
  ON public.location (latitude, longitude);

COMMIT;

-- 0008_add_cafe_fields_to_locations.sql
-- Optional "nearest cafe" per location, shown as a card above the reviews on the
-- playground detail screen. All four columns are nullable with no default, so
-- existing rows and the currently-live App Store app are completely unaffected
-- (fully back-compatible — a location with these NULL simply shows no cafe card).

BEGIN;

ALTER TABLE public.location
  ADD COLUMN IF NOT EXISTS cafe_name text,
  ADD COLUMN IF NOT EXISTS cafe_subtitle text,
  ADD COLUMN IF NOT EXISTS cafe_image_url text,
  ADD COLUMN IF NOT EXISTS cafe_directions_url text;

COMMIT;

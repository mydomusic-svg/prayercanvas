-- Picker thumbnails.
--
-- The create page's character and photo grids were rendering the FULL
-- assets: each cartoon portrait is a 1024x1024 PNG of 1.2-1.5 MB, shown at
-- about 64 CSS pixels. Six of them means ~7.7 MB downloaded to draw six
-- thumbnails. On a phone over cellular they arrive slowly and one by one,
-- which looks exactly like "some of the images aren't displaying" — and it
-- burns Storage egress, which is the quota this project is closest to.
--
-- Supabase's on-the-fly image transformations would solve this server-side,
-- but they are not available on the Free plan, so the small versions are
-- pre-generated and stored alongside the originals instead
-- (scripts/make-thumbnails.mjs).
--
-- The full asset is still what gets rendered into a video. This column only
-- affects what the picker downloads.

alter table public.cartoon_characters
  add column if not exists thumb_asset text;

alter table public.photo_styles
  add column if not exists thumb_asset text;

comment on column public.cartoon_characters.thumb_asset is
  'Small WebP for the create-page picker grid. Falls back to image_asset when null. Never used for rendering.';
comment on column public.photo_styles.thumb_asset is
  'Small WebP for the create-page picker grid. Falls back to image_asset when null. Never used for rendering.';

-- Grow the video + music libraries beyond one-clip-per-style: add category
-- tags (so the picker can group/filter instead of one flat grid) and
-- source/license metadata (so the Credits page can be generated from the
-- database instead of hand-maintained arrays).

alter table public.styles
  add column if not exists category text,
  add column if not exists source text,
  add column if not exists license text;

-- Music is now chosen independently via music_styles/music_style_id (see
-- 0010_music_styles.sql). styles.music_asset is kept only as a legacy
-- fallback and no longer needs to be populated for new video-only rows.
alter table public.styles alter column music_asset drop not null;

alter table public.music_styles
  add column if not exists category text,
  add column if not exists source text,
  add column if not exists license text;

-- Backfill existing rows: each existing style's own name is a sensible
-- category (Nature, Cinematic, Minimal, Celebration, Scripture, Peaceful),
-- and we know these came from Pexels (video) + incompetech (music).
update public.styles
set category = coalesce(category, name),
    source = coalesce(source, 'Pexels'),
    license = coalesce(license, 'Pexels License (free for commercial use, no attribution required)')
where category is null or source is null or license is null;

update public.music_styles
set category = coalesce(category, name),
    source = coalesce(source, 'Kevin MacLeod (incompetech.com)'),
    license = coalesce(license, 'Creative Commons Attribution 4.0')
where category is null or source is null or license is null;

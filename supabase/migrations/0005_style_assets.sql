-- Real background video + music assets per style (replaces the Sprint 3
-- procedural solid-color placeholders). Assets themselves are uploaded by
-- scripts/seed-style-assets.mjs, not by this migration — this just creates
-- the public bucket they land in and points the `styles` rows at real files
-- instead of the placeholder filenames from 0001_init.sql.

insert into storage.buckets (id, name, public)
values ('style-assets', 'style-assets', true)
on conflict (id) do nothing;

create policy "Anyone can read style assets"
on storage.objects for select
to public
using (bucket_id = 'style-assets');

-- visual_asset / music_asset are updated to real public URLs by
-- scripts/seed-style-assets.mjs after it uploads the files, so no further
-- SQL is needed here.

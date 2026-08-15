-- User-uploaded photo backgrounds with a Ken Burns pan/zoom effect, as an
-- alternative to picking a library video style. The render worker
-- (worker/index.js's generateKenBurnsClip) turns the still photo into a
-- short looping pan/zoom video, then feeds it through the exact same
-- caption/title/audio pipeline a library style's video would use.

alter table public.prayers
  add column if not exists photo_asset_url text;

-- New bucket for user-uploaded photos, mirroring prayer-audio (see
-- 0002_storage_policies.sql) — public read (rendered videos are already
-- public-by-URL once shared, so the source photo behind one isn't a
-- meaningfully more sensitive secret), writes gated to the owner's own
-- folder by the policies below.
insert into storage.buckets (id, name, public)
values ('prayer-photos', 'prayer-photos', true)
on conflict (id) do nothing;

create policy "Users can upload their own prayer photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'prayer-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can read their own prayer photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'prayer-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete their own prayer photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'prayer-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

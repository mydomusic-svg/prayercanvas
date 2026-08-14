-- Storage RLS policies for the prayer-audio bucket.
-- Marking a bucket "Public" only allows public reads; uploads still require
-- an explicit RLS policy on storage.objects. This was missing from the
-- initial migration.

create policy "Users can upload their own prayer audio"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'prayer-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can read their own prayer audio"
on storage.objects for select
to authenticated
using (
  bucket_id = 'prayer-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can delete their own prayer audio"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'prayer-audio'
  and (storage.foldername(name))[1] = auth.uid()::text
);

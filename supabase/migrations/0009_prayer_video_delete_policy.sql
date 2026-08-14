-- Sprint 4: users can now delete their own prayers/videos from the UI.
-- prayer-videos only had a public-read policy (the worker uploads via the
-- service role key, which bypasses RLS) — without this, a client-side
-- delete of the rendered video/thumbnail objects would silently fail RLS
-- while the DB row still got removed, leaving orphaned files in storage.

create policy "Users can delete their own rendered prayer videos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'prayer-videos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

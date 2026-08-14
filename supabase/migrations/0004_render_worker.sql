-- Sprint 3: storage bucket for rendered prayer videos, created directly via
-- SQL (unlike prayer-audio, which was created through the dashboard) so
-- there's one less manual step. The render worker uploads here using the
-- service role key, which bypasses RLS entirely — no upload policy needed,
-- only a public-read policy so finished videos can be played back and shared.

insert into storage.buckets (id, name, public)
values ('prayer-videos', 'prayer-videos', true)
on conflict (id) do nothing;

create policy "Anyone can read rendered prayer videos"
on storage.objects for select
to public
using (bucket_id = 'prayer-videos');

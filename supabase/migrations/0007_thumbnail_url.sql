-- Sprint 3.7: stores a generated poster/thumbnail image URL per render, so
-- the prayer's video can show a designed, readable frame (title + prayer
-- text over the video's own background art) before the viewer presses play.
alter table public.render_jobs
  add column if not exists thumbnail_url text;

-- Sprint 3.6: stores Whisper's word-level timestamps (in addition to the
-- segment-level ones already in `captions`) so the render worker can burn in
-- captions that highlight the exact word being spoken as the prayer plays.
alter table public.prayers
  add column if not exists word_timings jsonb;

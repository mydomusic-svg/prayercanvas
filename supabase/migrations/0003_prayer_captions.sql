-- Sprint 2: stores Whisper's segment-level timestamps so the render worker
-- (Sprint 3) can burn in synced captions without re-deriving timing.
alter table public.prayers
  add column if not exists captions jsonb;

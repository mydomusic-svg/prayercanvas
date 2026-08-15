-- Decouples background music from the visual style. Previously each
-- `styles` row bundled one background video with one music track, so
-- picking a visual style always picked its music too. Users can now choose
-- a visual style and a music style independently.
--
-- Backfills one music_styles row per existing visual style (reusing its
-- current music_asset), so this is a no-op for every prayer created before
-- this migration — the worker still finds the same track for them via the
-- style's own music_asset fallback (see worker/index.js).

create table if not exists public.music_styles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  music_asset text,
  created_at timestamptz not null default now()
);

alter table public.music_styles enable row level security;

create policy "Anyone can read music styles"
  on public.music_styles for select
  using (true);

insert into public.music_styles (name, music_asset)
select name, music_asset
from public.styles
where music_asset is not null and music_asset like 'http%';

alter table public.prayers
  add column if not exists music_style_id uuid references public.music_styles (id);

-- Curated stock-photo library, as an alternative to "upload your own photo"
-- (0012_photo_upload.sql) for the Ken Burns background. Mirrors
-- music_styles (0010) / styles (0001): a public-read table seeded by a
-- script, not by hand. Reuses the existing public `style-assets` bucket
-- (0005_style_assets.sql) under a photos/ prefix rather than creating a new
-- bucket — the worker just needs an HTTP-reachable URL for
-- prayers.photo_asset_url, and that bucket is already public-read.
create table if not exists public.photo_styles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_asset text not null,
  category text,
  source text,
  license text,
  created_at timestamptz not null default now()
);

alter table public.photo_styles enable row level security;

create policy "Anyone can read photo styles"
  on public.photo_styles for select
  using (true);

-- PrayerCanvas MVP schema
-- Run via `supabase db push`, or paste into the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users (profile row that mirrors auth.users; keeps app data out of auth schema)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Users can view their own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.users for update
  using (auth.uid() = id);

-- Auto-create a public.users row whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- styles (seeded visual + music template combinations)
-- ---------------------------------------------------------------------------
create table if not exists public.styles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  visual_asset text not null,
  music_asset text not null,
  caption_template text,
  created_at timestamptz not null default now()
);

alter table public.styles enable row level security;

create policy "Anyone can read styles"
  on public.styles for select
  using (true);

-- ---------------------------------------------------------------------------
-- prayers
-- ---------------------------------------------------------------------------
create table if not exists public.prayers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  recipient_name text,
  occasion text,
  title text,
  transcript text,
  theme text,
  style_id uuid references public.styles (id),
  privacy text not null default 'private' check (privacy in ('private', 'unlisted', 'public')),
  created_at timestamptz not null default now()
);

alter table public.prayers enable row level security;

create policy "Users can manage their own prayers"
  on public.prayers for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- media_assets (raw audio, background clips, rendered output, etc.)
-- ---------------------------------------------------------------------------
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  prayer_id uuid not null references public.prayers (id) on delete cascade,
  type text not null check (type in ('raw_audio', 'clean_audio', 'background', 'music', 'rendered_video')),
  storage_url text not null,
  duration numeric,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.media_assets enable row level security;

create policy "Users can manage media for their own prayers"
  on public.media_assets for all
  using (exists (
    select 1 from public.prayers
    where prayers.id = media_assets.prayer_id
      and prayers.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.prayers
    where prayers.id = media_assets.prayer_id
      and prayers.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- render_jobs
-- ---------------------------------------------------------------------------
create table if not exists public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  prayer_id uuid not null references public.prayers (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'complete', 'failed')),
  progress integer not null default 0,
  error text,
  output_url text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.render_jobs enable row level security;

create policy "Users can view render jobs for their own prayers"
  on public.render_jobs for select
  using (exists (
    select 1 from public.prayers
    where prayers.id = render_jobs.prayer_id
      and prayers.user_id = auth.uid()
  ));

create policy "Users can create render jobs for their own prayers"
  on public.render_jobs for insert
  with check (exists (
    select 1 from public.prayers
    where prayers.id = render_jobs.prayer_id
      and prayers.user_id = auth.uid()
  ));

-- Note: updates to status/progress/output_url are made by the render worker
-- using the service_role key, which bypasses RLS by design.

-- ---------------------------------------------------------------------------
-- share_links
-- ---------------------------------------------------------------------------
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  prayer_id uuid not null references public.prayers (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(12), 'hex'),
  expires_at timestamptz,
  view_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.share_links enable row level security;

create policy "Users can manage share links for their own prayers"
  on public.share_links for all
  using (exists (
    select 1 from public.prayers
    where prayers.id = share_links.prayer_id
      and prayers.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.prayers
    where prayers.id = share_links.prayer_id
      and prayers.user_id = auth.uid()
  ));

-- Public share pages read via token, not user session, so lookups by token
-- go through a service-role API route (src/app/p/[token]) rather than direct
-- anon-key access. This keeps prayer content private-by-default.

-- ---------------------------------------------------------------------------
-- seed styles
-- ---------------------------------------------------------------------------
insert into public.styles (name, visual_asset, music_asset, caption_template)
values
  ('Nature', 'nature-loop.mp4', 'nature-piano.mp3', 'default'),
  ('Cinematic', 'cinematic-loop.mp4', 'cinematic-strings.mp3', 'default'),
  ('Minimal', 'minimal-loop.mp4', 'minimal-ambient.mp3', 'default'),
  ('Celebration', 'celebration-loop.mp4', 'celebration-upbeat.mp3', 'default'),
  ('Scripture', 'scripture-loop.mp4', 'scripture-choral.mp3', 'default'),
  ('Peaceful', 'peaceful-loop.mp4', 'peaceful-pads.mp3', 'default')
on conflict do nothing;

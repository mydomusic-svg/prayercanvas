-- Free-plan download cap: 3 downloads per day, resetting daily. Paid plans
-- are unlimited. Pairs with the 24-hour video expiry in the render worker —
-- together they make "keep and re-share your videos" the concrete thing a
-- subscription buys.
--
-- Downloads are recorded as a log rather than a counter column so the cap
-- can be a rolling 24-hour window (a counter would need a reset job, and a
-- reset-at-midnight cap is trivially gamed by waiting for midnight). It
-- also leaves real usage data behind, which is worth having before tuning
-- the number.

create table if not exists public.prayer_downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Kept nullable and ON DELETE SET NULL: deleting a prayer must not erase
  -- the fact that a download was spent, or deleting prayers would become a
  -- way to reset the daily cap.
  prayer_id uuid references public.prayers (id) on delete set null,
  created_at timestamptz not null default now()
);

-- The only query this table serves is "how many rows for this user since
-- timestamp X", so index exactly that.
create index if not exists prayer_downloads_user_created_idx
  on public.prayer_downloads (user_id, created_at desc);

alter table public.prayer_downloads enable row level security;

-- Users may see their own history (so the UI can show "2 of 3 left"), but
-- the INSERT that actually spends a download is done server-side with the
-- service role in /api/prayers/[id]/download — deliberately NOT granted to
-- the client, since a client that can write its own usage rows can also
-- decline to.
create policy "Users can view their own download history"
  on public.prayer_downloads for select
  using (auth.uid() = user_id);

-- Billing columns live in the live database but were never captured in a
-- migration file (they were applied straight through the dashboard), which
-- means a fresh environment would not have them and the download check —
-- and the worker's retention sweep — would treat everyone as unknown.
-- Adding them here idempotently so the schema is reproducible. Existing
-- databases are unaffected: `if not exists` is a no-op where they already
-- exist.
alter table public.users
  add column if not exists plan text not null default 'free',
  add column if not exists subscription_status text,
  add column if not exists extra_credits integer not null default 0;

-- Free-plan cap: 2 prayer videos per calendar month. Paid plans unlimited.
--
-- The client has been ready for this since the create page was written —
-- it catches an error whose message is exactly 'quota_exceeded' and shows
-- "You've used your 2 free prayer videos this month" with a link to
-- /pricing. The function it was waiting for was never written, so the cap
-- has been advertised on the pricing page and unenforced in the product.
--
-- WHY THIS MATTERS BEYOND BILLING. Each prayer costs roughly 1.2MB of
-- Storage (video plus audio) and this project sits on a 1GB tier that was
-- over quota a week ago. Unlimited free creation has a hard ceiling at
-- around 420 prayers that arrives with no warning and takes the whole app
-- down when it does. The cap is a survival measure first and a pricing
-- lever second.
--
-- ENFORCED IN THE DATABASE, not the API. Prayers are inserted straight
-- from the browser with the anon key under RLS, so anything checked in
-- JavaScript is advisory — a trigger is the only place the count cannot be
-- talked out of.

-- ---------------------------------------------------------------------------
-- USAGE LEDGER.
--
-- Counting public.prayers directly would make DELETE a reset button: use
-- both videos, delete one, make another, forever. So usage is recorded
-- separately and prayer_id is ON DELETE SET NULL — deleting the prayer
-- forgets which prayer it was, never that the slot was spent. This is the
-- same shape (and the same reasoning) as prayer_downloads in 0016.
-- ---------------------------------------------------------------------------
create table if not exists public.prayer_creations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prayer_id uuid references public.prayers (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists prayer_creations_user_created_idx
  on public.prayer_creations (user_id, created_at desc);

alter table public.prayer_creations enable row level security;

-- Readable by the owner so the UI can show what is left; never writable
-- from the browser. A client that can write its own usage rows can also
-- quietly not write them.
drop policy if exists "Users can read their own prayer creations" on public.prayer_creations;
create policy "Users can read their own prayer creations"
  on public.prayer_creations for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- THE CAP.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_prayer_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  free_limit constant int := 2;
  user_plan text;
  used int;
begin
  select plan into user_plan from public.users where id = new.user_id;

  -- Anything other than an explicit 'free' counts as paid — the same
  -- fail-safe direction the download meter uses. If we cannot tell what
  -- someone is on, do not take something away from someone who may be
  -- paying.
  if user_plan is null or user_plan <> 'free' then
    return new;
  end if;

  -- Calendar month, not a rolling 30 days. The pricing page and the
  -- create page both already say "this month", and someone who made two
  -- videos in August and is told on 1 September that they must wait has
  -- been told something that reads as a bug.
  select count(*) into used
  from public.prayer_creations
  where user_id = new.user_id
    and created_at >= date_trunc('month', now());

  if used >= free_limit then
    -- This exact string is what the create page matches on.
    raise exception 'quota_exceeded';
  end if;

  return new;
end;
$$;

drop trigger if exists prayers_enforce_quota on public.prayers;
create trigger prayers_enforce_quota
  before insert on public.prayers
  for each row execute function public.enforce_prayer_quota();

-- Recorded after the row exists, so the ledger's foreign key is valid.
create or replace function public.record_prayer_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.prayer_creations (user_id, prayer_id)
  values (new.user_id, new.id);
  return new;
end;
$$;

drop trigger if exists prayers_record_creation on public.prayers;
create trigger prayers_record_creation
  after insert on public.prayers
  for each row execute function public.record_prayer_creation();

-- Backfill, so the first month under the cap counts what people actually
-- made rather than handing everyone a fresh allowance.
insert into public.prayer_creations (user_id, prayer_id, created_at)
select p.user_id, p.id, p.created_at
from public.prayers p
where not exists (
  select 1 from public.prayer_creations c where c.prayer_id = p.id
);

-- The owner account is exempt, so testing the app is not itself capped.
-- 'admin' rather than 'plus' so it can never be mistaken for a Stripe
-- subscription when billing is switched on.
update public.users set plan = 'admin'
 where email = 'mydomusic@gmail.com';

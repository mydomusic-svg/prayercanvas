-- Study Bible: personal marks, and cached devotional commentary.

-- ---------------------------------------------------------------------------
-- MARKS — highlight, bold, underline, bookmark.
--
-- One row per (user, verse, style), so a verse can be highlighted AND
-- bookmarked at once rather than the styles fighting over a single column.
-- Toggling a mark off deletes the row.
--
-- Verses are referenced by their coordinates rather than by bible_verses.id
-- because re-seeding a translation reassigns those ids — a user's markings
-- must survive a data refresh they never asked for and cannot see.
-- ---------------------------------------------------------------------------
create table if not exists public.bible_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  translation text not null,
  book_order int not null,
  book text not null,
  chapter int not null,
  verse int not null,
  style text not null check (style in ('highlight', 'bold', 'underline', 'bookmark')),
  created_at timestamptz not null default now(),
  unique (user_id, translation, book_order, chapter, verse, style)
);

create index if not exists bible_marks_lookup_idx
  on public.bible_marks (user_id, translation, book, chapter);
-- The bookmarks list is ordered newest-first across the whole Bible.
create index if not exists bible_marks_bookmarks_idx
  on public.bible_marks (user_id, style, created_at desc);

alter table public.bible_marks enable row level security;

drop policy if exists "Users manage their own bible marks" on public.bible_marks;
create policy "Users manage their own bible marks"
  on public.bible_marks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- COMMENTARY CACHE.
--
-- Generating an explanation costs about a quarter of a cent, but the Bible
-- is finite: 1,189 chapters, so even commentary on all of it amounts to a
-- few dollars ONCE. Caching turns an ongoing per-user cost into a one-time
-- one, and makes the second reader of John 3:16 free forever.
--
-- Shared across all users, not per-user, which is the whole point — and why
-- it is readable by anyone signed in but writable only by the service role
-- through the API route.
--
-- The key is the exact passage: same translation, same verses, same
-- commentary. passage_key is built by the API route as
-- "<translation>:<book_order>:<chapter>:<verseStart>-<verseEnd>".
-- ---------------------------------------------------------------------------
create table if not exists public.bible_commentary (
  passage_key text primary key,
  translation text not null,
  book text not null,
  chapter int not null,
  verse_start int not null,
  verse_end int not null,
  reference text not null,
  commentary text not null,
  created_at timestamptz not null default now()
);

alter table public.bible_commentary enable row level security;

drop policy if exists "Anyone can read commentary" on public.bible_commentary;
create policy "Anyone can read commentary"
  on public.bible_commentary for select
  using (true);
-- No insert/update policy on purpose: writes go through the API route using
-- the service role, so a client cannot poison the shared cache.

-- ---------------------------------------------------------------------------
-- Abuse stop only.
--
-- Cached passages are free to serve, so this counts GENERATIONS, not reads.
-- The cap is set far above what studying looks like — it exists so one
-- script cannot walk every possible verse range overnight, not to ration a
-- feature that costs fractions of a cent.
-- ---------------------------------------------------------------------------
create table if not exists public.commentary_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists commentary_generations_user_idx
  on public.commentary_generations (user_id, created_at desc);

alter table public.commentary_generations enable row level security;

drop policy if exists "Users see their own generation log" on public.commentary_generations;
create policy "Users see their own generation log"
  on public.commentary_generations for select
  using (auth.uid() = user_id);

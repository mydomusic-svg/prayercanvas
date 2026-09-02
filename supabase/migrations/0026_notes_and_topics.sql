-- Private notes on a verse, and browse-by-topic.

-- ---------------------------------------------------------------------------
-- NOTES.
--
-- One note per user per verse. Deliberately NOT keyed on translation: a
-- thought you have about Psalm 23:4 is a thought about that verse, not about
-- the KJV's wording of it. Keying on translation would silently hide your own
-- note the moment you flipped the reader to WEB.
--
-- Coordinates rather than bible_verses.id, for the same reason as bible_marks:
-- re-seeding a translation reassigns those ids, and a user's own writing must
-- survive a data refresh they never asked for and cannot see.
-- ---------------------------------------------------------------------------
create table if not exists public.bible_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_order int not null,
  book text not null,
  chapter int not null,
  verse int not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, book_order, chapter, verse)
);

-- The reader loads every note for the open chapter in one query.
create index if not exists bible_notes_chapter_idx
  on public.bible_notes (user_id, book_order, chapter);
-- The "my notes" list is newest-first across the whole Bible.
create index if not exists bible_notes_recent_idx
  on public.bible_notes (user_id, updated_at desc);

alter table public.bible_notes enable row level security;

drop policy if exists "Users manage their own bible notes" on public.bible_notes;
create policy "Users manage their own bible notes"
  on public.bible_notes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- TOPICS.
--
-- Full-text search alone cannot answer "anxiety". Measured against this
-- database: the KJV contains the word "anxiety" ZERO times, "anxious" zero,
-- "worry" zero. It says "Be careful for nothing", "take no thought", "casting
-- all your care upon him". A KJV reader searching the thing they actually
-- feel gets an empty page. Topics are a curated bridge from the word a person
-- reaches for to the passages that answer it.
--
-- ALIASES are what make that bridge work in both directions: the reader types
-- "stressed" or "panic" or "overwhelmed", and the topic matches before search
-- ever runs. Stored as an array and matched exactly (lowercased), not as
-- fuzzy text, so a topic never hijacks an unrelated query.
--
-- Passages are references only, resolved from bible_verses at render time —
-- the same rule as verse_of_the_day, so one copy of scripture serves every
-- translation.
-- ---------------------------------------------------------------------------
create table if not exists public.bible_topics (
  slug text primary key,
  label text not null,
  position int not null,
  aliases text[] not null default '{}'
);

alter table public.bible_topics enable row level security;

drop policy if exists "Anyone can read bible topics" on public.bible_topics;
create policy "Anyone can read bible topics"
  on public.bible_topics for select
  using (true);

create table if not exists public.bible_topic_passages (
  topic_slug text not null references public.bible_topics(slug) on delete cascade,
  position int not null,
  book_order int not null,
  book text not null,
  chapter int not null,
  verse_start int not null,
  verse_end int not null,
  primary key (topic_slug, position)
);

create index if not exists bible_topic_passages_topic_idx
  on public.bible_topic_passages (topic_slug, position);

alter table public.bible_topic_passages enable row level security;

drop policy if exists "Anyone can read topic passages" on public.bible_topic_passages;
create policy "Anyone can read topic passages"
  on public.bible_topic_passages for select
  using (true);

insert into public.bible_topics (slug, label, position, aliases) values
  ('anxiety', 'Anxiety & worry', 1, array['anxious','worry','worried','worrying','stress','stressed','panic','overwhelmed','nervous','fretting']),
  ('fear', 'Fear & courage', 2, array['afraid','scared','terrified','frightened','courage','brave','terror']),
  ('grief', 'Grief & loss', 3, array['loss','mourning','mourn','death','died','bereaved','sorrow','funeral','widow']),
  ('loneliness', 'Loneliness', 4, array['alone','lonely','isolated','abandoned','forsaken','rejected']),
  ('healing', 'Sickness & healing', 5, array['sick','illness','disease','ill','recovery','pain','hospital','suffering','hurt']),
  ('gratitude', 'Thankfulness', 6, array['thankful','thanksgiving','thanks','grateful','praise','blessing']),
  ('forgiveness', 'Forgiveness & guilt', 7, array['forgive','forgiven','guilt','shame','repentance','repent','sin','sorry','mercy']),
  ('guidance', 'Decisions & direction', 8, array['direction','decision','decisions','guidance','guide','wisdom','confused','choice','choices','path','lost']),
  ('hope', 'Hope & discouragement', 9, array['hopeless','despair','discouraged','depressed','down','giving up','future']),
  ('strength', 'Weariness & strength', 10, array['weak','weary','tired','exhausted','burnout','worn out','strength','endurance']),
  ('peace', 'Peace & rest', 11, array['calm','rest','restless','stillness','quiet','sleep','insomnia']),
  ('protection', 'Protection & safety', 12, array['safety','safe','danger','travel','traveling','journey','guard','shield','angels']),
  ('love', 'Love', 13, array['loved','beloved','god''s love','loving']),
  ('patience', 'Waiting & patience', 14, array['waiting','wait','delay','patient','impatient','slow']),
  ('provision', 'Money, work & provision', 15, array['money','finances','financial','provision','provide','job','work','debt','poor','need','bills']),
  ('family', 'Marriage & family', 16, array['marriage','spouse','husband','wife','children','child','parents','parenting','son','daughter','home']),
  ('temptation', 'Temptation & struggle', 17, array['tempted','addiction','struggle','struggling','self-control','habit','relapse']),
  ('purpose', 'Purpose & calling', 18, array['calling','meaning','identity','who am i','worth','value','plan'])
on conflict (slug) do update set label = excluded.label, position = excluded.position, aliases = excluded.aliases;

insert into public.bible_topic_passages (topic_slug, position, book_order, book, chapter, verse_start, verse_end) values
  ('anxiety', 1, 50, 'Philippians', 4, 6, 7),
  ('anxiety', 2, 60, '1 Peter', 5, 6, 7),
  ('anxiety', 3, 40, 'Matthew', 6, 25, 27),
  ('anxiety', 4, 40, 'Matthew', 6, 33, 34),
  ('anxiety', 5, 19, 'Psalms', 94, 19, 19),
  ('anxiety', 6, 23, 'Isaiah', 41, 10, 10),
  ('anxiety', 7, 43, 'John', 14, 27, 27),
  ('anxiety', 8, 19, 'Psalms', 55, 22, 22),
  ('fear', 1, 6, 'Joshua', 1, 9, 9),
  ('fear', 2, 19, 'Psalms', 27, 1, 1),
  ('fear', 3, 55, '2 Timothy', 1, 7, 7),
  ('fear', 4, 23, 'Isaiah', 43, 1, 2),
  ('fear', 5, 19, 'Psalms', 56, 3, 4),
  ('fear', 6, 5, 'Deuteronomy', 31, 6, 6),
  ('fear', 7, 19, 'Psalms', 118, 6, 6),
  ('grief', 1, 19, 'Psalms', 34, 18, 18),
  ('grief', 2, 40, 'Matthew', 5, 4, 4),
  ('grief', 3, 66, 'Revelation', 21, 3, 4),
  ('grief', 4, 19, 'Psalms', 147, 3, 3),
  ('grief', 5, 47, '2 Corinthians', 1, 3, 4),
  ('grief', 6, 43, 'John', 11, 25, 26),
  ('grief', 7, 52, '1 Thessalonians', 4, 13, 14),
  ('grief', 8, 23, 'Isaiah', 61, 1, 3),
  ('loneliness', 1, 5, 'Deuteronomy', 31, 8, 8),
  ('loneliness', 2, 19, 'Psalms', 68, 5, 6),
  ('loneliness', 3, 58, 'Hebrews', 13, 5, 5),
  ('loneliness', 4, 23, 'Isaiah', 41, 13, 13),
  ('loneliness', 5, 19, 'Psalms', 25, 16, 18),
  ('loneliness', 6, 40, 'Matthew', 28, 20, 20),
  ('healing', 1, 59, 'James', 5, 14, 15),
  ('healing', 2, 19, 'Psalms', 103, 2, 3),
  ('healing', 3, 23, 'Isaiah', 53, 4, 5),
  ('healing', 4, 24, 'Jeremiah', 17, 14, 14),
  ('healing', 5, 19, 'Psalms', 41, 3, 3),
  ('healing', 6, 2, 'Exodus', 15, 26, 26),
  ('healing', 7, 40, 'Matthew', 4, 23, 24),
  ('gratitude', 1, 52, '1 Thessalonians', 5, 16, 18),
  ('gratitude', 2, 19, 'Psalms', 100, 4, 5),
  ('gratitude', 3, 19, 'Psalms', 103, 1, 5),
  ('gratitude', 4, 51, 'Colossians', 3, 15, 17),
  ('gratitude', 5, 19, 'Psalms', 136, 1, 1),
  ('gratitude', 6, 49, 'Ephesians', 5, 19, 20),
  ('gratitude', 7, 19, 'Psalms', 118, 24, 24),
  ('forgiveness', 1, 62, '1 John', 1, 9, 9),
  ('forgiveness', 2, 19, 'Psalms', 103, 10, 12),
  ('forgiveness', 3, 23, 'Isaiah', 1, 18, 18),
  ('forgiveness', 4, 49, 'Ephesians', 4, 32, 32),
  ('forgiveness', 5, 40, 'Matthew', 6, 14, 15),
  ('forgiveness', 6, 33, 'Micah', 7, 18, 19),
  ('forgiveness', 7, 19, 'Psalms', 51, 1, 4),
  ('forgiveness', 8, 51, 'Colossians', 3, 13, 13),
  ('guidance', 1, 20, 'Proverbs', 3, 5, 6),
  ('guidance', 2, 59, 'James', 1, 5, 6),
  ('guidance', 3, 19, 'Psalms', 119, 105, 105),
  ('guidance', 4, 23, 'Isaiah', 30, 21, 21),
  ('guidance', 5, 19, 'Psalms', 32, 8, 8),
  ('guidance', 6, 20, 'Proverbs', 16, 9, 9),
  ('guidance', 7, 19, 'Psalms', 25, 4, 5),
  ('hope', 1, 24, 'Jeremiah', 29, 11, 11),
  ('hope', 2, 45, 'Romans', 15, 13, 13),
  ('hope', 3, 25, 'Lamentations', 3, 21, 23),
  ('hope', 4, 19, 'Psalms', 42, 11, 11),
  ('hope', 5, 45, 'Romans', 8, 28, 28),
  ('hope', 6, 23, 'Isaiah', 40, 28, 31),
  ('hope', 7, 19, 'Psalms', 30, 5, 5),
  ('strength', 1, 23, 'Isaiah', 40, 29, 31),
  ('strength', 2, 50, 'Philippians', 4, 13, 13),
  ('strength', 3, 47, '2 Corinthians', 12, 9, 10),
  ('strength', 4, 40, 'Matthew', 11, 28, 30),
  ('strength', 5, 19, 'Psalms', 73, 26, 26),
  ('strength', 6, 16, 'Nehemiah', 8, 10, 10),
  ('strength', 7, 48, 'Galatians', 6, 9, 9),
  ('peace', 1, 43, 'John', 14, 27, 27),
  ('peace', 2, 23, 'Isaiah', 26, 3, 3),
  ('peace', 3, 19, 'Psalms', 4, 8, 8),
  ('peace', 4, 50, 'Philippians', 4, 7, 7),
  ('peace', 5, 51, 'Colossians', 3, 15, 15),
  ('peace', 6, 19, 'Psalms', 23, 1, 3),
  ('peace', 7, 40, 'Matthew', 11, 28, 29),
  ('protection', 1, 19, 'Psalms', 91, 1, 4),
  ('protection', 2, 19, 'Psalms', 121, 7, 8),
  ('protection', 3, 20, 'Proverbs', 18, 10, 10),
  ('protection', 4, 19, 'Psalms', 46, 1, 2),
  ('protection', 5, 23, 'Isaiah', 43, 2, 2),
  ('protection', 6, 53, '2 Thessalonians', 3, 3, 3),
  ('protection', 7, 19, 'Psalms', 4, 8, 8),
  ('love', 1, 46, '1 Corinthians', 13, 4, 7),
  ('love', 2, 43, 'John', 3, 16, 16),
  ('love', 3, 45, 'Romans', 8, 38, 39),
  ('love', 4, 62, '1 John', 4, 7, 8),
  ('love', 5, 36, 'Zephaniah', 3, 17, 17),
  ('love', 6, 43, 'John', 15, 12, 13),
  ('love', 7, 62, '1 John', 4, 18, 19),
  ('patience', 1, 19, 'Psalms', 27, 14, 14),
  ('patience', 2, 23, 'Isaiah', 40, 31, 31),
  ('patience', 3, 45, 'Romans', 8, 25, 25),
  ('patience', 4, 25, 'Lamentations', 3, 25, 26),
  ('patience', 5, 59, 'James', 5, 7, 8),
  ('patience', 6, 35, 'Habakkuk', 2, 3, 3),
  ('patience', 7, 21, 'Ecclesiastes', 3, 1, 1),
  ('provision', 1, 50, 'Philippians', 4, 19, 19),
  ('provision', 2, 40, 'Matthew', 6, 31, 33),
  ('provision', 3, 19, 'Psalms', 37, 25, 25),
  ('provision', 4, 20, 'Proverbs', 3, 9, 10),
  ('provision', 5, 58, 'Hebrews', 13, 5, 5),
  ('provision', 6, 51, 'Colossians', 3, 23, 24),
  ('provision', 7, 39, 'Malachi', 3, 10, 10),
  ('family', 1, 6, 'Joshua', 24, 15, 15),
  ('family', 2, 49, 'Ephesians', 5, 25, 25),
  ('family', 3, 20, 'Proverbs', 22, 6, 6),
  ('family', 4, 19, 'Psalms', 127, 3, 5),
  ('family', 5, 51, 'Colossians', 3, 18, 21),
  ('family', 6, 46, '1 Corinthians', 13, 4, 7),
  ('family', 7, 5, 'Deuteronomy', 6, 5, 7),
  ('temptation', 1, 46, '1 Corinthians', 10, 13, 13),
  ('temptation', 2, 59, 'James', 4, 7, 8),
  ('temptation', 3, 58, 'Hebrews', 4, 15, 16),
  ('temptation', 4, 48, 'Galatians', 5, 16, 17),
  ('temptation', 5, 19, 'Psalms', 119, 11, 11),
  ('temptation', 6, 45, 'Romans', 12, 2, 2),
  ('temptation', 7, 61, '2 Peter', 2, 9, 9),
  ('purpose', 1, 24, 'Jeremiah', 29, 11, 11),
  ('purpose', 2, 49, 'Ephesians', 2, 10, 10),
  ('purpose', 3, 19, 'Psalms', 139, 13, 16),
  ('purpose', 4, 45, 'Romans', 8, 28, 28),
  ('purpose', 5, 60, '1 Peter', 2, 9, 9),
  ('purpose', 6, 20, 'Proverbs', 19, 21, 21),
  ('purpose', 7, 40, 'Matthew', 5, 14, 16)
on conflict (topic_slug, position) do update set
  book_order = excluded.book_order,
  book = excluded.book,
  chapter = excluded.chapter,
  verse_start = excluded.verse_start,
  verse_end = excluded.verse_end;

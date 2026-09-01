-- Bible section: browse, search, and build a prayer video from verses.
--
-- TRANSLATIONS ARE A LICENSING DECISION, NOT A PREFERENCE.
--
-- Only public-domain translations live here: the King James Version and the
-- World English Bible. Both can be searched, displayed, stored and burned
-- into a shareable video with no licence, no fee and no attribution
-- requirement. Modern translations (NIV, ESV, NLT and the rest) are all
-- under copyright, and putting their text into a video that users then send
-- to other people is redistribution — well past any fair-use quotation
-- allowance. Adding one requires a signed agreement with its publisher
-- first. The translation column is deliberately a free text field with a
-- CHECK rather than an enum so a licensed translation can be added later
-- with a one-line constraint change.
--
-- The text is stored in Postgres rather than fetched from a third-party API
-- per request: it never changes, it is only ~5 MB per translation against a
-- 500 MB database allowance, and having it local is what makes real
-- full-text search possible instead of prefix matching.

create table if not exists public.bible_verses (
  id bigserial primary key,
  translation text not null check (translation in ('KJV', 'WEB')),
  -- Canonical order (1 = Genesis ... 66 = Revelation) so results and
  -- chapter navigation sort scripturally rather than alphabetically.
  book_order int not null check (book_order between 1 and 66),
  book text not null,
  chapter int not null check (chapter > 0),
  verse int not null check (verse > 0),
  text text not null,
  unique (translation, book_order, chapter, verse)
);

-- Chapter reads: "give me every verse of John 3 in WEB".
create index if not exists bible_verses_reference_idx
  on public.bible_verses (translation, book_order, chapter, verse);

-- Keyword search. A GIN index over to_tsvector gives real stemming — a
-- search for "comfort" also finds "comforted" and "comforteth" — which
-- plain ILIKE cannot do, and does it across all 31k verses in milliseconds.
create index if not exists bible_verses_fts_idx
  on public.bible_verses using gin (to_tsvector('english', text));

-- Trigram index for the reference/typo-tolerant path is deliberately NOT
-- created: pg_trgm on 31k rows of prose is a large index for a feature the
-- UI does not offer.

alter table public.bible_verses enable row level security;

drop policy if exists "Anyone can read the Bible" on public.bible_verses;
create policy "Anyone can read the Bible"
  on public.bible_verses for select
  using (true);

-- SEARCH.
--
-- Wrapped in a function rather than done from the client so the ranking and
-- the tsquery parsing live in one place, and so a malformed query string
-- can never reach to_tsquery directly. websearch_to_tsquery is the forgiving
-- parser: it accepts bare words, "quoted phrases" and OR without throwing
-- on unbalanced punctuation the way to_tsquery does.
create or replace function public.search_bible(
  q text,
  translation_filter text default 'KJV',
  max_results int default 50
)
returns table (
  id bigint,
  translation text,
  book_order int,
  book text,
  chapter int,
  verse int,
  text text,
  rank real
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select v.id, v.translation, v.book_order, v.book, v.chapter, v.verse, v.text,
         ts_rank(to_tsvector('english', v.text), websearch_to_tsquery('english', q)) as rank
  from public.bible_verses v
  where v.translation = translation_filter
    and to_tsvector('english', v.text) @@ websearch_to_tsquery('english', q)
  order by rank desc, v.book_order, v.chapter, v.verse
  limit least(greatest(max_results, 1), 200);
$$;

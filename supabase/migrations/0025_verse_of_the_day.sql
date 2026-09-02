-- Verse of the Day.
--
-- A curated pool of passages, walked one per day. Two decisions worth
-- recording:
--
-- ONLY THE REFERENCE IS STORED, never the words. The text is resolved from
-- bible_verses when the card renders, which means the same row serves both
-- KJV and WEB and follows whichever translation the reader has chosen. It
-- also means there is exactly one copy of scripture in this database.
--
-- A POOL WALKED BY DATE, not 366 hand-assigned days. Assigning a verse to
-- every calendar day is a lot of authoring for no benefit — nobody knows
-- which day of the year it is relative to a schedule. Walking an ordered
-- pool by date is deterministic (everyone sees the same verse on the same
-- day), stable (it doesn't change on refresh), and guarantees no repeat
-- until the whole pool has been seen. Adding passages later just makes the
-- cycle longer.

create table if not exists public.verse_of_the_day (
  position int primary key,
  book_order int not null,
  book text not null,
  chapter int not null,
  verse_start int not null,
  verse_end int not null,
  theme text
);

alter table public.verse_of_the_day enable row level security;

drop policy if exists "Anyone can read the verse of the day" on public.verse_of_the_day;
create policy "Anyone can read the verse of the day"
  on public.verse_of_the_day for select
  using (true);

-- Curated for the job: short enough to sit on a video, widely loved, and
-- spread across comfort, hope, strength, protection, gratitude and guidance
-- rather than clustering on one mood.
insert into public.verse_of_the_day
  (position, book_order, book, chapter, verse_start, verse_end, theme)
values
  
(1, 19, 'Psalms', 23, 1, 3, 'comfort'),
  (2, 19, 'Psalms', 23, 4, 4, 'comfort'),
  (3, 23, 'Isaiah', 41, 10, 10, 'strength'),
  (4, 50, 'Philippians', 4, 6, 7, 'peace'),
  (5, 20, 'Proverbs', 3, 5, 6, 'guidance'),
  (6, 6, 'Joshua', 1, 9, 9, 'strength'),
  (7, 24, 'Jeremiah', 29, 11, 11, 'hope'),
  (8, 45, 'Romans', 8, 28, 28, 'hope'),
  (9, 19, 'Psalms', 46, 1, 1, 'protection'),
  (10, 40, 'Matthew', 11, 28, 30, 'comfort'),
  (11, 43, 'John', 3, 16, 16, 'love'),
  (12, 19, 'Psalms', 121, 1, 2, 'protection'),
  (13, 47, '2 Corinthians', 12, 9, 9, 'strength'),
  (14, 23, 'Isaiah', 40, 31, 31, 'strength'),
  (15, 19, 'Psalms', 27, 1, 1, 'protection'),
  (16, 25, 'Lamentations', 3, 22, 23, 'hope'),
  (17, 45, 'Romans', 15, 13, 13, 'hope'),
  (18, 19, 'Psalms', 34, 18, 18, 'comfort'),
  (19, 60, '1 Peter', 5, 7, 7, 'comfort'),
  (20, 5, 'Deuteronomy', 31, 6, 6, 'strength'),
  (21, 19, 'Psalms', 139, 13, 14, 'identity'),
  (22, 49, 'Ephesians', 2, 8, 9, 'grace'),
  (23, 19, 'Psalms', 118, 24, 24, 'gratitude'),
  (24, 52, '1 Thessalonians', 5, 16, 18, 'gratitude'),
  (25, 51, 'Colossians', 3, 15, 15, 'peace'),
  (26, 43, 'John', 14, 27, 27, 'peace'),
  (27, 19, 'Psalms', 55, 22, 22, 'comfort'),
  (28, 58, 'Hebrews', 11, 1, 1, 'faith'),
  (29, 59, 'James', 1, 2, 4, 'perseverance'),
  (30, 48, 'Galatians', 5, 22, 23, 'character'),
  (31, 46, '1 Corinthians', 13, 4, 7, 'love'),
  (32, 33, 'Micah', 6, 8, 8, 'guidance'),
  (33, 19, 'Psalms', 103, 2, 4, 'gratitude'),
  (34, 23, 'Isaiah', 26, 3, 3, 'peace'),
  (35, 40, 'Matthew', 6, 33, 34, 'trust'),
  (36, 19, 'Psalms', 37, 4, 5, 'trust'),
  (37, 34, 'Nahum', 1, 7, 7, 'protection'),
  (38, 36, 'Zephaniah', 3, 17, 17, 'love'),
  (39, 19, 'Psalms', 91, 1, 2, 'protection'),
  (40, 45, 'Romans', 12, 12, 12, 'perseverance'),
  (41, 55, '2 Timothy', 1, 7, 7, 'strength'),
  (42, 19, 'Psalms', 147, 3, 3, 'healing'),
  (43, 23, 'Isaiah', 43, 2, 2, 'protection'),
  (44, 43, 'John', 16, 33, 33, 'courage'),
  (45, 19, 'Psalms', 16, 8, 8, 'trust'),
  (46, 58, 'Hebrews', 13, 5, 6, 'trust'),
  (47, 20, 'Proverbs', 18, 10, 10, 'protection'),
  (48, 19, 'Psalms', 62, 1, 2, 'rest'),
  (49, 40, 'Matthew', 5, 14, 16, 'purpose'),
  (50, 49, 'Ephesians', 3, 20, 21, 'hope'),
  (51, 19, 'Psalms', 73, 26, 26, 'strength'),
  (52, 23, 'Isaiah', 30, 21, 21, 'guidance'),
  (53, 45, 'Romans', 5, 3, 5, 'perseverance'),
  (54, 19, 'Psalms', 145, 18, 19, 'prayer'),
  (55, 62, '1 John', 4, 18, 19, 'love'),
  (56, 19, 'Psalms', 30, 5, 5, 'hope'),
  (57, 24, 'Jeremiah', 17, 7, 8, 'trust'),
  (58, 40, 'Matthew', 7, 7, 8, 'prayer'),
  (59, 19, 'Psalms', 19, 14, 14, 'prayer'),
  (60, 51, 'Colossians', 3, 23, 24, 'work'),
  (61, 19, 'Psalms', 51, 10, 12, 'renewal'),
  (62, 23, 'Isaiah', 1, 18, 18, 'forgiveness'),
  (63, 62, '1 John', 1, 9, 9, 'forgiveness'),
  (64, 19, 'Psalms', 32, 7, 7, 'protection'),
  (65, 20, 'Proverbs', 16, 3, 3, 'work'),
  (66, 19, 'Psalms', 90, 12, 12, 'wisdom'),
  (67, 59, 'James', 1, 5, 5, 'wisdom'),
  (68, 21, 'Ecclesiastes', 3, 1, 1, 'seasons'),
  (69, 19, 'Psalms', 126, 5, 6, 'hope'),
  (70, 47, '2 Corinthians', 4, 16, 18, 'perseverance'),
  (71, 19, 'Psalms', 42, 11, 11, 'comfort'),
  (72, 23, 'Isaiah', 55, 8, 9, 'trust'),
  (73, 45, 'Romans', 8, 38, 39, 'love'),
  (74, 19, 'Psalms', 100, 4, 5, 'gratitude'),
  (75, 50, 'Philippians', 4, 13, 13, 'strength'),
  (76, 40, 'Matthew', 28, 19, 20, 'purpose'),
  (77, 19, 'Psalms', 119, 105, 105, 'guidance'),
  (78, 20, 'Proverbs', 4, 23, 23, 'wisdom'),
  (79, 19, 'Psalms', 1, 1, 3, 'blessing'),
  (80, 58, 'Hebrews', 4, 16, 16, 'prayer'),
  (81, 19, 'Psalms', 133, 1, 1, 'unity'),
  (82, 49, 'Ephesians', 4, 32, 32, 'kindness'),
  (83, 42, 'Luke', 6, 37, 38, 'grace'),
  (84, 19, 'Psalms', 56, 3, 4, 'courage'),
  (85, 23, 'Isaiah', 9, 6, 6, 'hope'),
  (86, 43, 'John', 15, 12, 13, 'love'),
  (87, 19, 'Psalms', 84, 11, 12, 'blessing'),
  (88, 45, 'Romans', 12, 2, 2, 'renewal'),
  (89, 60, '1 Peter', 2, 9, 9, 'identity'),
  (90, 19, 'Psalms', 8, 3, 5, 'wonder'),
  (91, 24, 'Jeremiah', 33, 3, 3, 'prayer'),
  (92, 19, 'Psalms', 63, 1, 4, 'longing'),
  (93, 40, 'Matthew', 6, 9, 13, 'prayer'),
  (94, 19, 'Psalms', 139, 23, 24, 'prayer'),
  (95, 56, 'Titus', 3, 4, 5, 'grace'),
  (96, 19, 'Psalms', 136, 1, 1, 'gratitude'),
  (97, 4, 'Numbers', 6, 24, 26, 'blessing'),
  (98, 19, 'Psalms', 150, 6, 6, 'praise'),
  (99, 66, 'Revelation', 21, 3, 4, 'hope'),
  (100, 47, '2 Corinthians', 1, 3, 4, 'comfort'),
  (101, 19, 'Psalms', 25, 4, 5, 'guidance')
on conflict (position) do nothing;

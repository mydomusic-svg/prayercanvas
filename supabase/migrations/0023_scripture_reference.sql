-- The scripture citation, kept apart from the prayer's words.
--
-- Verses handed over from the Bible page used to arrive with their citation
-- appended to the text itself ("...I shall not want. — Psalms 23:1-4 (KJV)").
-- Two problems with that: the narrator READ it aloud, which is a strange
-- thing to hear at the end of a prayer, and it had to share the same
-- centred text block as the verse rather than sitting where a citation
-- belongs.
--
-- Storing it separately fixes both. The transcript is now only the words of
-- the passage — which is what gets spoken and what the auto-matcher reads —
-- and the worker draws the reference on its own line along the bottom of
-- the video.
--
-- Null for every prayer that isn't scripture, which is most of them.

alter table public.prayers
  add column if not exists scripture_reference text;

comment on column public.prayers.scripture_reference is
  'Citation for a prayer built from Bible verses, e.g. "Psalms 23:1-4 (KJV)". Drawn along the bottom of the video and deliberately kept out of the transcript so it is not read aloud.';

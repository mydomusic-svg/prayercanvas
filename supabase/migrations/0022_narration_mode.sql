-- How a prayer is voiced.
--
--   'narrator'  an AI narrator reads the written text (the default, and
--               what every typed prayer did before this column existed)
--   'self'      the user records themselves reading it; the written text
--               stays as the on-screen wording, which matters most for
--               scripture, where what is DISPLAYED should be the verse
--               exactly as translated even if the reader stumbles
--   'none'      nobody reads it — scripture or prayer text on screen over
--               the chosen image with music behind it, and no voice at all
--
-- Null means 'narrator', so every prayer created before this migration
-- keeps behaving exactly as it did.
--
-- 'none' is the one that changes the render pipeline: with no voice there
-- is no audio to measure, so the worker derives the video's length from the
-- text's reading time and feeds a generated silent track through the normal
-- audio path (see estimateReadingSeconds in worker/index.js).

alter table public.prayers
  add column if not exists narration_mode text;

alter table public.prayers drop constraint if exists prayers_narration_mode_check;
alter table public.prayers
  add constraint prayers_narration_mode_check
    check (narration_mode is null or narration_mode in ('narrator', 'self', 'none'));

comment on column public.prayers.narration_mode is
  'How the prayer is voiced: narrator (AI reads it), self (user records it), none (silent, text and music only). Null means narrator.';

-- Typed and pasted prayers.
--
-- Until now a prayer could only start as a recording: the create page
-- uploaded audio, the process route ran it through Whisper, and everything
-- downstream (theme, title, auto-matched music and visuals, captions) hung
-- off that transcript. Someone who would rather write their prayer, or who
-- already has one written down and wants to paste it, had no way in.
--
-- input_text is that way in. When it is set and there is no raw_audio
-- asset, the process route skips transcription — the text IS the
-- transcript, and it is more accurate than anything Whisper could produce —
-- and instead synthesizes narration from it, exactly the way the Funny
-- Cartoon category already synthesizes a character's voice. Everything
-- after that point is unchanged.
--
-- narrator_voice picks who reads it: one of OpenAI's tts-1 voices. It is
-- ignored when cartoon_character_id is set, because the character's own
-- voice wins.

alter table public.prayers
  add column if not exists input_text text;

alter table public.prayers
  add column if not exists narrator_voice text;

comment on column public.prayers.input_text is
  'Prayer text typed or pasted by the user instead of recorded. When set with no raw_audio asset, the process route treats it as the transcript and synthesizes narration from it.';
comment on column public.prayers.narrator_voice is
  'OpenAI tts-1 voice used to read a typed prayer (alloy/echo/fable/onyx/nova/shimmer). Ignored when cartoon_character_id is set.';

-- media_assets.type is a closed CHECK constraint (0001, widened in 0015 for
-- cartoon_audio), so the new narration track has to be allowed explicitly —
-- otherwise every typed prayer's synthesis would fail on insert, silently,
-- since that branch is best-effort and only logs.
alter table public.media_assets drop constraint if exists media_assets_type_check;
alter table public.media_assets
  add constraint media_assets_type_check
    check (type in ('raw_audio', 'clean_audio', 'background', 'music', 'rendered_video', 'cartoon_audio', 'narration_audio'));

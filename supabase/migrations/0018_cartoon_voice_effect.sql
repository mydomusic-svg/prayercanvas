-- Funny Cartoon voices.
--
-- 0015 gave each character a pitch_ratio, which the worker applied with
-- ffmpeg's asetrate trick. That moves pitch and speed together, so the
-- higher-pitched characters also talked faster — fast enough that the
-- prayer stopped being followable, which is why every pitch_ratio was
-- reset to 1.0 (no shift at all) as a stopgap.
--
-- This column replaces that mechanism. The worker now compensates the
-- speed back to normal with atempo, so pitch can move without the pace
-- moving with it, and each named effect also carries its own EQ/vibrato/
-- chorus chain (see VOICE_EFFECTS in worker/index.js).
--
-- pitch_ratio is deliberately left in place: when voice_effect is null the
-- worker still honours it, now with the same speed compensation applied,
-- so a per-character tweak stays possible without another migration.

alter table public.cartoon_characters
  add column if not exists voice_effect text;

comment on column public.cartoon_characters.voice_effect is
  'Named voice preset applied to the character''s TTS audio in cartoon mode. One of the keys in VOICE_EFFECTS in worker/index.js: duck, chipmunk, sparkle, alien, bear, grumpy. Null falls back to pitch_ratio.';

-- Assign the presets to the seeded characters. Matched on name so this is
-- safe to re-run and skips any character that isn't one of these.
update public.cartoon_characters set voice_effect = 'chipmunk' where name = 'Chuckles the Squirrel';
update public.cartoon_characters set voice_effect = 'bear'     where name = 'Boomer the Bear';
update public.cartoon_characters set voice_effect = 'sparkle'  where name = 'Sparkle the Unicorn';
update public.cartoon_characters set voice_effect = 'grumpy'   where name = 'Grumbles the Cloud';
update public.cartoon_characters set voice_effect = 'alien'    where name = 'Ziggy the Alien';
update public.cartoon_characters set voice_effect = 'duck'     where name = 'Puddles the Duck';

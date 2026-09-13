-- KID-FRIENDLY CARTOON VOICES.
--
-- The Funny Cartoon characters were voiced by tts-1, which takes a voice
-- name and nothing else. Two of the five sat on distinctly adult-male
-- voices — Boomer on `onyx` (deep and grave) and Ziggy on `fable` (adult
-- British male) — and `alloy` (Puddles) is flat and affectless. Read aloud
-- to a child they sounded like a man doing a bit, not like a cartoon.
--
-- Two changes here, and they only work together:
--
-- 1. Every character moves to a voice on the bright end of the range. The
--    cartoon path now uses gpt-4o-mini-tts (see src/lib/ai/tts.ts), which
--    offers voices tts-1 never had — `coral`, `ballad`, `verse`, `sage`,
--    `ash` — so there is no longer a two-voice ceiling forcing five
--    characters to sound alike. The narrator path stays on tts-1: a prayer
--    read straight should not be steered playful.
--
-- 2. voice_instructions carries a per-character delivery direction, which
--    is the actual reason for the model change. gpt-4o-mini-tts accepts an
--    `instructions` string describing tone, energy and pace; tts-1 has no
--    equivalent. This is what turns "a bright adult voice" into "a cartoon
--    bear reading a picture book", and it is the only lever that reaches
--    the register the app wants, because NO OpenAI model ships an actual
--    child voice.
--
-- It lives in the table rather than in the app because tuning a delivery
-- is a listen-and-adjust loop — it should cost a SQL update, not a deploy.
--
-- Every instruction ends with the same two guards, and they are not
-- decoration. The pace guard exists because the character path can be
-- handed a Bible verse, and an unsteered model reads scripture at a
-- newsreader clip. The sincerity guard exists because these are prayers,
-- sometimes for someone who is ill or grieving: a playful voice that tips
-- into sarcasm or spookiness would be worse than a flat one.
alter table public.cartoon_characters
  add column if not exists voice_instructions text;

comment on column public.cartoon_characters.openai_voice is
  'Base TTS voice. Cartoon characters are synthesized with gpt-4o-mini-tts, whose voice set is alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer and verse. See src/lib/ai/tts.ts.';

comment on column public.cartoon_characters.voice_instructions is
  'Delivery direction passed to gpt-4o-mini-tts as `instructions`. Tunable without a deploy — change it here, no migration needed.';

update public.cartoon_characters set
  openai_voice = 'coral',
  voice_instructions = 'You are a cheerful cartoon squirrel reading aloud to a small child. Bright, warm and playful, with a smile and a hint of a giggle in the voice. Keep the pace unhurried and every word clear, about the speed of reading a picture book aloud to a five-year-old, never rushed. The words are a prayer, so stay sincere and kind underneath the fun. Never sound sarcastic, spooky or sad.'
where name = 'Chuckles the Squirrel';

update public.cartoon_characters set
  openai_voice = 'ballad',
  voice_instructions = 'You are a big, friendly cartoon bear reading aloud to a small child. Warm, cosy and softly rumbling, the gentle-giant kind of voice, never gruff or growly or frightening. Keep the pace unhurried and every word clear, about the speed of reading a picture book aloud to a five-year-old, never rushed. The words are a prayer, so stay sincere and kind underneath the fun. Never sound sarcastic, spooky or sad.'
where name = 'Boomer the Bear';

update public.cartoon_characters set
  openai_voice = 'nova',
  voice_instructions = 'You are a bubbly cartoon unicorn reading aloud to a small child. Sparkly and delighted, full of wonder, as if everything you are saying is the loveliest thing you have heard all day. Keep the pace unhurried and every word clear, about the speed of reading a picture book aloud to a five-year-old, never rushed. The words are a prayer, so stay sincere and kind underneath the fun. Never sound sarcastic, spooky or sad.'
where name = 'Sparkle the Unicorn';

update public.cartoon_characters set
  openai_voice = 'verse',
  voice_instructions = 'You are a curious little cartoon alien reading aloud to a small child. Wide-eyed and lightly sing-song, charmed and slightly amazed by the words, a bit odd but always friendly. Keep the pace unhurried and every word clear, about the speed of reading a picture book aloud to a five-year-old, never rushed. The words are a prayer, so stay sincere and kind underneath the fun. Never sound sarcastic, spooky or sad.'
where name = 'Ziggy the Alien';

update public.cartoon_characters set
  openai_voice = 'shimmer',
  voice_instructions = 'You are a small, clumsy cartoon duck reading aloud to a small child. Light, soft and a little breathless, faintly surprised by your own words, sweet rather than silly. Keep the pace unhurried and every word clear, about the speed of reading a picture book aloud to a five-year-old, never rushed. The words are a prayer, so stay sincere and kind underneath the fun. Never sound sarcastic, spooky or sad.'
where name = 'Puddles the Duck';

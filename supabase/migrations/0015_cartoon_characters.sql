-- Funny Cartoon category (Sprint 5): choosing a cartoon character on the
-- create page replaces the video's usual photo/text-card treatment with
-- just that character's portrait on screen (Ken-Burns'd like any other
-- photo background — see worker/index.js's cartoonMode branch in
-- renderPrayer) and an AI text-to-speech voice reading the prayer instead
-- of the user's own recording (see media_assets' new 'cartoon_audio' type
-- and src/lib/ai/tts.ts). No on-screen prayer text/title is drawn for these
-- (buildFilterComplex/generateThumbnail skip all drawtext when cartoonMode
-- is set) — the joke is the character + funny voice, not a text card.
--
-- Mirrors photo_styles (0014)/music_styles (0010): a public-read lookup
-- table seeded by a script, not by hand — see
-- scripts/seed-cartoon-characters.mjs.
create table if not exists public.cartoon_characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_asset text not null,
  -- OpenAI TTS voice used as the base for this character (alloy, echo,
  -- fable, onyx, nova, or shimmer) — see src/lib/ai/tts.ts.
  openai_voice text not null,
  -- Playback-rate multiplier applied worker-side via ffmpeg's asetrate
  -- trick — pitch and speed move together, like a classic chipmunk/slow-
  -- giant effect. >1 = higher & faster ("chipmunk"), <1 = lower & slower
  -- ("giant"). See buildFilterComplex's cartoonMode audio branch.
  pitch_ratio numeric not null default 1.0,
  category text default 'Funny',
  source text,
  license text,
  created_at timestamptz not null default now()
);

alter table public.cartoon_characters enable row level security;

-- `create policy` has no `if not exists` form, so a partially-applied run
-- of this file (table created, then something later in the file failing)
-- would leave the policy behind and make every retry abort right here with
-- "policy already exists" — silently skipping everything below it. Dropping
-- first makes the whole migration safely re-runnable.
drop policy if exists "Anyone can read cartoon characters" on public.cartoon_characters;
create policy "Anyone can read cartoon characters"
  on public.cartoon_characters for select
  using (true);

alter table public.prayers
  add column if not exists cartoon_character_id uuid
    references public.cartoon_characters (id) on delete set null;

-- Widen media_assets.type to allow the AI-generated cartoon voice track,
-- stored ALONGSIDE the user's original raw_audio recording, not in place of
-- it — the process route still transcribes the user's real recording to
-- get the prayer text, then separately synthesizes cartoon_audio from that
-- text once a character is chosen. The render worker prefers cartoon_audio
-- over raw_audio when the prayer has a cartoon_character_id set.
alter table public.media_assets drop constraint if exists media_assets_type_check;
alter table public.media_assets
  add constraint media_assets_type_check
    check (type in ('raw_audio', 'clean_audio', 'background', 'music', 'rendered_video', 'cartoon_audio'));

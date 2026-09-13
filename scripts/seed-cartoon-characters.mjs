// Seeds the "Funny Cartoon" character picker (see 0015_cartoon_characters.sql)
// with a small set of ORIGINAL, AI-generated mascot characters — deliberately
// not existing copyrighted characters, to avoid any IP/licensing issues. Each
// character pairs a portrait image with an OpenAI TTS voice + a pitch_ratio
// (see src/lib/ai/tts.ts and worker/index.js's cartoonMode audio branch) that
// together are meant to sound like that character.
//
// Run from the repo root:
//
//   node --env-file=.env.local scripts/seed-cartoon-characters.mjs
//
// Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
// and OPENAI_API_KEY in the environment. Safe to re-run: skips any character
// whose `name` already exists in cartoon_characters.

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const BUCKET = "style-assets";

// pitch_ratio drives ffmpeg's asetrate trick worker-side (pitch and speed
// move together) — see buildFilterComplex in worker/index.js.
//
// pitch_ratio stays at 1.0 for every character and voice_effect now does the
// work instead. The first pass used raw pitch_ratio values from 0.75 to 1.45,
// which sped the speech up so much the prayer became hard to follow — asetrate
// moves pitch and speed together. The worker now compensates the speed back
// with atempo (see VOICE_EFFECTS and buildFilterComplex in worker/index.js),
// so a named effect shifts pitch and adds its own EQ/vibrato character while
// the words stay at a normal speaking pace. pitch_ratio is still honoured when
// voice_effect is null, so a one-off tweak needs no migration.
//
// openai_voice is the base the effect sits on: the voice picks the speaker,
// the effect picks the creature. Characters are synthesized with
// gpt-4o-mini-tts, not tts-1, so the set is wider than tts-1's six —
// alloy/ash/ballad/coral/echo/fable/nova/onyx/sage/shimmer/verse.
//
// Every character sits on the bright end of that set, and none on a grave
// adult voice. Boomer used to be `onyx` and Ziggy `fable`, both adult male;
// read to a child they sounded like a man doing a bit. The extra voices are
// the reason the model changed — tts-1 has only two light voices, which is
// not enough for five characters to stay distinct.
//
// voice_instructions is the delivery direction gpt-4o-mini-tts accepts and
// tts-1 does not, and it is doing most of the work: no OpenAI model has a
// child voice, so a kids' cartoon register has to be directed rather than
// selected. It lives in the DB column too, so it can be tuned by ear with a
// SQL update instead of a redeploy — see 0028_kids_cartoon_voices.sql.
const CHARACTERS = [
  {
    name: "Chuckles the Squirrel",
    prompt:
      "A cute original cartoon mascot character: a round, cheerful cartoon squirrel wearing a tiny acorn-shaped hat, big expressive eyes, mid-laugh with a huge grin, simple flat vector illustration style, solid pastel green background, centered portrait, no text, no logos.",
    openai_voice: "coral",
    voice_instructions:
      "You are a cheerful cartoon squirrel reading aloud to a small child. Bright, warm and playful, with a smile and a hint of a giggle in the voice. Keep the pace unhurried and every word clear, about the speed of reading a picture book aloud to a five-year-old, never rushed. The words are a prayer, so stay sincere and kind underneath the fun. Never sound sarcastic, spooky or sad.",
    pitch_ratio: 1.0,
    voice_effect: "chipmunk",
  },
  {
    name: "Boomer the Bear",
    prompt:
      "A cute original cartoon mascot character: a big friendly cartoon bear with a goofy lopsided grin and a plaid bowtie, simple flat vector illustration style, solid warm brown background, centered portrait, no text, no logos.",
    openai_voice: "ballad",
    voice_instructions:
      "You are a big, friendly cartoon bear reading aloud to a small child. Warm, cosy and softly rumbling, the gentle-giant kind of voice, never gruff or growly or frightening. Keep the pace unhurried and every word clear, about the speed of reading a picture book aloud to a five-year-old, never rushed. The words are a prayer, so stay sincere and kind underneath the fun. Never sound sarcastic, spooky or sad.",
    pitch_ratio: 1.0,
    voice_effect: "bear",
  },
  {
    name: "Sparkle the Unicorn",
    prompt:
      "A cute original cartoon mascot character: a bubbly pastel cartoon unicorn with a rainbow mane and a silly cross-eyed grin, simple flat vector illustration style, solid lavender background, centered portrait, no text, no logos.",
    openai_voice: "nova",
    voice_instructions:
      "You are a bubbly cartoon unicorn reading aloud to a small child. Sparkly and delighted, full of wonder, as if everything you are saying is the loveliest thing you have heard all day. Keep the pace unhurried and every word clear, about the speed of reading a picture book aloud to a five-year-old, never rushed. The words are a prayer, so stay sincere and kind underneath the fun. Never sound sarcastic, spooky or sad.",
    pitch_ratio: 1.0,
    voice_effect: "sparkle",
  },
  {
    name: "Ziggy the Alien",
    prompt:
      "A cute original cartoon mascot character: a small wacky green cartoon alien with three eyes and antenna, wide silly open-mouthed smile, simple flat vector illustration style, solid deep purple background, centered portrait, no text, no logos.",
    openai_voice: "verse",
    voice_instructions:
      "You are a curious little cartoon alien reading aloud to a small child. Wide-eyed and lightly sing-song, charmed and slightly amazed by the words, a bit odd but always friendly. Keep the pace unhurried and every word clear, about the speed of reading a picture book aloud to a five-year-old, never rushed. The words are a prayer, so stay sincere and kind underneath the fun. Never sound sarcastic, spooky or sad.",
    pitch_ratio: 1.0,
    voice_effect: "alien",
  },
  {
    name: "Puddles the Duck",
    prompt:
      "A cute original cartoon mascot character: a small clumsy cartoon duck wearing yellow rain boots, mid-quack with a silly surprised expression, simple flat vector illustration style, solid teal background, centered portrait, no text, no logos.",
    openai_voice: "shimmer",
    voice_instructions:
      "You are a small, clumsy cartoon duck reading aloud to a small child. Light, soft and a little breathless, faintly surprised by your own words, sweet rather than silly. Keep the pace unhurried and every word clear, about the speed of reading a picture book aloud to a five-year-old, never rushed. The words are a prayer, so stay sincere and kind underneath the fun. Never sound sarcastic, spooky or sad.",
    pitch_ratio: 1.0,
    voice_effect: "duck",
  },
];

async function uploadToStorage(storagePath, data, contentType) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, data, { contentType, upsert: true });
  if (error) throw new Error(`Upload failed for ${storagePath}: ${error.message}`);
  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return publicUrlData.publicUrl;
}

async function main() {
  const { data: existingRows, error: existingError } = await supabase
    .from("cartoon_characters")
    .select("name");
  if (existingError) {
    console.error(`Failed to check existing characters: ${existingError.message}`);
    process.exit(1);
  }
  const existingNames = new Set((existingRows || []).map((r) => r.name));

  let imported = 0;
  let skipped = 0;
  const failed = [];

  for (const character of CHARACTERS) {
    if (existingNames.has(character.name)) {
      console.log(`Skipping "${character.name}" — already in cartoon_characters.`);
      skipped++;
      continue;
    }
    try {
      console.log(`Generating portrait for "${character.name}"...`);
      const image = await openai.images.generate({
        model: "gpt-image-1",
        prompt: character.prompt,
        size: "1024x1024",
      });
      const b64 = image.data?.[0]?.b64_json;
      if (!b64) throw new Error("No image data returned");
      const buffer = Buffer.from(b64, "base64");

      const slug = character.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const storagePath = `characters/${slug}.png`;

      console.log(`  uploading -> ${storagePath}...`);
      const publicUrl = await uploadToStorage(storagePath, buffer, "image/png");

      const { error } = await supabase.from("cartoon_characters").insert({
        name: character.name,
        image_asset: publicUrl,
        openai_voice: character.openai_voice,
        voice_instructions: character.voice_instructions,
        pitch_ratio: character.pitch_ratio,
        voice_effect: character.voice_effect,
        category: "Funny",
        source: "AI-generated (OpenAI gpt-image-1)",
        license: null,
      });
      if (error) throw new Error(`insert failed: ${error.message}`);

      console.log(`  done: ${character.name}`);
      imported++;
    } catch (err) {
      console.error(`  FAILED: ${character.name}: ${err.message}`);
      failed.push(character.name);
    }
  }

  console.log(
    `\nImported ${imported}/${CHARACTERS.length} cartoon characters (${skipped} already present, skipped).`
  );
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

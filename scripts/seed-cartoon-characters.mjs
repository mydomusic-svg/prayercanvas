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
// All set to 1.0 = NO shift. The first pass used values from 0.75 to 1.45 to
// make each character sound distinct, but in a real render the faster ones
// sped the speech up so much the prayer became hard to follow — and a prayer
// you can't follow is a broken prayer, however funny the voice. The
// character now comes from its own OpenAI voice and its animation instead.
// The column is kept (rather than dropped) so a gentler shift can be dialled
// back in per character later without a migration — the worker skips the
// filter entirely at exactly 1.0. openai_voice is one of OpenAI's
// tts-1 stock voices (alloy/echo/fable/onyx/nova/shimmer).
const CHARACTERS = [
  {
    name: "Chuckles the Squirrel",
    prompt:
      "A cute original cartoon mascot character: a round, cheerful cartoon squirrel wearing a tiny acorn-shaped hat, big expressive eyes, mid-laugh with a huge grin, simple flat vector illustration style, solid pastel green background, centered portrait, no text, no logos.",
    openai_voice: "shimmer",
    pitch_ratio: 1.0,
  },
  {
    name: "Boomer the Bear",
    prompt:
      "A cute original cartoon mascot character: a big friendly cartoon bear with a goofy lopsided grin and a plaid bowtie, simple flat vector illustration style, solid warm brown background, centered portrait, no text, no logos.",
    openai_voice: "onyx",
    pitch_ratio: 1.0,
  },
  {
    name: "Sparkle the Unicorn",
    prompt:
      "A cute original cartoon mascot character: a bubbly pastel cartoon unicorn with a rainbow mane and a silly cross-eyed grin, simple flat vector illustration style, solid lavender background, centered portrait, no text, no logos.",
    openai_voice: "nova",
    pitch_ratio: 1.0,
  },
  {
    name: "Grumbles the Cloud",
    prompt:
      "A cute original cartoon mascot character: a small round grumpy-but-lovable cartoon rain cloud with a deadpan flat expression and one raised eyebrow, simple flat vector illustration style, solid sky-blue background, centered portrait, no text, no logos.",
    openai_voice: "echo",
    pitch_ratio: 1.0,
  },
  {
    name: "Ziggy the Alien",
    prompt:
      "A cute original cartoon mascot character: a small wacky green cartoon alien with three eyes and antenna, wide silly open-mouthed smile, simple flat vector illustration style, solid deep purple background, centered portrait, no text, no logos.",
    openai_voice: "fable",
    pitch_ratio: 1.0,
  },
  {
    name: "Puddles the Duck",
    prompt:
      "A cute original cartoon mascot character: a small clumsy cartoon duck wearing yellow rain boots, mid-quack with a silly surprised expression, simple flat vector illustration style, solid teal background, centered portrait, no text, no logos.",
    openai_voice: "alloy",
    pitch_ratio: 1.0,
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
        pitch_ratio: character.pitch_ratio,
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

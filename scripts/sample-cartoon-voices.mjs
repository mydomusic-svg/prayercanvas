// Renders one sample line in every cartoon character's voice so the new
// kid-friendly delivery can be judged by ear before it reaches a real
// prayer — and measured, so "it sounds too fast" stops being a matter of
// opinion.
//
// WHY THIS EXISTS. The cartoon voices have been called too fast three
// times. Twice it was guessed at and "fixed" without measuring, and both
// times the guess was wrong; the actual cause turned out to be ffmpeg
// reinterpreting a 24kHz stream as 44.1kHz, which no amount of tuning the
// TTS speed would ever have touched. The lesson was not about sample rates.
// It was that pace is a number, and a number can be checked.
//
// So this prints words per minute next to every sample. An unhurried read
// aloud is roughly 130-170wpm. Much past 180 and it is gabbling, whatever
// the instruction string claims.
//
// Pace is set two ways in the real path — a `speed` multiplier and a pace
// sentence inside voice_instructions — and this script sends the same
// speed the app does, so what you hear here is what a prayer will sound
// like. Measuring is still the point: the two controls act on different
// things and could disagree.
//
//   node --env-file=.env.local scripts/sample-cartoon-voices.mjs
//
// Samples land in ./voice-samples/. Listen to them. If one is wrong, the
// fix is a SQL update to that row's voice_instructions — no deploy.

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Deliberately a Bible verse plus a plain line. The verse is the case that
// broke before: unsteered models read scripture at newsreader speed, and
// it is also the case where a too-jokey delivery would read as mocking.
const SAMPLE_TEXT =
  "Dear God, please watch over Grandma today and help her feel better soon. " +
  "The Lord is my shepherd; I shall not want. He maketh me to lie down in " +
  "green pastures. Thank you for loving us. Amen.";

const WORD_COUNT = SAMPLE_TEXT.trim().split(/\s+/).length;

const OUT_DIR = "voice-samples";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

if (!url || !key) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Run with: node --env-file=.env.local scripts/sample-cartoon-voices.mjs"
  );
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function durationSeconds(path) {
  // ffprobe rather than decoding in-process: it reads the container's own
  // duration field and is already on this machine for the render worker.
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    const n = Number.parseFloat(stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null; // no ffprobe installed — samples still play, just unmeasured
  }
}

async function main() {
  const { data: characters, error } = await supabase
    .from("cartoon_characters")
    .select("name, openai_voice, voice_instructions")
    .order("name");
  if (error) throw new Error(`could not read characters: ${error.message}`);
  if (!characters?.length) throw new Error("no cartoon_characters rows found");

  await mkdir(OUT_DIR, { recursive: true });

  console.log(`Sample text: ${WORD_COUNT} words\n`);

  const rows = [];
  for (const c of characters) {
    process.stdout.write(`  ${c.name} (${c.openai_voice})... `);

    if (!c.voice_instructions) {
      console.log("NO voice_instructions — has 0028 been applied?");
    }

    let buffer;
    try {
      const response = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: c.openai_voice,
        input: SAMPLE_TEXT,
        instructions: c.voice_instructions ?? undefined,
        speed: 0.85, // must match CARTOON_SPEED in src/lib/ai/tts.ts
        response_format: "mp3",
      });
      buffer = Buffer.from(await response.arrayBuffer());
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      rows.push({ name: c.name, voice: c.openai_voice, wpm: null, note: "failed" });
      continue;
    }

    const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const path = `${OUT_DIR}/${slug}.mp3`;
    await writeFile(path, buffer);

    const secs = await durationSeconds(path);
    const wpm = secs ? Math.round((WORD_COUNT / secs) * 60) : null;
    console.log(secs ? `${secs.toFixed(1)}s  ${wpm} wpm` : "written (ffprobe unavailable)");
    rows.push({ name: c.name, voice: c.openai_voice, wpm, secs });
  }

  console.log(`\nWritten to ./${OUT_DIR}/ — listen to them.\n`);

  const measured = rows.filter((r) => r.wpm);
  if (measured.length) {
    const fast = measured.filter((r) => r.wpm > 180);
    const slow = measured.filter((r) => r.wpm < 120);
    if (fast.length) {
      console.log(
        "TOO FAST (over 180wpm) — the instruction is not landing; make the " +
          "pace sentence blunter in that row's voice_instructions:"
      );
      for (const r of fast) console.log(`  ${r.name}: ${r.wpm} wpm`);
    }
    if (slow.length) {
      console.log("DRAGGING (under 120wpm):");
      for (const r of slow) console.log(`  ${r.name}: ${r.wpm} wpm`);
    }
    if (!fast.length && !slow.length) {
      console.log("Pace is in range (120-180wpm) for every character.");
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

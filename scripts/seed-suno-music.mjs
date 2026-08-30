// Imports a folder of SUNO-generated tracks into the `music_styles` library
// (the "Choose a music style" picker on the create page), deriving each
// track's category from the descriptive words already in its filename.
//
//   node --env-file=.env.local scripts/seed-suno-music.mjs "/Users/myron/Desktop/SUNO prayer"
//
// Options:
//   --dry-run    show exactly what would be imported, write nothing
//   --bitrate=N  output MP3 bitrate in kbps, default 112
//
// What it does to each file before uploading, and why:
//
//   1. SKIPS EXACT DUPLICATES. Several SUNO re-rolls are byte-identical
//      (e.g. "Sanctuary Glow ambient" / "...ambients"). Content is hashed,
//      so only the first copy of identical audio is imported.
//   2. LOUDNESS-NORMALIZES to -16 LUFS. The source tracks range -11.0 to
//      -14.6 LUFS. The render worker applies one flat `volume=0.5` to
//      whatever bed it is handed, so an unnormalized library means the same
//      setting lands differently track to track. Normalizing first is what
//      makes the ducking behave consistently across the whole library.
//   3. RE-ENCODES at a modest bitrate. These play under a spoken prayer and
//      get ducked hard while anyone is talking, so a high bitrate buys
//      nothing audible — and the Supabase project is already over its
//      storage quota, so every megabyte matters.
//
// Safe to re-run: any track whose name is already in music_styles is
// skipped, so you can add more files to the folder later and re-run.
//
// Requires ffmpeg on PATH, plus NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
// and SUPABASE_SERVICE_ROLE_KEY in the environment.

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, stat, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const BUCKET = "style-assets";
const TARGET_LUFS = -16;
const DRY_RUN = process.argv.includes("--dry-run");
// Only byte-identical files (same MD5) are ever treated as duplicates —
// different-sized re-rolls of the same prompt are genuinely different audio
// and are always imported. Pass --keep-identical to import even the
// byte-identical copies, which puts two entries in the picker that play the
// exact same audio.
const KEEP_IDENTICAL = process.argv.includes("--keep-identical");
const BITRATE = (() => {
  const hit = process.argv.find((a) => a.startsWith("--bitrate="));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) ? v : 112;
})();

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Ordered most-specific first — the first tag found in the filename wins.
// These map onto the categories the picker already shows: Ambient, Calm,
// Celebration, Cinematic, Classical, Meditation, Minimal, Nature, Peaceful,
// Piano, Scripture, Uplifting.
const CATEGORY_RULES = [
  [/cinemat/i, "Cinematic"],
  [/classic/i, "Classical"],
  [/meditat/i, "Meditation"],
  [/minimal/i, "Minimal"],
  [/celebr|celbrat|party|trap|steppers|hiphop|confetti|parade|roof/i, "Celebration"],
  [/gospel|hallelujah/i, "Uplifting"],
  [/ambien/i, "Ambient"],
  [/calm/i, "Calm"],
  [/piano|sonata|minuet/i, "Piano"],
  [/prayer|sanctuary|scripture/i, "Scripture"],
];

// Descriptive words that belong to the CATEGORY, not to the song's name —
// stripped so "Ashes Over Water cinematic.mp3" becomes "Ashes Over Water".
// NOTE: only genre/mood/prompt words go here. Nouns like "water", "fire",
// "solar" or "air" look like prompt filler but are usually part of the
// actual song title ("Ashes Over Water" became a bare "Ashes Over" when
// they were stripped), so they are deliberately left in.
const NAME_NOISE =
  /\b(cinemat\w*|classic\w*|meditat\w*|minimal|celebr\w*|celbrat\w*|party|trap|steppers|hiphop|gospel|ambien\w*|ambience|calm|vocals?|humss?|high energy|uptempo|inspiration|emotional|feel|buildup)\b/gi;

function categoryFor(filename) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(filename)) return cat;
  return "Peaceful";
}

function titleFor(filename) {
  let base = path.basename(filename, path.extname(filename));
  base = base.replace(NAME_NOISE, " ");
  base = base.replace(/\d+/g, " ");            // variant markers: "Ivory 2", "Tide 3"
  base = base.replace(/[_,]+/g, " ").replace(/\s+/g, " ").trim();
  base = base.replace(/\b\w/g, (c) => c.toUpperCase());
  return base || path.basename(filename, path.extname(filename)).trim();
}

async function measureLoudness(file) {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-hide_banner", "-nostats", "-i", file, "-filter_complex", "ebur128", "-f", "null", "-",
  ]).catch((e) => ({ stderr: e.stderr ?? "" }));
  const m = /Integrated loudness[\s\S]*?I:\s*(-?[\d.]+)\s*LUFS/.exec(stderr);
  return m ? Number(m[1]) : null;
}

async function encode(input, output, gainDb) {
  const args = ["-y", "-i", input];
  if (gainDb !== null) args.push("-af", `volume=${gainDb.toFixed(2)}dB`);
  args.push("-c:a", "libmp3lame", "-b:a", `${BITRATE}k`, "-ar", "44100", "-ac", "2", output);
  await execFileAsync("ffmpeg", args);
}

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.error(
      'Usage: node --env-file=.env.local scripts/seed-suno-music.mjs "/path/to/folder"'
    );
    process.exit(1);
  }

  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    console.error("ffmpeg not found on PATH. Install it first:\n\n  brew install ffmpeg\n");
    process.exit(1);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("music_styles")
    .select("name");
  if (existingError) {
    console.error(`Failed to read music_styles: ${existingError.message}`);
    process.exit(1);
  }
  const existingNames = new Set((existingRows || []).map((r) => r.name));

  const files = (await readdir(folder))
    .filter((f) => f.toLowerCase().endsWith(".mp3"))
    .sort();

  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}` +
      `${files.length} file(s) found, target ${TARGET_LUFS} LUFS @ ${BITRATE}kbps\n`
  );

  const workDir = await mkdtemp(path.join(tmpdir(), "suno-music-"));
  const seenHashes = new Map();
  const seenNames = new Set();
  let imported = 0, skippedDupe = 0, skippedExisting = 0, bytesBefore = 0, bytesAfter = 0;
  const failed = [];
  const plan = [];

  try {
    for (const file of files) {
      const full = path.join(folder, file);
      try {
        const buf = await readFile(full);
        const hash = createHash("md5").update(buf).digest("hex");
        if (seenHashes.has(hash) && !KEEP_IDENTICAL) {
          console.log(`SKIP (byte-identical to "${seenHashes.get(hash)}")  ${file}`);
          skippedDupe++;
          continue;
        }
        if (!seenHashes.has(hash)) seenHashes.set(hash, file);

        const category = categoryFor(file);
        let name = titleFor(file);
        // Variant re-rolls can collapse to the same cleaned title; keep them
        // distinct rather than silently dropping one.
        let n = 2;
        const baseName = name;
        while (seenNames.has(name)) name = `${baseName} ${n++}`;
        seenNames.add(name);

        if (existingNames.has(name)) {
          console.log(`SKIP (already in library)  ${name}`);
          skippedExisting++;
          continue;
        }

        const lufs = await measureLoudness(full);
        const gain = lufs === null ? null : TARGET_LUFS - lufs;

        const outPath = path.join(workDir, `${hash}.mp3`);
        await encode(full, outPath, gain);
        const before = buf.length;
        const after = (await stat(outPath)).size;
        bytesBefore += before;
        bytesAfter += after;

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
        const storagePath = `music/suno-${slug}.mp3`;

        plan.push({ name, category, storagePath, before, after, lufs, gain });
        console.log(
          `${DRY_RUN ? "WOULD ADD" : "ADDING  "}  ${name.padEnd(30).slice(0, 30)} ` +
            `${category.padEnd(11)} ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB ` +
            `${lufs === null ? "" : `(${lufs} LUFS, ${gain >= 0 ? "+" : ""}${gain.toFixed(1)}dB)`}`
        );

        if (!DRY_RUN) {
          const outBuf = await readFile(outPath);
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, outBuf, { contentType: "audio/mpeg", upsert: true, cacheControl: "3600" });
          if (upErr) throw new Error(`upload: ${upErr.message}`);

          const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
          const { error: insErr } = await supabase.from("music_styles").insert({
            name,
            music_asset: pub.publicUrl,
            category,
            source: "SUNO (generated for PrayerMessenger)",
            license: null,
          });
          if (insErr) throw new Error(`insert: ${insErr.message}`);
          imported++;
        }
        await rm(outPath, { force: true });
      } catch (err) {
        console.error(`FAILED  ${file}: ${err.message}`);
        failed.push(file);
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const byCat = {};
  for (const p of plan) byCat[p.category] = (byCat[p.category] || 0) + 1;

  console.log(`\n${"=".repeat(64)}`);
  console.log(`Tracks:   ${plan.length} ${DRY_RUN ? "would be added" : `added (${imported} written)`}`);
  console.log(`Skipped:  ${skippedDupe} identical duplicate(s), ${skippedExisting} already in library`);
  console.log(`Size:     ${(bytesBefore / 1048576).toFixed(0)} MB -> ${(bytesAfter / 1048576).toFixed(0)} MB`);
  console.log(`By category:`);
  for (const [c, n] of Object.entries(byCat).sort()) console.log(`    ${c.padEnd(12)} ${n}`);
  if (failed.length) console.log(`FAILED:   ${failed.join(", ")}`);
  console.log("=".repeat(64));
  if (DRY_RUN) console.log("\nLooks right? Re-run without --dry-run to import for real.");
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

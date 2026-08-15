// Seeds additional standalone music styles (music is decoupled from visual
// style — see 0010_music_styles.sql / 0011_asset_library.sql). Each track
// below was verified by cross-checking multiple independent listings
// (Chosic, RouteNote, Spotify, etc.) against the real incompetech.com
// catalog before being added here, to avoid the 404s we hit guessing
// filenames blind.
//
// Run from the repo root:
//
//   node --env-file=.env.local scripts/seed-music-styles.mjs
//
// Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY in the environment — same values as
// .env.local / worker/.env.
//
// Tracks are by Kevin MacLeod (incompetech.com), licensed under Creative
// Commons BY 4.0 — attribution required. This script writes source/license
// straight into the DB row (see 0011_asset_library.sql), so the Credits
// page (which now reads from the database) picks them up automatically —
// no need to hand-edit src/app/credits/page.tsx anymore.
//
// NOTE: this cloud sandbox's network egress blocks incompetech.com (same
// restriction that affects fonts.googleapis.com — see AGENTS.md/session
// notes), so run this from a machine with normal internet access (e.g.
// your Mac). Safe to re-run — skips existing rows.

import { createClient } from "@supabase/supabase-js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = "style-assets";

const DEFAULT_SOURCE = "Kevin MacLeod (incompetech.com)";
const DEFAULT_LICENSE = "Creative Commons Attribution 4.0";

// track title (must exactly match the real incompetech filename, unless a
// full source/license override is given) -> { url, category, source?,
// license? }. category is the mood tag shown as a filter chip in the
// picker; source/license default to the incompetech constants above but
// can be overridden per-track for tracks pulled from elsewhere (e.g.
// SoundBible.com sound effects).
const TRACKS = {
  Piano: {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Meditation%20Impromptu%2001.mp3",
    category: "Piano",
  },
  Ukulele: {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Local%20Forecast.mp3",
    category: "Acoustic",
  },
  Ambient: {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Wallpaper.mp3",
    category: "Ambient",
  },
  Classical: {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Canon%20in%20D%20Major.mp3",
    category: "Classical",
  },
  "Reaching Out": {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Reaching%20Out.mp3",
    category: "Uplifting",
  },
  "Ethereal Relaxation": {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ethereal%20Relaxation.mp3",
    category: "Peaceful",
  },
  Healing: {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Healing.mp3",
    category: "Calm",
  },
  "Amazing Plan": {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Amazing%20Plan.mp3",
    category: "Uplifting",
  },
  "Music To Delight": {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Music%20To%20Delight.mp3",
    category: "Celebration",
  },
  "Angevin B": {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Angevin%20B.mp3",
    category: "Acoustic",
  },
  // Meditation: rain/thunder-adjacent, deeply calming pieces for a
  // "storm sounds while you pray" mood.
  "Thunder Dreams": {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Thunder%20Dreams.mp3",
    category: "Meditation",
  },
  "Rains Will Fall": {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Rains%20Will%20Fall.mp3",
    category: "Meditation",
  },
  "Meditation Impromptu 02": {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Meditation%20Impromptu%2002.mp3",
    category: "Meditation",
  },
  "Meditation Impromptu 03": {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Meditation%20Impromptu%2003.mp3",
    category: "Meditation",
  },
  "Floating Cities": {
    url: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Floating%20Cities.mp3",
    category: "Meditation",
  },
  // Real rain/thunder ambience (not melodic music) from SoundBible.com,
  // for a literal "storm sounds while you pray" option.
  "Perfect Thunder Storm": {
    url: "https://soundbible.com/grab.php?id=916&type=mp3",
    category: "Meditation",
    source: "Mike Koenig (soundbible.com)",
    license: "Creative Commons Attribution 3.0",
  },
  "Rain And Thunder Strikes": {
    url: "https://soundbible.com/grab.php?id=901&type=mp3",
    category: "Meditation",
    source: "Mike Koenig (soundbible.com)",
    license: "Creative Commons Attribution 3.0",
  },
  "Medium Rainstorm": {
    url: "https://soundbible.com/grab.php?id=1829&type=mp3",
    category: "Meditation",
    source: "Mike Koenig (soundbible.com)",
    license: "Creative Commons Attribution 3.0",
  },
  "Rainforest Ambience": {
    url: "https://soundbible.com/grab.php?id=1818&type=mp3",
    category: "Meditation",
    source: "GlorySunz (soundbible.com)",
    license: "Public Domain",
  },
};

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buffer);
  return buffer.byteLength;
}

async function uploadToStorage(localPath, storagePath, contentType) {
  const data = await readFile(localPath);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, data, { contentType, upsert: true });
  if (error) throw new Error(`Upload failed for ${storagePath}: ${error.message}`);
  const { data: publicUrlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(storagePath);
  return publicUrlData.publicUrl;
}

// Optional: node scripts/seed-music-styles.mjs --limit=3 processes only
// the first N not-yet-imported tracks, then exits. Safe to re-run
// repeatedly (e.g. in short bursts) — already-imported tracks (matched by
// name) are skipped entirely, not re-downloaded.
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

async function main() {
  const workDir = await mkdtemp(path.join(tmpdir(), "music-styles-"));
  console.log(`Working in ${workDir}`);

  const { data: existingRows } = await supabase.from("music_styles").select("name");
  const existingNames = new Set((existingRows || []).map((r) => r.name));

  const failed = [];
  let imported = 0;
  let processed = 0;

  for (const [name, track] of Object.entries(TRACKS)) {
    if (existingNames.has(name)) continue;
    if (processed >= LIMIT) {
      console.log(`\n--limit=${LIMIT} reached, stopping (re-run to continue).`);
      break;
    }
    const { url, category } = track;
    const source = track.source || DEFAULT_SOURCE;
    const license = track.license || DEFAULT_LICENSE;
    console.log(`\n${name} (${category}):`);
    try {
      const musicLocal = path.join(workDir, `${slugify(name)}.mp3`);

      console.log("  downloading...");
      const bytes = await downloadTo(url, musicLocal);
      console.log(`  size: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

      const storagePath = `music/${slugify(name)}.mp3`;

      console.log("  uploading to Supabase Storage...");
      const musicUrl = await uploadToStorage(musicLocal, storagePath, "audio/mpeg");

      console.log("  inserting music_styles row...");
      const { error } = await supabase
        .from("music_styles")
        .insert({ name, music_asset: musicUrl, category, source, license });
      if (error) throw new Error(`Failed to insert music_styles row for ${name}: ${error.message}`);
      imported++;
      processed++;

      console.log(`  done: ${name} -> ${musicUrl}`);
    } catch (err) {
      console.error(`  FAILED: ${name}: ${err.message}`);
      failed.push(name);
      processed++;
    }
  }

  await rm(workDir, { recursive: true, force: true });

  const stillTodo = Object.keys(TRACKS).length - existingNames.size - imported;
  console.log(`\nImported ${imported} new this run. ${Math.max(stillTodo, 0)} left to do — re-run to continue.`);
  if (failed.length) {
    console.log(`Failed (swap the URL in TRACKS and re-run): ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});

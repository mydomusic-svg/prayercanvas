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

const SOURCE = "Kevin MacLeod (incompetech.com)";
const LICENSE = "Creative Commons Attribution 4.0";

// track title (must exactly match the real incompetech filename) ->
// { url, category }. category is the mood tag shown as a filter chip in
// the picker.
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

async function main() {
  const workDir = await mkdtemp(path.join(tmpdir(), "music-styles-"));
  console.log(`Working in ${workDir}`);

  const failed = [];
  let imported = 0;
  let skipped = 0;

  for (const [name, { url, category }] of Object.entries(TRACKS)) {
    console.log(`\n${name} (${category}):`);
    try {
      const { data: existing } = await supabase
        .from("music_styles")
        .select("id")
        .eq("name", name)
        .maybeSingle();

      const musicLocal = path.join(workDir, `${slugify(name)}.mp3`);

      console.log("  downloading...");
      const bytes = await downloadTo(url, musicLocal);
      console.log(`  size: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

      const storagePath = `music/${slugify(name)}.mp3`;

      console.log("  uploading to Supabase Storage...");
      const musicUrl = await uploadToStorage(musicLocal, storagePath, "audio/mpeg");

      console.log("  upserting music_styles row...");
      if (existing) {
        const { error } = await supabase
          .from("music_styles")
          .update({ music_asset: musicUrl, category, source: SOURCE, license: LICENSE })
          .eq("id", existing.id);
        if (error) throw new Error(`Failed to update music_styles row for ${name}: ${error.message}`);
        skipped++;
      } else {
        const { error } = await supabase
          .from("music_styles")
          .insert({ name, music_asset: musicUrl, category, source: SOURCE, license: LICENSE });
        if (error) throw new Error(`Failed to insert music_styles row for ${name}: ${error.message}`);
        imported++;
      }

      console.log(`  done: ${name} -> ${musicUrl}`);
    } catch (err) {
      console.error(`  FAILED: ${name}: ${err.message}`);
      failed.push(name);
    }
  }

  await rm(workDir, { recursive: true, force: true });

  console.log(`\nImported ${imported} new, updated ${skipped} existing.`);
  if (failed.length) {
    console.log(`Failed (swap the URL in TRACKS and re-run): ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});

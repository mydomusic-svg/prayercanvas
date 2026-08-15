// One-time seeding script for adding a few more simple, standalone music
// styles (no video attached — see 0010_music_styles.sql, which decouples
// music from visual style). Run once, from the repo root, after applying
// that migration:
//
//   node --env-file=.env.local scripts/seed-music-styles.mjs
//
// Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY in the environment — same values as
// .env.local / worker/.env.
//
// Tracks are by Kevin MacLeod (incompetech.com), licensed under Creative
// Commons BY 4.0 — attribution required. Add each new name to the
// MUSIC_CREDITS list in src/app/credits/page.tsx alongside this script.
//
// NOTE: this cloud sandbox's network egress blocks incompetech.com (same
// restriction that affects fonts.googleapis.com — see AGENTS.md/session
// notes), so these download URLs could not be verified from here. If any
// track 404s, swap in a different incompetech track name and re-run —
// the script is safe to run multiple times (upsert on Storage, update on
// the DB row).

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

// music style name -> source URL. Four simple, calm additions alongside
// the six existing style-bundled tracks (Nature/Cinematic/Minimal/
// Celebration/Scripture/Peaceful, backfilled into music_styles by
// 0010_music_styles.sql).
const TRACKS = {
  Piano: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Meditation%20Impromptu%2001.mp3",
  Ukulele: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ukulele.mp3",
  Ambient: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Wallpaper.mp3",
  Classical: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Canon%20in%20D%20Pachelbel.mp3",
};

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

  for (const [name, url] of Object.entries(TRACKS)) {
    console.log(`\n${name}:`);

    const musicLocal = path.join(workDir, `${name}.mp3`);

    console.log("  downloading...");
    const bytes = await downloadTo(url, musicLocal);
    console.log(`  size: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

    const storagePath = `music/${name.toLowerCase()}.mp3`;

    console.log("  uploading to Supabase Storage...");
    const musicUrl = await uploadToStorage(musicLocal, storagePath, "audio/mpeg");

    console.log("  upserting music_styles row...");
    const { data: existing } = await supabase
      .from("music_styles")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("music_styles")
        .update({ music_asset: musicUrl })
        .eq("id", existing.id);
      if (error) throw new Error(`Failed to update music_styles row for ${name}: ${error.message}`);
    } else {
      const { error } = await supabase
        .from("music_styles")
        .insert({ name, music_asset: musicUrl });
      if (error) throw new Error(`Failed to insert music_styles row for ${name}: ${error.message}`);
    }

    console.log(`  done: ${name} -> ${musicUrl}`);
  }

  await rm(workDir, { recursive: true, force: true });
  console.log(`\nAll ${Object.keys(TRACKS).length} new music styles seeded.`);
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});

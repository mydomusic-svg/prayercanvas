// One-time seeding script for Sprint 3.5: downloads real background video +
// music assets per style and uploads them to the `style-assets` Supabase
// Storage bucket, then updates the `styles` table rows to point at them
// (replacing the placeholder filenames from 0001_init.sql).
//
// Run once, from the repo root, after applying 0005_style_assets.sql:
//
//   node --env-file=.env.local scripts/seed-style-assets.mjs
//
// Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY in the environment — same values as
// .env.local / worker/.env.
//
// Assets:
//  - Video clips are from Pexels (Pexels License — free for commercial use,
//    no attribution required). https://www.pexels.com/license/
//  - Music tracks are by Kevin MacLeod (incompetech.com), licensed under
//    Creative Commons BY 4.0 — attribution required. See /credits in the
//    app for the exact attribution text shown to users.

import { createClient } from "@supabase/supabase-js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

// style name (matches public.styles.name) -> asset sources
const ASSETS = {
  Nature: {
    video:
      "https://videos.pexels.com/video-files/4328730/4328730-uhd_2560_1440_30fps.mp4",
    music: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Windswept.mp3",
  },
  Cinematic: {
    video:
      "https://videos.pexels.com/video-files/4999943/4999943-uhd_2560_1440_30fps.mp4",
    music:
      "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Majestic%20Hills.mp3",
  },
  Minimal: {
    video:
      "https://videos.pexels.com/video-files/6340529/6340529-uhd_1440_2560_30fps.mp4",
    music: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Pensif.mp3",
  },
  Celebration: {
    video:
      "https://videos.pexels.com/video-files/855018/855018-hd_1920_1080_24fps.mp4",
    music: "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3",
  },
  Scripture: {
    video:
      "https://videos.pexels.com/video-files/855262/855262-hd_1920_1080_25fps.mp4",
    music:
      "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Amazing%20Grace%202011.mp3",
  },
  Peaceful: {
    video:
      "https://videos.pexels.com/video-files/11512714/11512714-hd_1080_1620_24fps.mp4",
    music:
      "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Winter%20Reflections.mp3",
  },
};

async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const { writeFile } = await import("node:fs/promises");
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
  const workDir = await mkdtemp(path.join(tmpdir(), "style-assets-"));
  console.log(`Working in ${workDir}`);

  for (const [styleName, { video, music }] of Object.entries(ASSETS)) {
    console.log(`\n${styleName}:`);

    const videoLocal = path.join(workDir, `${styleName}.mp4`);
    const musicLocal = path.join(workDir, `${styleName}.mp3`);

    console.log("  downloading video...");
    const videoBytes = await downloadTo(video, videoLocal);
    console.log(`  video: ${(videoBytes / 1024 / 1024).toFixed(1)} MB`);

    console.log("  downloading music...");
    const musicBytes = await downloadTo(music, musicLocal);
    console.log(`  music: ${(musicBytes / 1024 / 1024).toFixed(1)} MB`);

    const videoStoragePath = `videos/${styleName.toLowerCase()}.mp4`;
    const musicStoragePath = `music/${styleName.toLowerCase()}.mp3`;

    console.log("  uploading to Supabase Storage...");
    const videoUrl = await uploadToStorage(videoLocal, videoStoragePath, "video/mp4");
    const musicUrl = await uploadToStorage(musicLocal, musicStoragePath, "audio/mpeg");

    console.log("  updating styles row...");
    const { error } = await supabase
      .from("styles")
      .update({ visual_asset: videoUrl, music_asset: musicUrl })
      .eq("name", styleName);
    if (error) throw new Error(`Failed to update styles row for ${styleName}: ${error.message}`);

    console.log(`  done: ${styleName} -> ${videoUrl} / ${musicUrl}`);
  }

  await rm(workDir, { recursive: true, force: true });
  console.log("\nAll 6 styles updated with real assets.");
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});

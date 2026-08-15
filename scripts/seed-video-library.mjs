// Bulk video library seeder: searches the Pexels Video API for a set of
// prayer/devotional-themed categories, downloads a handful of vertical
// clips per category, uploads them to the `style-assets` Supabase Storage
// bucket, and inserts them as new rows in `public.styles` (video is now
// decoupled from music — see 0010_music_styles.sql / 0011_asset_library.sql
// — so these rows only need a visual_asset; music_asset is left null).
//
// Safe to re-run: skips any Pexels video id it has already imported
// (tracked via a `pexels:<id>` marker embedded in the stored filename).
//
// Run from the repo root:
//
//   node --env-file=.env.local scripts/seed-video-library.mjs
//
// Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
// and PEXELS_API_KEY in the environment.
//
// NOTE: this cloud sandbox's network egress blocks Pexels' CDN and API, so
// this script must be run from a machine with normal internet access (e.g.
// your Mac) — same restriction documented in seed-music-styles.mjs.

import { createClient } from "@supabase/supabase-js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}
if (!PEXELS_API_KEY) {
  console.error("Missing PEXELS_API_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = "style-assets";

// category -> search queries. Multiple queries per category widen the
// pool Pexels returns (a single query often repeats a handful of top
// results). Tune freely — this is meant to be edited and re-run over time
// as the library grows.
const CATEGORIES = {
  Nature: ["forest stream", "ocean waves", "mountain sunrise", "rain on leaves"],
  Cinematic: ["storm clouds", "golden hour clouds", "aerial mountains", "light rays forest"],
  Minimal: ["bokeh lights", "soft gradient background", "blurred lights night"],
  Celebration: ["confetti celebration", "sunshine through trees", "balloons sky"],
  Scripture: ["candle flame", "open bible", "praying hands", "church interior"],
  Peaceful: ["sunset clouds", "calm lake", "starry night sky", "gentle waves beach"],
  Family: ["family embrace", "holding hands", "family silhouette sunset"],
  Hope: ["sunrise horizon", "light breaking through clouds", "dove flying"],
};

const PER_CATEGORY_LIMIT = 6; // max clips to import per category per run
const PER_QUERY_RESULTS = 5;

async function searchPexels(query) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(
    query
  )}&orientation=portrait&size=medium&per_page=${PER_QUERY_RESULTS}`;
  const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
  if (!res.ok) throw new Error(`Pexels search failed for "${query}": ${res.status}`);
  const data = await res.json();
  return data.videos || [];
}

function pickBestFile(video) {
  // Prefer HD portrait mp4 files in a reasonable size range.
  const files = (video.video_files || []).filter((f) => f.file_type === "video/mp4");
  const portrait = files.filter((f) => f.height && f.width && f.height > f.width);
  const pool = portrait.length ? portrait : files;
  pool.sort((a, b) => (b.height || 0) - (a.height || 0));
  return pool.find((f) => (f.height || 0) <= 1920) || pool[0];
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
  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return publicUrlData.publicUrl;
}

async function main() {
  const workDir = await mkdtemp(path.join(tmpdir(), "video-library-"));
  console.log(`Working in ${workDir}`);

  // Load already-imported Pexels ids so re-runs don't duplicate.
  const { data: existingRows } = await supabase
    .from("styles")
    .select("visual_asset");
  const existingIds = new Set(
    (existingRows || [])
      .map((r) => (r.visual_asset || "").match(/pexels-(\d+)\.mp4$/)?.[1])
      .filter(Boolean)
  );

  let totalImported = 0;
  const failed = [];

  for (const [category, queries] of Object.entries(CATEGORIES)) {
    console.log(`\n=== ${category} ===`);
    const seen = new Set();
    const candidates = [];

    for (const query of queries) {
      try {
        const videos = await searchPexels(query);
        for (const v of videos) {
          if (seen.has(v.id) || existingIds.has(String(v.id))) continue;
          seen.add(v.id);
          candidates.push({ video: v, query });
        }
      } catch (err) {
        console.error(`  search "${query}" failed: ${err.message}`);
      }
    }

    const toImport = candidates.slice(0, PER_CATEGORY_LIMIT);
    console.log(`  found ${candidates.length} new candidates, importing ${toImport.length}`);

    for (const { video, query } of toImport) {
      try {
        const file = pickBestFile(video);
        if (!file) throw new Error("no usable mp4 file");

        const localPath = path.join(workDir, `pexels-${video.id}.mp4`);
        console.log(`  downloading pexels-${video.id} (${query})...`);
        const bytes = await downloadTo(file.link, localPath);
        console.log(`    size: ${(bytes / 1024 / 1024).toFixed(1)} MB`);

        const storagePath = `videos/pexels-${video.id}.mp4`;
        const visualUrl = await uploadToStorage(localPath, storagePath, "video/mp4");

        const name = `${category} — ${query}`;
        const { error } = await supabase.from("styles").insert({
          name,
          visual_asset: visualUrl,
          music_asset: null,
          category,
          source: "Pexels",
          license: "Pexels License (free for commercial use, no attribution required)",
        });
        if (error) throw new Error(`insert failed: ${error.message}`);

        console.log(`    done: ${name}`);
        totalImported++;
      } catch (err) {
        console.error(`    FAILED: pexels-${video.id}: ${err.message}`);
        failed.push(`${category}/${video.id}`);
      }
    }
  }

  await rm(workDir, { recursive: true, force: true });

  console.log(`\nImported ${totalImported} new video clips.`);
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});

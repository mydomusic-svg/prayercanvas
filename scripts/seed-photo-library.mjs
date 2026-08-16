// Bulk photo library seeder: searches the Pexels Photo API for the same
// prayer/devotional-themed categories as seed-video-library.mjs, downloads
// a handful of portrait-friendly stills per category, uploads them to the
// `style-assets` Supabase Storage bucket (under photos/, alongside the
// existing videos/ and music/ prefixes), and inserts them as rows in the
// new `public.photo_styles` table (see 0014_photo_styles.sql).
//
// This is a separate library from `public.styles` (video backgrounds) —
// picking one of these sets prayers.photo_asset_url directly to the
// already-hosted image, the same field "upload your own photo" fills in,
// so the render worker's existing Ken Burns pan/zoom path (see
// generateKenBurnsClip in worker/index.js) handles it with no changes.
//
// Safe to re-run: skips any Pexels photo id it has already imported
// (tracked via a `pexels-<id>` marker embedded in the stored filename).
//
// Run from the repo root:
//
//   node --env-file=.env.local scripts/seed-photo-library.mjs
//
// Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
// and PEXELS_API_KEY in the environment (the same PEXELS_API_KEY already
// used by seed-video-library.mjs — Pexels Photos and Videos share one key).
//
// NOTE: this cloud sandbox's network egress blocks Pexels' CDN and API, so
// this script must be run from a machine with normal internet access (e.g.
// your Mac) — same restriction documented in seed-video-library.mjs /
// seed-music-styles.mjs.

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

// Same category set as seed-video-library.mjs, so the photo library lines
// up with the existing video-style categories rather than introducing a
// parallel taxonomy. Search terms are photo-flavored variants, not copied
// verbatim from the video queries — "forest stream" reads fine as a video
// search but a still photo search does better with terms tuned for a
// single strong composition.
const CATEGORIES = {
  Nature: ["forest path", "ocean sunset", "mountain landscape", "rain on window"],
  Cinematic: ["dramatic clouds", "golden hour sky", "aerial mountain fog", "sun rays forest"],
  Minimal: ["bokeh lights", "soft gradient", "blurred city lights night"],
  Celebration: ["confetti", "sunlight through trees", "balloons sky"],
  Scripture: ["candle flame", "open bible", "praying hands", "church interior"],
  Peaceful: ["sunset sky", "calm lake", "starry night sky", "beach waves"],
  Family: ["family silhouette sunset", "holding hands", "family embrace"],
  Hope: ["sunrise horizon", "light through clouds", "dove flying"],
};

const PER_CATEGORY_LIMIT = 8; // stills are much smaller than clips — afford more per run
const PER_QUERY_RESULTS = 6;

async function searchPexels(query) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
    query
  )}&orientation=portrait&per_page=${PER_QUERY_RESULTS}`;
  const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
  if (!res.ok) throw new Error(`Pexels search failed for "${query}": ${res.status}`);
  const data = await res.json();
  return data.photos || [];
}

// Supabase Storage's per-file limit is generous relative to any Pexels
// still (typically a few hundred KB to a few MB), but cap well under it
// anyway so a freak oversized original doesn't burn bandwidth re-failing on
// every re-run.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Prefer large2x (a good balance of resolution vs. file size for a
// 1080x1920 Ken Burns crop) with fallbacks either direction if it's ever
// missing from a given photo's src object.
function pickImageUrl(photo) {
  return (
    photo.src?.large2x || photo.src?.original || photo.src?.large || photo.src?.portrait
  );
}

async function downloadTo(url, destPath, maxBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const contentLength = res.headers.get("content-length");
  if (maxBytes && contentLength && Number(contentLength) > maxBytes) {
    await res.arrayBuffer().catch(() => {});
    throw new Error(`TOO_LARGE:${contentLength}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (maxBytes && buffer.byteLength > maxBytes) {
    throw new Error(`TOO_LARGE:${buffer.byteLength}`);
  }
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

// Optional: node scripts/seed-photo-library.mjs --limit=20 imports only N
// new photos total (across all categories) then exits. Safe to re-run
// repeatedly; already-imported Pexels ids are skipped.
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const GLOBAL_LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;

async function main() {
  const workDir = await mkdtemp(path.join(tmpdir(), "photo-library-"));
  console.log(`Working in ${workDir}`);

  const { data: existingRows } = await supabase
    .from("photo_styles")
    .select("image_asset");
  const existingIds = new Set(
    (existingRows || [])
      .map((r) => (r.image_asset || "").match(/pexels-(\d+)\.jpg$/)?.[1])
      .filter(Boolean)
  );

  let totalImported = 0;
  const failed = [];

  for (const [category, queries] of Object.entries(CATEGORIES)) {
    if (totalImported >= GLOBAL_LIMIT) {
      console.log(`\n--limit=${GLOBAL_LIMIT} reached, stopping (re-run to continue).`);
      break;
    }
    console.log(`\n=== ${category} ===`);
    const seen = new Set();
    const candidates = [];

    for (const query of queries) {
      try {
        const photos = await searchPexels(query);
        for (const p of photos) {
          if (seen.has(p.id) || existingIds.has(String(p.id))) continue;
          seen.add(p.id);
          candidates.push({ photo: p, query });
        }
      } catch (err) {
        console.error(`  search "${query}" failed: ${err.message}`);
      }
    }

    const toImport = candidates.slice(0, PER_CATEGORY_LIMIT);
    console.log(`  found ${candidates.length} new candidates, importing ${toImport.length}`);

    for (const { photo, query } of toImport) {
      if (totalImported >= GLOBAL_LIMIT) break;
      try {
        const imageUrl = pickImageUrl(photo);
        if (!imageUrl) throw new Error("no usable image URL");

        const localPath = path.join(workDir, `pexels-${photo.id}.jpg`);
        console.log(`  downloading pexels-${photo.id} (${query})...`);
        const bytes = await downloadTo(imageUrl, localPath, MAX_UPLOAD_BYTES);
        console.log(`    size: ${(bytes / 1024 / 1024).toFixed(2)} MB`);

        const storagePath = `photos/pexels-${photo.id}.jpg`;
        const publicUrl = await uploadToStorage(localPath, storagePath, "image/jpeg");

        const name = `${category} — ${query}`;
        const { error } = await supabase.from("photo_styles").insert({
          name,
          image_asset: publicUrl,
          category,
          source: "Pexels",
          license: "Pexels License (free for commercial use, no attribution required)",
        });
        if (error) throw new Error(`insert failed: ${error.message}`);

        console.log(`    done: ${name}`);
        totalImported++;
      } catch (err) {
        console.error(`    FAILED: pexels-${photo.id}: ${err.message}`);
        failed.push(`${category}/${photo.id}`);
      }
    }
  }

  await rm(workDir, { recursive: true, force: true });

  console.log(`\nImported ${totalImported} new photos.`);
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});

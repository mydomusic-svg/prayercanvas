// One-off importer for hand-picked photos supplied directly by Myron (not
// sourced from Pexels) — uploads local image files to the `style-assets`
// Storage bucket (under photos/, alongside the Pexels-sourced ones from
// seed-photo-library.mjs) and inserts them into `public.photo_styles` with
// a manually chosen category, so they show up in the "Browse photo
// library" picker (create page + media editor) with the same Ken Burns
// pan/zoom treatment as every other library photo — plain <img> tiles,
// no play-icon overlay (that only applies to video style thumbnails).
//
// Run from the repo root, pointing at the folder containing the images:
//
//   node --env-file=.env.local scripts/add-custom-photos.mjs "/Users/myron/Desktop/untitled folder/Images"
//
// Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY in the environment.
//
// To add more photos later: drop the new files anywhere and add an entry
// to MANIFEST below (filename -> name + category). Anything in the target
// folder that isn't listed in MANIFEST is left alone — this keeps stray
// screenshots or work-in-progress files from silently ending up in the
// library. Safe to re-run: uploads use upsert, and inserting the same
// filename again just adds a duplicate row, so don't re-run with the same
// manifest entries already imported.
//
// NOTE: unlike the Pexels seeders, this script only reads local files and
// talks to Supabase — no third-party API — so it can run from anywhere
// with normal internet access to your Supabase project (your Mac
// terminal). It will NOT work from the device bridge's local shell tool,
// which has no network access at all.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
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

// Categories match the taxonomy already used by seed-video-library.mjs /
// seed-photo-library.mjs: Nature, Cinematic, Minimal, Celebration,
// Scripture, Peaceful, Family, Hope.
//
// Some files dropped into the source folder were intentionally left out of
// the manifest:
//   - "ChatGPT Image Aug 16, 2026, 07_32_10 PM.png", "...07_33_10 PM.png",
//     and "...07_57_34 PM.png" are moodboard/collage grids (many small
//     unrelated photos tiled together), not a single usable background —
//     Ken Burns panning across a contact sheet would look like a broken
//     grid on screen, not a photo.
//   - "ChatGPT Image Aug 16, 2026, 07_39_00 PM.png" is a UI mockup
//     screenshot (a redesigned video-library picker with play-icon
//     overlays), not a background photo at all.
//   - The whole "ChatGPT Image Aug 16, 2026, 08_11_*" batch (10 files) is a
//     near-duplicate re-generation of the same 10 scenes as the
//     "08_08_*" batch (same mountain lake, butterfly meadow, galaxy,
//     kids, beach, waterfall, sunrise silhouette, stacked stones, candle,
//     dove) — only the 08_08_* copy of each scene was kept, to avoid the
//     library feeling repetitive with visually-identical entries.
// If any of those should actually be split into individual images and
// added, crop them down to single photos first, then add entries here.
const MANIFEST = {
  "ChatGPT Image Aug 16, 2026, 07_35_52 PM.png": {
    name: "Family — dad and daughter on a swing",
    category: "Family",
  },
  "closeup-shot-beautiful-butterfly-orange-petaled-flower.jpg": {
    name: "Nature — butterfly on a flower",
    category: "Nature",
  },
  "spring-photograph-with-beautiful-flowers.jpg": {
    name: "Peaceful — spring flower bouquet",
    category: "Peaceful",
  },
  "ChatGPT Image Aug 16, 2026, 07_53_04 PM.png": {
    name: "Nature — sunlit forest stream",
    category: "Nature",
  },
  "ChatGPT Image Aug 16, 2026, 08_08_41 PM (1).png": {
    name: "Nature — mountain lake at sunrise",
    category: "Nature",
  },
  "ChatGPT Image Aug 16, 2026, 08_08_41 PM (2).png": {
    name: "Nature — butterflies over a wildflower meadow",
    category: "Nature",
  },
  "ChatGPT Image Aug 16, 2026, 08_08_42 PM (3).png": {
    name: "Cinematic — spiral galaxy above a planet",
    category: "Cinematic",
  },
  "ChatGPT Image Aug 16, 2026, 08_08_42 PM (4).png": {
    name: "Family — kids laughing together outdoors",
    category: "Family",
  },
  "ChatGPT Image Aug 16, 2026, 08_08_42 PM (5).png": {
    name: "Peaceful — tropical beach with palm trees",
    category: "Peaceful",
  },
  "ChatGPT Image Aug 16, 2026, 08_08_42 PM (6).png": {
    name: "Nature — jungle waterfall into a turquoise pool",
    category: "Nature",
  },
  "ChatGPT Image Aug 16, 2026, 08_08_43 PM (7).png": {
    name: "Hope — arms raised toward a mountain sunrise",
    category: "Hope",
  },
  "ChatGPT Image Aug 16, 2026, 08_08_43 PM (8).png": {
    name: "Minimal — stacked stones with a green leaf",
    category: "Minimal",
  },
  "ChatGPT Image Aug 16, 2026, 08_08_44 PM (9).png": {
    name: "Peaceful — candlelight on a cozy blanket",
    category: "Peaceful",
  },
  "ChatGPT Image Aug 16, 2026, 08_08_44 PM (10).png": {
    name: "Hope — dove flying in a sunlit sky",
    category: "Hope",
  },
};

function contentTypeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
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
  const folder = process.argv[2];
  if (!folder) {
    console.error(
      'Usage: node --env-file=.env.local scripts/add-custom-photos.mjs "/path/to/folder"'
    );
    process.exit(1);
  }

  const entries = Object.entries(MANIFEST);
  let imported = 0;
  const failed = [];

  for (const [filename, { name, category }] of entries) {
    const localPath = path.join(folder, filename);
    try {
      const contentType = contentTypeFor(filename);
      const ext = contentType === "image/png" ? "png" : "jpg";
      const slug = filename
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 60);
      const storagePath = `photos/custom-${slug}.${ext}`;

      console.log(`Uploading "${filename}" -> ${storagePath} (${category})...`);
      const publicUrl = await uploadToStorage(localPath, storagePath, contentType);

      const { error } = await supabase.from("photo_styles").insert({
        name,
        image_asset: publicUrl,
        category,
        source: "Myron (custom upload)",
        license: null,
      });
      if (error) throw new Error(`insert failed: ${error.message}`);

      console.log(`  done: ${name}`);
      imported++;
    } catch (err) {
      console.error(`  FAILED: ${filename}: ${err.message}`);
      failed.push(filename);
    }
  }

  console.log(`\nImported ${imported}/${entries.length} custom photos.`);
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

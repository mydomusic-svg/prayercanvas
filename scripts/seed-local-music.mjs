// Seeds music_styles from a folder of locally-downloaded mp3s — built for
// YouTube Audio Library tracks, which have no public API and must be
// downloaded by hand (studio.youtube.com/channel/.../music or
// https://www.youtube.com/audiolibrary/music), filtered to
// "Attribution not required" so a single license line covers all of them.
//
// Folder layout — put each downloaded mp3 inside a subfolder named after
// the category/mood you want it grouped under in the picker:
//
//   music-library-incoming/
//     Calm/
//       ocean-breeze.mp3
//       soft-piano-keys.mp3
//     Uplifting/
//       morning-light.mp3
//     Worship/
//       gentle-hope.mp3
//
// The subfolder name becomes the category tag; the filename (minus
// extension, dashes/underscores turned into spaces, title-cased) becomes
// the track's display name. Re-run any time after adding more files —
// it skips names it has already inserted.
//
// Run from the repo root:
//
//   node --env-file=.env.local scripts/seed-local-music.mjs [folder]
//
// (folder defaults to ./music-library-incoming)
//
// Requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and
// SUPABASE_SERVICE_ROLE_KEY in the environment.

import { createClient } from "@supabase/supabase-js";
import { readFile, readdir, stat } from "node:fs/promises";
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

const ROOT = path.resolve(process.argv[2] || "music-library-incoming");

const SOURCE = "YouTube Audio Library";
const LICENSE = "Free to use, no attribution required (per YouTube Audio Library terms)";

function titleCase(stem) {
  return stem
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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
  let categoryDirs;
  try {
    categoryDirs = await readdir(ROOT, { withFileTypes: true });
  } catch (err) {
    console.error(`Could not read ${ROOT}: ${err.message}`);
    console.error(
      "Create the folder and organize mp3s into category subfolders first (see the comment at the top of this script)."
    );
    process.exit(1);
  }

  let imported = 0;
  let skipped = 0;
  const failed = [];

  for (const entry of categoryDirs) {
    if (!entry.isDirectory()) continue;
    const category = entry.name;
    const categoryPath = path.join(ROOT, category);
    const files = (await readdir(categoryPath)).filter((f) =>
      /\.mp3$/i.test(f)
    );

    console.log(`\n=== ${category} (${files.length} file(s)) ===`);

    for (const file of files) {
      const filePath = path.join(categoryPath, file);
      const stem = file.replace(/\.mp3$/i, "");
      const name = titleCase(stem);

      try {
        const { data: existing } = await supabase
          .from("music_styles")
          .select("id")
          .eq("name", name)
          .maybeSingle();

        if (existing) {
          console.log(`  skip (already imported): ${name}`);
          skipped++;
          continue;
        }

        const size = (await stat(filePath)).size;
        console.log(`  uploading: ${name} (${(size / 1024 / 1024).toFixed(1)} MB)`);

        const storagePath = `music/${slugify(category)}/${slugify(stem)}.mp3`;
        const musicUrl = await uploadToStorage(filePath, storagePath, "audio/mpeg");

        const { error } = await supabase.from("music_styles").insert({
          name,
          music_asset: musicUrl,
          category,
          source: SOURCE,
          license: LICENSE,
        });
        if (error) throw new Error(error.message);

        console.log(`    done: ${name}`);
        imported++;
      } catch (err) {
        console.error(`    FAILED: ${name}: ${err.message}`);
        failed.push(name);
      }
    }
  }

  console.log(`\nImported ${imported}, skipped ${skipped} already-imported.`);
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});

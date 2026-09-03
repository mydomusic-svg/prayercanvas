// Imports background clips from a LOCAL FOLDER into the `styles` table.
//
// This exists because Mixkit has no public API. Its licence is generous —
// commercial use, no attribution, and compositing a clip behind a prayer is
// well inside "altering by human skill and effort" — but the only way to get
// a file is to click Download on the site. Scraping it would breach the
// terms, so the workflow is: download what you like by hand, drop it in a
// folder, run this.
//
// It is not Mixkit-specific. Anything you have the right to use works:
// Artgrid footage if you subscribe, your own filming, a clip a friend shot.
// --source and --license are recorded per run and shown on /credits, so the
// provenance of every clip in the library stays answerable.
//
//   node --env-file=.env.local scripts/import-local-videos.mjs \
//     --folder="~/Downloads/mixkit" \
//     --source="Mixkit" \
//     --license="Mixkit Free License — free for commercial use, no attribution required"
//
// NAMING. The category comes from the filename, before the first dash:
//
//   Flowers - red roses opening.mp4      -> category Flowers
//   Nature - forest waterfall.mp4        -> category Nature
//   waterfall at dusk.mp4                -> falls back to --category (default Nature)
//   mixkit-white-rose-4k-1234.mp4        -> falls back too, named "white rose 4k"
//
// The spaces around the dash are required — without them an un-renamed
// Mixkit download would invent a category called "mixkit".
//
// Clips are encoded to exactly what the renderer uses before upload, so a
// 40MB 4K download lands as roughly 2MB.
//
// Flags:
//   --folder=PATH    required
//   --source=TEXT    required — where the clips came from, shown on /credits
//   --license=TEXT   required — the licence they carry
//   --category=NAME  fallback category for unprefixed filenames (default Nature)
//   --seconds=N      clip length to keep (default 12)
//   --dry-run        list what would be imported, write nothing

import { createClient } from "@supabase/supabase-js";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import {
  ensureFfmpeg,
  encodeForRender,
  uploadToBucket,
  MB,
  TARGET_SECONDS,
} from "./lib/ingest.mjs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "style-assets";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const text = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const DRY_RUN = process.argv.includes("--dry-run");
const FOLDER_RAW = text("folder");
const SOURCE = text("source");
const LICENSE = text("license");
const FALLBACK_CATEGORY = text("category", "Nature");
const SECONDS = Number(text("seconds", String(TARGET_SECONDS)));

if (!FOLDER_RAW || !SOURCE || !LICENSE) {
  console.error(
    "Usage:\n\n" +
      "  node --env-file=.env.local scripts/import-local-videos.mjs \\\n" +
      '    --folder="~/Downloads/mixkit" \\\n' +
      '    --source="Mixkit" \\\n' +
      '    --license="Mixkit Free License — free for commercial use, no attribution required"\n\n' +
      "--source and --license are required: a clip whose provenance nobody\n" +
      "recorded is a clip nobody can defend later.\n"
  );
  process.exit(1);
}

const FOLDER = FOLDER_RAW.startsWith("~")
  ? path.join(homedir(), FOLDER_RAW.slice(1))
  : path.resolve(FOLDER_RAW);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm"]);

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

// "Flowers - red roses opening.mp4" -> { category: "Flowers", label: "red roses opening" }
//
// THE SEPARATOR MUST HAVE SPACES AROUND IT. Mixkit's own downloads are named
// like "mixkit-white-rose-4k-1234.mp4", and a looser rule read that as a
// category called "mixkit" — which would have quietly created junk
// categories in the picker for every batch imported straight from the site.
// Requiring " - " means an un-renamed file falls back to --category instead.
function parseName(file) {
  const base = path.basename(file, path.extname(file)).trim();
  const m = base.match(/^([A-Za-z][A-Za-z ]{2,20}?) +[-—] +(.+)$/);
  if (m) return { category: m[1].trim(), label: m[2].trim() };
  // Tidy the common un-renamed case so the style name is readable:
  // "mixkit-white-rose-4k-1234" -> "white rose 4k"
  const label = base
    .replace(/^mixkit-/i, "")
    .replace(/-\d{4,}$/, "")
    .replace(/-/g, " ")
    .trim();
  return { category: FALLBACK_CATEGORY, label: label || base };
}

async function main() {
  if (!DRY_RUN) await ensureFfmpeg();

  let entries;
  try {
    entries = (await readdir(FOLDER)).filter((f) =>
      VIDEO_EXT.has(path.extname(f).toLowerCase()) && !f.startsWith(".")
    );
  } catch {
    console.error(`Cannot read folder: ${FOLDER}`);
    process.exit(1);
  }
  if (entries.length === 0) {
    console.error(`No video files in ${FOLDER}`);
    process.exit(1);
  }
  entries.sort();

  // Re-runs are safe: a clip already imported under the same storage path is
  // skipped rather than duplicated as a second row pointing at the same file.
  const { data: existingRows } = await supabase.from("styles").select("visual_asset");
  const existingPaths = new Set(
    (existingRows || []).map((r) => (r.visual_asset || "").split("/").pop()).filter(Boolean)
  );

  console.log(
    `${DRY_RUN ? "DRY RUN — nothing will be written\n" : ""}` +
      `${entries.length} file(s) in ${FOLDER}\n` +
      `source: ${SOURCE}\nlicense: ${LICENSE}\n` +
      `encoding to 1080x1920 / ${SECONDS}s / no audio\n`
  );

  let imported = 0, skipped = 0, before = 0, after = 0;
  const failed = [];
  const workDir = await mkdtemp(path.join(tmpdir(), "local-videos-"));

  for (const file of entries) {
    const { category, label } = parseName(file);
    const name = `${category} — ${label}`;
    const storageName = `local-${slug(SOURCE)}-${slug(label)}.mp4`;

    if (existingPaths.has(storageName)) {
      console.log(`  skip (already imported)  ${name}`);
      skipped++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  would import  ${category.padEnd(12)} ${label}`);
      imported++;
      continue;
    }
    try {
      const src = path.join(FOLDER, file);
      const out = path.join(workDir, storageName);
      const srcBytes = (await stat(src)).size;
      const outBytes = await encodeForRender(src, out, { seconds: SECONDS });
      before += srcBytes;
      after += outBytes;

      const url = await uploadToBucket(supabase, BUCKET, out, `videos/${storageName}`);
      const { error } = await supabase.from("styles").insert({
        name,
        visual_asset: url,
        music_asset: null,
        category,
        source: SOURCE,
        license: LICENSE,
      });
      if (error) throw new Error(error.message);

      imported++;
      console.log(
        `  ${String(imported).padStart(2)}. ${category.padEnd(12)} ` +
          `${label.padEnd(30).slice(0, 30)} ${MB(srcBytes)} -> ${MB(outBytes)}`
      );
    } catch (err) {
      console.error(`  FAILED ${file}: ${err.message}`);
      failed.push(file);
    }
  }

  await rm(workDir, { recursive: true, force: true });
  console.log(`\nImported ${imported}, skipped ${skipped}.`);
  if (before) {
    console.log(
      `${MB(before)} on disk -> ${MB(after)} stored ` +
        `(${(100 - (after / before) * 100).toFixed(0)}% smaller).`
    );
  }
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

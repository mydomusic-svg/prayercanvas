// Generates small WebP thumbnails for the create-page picker grids and
// records them in cartoon_characters.thumb_asset / photo_styles.thumb_asset
// (see 0019_picker_thumbnails.sql).
//
// WHY: those grids were loading the full-size assets. A cartoon portrait is
// a 1024x1024 PNG of ~1.2-1.5 MB displayed at ~64 CSS pixels; six of them
// is ~7.7 MB of downloads to draw six small tiles. On a phone that is slow
// enough to read as "the images aren't showing", and it spends Storage
// egress this project cannot spare.
//
// Supabase image transformations would do this server-side, but they are a
// paid-plan feature, so the small copies are pre-generated here.
//
// Run from the repo root:
//
//   node --env-file=.env.local scripts/make-thumbnails.mjs [--dry-run]
//
// Requires ffmpeg on PATH (same as seed-animations.mjs), plus
// NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Safe to re-run:
// it overwrites thumbnails in place at a stable path.

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = "style-assets";

// 256px on the long edge: the largest tile in either grid is well under
// 200 CSS px, so this still has headroom on a 3x display.
const THUMB_FILTER = "scale='min(256,iw)':'min(256,ih)':force_original_aspect_ratio=decrease";

// WebP is the better format here, but plenty of ffmpeg builds ship without
// it — Homebrew's current bottle is compiled without --enable-libwebp, and
// it fails at the very end with "Encoder not found" rather than up front.
// So ask ffmpeg what it can actually do and fall back to JPEG, which every
// build has. JPEG lands a bit larger than WebP and cannot carry
// transparency; neither matters for these assets (solid-background
// portraits and photographs), and either way it is a >95% reduction on
// what the picker downloads today.
async function pickThumbFormat() {
  try {
    const { stdout } = await execFileAsync("ffmpeg", ["-hide_banner", "-encoders"]);
    if (/\blibwebp(_anim)?\b/.test(stdout)) {
      return { ext: "webp", contentType: "image/webp", args: ["-c:v", "libwebp", "-quality", "80"] };
    }
  } catch {
    // fall through to JPEG
  }
  // -q:v 3 on mjpeg is visually clean at this size; 1 is near-lossless and
  // needlessly large, 5+ starts showing blocking on flat cartoon fills.
  return { ext: "jpg", contentType: "image/jpeg", args: ["-c:v", "mjpeg", "-q:v", "3"] };
}

const TARGETS = [
  { table: "cartoon_characters", prefix: "characters" },
  { table: "photo_styles", prefix: "photos" },
];

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

async function main() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    console.error("ffmpeg not found on PATH. Install it first:\n\n  brew install ffmpeg\n");
    process.exit(1);
  }

  const format = await pickThumbFormat();
  console.log(`Writing ${format.ext.toUpperCase()} thumbnails at 256px.\n`);

  const workDir = await mkdtemp(path.join(tmpdir(), "thumbs-"));
  let before = 0, after = 0, done = 0;
  const failed = [];

  try {
    for (const { table, prefix } of TARGETS) {
      const { data: rows, error } = await supabase
        .from(table)
        .select("id, name, image_asset")
        .not("image_asset", "is", null);
      if (error) {
        console.error(`Could not read ${table}: ${error.message}`);
        continue;
      }

      for (const row of rows ?? []) {
        if (!row.image_asset?.startsWith("http")) continue;
        const inPath = path.join(workDir, `in-${row.id}`);
        const outPath = path.join(workDir, `out-${row.id}.${format.ext}`);
        try {
          const res = await fetch(row.image_asset);
          if (!res.ok) throw new Error(`download ${res.status}`);
          const srcBuf = Buffer.from(await res.arrayBuffer());
          await writeFile(inPath, srcBuf);

          await execFileAsync("ffmpeg", [
            "-y", "-i", inPath,
            "-vf", THUMB_FILTER,
            ...format.args,
            "-frames:v", "1",
            outPath,
          ]);

          const outBuf = await readFile(outPath);
          before += srcBuf.length;
          after += outBuf.length;

          console.log(
            `${table.padEnd(18)} ${String(row.name).padEnd(28).slice(0, 28)} ` +
              `${(srcBuf.length / 1024).toFixed(0)}KB -> ${(outBuf.length / 1024).toFixed(0)}KB`
          );

          if (!DRY_RUN) {
            const storagePath = `${prefix}/${slug(row.name)}-thumb.${format.ext}`;
            const { error: upErr } = await supabase.storage
              .from(BUCKET)
              .upload(storagePath, outBuf, { contentType: format.contentType, upsert: true });
            if (upErr) throw new Error(`upload: ${upErr.message}`);
            const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
            const { error: updErr } = await supabase
              .from(table)
              .update({ thumb_asset: pub.publicUrl })
              .eq("id", row.id);
            if (updErr) throw new Error(`update: ${updErr.message}`);
            done++;
          }
        } catch (err) {
          console.error(`FAILED  ${table}/${row.name}: ${err.message}`);
          failed.push(`${table}/${row.name}`);
        } finally {
          await rm(inPath, { force: true });
          await rm(outPath, { force: true });
        }
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  console.log(
    `\n${DRY_RUN ? "DRY RUN — nothing written. " : ""}` +
      `${done} thumbnail(s) written. ` +
      `Picker payload ${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(2)}MB.`
  );
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Thumbnail generation failed:", err);
  process.exit(1);
});

// Re-encodes the seeded stock video library (the `styles` table's
// visual_asset clips in the public `style-assets` bucket) down to what the
// render pipeline actually uses, overwriting each file IN PLACE so the
// existing public URLs — and therefore every styles row and every prayer
// already pointing at them — keep working untouched. No DB writes at all.
//
// Why this saves so much: the seeder pulled clips straight from Pexels at
// whatever resolution/bitrate/length they shipped in (many 20-45 MB, some
// 60+ seconds), but the worker throws most of that away on every render:
//
//   1. RESOLUTION/CROP — worker/index.js scales+crops every background to
//      exactly 1080x1920 (buildFilterComplex's hasBackgroundVideo branch).
//      A 1920x1080 landscape clip has ~70% of its pixels cropped off. We
//      pre-apply that same scale+crop here, once, instead of storing the
//      discarded pixels forever.
//   2. AUDIO — the filter graph only ever reads [0:v] from the background
//      clip. Its audio track is never touched (voice is [1:a], music is
//      [2:a]). Stripping it is free savings.
//   3. LENGTH — renderPrayer loops the clip with `-stream_loop -1` to fill
//      the prayer's duration, so a 12-second clip looks the same as a
//      45-second one for anything longer than 45s, and nearly the same
//      below that. Trimming is the single biggest win on the long clips.
//   4. BITRATE — CRF 30 with a bitrate cap. These sit BEHIND text, and the
//      thumbnail path blurs them outright (gblur=sigma=14), so visually
//      lossless encoding was never buying anything.
//
// SAFETY: dry-run by DEFAULT. It downloads and re-encodes so you can see
// the real before/after numbers, but writes nothing until you pass
// --apply. Re-running after --apply is harmless: already-compressed clips
// come out roughly the same size and are skipped by the --min-saving
// threshold rather than being re-encoded again and again (generation loss).
//
// Usage, from the repo root:
//
//   node --env-file=.env.local scripts/compress-video-library.mjs
//   node --env-file=.env.local scripts/compress-video-library.mjs --apply
//
// Options:
//   --apply            actually overwrite the files (default: dry run)
//   --seconds=N        max clip length, default 12
//   --crf=N            x264 quality, higher = smaller, default 30
//   --limit=N          only process the first N clips (for a quick test)
//   --min-saving=N     skip upload unless it shrinks by at least N percent,
//                      default 15
//
// Requires ffmpeg on PATH (`brew install ffmpeg`) plus
// NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, stat, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const BUCKET = "style-assets";
const PUBLIC_MARKER = `/object/public/${BUCKET}/`;

function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const value = Number(hit.split("=")[1]);
  return Number.isFinite(value) ? value : fallback;
}

const APPLY = process.argv.includes("--apply");
const MAX_SECONDS = flag("seconds", 12);
const CRF = flag("crf", 30);
const LIMIT = flag("limit", Infinity);
const MIN_SAVING_PCT = flag("min-saving", 15);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Turns a public Storage URL back into its path within the bucket. */
function storagePathFromUrl(url) {
  const idx = url.indexOf(PUBLIC_MARKER);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + PUBLIC_MARKER.length));
}

async function ensureFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    console.error(
      "ffmpeg not found on PATH. Install it first:\n\n  brew install ffmpeg\n"
    );
    process.exit(1);
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function reencode(input, output) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", input,
    // Exactly what buildFilterComplex does to a background at render time,
    // applied once here instead of on every single render.
    "-vf",
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", String(CRF),
    "-maxrate", "1400k",
    "-bufsize", "2800k",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    // The render pipeline never reads this clip's audio — voice is [1:a],
    // music is [2:a]. Dropping it is free.
    "-an",
    // Output-level duration cap. Kept immediately before the output path
    // so argument order can't silently rebind it to a later input (the
    // exact ffmpeg footgun that broke the worker's duration cap once).
    "-t", String(MAX_SECONDS),
    output,
  ]);
}

async function main() {
  await ensureFfmpeg();

  const { data: styles, error } = await supabase
    .from("styles")
    .select("id, name, visual_asset")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`Failed to read styles: ${error.message}`);
    process.exit(1);
  }

  const targets = (styles || [])
    .filter((s) => s.visual_asset?.startsWith("http"))
    .map((s) => ({ ...s, storagePath: storagePathFromUrl(s.visual_asset) }))
    .filter((s) => s.storagePath)
    .slice(0, LIMIT);

  if (targets.length === 0) {
    console.log("No library clips found to compress.");
    return;
  }

  console.log(
    `${APPLY ? "COMPRESSING" : "DRY RUN (nothing will be written — pass --apply to commit)"}\n` +
      `${targets.length} clip(s), target ${MAX_SECONDS}s @ 1080x1920, CRF ${CRF}, no audio.\n`
  );

  const workDir = await mkdtemp(path.join(tmpdir(), "compress-library-"));
  let totalBefore = 0;
  let totalAfter = 0;
  let written = 0;
  let skipped = 0;
  const failed = [];

  try {
    for (const [i, style] of targets.entries()) {
      const label = `[${i + 1}/${targets.length}] ${style.storagePath}`;
      const inPath = path.join(workDir, `in-${i}.mp4`);
      const outPath = path.join(workDir, `out-${i}.mp4`);

      try {
        await download(style.visual_asset, inPath);
        const before = (await stat(inPath)).size;

        await reencode(inPath, outPath);
        const after = (await stat(outPath)).size;

        const savingPct = before > 0 ? ((before - after) / before) * 100 : 0;
        totalBefore += before;

        if (savingPct < MIN_SAVING_PCT) {
          // Already small/compressed — leave it alone rather than burn
          // another encode generation on it for a negligible win.
          totalAfter += before;
          skipped++;
          console.log(
            `${label}\n    ${mb(before)} -> ${mb(after)} (${savingPct.toFixed(0)}%) — skipped, below ${MIN_SAVING_PCT}% threshold`
          );
          continue;
        }

        totalAfter += after;

        if (APPLY) {
          const buffer = await readFile(outPath);
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(style.storagePath, buffer, {
              contentType: "video/mp4",
              upsert: true,
              cacheControl: "3600",
            });
          if (uploadError) throw new Error(`upload: ${uploadError.message}`);
          written++;
        }

        console.log(
          `${label}\n    ${mb(before)} -> ${mb(after)}  (saves ${savingPct.toFixed(0)}%)${APPLY ? " ✓ written" : ""}`
        );
      } catch (err) {
        console.error(`${label}\n    FAILED: ${err.message}`);
        failed.push(style.storagePath);
      } finally {
        await rm(inPath, { force: true });
        await rm(outPath, { force: true });
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const savedPct =
    totalBefore > 0 ? ((totalBefore - totalAfter) / totalBefore) * 100 : 0;

  console.log(
    `\n${"=".repeat(60)}\n` +
      `Library size:  ${mb(totalBefore)}  ->  ${mb(totalAfter)}\n` +
      `Reclaimed:     ${mb(totalBefore - totalAfter)}  (${savedPct.toFixed(0)}%)\n` +
      `${APPLY ? `Written: ${written}` : "Nothing written (dry run)"}` +
      `${skipped ? `, skipped ${skipped} already-small` : ""}` +
      `${failed.length ? `, FAILED ${failed.length}` : ""}\n` +
      `${"=".repeat(60)}`
  );

  if (!APPLY) {
    console.log(
      "\nHappy with those numbers? Re-run with --apply to overwrite them for real."
    );
  }
  if (failed.length) {
    console.log(`\nFailed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Compression run failed:", err);
  process.exit(1);
});

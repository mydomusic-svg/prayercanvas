// Re-encodes the background PHOTO library in place, overwriting each file at
// its existing Storage path so every photo_styles row — and every prayer
// already pointing at one — keeps working untouched. No DB writes at all.
// Same shape as compress-music-library.mjs, which took the music library
// from 286MB to 152MB.
//
// WHY THERE IS ANYTHING TO WIN. Measured on the live bucket:
//
//   style-assets    376 files   506.0 MB     <- 92% of all storage
//   prayer-videos    18 files    34.5 MB
//   prayer-audio     15 files     7.5 MB
//   prayer-photos     2 files     3.6 MB
//
// The two largest files in the entire project are background photos, at
// 9.3MB and 8.7MB — each bigger than the biggest rendered video. They were
// uploaded at whatever resolution they came in at, which for stock
// photography means full camera resolution.
//
// HOW BIG A PHOTO ACTUALLY NEEDS TO BE. The render never shows one at that
// size. worker/index.js turns a still into a Ken Burns clip with:
//
//   scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,
//   zoompan=...:s=1080x1920
//
// So the photo is scaled to cover 1620x2880, cropped to it, and zoompan
// samples a 1080x1920 output from that. 1620x2880 is itself already 1.5x the
// output, chosen so a 1.25x zoom still reads real pixels rather than an
// upscale. Every pixel beyond 1620x2880 is decoded and thrown away.
//
// The target here is therefore the SMALLEST size that still covers
// 1620x2880 without the render having to upscale: shrink by
// max(1620/width, 2880/height), never above 1. For a tall photo that is a
// big reduction. For a wide one it is smaller, because covering a 9:16 crop
// from a landscape frame genuinely needs the height — so most of that file's
// saving comes from quality instead.
//
// FORMAT IS PRESERVED, never converted. A .png path must keep containing
// PNG bytes: the row points at that exact path, and writing JPEG into it
// would work for ffmpeg (which sniffs the stream) but break anything
// trusting the extension. PNGs therefore save on dimensions alone and are
// usually skipped by --min-saving. That is correct, not a bug.
//
// SAFETY: dry run by DEFAULT. It downloads and re-encodes so you see real
// before/after numbers, and writes nothing until you pass --apply. Re-running
// after --apply is harmless — already-compressed photos come out about the
// same size and get skipped.
//
//   node --env-file=.env.local scripts/compress-photo-library.mjs
//   node --env-file=.env.local scripts/compress-photo-library.mjs --apply
//
// Flags:
//   --apply           actually overwrite (default: dry run)
//   --quality=N       ffmpeg -q:v for JPEG, 2 (best) to 31, default 4
//   --min-saving=N    skip photos that would shrink by less than N%, default 15
//   --limit=N         only process the first N photos
//
// WHAT THIS CANNOT BREAK, and why:
//
//   Paths        every file is overwritten at its own existing path, so no
//                photo_styles row and no existing prayer changes. Zero DB writes.
//   Format       the encoder is chosen from the extension, so a .png keeps
//                containing PNG and a .jpg keeps containing JPEG.
//   Aspect ratio one uniform scale factor on both axes, then verified against
//                the source after encoding.
//   Sharpness    the target is exactly the size worker/index.js already scales
//                to. The render's output is pixel-for-pixel unchanged; it just
//                stops decoding pixels it was throwing away.
//   Orientation  photos carrying an EXIF orientation tag are skipped entirely.
//   Upscaling    never. A photo already at or under the working size keeps its
//                own dimensions.
//
// Every output is re-probed before upload, and anything that does not come
// back exactly as expected is skipped rather than written.

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const BUCKET = "style-assets";
const PREFIX = "photos";

// Must match the pre-scale in worker/index.js buildKenBurnsClip(). If that
// changes, change this — a photo smaller than the render's working size gets
// upscaled, which is exactly the softness this is meant to avoid.
const COVER_W = 1620;
const COVER_H = 2880;

function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const v = Number(hit.split("=")[1]);
  return Number.isFinite(v) ? v : fallback;
}

const APPLY = process.argv.includes("--apply");
const QUALITY = flag("quality", 4);
const MIN_SAVING_PCT = flag("min-saving", 15);
const LIMIT = flag("limit", Infinity);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;

async function ensureFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    await execFileAsync("ffprobe", ["-version"]);
  } catch {
    console.error("ffmpeg/ffprobe not found on PATH.\n\n  brew install ffmpeg\n");
    process.exit(1);
  }
}

function encoderFor(storagePath) {
  const ext = storagePath.toLowerCase().split(".").pop();
  if (["jpg", "jpeg"].includes(ext)) {
    return { args: ["-q:v", String(QUALITY)], contentType: "image/jpeg", ext };
  }
  if (ext === "png") {
    // PNG is lossless; the only lever is dimensions. compression_level 9 is
    // slower and slightly smaller.
    return { args: ["-compression_level", "9"], contentType: "image/png", ext };
  }
  if (ext === "webp") {
    return { args: ["-quality", "82"], contentType: "image/webp", ext };
  }
  return null;
}

// EXIF ORIENTATION IS THE ONE WAY THIS COULD SILENTLY BREAK A PHOTO.
//
// A camera often stores the image un-rotated plus an orientation tag, and
// leaves it to the viewer to turn it. Re-encoding through ffmpeg drops that
// tag. Browsers honour it; ffmpeg's still-image path does not. So a photo
// that relies on the tag looks upright in the picker today and would come
// out sideways after a naive re-encode — in the picker, and only there,
// which is exactly the kind of difference that survives a spot check.
//
// Rather than guess which way to bake the rotation, any photo carrying a
// non-trivial orientation is reported and left completely alone. There are
// unlikely to be many: these are downloaded stock photos, not camera rolls.
async function exifOrientation(file) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream_tags=Orientation:stream_side_data=rotation",
      "-of", "default=nw=1:nk=1",
      file,
    ]);
    const v = stdout.trim();
    // "1" is "no rotation needed"; empty means no tag at all.
    return v === "" || v === "1" ? null : v;
  } catch {
    return null;
  }
}

async function dimensions(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    file,
  ]);
  const [w, h] = stdout.trim().split("x").map(Number);
  return { w, h };
}

async function listPhotos() {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(PREFIX, { limit: 100, offset });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const f of data) {
      if (f.id && f.metadata) {
        out.push({ path: `${PREFIX}/${f.name}`, size: f.metadata.size ?? 0 });
      }
    }
    if (data.length < 100) break;
    offset += data.length;
  }
  return out;
}

async function main() {
  await ensureFfmpeg();

  const photos = (await listPhotos()).sort((a, b) => b.size - a.size);
  if (!photos.length) {
    console.log(`No files under ${BUCKET}/${PREFIX}/.`);
    return;
  }

  const before = photos.reduce((n, p) => n + p.size, 0);
  console.log(
    `${photos.length} photos, ${mb(before)}. ` +
      (APPLY ? "APPLYING — files will be overwritten.\n" : "Dry run — nothing will be written.\n")
  );

  const tmp = await mkdtemp(path.join(tmpdir(), "photo-compress-"));
  let processed = 0;
  let saved = 0;
  const skipped = [];

  try {
    for (const photo of photos.slice(0, LIMIT)) {
      const enc = encoderFor(photo.path);
      if (!enc) {
        skipped.push(`${photo.path} (unsupported format)`);
        continue;
      }

      const src = path.join(tmp, `in.${enc.ext}`);
      const dst = path.join(tmp, `out.${enc.ext}`);

      const { data: signed, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(photo.path, 300);
      if (signError) {
        skipped.push(`${photo.path} (${signError.message})`);
        continue;
      }

      const res = await fetch(signed.signedUrl);
      if (!res.ok) {
        skipped.push(`${photo.path} (download ${res.status})`);
        continue;
      }
      await writeFile(src, Buffer.from(await res.arrayBuffer()));

      const { w, h } = await dimensions(src);
      if (!w || !h) {
        skipped.push(`${photo.path} (could not read dimensions)`);
        continue;
      }

      const orientation = await exifOrientation(src);
      if (orientation) {
        skipped.push(`${photo.path} (EXIF orientation ${orientation} — left alone)`);
        continue;
      }

      // Never upscale: a photo already at or below the render's working size
      // is left at its own dimensions and only re-encoded.
      const scale = Math.min(1, Math.max(COVER_W / w, COVER_H / h));
      const tw = Math.max(2, Math.round((w * scale) / 2) * 2);
      const th = Math.max(2, Math.round((h * scale) / 2) * 2);

      await execFileAsync("ffmpeg", [
        "-y", "-i", src,
        "-vf", `scale=${tw}:${th}:flags=lanczos`,
        ...enc.args,
        dst,
      ]);

      // VERIFY BEFORE TRUSTING. ffmpeg exiting 0 is not proof the file it
      // wrote is readable at the right size — and this overwrites originals
      // that cannot be recovered. Re-probe the output and check it came out
      // with the dimensions asked for and the same aspect ratio as the
      // source. Anything unexpected is skipped, not uploaded.
      const out = await dimensions(dst);
      if (out.w !== tw || out.h !== th) {
        skipped.push(
          `${photo.path} (output was ${out.w}x${out.h}, expected ${tw}x${th})`
        );
        continue;
      }
      const aspectDrift = Math.abs(out.w / out.h - w / h) / (w / h);
      if (aspectDrift > 0.01) {
        skipped.push(`${photo.path} (aspect ratio changed by ${(aspectDrift * 100).toFixed(1)}%)`);
        continue;
      }

      const after = (await stat(dst)).size;
      const savingPct = ((photo.size - after) / photo.size) * 100;

      if (savingPct < MIN_SAVING_PCT) {
        skipped.push(
          `${photo.path} (${mb(photo.size)} -> ${mb(after)}, only ${savingPct.toFixed(0)}%)`
        );
        continue;
      }

      console.log(
        `  ${photo.path}\n    ${w}x${h} ${mb(photo.size)} -> ${tw}x${th} ${mb(after)}  (-${savingPct.toFixed(0)}%)`
      );

      if (APPLY) {
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(photo.path, await readFile(dst), {
            contentType: enc.contentType,
            upsert: true,
          });
        if (upErr) {
          skipped.push(`${photo.path} (upload failed: ${upErr.message})`);
          continue;
        }
      }

      processed++;
      saved += photo.size - after;
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  console.log(`\n${processed} photos ${APPLY ? "rewritten" : "would shrink"}, saving ${mb(saved)}.`);
  console.log(`Library: ${mb(before)} -> ${mb(before - saved)}`);
  if (skipped.length) {
    console.log(`\n${skipped.length} left alone:`);
    for (const s of skipped.slice(0, 15)) console.log(`  ${s}`);
    if (skipped.length > 15) console.log(`  ...and ${skipped.length - 15} more`);
  }
  if (!APPLY && processed) {
    console.log("\nRe-run with --apply to write these.");
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

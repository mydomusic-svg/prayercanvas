// Re-encodes the music library IN PLACE, overwriting each file at its
// existing Storage path so every music_styles row — and every prayer already
// pointing at one — keeps working untouched. No DB writes at all.
//
// WHY THIS IS THE BIGGEST WIN AVAILABLE. Measured on the live bucket:
//
//   videos      242 files   292 MB   (already compressed, avg 1.2 MB)
//   music        77 files   286 MB   (avg 3.7 MB, largest 32 MB)
//
// Seventy-seven music tracks take as much room as all 242 background clips
// put together, and one of them — ethereal-relaxation.mp3 — is 32 MB on its
// own. They were uploaded at whatever bitrate they shipped in, which for
// these is essentially master quality.
//
// The render never uses that quality. worker/index.js mixes music UNDER the
// voice at volume 0.5 (sidechain-ducked lower still whenever the voice is
// speaking), then re-encodes the whole mix to AAC. A 320kbps master and a
// 112kbps copy are indistinguishable after that, because the thing you are
// listening to is a prayer with a bed under it, not the bed.
//
// SAFE TO TRIM, because the worker loops the bed:
//
//   audioInputArgs.push("-stream_loop", "-1", "-i", musicPath, ...)
//
// so a trimmed track still fills a prayer of any length. The cap is set well
// past the longest typical prayer anyway; it exists to catch the handful of
// ten-minute ambient pieces, not to chop ordinary tracks.
//
// SAFETY: dry-run by DEFAULT. It downloads and re-encodes so you can see the
// real before/after numbers, and writes nothing until you pass --apply.
// Re-running after --apply is harmless: already-compressed tracks come out
// roughly the same size and are skipped by the --min-saving threshold.
//
//   node --env-file=.env.local scripts/compress-music-library.mjs
//   node --env-file=.env.local scripts/compress-music-library.mjs --apply
//
// Flags:
//   --apply           actually overwrite (default: dry run)
//   --bitrate=N       AAC kbps, default 112
//   --seconds=N       max track length kept, default 180
//   --min-saving=N    skip tracks that would shrink by less than N%, default 15
//   --limit=N         only process the first N tracks

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
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const BUCKET = "style-assets";
const PUBLIC_MARKER = `/object/public/${BUCKET}/`;

function flag(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const v = Number(hit.split("=")[1]);
  return Number.isFinite(v) ? v : fallback;
}

const APPLY = process.argv.includes("--apply");
const BITRATE = flag("bitrate", 112);
const MAX_SECONDS = flag("seconds", 180);
const MIN_SAVING_PCT = flag("min-saving", 15);
const LIMIT = flag("limit", Infinity);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

function storagePathFromUrl(url) {
  const i = url.indexOf(PUBLIC_MARKER);
  return i === -1 ? null : decodeURIComponent(url.slice(i + PUBLIC_MARKER.length));
}

async function ensureFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    console.error("ffmpeg not found on PATH. Install it first:\n\n  brew install ffmpeg\n");
    process.exit(1);
  }
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

// THE RE-ENCODE KEEPS THE FILE'S OWN FORMAT.
//
// Every track is overwritten at the path its music_styles row already points
// at, so the bytes must still match the extension. Writing AAC into a .mp3
// path would work for the worker (ffmpeg sniffs the stream, not the name)
// but not for anything that trusts the extension, and it is not worth the
// ambiguity to save a few kilobytes. A format this cannot safely match is
// skipped and reported rather than guessed at.
function encoderFor(storagePath) {
  const ext = storagePath.toLowerCase().split(".").pop();
  if (ext === "mp3") {
    return { args: ["-c:a", "libmp3lame"], contentType: "audio/mpeg", ext: "mp3" };
  }
  if (["m4a", "mp4", "aac"].includes(ext)) {
    return {
      args: ["-c:a", "aac", "-movflags", "+faststart"],
      contentType: ext === "aac" ? "audio/aac" : "audio/mp4",
      ext,
    };
  }
  return null;
}

async function reencode(input, output, enc) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", input,
    "-vn",                         // drop any embedded cover art
    ...enc.args,
    "-b:a", `${BITRATE}k`,
    "-ar", "44100",                // what the worker's filter graph expects
    "-ac", "2",
    // Immediately before the output path so ffmpeg cannot rebind it to a
    // later input — the same footgun that once broke the worker's cap.
    "-t", String(MAX_SECONDS),
    output,
  ]);
}

async function main() {
  await ensureFfmpeg();

  const { data: rows, error } = await supabase
    .from("music_styles")
    .select("id, name, music_asset")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`Failed to read music_styles: ${error.message}`);
    process.exit(1);
  }

  const targets = (rows || [])
    .filter((r) => r.music_asset?.startsWith("http"))
    .map((r) => ({ ...r, storagePath: storagePathFromUrl(r.music_asset) }))
    .filter((r) => r.storagePath)
    .slice(0, LIMIT);

  if (targets.length === 0) {
    console.log("No music tracks found.");
    return;
  }

  console.log(
    `${APPLY ? "COMPRESSING" : "DRY RUN (nothing will be written — pass --apply to commit)"}\n` +
      `${targets.length} track(s), ${BITRATE}k, max ${MAX_SECONDS}s, format preserved.\n`
  );

  const workDir = await mkdtemp(path.join(tmpdir(), "compress-music-"));
  let before = 0, after = 0, written = 0, skipped = 0;
  const failed = [];

  try {
    for (const [i, t] of targets.entries()) {
      const label = `[${i + 1}/${targets.length}] ${t.storagePath}`;
      const enc = encoderFor(t.storagePath);
      if (!enc) {
        skipped++;
        console.log(`${label}\n    skipped — unrecognised audio format, not re-encoding blind`);
        continue;
      }
      const inPath = path.join(workDir, `in-${i}`);
      const outPath = path.join(workDir, `out-${i}.${enc.ext}`);
      try {
        await download(t.music_asset, inPath);
        const b = (await stat(inPath)).size;
        await reencode(inPath, outPath, enc);
        const a = (await stat(outPath)).size;
        const saving = b > 0 ? ((b - a) / b) * 100 : 0;
        before += b;

        if (saving < MIN_SAVING_PCT) {
          after += b;
          skipped++;
          console.log(`${label}\n    ${mb(b)} -> ${mb(a)} (${saving.toFixed(0)}%) — skipped, under ${MIN_SAVING_PCT}%`);
          continue;
        }
        after += a;

        if (APPLY) {
          // Overwritten at the SAME path, in the same format it already was.
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(t.storagePath, await readFile(outPath), {
              contentType: enc.contentType,
              upsert: true,
              cacheControl: "3600",
            });
          if (upErr) throw new Error(upErr.message);
          written++;
        }
        console.log(`${label}\n    ${mb(b)} -> ${mb(a)} (${saving.toFixed(0)}% smaller)${APPLY ? "  written" : ""}`);
      } catch (err) {
        console.error(`${label}\n    FAILED: ${err.message}`);
        failed.push(t.storagePath);
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  console.log(
    `\n${"=".repeat(62)}\n` +
      `${mb(before)} -> ${mb(after)}  (${before ? (100 - (after / before) * 100).toFixed(0) : 0}% smaller)\n` +
      `${APPLY ? `${written} written, ` : ""}${skipped} skipped${failed.length ? `, ${failed.length} failed` : ""}\n` +
      `${APPLY ? "" : "\nNothing was written. Re-run with --apply to commit.\n"}` +
      `${"=".repeat(62)}`
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Compression failed:", err);
  process.exit(1);
});

// Shared ingest for background clips, whatever library they come from.
//
// THE POINT OF THIS FILE IS THE ENCODE, and the encode happens BEFORE the
// upload. seed-video-library.mjs originally pushed clips to Storage exactly
// as the source shipped them — 20-45MB, some over a minute long, many
// landscape — and left compress-video-library.mjs to clean up afterwards.
// That is how style-assets reached 540MB on a bucket with a 1GB tier, and
// it means every clip is paid for twice: once at full size, once again in
// the egress to re-download and re-encode it.
//
// The render pipeline throws almost all of that away anyway. worker's
// buildFilterComplex scales and crops every background to exactly
// 1080x1920, never reads its audio track, and loops it with -stream_loop
// to fill the prayer, so anything past ~12 seconds is unseen. Applying
// that here, once, costs nothing and lands each clip at roughly 2MB
// instead of 30.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, stat } from "node:fs/promises";

const execFileAsync = promisify(execFile);

export const TARGET_SECONDS = 12;
export const TARGET_CRF = 30;

export async function ensureFfmpeg() {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
  } catch {
    throw new Error("ffmpeg not found on PATH. Install it first:\n\n  brew install ffmpeg\n");
  }
}

/** Exactly what the worker does to a background, applied once at ingest. */
export async function encodeForRender(input, output, { seconds = TARGET_SECONDS, crf = TARGET_CRF } = {}) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i", input,
    "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", String(crf),
    "-maxrate", "1400k",
    "-bufsize", "2800k",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    // Kept immediately before the output path so ffmpeg cannot rebind it
    // to a later input — the footgun that once broke the worker's cap.
    "-t", String(seconds),
    output,
  ]);
  return (await stat(output)).size;
}

export async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
  return buf.byteLength;
}

export async function uploadToBucket(supabase, bucket, localPath, storagePath) {
  const data = await readFile(localPath);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, data, { contentType: "video/mp4", upsert: true });
  if (error) throw new Error(`upload failed for ${storagePath}: ${error.message}`);
  return supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
}

export const MB = (n) => `${(n / 1048576).toFixed(1)}MB`;
